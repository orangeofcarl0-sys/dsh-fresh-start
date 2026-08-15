// dsh-fresh-start — host half
//
// `/fresh` 命令：一键总结当前对话 → 开启新对话（带摘要）→ 归档老对话。
//
// 目的：超大会话（数十万事件）的内存/卡顿缓解。在一个超大会话里工作一段
// 时间后，用 /fresh 把「dsh 上传给 LLM 的完整上下文」总结成一段摘要、归档老
// 会话（释放 live 事件树内存）、开一个继承同 cwd 与 preset 的新对话（seed 摘要）。
//
// 与 compaction 引擎的区别：
//   - dsh 的 compaction（/compact）用「工程 checkpoint 指令 + token 比较」总结，
//     在普通对话上常失败（summary is not smaller / no text content）。
//   - 本插件直接提取 session.deriveMessages()（即 dsh 上传给 LLM 的完整上下文）
//     + requestHeader()（system/tools），用一条简单指令让 LLM 总结，摘要作为
//     新对话的开场 user message。
//
// 关键实现点（dsh 0.1.0-rc.6 源码级）：
//   - compaction 引擎是 per-agent preset 挂载的服务，profile 插件拿不到全局
//     ctx.compaction；但 ctx.llm 是全局服务可直接注入。
//   - 命令须在 root ctx 用 ctx.commands.register 注册才进入全局命令列表。
//
// 流程（每步独立、失败降级不阻断后续）：
//   1. 总结：session.requestHeader() + session.deriveMessages() → ctx.llm.stream
//   2. 开新对话：ctx.agents.create({ sessionId, seed:[摘要], meta:{cwd, agentPreset}, setup })
//   3. 归档：ctx.workspaceRegistry.archiveSession(oldId)

import { randomUUID } from 'node:crypto'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'

export const name = 'dsh-fresh-start'
export const inject = ['commands', 'agentPresets', 'agents', 'workspaceRegistry', 'llm']

const TAG = '[fresh-start]'
const log = (...args) => console.log(TAG, ...args)
const logErr = (...args) => console.error(TAG, ...args)

const SUMMARY_INSTRUCTION = 'Summarize the conversation above in concise natural language. Preserve exact file paths, commands, error strings, identifiers, and any pending work or user feedback. Output only the summary text, no preamble or tools.'
const SUMMARY_PREAMBLE = 'The following is a summary of a previous conversation. Treat it as established context and continue the task from here.'

/** 提取 dsh 上传的完整上下文，用一条简单指令让 LLM 总结。 */
async function summarizeContext(ctx, session, agent, signal) {
  const header = session.requestHeader()
  const messages = session.deriveMessages()
  if (messages.length === 0) return null

  // 确定 provider/model：最近请求路由 > agent 选项
  const latest = header?.config
  const agentTarget = (typeof agent?.options?.provider === 'string' && agent.options.provider.length > 0
    && typeof agent?.options?.model === 'string' && agent.options.model.length > 0)
    ? { provider: agent.options.provider, model: agent.options.model }
    : void 0
  const target = latest ?? agentTarget
  if (target === void 0) throw new Error('no provider/model available for summarization')

  messages.push(createUserMessage({
    content: [{ type: 'text', text: SUMMARY_INSTRUCTION }],
    source: { kind: 'plugin', plugin: 'dsh-fresh-start' },
  }))

  const assembler = new BlockAssembler()
  const options = {
    provider: target.provider,
    model: target.model,
    messages,
    ...(header?.system === void 0 ? {} : { system: header.system }),
    ...(header?.tools === void 0 ? {} : { tools: [...header.tools] }),
    maxTokens: 2000,
    sessionId: session.id,
    purpose: 'compaction',
    ...(signal === void 0 ? {} : { signal }),
  }
  for await (const chunk of ctx.llm.stream(options)) assembler.push(chunk)
  const finish = assembler.finish
  if (finish.kind === 'error' || finish.kind === 'aborted') {
    const error = new Error(finish.failure?.message ?? 'summarization failed')
    error.code = finish.failure?.code
    throw error
  }
  const text = assembler.blocks()
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim()
  if (text.length === 0) throw new Error('summarization produced no text')
  return text
}

