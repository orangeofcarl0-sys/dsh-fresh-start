# dsh-fresh-start Compact-First 总结规范（Compact-First Spec）

> 状态：Specified（待实现，见实现提交）
> 版本：0.1
> 范围：`/fresh` 总结上下文策略从「纯对话式总结」升级为「compact-first + 对话总结回退」
> 目标读者：dsh-fresh-start 维护者、DSH 宿主集成方、测试与运维
> 关联文档：`README.md`（本项目）、`@deepseek-ai/dsh-compaction-basic`（宿主压缩引擎）、
> `@deepseek-ai/dsh-agent-presets`（per-preset 服务解析）、`@deepseek-ai/dsh-session`（surface 语义）

---

## 0. 规范目的

`/fresh` 当前（v1.2.8）的总结实现是**纯对话式总结**：直接提取 `session.deriveMessages()`（模型可见上下文全量）+ `session.requestHeader()`（system），追加一条总结指令后经 `ctx.llm.stream` 发给模型。

该实现存在三个已知问题：

1. **请求体随上下文线性增长**：上下文多大、总结请求就多大。超大会话（数十万事件）下，这轮总结请求本身可能逼近甚至超过模型上下文上限，导致总结失败；
2. **token 成本高**：相当于把整个上下文再完整发一次；
3. **未利用宿主 compact 机制**：dsh 自带压缩引擎（`dsh-compaction-basic`，经 preset 挂载）能先收紧上下文（shadow 旧消息、产出摘要），但 fresh 完全绕开它。

本规范把总结策略升级为 **compact-first**：

- **优先**调用宿主 compact 引擎强制压缩（`compactNow`），压缩成功后基于**收紧后的上下文**再做对话式总结（此时请求轻量，且天然复用了压缩摘要）；
- compact 引擎**不可用**（如极简模式无 compaction 服务）、**忙碌**（agent 非 idle）、或**无可压缩范围**（会话过小）时，**回退**到现状的纯对话式总结。

目标：超大会话下 `/fresh` 总结成功率高、token 花费低、行为可预期、失败可诊断。

---

## 1. 非目标（Non-Goals）

本规范不承担以下范围：

- 不改变 `/fresh` 的创建/归档/跳转流程（仅总结阶段的输入策略变化）；
- 不改变 `/fresh <preset>` 参数与别名语义；
- 不引入新的模型路由（总结仍使用会话当前模型，见现有实现）；
- 不修改宿主 compact 引擎（`dsh-compaction-basic`）本身；
- 不为极简模式注入 compaction 服务（preset 设计取舍保持不变；极简模式下始终走对话回退）；
- 不提供压缩的「回滚」——compact 对旧会话的 shadow 是不可逆的持久化事实（见 §6 风险）。

---

## 2. 术语

| 术语 | 定义 |
|---|---|
| Compact-First | 先压缩、后总结的策略：压缩引擎可用时先收紧上下文再对话总结 |
| 对话式总结 | fresh 自组 `ctx.llm.stream` 请求（追加总结指令）产出摘要的现有路径 |
| Compaction Engine | 宿主 `dsh-compaction-basic` 实例，经 `agentPresets.serviceFor(agent, 'compaction')` 解析 |
| `compactNow` | 引擎的强制压缩入口（要求 idle agent，无可压缩范围时返回 null）|
| Shadow | 压缩把旧 surface 节点替换为摘要节点；`deriveMessages()` 因此不再包含被 shadow 的消息 |
| 可用引擎 | serviceFor 解析到实例且具有 `compactNow` 方法 |
| 可用范围 | 引擎判定当前会话存在值得压缩的 surface 区间（`selectCompactableRange` 非空）|
| Seed | `/fresh` 新会话的开场消息（摘要轮），来自总结文本 |

---

## 3. 优先级与路线图

| 优先级 | Spec ID | 主题 | 目标 |
|---|---|---|---|
| P0 | CFS-001 | compact-first 策略框架 | 引擎可用时先压缩，不可用时回退对话总结 |
| P0 | CFS-002 | 压缩副作用可诊断 | 每步结果/失败原因进入 `/fresh` 返回文本与日志 |
| P1 | CFS-003 | 测试覆盖 | 引擎可用/无范围/busy/无引擎四分支 + 回退兼容 |

