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

/**
* Compact-First：总结前尝试用宿主压缩引擎收紧当前会话上下文。
*
* 依据 docs/COMPACT_FIRST_SPEC.md（CFS-001）：
*   - standard/code/cordis preset 挂载了 compaction 服务（serviceFor 可解析），
*     compactNow 强制压缩后 deriveMessages() 因 surface replaceGeneration 递增
*     自动变小，后续对话式总结的请求体显著缩小，且摘要复用了压缩摘要；
*   - minimal preset 无 compaction 服务；agent busy（turn 进行中）、会话过小
*     无可用范围、或引擎抛错时，全部安静降级为纯对话式总结（v1.2.8 行为）。
*
* 永不抛出：所有失败转为 { ok:false, note }，由调用方拼入返回文本。
* @param ctx - 插件根 context。
* @param agent - 当前 agent（session 将被压缩）。
* @param signal - fresh 命令的取消信号，透传给 compactNow。
* @param commandId - fresh 命令 id，作为压缩审计的 sourceCommandId。
* @returns { ok, note }：ok=true 且 note 描述 shadow 节点数；ok=false 且 note 为
*   原因短语（引擎缺失/无范围/失败消息）。
*/
async function tryCompact(ctx, agent, signal, commandId) {
  let engine
  try {
    engine = ctx.agentPresets?.serviceFor(agent, 'compaction')
  } catch (error) {
    return { ok: false, note: `compaction engine lookup failed (${error?.message ?? error})` }
  }
  if (!engine || typeof engine.compactNow !== 'function') {
    return { ok: false, note: 'no compaction engine (preset lacks the compaction service)' }
  }
  try {
    const result = await engine.compactNow(agent, signal, commandId)
    if (result === null) return { ok: false, note: 'compaction skipped (no compactable range)' }
    const count = result.shadowedSeqs?.length ?? (result.shadowedRange !== void 0
      ? result.shadowedRange.end - result.shadowedRange.start + 1
      : '?')
    return { ok: true, note: `compacted (shadowed ${count} surface nodes)` }
  } catch (error) {
    return { ok: false, note: `compaction skipped (${error?.message ?? error})` }
  }
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

    // /fresh [preset]：可选的 target preset 覆盖继承值（例如 /fresh standard 从
    // 极简模式直接开一个 standard 新会话）。未指定时保持旧行为（继承当前会话）。
    // 指定了但不存在/不可用时直接报错，而不是静默回退到继承值——用户显式点名
    // 一个 preset 时，悄悄给别的 preset 会违背意图。
    const rawArgs = typeof invocation.rawInput === 'string' ? invocation.rawInput.trim() : ''
    let requestedPreset = null
    if (rawArgs !== '') {
      let token = rawArgs.split(/\s+/)[0]
      // 四大内置模式的友好别名：PTC 模式 = code，创造/创建模式 = cordis
      // （其余 standard / minimal 直接以 preset id 使用）。
      const PRESET_ALIASES = {
        ptc: 'code',
        create: 'cordis',
        creator: 'cordis',
      }
      if (Object.prototype.hasOwnProperty.call(PRESET_ALIASES, token)) token = PRESET_ALIASES[token]
      try {
        const resolved = await ctx.agentPresets.resolve(token)
        requestedPreset = resolved.id
      } catch (error) {
        return { kind: 'error', text: `cannot use preset "${token}": ${error?.message ?? error} (usage: /fresh [preset])` }
      }
    }
    if (requestedPreset !== null) preset = requestedPreset

    const parts = []

    // ---- 0. Compact-First：总结前先用宿主压缩引擎收紧上下文（CFS-001）----
    // 引擎可用（standard/code/cordis preset）→ 强制 compactNow，成功后
    // deriveMessages() 自动变小，后续总结请求体显著缩小；引擎不可用
    // （minimal）、busy、无可用范围或抛错 → 安静降级为纯对话式总结。
    const compaction = await tryCompact(ctx, agent, invocation.signal, invocation.commandId)
    parts.push(compaction.note)

    // ---- 1. 总结（直接提取 dsh 上传的上下文；若已压缩则为收紧后的上下文）----
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
      // seed 的事件序列从三个 permission knob 事件开始（与 dsh 原生会话创建时的
      // 头部一致）：permission/preset + sandbox/mode + approval/policy。这是
      // permission-presets 的 pinInitialPermission 在 seeded 会话下回填缺失 knob 的
      // 依据——若 seed 里没有 sandbox/mode，seeded 分支会读 ctx.shell.sandboxMode
      // 回填；非沙箱 shell（如 unconfined-bash hack 下的 dsh-bash-local）不报告
      // sandboxMode，导致 setSandboxMode(session, undefined) 追加一个非 JSON 可序列化
      // 事件（session event "sandbox/mode" carries non-JSON-serializable data），
      // agents.create 直接失败。预置为已存在的有效值可让 seeded 分支跳过回填。
      // 然后是「已完成的摘要轮」（turn/start → step/start → user/message →
      // assistant/message → step/end → turn/end）。必须是完整的对话轮：
      //  - 含 turn/start 才不会被 sessionBlank 判为 blank（blank 会话不进历史栏）
      //  - 含 assistant/message 才能让「completed turn」语义完整（否则 conversation
      //    渲染出一个只有用户消息、无助手回复的 completed turn，表现为历史载入异常）
      const seedTime = Date.now()
      const seed = summary === null ? void 0 : [
        { type: 'permission/preset', seq: 0, time: seedTime - 3, data: { preset: 'workspace-write' } },
        { type: 'sandbox/mode', seq: 1, time: seedTime - 2, data: { mode: 'workspace-write' } },
        { type: 'approval/policy', seq: 2, time: seedTime - 1, data: { policy: 'ask' } },
        { type: 'turn/start', seq: 3, time: seedTime, data: { turn: 1 } },
        { type: 'step/start', seq: 4, time: seedTime + 1, data: { turn: 1, step: 1 } },
        {
          type: 'user/message',
          seq: 5,
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
          seq: 6,
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
        { type: 'step/end', seq: 7, time: seedTime + 4, data: { turn: 1, step: 1 } },
        { type: 'turn/end', seq: 8, time: seedTime + 5, data: { turn: 1, reason: { kind: 'completed' } } },
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
      description: 'Summarize this conversation, start a new one, and archive the old one (optional: /fresh <preset> to start the new session on a different agent preset; aliases: ptc=code, create/creator=cordis)',
      handler,
    })
    log('installed: /fresh command registered')
  }, 'dsh-fresh-start lifecycle')

  return () => {
    log('disposed')
  }
}
