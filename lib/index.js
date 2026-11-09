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
// 关键实现点（dsh 0.1.7-rc.1 源码级核对；1.3.0 适配、1.5.0 复核）：
//   - compaction 是全局可选服务（builtin /compact 即 inject ['compaction']），
//     实现位于 dsh-compaction-basic：ctx.compaction.compactNow(agent, signal, commandId)，
//     返回 { shadowedSeqs, shadowedTokenCount, summarySeq } 或 null。本插件**不**把
//     compaction 写进 inject（无该服务的 profile 会一直 pending），而是用
//     ctx.get('compaction') 读取；读取失败/缺失时回退
//     agentPresets.serviceFor(agent,'compaction')（rc.2 形态），再缺失则跳过压缩。
//     不能直接写 ctx.compaction：cordis 对未 inject 的服务属性会抛
//     "cannot get property ... without inject"，?? 后面的兜底不会执行。
//   - agentPresets 服务：0.1.7 起由 dsh-agent-preset-registry 提供（原
//     dsh-agent-presets 拆分），服务名与方法（resolve/mount/serviceFor）不变。
//   - 会话当前 preset：以 agent-preset/selected 事件记录挂载变更
//     （data.agentPreset），投影初始态取 header.agentPreset；本插件等价内联实现
//     （原 resolveSessionPreset 已于 0.1.2-alpha.5 删除）。
//   - 命令须在 root ctx 用 ctx.commands.register 注册才进入全局命令列表。
//   - 命令声明 input.hint：dsh 客户端只对声明了 input 的命令保留参数；没有声明时
//     菜单选择会丢掉 "/fresh <preset>" 后面的参数并直接执行裸 /fresh。
//
// 流程（各阶段独立降级；归档是不可逆步骤，只在摘要与新会话都成功后执行）：
//   1. 压缩：ctx.get('compaction') ?? serviceFor → compactNow（失败可降级）
//   2. 总结：requestHeader() + deriveMessages() → ctx.llm.stream
//      失败或空上下文时直接返回 error，不创建、不归档
//   3. 开新对话：ctx.agents.create({ sessionId, seed:[摘要], meta:{cwd, agentPreset}, setup })
//      创建失败时返回 error，不归档
//   4. 归档：ctx.workspaceRegistry.archiveSession(oldId)

import { randomUUID } from 'node:crypto'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'

export const name = 'dsh-fresh-start'
export const inject = ['commands', 'agentPresets', 'agents', 'workspaceRegistry', 'llm']

const TAG = '[fresh-start]'
const log = (...args) => console.log(TAG, ...args)
const logErr = (...args) => console.error(TAG, ...args)

const SUMMARY_INSTRUCTION = 'Summarize the conversation above in concise natural language. Preserve exact file paths, commands, error strings, identifiers, and any pending work or user feedback. Output only the summary text, no preamble or tools.'
const SUMMARY_USER_PROMPT = 'Summarize the previous conversation, then continue the task from the established context.'

// preset 友好别名（模块级常量）。alpha.5：内置 preset 为 standard/minimal/ptc/cordis，
// code 更名 ptc 且不留别名——code 作旧输入兼容 → ptc；create/creator = 创造模式 →
// cordis；其余直接以 preset id 使用。
const PRESET_ALIASES = {
  code: 'ptc',
  create: 'cordis',
  creator: 'cordis',
}

/** 判定 provider/model 目标是否完整（两者均为非空字符串）。 */
function hasProviderModel(target) {
  return typeof target?.provider === 'string' && target.provider.length > 0
    && typeof target?.model === 'string' && target.model.length > 0
}

/**
 * 会话当前的 agent preset（alpha.5 适配：resolveSessionPreset 已删除，语义内联）。
 * 宿主以 agent-preset/selected 事件记录挂载变更（事件 data.agentPreset），
 * 投影初始态取 header.agentPreset；等价实现 = 倒序取最后一次选择，无事件回退 header。
 */
