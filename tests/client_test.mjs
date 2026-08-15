// dsh-fresh-start client 插件测试：归档老会话后自动跳转到新会话（parentId 匹配）
import { readFileSync } from 'node:fs'
let failures = 0
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`)
  if (!cond) failures++
}

// 模拟浏览器 __ModuleLoader__，执行 client.js 顶层（window.__ModuleLoader__.load）
const factories = new Map()
globalThis.window = { __ModuleLoader__: { load: (handoff) => { factories.set(handoff.id, handoff.factory) } } }
const code = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
new Function(code)()
const factory = factories.get('dsh-fresh-start')
check('registered id dsh-fresh-start', factory !== void 0)
const plugin = factory(() => { throw new Error('require not used') })
check('factory returns apply+inject', typeof plugin.apply === 'function' && Array.isArray(plugin.inject))

// 极简 snapshot store（subscribe/getSnapshot）
function makeStore(initial) {
  let state = { ...initial }
  const listeners = new Set()
  return {
    getSnapshot: () => state,
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn) },
    _set: (patch) => { state = { ...state, ...patch }; for (const fn of [...listeners]) fn() },
  }
}

function makeCtx(initialWorkspace = {}, initialSessions = {}) {
  const opened = []
  const workspaces = makeStore({ archivedSessionIds: [], ...initialWorkspace })
  const sessions = makeStore({ ids: [], byId: {}, current: void 0, ...initialSessions })
  const ctx = {
    workspaces: { list: workspaces },
    sessions: { list: sessions, open: (id) => { opened.push(id) } },
  }
  return { ctx, opened, workspaces, sessions }
}

// 用例 1：归档老会话 → 跳转到 parentId 匹配的新会话
{
  const { ctx, opened, workspaces, sessions } = makeCtx(
    { archivedSessionIds: ['old-1'] },
    { ids: ['old-1', 'new-1'], byId: { 'old-1': { id: 'old-1' }, 'new-1': { id: 'new-1', parentId: 'old-1' } }, current: 'old-1' },
  )
  const dispose = plugin.apply(ctx)
  workspaces._set({ archivedSessionIds: ['old-1', 'old-2'] })
  check('no jump for unrelated archive', opened.length === 0, `opened=${JSON.stringify(opened)}`)
  sessions._set({ ids: ['old-1', 'new-1', 'new-2'], byId: { 'old-1': { id: 'old-1' }, 'new-1': { id: 'new-1', parentId: 'old-1' }, 'new-2': { id: 'new-2', parentId: 'old-3' } } })
  workspaces._set({ archivedSessionIds: ['old-1', 'old-2', 'old-3'] })
  check('jump to child of newly-archived parent', opened.includes('new-2'), `opened=${JSON.stringify(opened)}`)
  dispose()
}

// 用例 2：归档时新会话尚未同步 → pending 兜底补跳
{
  const { ctx, opened, workspaces, sessions } = makeCtx(
    { archivedSessionIds: [] },
    { ids: [], byId: {}, current: void 0 },
  )
  const dispose = plugin.apply(ctx)
  workspaces._set({ archivedSessionIds: ['old-a'] })
  check('not open yet (child missing)', opened.length === 0)
  sessions._set({ ids: ['old-a', 'new-a'], byId: { 'old-a': { id: 'old-a' }, 'new-a': { id: 'new-a', parentId: 'old-a' } } })
  check('pending sweep opens child', opened.includes('new-a'), `opened=${JSON.stringify(opened)}`)
  dispose()
}

// 用例 3：不相关归档不跳转
{
  const { ctx, opened, workspaces } = makeCtx(
    { archivedSessionIds: [] },
    { ids: ['a', 'b'], byId: { a: { id: 'a' }, b: { id: 'b', parentId: 'x' } } },
  )
  const dispose = plugin.apply(ctx)
  workspaces._set({ archivedSessionIds: ['unrelated'] })
  check('unrelated archive no jump', opened.length === 0)
  dispose()
}

// 用例 4：open 抛错不崩溃
{
  const { ctx, workspaces, sessions } = makeCtx(
    { archivedSessionIds: [] },
    { ids: [], byId: {} },
  )
  let openThrew = false
  ctx.sessions.open = () => { openThrew = true; throw new Error('boom') }
  const dispose = plugin.apply(ctx)
  workspaces._set({ archivedSessionIds: ['old-z'] })
  sessions._set({ ids: ['new-z'], byId: { 'new-z': { id: 'new-z', parentId: 'old-z' } } })
  check('open error swallowed', openThrew === true)
  dispose()
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAIL`)
process.exit(failures === 0 ? 0 : 1)
