# Changelog

## 1.5.1 - 2026-09-13

兼容性验证轮：dsh `0.1.7-rc.2`（rc.1 → rc.2，同线收敛），无破坏性变更，
**零代码改动**，仅依赖声明与文档对齐。

### 变更

- **逐包发布产物比对（0.1.7-rc.1 → 0.1.7-rc.2）**：
  - dsh-llm：纯增量（`createDeveloperMessage`、`projectToolUpdates`、tool 声明/
    工具历史助手）；`BlockAssembler` / `createUserMessage` 不变；
  - dsh-agent-preset-registry：服务名与 `resolve / mount / serviceFor` 不变；
    `list()` 默认选中策略简化（移除 `modeSelectionEnabled`，回退
    `selectedDefault ?? default`）——本插件不消费；
  - dsh-session：新增 tool-history 折叠与类型；核心 API 与 seed knob 事件词表未变；
  - dsh-permission-presets：Auto preset approval 策略 `never` → `ask`（及匹配逻辑）；
    本插件 seed 预置 `workspace-write`/`ask`，seeded 分支不变，无影响；
  - dsh-compaction / dsh-client-modules / dsh-command-compact：仅 package.json 重指。
- **依赖声明对齐**：peers/devDeps 升 `^0.1.7-rc.2`；cordis 保持 `^4.0.4`。
- 测试套件在 rc.2 线依赖下重装实跑：66 断言（57+9）ALL PASS。
- README 徽章与兼容性节更新。

## 1.5.0 - 2026-09-12

适配 dsh `0.1.7-rc.1`：宿主包拆分（agent-presets → agent-preset +
agent-preset-registry）、cordis 升 4.0.4、内置 preset 数据格式迁移。
**零代码改动**（服务名与方法面不变），依赖声明迁移 + 文档。

### 变更

- **宿主包拆分**：`@deepseek-ai/dsh-agent-presets` 拆为 `dsh-agent-preset`（agent
  facet）与 `dsh-agent-preset-registry`（服务提供方）。新 registry 仍以
  `super(ctx, "agentPresets")` 注册服务，`resolve / mount / serviceFor / list`
  签名不变。本插件自 1.3.0 起不再 import 该包（只用注入服务），故代码零改动；
  peer/devDeps 从 `dsh-agent-presets` 迁移到 `dsh-agent-preset-registry ^0.1.7-rc.1`。
- **cordis 4.0.2 → 4.0.4**（dsh-llm peer 声明为 `~4.0.4`）：本插件声明同步 `^4.0.4`。
- **内置 preset 数据迁移**：YAML 组合（`agent.cordis.yml`）→
  `dsh-web-app/presets/*.patch.yml`（cordis/minimal/ptc/standard），preset id 不变，
  `/fresh <preset>` 与别名映射不受影响。
- **compaction 面未变**：实现仍在 `dsh-compaction-basic`，`compactNow(agent, signal,
  commandId)` 调用形状与返回字段同前。
- 其余逐一核对未变：`session.requestHeader / deriveMessages`、seed 三 knob 事件在
  词表、permission seeded 分支、`dsh.client.platform:"web"`、`commands.register`、
  `agents.create`（seed/setup/meta.parentSession）、workspaceRegistry 三件套。
- **依赖图简化**：agent-presets 退出后，测试安装不再需要 11 包 `--no-save` 辅助闭包
  （仅 cordis + dsh-llm）；clean install 后 66 断言（57+9）ALL PASS。

## 1.4.0 - 2026-09-11

移除 dsh-std 轨道（原 1.2.10 双轨制引入的惰性清单）。`/fresh` 功能零影响。

### 变更

- **删除**：`dsh-plugin.json`（Community v0.15 清单）、`lib/std/host.js`（占位宿主
  facet 入口）、`tests/std_manifest_test.mjs`；package.json 同步清除 files/
  keywords（dsh-std、community-v0.15）/devDependencies（`@dsh-std/manifest`）与
  test 脚本项；README 移除 dsh-std 徽章与章节。
- **删除理由**：std 生态自 2026-08-31 后停更（core/composition 停在 0.1.0-rc1）；
  其 `adapter-dsh@0.1.1-rc.2` 的 peer 窗口为 `>=0.1.2-alpha.2 <0.1.3`，与本插件当前
  宿主线（`0.1.5-rc.2`）不兼容——该轨道从未在真实宿主中生效（清单始终惰性，占位入口
  空贡献）。保留仅剩发版同步成本与误导性宣传，故移除。