function sessionPresetId(session) {
  const events = session?.events
  if (Array.isArray(events)) {
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i]
      if (event?.type === 'agent-preset/selected' && typeof event.data?.agentPreset === 'string') {
        return event.data.agentPreset
      }
    }
  }
  return session?.header?.agentPreset
}

/**
 * 解析 /fresh 的可选 preset 参数（如 /fresh standard）。
 *
 * 未指定时返回 null（保持旧行为：继承当前会话）。指定了但不存在/不可用时返回
 * errorText 而不是静默回退到继承值——用户显式点名一个 preset 时，悄悄给别的
 * preset 会违背意图。
 *
 * @returns null 未指定；{ id } 命中（别名已映射）；{ errorText } 显式点名失败。
 */
async function parsePresetArg(ctx, rawArgs) {
  const token = (typeof rawArgs === 'string' ? rawArgs.trim() : '').split(/\s+/)[0]
  if (token === '') return null
  const aliased = Object.prototype.hasOwnProperty.call(PRESET_ALIASES, token) ? PRESET_ALIASES[token] : token
  try {
    return { id: (await ctx.agentPresets.resolve(aliased)).id }
  } catch (error) {
    return { errorText: `cannot use preset "${token}": ${error?.message ?? error} (usage: /fresh [preset])` }
  }
}

/**
 * Compact-First：总结前尝试用宿主压缩引擎收紧当前会话上下文。
 *
 * 依据 docs/COMPACT_FIRST_SPEC.md（CFS-001）：
 *   - alpha.5 提供 全局 compaction seam（/compact 同款，compactNow(agent,…)）；
 *     rc.2 形态为 per-preset serviceFor(agent,'compaction')，作为兜底保留。
 *     compactNow 强制压缩后 deriveMessages() 因 surface replaceGeneration 递增
 *     自动变小，后续对话式总结的请求体显著缩小，且摘要复用了压缩摘要；
 *   - minimal preset 无 compaction 服务；agent busy（turn 进行中）、会话过小
 *     无可用范围、或引擎抛错时，全部安静降级为纯对话式总结（v1.2.8 行为）。
 *
 * 永不抛出：所有失败转为原因短语，由调用方拼入返回文本。
 * @param ctx - 插件根 context。
 * @param agent - 当前 agent（session 将被压缩）。
 * @param signal - fresh 命令的取消信号，透传给 compactNow。
 * @param commandId - fresh 命令 id，作为压缩审计的 sourceCommandId。
 * @returns 结果 note 文本（shadow 节点数或降级原因短语）。
 */
async function tryCompact(ctx, agent, signal, commandId) {
  let engine
  // compaction 是可选服务：不写进 inject（否则没有压缩引擎的 profile 会一直 pending），
  // 也不能直接读 ctx.compaction（cordis 对未注入服务抛 "without inject"）。
  // ctx.get() 是无 inject 读取入口；优先全局服务，缺失/不可读时回退 per-preset
  // serviceFor（rc.2 形态）。
  try {
    if (typeof ctx.get === 'function') {
      const globalEngine = ctx.get('compaction')
      if (globalEngine && typeof globalEngine.compactNow === 'function') engine = globalEngine
    }
  } catch {
    // 全局服务不可读：继续尝试 serviceFor 兜底
  }
  if (engine === void 0) {
    try {
      engine = ctx.agentPresets?.serviceFor?.(agent, 'compaction')
    } catch (error) {
      return `compaction engine lookup failed (${error?.message ?? error})`
    }
  }
  if (!engine || typeof engine.compactNow !== 'function') {
    return 'no compaction engine (preset lacks the compaction service)'
  }
  try {
    const result = await engine.compactNow(agent, signal, commandId)
    if (result === null) return 'compaction skipped (no compactable range)'
    const count = result.shadowedSeqs?.length ?? (result.shadowedRange !== void 0
      ? result.shadowedRange.end - result.shadowedRange.start + 1
      : '?')
    return `compacted (shadowed ${count} surface nodes)`
  } catch (error) {
    return `compaction skipped (${error?.message ?? error})`
  }
}

