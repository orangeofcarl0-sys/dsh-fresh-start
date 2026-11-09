// 真实 cordis 集成测试：可选服务必须经 ctx.get 读取。
//
// 背景（issue #1）：cordis 对未声明 inject 的服务属性访问会抛
//   cannot get property "compaction" without inject
// 因此 `ctx.compaction ?? serviceFor(...)` 的兜底永远不会执行。
// 本测试用真实 cordis + 服务桩加载插件，确保：
//   1. 直接访问 ctx.compaction 确实抛错；
//   2. 插件经 ctx.get('compaction') 读到全局引擎并完成 Compact-First。
import { Context, Service } from '@deepseek-ai/cordis'
import * as plugin from '../lib/index.js'

let failures = 0
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`)
  if (!cond) failures++
}

const root = new Context()
const registered = []
let compactCalls = 0
let created = null
let archived = []

// 用 Service 子类提供 compaction：服务由子 fiber 注册，root 上的直接属性访问
// 才会触发 cordis 的 inject 守卫（root.provide 会在 root 上留下属性）。
class Compaction extends Service {
  constructor(ctx) {
    super(ctx, 'compaction')
  }
  async compactNow() {
    compactCalls++
    return { shadowedSeqs: [1, 2], shadowedRange: { start: 1, end: 2 }, summarySeq: 3 }
  }
}
await root.plugin(Compaction)

root.provide('commands', {
  register: (definition) => {
    registered.push(definition)
    return () => {}
  },
})
root.provide('agentPresets', {
  resolve: async (id) => ({ id: id ?? 'standard' }),
  mount: async () => {},
  serviceFor: () => void 0,
})
root.provide('agents', {
  create: async (options) => {
    created = options
    return { agent: { id: options.sessionId } }
  },
})
root.provide('workspaceRegistry', {
  archiveSession: async (id) => { archived.push(id) },
  resolveByPath: async () => ({ attachSession: async () => {} }),
})
root.provide('llm', {
  stream: () => (async function* () {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'SUMMARY FROM CORDIS' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'SUMMARY FROM CORDIS' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })(),
})

// 直接访问未 inject 的服务：cordis 应拒绝。
let directError
const probe = Object.assign((ctx) => {
  try { void ctx.compaction } catch (error) { directError = error }
}, { inject: [] })
await root.plugin(probe)
check('direct ctx.compaction throws without inject',
  typeof directError?.message === 'string' && directError.message.includes('without inject'),
  directError?.message)

await root.plugin(plugin)
check('plugin activates against real cordis', registered.length === 1, `registered=${registered.length}`)
check('command declares input hint', registered[0]?.input?.hint === 'preset (optional)')

const session = {
  id: 'session-old',
  header: { cwd: 'C:\\proj', agentPreset: 'standard' },
  events: [
    { type: 'request/context', seq: 0, time: 1, data: { provider: 'p', model: 'm', contextWindow: 4096 } },
  ],
  requestHeader: () => ({ config: { provider: 'p', model: 'm' } }),
  deriveMessages: () => [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
}
const result = await registered[0].handler({
  agent: { session, options: {} },
  signal: { aborted: false },
  commandId: 'cmd-cordis',
  rawInput: '',
})

check('fresh succeeds through real cordis', result.kind === 'success', `kind=${result.kind}`)
check('global compaction engine used via ctx.get', compactCalls === 1 && result.text.includes('compacted (shadowed 2 surface nodes)'),
  `calls=${compactCalls} text=${result.text?.slice(0, 120)}`)
check('new session created and old archived', created !== null && archived.includes('session-old'))

await root.fiber.dispose()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAIL`)
process.exit(failures === 0 ? 0 : 1)
