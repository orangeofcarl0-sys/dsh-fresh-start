// dsh-fresh-start mock 测试：/fresh 命令（直接总结上下文 → 新对话带摘要 → 归档）
let failures = 0
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`)
  if (!cond) failures++
}

const plugin = await import('../lib/index.js')

// mock llm.stream：产出 block-start/text-delta/block-end/finish
function makeStream(text, { fail = false } = {}) {
  return (async function* () {
    if (fail) throw new Error('llm boom')
    if (text) {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })()
}

function makeCtx({
  summaryText = 'SUMMARY CONTENT', summaryFail = false, hasMessages = true,
  hasWorkspaces = true, createError = null,
} = {}) {
  const recorded = { registered: [], created: [], archived: [], llmOptions: [], resolveByPath: [], attached: [] }
  const ctx = {
    agentPresets: {
      serviceFor: () => void 0,
      resolve: async (id) => ({ id: id ?? 'default' }),
      mount: async () => {},
    },
    agents: {
      create: async (options) => {
        if (createError) throw createError
        recorded.created.push(options)
        return { agent: { id: options.sessionId } }
      },
    },
    commands: {
      register: (def) => { recorded.registered.push(def); return () => {} },
    },
    workspaceRegistry: hasWorkspaces ? {
      archiveSession: async (id) => { recorded.archived.push(id) },
      resolveByPath: async (path) => {
        recorded.resolveByPath.push(path)
        return { attachSession: async (id) => { recorded.attached.push(id) } }
      },
    } : void 0,
    llm: {
      // 真实 ctx.llm.stream 返回 AsyncIterable（非 Promise）
      stream: (options) => {
        recorded.llmOptions.push(options)
        if (summaryFail) {
          return (async function* () { throw new Error('llm boom') })()
        }
        return makeStream(summaryText)
      },
    },
    effect: (gen) => { const it = gen(); const step = (r) => { const { value, done } = it.next(r); if (!done) step(typeof value === 'function' ? void 0 : value) }; step() },
  }
  return { ctx, recorded }
}

function makeInvocation() {
  const signal = { aborted: false, addEventListener: () => {}, removeEventListener: () => {}, throwIfAborted: () => {} }
  return {
    agent: {
      options: { provider: 'p', model: 'm' },
      session: {
        id: 'session-old',
        header: { cwd: 'C:\\proj', agentPreset: 'code' },
        events: [],
        requestHeader: () => ({ config: { provider: 'p', model: 'm' }, system: 'sys', tools: [] }),
        deriveMessages: () => [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      },
    },
    signal,
    commandId: 'cmd-1',
    rawInput: '',
  }
}

// 用例 1：全流程（总结成功 → 新会话带 seed → 归档）
{
  const { ctx, recorded } = makeCtx({ summaryText: 'SUMMARY CONTENT' })
  plugin.apply(ctx)
  const def = recorded.registered[0]
  check('command registered name fresh', def?.name === 'fresh')
  const result = await def.handler(makeInvocation())
  check('full flow success', result.kind === 'success', `kind=${result.kind}`)
  check('llm.stream called', recorded.llmOptions.length === 1)
  check('llm messages include instruction', recorded.llmOptions[0].messages.at(-1).content[0].text.includes('Summarize'))
  check('new session seeded with summary', recorded.created.length === 1 && recorded.created[0].seed?.[3]?.data?.message?.content?.[0]?.text?.includes('SUMMARY CONTENT'))
  check('seed has full turn (non-blank)', recorded.created[0].seed?.[0]?.type === 'turn/start' && recorded.created[0].seed?.[5]?.type === 'turn/end')
  check('seed assistant message has surfaceOp append', recorded.created[0].seed?.[3]?.surfaceOp === 'append')
  check('new session cwd+preset', recorded.created[0].meta.cwd === 'C:\\proj' && recorded.created[0].meta.agentPreset === 'code')
  check('new session marked parentSession', recorded.created[0].meta.parentSession === 'session-old')
  check('old session archived', recorded.archived.includes('session-old'))
  check('new session attached to workspace', recorded.attached.includes(recorded.created[0].sessionId), `attached=${JSON.stringify(recorded.attached)}`)
  check('result carries new sessionId', typeof result.sessionId === 'string')
}

// 用例 2：空上下文（无消息）→ 无摘要，新会话无 seed
{
  const { ctx, recorded } = makeCtx({})
  plugin.apply(ctx)
  const def = recorded.registered[0]
  const inv = makeInvocation()
  inv.agent.session.deriveMessages = () => []
  const result = await def.handler(inv)
  check('empty context: success', result.kind === 'success')
  check('empty context: new session no seed', recorded.created[0] && recorded.created[0].seed === void 0)
  check('empty context: archive happened', recorded.archived.includes('session-old'))
}

// 用例 3：总结失败 → 新会话无 seed + 归档
{
  const { ctx, recorded } = makeCtx({ summaryFail: true })
  plugin.apply(ctx)
  const def = recorded.registered[0]
  const result = await def.handler(makeInvocation())
  check('summary fail: still success', result.kind === 'success')
  check('summary fail: reported', result.text.includes('summarization failed'))
  check('summary fail: new session no seed', recorded.created[0] && recorded.created[0].seed === void 0)
  check('summary fail: archive happened', recorded.archived.includes('session-old'))
}

// 用例 4：新会话创建失败 → error 但归档仍执行
{
  const { ctx, recorded } = makeCtx({ createError: new Error('create boom') })
  plugin.apply(ctx)
  const def = recorded.registered[0]
  const result = await def.handler(makeInvocation())
  check('create failure: error', result.kind === 'error')
  check('create failure: archive still happened', recorded.archived.includes('session-old'))
}

// 用例 5：无 workspaceRegistry → 归档跳过但成功
{
  const { ctx, recorded } = makeCtx({ hasWorkspaces: false })
  plugin.apply(ctx)
  const def = recorded.registered[0]
  const result = await def.handler(makeInvocation())
  check('no workspaceRegistry: success', result.kind === 'success')
  check('no workspaceRegistry: archive skipped reported', result.text.includes('archive skipped'))
}

// 用例 6：不就地污染 deriveMessages() 的返回数组（可能为内部复用数组）
{
  const { ctx, recorded } = makeCtx({})
  plugin.apply(ctx)
  const def = recorded.registered[0]
  const inv = makeInvocation()
  const shared = [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }]
  inv.agent.session.deriveMessages = () => shared
  await def.handler(inv)
  check('deriveMessages result not mutated', shared.length === 1, `length=${shared.length}`)
}

// 用例 7：header.config 存在但缺 model → 回退到 agent 选项的 provider/model
{
  const { ctx, recorded } = makeCtx({})
  plugin.apply(ctx)
  const def = recorded.registered[0]
  const inv = makeInvocation()
  inv.agent.session.requestHeader = () => ({ config: { provider: 'from-config', model: '' } })
  await def.handler(inv)
  check('incomplete config falls back to agent options',
    recorded.llmOptions[0]?.provider === 'p' && recorded.llmOptions[0]?.model === 'm',
    `got ${recorded.llmOptions[0]?.provider}/${recorded.llmOptions[0]?.model}`)
}

// 用例 8：config 与 agent 选项都无完整 provider/model → 总结降级但新会话+归档照常
{
  const { ctx, recorded } = makeCtx({})
  plugin.apply(ctx)
  const def = recorded.registered[0]
  const inv = makeInvocation()
  inv.agent.session.requestHeader = () => ({})
  inv.agent.options = {}
  const result = await def.handler(inv)
  check('no provider/model: summarization failed reported', result.text.includes('summarization failed'))
  check('no provider/model: still creates and archives',
    recorded.created.length === 1 && recorded.archived.includes('session-old'))
}

// 用例 9：signal 已取消 → 总结后中止，不创建不归档
{
  const { ctx, recorded } = makeCtx({})
  plugin.apply(ctx)
  const def = recorded.registered[0]
  const inv = makeInvocation()
  inv.signal.aborted = true
  const result = await def.handler(inv)
  check('aborted: cancelled error', result.kind === 'error' && result.text === 'fresh-start cancelled')
  check('aborted: no create no archive', recorded.created.length === 0 && recorded.archived.length === 0)
}

// 用例 10：session.header 异常 → 结构化错误返回（不产生裸 rejection）
{
  const { ctx, recorded } = makeCtx({})
  plugin.apply(ctx)
  const def = recorded.registered[0]
  const inv = makeInvocation()
  inv.agent.session.header = void 0
  const result = await def.handler(inv)
  check('malformed header: structured error',
    result?.kind === 'error' && result.text.includes('cannot read session header'), `kind=${result?.kind}`)
  check('malformed header: nothing done', recorded.created.length === 0 && recorded.archived.length === 0)
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAIL`)
process.exit(failures === 0 ? 0 : 1)