- **重新评估触发条件**：`@dsh-std/adapter-dsh` 发布支持 0.1.5+ 宿主的版本、且 std
  侧补齐可承载 session/workspace 生命周期能力的协议后。
- 测试套件精简为 smoke（57）+ client（9）共 66 断言：ALL PASS（README 断言数同步校准）。

## 1.3.5 - 2026-09-11

兼容性验证轮：dsh `0.1.5-rc.2`（rc.1 → rc.2），无破坏性变更，**零代码改动**，
仅依赖声明与文档对齐。

### 变更

- **逐包发布产物比对（0.1.5-rc.1 → 0.1.5-rc.2）**：本插件用到的七个包
  （dsh-agent-presets / dsh-llm / dsh-session / dsh-compaction /
  dsh-permission-presets / dsh-client-modules / dsh-command-compact）发布产物
  逐字节比对，**lib 与全部数据目录完全一致**，仅 package.json 版本号与依赖范围重指。
- **依赖声明对齐**：peers/devDeps 升 `^0.1.5-rc.2`；cordis `^4.0.2` 不变。
- 测试套件在 rc.2 线依赖下重装实跑：73 断言（34+9+std）ALL PASS。
- `dsh-plugin.json` 版本同步 1.3.5；README 徽章与兼容性节更新。

## 1.3.4 - 2026-09-10

兼容性验证轮：dsh `0.1.5-rc.1`（0.1.5 线内 alpha.1 → rc.1 收敛），无破坏性变更，
**零代码改动**，仅依赖声明与文档对齐。

### 变更

- **逐包发布产物比对（0.1.5-alpha.1 → 0.1.5-rc.1）**：
  - dsh-session：事件词表与 `lib/index.js` 仅**新增** `deliverables/presented`、
    `subagent/catalog` 两个事件类型；本插件 seed 的 `approval/policy` /
    `permission/preset` / `sandbox/mode` 仍在词表；`canonicalHeader` 仍未含
    `system`（1.3.3 记录的降级路径无变化）；
  - dsh-agent-presets：`lib/index.js` 字节级一致；仅内置 preset 组合数据
    （四个 agent.cordis.yml + minimal/preset.yml）与 typert 协议文件更新；
  - dsh-llm：仅 typert 协议文件；dsh-compaction / dsh-permission-presets /
    dsh-client-modules / dsh-command-compact：仅 package.json 重指。
- **依赖声明对齐**：peers/devDeps 升 `^0.1.5-rc.1`（agent-presets 从 alpha.1
  显式对齐；llm 此前已解析到 rc.1 但签名同步）；cordis `^4.0.2` 不变。
- 测试套件在 rc.1 线依赖下重装实跑：73 断言（34+9+std）ALL PASS。
- `dsh-plugin.json` 版本同步 1.3.4；README 徽章与兼容性节更新。

## 1.3.3 - 2026-09-09

兼容性验证轮：dsh `0.1.5-alpha.1`（v1.3.2 时 llm/session/compaction/command-compact
已在 0.1.5 线上；本轮增量 agent-presets、permission-presets、client-modules），
无破坏性变更，**零代码改动**，仅依赖声明与文档对齐。

### 变更

- **逐包发布产物比对（0.1.3-alpha.2 → 0.1.5-alpha.1）**：
  - dsh-agent-presets：`lib/index.js` 字节级一致；typert 协议类型级演进
    （`SurfaceIntent`（仍含 `surfaceOp`）/`EpochHeader.system` 移除/Inbox 接口化）
    为增量与类型调整，不影响运行时；
  - dsh-permission-presets：仅文档与 package.json（seeded 分支不变）；
  - dsh-client-modules：宿主连线重构（webServer 变可选 carrier），声明与
    `window.__ModuleLoader__` 契约不变；
  - dsh-llm/session/compaction/command-compact：与 v1.3.2 验证版本一致（无变化）。
- **已知行为漂移（上游，记录备用）**：0.1.5 起 `session.requestHeader()` 的
  canonical header 不再含 `system`（系统提示迁移到 `createSystemMessage`/
  `systemPromptUpdate` 通道）。插件条件透传安全降级——总结请求将不含 system 提示；
  若需带 system 总结，可改经新通道提取（列为待办，本次未做）。
