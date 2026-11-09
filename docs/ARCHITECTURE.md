# 架构与实现

> 适用版本：dsh-fresh-start `1.8.1`，dsh `0.2.2-rc.1`。
> 本文描述内部实现与设计取舍；安装、使用与排障见 [README](../README.md)，版本兼容性见 [COMPATIBILITY.md](COMPATIBILITY.md)。

## 目录

- [1. 范围](#1-范围)
- [2. 运行时结构](#2-运行时结构)
- [3. Host 半边](#3-host-半边)
- [4. Seed 事件模型](#4-seed-事件模型)
- [5. Client 半边](#5-client-半边)
- [6. 跨端握手](#6-跨端握手)
- [7. 持久化与配置](#7-持久化与配置)
- [8. 运行时 API 契约](#8-运行时-api-契约)
- [9. 设计决策](#9-设计决策)
- [10. 测试映射](#10-测试映射)

## 1. 范围

`dsh-fresh-start` 由两个半边组成：

- **host 半边**（`lib/index.js`）：在 dsh 的 cordis 运行时中注册 `/fresh` 命令，负责解析、压缩、总结、创建新会话与归档老会话。
- **client 半边**（`lib/client.js`）：在 dsh Web 的浏览器运行时中监听归档事件，把视图自动切换到新会话。

两端不共享进程内状态，只通过会话数据中的 `parentSession` / `parentId` 关联。

## 2. 运行时结构

```text
┌─ dsh host（Node / cordis）──────────────────────────────────────┐
│                                                                 │
│  root ctx                                                       │
│   ├─ commands.register({ name: 'fresh', handler })              │
│   ├─ agentPresets   ← dsh-agent-preset-registry                 │
│   ├─ agents         ← dsh-agent                                 │
│   ├─ workspaceRegistry ← dsh-workspace                          │
│   ├─ compaction     ← dsh-compaction-basic（全局服务，可选）     │
│   └─ llm            ← dsh-llm                                   │
│                                                                 │
│  /fresh: parse → compact → summarize → create → archive         │
└───────────────────────────────┬─────────────────────────────────┘
                                │ agents.create({ meta.parentSession })
                                ▼
┌─ dsh Web（浏览器）───────────────────────────────────────────────┐
│                                                                 │
│  window.__ModuleLoader__.load({ id: 'dsh-fresh-start', … })     │
│   ├─ workspaces.list  → archivedSessionIds 变化                 │
│   ├─ sessions.list    → 按 parentId 查找子会话                  │
│   └─ uiWorkspace.openSession → 自动跳转                          │
└─────────────────────────────────────────────────────────────────┘
```

## 3. Host 半边

### 3.1 模块契约

```js
export const name = 'dsh-fresh-start'
export const inject = ['commands', 'agentPresets', 'agents', 'workspaceRegistry', 'llm']
export function apply(ctx) { … }
```

- `inject` 声明依赖的五个服务；宿主在服务就绪后才会激活插件。
- 命令注册额外声明 `input: { hint: 'preset (optional)' }`。dsh 客户端只对声明了 `input` 的命令保留 `/fresh <preset>` 后面的参数；未声明时菜单选择会丢弃参数并直接执行裸 `/fresh`。
- `apply` 通过 `ctx.effect` 注册命令与清理逻辑：

  ```js
  ctx.effect(function* () {
    yield async () => { await Promise.allSettled([...active]) }   // 清理：等待在途操作
    yield ctx.commands.register({ name: 'fresh', handler })      // 命令注册（返回 disposer）
    log('installed: /fresh command registered')
  }, 'dsh-fresh-start lifecycle')
  ```

- `active` 是一个 `Set<Promise>`，记录在途的 `/fresh` 操作。插件卸载时先等待它们结束，避免归档进行到一半时进程退出。
- `apply` 返回的清理函数只输出 `disposed` 日志；真正的资源释放由 `ctx.effect` 管理。

### 3.2 命令调用契约

`handler(invocation)` 只使用以下字段：

| 字段 | 类型 | 用途 |
|---|---|---|
| `invocation.agent` | Agent | 当前会话的 agent，提供 `session` 与 `options` |
| `invocation.signal` | AbortSignal | 取消信号，透传给压缩与 LLM 请求 |
| `invocation.commandId` | string | 作为压缩审计的 `sourceCommandId` |
| `invocation.rawInput` | string | `/fresh` 之后的原始参数 |

返回值：

```ts
{
  kind: 'success' | 'error',
  text: string,          // 各阶段结果短语以 "; " 拼接
  sessionId?: string,   // 仅创建成功时存在
}
```

`kind` 在创建成功并走到最后时为 `success`；总结或新会话创建失败会提前返回 `error`。归档失败不影响 `success`（新会话已经存在）。

### 3.3 阶段 0：读取 header 与解析参数

```js
cwd = session.header.cwd
preset = sessionPresetId(session)
```

`sessionPresetId` 的语义与宿主投影一致：

1. 倒序扫描 `session.events`，取最后一条 `agent-preset/selected` 且 `data.agentPreset` 为字符串的事件；
2. 没有该事件时回退到 `session.header.agentPreset`。

随后 `parsePresetArg(ctx, rawInput)`：

- 取 `rawInput` 按空白切分后的第一个 token；
- 空 token → 返回 `null`（继承当前 preset）；
- 命中别名表 `{ code: 'ptc', create: 'cordis', creator: 'cordis' }` 时先映射；
- 调用 `ctx.agentPresets.resolve(id)` 校验，成功返回 `{ id }`，失败返回 `{ errorText }`。

阶段 0 的任何异常都会直接返回 `{ kind: 'error' }`，不会进入后续阶段；显式指定了不存在的 preset 时同样不创建、不归档。

### 3.4 阶段 1：Compact-First

`tryCompact(ctx, agent, signal, commandId)` 的解析顺序：

```js
engine = ctx.get('compaction') ?? ctx.agentPresets?.serviceFor?.(agent, 'compaction')
```

- `compaction` 是可选服务，**不声明在 `inject` 中**。如果声明，没有压缩引擎的 profile 会一直停在 `pending`；因此用 `ctx.get('compaction')`（cordis 的无 inject 读取入口）按需读取。
- 不能直接写 `ctx.compaction`：cordis 对未注入的服务属性会抛 `cannot get property "compaction" without inject`，`??` 后面的 `serviceFor` 兜底不会执行。这正是 1.8.0 在真实宿主上 Compact-First 失效的原因。
- 全局服务不存在、无 `compactNow` 或读取失败时，回退到 per-preset 的 `serviceFor(agent, 'compaction')` 形态。

判定与执行（`compactNow` 调用实际包在 `try/catch` 中，异常转为 note）：

```js
if (!engine || typeof engine.compactNow !== 'function')
  return 'no compaction engine (preset lacks the compaction service)'

const result = await engine.compactNow(agent, signal, commandId)
if (result === null) return 'compaction skipped (no compactable range)'

const count = result.shadowedSeqs?.length
  ?? (result.shadowedRange !== undefined
      ? result.shadowedRange.end - result.shadowedRange.start + 1
      : '?')
return `compacted (shadowed ${count} surface nodes)`
```

`compactNow` 的异常会被捕获为 `compaction skipped (<message>)`；引擎查找异常返回 `compaction engine lookup failed (<message>)`。函数**永不抛出**，因此压缩不是任何后续阶段的失败源。

压缩成功后，`deriveMessages()` 因 surface `replaceGeneration` 递增而返回收紧后的消息，阶段 2 自动受益。

### 3.5 阶段 2：对话式总结

`summarizeContext(ctx, session, agent, signal)`：

1. `header = session.requestHeader()`；
2. `messages = [...session.deriveMessages()]`——必须做防御性拷贝，因为 `deriveMessages()` 可能返回内部复用数组；
3. 消息为空 → 返回 `null`（`nothing to summarize (empty context)`）；
4. 确定 provider/model：

   ```js
   target = resolveRoute(header, agent)   // 最近请求路由 > agent 选项
   ```

   两者都不完整时抛出 `no provider/model available for summarization`；
5. 追加一条 `createUserMessage`，内容为总结指令，`source.kind = 'plugin'`；
6. 调用 `ctx.llm.stream({ provider, model, messages, system?, maxTokens: 2000, sessionId, purpose: 'compaction', signal? })`；
   - 不传 `tools`：总结不需要工具调用，传了反而可能让模型只发起 tool call、没有文本输出；
   - `header.system` 存在时才传（dsh 0.1.5 起 canonical header 通常不含 `system`）；
7. 用 `BlockAssembler` 聚合流式块；`finish.kind` 为 `error` / `aborted` 时抛出带 `code` 的错误；
8. 拼接所有 `text` 块并 `trim()`；空文本抛出 `summarization produced no text`；成功时返回 `{ text, route }`，`route` 供 seed 继承。

阶段 2 的失败是**终止性的**：总结失败或上下文为空时，`executeFresh` 直接返回 `{ kind: 'error' }`，不会创建新会话，也不会归档老会话。只有摘要成功且旧会话有 `request/context` 时才进入阶段 3。

### 3.6 阶段 3：创建 seeded 新会话

```js
newSessionId = `session-${randomUUID()}`

await ctx.agents.create({
  sessionId: newSessionId,
  ...(seed === undefined ? {} : { seed }),
  meta: {
    ...(cwd !== undefined ? { cwd } : {}),
    ...(resolvedPreset !== undefined ? { agentPreset: resolvedPreset } : {}),
    parentSession: oldId,
  },
  agentOptions: {},
  setup,
})
```

- **preset**：先 `agentPresets.resolve(preset)` 得到规范 id，再通过 `setup(agentCtx)` 调用 `agentPresets.mount(agentCtx, id)`。resolve/mount 失败时记录日志并降级为默认 preset（`resolvedPreset = undefined`，`setup` 为空函数）。
- **seed**：只有摘要成功且旧会话有 `request/context` 才进入此阶段，因此实际总会生成 seed；`createSeededSession` 内部仍保留 `summary === null` 的防御分支。
- **parentSession**：始终写入老会话 id，供 client 侧关联。
- **agentOptions**：空对象，沿用宿主默认行为。

创建成功后调用 `attachToWorkspace(ctx, cwd, newSessionId)`：

```js
const ws = await ctx.workspaceRegistry.resolveByPath(cwd)
if (ws && typeof ws.attachSession === 'function') await ws.attachSession(newSessionId)
```

host 侧的 `agents.create` 不像 client 的 `sessions.create` RPC 那样自动归属 workspace；不 attach 会导致侧栏按 workspace 分组时找不到新会话。该步骤失败只记录日志，不影响 `/fresh` 返回结果。

### 3.7 阶段 4：归档老会话

只有阶段 3 成功创建新会话后才到达这里。

```js
await ctx.workspaceRegistry.archiveSession(oldId)
```

- 服务或方法不存在 → `archive skipped (workspaceRegistry service unavailable)`；
- 抛错 → `archive FAILED (<message>)`；新会话已经存在，`kind` 仍为 `success`；
- 归档前再次检查 `signal.aborted`：若已取消，保住老会话，返回 `cancelled before archive (new session … started, old session still live)`，`kind` 为 `error`。

### 3.8 结果拼装

`parts` 按阶段顺序收集：

```text
compacted (shadowed N surface nodes)
summarized (N chars)
nothing to summarize (empty context); no new session created
summarization failed (…); old session kept (not archived)
cannot create seeded session (session log lacks request/context); old session kept (not archived)
new session session-… started (with summary)
new session FAILED (…); old session kept (not archived)
archived <oldId> | archive skipped (…) | archive FAILED (…)
```

最后以 `; ` 拼接，写入日志与命令返回值。总结/创建失败时命令提前返回，不会出现归档段。

## 4. Seed 事件模型

`buildSeedEvents(summary, route, routeContext)` 生成 11 个事件。`seq` 从 0 连续递增，`time` 从 `Date.now() - 3` 起随 `seq` 递增，确保顺序稳定且 knob 事件略早于对话轮。

| # | `type` | 关键字段 | 存在理由 |
|---|---|---|---|
| 0 | `permission/preset` | `data.preset = 'workspace-write'` | 与 dsh 原生会话头部一致 |
| 1 | `sandbox/mode` | `data.mode = 'workspace-write'` | 防止 seeded 分支从非沙箱 shell 回填 `undefined` |
| 2 | `approval/policy` | `data.policy = 'ask'` | 与原生会话头部一致 |
| 3 | `turn/start` | `data.turn = 1` | 避免会话被 `sessionBlank` 判为 blank |
| 4 | `step/start` | `{ turn: 1, step: 1 }` | 轮次结构完整 |
| 5 | `user/message` | `content: [总结请求]`, `source.kind = 'user'`, `surfaceOp: 'append'` | 构成用户侧开场 |
| 6 | `request/header` | `header.config = { provider, model }`, `reason: 'initial'` | 重建该轮请求；继承旧会话真实路由 |
| 7 | `request/context` | `{ provider, model, contextWindow?, systemPromptUpdate? }` | 模型路由元数据；缺失会导致历史加载卡住 |
| 8 | `assistant/message` | `message.content: [摘要]`, `message.source.kind = 'model'`, `stream: []`, `surfaceOp: 'append'` | 摘要作为助手回复；`stream` 是 0.2.2 seed 校验必需 |
| 9 | `step/end` | `{ turn: 1, step: 1 }` | 轮次结构完整 |
| 10 | `turn/end` | `reason: { kind: 'completed' }` | 完成态，历史加载正常 |

不变量：

- 所有 `data` 必须是 JSON 可序列化的；`session.append` 会拒绝不可序列化事件。
- `user/message` 与 `assistant/message` 必须带 `surfaceOp: 'append'`，才会进入 surface 投影。
- `assistant/message` 必须带 `turn`、`step` 与 `stream` 数组（0.2.2 的 `assertAssistantSettlementShape`）。
- 必须构成完整的 `turn/start → step/start → … → step/end → turn/end`，否则历史栏会判定为空会话或渲染出「只有用户消息、没有助手回复」的异常轮次。
- 必须带 `request/header` 与 `request/context`，且使用旧会话的真实 provider/model；缺失时 0.2.2 会报 `历史加载失败：Maximum call stack size exceeded` 或停在「载入历史」。

## 5. Client 半边

### 5.1 浏览器 bundle 契约

```js
window.__ModuleLoader__.load({
  id: 'dsh-fresh-start',
  factory: function (require) {
    const inject = ['sessions', 'workspaces', 'uiWorkspace']
    function apply(ctx) { … }
    return { apply, inject }
  },
})
```

- `id` 必须与包名一致；
- `factory` 返回 `{ apply, inject }`；
- 不 import 任何宿主模块，避免浏览器侧解析依赖。

### 5.2 状态与算法

```js
let prevArchived = new Set(ctx.workspaces.list.getSnapshot().archivedSessionIds ?? [])
const pending = new Set()
```

两个订阅：

1. **workspaces.list**：对比新旧 `archivedSessionIds`，得到新归档集合；更新 `prevArchived`；对每个新归档 id 调用 `tryOpenChild`，返回 `'missing'` 时加入 `pending` 并调用 `ctx.sessions.refresh()` 后再清扫。
2. **sessions.list**：调用 `sweepPending`，对 `pending` 中的每个父 id 重试；只要返回不是 `'missing'` 就移出 pending。

`tryOpenChild(parentId)` 扫描 `sessions.list` 快照：

```js
for (const id of snap.ids) {
  const summary = snap.byId[id]
  if (summary?.parentId === parentId) {
    ctx.uiWorkspace.openSession(id)
    return 'opened'
  }
}
return 'missing'
```

`apply` 结束时还会立即执行一次 `sweepPending()`，处理插件加载前已经发生的归档。

### 5.3 返回状态与重试策略

| 返回值 | 含义 | 后续行为 |
|---|---|---|
| `'opened'` | 找到子会话并成功打开（`uiWorkspace.openSession`，旧宿主回退 `sessions.open`） | 移出 pending |
| `'missing'` | 尚未找到 `parentId` 匹配的子会话 | 保留在 pending，等会话列表更新或主动 refresh |
| `'failed'` | 找到子会话但打开抛错 | 告警一次，移出 pending，不再重试 |

`failed` 不重试是有意为之：打开会话的失败通常是确定性错误（会话已删除、路由异常等），每次会话列表更新都重试只会刷屏。

### 5.4 清理

`apply` 返回的函数依次调用两个 store 订阅的 disposer，插件卸载后不再响应归档或会话列表变化。

## 6. 跨端握手

```text
host                                   client
 │                                       │
 │ agents.create(meta.parentSession=old) │
 │──────────────────────────────────────►│  sessions.list 中出现
 │                                       │  { id: new, parentId: old }
 │ archiveSession(old)                   │
 │──────────────────────────────────────►│  workspaces.list.archivedSessionIds
 │                                       │  新增 old
 │                                       │
 │                                       ├─ tryOpenChild(old)
 │                                       │   找到 new → uiWorkspace.openSession(new)
 │                                       │   未找到 → pending.add(old) + refresh
 │                                       │
 │                                       └─ sessions.list 更新 → sweepPending
```

关键点：

- 新会话的 `parentId` 来自 host 写入的 `meta.parentSession`，client 不需要额外的查询接口。
- 归档广播与会话列表同步是两个独立通道，顺序不保证，因此必须有 pending 兜底。
- 关联是「一对多」安全的：一个老会话理论上可以有多个 `parentId` 相同的子会话，client 选择列表中第一个匹配项。正常 `/fresh` 流程只会创建一个。

## 7. 持久化与配置

- 插件**没有自己的持久化存储**：不写文件、不写数据库、不维护跨会话状态。
- 插件**不声明 `Config`**，不读取或改写 profile 的 `cordis.patch.yml`。`cordis.patch.yml` 是包内的静态 bundle 清单，由宿主在安装时解析，不属于运行时配置。
- 这与 dsh 0.2.2-rc.1 引入的「Persist your own configuration」规范一致：需要持久化配置的插件应通过 `ctx.fiber.entry` + `ctx.get('configEditor').edit()` 修改自身配置；需要密钥时应使用 `ctx.credentials`。本插件两者都不需要。
- 老会话的归档与新会话的 seed 都是 dsh 自身的会话数据，由宿主负责持久化。

## 8. 运行时 API 契约

| API | 提供方 | 用途 | 失败处理 |
|---|---|---|---|
| `ctx.commands.register(def)` | 宿主命令注册表 | 注册 `/fresh` | 由 `ctx.effect` 管理生命周期 |
| `ctx.agentPresets.resolve(id)` | `dsh-agent-preset-registry` | 校验 preset、取规范 id | 阶段 0 报错；阶段 3 降级默认 |
| `ctx.agentPresets.mount(agentCtx, id)` | `dsh-agent-preset-registry` | 新会话挂载 preset | 记录日志，降级默认 |
| `ctx.agentPresets.serviceFor(agent, 'compaction')` | `dsh-agent-preset-registry` | 压缩引擎兜底 | 查找失败记录 note，跳过压缩 |
| `ctx.get('compaction')` | cordis + `dsh-compaction-basic` | 可选读取全局压缩服务 | 读取失败/缺失时回退 `serviceFor` |
| `globalEngine.compactNow(agent, signal, commandId)` | `dsh-compaction-basic` | Compact-First | 捕获为 note，不阻断 |
| `ctx.agents.create(options)` | `dsh-agent` | 创建 seeded 会话 | `new session FAILED`，不归档 |
| `ctx.workspaceRegistry.archiveSession(id)` | `dsh-workspace` | 归档老会话 | 记录失败，新会话保留 |
| `ctx.workspaceRegistry.resolveByPath(cwd)` | `dsh-workspace` | 解析 workspace | 记录日志 |
| `workspace.attachSession(id)` | `dsh-workspace` | 新会话归属 | 记录日志 |
| `session.requestHeader()` | `dsh-session` | 取 `config` / `system` | 异常 → 结构化错误 |
| `session.deriveMessages()` | `dsh-session` | 取上传上下文 | 空上下文 → 终止，不创建/归档 |
| `ctx.llm.stream(options)` | `dsh-llm` | 总结请求 | 流错误 → 终止，不归档 |
| `BlockAssembler` / `createUserMessage` | `dsh-llm` | 聚合流、构造消息 | 空文本 → 终止，不归档 |
| `ctx.workspaces.list` / `ctx.sessions.list` / `ctx.uiWorkspace.openSession` | dsh Web client runtime | 归档监听与跳转 | 见 §5.3 |

## 9. 设计决策

| 决策 | 备选方案 | 取舍理由 |
|---|---|---|
| 直接对话式总结，不复用 `/compact` 的 checkpoint 流程 | 调用原生 `/compact` | 原生压缩在普通对话上常因「摘要不够小 / 无文本」失败；对话总结更稳，且摘要可直接作为新会话开场 |
| Compact-First 先压缩再总结 | 直接总结全量上下文 | 超大会话下总结请求本身可能超限；压缩后请求显著变小，并复用压缩摘要 |
| seed 写成完整对话轮 | 只写一条 `user/message` | 只写用户消息会被判为 blank，或渲染出没有助手回复的异常 turn |
| seed 前置三个 permission knob | 让宿主回填 | 非沙箱 shell 的 `sandboxMode` 可能是 `undefined`，回填会产生不可序列化事件并导致创建失败 |
| seed 继承旧会话的 `request/header` + `request/context` | 手写固定的 provider/model | 0.2.2 历史恢复需要真实路由元数据；继承可同时保住模型选择、`contextWindow` 与 `systemPromptUpdate` |
| `assistant/message` 带空 `stream: []` | 省略 stream | 0.2.2 的 seed 校验要求 settlement 字段；空数组表示没有可回放的流式块 |
| client 用 `uiWorkspace.openSession` | `ctx.sessions.open` | 0.2.2 已移除 `sessions.open`；view selection 归 `uiWorkspace`，旧宿主仍回退 |
| 归档时 pending + `sessions.refresh()` | 只等 `sessions.list` 推送 | 归档广播与列表同步是两个通道；主动刷新避免错过一次更新 |
| 用 `parentSession` 标记关联 | 服务端维护映射表 | 不引入额外状态，归档与创建可独立重试，client 只读会话数据即可关联 |
| 先创建新会话、后归档老会话 | 先归档再创建 | 创建失败时老会话仍可用；避免「两个都丢」的最坏情况 |
| 只有摘要和新会话都成功才归档 | 任何情况下都归档以释放内存 | 归档不可逆；没有摘要就归档等于永久丢弃上下文，且命令不应报告成功 |
| 可选服务用 `ctx.get('compaction')` 读取 | 写进 `inject` / 直接读 `ctx.compaction` | 写进 inject 会让无压缩引擎的 profile 停用插件；直接读未注入属性会被 cordis 拒绝 |
| 命令声明 `input.hint` | 不声明 input | dsh 客户端只对声明 input 的命令保留参数，否则菜单选择会丢弃 `/fresh <preset>` 的参数 |
| host 侧显式 attach workspace | 依赖 `agents.create` 自动归属 | host API 不像 client RPC 那样自动 attach，不归属会导致侧栏找不到新会话 |
| 打开会话失败不重试 | 每次列表更新都重试 | 确定性失败重试只会刷屏，且不会自愈 |
| 阶段结果用字符串 note 拼接 | 结构化错误对象 | 命令返回值只需要给用户看；压缩失败降级、总结/创建失败终止，字符串足够且便于日志排查 |

## 10. 测试映射

`tests/smoke_test.mjs`（69 条断言）：

| 用例 | 覆盖行为 |
|---|---|
| 1 | 全流程：注册、`input` 声明、总结、seed、`request/header`/`request/context` 继承、cwd/preset、`parentSession`、归档、workspace attach、返回 `sessionId` |
| 1b | `agent-preset/selected` 事件覆盖 header 中的 preset |
| 2 | 空上下文：`error`，不创建、不归档 |
| 2b | 旧会话缺 `request/context`：`error`，不创建、不归档 |
| 3 | 总结失败：`error`、`summarization failed`、旧会话保留 |
| 4 | 创建失败：`error`、旧会话不归档 |
| 5 | 无 `workspaceRegistry`：`archive skipped`，仍成功 |
| 6 | 不就地修改 `deriveMessages()` 返回的数组 |
| 7 | `header.config` 缺 model 时回退到 agent options |
| 8 | 无可用 provider/model：总结失败，不创建、不归档 |
| 9 | 总结阶段前已取消：不创建、不归档 |
| 10 | `session.header` 异常：结构化错误，不产生裸 rejection |
| 11 | `/fresh standard` 覆盖继承 preset |
| 12 | `/fresh no-such-preset` 明确报错，不创建、不归档 |
| 13 | `ptc`、`code`、`create` 三个别名映射 |
| 13b | 参数首尾空白被裁剪 |
| F-02 | 压缩成功：note 含节点数，仍创建，seed 仍带摘要 |
| F-03 | 无压缩范围：note 正确，仍创建 |
| F-04 | 引擎抛错：不冒泡，仍创建 |
| F-05 | 压缩先于总结执行，总结仍只发一次请求 |
| F-06 | 未注入 `ctx.compaction` 时经 `ctx.get` 读取全局引擎 |
| F-07 | `ctx.get` 失败时 `serviceFor` 兜底仍生效 |

`tests/client_test.mjs`（13 条断言）：

| 用例 | 覆盖行为 |
|---|---|
| 1 | 归档老会话后按 `parentId` 跳转；不相关归档不跳 |
| 2 | 归档时子会话尚未同步 → pending 兜底补跳，并主动刷新会话列表 |
| 3 | 不相关归档不触发跳转 |
| 4 | `uiWorkspace.openSession` 抛错被吞掉 |
| 5 | 打开失败后不再无限重试 |
| 6 | 旧宿主没有 `uiWorkspace` 时回退 `sessions.open` |

`tests/cordis_test.mjs`（6 条断言，真实 cordis）：

| 用例 | 覆盖行为 |
|---|---|
| 1 | 未 inject 时直接访问 `ctx.compaction` 抛 `without inject` |
| 2 | 插件在真实 cordis 下激活并注册 `/fresh` |
| 3 | 命令声明 `input.hint` |
| 4 | `/fresh` 全流程成功 |
| 5 | 经 `ctx.get('compaction')` 使用全局引擎并产生 `compacted` note |
| 6 | 新会话创建、旧会话归档 |