export function apply(ctx) {
  const disposers = []
  const active = new Set()

  async function executeFresh(invocation) {
    const agent = invocation.agent
    const session = agent.session
    const oldId = session.id
    const cwd = session.header.cwd
    const preset = resolveSessionPreset(session) ?? session.header.agentPreset

    const parts = []

    // ---- 1. 总结（直接提取 dsh 上传的上下文）----
    let summary = null
    try {
      summary = await summarizeContext(ctx, session, agent, invocation.signal)
      parts.push(summary === null
        ? 'nothing to summarize (empty context)'
        : `summarized (${summary.length} chars)`)
    } catch (error) {
      if (invocation.signal.aborted) return { kind: 'error', text: 'fresh-start cancelled' }
      parts.push(`summarization failed (${error?.message ?? error}); continuing without summary`)
    }

    // ---- 2. 开新对话（seed 摘要）----
    let newId = null
    try {
      const newSessionId = `session-${randomUUID()}`
      let setup = async () => {}
      let resolvedPreset = preset
      if (preset !== void 0) {
        try {
          resolvedPreset = (await ctx.agentPresets.resolve(preset)).id
          setup = async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, resolvedPreset) }
        } catch (error) {
          logErr(`preset resolve/mount setup failed for "${preset}": ${error?.message ?? error}; starting with default preset`)
          resolvedPreset = void 0
          setup = async () => {}
        }
      }
      const seed = summary === null ? void 0 : [{
        type: 'user/message',
        seq: 0,
        time: Date.now(),
        data: {
          content: [{ type: 'text', text: `${SUMMARY_PREAMBLE}\n\n${summary}` }],
          source: { kind: 'user' },
          role: 'user',
          id: `summary-${randomUUID()}`,
        },
        surfaceOp: 'append',
      }]
      await ctx.agents.create({
        sessionId: newSessionId,
        ...(seed === void 0 ? {} : { seed }),
        meta: {
          ...(cwd !== void 0 ? { cwd } : {}),
          ...(resolvedPreset !== void 0 ? { agentPreset: resolvedPreset } : {}),
        },
        agentOptions: {},
        setup,
      })
      newId = newSessionId
      parts.push(`new session ${newSessionId} started${summary === null ? '' : ' (with summary)'}`)
    } catch (error) {
      logErr(`new session failed: ${error?.message ?? error}`)
      parts.push(`new session FAILED (${error?.message ?? error})`)
    }

    // ---- 3. 归档老对话 ----
    try {
      if (ctx.workspaceRegistry && typeof ctx.workspaceRegistry.archiveSession === 'function') {
        await ctx.workspaceRegistry.archiveSession(oldId)
        parts.push(`archived ${oldId}`)
      } else {
        parts.push('archive skipped (workspaceRegistry service unavailable)')
      }
    } catch (error) {
      logErr(`archive failed for ${oldId}: ${error?.message ?? error}`)
      parts.push(`archive FAILED (${error?.message ?? error})`)
    }

    const ok = newId !== null
    log(`fresh-start ${oldId}: ${parts.join('; ')}`)
    return {
      kind: ok ? 'success' : 'error',
      text: parts.join('; '),
      ...(newId !== null ? { sessionId: newId } : {}),
    }
  }

  const handler = (invocation) => {
    const operation = executeFresh(invocation)
    active.add(operation)
    operation.then(() => active.delete(operation), () => active.delete(operation))
    return operation
  }

  ctx.effect(function* () {
    yield async () => {
      await Promise.allSettled([...active])
    }
    yield ctx.commands.register({
      name: 'fresh',
      description: 'Summarize this conversation, start a new one, and archive the old one',
      handler,
    })
    log('installed: /fresh command registered')
  }, 'dsh-fresh-start lifecycle')

  return () => {
    for (const dispose of disposers.splice(0).reverse()) {
      try { dispose() } catch (error) { logErr('dispose failed:', String(error?.message ?? error)) }
    }
    log('disposed')
  }
}
