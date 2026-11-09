# 兼容性与升级指南

> 适用版本：dsh-fresh-start `1.8.0`。
> 当前基线：dsh `0.2.2-rc.1`（0.2.x 线，含后续预发布）。
> 实现细节见 [ARCHITECTURE.md](ARCHITECTURE.md)；用户安装与使用见 [README](../README.md)。

## 目录

- [1. 兼容性策略](#1-兼容性策略)
- [2. 版本矩阵](#2-版本矩阵)
- [3. 宿主门禁规则](#3-宿主门禁规则)
- [4. 插件面契约](#4-插件面契约)
- [5. 安装与发布机制](#5-安装与发布机制)
- [6. 升级检查清单（SOP）](#6-升级检查清单sop)
- [7. 排障手册](#7-排障手册)
- [8. 历史验证结论](#8-历史验证结论)

## 1. 兼容性策略

- **版本号**：遵循 Semantic Versioning。兼容性适配轮升 minor 或 patch；破坏性变更升 major。
- **每轮验证**：dsh 每个发布线（含 rc）做一次完整适配轮——核对官方插件规范、逐项验证宿主机制链、在隔离 profile 中做端到端测试，然后升级声明。
- **支持范围**：当前插件只承诺与 `engines.dsh` 声明的范围兼容（`0.2.x` 线）。更早的 `0.1.x` 宿主线不再由最新版插件支持；需要旧宿主时使用对应历史版本（见 §2）。
- **dsh 本身处于预发布阶段**：宿主 API 可能在任何 rc 中变化，因此插件每次适配都会重新核对实际安装树，而不是只改版本号。

## 2. 版本矩阵

| 插件版本 | 日期 | dsh 基线 | 性质 |
|---|---|---|---|
| 1.8.0 | 2026-11-06 | 0.2.2-rc.1 | 规范更新适配（配置持久化、sentence case、cordis 4.1.0）；代码零改动 |
| 1.7.2 | 2026-10-24 | 0.2.1-rc.3 | 链路复核；规范与 rc.2 字节相同；代码零改动 |
| 1.7.1 | 2026-10-17 | 0.2.1-rc.2 | 链路复核；发现 pnpm 新版本冷却；代码零改动 |
| 1.7.0 | 2026-10-17 | 0.2.1-rc.1 | 改用 `engines.dsh`；新增 `./icon` 导出；代码零改动 |
| 1.6.1 | 2026-10-11 | 0.2.0-rc.2 | npm 发布准备：locale/icon/发布元数据；代码零改动 |
| 1.6.0 | 2026-09-30 | 0.2.0-rc.2 | 新增 peer 版本门禁；升级 peer 声明；代码零改动 |
| 1.5.1 | 2026-09-13 | 0.1.7-rc.2 | 逐包产物比对；依赖声明对齐；代码零改动 |
| 1.5.0 | 2026-09-12 | 0.1.7-rc.1 | 宿主包拆分（agent-presets → registry）；代码零改动 |
| 1.4.0 | 2026-09-11 | 0.1.5-rc.2 | 移除 dsh-std 轨道；`/fresh` 功能不变 |
| 1.3.5 | 2026-09-11 | 0.1.5-rc.2 | 逐包产物比对；依赖声明对齐；代码零改动 |
| 1.3.4 | 2026-09-10 | 0.1.5-rc.1 | 逐包产物比对；依赖声明对齐；代码零改动 |
| 1.3.3 | 2026-09-09 | 0.1.5-alpha.1 | 逐包产物比对；记录 system prompt 漂移；代码零改动 |
| 1.3.2 | 2026-09-08 | 0.1.3-alpha.2 / 0.1.5-alpha.1 | 子包双线；依赖声明对齐；代码零改动 |
| 1.3.1 | 2026-09-04 | 0.1.2-rc.1 | 逐包产物字节一致；依赖声明对齐；代码零改动 |
| 1.3.0 | 2026-09-03 | 0.1.2-alpha.5 | 跨越式更新适配：preset 继承内联、别名反转、全局 compaction、移除 client-runtime |
| 1.2.10 | 2026-08-25 | 0.1.1-rc.2 | 依赖对齐；引入 dsh-std 双轨（1.4.0 已移除） |
| 1.2.9 | 2026-08-22 | 0.1.1-rc.2 | Compact-First 总结策略 |
| 1.2.8 | 2026-08-22 | 0.1.1-rc.2 | 修复 seeded 会话创建崩溃；新增 `/fresh <preset>` |
| 1.2.7 | 2026-08-20 | 0.1.0-rc.8 | 逐包产物比对；依赖声明对齐；代码零改动 |
| 1.2.6 | 2026-08-18 | 0.1.0-rc.7 | 逐包产物比对；依赖声明对齐；代码零改动 |
| 1.2.5 | 2026-08-16 | 0.1.0-rc.6 | 代码审查修复；补齐依赖与测试基建 |

> 1.2.5 之前的版本未留下完整变更记录。

## 3. 宿主门禁规则

dsh 0.2.0 起，`dsh-app-boot` 在启动时校验每个 profile bundle 的兼容性；不满足时输出 `skipping profile bundle` 并**整体跳过**该插件（0.1.x 是静默加载）。

### 3.1 判定顺序

```text
if (package.json.engines.dsh 存在)
    ok = semver.satisfies(runtimeVersion, engines.dsh, { includePrerelease: true })
else
    ok = 所有 @deepseek-ai/dsh / @deepseek-ai/dsh-* peer
         均满足 semver.satisfies(runtimeVersion, range, { includePrerelease: true })
```

关键点：

- **`engines.dsh` 优先且排他**：只要声明了它，`peerDependencies` 就完全不参与门禁判定。
- **无 `engines.dsh` 时逐个检查 peer**：只检查包名以 `@deepseek-ai/dsh` 或 `@deepseek-ai/dsh-` 开头的依赖；`@deepseek-ai/cordis` 不带 `dsh-` 前缀，不参与校验。
- **预发布参与比较**：门禁使用 `includePrerelease: true`，所以 `^0.2.2-rc.1` 能接受 `0.2.3-rc.1` 这类后续 0.2.x 预发布。
- **任一 peer 不满足即整体跳过**：不是逐个包降级，而是整个插件不加载。

### 3.2 本插件的声明

```json
"engines": {
  "node": ">=22",
  "dsh": "^0.2.2-rc.1"
}
```

`peerDependencies` 仍保留：

```json
"@deepseek-ai/cordis": "^4.1.0",
"@deepseek-ai/dsh-agent-preset-registry": "^0.2.2-rc.1",
"@deepseek-ai/dsh-llm": "^0.2.2-rc.1"
```

peer 的作用是让包管理器解析运行时依赖；门禁只看 `engines.dsh`。

### 3.3 例外与诊断

- 临时豁免：`dsh plugin allow-version <pkg>@<ver>` 可把某插件加入豁免列表。
- 诊断命令：

  ```sh
  dsh --dump-config --profile web
  ```

  检查输出中是否有 `skipping profile bundle`，以及组合树中是否存在 `- id: fresh-start`。
- 常见误判：声明了 `engines.dsh` 却仍去改 `peerDependencies`，对门禁没有影响。

### 3.4 版本范围的写法建议

- 每轮适配**显式**把 `engines.dsh` 与 peer 范围升级到目标版本，不依赖旧范围继续匹配。
- 预发布版本的 semver 解析在不同 npm / semver 版本下可能有差异；显式升级是最稳妥的做法。
- 不要写 `*` 或过宽的 `>=0.1`：这会掩盖真实的 API 不兼容。

## 4. 插件面契约

### 4.1 运行时 API

| API | 提供方 | 本插件用途 |
|---|---|---|
| `ctx.commands.register(def)` | 宿主命令注册表 | 注册 `/fresh` |
| `ctx.agentPresets.resolve(id)` | `dsh-agent-preset-registry` | 校验 preset、取规范 id |
| `ctx.agentPresets.mount(agentCtx, id)` | `dsh-agent-preset-registry` | 新会话挂载 preset |
| `ctx.agentPresets.serviceFor(agent, 'compaction')` | `dsh-agent-preset-registry` | 压缩引擎兜底 |
| `ctx.compaction.compactNow(agent, signal, commandId)` | `dsh-compaction-basic` | Compact-First |
| `ctx.agents.create(options)` | `dsh-agent` | 创建 seeded 会话 |
| `ctx.workspaceRegistry.archiveSession(id)` | `dsh-workspace` | 归档老会话 |
| `ctx.workspaceRegistry.resolveByPath(cwd)` | `dsh-workspace` | 解析 workspace |
| `workspace.attachSession(id)` | `dsh-workspace` | 新会话归属 |
| `session.requestHeader()` | `dsh-session` | 取 `config` / `system` |
| `session.deriveMessages()` | `dsh-session` | 取上传上下文 |
| `ctx.llm.stream(options)` | `dsh-llm` | 总结请求 |
| `BlockAssembler` / `createUserMessage` | `dsh-llm` | 聚合流、构造消息 |
| `ctx.workspaces.list` / `ctx.sessions.list` / `ctx.sessions.open` | dsh Web client runtime | 归档监听与跳转 |

### 4.2 包形态契约

| 声明 | 值 | 作用 |
|---|---|---|
| `dsh.bundle.patch` | `./cordis.patch.yml` | 告诉宿主如何把插件插入 cordis 组合树 |
| `cordis.patch.yml` | `- insert: - id: fresh-start, name: dsh-fresh-start` | 实际挂载项 |
| `dsh.client.platform` | `"web"` | client 半边只在 Web 平台加载 |
| `exports["./client"]` | `./lib/client.js` | client 组合脚本的入口 |
| `exports["./package.json"]` | `./package.json` | 宿主读取包元数据 |

### 4.3 展示元数据契约

| 项 | 位置 | 要求 |
|---|---|---|
| 标题/描述 | `locale/en.json`、`locale/zh.json` 的 `meta.title` / `meta.description` | 宿主经 `${specifier}/locale/en.json` 子路径读取；缺失时卡片退化为默认文案 |
| 英文标题风格 | `locale/en.json` | sentence case，例如 `Fresh Start` |
| 图标 | 顶层 `icon` 字段；缺失时回退 `./icon` 导出 | SVG / PNG / JPEG / WebP，≤ 256 KiB，必须位于包内 |
| 子路径导出 | `exports["./locale/*.json"]`、`exports["./icon"]` | 缺任一项，宿主读不到对应资源 |

### 4.4 发布物契约

`files` 白名单只包含运行所需文件：

```text
lib/  cordis.patch.yml  locale/*.json  icon.svg  README.md  LICENSE  CHANGELOG.md
```

`npm pack --dry-run` 当前实测为 10 个文件、约 27 kB 压缩包 / 70 kB 解压后（1.8.0 发布时为 27.7 kB / 75.0 kB）。`tests/`、`docs/`、`node_modules/` 不会进入安装包。

## 5. 安装与发布机制

### 5.1 pnpm 新版本冷却

dsh 0.2.1 起，`dsh plugin add <pkg>` 受 pnpm `minimumReleaseAge` 约束，默认不会选中刚发布不久的版本。表现是：npm 上已有新版本，但 `dsh plugin add` 仍解析到旧版本。

处理方式：使用精确版本。

```sh
dsh plugin --profile web add dsh-fresh-start@1.8.0
```

插件管理器会把该版本写入 profile 的 `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude`。这是预期行为，不是插件缺陷。

### 5.2 npm 发布可见性延迟

`npm publish` 返回 `+ dsh-fresh-start@x.y.z` 后，registry 的版本列表可能仍有数分钟延迟。发布后不要立刻用 `npm view` 判定失败，轮询到新版本出现再执行安装。

### 5.3 2FA 与发布权限

npm 账号启用 2FA 时，普通 token 发布会返回 403。需要使用带 bypass-2FA 权限的 token，或交互式 OTP。

### 5.4 安装即启用

dsh 0.2.0 起，`dsh plugin add` 会自动把包加入 profile 的 `dsh.profile.bundles`。不需要手工编辑 profile 的 `cordis.patch.yml`；手工再挂一次会产生两个 `/fresh` 实例。

## 6. 升级检查清单（SOP）

每轮 dsh 更新后按以下顺序执行：

1. **确认版本**
   - 本机 `dsh --version`；
   - npm 上的目标版本与 dist-tag；
   - 当前插件版本与 `engines.dsh`。

2. **阅读发布说明**
   - 逐条筛出与插件相关的变更：插件管理、插件规范、client 交付、会话/压缩/命令 API。

3. **核对官方规范**
   - 对比 dsh 内置 `cordis-plugin-development` skill 的文件大小与内容，尤其 `host-plugin.md`；
   - 关注新增章节（例如 0.2.2 的「Persist your own configuration」）与 display checklist 变化。

4. **核对机制链**
   - 门禁：`unmetRequirements` 的 `engines.dsh` 优先级；
   - 展示：`iconOf` 的双路径、locale 子路径解析；
   - client：`dsh.client.platform` + `exports["./client"]` 扫描条件；
   - 组合：`dsh.bundle.patch` 与 `- insert:` patch 形态。

5. **核对 API**
   - 按 §4.1 逐项 grep 实际安装树，确认服务名、方法签名、返回形状未变；
   - 注意默认值或错误类型的变化（例如 permission preset 的 approval 策略）。

6. **隔离环境端到端验证**
   - 使用独立的 `DSH_HOME` / 测试 profile，不触碰生产 profile；
   - 从 npm 或 tarball 安装目标版本；
   - `dsh --dump-config` 确认零跳过、entry 进组合树；
   - 启动 web profile，确认 `[fresh-start] installed: /fresh command registered`；
   - 请求 client 组合脚本，确认 200 且内容含 `__ModuleLoader__`；
   - 调用宿主 `readPluginMeta`，确认双语标题、描述与 icon 均正确。

7. **升级与回归**
   - 更新 `engines.dsh`、peer/devDeps、cordis 范围；
   - `npm install` 后运行 `npm test`（66 条断言）；
   - 更新 README 徽章与兼容性章节、CHANGELOG；
   - 提交；只有收到明确推送指令后才 push / publish；
   - 本机用精确版本重新安装，重启 `dsh web` 验证。

## 7. 排障手册

| 现象 | 根因 | 处理 |
|---|---|---|
| 日志没有 `[fresh-start] installed` | 门禁跳过，或插件不在 profile bundles | `dsh --dump-config --profile web` 查 `skipping profile bundle` 与 `- id: fresh-start`；核对 `engines.dsh` |
| `pending (waiting for services: agentPresets, workspaceRegistry)` | profile 缺少 `@deepseek-ai/dsh-web-app` | 确认 `dsh.profile.bundles` 含 `@deepseek-ai/dsh-web-app`；用完整 default profile 初始化 |
| `/plugins/dsh-fresh-start/client.js` 404 | 0.2.0 起 client 走组合脚本 | 检查 `plugins/??…,dsh-fresh-start/client.js,…&rev=<hash>` |
| `dsh plugin add` 装到旧版本 | pnpm `minimumReleaseAge` 冷却 | 用精确版本 `dsh-fresh-start@x.y.z` |
| `/fresh` 有新会话但无摘要 | 总结失败：provider/model 缺失、上下文超限、模型无文本 | 看返回文本的 `summarization failed (…)`；检查会话模型与上下文大小 |
| 新会话已创建但未自动跳转 | client 未加载，或会话列表尚未同步 | 确认 Plugins 页 client 已启用；等待列表刷新或手动打开 |
| 出现两个 `/fresh` | 手工 patch 与 bundle 安装重复 | 删除 profile `cordis.patch.yml` 中的手工挂载行 |
| `npm publish` 403 | 2FA 限制 | 使用 bypass-2FA token 或 OTP |
| 安装后仍解析旧版本 | registry 可见性延迟 | 等 `npm view dsh-fresh-start version` 返回新版本 |
| 总结质量下降 / 缺少系统提示 | dsh 0.1.5 起 canonical header 不再含 `system` | 已知上游漂移；插件在 `system` 存在时透传，缺失时省略 |

## 8. 历史验证结论

### 8.1 dsh 0.2.2-rc.1（插件 1.8.0）

- 发布说明中的插件相关变化：插件管理支持更新第三方插件包、热更新失败自动恢复旧版本、插件管理页富文本详情、会话列表支持插件图标。
- 官方规范 `cordis-plugin-development` 实质性更新：`host-plugin.md` 5300 → 6883 字节。
  - 新增「Persist your own configuration」：插件不得读写 profile 的 `cordis.patch.yml`，须经 `configEditor`（`ctx.fiber.entry` + `ctx.get('configEditor').edit()`）修改自身配置；密钥使用 `ctx.credentials`。
  - display checklist 新增英文标题 sentence case 要求。
  - 模板中的 `locale` 由单文件改为目录形式。
- cordis 4.0.5 → 4.1.0。
- 四条机制链（门禁、icon、locale、client 扫描）与全部运行时 API 未变。
- 隔离 profile 端到端验证通过；本插件不读写 profile 配置、不声明 `Config`，天然符合新规范。

### 8.2 dsh 0.2.1 线（插件 1.7.0–1.7.2）

- 0.2.1-rc.1：引入 `engines.dsh` 优先规则与 `./icon` 导出要求；插件改用 `engines.dsh`。
- 0.2.1-rc.2：模型与 Search API 适配；官方规范与 rc.1 字节相同；发现 pnpm 新版本冷却。
- 0.2.1-rc.3：仅 UI 改进与草稿修复；官方规范与 rc.2 字节相同。
- 排障记录：测试 profile 的 `dsh.profile.bundles` 缺少 `@deepseek-ai/dsh-web-app` 时，entry 会停在 `pending (waiting for services: agentPresets, workspaceRegistry)`；补齐后正常激活。这是 profile 差异，不是兼容性问题。

### 8.3 dsh 0.2.0-rc.2（插件 1.6.0）

- **唯一破坏点**：0.2.0 新增 peer 版本门禁。1.5.1 的 peer 范围 `^0.1.7-rc.2` 不满足 `0.2.0-rc.2`，插件被 `skipping profile bundle` 整体跳过。修复为把两个 dsh peer 升到 `^0.2.0-rc.2`。
- client 交付改为组合脚本，裸包路径 404 属正常。
- 新增 `dsh-plugin-manager` 服务与 Web Plugins 页；安装/移除走 `pnpm add`，安装即加入 `dsh.profile.bundles`。
- 其余 API 逐一核对全部健在。

### 8.4 dsh 0.1.7 线（插件 1.5.0–1.5.1）

- 0.1.7-rc.1：`dsh-agent-presets` 拆分为 `dsh-agent-preset` 与 `dsh-agent-preset-registry`；服务名与 `resolve / mount / serviceFor` 不变，插件代码零改动。
- 0.1.7-rc.2：逐包产物比对为增量变更；permission preset 的 Auto approval 策略由 `never` 改为 `ask`，本插件 seed 预置 `workspace-write` / `ask`，不受影响。

### 8.5 dsh 0.1.2–0.1.5（插件 1.3.0–1.3.5）

- 0.1.2-alpha.5：`resolveSessionPreset` 删除（内联为事件倒序扫描 + header 回退）；`code` preset 更名 `ptc`；compaction 变为全局服务；`dsh-client-runtime` 停止发布。这是本插件历史上最大的一次代码适配。
- 0.1.2-rc.1：七个依赖包 lib 与数据目录字节级一致，仅版本重指。
- 0.1.3-alpha.2 / 0.1.5-alpha.1：`SESSION_FORMAT_VERSION` 0 → 3；事件词表只增不减；seed 所用事件类型全部仍在词表。
- 0.1.5 起：`session.requestHeader()` 的 canonical header 不再含 `system`，系统提示迁移到 `createSystemMessage` / `systemPromptUpdate` 通道；插件安全降级为省略 `system`。

### 8.6 dsh 0.1.0 rc.6–rc.8（插件 1.2.5–1.2.7）

- 逐包比对均为增量变更：dsh-llm 新增 `interruptedBlocks()` / `assembled()` 等，`BlockAssembler` 与 `createUserMessage` 不变；dsh-session 新增事件类型，`requestHeader / deriveMessages` 不变；client runtime 的 `__ModuleLoader__` 契约不变。
- 插件代码零改动，仅升级依赖声明。
