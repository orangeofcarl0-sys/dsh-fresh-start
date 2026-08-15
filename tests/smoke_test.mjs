// dsh-fresh-start mock 测试：/fresh 命令全流程 + 降级
let failures = 0
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`)
  if (!cond) failures++
}

const plugin = await import('../lib/index.js')
const { ManualCompactionError } = await import('@deepseek-ai/dsh-compaction')

function makeCtx({ compactResult, compactError, hasWorkspaces = true, hasPresets = true, createError = null } = {}) {
  const recorded = { registered: [], created: [], archived: [] }
  const ctx = {
    get: (name) => {
      if (name === 'workspaces') return hasWorkspaces ? { archiveSession: async (id) => { recorded.archived.push(id) } } : void 0
      if (name === 'agentPresets') return hasPresets ? {
        resolve: async (id) => ({ id: id ?? 'default' }),
        mount: async () => {},
      } : void 0
      return void 0
    },
    compaction: {
      compactNow: async () => {
        if (compactError) throw compactError
        return compactResult
      },
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
    effect: (gen) => { const it = gen(); const step = (r) => { const { value, done } = it.next(r); if (!done) step(typeof value === 'function' ? void 0 : value) }; step() },
    logger: { warn: () => {} },
  }
  return { ctx, recorded }
}

function makeInvocation() {
  const signal = { aborted: false, addEventListener: () => {}, removeEventListener: () => {} }
  return {
    agent: { session: { id: 'session-old', header: { cwd: 'C:\\proj', agentPreset: 'code' }, events: [] } },
    signal,
    commandId: 'cmd-1',
    rawInput: '',
  }
}

// 用例 1：全流程（compact 成功 + 新对话 + 归档）
{
  const { ctx, recorded } = makeCtx({ compactResult: { shadowedSeqs: [1,2,3], shadowedTokenCount: 5000, summarySeq: 3 } })
  plugin.apply(ctx)
  const def = recorded.registered[0]
  check('command registered with name fresh', def?.name === 'fresh', `name=${def?.name}`)
  const result = await def.handler(makeInvocation())
  check('full flow returns success', result.kind === 'success', `kind=${result.kind}`)
  check('compact called + reported', result.text.includes('summarized 3 items'))
  check('new session created with cwd+preset', recorded.created.length === 1 && recorded.created[0].meta.cwd === 'C:\\proj' && recorded.created[0].meta.agentPreset === 'code')
  check('old session archived', recorded.archived.includes('session-old'))
  check('result carries new sessionId', typeof result.sessionId === 'string' && result.sessionId.startsWith('session-'))
}

// 用例 2：compact 返回 null（无可压缩历史）仍继续
{
  const { ctx, recorded } = makeCtx({ compactResult: null })
  plugin.apply(ctx)
  const def = recorded.registered[0]
  const result = await def.handler(makeInvocation())
  check('null compact: still success', result.kind === 'success')
  check('null compact: reported as nothing to summarize', result.text.includes('nothing to summarize'))
  check('null compact: new session + archive still happen', recorded.created.length === 1 && recorded.archived.includes('session-old'))
}

// 用例 3：compact busy 错误 → 降级继续
{
  const busy = new ManualCompactionError('busy', 'busy')
  const { ctx, recorded } = makeCtx({ compactError: busy })
  plugin.apply(ctx)
  const def = recorded.registered[0]
  const result = await def.handler(makeInvocation())
  check('busy: still success (new session + archive)', result.kind === 'success')
  check('busy: reported as skipped', result.text.includes('active compaction or agent not idle'))
  check('busy: archive still happened', recorded.archived.includes('session-old'))
}

// 用例 4：新会话创建失败 → 返回 error，但归档仍执行
{
  const { ctx, recorded } = makeCtx({ compactResult: null, createError: new Error('create boom') })
  plugin.apply(ctx)
  const def = recorded.registered[0]
  const result = await def.handler(makeInvocation())
  check('create failure: returns error', result.kind === 'error')
  check('create failure: archive still happened', recorded.archived.includes('session-old'))
}

// 用例 5：无 workspaces 服务 → 归档跳过但成功
{
  const { ctx, recorded } = makeCtx({ compactResult: null, hasWorkspaces: false })
  plugin.apply(ctx)
  const def = recorded.registered[0]
  const result = await def.handler(makeInvocation())
  check('no workspaces: still success', result.kind === 'success')
  check('no workspaces: archive reported skipped', result.text.includes('archive skipped'))
}

// 用例 6：无 agentPresets 服务 → preset 从 header 继承，新对话仍创建
{
  const { ctx, recorded } = makeCtx({ compactResult: null, hasPresets: false })
  plugin.apply(ctx)
  const def = recorded.registered[0]
  await def.handler(makeInvocation())
  check('no presets: new session inherits header preset', recorded.created[0] && recorded.created[0].meta.agentPreset === 'code', `agentPreset=${recorded.created[0]?.meta.agentPreset}`)
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAIL`)
process.exit(failures === 0 ? 0 : 1)
