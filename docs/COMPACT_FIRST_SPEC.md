# Compact-First 总结规范

| 项 | 值 |
|---|---|
| 状态 | Implemented（v1.2.9 起） |
| 规范版本 | 1.2（2026-11-09 修复服务读取方式） |
| 首次实现 | 1.2.9（2026-08-22） |
| 适用插件版本 | 1.2.9 – 1.8.1 |
| 目标读者 | 维护者、DSH 宿主集成方、测试与运维 |
| 关联文档 | [README](../README.md)、[ARCHITECTURE.md](ARCHITECTURE.md)、[COMPATIBILITY.md](COMPATIBILITY.md) |

## 目录

- [0. 目的](#0-目的)
- [1. 非目标](#1-非目标)
- [2. 术语](#2-术语)
- [3. 需求](#3-需求)
- [4. 设计](#4-设计)
- [5. 接口](#5-接口)
- [6. 边界条件](#6-边界条件)
- [7. 验收标准](#7-验收标准)
- [8. 测试映射](#8-测试映射)
- [9. 风险](#9-风险)
- [10. 兼容与回退](#10-兼容与回退)
- [11. 修订历史](#11-修订历史)

---

## 0. 目的

`/fresh` 的总结需要一个输入：当前会话中「DSH 将要上传给模型」的上下文。v1.2.8 的实现是**纯对话式总结**：

```text
session.requestHeader() + session.deriveMessages() + 总结指令 → ctx.llm.stream
```

这在超大会话下有三个问题：

1. **请求体随上下文线性增长**：上下文多大，总结请求就多大；极端情况下可能超过模型窗口，导致总结失败。
2. **token 成本高**：相当于把完整上下文再发一遍。
3. **未利用宿主压缩机制**：dsh 自带压缩引擎（`dsh-compaction-basic`），能先 shadow 旧消息、产出摘要，但 `/fresh` 完全绕开了它。

Compact-First 把总结策略改为：

- **优先**调用宿主压缩引擎强制压缩当前会话；压缩成功后基于**收紧后的上下文**做对话式总结，请求更轻，并天然复用压缩摘要；
- 引擎**不可用**（如 `minimal` preset）、**忙碌**（agent 非 idle）、**无可压缩范围**（会话过小）或**抛错**时，**安静回退**到纯对话式总结。

目标：超大会话下总结成功率更高、token 花费更低、行为可预期、失败可诊断。

## 1. 非目标

- 不改变 `/fresh` 的创建、归档、跳转流程；
- 不改变 `/fresh <preset>` 参数与别名语义；
- 不引入新的模型路由（总结仍使用会话当前模型）；
- 不修改宿主压缩引擎本身；
- 不为 `minimal` preset 注入 compaction 服务；
- 不提供压缩回滚——compact 对旧会话的 shadow 是不可逆的持久化事实（见 §9）。

## 2. 术语

| 术语 | 定义 |
|---|---|
| Compact-First | 先压缩、后总结的策略 |
| 对话式总结 | 插件自组 `ctx.llm.stream` 请求、追加总结指令产出摘要的路径 |
| 压缩引擎 | 提供 `compactNow` 的宿主服务；当前实现通过 `ctx.get('compaction')` 读取全局服务，兼容 per-preset `serviceFor(agent, 'compaction')` |
| `compactNow` | 引擎的强制压缩入口：要求 idle agent，无可压缩范围时返回 `null` |
| Shadow | 压缩把旧 surface 节点替换为摘要节点；`deriveMessages()` 因此不再包含被 shadow 的消息 |
| 可用引擎 | 解析到实例且具有 `compactNow` 方法 |
| 可用范围 | 引擎判定当前会话存在值得压缩的 surface 区间 |
| Seed | `/fresh` 新会话的开场消息，来自总结文本 |

## 3. 需求

| ID | 需求 |
|---|---|
| R1 | 在对话式总结**之前**尝试解析压缩引擎并强制压缩当前会话 |
| R2 | 仅在「引擎可用 + agent idle + 存在可压缩范围」时真正压缩 |
| R3 | 任何失败（无引擎 / busy / 无范围 / 抛错）都必须安静降级，不阻断总结、创建、归档 |
| R4 | 压缩结果与回退原因必须进入返回文本与日志，可诊断 |
| R5 | 压缩成功后，总结请求必须基于收紧后的 `deriveMessages()` |

## 4. 设计

### 4.1 引擎选择

```js
engine = ctx.get('compaction') ?? ctx.agentPresets?.serviceFor?.(agent, 'compaction')
```

- **第一优先**：`ctx.get('compaction')`。`compaction` 是 cordis 的可选服务，不声明在 `inject` 中（否则没有压缩引擎的 profile 会一直 pending）；`ctx.get` 是无 inject 读取入口。
- **不能直接读 `ctx.compaction`**：cordis 对未注入的服务属性会抛 `cannot get property "compaction" without inject`，`??` 后面的兜底不会执行。1.8.0 及更早版本因此在真实宿主上无法进入 Compact-First。
- **兜底**：`ctx.agentPresets.serviceFor(agent, 'compaction')`。这是更早的 per-preset 形态，保留以兼容不同宿主线。
- 全局服务读取失败、缺失或无 `compactNow` 时走兜底；兜底查找本身抛错时返回 `compaction engine lookup failed (<message>)`。

### 4.2 执行流程

```text
executeFresh(invocation):
  ...
  note = await tryCompact(ctx, agent, invocation.signal, invocation.commandId)
  parts.push(note)

  summary = await summarizeContext(ctx, session, agent, invocation.signal)
  ...
```

`tryCompact` 的完整逻辑：

```js
async function tryCompact(ctx, agent, signal, commandId) {
  let engine
  try {
    if (typeof ctx.get === 'function') {
      const globalEngine = ctx.get('compaction')
      if (globalEngine && typeof globalEngine.compactNow === 'function') engine = globalEngine
    }
  } catch {
    // 全局服务不可读：继续尝试 serviceFor 兜底
  }
  if (engine === undefined) {
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
    const count = result.shadowedSeqs?.length ?? (
      result.shadowedRange !== undefined
        ? result.shadowedRange.end - result.shadowedRange.start + 1
        : '?'
    )
    return `compacted (shadowed ${count} surface nodes)`
  } catch (error) {
    return `compaction skipped (${error?.message ?? error})`
  }
}
```

要点：

- `compactNow` 的第三个参数使用 `/fresh` 的 `invocation.commandId`，作为压缩审计的 `sourceCommandId`，与手动压缩的归属一致。
- `signal` 原样透传，取消语义与总结一致。
- 压缩成功后，surface 的 `replaceGeneration` 递增，`deriveMessages()` 的缓存自动失效；阶段 2 重读时拿到的是收紧后的消息。
- `summarizeContext` 的内部逻辑（provider/model 解析、指令、`maxTokens`、失败判定）**零改动**。

### 4.3 结果 note

`tryCompact` 返回一个字符串，调用方直接拼入 `parts`：

| 场景 | note |
|---|---|
| 压缩成功 | `compacted (shadowed N surface nodes)` |
| 无引擎 / 无 `compactNow` | `no compaction engine (preset lacks the compaction service)` |
| 无可用范围（返回 `null`） | `compaction skipped (no compactable range)` |
| 引擎抛错（含 busy） | `compaction skipped (<error message>)` |
| 全局服务读取抛错 | 继续尝试 `serviceFor`；兜底也没有引擎时 `no compaction engine…` |
| 兜底 `serviceFor` 抛错 | `compaction engine lookup failed (<error message>)` |

> 规范 0.1 曾提议返回 `{ ok, note }`；实现选择了更简单的字符串，因为调用方只需要展示文本，`ok` 没有被任何逻辑消费。本版按 as-built 修正。

### 4.4 与总结阶段的关系

- 压缩只改变总结的**输入**，不替代总结；新会话的 seed 仍然来自对话式总结文本。
- 压缩失败只降级为纯对话式总结；总结失败则会终止后续创建/归档（旧会话保留）。两者互不掩盖。
- 若取消信号在压缩期间触发，`compactNow` 可能抛出 abort 类错误，被捕获为 `compaction skipped (…)`；后续总结阶段仍会检查信号并中止。

## 5. 接口

内部函数（不导出）：

```ts
async function tryCompact(
  ctx: Context,
  agent: Agent,
  signal: AbortSignal,
  commandId: string,
): Promise<string>
```

- **永不抛出**：所有异常转为原因短语。
- **无副作用承诺**：除调用 `compactNow` 外不修改会话；不读写持久化配置。
- 返回值只用于展示与日志，不参与控制流。

## 6. 边界条件

| 条件 | 行为 |
|---|---|
| `minimal` preset（无引擎） | 返回 `no compaction engine…`，走纯对话式总结 |
| agent busy（turn 进行中） | `compactNow` 抛错 → 捕获为 `compaction skipped (…)`，继续总结 |
| 会话过小、无可压范围 | `compactNow` 返回 `null` → `no compactable range`，继续总结 |
| 压缩期间取消 | abort 被捕获 → 继续到总结阶段，由取消检查点终止 |
| 压缩后上下文仍超限 | 总结自身失败 → 返回 `error`，不创建、不归档，旧会话保留 |
| 引擎返回结构缺少字段 | 节点数回退到 `shadowedRange` 计算，仍缺失则显示 `?` |
| `ctx.get` 抛错或返回 `undefined` | 回退 `serviceFor`；两者都无引擎时 `no compaction engine…` |
| `ctx.agentPresets` 不存在 | 可选链返回 `undefined` → `no compaction engine…` |

## 7. 验收标准

1. `standard` / `ptc` / `cordis` 等挂载了压缩引擎的 preset 下，会话有可压缩范围时：返回文本含 `compacted (shadowed N surface nodes)`，且总结请求的 messages 长度小于压缩前。
2. `minimal` preset 下：返回文本含 `no compaction engine…`，总结行为与 v1.2.8 一致。
3. 引擎 busy 或抛错时：返回文本含 `compaction skipped (…)`，总结仍执行。
4. 在**总结成功**的前提下，无论压缩成功与否，新会话正常创建、旧会话正常归档、跳转正常。
5. 无引擎时不出现引擎相关异常，所有失败被包含、不冒泡。
6. 压缩成功后，`summarizeContext` 读取的是收紧后的 `deriveMessages()`。

## 8. 测试映射

`tests/smoke_test.mjs` 中的 F 系列用例：

| 用例 | 场景 | 断言 |
|---|---|---|
| F-01（基线） | `serviceFor` 返回 `undefined` | 无压缩引擎时走对话总结；总结/创建/归档正常 |
| F-02 | `compactNow` 返回 `{ shadowedSeqs: [1,2,3] }` | 返回文本含 `compacted (shadowed 3 surface nodes)`；新会话仍创建；seed 仍带摘要 |
| F-03 | `compactNow` 返回 `null` | 返回文本含 `compaction skipped (no compactable range)`；新会话仍创建 |
| F-04 | `compactNow` 抛错 `manual compaction requires an idle agent` | 返回文本含该错误；不冒泡；新会话仍创建 |
| F-05 | 压缩成功后的总结 | 压缩先于总结执行；总结仍只发一次 LLM 请求；messages 非空 |
| F-06 | 真实 cordis 下未注入 `ctx.compaction` | 经 `ctx.get('compaction')` 读到全局引擎并产生 `compacted` note |
| F-07 | `ctx.get` 读取抛错 | `serviceFor` 兜底仍生效并产生 `compacted` note |

完整测试套件为 88 条断言（69 smoke + 13 client + 6 cordis），`npm test` 全绿。

## 9. 风险

| 风险 | 缓解 |
|---|---|
| `compactNow` 在命令 handler 中可能判定 busy | 捕获异常并降级为对话式总结（R3） |
| 压缩不可逆（shadow 旧消息） | 成功路径下旧会话随后被归档；失败路径下旧会话保留但已处于压缩后状态 |
| 压缩改变 token 计量影响会话 | 只影响旧会话；新会话以 seed 重建，无累积影响 |
| 引擎接口在 dsh 升级后变化 | `typeof engine.compactNow === 'function'` 防御性检查，缺失即降级 |
| 引擎查找本身抛错 | 全局读取失败先回退；`serviceFor` 抛错时返回 `compaction engine lookup failed` |
| `compactNow` 耗时过长 | 透传取消信号；取消后仍会进入总结阶段并由检查点终止 |

## 10. 兼容与回退

- 无引擎或引擎不可用：行为与 v1.2.8 一致，仅返回文本多一段说明。
- 有引擎：只在引擎可用、idle、有范围时压缩；压缩环节的任何失败都不阻断主流程（总结失败时仍由归档安全策略终止）。
- `/fresh <preset>`、别名、seed knob 预置、归档与跳转均不受影响。
- 回退方式：删除 `tryCompact` 调用即可回到纯对话式总结；`summarizeContext` 无需改动。

## 11. 修订历史

| 版本 | 日期 | 变更 |
|---|---|---|
| 0.1 | 2026-08-22 | 初始规范：CFS-001/002/003，待实现 |
| 1.0 | 2026-08-22 | 随 v1.2.9 实现落地 |
| 1.1 | 2026-11-09 | 按 as-built 修订：状态改为 Implemented；补充 `ctx.compaction` 全局服务优先与 `serviceFor` 兜底；接口返回类型由 `{ ok, note }` 修正为 `string`；补充引擎查找失败路径与测试映射 |
| 1.2 | 2026-11-09 | 修复服务读取：改用 `ctx.get('compaction')`（直接读 `ctx.compaction` 在未 inject 时会抛错，导致兜底不执行）；补充 F-06/F-07 测试映射 |