---

## 4. Spec CFS-001：compact-first 策略框架

### 4.1 目标

- 有 compaction 引擎的 preset（standard/code/cordis）下，`/fresh` 先 `compactNow` 收紧上下文，再基于收紧后的 `deriveMessages()` 对话总结；
- 引擎不可用（minimal）或操作失败时，行为与 v1.2.8 完全一致（纯对话式总结）；
- 总结文本仍是新会话 seed 的唯一来源（compact 只收紧输入，不直接替代总结）。

### 4.2 根因

- `/fresh` 总结直接发送 `deriveMessages()` 全量；超大会话下请求体过大、易超限（v1.2.8 行为）；
- `deriveMessages()` 遵循 surface 的 shadow 语义——compact 后自动变小，因此「先压缩再总结」能显著缩小总结请求体，且摘要质量不降（压缩摘要成为总结的输入之一）。

### 4.3 需求

1. fresh 在执行对话式总结**之前**，尝试解析压缩引擎并强制压缩当前会话；
2. 压缩只发生在引擎可用、agent idle、存在可压缩范围三个条件同时满足时；
3. 任何失败（busy / 无范围 / 抛错 / 无引擎）都**安静降级**：不阻断总结、不阻断创建/归档；
4. 压缩结果与回退原因必须可见（返回文本 + 日志），可诊断；
5. 压缩器对旧会话的 shadow 属于预期副作用（旧会话随后被归档，见 §6）。

### 4.4 设计

```
/fresh 总结阶段（executeFresh 内）：
  engine = agentPresets.serviceFor(agent, 'compaction')
  if engine 且 typeof engine.compactNow === 'function':
      try:
          result = engine.compactNow(agent, signal, invocation.commandId)
          if result ≠ null:
              parts.push(`compacted (shadowed ${result.shadowedSeqs.length} nodes)`)
          else:
              parts.push('compaction skipped (no compactable range)')
      catch error:
          parts.push(`compaction skipped (${error.message})`)   // busy / 其它
          日志记录错误
  // 无论压缩与否，都基于（可能已收紧的）deriveMessages() 对话总结
  summary = summarizeContext(ctx, session, agent, signal)   // 现有实现不变
```

要点：
- `compactNow` 使用 fresh 的 `invocation.commandId` 作为 `sourceCommandId`（与手动压缩一致的审计归属）；
- 压缩成功后 `deriveMessages()` 缓存因 `replaceGeneration` 递增自动失效，重读即收紧后的消息；
- `summarizeContext` 内部逻辑（provider/model 解析、指令、maxTokens、失败判定）**零改动**；
- signal 透传给 `compactNow`（取消语义一致）。

### 4.5 接口

内部函数（不导出）：

```
async function tryCompact(ctx, agent, signal, commandId) -> { ok: boolean, note: string }
```

- 返回 `{ ok: true, note }`：压缩已执行（note 含 shadow 节点数）或空操作（note='no compactable range'）；
- 返回 `{ ok: false, note }`：引擎不可用（note='no compaction engine (preset lacks it)'）或失败（note=错误消息）；
- 永不抛出：所有异常被捕获转为 `{ ok: false, note }`。

### 4.6 数据模型

无新增持久化。引擎 `compactNow` 返回的 `result`（`{ shadowedSeqs, shadowedRange, shadowedTokenCount, summarySeq }`）仅用于日志/返回文本，不落库。

### 4.7 边界条件

| 条件 | 行为 |
|---|---|
| minimal preset（无引擎）| `{ ok: false, note: 'no compaction engine…' }` → 对话总结（现状）|
| agent busy（turn 进行中）| `ManualCompactionError(busy)` 捕获 → 对话总结 |
| 会话过小无可压范围 | `compactNow` 返回 null → `note: 'no compactable range'` → 对话总结 |
| signal 已取消 | `compactNow` 内 abort → 捕获 → 对话总结（后续步骤仍会检查信号）|
| 压缩后上下文仍超限 | 对话总结自身失败 → 走现有降级（无 seed 创建会话）|

### 4.8 验收标准