- **依赖声明对齐**：peers/devDeps 的 `@deepseek-ai/dsh-agent-presets` 升至
  `^0.1.5-alpha.1`（dsh-llm 仍在 `^0.1.5-alpha.1`，cordis `^4.0.2` 不变）；
  `session.header.{cwd,parentSession,agentPreset}` 校验与 `agents.create` 链路逐一
  核对未变。
- 测试套件在 0.1.5 线依赖下重装实跑：73 断言（34+9+std）ALL PASS。
- `dsh-plugin.json` 版本同步 1.3.3；README 徽章与兼容性节更新。

## 1.3.2 - 2026-09-08

兼容性验证轮：dsh `0.1.3-alpha.2`（子包双线：agent-presets/permission-presets/
client-modules `0.1.3-alpha.2`，dsh-llm/session/compaction/command-compact
`0.1.5-alpha.1`），无破坏性变更，依赖声明与文档对齐，**零代码改动**。

### 变更

- **逐包发布产物比对（rc.1 → 新线）**：
  - dsh-agent-presets：`lib/index.js` 字节级一致；仅 typert 协议增量（file 块 /
    AssistantStreamRecord）与内置 preset 组合模板升级（ptc 等系统提示拆 prefix/suffix）；
  - dsh-session：`SESSION_FORMAT_VERSION` 0→3（宿主迁移链处理，插件只消费 host API）；
    显式事件词表含本插件 seed 全部类型（`approval/policy`/`permission/preset`/
    `sandbox/mode`），surfaceOp `append` 豁免校验——seed 形状仍合法；
  - dsh-llm：纯增量（`createSystemMessage`、assistant-stream 助手），
    `BlockAssembler`/`createUserMessage` 不变；
  - dsh-compaction / dsh-permission-presets / dsh-client-modules /
    dsh-command-compact：仅 package.json 重指（lib 一致）。
- **依赖声明对齐**：peers/devDeps 升 `@deepseek-ai/dsh-agent-presets@^0.1.3-alpha.2`、
  `@deepseek-ai/dsh-llm@^0.1.5-alpha.1`（cordis `^4.0.2` 不变）；`agents.create`
  （meta.parentSession/seed/setup）与 `workspaceRegistry` 链路逐一核对未变。
- 测试套件在新线依赖下重装实跑：34+9 断言 + std 清单 ALL PASS（73 断言）。
- `dsh-plugin.json` 版本同步 1.3.2；README 徽章与兼容性节更新。

## 1.3.1 - 2026-09-04

兼容性验证轮：dsh `0.1.2-rc.1`（alpha.5 → rc.1）无破坏性变更，依赖声明与文档对齐。

### 变更

- **逐包发布产物比对（alpha.5 → rc.1）**：本插件用到的七个包（dsh-agent-presets、
  dsh-llm、dsh-session、dsh-compaction、dsh-permission-presets、dsh-client-modules、
  dsh-command-compact）lib 目录**字节级一致**，仅 package.json 版本号与依赖范围重指；
  presets 目录（standard/minimal/ptc/cordis）不变。**零代码改动**。
- **依赖声明对齐**：npm 实测 `^0.1.2-alpha.5` 范围不解析到 rc.1（semver 预发布规则），
  peers/devDeps 升至 `^0.1.2-rc.1`；cordis peer/devDep 对齐宿主树的 `^4.0.2`。
- 测试套件在 rc.1 依赖下重装实跑：34+9 断言 + std 清单 ALL PASS。
- `dsh-plugin.json` 版本同步 1.3.1；README 徽章与兼容性节更新。

## 1.3.0 - 2026-09-03

dsh `0.1.2-alpha.5` 适配轮（跨越式更新）。alpha.5 删除了本插件依赖的
`@deepseek-ai/dsh-agent-presets#resolveSessionPreset`，升级后插件被宿主停用（断点见
dsh 升级执行记录 2026-09-03）；本版为自行适配。

### 变更

- **preset 继承内联实现**：alpha.5 以 `agent-preset/selected` 事件记录挂载变更
  （事件 `data.agentPreset`，投影初始态取 `header.agentPreset`），等价实现为倒序
  扫描取最后一次选择、无事件回退 header，替代已删除的 `resolveSessionPreset`。
- **preset 别名语义反转**：alpha.5 内置 preset 为 standard/minimal/ptc/cordis，
  `code` 更名 `ptc` 且不留别名。`/fresh ptc` 现直接命中内置 id；`/fresh code`
  作为旧输入兼容映射到 `ptc`；`create`/`creator` → `cordis` 不变。
