# Changelog

本文件记录 `dsh-fresh-start` 的所有重要变更。

- 格式：[Keep a Changelog 1.1.0](https://keepachangelog.com/zh-CN/1.1.0/)
- 版本号：[Semantic Versioning](https://semver.org/lang/zh-CN/)
- 日期格式：`YYYY-MM-DD`
- 兼容基线、门禁规则与升级检查清单见 [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md)

## [Unreleased]

### 文档

- 全面重构项目文档：
  - `README.md` 重写为入口指南（安装、使用、流程、设计要点、兼容性、排障、开发、发布、局限）；
  - 新增 `docs/ARCHITECTURE.md`，记录 host/client 调用链、seed 事件模型、跨端握手与设计决策；
  - 新增 `docs/COMPATIBILITY.md`，记录版本矩阵、宿主门禁规则、升级 SOP、排障手册与历史验证结论；
  - `docs/COMPACT_FIRST_SPEC.md` 从「待实现」更新为 as-built（全局 compaction 优先、`serviceFor` 兜底、接口返回字符串）；
  - `CHANGELOG.md` 统一为 Keep a Changelog 结构，保留全部版本事实。
- 代码、依赖声明与发布物零改动。

## [1.8.0] - 2026-11-06

适配 dsh `0.2.2-rc.1`。**插件代码零改动**，依赖声明与规范核对同步。

### 变更

- `engines.dsh` 升至 `^0.2.2-rc.1`。
- peers/devDeps 的 `dsh-agent-preset-registry`、`dsh-llm` 升至 `^0.2.2-rc.1`。
- `@deepseek-ai/cordis` 升至 `^4.1.0`（宿主树 4.0.5 → 4.1.0）。
- 官方规范 `cordis-plugin-development` 有实质更新（`host-plugin.md` 5300 → 6883 字节）：
  - 新增「Persist your own configuration」：插件不得读写 profile 的 `cordis.patch.yml`，须经 `configEditor`（`ctx.fiber.entry` + `ctx.get('configEditor').edit()`）修改自身配置；密钥使用 `ctx.credentials`。
  - display checklist 新增英文标题 sentence case 要求（如 `Git worktrees`）。
  - 模板目录 `locale` 由单文件改为目录形式。

### 背景

- 0.2.2-rc.1 的插件相关变化：插件管理页支持更新第三方插件包、热更新失败时自动恢复旧版本；支持富文本详情；会话列表支持插件图标。

### 验证

- **完整链路复核（rc.1 实测全部未变）**：`unmetRequirements` 门禁（`engines.dsh` 优先）、`iconOf` 双路径、locale 子路径解析、client 扫描条件、`agentPresets`（服务名 + `resolve/mount/serviceFor`）、`agents.create(options)`、`workspaceRegistry` 三件套、`compactNow(agent, signal, commandId)`、`commands.register`、`requestHeader/deriveMessages`、seed 事件词表、`BlockAssembler/createUserMessage`。
- **规范符合性**：英文标题 `Fresh Start` 已是 sentence case；双语 locale、顶层 `icon` 与 `./icon` 导出、`files` 覆盖均符合；插件不读写 profile 配置、不声明 `Config`、无持久化需求。
- **真机端到端验证**（隔离 profile）：npm 安装 1.7.2 → 门禁 0 跳过 → entry 进组合树 → `[fresh-start] installed: /fresh command registered` → client 组合脚本 200（2.5 MB）→ `readPluginMeta` 双语元数据 + icon 无 error。
- 66 断言（57+9）ALL PASS。

## [1.7.2] - 2026-10-24

适配 dsh `0.2.1-rc.3`。发布说明仅 UI 改进（侧栏「更多」菜单）与草稿修复，**官方插件规范与 rc.2 字节相同**；本轮做完整链路复核 + 声明对齐。

### 变更

- `engines.dsh` 升至 `^0.2.1-rc.3`。
- peers/devDeps 的 `dsh-agent-preset-registry`、`dsh-llm` 升至 `^0.2.1-rc.3`（cordis 保持 `^4.0.5`）。

### 验证

- 门禁、icon、locale、client 扫描四条机制链与全部运行时 API 在 rc.3 实测未变。
- 隔离 profile 端到端：安装 → 门禁 0 跳过 → entry 进组合树 → 启动日志 → client 组合脚本 200 → `readPluginMeta` 无 error。
- 66 断言（57+9）ALL PASS。

### 排障记录

- 首次验证时 entry 报 `pending (waiting for services: agentPresets, workspaceRegistry)`。排查确认不是兼容性问题，而是测试 profile 的 `dsh.profile.bundles` 只有 `["@deepseek-ai/dsh-base", "dsh-fresh-start"]`，缺少提供这两个服务的 `@deepseek-ai/dsh-web-app`。补齐后立即正常激活。
- `--from-default-profile web` 初始化被中断时可能留下不完整的 bundles 列表；遇到此类 pending 应先核对 bundles 是否含 `web-app`。

## [1.7.1] - 2026-10-17

适配 dsh `0.2.1-rc.2`。rc.2 是模型/Search API 适配的小版本，**官方插件规范与 rc.1 完全一致**；本轮做完整链路复核 + 声明对齐。

### 变更

- `engines.dsh` 升至 `^0.2.1-rc.2`。
- peers/devDeps 的 `dsh-agent-preset-registry`、`dsh-llm` 升至 `^0.2.1-rc.2`（cordis 保持 `^4.0.5`）。

### 验证

- 门禁、icon、locale、client 扫描与全部运行时 API 在 rc.2 实测未变。
- 隔离 profile 端到端通过；66 断言（57+9）ALL PASS。

### 发现

- **pnpm 新版本冷却策略**（0.2.1 起）：`dsh plugin add <pkg>` 默认不会安装刚发布不久的版本（1.7.0 发布约 8 小时后仍解析到 1.6.1）。需要最新版时用精确版本 `dsh plugin add <pkg>@<version>`，插件管理器会把它写入 profile 的 `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude`。这是预期行为，不是插件缺陷。

## [1.7.0] - 2026-10-17

适配 dsh `0.2.1-rc.1`，按 0.2.1 更新后的官方插件规范升级。**插件代码零改动**。

### 变更

- **兼容性声明改用 `engines.dsh`**：0.2.1 的 `unmetRequirements` 规定「own `engines.dsh` 存在时单独决定兼容性，`peerDependencies` 被完全忽略」。现声明 `engines: { node: ">=22", dsh: "^0.2.1-rc.1" }`，peer 保留供包管理器解析。
- **`exports` 新增 `./icon`**：display checklist 要求导出 `./locale/*.json` 与 `./icon`；宿主 `iconOf` 优先读顶层 `icon`、缺失时回退 `./icon` 导出，两条路径都指向 `icon.svg`。
- **依赖线对齐**：peers/devDeps 升 `dsh-llm@^0.2.1-rc.1`、`dsh-agent-preset-registry@^0.2.1-rc.1`、cordis `^4.0.5`。

### 验证

- `agentPresets` 服务名与 `resolve/mount/serviceFor` 不变；`agents.create(options)`、`workspaceRegistry` 三件套、`compactNow(agent, signal, commandId)`、`commands.register`、`requestHeader/deriveMessages`、seed 事件词表、`BlockAssembler/createUserMessage`、`dsh.client.platform:"web"` 全部健在。
- 隔离 profile 端到端通过；66 断言（57+9）ALL PASS。

### 背景

0.2.1 的插件管理变化：新增自定义插件索引源；插件启用/停用/卸载/更新后自动同步依赖，HMR 开启时可替换插件直接生效；可选插件支持极简模式；新增实验性 Session 状态记录接口。

## [1.6.1] - 2026-10-11

npm 发布准备：按 dsh 官方 bundle 规范与权威插件形态补齐发布元数据。

### 新增

- **Plugin Manager 显示元数据**：`locale/en.json` + `locale/zh.json`（`meta.title` / `meta.description`）与 `icon.svg`；`package.json` 增加顶层 `icon` 字段、`exports` 暴露 `./locale/*.json` 与 `./cordis.patch.yml`。宿主 `readPluginMeta` 经 `${specifier}/locale/en.json` 子路径解析，缺则卡片退化为默认文案。

### 变更

- 发布元数据：`engines.node >= 22`、`publishConfig.access: "public"`、`prepublishOnly` 自动跑测试。
- `files` 补 `locale/*.json` / `icon.svg` / `README.md` / `LICENSE` / `CHANGELOG.md`。

### 验证

- `npm pack --dry-run` 产出 10 文件 / 23.0 kB。
- tarball 装入隔离 profile 实测：门禁 0 跳过、`[fresh-start] installed: /fresh command registered` 正常输出、locale 与 icon 就位。
- 用宿主 `readPluginMeta` 实测：双语标题描述与 icon data URI 均正确读出。

### 文档

- README 安装节新增 npm 渠道与 Plugins 页说明；新增「发布」章节记录发布物与官方规范对应关系。

## [1.6.0] - 2026-09-30

适配 dsh `0.2.0-rc.2`（大版本更新）。**唯一破坏点是 0.2.0 新增的 peer 版本门禁**，插件代码零改动；peer 声明升级即可恢复加载。

### 修复

- **peer 版本门禁**：宿主启动时经 `dsh-app-boot` 的 `evaluatePluginCompatibility` 校验每个 profile bundle 的 `peerDependencies` 中所有 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` 范围是否满足运行时版本（预发布参与比较，`includePrerelease: true`）；不满足则 `skipping profile bundle` 并整体跳过（旧版静默加载）。1.5.1 的 `^0.1.7-rc.2` 对 `0.2.0-rc.2` 不成立，插件被跳过。修复为把两个 dsh peer 升到 `^0.2.0-rc.2`；`@deepseek-ai/cordis` 无 `dsh-` 前缀，不参与校验（保持 `^4.0.4`）。

### 变更

- client 半边交付形式变化（不影响本插件，但排障须知）：0.2.0 起 client 脚本由「每包一个 `/plugins/<pkg>/client.js`」改为组合脚本 `plugins/??pkg1/client.js,pkg2/client.js&rev=<hash>`；裸包路径不再响应（404 属正常），排障时须带 `?rev=`。
- 新增 `dsh-plugin-manager` 服务与 Web 侧边栏 Plugins 页；bundle 启用/禁用改由 profile `cordis.patch.yml` 的 `disabled` 覆盖行管理，安装/移除走 `pnpm add`，安装后自动加入 `dsh.profile.bundles`。
- 本插件的 `dsh.bundle.patch` + `dsh.client.platform` 声明与 `- insert:` patch 形态在新机制下仍然有效。

### 验证

- 隔离测试 profile 端到端：门禁放行（`--dump-config` 无 skipping 行、patch 层进树）；真实 web 结构 profile 启动日志输出 `[fresh-start] installed: /fresh command registered`；client 组合脚本返回 200 / 3420 B；headless profile 下 entry 为 `pending (waiting for services: agentPresets, workspaceRegistry)`——这两个服务由 web-app bundle 提供，属 profile 差异。
- 其余 API 在 0.2.0 下逐一核对全部健在；66 断言（57+9）ALL PASS。
- 依赖图简化：0.2.0 下 clean install 后无需任何 `--no-save` 辅助闭包。

## [1.5.1] - 2026-09-13

兼容性验证轮：dsh `0.1.7-rc.2`。无破坏性变更，**零代码改动**，仅依赖声明与文档对齐。

### 变更

- peers/devDeps 升 `^0.1.7-rc.2`；cordis 保持 `^4.0.4`。

### 验证

- 逐包发布产物比对（0.1.7-rc.1 → rc.2）：
  - `dsh-llm`：纯增量（`createDeveloperMessage`、`projectToolUpdates`、tool 声明/工具历史助手）；`BlockAssembler` / `createUserMessage` 不变。
  - `dsh-agent-preset-registry`：服务名与 `resolve / mount / serviceFor` 不变；`list()` 默认选中策略简化（移除 `modeSelectionEnabled`，回退 `selectedDefault ?? default`），本插件不消费。
  - `dsh-session`：新增 tool-history 折叠与类型；核心 API 与 seed 事件词表未变。
  - `dsh-permission-presets`：Auto preset approval 策略 `never` → `ask`；本插件 seed 预置 `workspace-write`/`ask`，seeded 分支不变。
  - `dsh-compaction` / `dsh-client-modules` / `dsh-command-compact`：仅 `package.json` 重指。
- 66 断言（57+9）ALL PASS。

## [1.5.0] - 2026-09-12

适配 dsh `0.1.7-rc.1`：宿主包拆分、cordis 升 4.0.4、内置 preset 数据格式迁移。**零代码改动**，依赖声明迁移 + 文档。

### 变更

- **宿主包拆分**：`@deepseek-ai/dsh-agent-presets` 拆为 `dsh-agent-preset`（agent facet）与 `dsh-agent-preset-registry`（服务提供方）。新 registry 仍以 `super(ctx, "agentPresets")` 注册服务，`resolve / mount / serviceFor / list` 签名不变。本插件自 1.3.0 起不再 import 该包，代码零改动；peer/devDeps 迁移到 `dsh-agent-preset-registry ^0.1.7-rc.1`。
- **cordis 4.0.2 → 4.0.4**：本插件声明同步 `^4.0.4`。
- **内置 preset 数据迁移**：`agent.cordis.yml` → `dsh-web-app/presets/*.patch.yml`，preset id 不变，`/fresh <preset>` 与别名映射不受影响。
- compaction 实现仍在 `dsh-compaction-basic`，`compactNow(agent, signal, commandId)` 调用形状与返回字段同前。

### 验证

- `requestHeader / deriveMessages`、seed 事件词表、permission seeded 分支、`dsh.client.platform:"web"`、`commands.register`、`agents.create`（seed/setup/meta.parentSession）、`workspaceRegistry` 三件套逐一核对未变。
- 依赖图简化：agent-presets 退出后，测试安装只需 cordis + dsh-llm；66 断言（57+9）ALL PASS。

## [1.4.0] - 2026-09-11

移除 dsh-std 轨道（1.2.10 双轨制引入的惰性清单）。`/fresh` 功能零影响。

### 移除

- `dsh-plugin.json`（Community v0.15 清单）、`lib/std/host.js`（占位宿主 facet 入口）、`tests/std_manifest_test.mjs`。
- `package.json` 同步清除 files/keywords（`dsh-std`、`community-v0.15`）/devDependencies（`@dsh-std/manifest`）与 test 脚本项。
- README 移除 dsh-std 徽章与章节。

### 理由

- std 生态自 2026-08-31 后停更（core/composition 停在 0.1.0-rc1）；`adapter-dsh@0.1.1-rc.2` 的 peer 窗口为 `>=0.1.2-alpha.2 <0.1.3`，与本插件当时的宿主线（`0.1.5-rc.2`）不兼容——该轨道从未在真实宿主中生效（清单始终惰性，占位入口空贡献）。保留仅剩发版同步成本与误导性宣传。

### 重新评估条件

- `@dsh-std/adapter-dsh` 发布支持 0.1.5+ 宿主的版本，且 std 侧补齐可承载 session/workspace 生命周期能力的协议后。

### 验证

- 测试套件精简为 smoke（57）+ client（9）共 66 断言，ALL PASS。

## [1.3.5] - 2026-09-11

兼容性验证轮：dsh `0.1.5-rc.2`。无破坏性变更，**零代码改动**。

### 变更

- peers/devDeps 升 `^0.1.5-rc.2`；cordis `^4.0.2` 不变。

### 验证

- 本插件用到的七个包发布产物逐字节比对，lib 与全部数据目录完全一致，仅 package.json 版本号与依赖范围重指。
- 73 断言（34+9+std）ALL PASS（当时仍含 dsh-std 测试）。

## [1.3.4] - 2026-09-10

兼容性验证轮：dsh `0.1.5-rc.1`。无破坏性变更，**零代码改动**。

### 变更

- peers/devDeps 升 `^0.1.5-rc.1`；cordis `^4.0.2` 不变。

### 验证

- 逐包比对（0.1.5-alpha.1 → rc.1）：
  - `dsh-session`：事件词表仅新增 `deliverables/presented`、`subagent/catalog`；seed 所用 `approval/policy` / `permission/preset` / `sandbox/mode` 仍在词表；`canonicalHeader` 仍未含 `system`。
  - `dsh-agent-presets`：`lib/index.js` 字节级一致；仅内置 preset 组合数据与 typert 协议文件更新。
  - `dsh-llm`：仅 typert 协议文件。
  - `dsh-compaction` / `dsh-permission-presets` / `dsh-client-modules` / `dsh-command-compact`：仅 `package.json` 重指。
- 73 断言（34+9+std）ALL PASS。

## [1.3.3] - 2026-09-09

兼容性验证轮：dsh `0.1.5-alpha.1`。无破坏性变更，**零代码改动**。

### 变更

- peers/devDeps 的 `@deepseek-ai/dsh-agent-presets` 升至 `^0.1.5-alpha.1`；`dsh-llm` 保持 `^0.1.5-alpha.1`；cordis `^4.0.2` 不变。

### 验证

- 逐包比对（0.1.3-alpha.2 → 0.1.5-alpha.1）：
  - `dsh-agent-presets`：`lib/index.js` 字节级一致；typert 协议为增量与类型调整（`SurfaceIntent` 仍含 `surfaceOp`；`EpochHeader.system` 移除；Inbox 接口化），不影响运行时。
  - `dsh-permission-presets`：仅文档与 `package.json`（seeded 分支不变）。
  - `dsh-client-modules`：宿主连线重构（webServer 变可选 carrier），`window.__ModuleLoader__` 契约不变。
  - `dsh-llm/session/compaction/command-compact`：无变化。
- `session.header.{cwd,parentSession,agentPreset}` 校验与 `agents.create` 链路逐一核对未变。
- 73 断言（34+9+std）ALL PASS。

### 记录

- **已知上游行为漂移**：0.1.5 起 `session.requestHeader()` 的 canonical header 不再含 `system`（系统提示迁移到 `createSystemMessage` / `systemPromptUpdate` 通道）。插件条件透传安全降级——总结请求将不含 system 提示；若需带 system 总结，可改经新通道提取（列为待办，未实现）。

## [1.3.2] - 2026-09-08

兼容性验证轮：dsh 子包双线（`agent-presets` / `permission-presets` / `client-modules` 为 `0.1.3-alpha.2`；`dsh-llm` / `session` / `compaction` / `command-compact` 为 `0.1.5-alpha.1`）。**零代码改动**。

### 变更

- peers/devDeps 升 `@deepseek-ai/dsh-agent-presets@^0.1.3-alpha.2`、`@deepseek-ai/dsh-llm@^0.1.5-alpha.1`；cordis `^4.0.2` 不变。

### 验证

- `dsh-agent-presets`：`lib/index.js` 字节级一致；仅 typert 协议增量（file 块 / AssistantStreamRecord）与内置 preset 组合模板升级。
- `dsh-session`：`SESSION_FORMAT_VERSION` 0 → 3（宿主迁移链处理）；显式事件词表含本插件 seed 全部类型；`surfaceOp append` 豁免校验。
- `dsh-llm`：纯增量（`createSystemMessage`、assistant-stream 助手）；`BlockAssembler` / `createUserMessage` 不变。
- `dsh-compaction` / `dsh-permission-presets` / `dsh-client-modules` / `dsh-command-compact`：仅 `package.json` 重指。
- `agents.create`（`meta.parentSession` / seed / setup）与 `workspaceRegistry` 链路逐一核对未变。
- 73 断言（34+9+std）ALL PASS。

## [1.3.1] - 2026-09-04

兼容性验证轮：dsh `0.1.2-rc.1`（alpha.5 → rc.1）。无破坏性变更，**零代码改动**。

### 变更

- 本插件用到的七个包 lib 目录字节级一致，仅 `package.json` 版本号与依赖范围重指；presets 目录不变。
- peers/devDeps 升至 `^0.1.2-rc.1`；cordis peer/devDep 对齐宿主树的 `^4.0.2`。
- 预发布版本的范围解析在不同 npm / semver 版本下可能有差异，因此显式升级范围，不依赖旧范围继续匹配。

### 验证

- 测试套件在 rc.1 依赖下重装实跑：73 断言（34+9+std）ALL PASS。

## [1.3.0] - 2026-09-03

dsh `0.1.2-alpha.5` 适配轮（跨越式更新）。alpha.5 删除了本插件依赖的 `@deepseek-ai/dsh-agent-presets#resolveSessionPreset`，升级后插件被宿主停用；本版为自行适配。

### 变更

- **preset 继承内联实现**：alpha.5 以 `agent-preset/selected` 事件记录挂载变更（事件 `data.agentPreset`，投影初始态取 `header.agentPreset`）。等价实现为倒序扫描取最后一次选择、无事件回退 header，替代已删除的 `resolveSessionPreset`。
- **preset 别名语义反转**：alpha.5 内置 preset 为 `standard/minimal/ptc/cordis`，`code` 更名 `ptc` 且不留别名。`/fresh ptc` 直接命中内置 id；`/fresh code` 作为旧输入兼容映射到 `ptc`；`create`/`creator` → `cordis` 不变。
- **Compact-First 走全局压缩 seam**：alpha.5 起 `ctx.compaction` 是全局服务（与 `/compact` 同款，`compactNow(agent, signal, commandId)` 调用形状不变），优先使用；`agentPresets.serviceFor(agent,'compaction')` 作为 rc.2 形态兜底保留。
- **移除 dsh-client-runtime 依赖**：该包在 alpha 线已停止发布，从 peerDependencies 删除；`dsh.client` 声明移除指向它的 `inject`（client 半边零宿主 import，`window.__ModuleLoader__.load` 注册方式与 alpha.5 client-modules 机制一致）。
- peers/devDeps 升 `^0.1.2-alpha.5`。

### 验证

- `agents.create`（seed/meta/setup 形状）、`workspaceRegistry.archiveSession/resolveByPath/attachSession`、`commands.register`、`session.requestHeader/deriveMessages`、`BlockAssembler`、`createUserMessage`、`agentPresets.resolve/mount`、permission seeded 分支逐一核对 alpha.5 均未变。

## [1.2.10] - 2026-08-25

依赖对齐轮 + 双轨制。`@deepseek-ai/*` 升至 `0.1.1-rc.2`；新增惰性 dsh-std Community v0.15 清单（1.4.0 已移除）。

### 变更

- peerDependencies 与 devDependencies 统一升至 `^0.1.1-rc.2`。rc.7 → rc.8、rc.1 → rc.2 发布产物逐包比对均为增量变更，本插件所用 API 无变化。
- `@deepseek-ai/cordis` 进入 devDependencies（测试套件需本地可解析，peer 声明不参与安装）。
- **双轨制**：新增 dsh-std Community v0.15 的 `dsh-plugin.json`（id `io.github.orangeofcarl0-sys.dsh-fresh-start`）与占位宿主 facet 入口 `lib/std/host.js`；`/fresh` 功能仍全部由原生 cordis 入口提供。`contributes.commands` 刻意留空，避免适配器环境下投影出第二个 `/fresh`。
- `tests/std_manifest_test.mjs`：用 `@dsh-std/manifest@0.1.0-rc1` 的 `parseManifest` 断言清单结构与 package.json 版本同步。
- README 徽章新增 dsh-std Community v0.15，新增「dsh-std 兼容性」节。

## [1.2.9] - 2026-08-22

Compact-First 总结策略（规范：[docs/COMPACT_FIRST_SPEC.md](docs/COMPACT_FIRST_SPEC.md)，CFS-001/002/003）。

### 新增

- **Compact-First**：`/fresh` 总结前先尝试宿主压缩引擎（`serviceFor(agent,'compaction')` + `compactNow`）强制压缩当前会话；压缩成功后 `deriveMessages()` 收紧（surface `replaceGeneration` 递增），对话式总结请求体显著缩小，并复用压缩摘要。
- **安静降级**：无引擎（`minimal` preset）、agent busy、无可压缩范围或引擎抛错时，回退为纯对话式总结；所有失败捕获不冒泡。
- **可诊断**：返回文本与日志含 compaction 段（`compacted (shadowed N surface nodes)` / `compaction skipped (<原因>)`）。
- `compactNow` 使用 `invocation.commandId` 作为 `sourceCommandId`（审计归属）。
- `tests/smoke_test.mjs` 新增 F-02..F-05（压缩成功/无范围/失败降级/先压后总结）。

### 文档

- 新增 `docs/COMPACT_FIRST_SPEC.md`；README 总结流程说明更新。

## [1.2.8] - 2026-08-22

修复极简模式（`minimal` preset）下 `/fresh` 无法创建新会话；新增 `/fresh <preset>` 参数。

### 修复

- **seeded 会话创建崩溃（非沙箱 shell）**：
  - 症状：`/fresh` 报 `new session FAILED (session event "sandbox/mode" carries non-JSON-serializable data)`。
  - 根因：seed 会话走 `dsh-permission-presets` 的 `pinInitialPermission()` seeded 分支，因 seed 里没有 `sandbox/mode` 事件，回填 `ctx.shell.sandboxMode`；在非沙箱 shell（如 `dsh-bash-local`）上该值为 `undefined`，`setSandboxMode(session, undefined)` 追加的事件无法通过 `session.append` 的 JSON 序列化校验。
  - 修复：seed 事件序列前置 `permission/preset` + `sandbox/mode` + `approval/policy`（`workspace-write` / `workspace-write` / `ask`），seeded 分支读到有效 sandbox 值后跳过回填。

### 新增

- `/fresh <preset>`：新会话使用指定 preset（覆盖继承值）。
- 指定不存在的 preset 时命令明确报错，不静默回退。
- 别名：`code` → `ptc`（旧输入兼容）、`create`/`creator` → `cordis`；`standard` / `minimal` 直接用 id。

### 变更

- `lib/index.js`：seed knob 预置 + preset 参数解析 + 别名映射；命令描述更新。
- `tests/smoke_test.mjs`：seed 结构断言更新，新增 knob 预置、`/fresh <preset>`、未知 preset、`ptc`/`create` 别名用例。
- README 补充 `/fresh <preset>` 用法与别名表。

## [1.2.7] - 2026-08-20

兼容性验证轮：dsh `0.1.0-rc.8`。无破坏性变更，依赖声明与文档对齐。

### 验证

- `dsh-llm`：新增 `interruptedBlocks()`、图片超限卸载常量、重试默认值 2 → 5；`BlockAssembler.push/finish/blocks()` 与 `createUserMessage` 不变。
- `dsh-session`：仅新增 `turn/end` 可选 `interrupted` 标记与 4 个 team 事件类型；`requestHeader()` / `deriveMessages()` 不变。
- `dsh-client-runtime`：`prompt` 新增可选 `signal` 参数与路径缩写辅助函数；client 插件接口（`__ModuleLoader__` / `archivedSessionIds` / `parentId` / `sessions.open`）不变。
- `dsh-app-boot`：仅新增一个平台常量；`dsh-cordis-client-runner`：slots 契约文案与新增槽位，与本插件注入无关。
- `dsh-agent-presets` / `dsh-agent` / `dsh-scope` / `dsh-base` / `dsh-workspace` / `dsh-command-compact`：代码零变化。
- harness 主包：依赖无移除，preset 配置仅注释文案调整，preset id 不变。

### 变更

- peers/devDeps 更新为 `^0.1.0-rc.8`。
- README 的 dsh badge 与「局限」更新为 rc.8 并记录比对结论；源码注释版本引用同步。
- 40 断言 ALL PASS。

## [1.2.6] - 2026-08-18

兼容性验证轮：dsh `0.1.0-rc.7`。无破坏性变更，依赖声明与文档对齐。

### 验证

- `dsh-llm`：新增 `assembled()`（返回 `{blocks, replay}`）；`BlockAssembler.push/finish/blocks()` 与 `createUserMessage` 不变。
- `dsh-agent-presets` / `dsh-agent` / `dsh-session` / `dsh-scope` / `dsh-base` / `dsh-app-boot` / `dsh-workspace` / `dsh-command-compact`：代码零变化。
- `dsh-client-runtime`：仅删除一个 settings 错误码 schema；client 插件接口不变。
- `dsh-cordis-client-runner`：唯一变更为 `slots` 注入的 keyed 化重构（`settings.plugin.item`），与本插件注入无关。
- harness 主包 lib 产物与 rc.6 逐字节一致。

### 变更

- peers/devDeps 更新为 `^0.1.0-rc.7`。
- README 的 dsh badge 与「局限」更新为 rc.7；行为描述与源码注释对齐「总结请求不传 tools」。
- 40 断言 ALL PASS。

## [1.2.5] - 2026-08-16

代码审查修复轮：补全依赖声明与测试基建，收紧 host/client 两侧的健壮性。

### 修复

- **依赖与测试基建**：`peerDependencies` 补齐 `@deepseek-ai/dsh-llm` 与 `@deepseek-ai/dsh-agent-presets`（`^0.1.0-rc.6`）；新增 `devDependencies` 与 `npm test` 脚本。此前新克隆环境下 smoke 测试因缺依赖无法运行。
- **host 侧**：
  - `deriveMessages()` 返回值改为防御性拷贝，不再可能就地污染会话内部数组；
  - provider/model 严格校验：`header.config` 存在但缺 provider/model 时回退到 agent 选项；
  - `session.header` 前置读取容错，异常时返回结构化 `{kind:'error'}`；
  - 新增取消检查点（开新会话前 / 归档前）；归档前取消会保住老会话并在结果文本中说明；
  - 总结请求不再向 LLM 传 `tools`，消除模型发起 tool call 导致总结无文本的失败路径；
  - 删除从未使用的 `disposers` 死代码。
- **client 侧**：`tryOpenChild` 三态返回（`opened` / `missing` / `failed`）；`sessions.open` 抛错后不再于每次会话列表更新时无限重试，改为告警一次后放弃。

### 测试与文档

- smoke 31 断言 / client 9 断言，新增用例覆盖全部新行为。
- README：版本 badge 对齐 package.json、断言数更正、补充 `npm install && npm test` 说明。
- 新增本 CHANGELOG。
