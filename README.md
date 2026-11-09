# dsh-fresh-start

[![npm version](https://img.shields.io/npm/v/dsh-fresh-start.svg)](https://www.npmjs.com/package/dsh-fresh-start)
[![dsh](https://img.shields.io/badge/dsh-0.2.2--rc.1-green)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

DSH（DeepSeek Harness）的 `/fresh` 命令：**总结当前会话 → 开启继承摘要的新会话（自动跳转）→ 归档老会话**。

超大会话（数十万事件）的 live 事件树会持续膨胀，每次构建上下文都更慢、更占内存。`/fresh` 在归档前把仍然有用的上下文压成一份自然语言摘要，带到新会话继续工作——既释放内存，又不丢上下文。

## 目录

- [为什么需要它](#为什么需要它)
- [安装](#安装)
- [使用](#使用)
- [工作原理](#工作原理)
- [设计要点](#设计要点)
- [兼容性](#兼容性)
- [排障](#排障)
- [开发与测试](#开发与测试)
- [发布](#发布)
- [已知局限](#已知局限)
- [文档](#文档)
- [License](#license)

## 为什么需要它

DSH 会把一条会话的完整事件树保留在内存中。会话越大：

- 构建模型上下文越慢，输入框响应和流式输出更容易卡顿；
- 内存占用随事件数增长，长时间工作后压力明显；
- 原生 `/compact` 用「工程 checkpoint 指令 + token 比较」做压缩，在普通对话上经常失败（摘要不够小、模型不返回文本等）。

`/fresh` 换了一条更稳的路径：直接读取 DSH 将要上传给模型的上下文，用一条简单指令让模型写成自然语言摘要；再用这份摘要作为新会话的开场，归档旧会话。它不是压缩算法的替代品，而是「收尾并重新开始」的一键操作。

## 安装

要求：**Node.js ≥ 22**，**dsh `0.2.2-rc.1` 及以上（0.2.x 线）**。下文以 `web` profile 为例，请按实际 profile 名替换。

### 从 npm 安装（推荐）

```sh
dsh plugin --profile web add dsh-fresh-start
```

### 从 GitHub 安装

```sh
dsh plugin --profile web add github:orangeofcarl0-sys/dsh-fresh-start
```

### 更新

```sh
dsh plugin --profile web update dsh-fresh-start
```

> **npm 新版本冷却**：dsh 0.2.1 起，`dsh plugin add` 受 pnpm `minimumReleaseAge` 约束，默认不会选中刚发布的版本。需要立即安装某个版本时用精确版本号：
>
> ```sh
> dsh plugin --profile web add dsh-fresh-start@1.8.0
> ```
>
> 插件管理器会把该版本写入 profile 的 `minimumReleaseAgeExclude`，这是预期行为。

### 安装后确认

1. dsh 0.2.0 起「安装即启用」，插件会自动加入 profile 的 `dsh.profile.bundles`。
2. 重启 `dsh web`，日志出现下面这行即表示 host 半边注册成功：

   ```text
   [fresh-start] installed: /fresh command registered
   ```

3. Web 侧边栏 **Plugins** 页可查看与启停，卡片显示 `locale/` 中的标题、描述与 `icon.svg`。
4. client 半边会随 `dsh.client` 声明进入浏览器组合脚本（0.2.0 起为
   `plugins/??dsh-fresh-start/client.js&rev=…`），无需手工引入。

> 如果 profile 的 `cordis.patch.yml` 里已有本插件的手工挂载行，请先删除，否则会挂载两个实例。

## 使用

在对话输入框输入 `/fresh`，可带一个 preset 参数：

```sh
/fresh              # 继承当前会话的 preset
/fresh standard     # 用指定 preset 开新会话
```

| 输入 | 目标 preset | 模式 |
|---|---|---|
| `/fresh standard` | `standard` | 标准模式 |
| `/fresh ptc` | `ptc` | PTC 模式（Code Mode SDK） |
| `/fresh minimal` | `minimal` | 极简模式 |
| `/fresh create` / `/fresh creator` | `cordis` | 创造模式 |
| `/fresh code` | `ptc` | 旧输入兼容（`code` 已更名为 `ptc`） |

- **不带参数**：继承当前会话最近一次挂载的 preset（读取 `agent-preset/selected` 事件，回退到会话 header）。
- **带参数**：显式指定 preset。若 preset 不存在，命令直接报错，不会静默回退到继承值，也不会创建或归档任何会话。
- **参数解析成功但挂载失败**：降级为默认 preset 开新会话，并在日志中告警。

命令返回文本按实际执行的阶段拼接，例如：

```text
compacted (shadowed 128 surface nodes); summarized (4213 chars); new session session-… started (with summary); archived session-…
```

每一段都表示该阶段的结果。除归档（最后一步）外，某段显示 `skipped` / `failed` 时，后续阶段仍会继续执行。

## 工作原理

```text
/fresh
  │
  ├─ 0. 解析参数、继承 preset
  ├─ 1. Compact-First：先用宿主压缩引擎收紧上下文（失败可降级）
  ├─ 2. 对话式总结：读取 DSH 上传的上下文 → LLM → 摘要
  ├─ 3. 创建 seeded 新会话：摘要作为开场消息，标记 parentSession
  ├─ 4. 归档老会话
  └─ 5. client 侧：监听归档 → 按 parentId 匹配新会话 → 自动跳转
```

### 0. 解析参数与继承 preset

读取 `session.header.cwd`，并从事件流中倒序查找最后一次 `agent-preset/selected` 的 `data.agentPreset`；没有该事件时回退到 `header.agentPreset`。随后解析 `/fresh [preset]` 并校验目标 preset 是否存在。

### 1. Compact-First

如果当前环境提供压缩引擎，先强制压缩当前会话，让 `deriveMessages()` 收紧，后续总结请求体显著变小：

```text
engine = ctx.compaction ?? ctx.agentPresets.serviceFor(agent, 'compaction')
result = await engine.compactNow(agent, signal, commandId)
```

- 成功：返回文本记录 `compacted (shadowed N surface nodes)`；
- 引擎不存在（如 `minimal` preset）：`no compaction engine (preset lacks the compaction service)`；
- 没有可压缩范围：`compaction skipped (no compactable range)`；
- agent 忙碌或引擎抛错：`compaction skipped (<原因>)`。

以上任何一种情况都不会阻断后续总结、创建与归档。压缩对旧会话是**不可逆**的 shadow，但旧会话随后就会被归档。

### 2. 对话式总结

- 通过 `session.requestHeader()` 与 `session.deriveMessages()` 取得 DSH 当前上传的上下文；
- provider/model 优先取最近一次请求的 `header.config`，缺失时回退到 `agent.options`；
- 追加一条总结指令，经 `ctx.llm.stream` 发给模型；不传 `tools`，避免模型发起工具调用导致没有文本；
- `maxTokens: 2000`，`purpose: 'compaction'`，并透传取消信号；
- 模型返回空文本或流失败时，总结降级为「无摘要」，但流程继续。

### 3. 创建 seeded 新会话

`ctx.agents.create` 创建新会话，继承老会话的 `cwd` 与 preset（可用 `/fresh <preset>` 覆盖），并把摘要写成一段**已完成的对话轮**：

| 序号 | 事件 | 作用 |
|---|---|---|
| 0 | `permission/preset` | 预置 `workspace-write` |
| 1 | `sandbox/mode` | 预置 `workspace-write`，避免 seeded 分支回填无效值 |
| 2 | `approval/policy` | 预置 `ask` |
| 3 | `turn/start` | 让会话不被判定为 blank |
| 4 | `step/start` | 轮次结构完整 |
| 5 | `user/message` | 总结请求（`surfaceOp: append`） |
| 6 | `assistant/message` | 摘要正文（`surfaceOp: append`） |
| 7 | `step/end` | 轮次结构完整 |
| 8 | `turn/end` | `reason: completed`，历史加载正常 |

新会话的 `meta.parentSession` 指向老会话，这是 client 侧自动跳转的关联依据。创建后还会通过 `workspaceRegistry.resolveByPath(cwd).attachSession(newId)` 把新会话归属到对应 workspace。

### 4. 归档老会话

`ctx.workspaceRegistry.archiveSession(oldId)` 归档老会话，释放 live 事件树内存。归档失败只会记录在返回文本中，不会影响已经创建的新会话。

### 5. 自动跳转（client 侧）

client 插件监听 `archivedSessionIds` 的变化：发现老会话被归档后，在会话列表中查找 `parentId === 老会话 id` 的新会话并调用 `ctx.sessions.open(newId)`。

归档广播与新会话列表同步是两个通道，顺序不保证。如果归档发生时新会话尚未同步，client 会把它记入 pending；等会话列表更新后再补跳。若 `sessions.open` 本身抛错，则只告警一次并放弃，不会无限重试。

### 失败降级矩阵

| 阶段 | 失败情形 | 行为 | 返回结果 |
|---|---|---|---|
| 0 | 读取 `session.header` 异常 | 不做任何操作 | `error` |
| 0 | `/fresh <preset>` 目标不存在 | 不做任何操作 | `error` |
| 1 | 无引擎 / 忙碌 / 无范围 / 抛错 | 记录原因，继续总结 | 继续后续阶段 |
| 2 | 总结失败或空文本 | 新会话不带 seed，继续创建与归档 | 继续后续阶段 |
| 3 | 创建新会话失败 | 记录原因，仍尝试归档老会话 | `error` |
| 4 | 归档失败 | 记录原因，新会话保留 | `success`（已创建新会话时） |
| — | 总结后收到取消信号 | 不创建、不归档 | `error` |
| — | 归档前收到取消信号 | 保住老会话，返回新会话 id | `error` |

## 设计要点

- **host + client 双端**：host 负责总结、创建、归档；client 只负责归档后的自动跳转。两端通过 `parentSession` / `parentId` 关联，不需要额外服务端状态。
- **seed 是一段完整对话轮**：只有 `turn/start` 而没有 `turn/end` / 助手消息的会话会被判为 blank 或渲染异常，因此 seed 必须构成完整的 turn。
- **permission knob 前置**：seeded 会话若缺少 `sandbox/mode`，宿主会从 `ctx.shell.sandboxMode` 回填；非沙箱 shell 下该值可能是 `undefined`，产生不可序列化事件并导致创建失败。预置三个 knob 可跳过回填。
- **先创建、后归档**：创建失败时老会话仍然可用；归档失败时新会话已经存在。任何单点失败都不会同时丢掉两个会话。
- **所有阶段独立降级**：压缩、总结、创建、归档各自捕获异常，结果拼进返回文本，便于定位。
- **不在插件内持久化配置**：本插件没有 `Config`，不读写 profile 的 `cordis.patch.yml`，符合 dsh 0.2.2 起的配置持久化规范。

更细的调用链、事件结构与设计取舍见 [docs/ARCHITECTURE.md](https://github.com/orangeofcarl0-sys/dsh-fresh-start/blob/master/docs/ARCHITECTURE.md)。

## 兼容性

当前基线：**dsh `0.2.2-rc.1`**，插件版本 **1.8.0**。

- **门禁声明**：`package.json` 的 `engines.dsh` 为 `^0.2.2-rc.1`。dsh 0.2.1 起，只要插件声明了 `engines.dsh`，该范围就**单独决定**兼容性，`peerDependencies` 不再参与门禁比对；不满足时宿主会输出 `skipping profile bundle` 并整体跳过插件。
- **peer 依赖**：`@deepseek-ai/cordis ^4.1.0`、`@deepseek-ai/dsh-agent-preset-registry ^0.2.2-rc.1`、`@deepseek-ai/dsh-llm ^0.2.2-rc.1`。peer 仍保留，供包管理器解析运行时。
- **展示元数据**：`exports` 暴露 `./locale/*.json`、`./icon`、`./package.json`；`icon` 顶层字段与 `./icon` 导出都指向 `icon.svg`。宿主 `readPluginMeta` 据此生成 Plugins 页卡片。
- **client 交付**：`dsh.client.platform: "web"` + `exports["./client"]`，满足浏览器组合脚本的扫描条件。
- **配置持久化**：不读写 profile 配置，不声明 `Config`，无密钥持久化需求。

完整的版本矩阵、门禁规则、升级检查清单与历史验证结论见 [docs/COMPATIBILITY.md](https://github.com/orangeofcarl0-sys/dsh-fresh-start/blob/master/docs/COMPATIBILITY.md)。

## 排障

| 现象 | 可能原因 | 处理 |
|---|---|---|
| 启动日志没有 `[fresh-start] installed` | 插件被门禁跳过，或未加入 profile bundles | 运行 `dsh --dump-config --profile web`，检查是否有 `skipping profile bundle` 与 `- id: fresh-start` |
| `pending (waiting for services: agentPresets, workspaceRegistry)` | profile 缺少提供这两个服务的 `@deepseek-ai/dsh-web-app` | 确认 `dsh.profile.bundles` 含 `@deepseek-ai/dsh-web-app`；用完整 profile 初始化，而不是只装 base |
| `/plugins/dsh-fresh-start/client.js` 返回 404 | 0.2.0 起 client 走组合脚本，裸包路径不再响应 | 检查带 `?rev=` 的组合脚本 URL：`plugins/??…,dsh-fresh-start/client.js,…&rev=<hash>` |
| `dsh plugin add` 装到旧版本 | pnpm `minimumReleaseAge` 冷却 | 用精确版本 `dsh plugin --profile web add dsh-fresh-start@1.8.0` |
| `/fresh` 创建了新会话但没有摘要 | 总结失败（provider/model 缺失、上下文超限、模型无文本） | 看返回文本中的 `summarization failed (…)`；检查会话模型与上下文大小 |
| 新会话已创建但界面没有自动跳转 | client 半边未加载，或新会话尚未同步到会话列表 | 确认 Plugins 页 client 已启用；稍等会话列表刷新，或手动打开新会话 |
| 出现两个 `/fresh` | profile 的 `cordis.patch.yml` 手工挂载与 bundle 安装重复 | 删除手工挂载行，只保留插件管理器安装 |
| `npm publish` 返回 403 | npm 账号启用了 2FA，普通 token 不能直接发布 | 使用带 bypass-2FA 权限的 token，或交互式 OTP 发布 |
| 安装后 profile 解析不到新版本 | npm registry 可见性有延迟（发布后数分钟） | 等待 `npm view dsh-fresh-start version` 返回新版本后重试 |

## 开发与测试

```sh
npm install   # 安装 devDependencies：@deepseek-ai/dsh-llm 0.2.2-rc.1、@deepseek-ai/cordis 4.1.0
npm test
```

测试不需要构建步骤，直接运行 ESM 源码。当前共 **66 条断言**：

- `tests/smoke_test.mjs`（57 条）：命令注册、全流程、空上下文、总结失败降级、创建失败仍归档、无 `workspaceRegistry` 降级、`parentSession` 标记、不污染 `deriveMessages()`、provider/model 回退、取消中止、header 异常、preset 参数与别名、Compact-First 四个分支。
- `tests/client_test.mjs`（9 条）：归档后按 `parentId` 自动跳转、pending 兜底补跳、不相关归档不跳转、`sessions.open` 异常吞掉且不无限重试。

项目结构：

```text
dsh-fresh-start/
├── lib/
│   ├── index.js              # host：/fresh 命令
│   └── client.js             # client：归档后自动跳转
├── cordis.patch.yml          # dsh bundle 挂载清单
├── locale/{en,zh}.json       # Plugins 页显示元数据
├── icon.svg                  # Plugins 页图标
├── docs/                     # 架构、兼容性、Compact-First 规范
└── tests/                    # smoke + client 测试
```

## 发布

```sh
npm publish     # prepublishOnly 会自动执行 npm test
```

发布物由 `files` 白名单控制，只包含运行所需文件（当前实测 **10 个文件**，约 27 kB 压缩包 / 70 kB 解压后；`docs/` 与 `tests/` 不会进入安装包）：

```text
lib/index.js  lib/client.js  cordis.patch.yml  locale/en.json  locale/zh.json
icon.svg  package.json  README.md  CHANGELOG.md  LICENSE
```

发布前检查：

1. `package.json` 版本号与 CHANGELOG 一致；
2. `npm test` 全绿；
3. `npm pack --dry-run` 文件列表符合预期；
4. `engines.dsh` 与目标 dsh 版本线一致；
5. README 徽章、兼容性章节已更新。

## 已知局限

- **总结可能超出模型窗口**：总结请求包含 `deriveMessages()` 的完整上下文；超大会话若超过模型上下文上限，总结会失败。此时仍会创建新会话并归档老会话，只是新会话不带摘要。
- **总结可能不带 system 提示**：dsh 0.1.5 起，`session.requestHeader()` 的 canonical header 不再包含 `system`，系统提示改由 `createSystemMessage` / `systemPromptUpdate` 通道下发。插件会在 `system` 存在时透传，缺失时安全省略，因此总结质量可能略低于带系统提示的情况。这是已知的上游行为漂移，尚未改为从新通道提取。
- **压缩不可逆**：Compact-First 对旧会话的 shadow 是持久化事实；由于旧会话随后被归档，这属于预期副作用。
- **`minimal` preset 没有压缩引擎**：该模式下始终走纯对话式总结，行为等同于 v1.2.8。
- **自动跳转依赖 client 半边**：在 headless / CLI 场景下没有浏览器运行时，`/fresh` 仍会创建和归档会话，但不会自动切换视图。

## 文档

- [架构与实现](https://github.com/orangeofcarl0-sys/dsh-fresh-start/blob/master/docs/ARCHITECTURE.md)
- [兼容性与升级指南](https://github.com/orangeofcarl0-sys/dsh-fresh-start/blob/master/docs/COMPATIBILITY.md)
- [Compact-First 规范](https://github.com/orangeofcarl0-sys/dsh-fresh-start/blob/master/docs/COMPACT_FIRST_SPEC.md)
- [更新日志](https://github.com/orangeofcarl0-sys/dsh-fresh-start/blob/master/CHANGELOG.md)

## License

[MIT](LICENSE)