/** 取会话最后一条 request/context（模型路由元数据），用于 seed 继承。 */
function sessionRequestContext(session) {
  const events = session?.events
  if (!Array.isArray(events)) return void 0
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event?.type === 'request/context' && typeof event.data === 'object' && event.data !== null) {
      return event.data
    }
  }
  return void 0
}

/** 解析总结请求的 provider/model：最近请求路由 > agent 选项。 */
function resolveRoute(header, agent) {
  const agentOptions = agent?.options
  const latest = hasProviderModel(header?.config) ? header.config : void 0
  const agentTarget = hasProviderModel(agentOptions)
    ? { provider: agentOptions.provider, model: agentOptions.model }
    : void 0
  return latest ?? agentTarget
}

/** 提取 dsh 上传的完整上下文，用一条简单指令让 LLM 总结。 */
async function summarizeContext(ctx, session, agent, signal) {
  const header = session.requestHeader()
  // 防御性拷贝：deriveMessages() 可能返回内部复用的数组，不能就地 push 污染会话上下文
  const messages = [...session.deriveMessages()]
  if (messages.length === 0) return null

  // 确定 provider/model：最近请求路由 > agent 选项。config 存在但缺 provider/model
  // 时视为无效（否则会以 undefined 字段调用 llm.stream，错误信息无从排查）
  const target = resolveRoute(header, agent)
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
  return { text, route: { provider: target.provider, model: target.model } }
}

/**
 * 构造新会话的 seed 事件序列：「已完成的摘要轮」。
 *
 * 前置三个 permission knob 事件（与 dsh 原生会话创建时的头部一致）：
 * permission/preset + sandbox/mode + approval/policy，取值
 * workspace-write/workspace-write/ask。这是 permission-presets 的
 * pinInitialPermission 在 seeded 会话下回填缺失 knob 的依据——若 seed 里没有
 * sandbox/mode，seeded 分支会读 ctx.shell.sandboxMode 回填；非沙箱 shell（如
 * unconfined-bash hack 下的 dsh-bash-local）不报告 sandboxMode，导致
 * setSandboxMode(session, undefined) 追加一个非 JSON 可序列化事件（session event
 * "sandbox/mode" carries non-JSON-serializable data），agents.create 直接失败。
 * 预置为已存在的有效值可让 seeded 分支跳过回填。
 *
 * 然后是「已完成的摘要轮」（turn/start → step/start → user/message →
 * request/header → request/context → assistant/message → step/end → turn/end）。
 * 必须是完整的对话轮：
 *  - 含 turn/start 才不会被 sessionBlank 判为 blank（blank 会话不进历史栏）
 *  - 含 request/header + request/context 才能让历史恢复重建该轮请求；
 *    0.2.2 缺少它们会导致 "历史加载失败：Maximum call stack size exceeded"
 *    或一直停在「载入历史」。request/context 直接继承旧会话的最后一条，
 *    保留 provider/model/contextWindow/systemPromptUpdate。
 *  - 含 assistant/message 才能让「completed turn」语义完整（否则 conversation
 *    渲染出一个只有用户消息、无助手回复的 completed turn，表现为历史载入异常）
 *  - request/header 的 config 使用旧会话真实的 provider/model，新会话才能
 *    继承模型选择，而不是显示「请选择模型」
 *
 * seq 连续递增、time 单调递增（knob 事件略早于轮次），由计数器统一生成。
 */