1. standard/code/cordis preset 下 `/fresh`，会话有可压缩范围时：返回文本含 `compacted (shadowed N nodes)`，且总结请求的 messages 长度小于压缩前；
2. minimal preset 下 `/fresh`：返回文本含 `compaction skipped (no compaction engine…)`，总结行为与 v1.2.8 一致；
3. 引擎 busy（模拟）时：返回文本含 `compaction skipped (…)`，总结仍执行；
4. 无论压缩成功与否，新会话都正常创建、旧会话正常归档、跳转正常；
5. 无引擎时**不出现** engine 相关异常（所有失败被包含，不冒泡）。

### 4.9 测试

- mock 无引擎（现有用例基线，`agentPresets.serviceFor` 返回 void 0）；
- mock 引擎 compactNow 返回结果对象 → 断言 parts 含 compacted、create 仍调用、seed 仍含摘要；
- mock 引擎 compactNow 返回 null → 断言 note=no compactable range、create 仍调用；
- mock 引擎 compactNow 抛错 → 断言 note 含错误、create 仍调用；
- 断言 summarizeContext 的请求在压缩成功后使用收紧后的 messages。

### 4.10 迁移

- 无配置迁移；行为变化仅在总结阶段内部；
- 旧版本（v1.2.8）会话/种子无需迁移。

### 4.11 风险

| 风险 | 缓解 |
|---|---|
| `compactNow` 在命令 handler 中可能判定 busy | 捕获 `ManualCompactionError` 降级对话总结（§4.3-3）|
| 压缩是不可逆的（shadow 旧消息）| 旧会话随后被归档；压缩属于「归档前的最后收紧」，即使后续步骤失败也可接受（可选中）|
| 压缩改变 token 计量影响会话 | 压缩只影响旧会话，新会话以 seed 重建，无累积影响 |
| 引擎接口在 dsh 升级后变化 | `typeof engine.compactNow === 'function'` 防御性检查，缺失即降级 |

---

## 5. Spec CFS-002：压缩副作用可诊断

### 5.1 目标

每次 `/fresh` 返回文本与 host 日志中，压缩环节的结果（执行/跳过/失败+原因）清晰可见。

### 5.2 设计

- 返回文本统一前缀 `compaction …` 段（见 §4.4）；
- host 日志沿用现有 `[fresh-start]` tag：`compaction: shadowed N surface nodes`（成功）、`compaction skipped: <原因>`（跳过/失败）。

### 5.3 验收标准

1. 成功压缩：返回文本与日志都含 shadow 节点数；
2. 跳过：返回文本与日志都含原因短语；
3. 失败：返回文本与日志都含错误消息摘要。

---

## 6. Spec CFS-003：测试覆盖

### 6.1 目标

smoke 测试覆盖全部压缩分支，确保回退兼容与无回归。

### 6.2 用例清单

| 用例 | 场景 | 断言 |
|---|---|---|
| F-01（基线）| serviceFor 返回 void 0 | 无 compaction 段、总结/创建/归档正常 |
| F-02 | compactNow 返回 `{shadowedSeqs:[…]}` | parts 含 `compacted`、create 仍调用 |
| F-03 | compactNow 返回 null | parts 含 `no compactable range`、create 仍调用 |
| F-04 | compactNow 抛错 | parts 含错误消息、create 仍调用（不冒泡）|
| F-05 | 压缩成功后消息收紧 | summarizeContext 的 messages 为压缩后集合 |

### 6.3 验收标准

`npm test` 全绿（现有 46 断言 + 新增用例）。

---

## 7. 兼容性与回退保证

- 无引擎（minimal / 部署缺包）：行为与 v1.2.8 **逐字节一致**（仅多返回文本说明段）；
- 有引擎但不可用：与无引擎同样安静降级；
- `/fresh <preset>`、别名、seed knob 预置、归档/跳转均不受影响。

---

## 8. 附：实现顺序

1. `docs/COMPACT_FIRST_SPEC.md`（本文档）；
2. `lib/index.js`：`tryCompact` 函数 + executeFresh 集成；
3. `tests/smoke_test.mjs`：F-01..F-05；
4. CHANGELOG/README 更新；同步 profile；重启验证。