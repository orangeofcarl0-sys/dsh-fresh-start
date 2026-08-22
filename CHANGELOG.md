# Changelog

## 1.2.8 - 2026-08-22

修复轮：极简模式（minimal preset）下 `/fresh` 无法创建新会话；新增 `/fresh <preset>` 参数。

### 修复：seeded 会话创建崩溃（非沙箱 shell）

- **症状**：`/fresh` 报 `new session FAILED (session event "sandbox/mode" carries non-JSON-serializable data)`，新会话建不出来。
- **根因**：seed 会话走 `dsh-permission-presets` 的 `pinInitialPermission()` seeded 分支，因 seed 里没有
  `sandbox/mode` 事件，回填 `ctx.shell.sandboxMode`；在非沙箱 shell（如本地 unconfined-bash hack 下的
  `dsh-bash-local`）上该值为 `undefined`，`setSandboxMode(session, undefined)` 追加的事件无法通过
  `session.append` 的 JSON 序列化校验而抛错。
- **修复**：seed 事件序列前置三个 permission knob 事件（`permission/preset` + `sandbox/mode` +
  `approval/policy`，取值 `workspace-write`/`workspace-write`/`ask`，与 dsh 原生会话头部一致），
  seeded 分支读到有效 sandbox 值后跳过回填。

### 新功能：`/fresh <preset>`

- `/fresh` 后跟 preset id 时，新会话使用指定 preset（覆盖继承值），例如极简模式下
  `/fresh standard` 直接开 standard 新会话并带上摘要。
- 指定不存在的 preset 时命令明确报错（不会静默回退到继承值）。
- 不带参数行为不变（继承当前会话的 preset）。

### 变更

- `lib/index.js`：seed knob 预置 + preset 参数解析；命令描述更新。
- `tests/smoke_test.mjs`：seed 结构断言更新，新增 knob 预置、`/fresh <preset>`、未知 preset 用例。
- `README.md`：补充 `/fresh <preset>` 用法。

## 1.2.7 - 2026-08-20

兼容性验证轮：确认 dsh 0.1.0-rc.8 无破坏性变更，依赖声明与文档对齐 rc.8。

### 兼容性检查（rc.7 → rc.8 逐包比对 npm 发布产物）

- `dsh-llm`：新增 `interruptedBlocks()`（取消时收尾未完成文本/reasoning 块）、
  图片超限卸载常量 `OFFLOADED_IMAGE_TEXT`、重试默认值 2→5；
  `BlockAssembler.push/finish/blocks()` 与 `createUserMessage` 不变；
- `dsh-session`：仅新增 `turn/end` 可选 `interrupted` 标记与 4 个 team 事件类型，
  `requestHeader()` / `deriveMessages()` 不变；
- `dsh-client-runtime`：`prompt` 新增可选 `signal` 参数与路径缩写辅助函数，
  client 插件接口（`__ModuleLoader__` / `archivedSessionIds` / `parentId` /
  `sessions.open`）不变；
- `dsh-app-boot`：仅新增一个平台常量；`dsh-cordis-client-runner`：仅 slots 契约
  文案与新增 `conversation.hero.brand.mark` 槽位，与本插件使用的
  `sessions` / `workspaces` 注入无关；
- `dsh-agent-presets` / `dsh-agent` / `dsh-scope` / `dsh-base` / `dsh-workspace` /
  `dsh-command-compact`：代码零变化（仅版本号与依赖升级）；
- harness 主包：依赖无移除（新增 `dsh-tool-pwsh-persistent`），preset 配置仅
  注释文案调整，preset id 不变。

### 变更

- **依赖声明**：`peerDependencies` / `devDependencies` 中 dsh 包范围更新为
  `^0.1.0-rc.8`；测试套件在 rc.8 依赖下全部通过（40 断言）。
- **文档**：README 的 dsh badge 与「局限」更新为 rc.8 并记录比对结论；源码注释
  版本引用同步。

## 1.2.6 - 2026-08-18

兼容性验证轮：确认 dsh 0.1.0-rc.7 无破坏性变更，依赖声明与文档对齐 rc.7。

### 兼容性检查（rc.6 → rc.7 逐包比对 npm 发布产物）

- `dsh-llm`：仅新增 `assembled()`（返回 `{blocks, replay}`，统一 max-token 截断
  决策），`BlockAssembler.push/finish/blocks()` 与 `createUserMessage` 不变；
- `dsh-agent-presets` / `dsh-agent` / `dsh-session` / `dsh-scope` / `dsh-base` /
  `dsh-app-boot` / `dsh-workspace` / `dsh-command-compact`：代码零变化
  （仅版本号与依赖升级）；
- `dsh-client-runtime`：仅删除一个 settings 错误码 schema，client 插件接口
  （`__ModuleLoader__` / `archivedSessionIds` / `parentId` / `sessions.open`）不变；
- `dsh-cordis-client-runner`：唯一变更为 `slots` 注入的 keyed 化重构
  （`settings.plugin.item`），与本插件使用的 `sessions` / `workspaces` 注入无关；
- harness 主包（`@deepseek-ai/dsh`）lib 产物与 rc.6 逐字节一致。

### 变更

- **依赖声明**：`peerDependencies` / `devDependencies` 中 dsh 包范围更新为
  `^0.1.0-rc.7`；测试套件在 rc.7 依赖下全部通过（40 断言）。
- **文档**：README 的 dsh badge 与「局限」更新为 rc.7 并记录比对结论；
  行为描述与源码注释对齐「总结请求不传 tools」。

## 1.2.5 - 2026-08-16

代码审查修复轮：补全依赖声明与测试基建，收紧 host/client 两侧的健壮性。

### 修复

- **依赖与测试基建**：`peerDependencies` 补齐 `@deepseek-ai/dsh-llm` 与
  `@deepseek-ai/dsh-agent-presets`（`^0.1.0-rc.6`，来自 npm）；新增 `devDependencies`
  与 `npm test` 脚本。此前新克隆环境下 smoke 测试因缺依赖无法运行。
- **host 侧**（`lib/index.js`）：
  - `deriveMessages()` 返回值改为防御性拷贝，不再可能就地污染会话内部数组；
  - provider/model 严格校验：`header.config` 存在但缺 provider/model 时回退到
    agent 选项，不再以 undefined 字段调用 `ctx.llm.stream`；
  - `session.header` 前置读取容错，异常时返回结构化 `{kind:'error'}` 而非裸 rejection；
  - 新增取消检查点（开新会话前 / 归档前）；归档前取消会保住老会话并在结果文本中说明；
  - 总结请求不再向 LLM 传 `tools`，消除模型发起 tool call 导致总结无文本的失败路径；
  - 删除从未使用的 `disposers` 死代码。
- **client 侧**（`lib/client.js`）：`tryOpenChild` 三态返回
  （`opened` / `missing` / `failed`）；`sessions.open` 抛错后不再于每次会话列表
  更新时无限重试，改为告警一次后放弃。

### 测试与文档

- smoke 测试 31 断言 / client 测试 9 断言，新增用例覆盖全部新行为
  （不改写入保护、config 回退、无目标降级、取消中止、header 异常、open 不重试）；
- README：版本 badge 对齐 package.json、断言数更正、补充 `npm install && npm test` 说明；
- 新增本 CHANGELOG（历史版本未留档，自本文件创建起开始记录）。