function buildSeedEvents(summary, route, routeContext) {
  let seq = 0
  const base = Date.now() - 3
  const event = (type, data, extra = {}) => {
    const s = seq++
    return { type, seq: s, time: base + s, ...extra, data }
  }
  return [
    event('permission/preset', { preset: 'workspace-write' }),
    event('sandbox/mode', { mode: 'workspace-write' }),
    event('approval/policy', { policy: 'ask' }),
    event('turn/start', { turn: 1 }),
    event('step/start', { turn: 1, step: 1 }),
    event('user/message', {
      content: [{ type: 'text', text: SUMMARY_USER_PROMPT }],
      source: { kind: 'user' },
      role: 'user',
      id: `fresh-request-${randomUUID()}`,
    }, { surfaceOp: 'append' }),
    // 正常会话的每个 step 都有一条 request/header；缺失时历史恢复/渲染可能
    // 无法重建该轮请求（0.2.2 实测会出现 gateway/internal 栈溢出）。
    // 这是 log-only 事件，不进入模型可见消息；config 沿用旧会话的真实路由。
    event('request/header', {
      header: { config: { provider: route.provider, model: route.model } },
      reason: 'initial',
    }),
    // request/context 是模型路由元数据；历史恢复会用它重建该轮请求。
    // 直接继承旧会话的最后一条，避免缺少 contextWindow 时卡在「载入历史」。
    event('request/context', {
      provider: routeContext?.provider ?? route.provider,
      model: routeContext?.model ?? route.model,
      ...(routeContext?.contextWindow === void 0 ? {} : { contextWindow: routeContext.contextWindow }),
      ...(routeContext?.systemPromptUpdate === void 0 ? {} : { systemPromptUpdate: routeContext.systemPromptUpdate }),
    }),
    event('assistant/message', {
      turn: 1,
      step: 1,
      // dsh 0.2.2-rc.1 的 seed 校验要求 assistant/message 带 stream 数组
      // （assertAssistantSettlementShape）；空数组表示没有可回放的流式块。
      stream: [],
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: summary }],
        source: { kind: 'model', provider: 'dsh-fresh-start', model: 'summary' },
        id: `fresh-summary-${randomUUID()}`,
      },
    }, { surfaceOp: 'append' }),
    event('step/end', { turn: 1, step: 1 }),
    event('turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]
}

/**
 * 归属新会话到 workspace。host 侧 agents.create 不像 client 的 sessions.create RPC
 * 那样自动 attachSession，不归属会导致侧栏（按 workspace 分组）找不到新会话。
 * 全部失败吞掉（不影响 /fresh 主流程）。
 */
async function attachToWorkspace(ctx, cwd, sessionId) {
  if (cwd === void 0 || !ctx.workspaceRegistry || typeof ctx.workspaceRegistry.resolveByPath !== 'function') return
  try {
    const ws = await ctx.workspaceRegistry.resolveByPath(cwd)
    if (ws !== void 0 && typeof ws.attachSession === 'function') {
      await ws.attachSession(sessionId)
    }
  } catch (error) {
    logErr(`workspace attach failed for ${sessionId}: ${error?.message ?? error}`)
  }
}

/**
 * 创建带摘要 seed 的新会话并归属到 workspace。
 *
 * preset 可用时先 resolve 再经 setup 挂载；resolve/mount 失败降级为默认 preset
 * （保持 v1.2.8 行为）。@returns 新会话 id。
 */
async function createSeededSession(ctx, { cwd, preset, parentSession, summary, summaryRoute, routeContext }) {
  const newSessionId = `session-${randomUUID()}`
  let resolvedPreset
  let setup = async () => {}
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
  const seed = summary === null ? void 0 : buildSeedEvents(summary, summaryRoute, routeContext)
  await ctx.agents.create({
    sessionId: newSessionId,
    ...(seed === void 0 ? {} : { seed }),
    meta: {
      ...(cwd !== void 0 ? { cwd } : {}),
      ...(resolvedPreset !== void 0 ? { agentPreset: resolvedPreset } : {}),
      // 标记来源会话：client 插件据此在归档老会话后自动跳转到新会话
      parentSession,
    },
    agentOptions: {},
    setup,
  })
  await attachToWorkspace(ctx, cwd, newSessionId)
  return newSessionId
}

