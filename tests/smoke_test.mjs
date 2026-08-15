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
  const recorded = { registered: [], created: [], archived: [], llmOptions: [] }
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
    workspaceRegistry: hasWorkspaces ? { archiveSession: async (id) => { recorded.archived.push(id) } } : void 0,
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
    logger: { warn: () => {} },
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
  check('new session seeded with summary', recorded.created.length === 1 && recorded.created[0].seed?.[0]?.data?.content?.[0]?.text?.includes('SUMMARY CONTENT'))
  check('seed has surfaceOp append', recorded.created[0].seed[0].surfaceOp === 'append')
  check('new session cwd+preset', recorded.created[0].meta.cwd === 'C:\\proj' && recorded.created[0].meta.agentPreset === 'code')
  check('old session archived', recorded.archived.includes('session-old'))
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

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAIL`)
process.exit(failures === 0 ? 0 : 1)