- **Compact-First 走全局压缩 seam**：alpha.5 起 `ctx.compaction` 是全局服务
  （builtin `/compact` 同款，`compactNow(agent, signal, commandId)` 调用形状不变），
  优先使用；`agentPresets.serviceFor(agent,'compaction')` 作为 rc.2 形态兜底保留。
- **移除 dsh-client-runtime 依赖**：该包在 alpha 线已停止发布（宿主树中亦已移除），
  从 peerDependencies 删除；`dsh.client` 声明移除指向它的 `inject`（client 半边
  `lib/client.js` 本就零宿主 import，`window.__ModuleLoader__.load` 注册方式与
  alpha.5 新 client-modules 机制一致）。
- 其余宿主 API 逐一核对 alpha.5 均未变：`agents.create`（seed/meta/setup 形状）、
  `workspaceRegistry.archiveSession/resolveByPath/attachSession`、
  `commands.register`、`session.requestHeader/deriveMessages`、`BlockAssembler`、
  `createUserMessage`、`agentPresets.resolve/mount`、permission seeded 分支。
- peers/devDeps 升 `^0.1.2-alpha.5`；`dsh-plugin.json` 版本同步 1.3.0。

## 1.2.10 - 2026-08-25

依赖对齐轮 + 双轨制：`@deepseek-ai/*` 升至 `0.1.1-rc.2`；新增惰性 dsh-std Community v0.15 清单。

### 变更

- **依赖对齐**：peerDependencies 与 devDependencies 统一升至 `^0.1.1-rc.2`
  （rc.7 → rc.8、rc.1 → rc.2 发布产物逐包比对均为增量变更，本插件所用 API 无变化；
  rc.2 中 `sessions.create` 收窄的参数本插件从未使用）。`@deepseek-ai/cordis` 进入
  devDependencies（测试套件需本地可解析，peer 声明不参与安装）。
- **双轨制**：新增 dsh-std Community v0.15 的 `dsh-plugin.json`（id
  `io.github.orangeofcarl0-sys.dsh-fresh-start`）与占位宿主 facet 入口 `lib/std/host.js`；
  `/fresh` 功能仍全部由原生 cordis 入口提供。未装 `@dsh-std/adapter-dsh` 时清单完全惰性；
  `contributes.commands` 刻意留空，避免适配器环境下投影出第二个 `/fresh`。
- `tests/std_manifest_test.mjs`：用 `@dsh-std/manifest@0.1.0-rc1` 的 `parseManifest`
  断言清单结构与 package.json 版本同步；接入 `npm test`；devDep 钉死 `0.1.0-rc1`。
- `README.md`：徽章新增 `dsh-std Community v0.15`（对齐 dsh-large-proj-perf）；新增
  「dsh-std 兼容性」节。

## 1.2.9 - 2026-08-22

Compact-First 总结策略（spec：`docs/COMPACT_FIRST_SPEC.md`，CFS-001/002/003）。

### 变更

- **Compact-First**：`/fresh` 总结前先尝试宿主压缩引擎（`serviceFor(agent,'compaction')` +
  `compactNow`）强制压缩当前会话；压缩成功后 `deriveMessages()` 收紧（surface
  replaceGeneration 递增），对话式总结请求体显著缩小，并复用压缩摘要。
- **安静降级**：无引擎（minimal preset）、agent busy、无可压缩范围或引擎抛错时，
  回退为 v1.2.8 纯对话式总结；所有失败捕获不冒泡。
- **可诊断**：返回文本与日志含 compaction 段（`compacted (shadowed N surface nodes)` /
  `compaction skipped (<原因>)`）。
- `compactNow` 使用 `invocation.commandId` 作为 `sourceCommandId`（审计归属）。
- `tests/smoke_test.mjs`：新增 F-02..F-05（压缩成功/无范围/失败降级/先压后总结）。
- `README.md`：总结流程说明更新。

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
- 内置四大模式均可用，并支持友好别名：`ptc` → `code`（PTC 模式）、
  `create`/`creator` → `cordis`（创造模式）；`standard`/`minimal` 直接用 id。
- 不带参数行为不变（继承当前会话的 preset）。

### 变更

- `lib/index.js`：seed knob 预置 + preset 参数解析 + 别名映射（ptc/create/creator）；命令描述更新。
- `tests/smoke_test.mjs`：seed 结构断言更新，新增 knob 预置、`/fresh <preset>`、未知 preset、
  `ptc`/`create` 别名用例。
- `README.md`：补充 `/fresh <preset>` 用法与四大模式别名表。

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
