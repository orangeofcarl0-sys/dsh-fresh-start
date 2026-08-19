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
//     + requestHeader()（system），用一条简单指令让 LLM 总结，摘要作为
//     新对话的开场 user message。
//
// 关键实现点（dsh 0.1.0-rc.8 源码级）：
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
const SUMMARY_USER_PROMPT = 'Summarize the previous conversation, then continue the task from the established context.'

/** 判定 provider/model 目标是否完整（两者均为非空字符串）。 */
function hasProviderModel(target) {
  return typeof target?.provider === 'string' && target.provider.length > 0
    && typeof target?.model === 'string' && target.model.length > 0
}

/** 提取 dsh 上传的完整上下文，用一条简单指令让 LLM 总结。 */
async function summarizeContext(ctx, session, agent, signal) {
  const header = session.requestHeader()
  // 防御性拷贝：deriveMessages() 可能返回内部复用的数组，不能就地 push 污染会话上下文
  const messages = [...session.deriveMessages()]
  if (messages.length === 0) return null

  // 确定 provider/model：最近请求路由 > agent 选项。config 存在但缺 provider/model
  // 时视为无效（否则会以 undefined 字段调用 llm.stream，错误信息无从排查）
  const agentOptions = agent?.options
  const latest = hasProviderModel(header?.config) ? header.config : void 0
  const agentTarget = hasProviderModel(agentOptions)
    ? { provider: agentOptions.provider, model: agentOptions.model }
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
    // 不传 tools：总结不需要工具调用，传了反而可能让模型发起 tool call 导致无文本输出
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
  const active = new Set()

  async function executeFresh(invocation) {
    const agent = invocation.agent
    const session = agent.session
    const oldId = session.id
    // 前置读取也走结构化错误：session.header 形状异常时不应以裸 rejection 结束
    let cwd
    let preset
    try {
      cwd = session.header.cwd
      preset = resolveSessionPreset(session) ?? session.header.agentPreset
    } catch (error) {
      return { kind: 'error', text: `cannot read session header (${error?.message ?? error})` }
    }

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
    if (invocation.signal.aborted) return { kind: 'error', text: 'fresh-start cancelled' }
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
      // seed 用一个「已完成的摘要轮」（turn/start → step/start → user/message →
      // assistant/message → step/end → turn/end）。必须是完整的对话轮：
      //  - 含 turn/start 才不会被 sessionBlank 判为 blank（blank 会话不进历史栏）
      //  - 含 assistant/message 才能让「completed turn」语义完整（否则 conversation
      //    渲染出一个只有用户消息、无助手回复的 completed turn，表现为历史载入异常）
      const seedTime = Date.now()
      const seed = summary === null ? void 0 : [
        { type: 'turn/start', seq: 0, time: seedTime, data: { turn: 1 } },
        { type: 'step/start', seq: 1, time: seedTime + 1, data: { turn: 1, step: 1 } },
        {
          type: 'user/message',
          seq: 2,
          time: seedTime + 2,
          data: {
            content: [{ type: 'text', text: SUMMARY_USER_PROMPT }],
            source: { kind: 'user' },
            role: 'user',
            id: `fresh-request-${randomUUID()}`,
          },
          surfaceOp: 'append',
        },
        {
          type: 'assistant/message',
          seq: 3,
          time: seedTime + 3,
          data: {
            turn: 1,
            step: 1,
            message: {
              role: 'assistant',
              content: [{ type: 'text', text: summary }],
              source: { kind: 'model', provider: 'dsh-fresh-start', model: 'summary' },
              id: `fresh-summary-${randomUUID()}`,
            },
          },
          surfaceOp: 'append',
        },
        { type: 'step/end', seq: 4, time: seedTime + 4, data: { turn: 1, step: 1 } },
        { type: 'turn/end', seq: 5, time: seedTime + 5, data: { turn: 1, reason: { kind: 'completed' } } },
      ]
      await ctx.agents.create({
        sessionId: newSessionId,
        ...(seed === void 0 ? {} : { seed }),
        meta: {
          ...(cwd !== void 0 ? { cwd } : {}),
          ...(resolvedPreset !== void 0 ? { agentPreset: resolvedPreset } : {}),
          // 标记来源会话：client 插件据此在归档老会话后自动跳转到新会话
          parentSession: oldId,
        },
        agentOptions: {},
        setup,
      })
      newId = newSessionId
      // 归属到 workspace：host 侧 agents.create 不像 client 的 sessions.create RPC
      // 那样自动 attachSession，不归属会导致侧栏（按 workspace 分组）找不到新会话。
      if (cwd !== void 0 && ctx.workspaceRegistry && typeof ctx.workspaceRegistry.resolveByPath === 'function') {
        try {
          const ws = await ctx.workspaceRegistry.resolveByPath(cwd)
          if (ws !== void 0 && typeof ws.attachSession === 'function') {
            await ws.attachSession(newSessionId)
          }
        } catch (error) {
          logErr(`workspace attach failed for ${newSessionId}: ${error?.message ?? error}`)
        }
      }
      parts.push(`new session ${newSessionId} started${summary === null ? '' : ' (with summary)'}`)
    } catch (error) {
      logErr(`new session failed: ${error?.message ?? error}`)
      parts.push(`new session FAILED (${error?.message ?? error})`)
    }

    // ---- 3. 归档老对话 ----
    // 归档前再查一次取消：新会话已建好时取消可保住老会话（归档不易逆），故提前返回
    if (invocation.signal.aborted) {
      parts.push(newId === null
        ? 'cancelled'
        : `cancelled before archive (new session ${newId} started, old session still live)`)
      log(`fresh-start ${oldId}: ${parts.join('; ')}`)
      return { kind: 'error', text: parts.join('; ') }
    }
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
    log('disposed')
  }
}