export function apply(ctx) {
  const active = new Set()

  // 编排器：五阶段线性推进。压缩失败只降级；总结/创建失败终止，
  // 归档是不可逆步骤，只有在摘要成功且新会话创建成功后才执行。
  async function executeFresh(invocation) {
    const agent = invocation.agent
    const session = agent.session
    const oldId = session.id
    const parts = []

    // ---- 0. 读 header + 解析 /fresh [preset]（结构化报错：header 形状异常时不应以裸 rejection 结束）----
    let cwd
    let preset
    try {
      cwd = session.header.cwd
      preset = sessionPresetId(session)
    } catch (error) {
      return { kind: 'error', text: `cannot read session header (${error?.message ?? error})` }
    }
    const requested = await parsePresetArg(ctx, invocation.rawInput)
    if (requested?.errorText !== void 0) return { kind: 'error', text: requested.errorText }
    if (requested !== null) preset = requested.id
    const routeContext = sessionRequestContext(session)

    // ---- 1. Compact-First：先用宿主压缩引擎收紧上下文（CFS-001）----
    parts.push(await tryCompact(ctx, agent, invocation.signal, invocation.commandId))

    // ---- 2. 总结（直接提取 dsh 上传的上下文；若已压缩则为收紧后的上下文）----
    let summary = null
    let summaryRoute
    try {
      const result = await summarizeContext(ctx, session, agent, invocation.signal)
      if (result === null) {
        parts.push('nothing to summarize (empty context)')
      } else {
        summary = result.text
        summaryRoute = result.route
        parts.push(`summarized (${summary.length} chars)`)
      }
    } catch (error) {
      if (invocation.signal.aborted) return { kind: 'error', text: 'fresh-start cancelled' }
      parts.push(`summarization failed (${error?.message ?? error}); old session kept (not archived)`)
      log(`fresh-start ${oldId}: ${parts.join('; ')}`)
      return { kind: 'error', text: parts.join('; ') }
    }

    // 空上下文没有可继承的内容：不创建空会话，也不归档。
    // 归档是不可逆步骤，只有在摘要成功且新会话创建成功后才执行。
    if (summary === null) {
      if (invocation.signal.aborted) return { kind: 'error', text: 'fresh-start cancelled' }
      parts.push('no new session created')
      log(`fresh-start ${oldId}: ${parts.join('; ')}`)
      return { kind: 'error', text: parts.join('; ') }
    }

    // ---- 3. 开新对话（seed 摘要）----
    if (invocation.signal.aborted) return { kind: 'error', text: 'fresh-start cancelled' }
    // 历史恢复需要 request/context；旧会话没有该事件时不要制造一个可能
    // 无法重新加载的 seed 会话，直接保留旧会话。
    if (routeContext === void 0) {
      parts.push('cannot create seeded session (session log lacks request/context); old session kept (not archived)')
      log(`fresh-start ${oldId}: ${parts.join('; ')}`)
      return { kind: 'error', text: parts.join('; ') }
    }
    let newId
    try {
      newId = await createSeededSession(ctx, { cwd, preset, parentSession: oldId, summary, summaryRoute, routeContext })
      parts.push(`new session ${newId} started (with summary)`)
    } catch (error) {
      logErr(`new session failed: ${error?.message ?? error}`)
      parts.push(`new session FAILED (${error?.message ?? error}); old session kept (not archived)`)
      log(`fresh-start ${oldId}: ${parts.join('; ')}`)
      return { kind: 'error', text: parts.join('; ') }
    }

    // ---- 4. 归档老对话 ----
    // 归档前再查一次取消：新会话已建好时取消可保住老会话（归档不易逆），故提前返回
    if (invocation.signal.aborted) {
      parts.push(`cancelled before archive (new session ${newId} started, old session still live)`)
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

    log(`fresh-start ${oldId}: ${parts.join('; ')}`)
    return { kind: 'success', text: parts.join('; '), sessionId: newId }
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
      description: 'Summarize this conversation, start a new one, and archive the old one (optional: /fresh <preset> to start the new session on a different agent preset; aliases: code=ptc (legacy), create/creator=cordis)',
      // 声明 input 后，dsh 客户端会把 /fresh <preset> 作为带参数的 claim 提交；
      // 未声明时菜单选择会丢弃参数并直接执行裸 /fresh。
      input: { hint: 'preset (optional)' },
      handler,
    })
    log('installed: /fresh command registered')
  }, 'dsh-fresh-start lifecycle')

  return () => {
    log('disposed')
  }
}
