# dsh-fresh-start

[![Version](https://img.shields.io/badge/version-1.3.5-blue)]()
[![dsh](https://img.shields.io/badge/dsh-0.2.1--rc.1-green)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

DSH（DeepSeek Harness）`/fresh` 命令：**一键总结当前对话 → 开启新对话（自动跳转）→ 归档老对话**。

## 为什么需要它

超大会话（数十万事件）工作一段时间后，live 事件树越滚越大，每次构建上下文都更慢、更占内存——
在一个 67 万事件的会话里继续工作，卡顿和内存压力会持续恶化。

`/fresh` 把这个收尾动作变成一键操作：把历史压缩成一份自然语言摘要，开一个继承当前工作环境
的新会话并把摘要作为开场消息，然后归档老会话释放内存、自动跳转到新会话继续工作。

## 快速开始

### 安装

从 npm（推荐）：

```sh
dsh plugin --profile web add dsh-fresh-start
```

或直接从 GitHub 仓库安装：

```sh
dsh plugin --profile web add github:orangeofcarl0-sys/dsh-fresh-start
```

之后插件发新版，更新：

```sh
dsh plugin --profile web update dsh-fresh-start
```

安装后 dsh 会自动把它加入 profile 的 `dsh.profile.bundles`（0.2.0 起「安装即启用」）。
重启 `dsh web`，日志出现 `[fresh-start] installed: /fresh command registered` 即成功。
client 插件会随 `dsh.client` 声明进入浏览器组合脚本（0.2.0 起为
`plugins/??dsh-fresh-start/client.js&rev=…`）。

> 若 profile 的 `cordis.patch.yml` 里已有本插件的手工挂载行，请先删除，否则会双实例。
> 插件在 Web 侧边栏 **Plugins** 页可查看与启停（卡片显示 `locale/` 里的标题描述与 `icon.svg`）。

### 使用

在对话输入框输入 `/fresh`，可选带 preset 参数：

```sh
/fresh            # 继承当前会话的 preset
/fresh standard   # 用指定 preset 开新会话
```

| 输入 | 目标 preset | 模式 |
|---|---|---|
| `/fresh standard` | `standard` | 标准模式 |
| `/fresh ptc`（或旧输入 `code`） | `ptc` | PTC 模式（Code Mode SDK） |
| `/fresh minimal` | `minimal` | 极简模式 |
| `/fresh create` / `/fresh creator` | `cordis` | 创造模式 |

> dsh 0.1.2-alpha.5 把内置 `code` preset 更名为 `ptc` 且不留别名；本插件将 `ptc`
> 直接作为 preset id 使用，`code` 仅作旧输入兼容映射到 `ptc`。

指定不存在的 preset 时命令直接报错，不会静默回退到继承值。

## /fresh 的完整流程

```
/fresh ──▶ ① 压缩（Compact-First）──▶ ② 对话式总结 ──▶ ③ 创建 seeded 新会话
                                                        │
              自动跳转 ◀── ⑤ client 侧匹配 ◀── ④ 归档老会话
```

### ① 压缩（Compact-First）

若当前 preset 挂载了宿主压缩引擎（standard/code/cordis），先 `compactNow` 强制压缩当前
会话——`deriveMessages()` 跟随 surface shadow 收紧，后续总结请求体显著缩小，并直接复用
压缩摘要。引擎不可用（minimal）、agent busy、无可压缩范围或引擎抛错时安静降级为纯对话式
总结，不阻断流程（spec：`docs/COMPACT_FIRST_SPEC.md`）。

### ② 对话式总结

直接提取 dsh 上传给 LLM 的**当前上下文**（`session.requestHeader()` 的 system +
`session.deriveMessages()` 的全部消息，已压缩时为收紧后的上下文），用一条简单指令让 LLM
总结成自然语言摘要。

区别于 dsh 原生 `/compact`（用工程 checkpoint 指令 + token 比较，普通对话上常失败）：
本实现把 compact 作为前置收紧、对话总结作为最终 seed 生成器。

### ③ 创建 seeded 新会话

`ctx.agents.create` 创建新会话：继承老会话的 `cwd` 与 agent preset（`/fresh <preset>`
可覆盖），摘要作为新对话的开场消息（seed），新会话的 `header.parentSession` 指向老会话。

### ④ 归档 + ⑤ 自动跳转

`ctx.workspaceRegistry.archiveSession` 归档老会话（释放 live 事件树内存）；配套的
**client 插件**监听归档事件，按 `parentId` 找到新会话并 `ctx.sessions.open` 自动跳转过去。

**每一步独立、失败降级不阻断后续**——例如总结失败时仍会开新对话 + 归档（只是新对话不带
摘要），完整结果在命令返回文本里。

## 架构：host + client 双端

```
dsh-fresh-start/
├── lib/
│   ├── index.js        # host 侧：/fresh 命令（总结 + 创建 + 归档）
│   └── client.js       # client 侧：监听归档事件，自动跳转
├── cordis.patch.yml    # dsh bundle 挂载清单
├── docs/COMPACT_FIRST_SPEC.md
└── tests/
```

- **host 侧**（`lib/index.js`，经 `cordis.patch.yml` 挂载进 cordis bundle）：`/fresh`
  命令本体——压缩 + 总结 + 创建（带摘要 seed 与 `parentSession` 标记）+ 归档。
- **client 侧**（`lib/client.js`，随 `dsh.client` 声明进入浏览器）：监听
  `host/archived-sessions-changed`，归档发生时按 `parentId` 匹配新会话并自动
  `ctx.sessions.open` 跳转。含时序兜底：归档广播与新会话列表同步是两个通道，若新会话
  尚未同步则进 pending，等会话列表更新后补跳。

## 兼容性

### dsh 版本

以 `0.2.1-rc.1` 为准（2026-10-17 适配，1.7.0）。插件依赖 dsh 内部 API
（`ctx.agents.create` / `ctx.workspaceRegistry` / `ctx.sessions.open` /
`session.deriveMessages()` 等），dsh 升级可能导致兼容性问题。

**0.2.0-rc.2 → 0.2.1-rc.1：插件代码零改动**，按 0.2.1 更新的官方规范调整声明。

- **兼容性声明改用 `engines.dsh`（0.2.1 首选）**：0.2.1 的 `unmetRequirements`
  规定——插件若声明了自己的 `engines.dsh`，该范围**单独决定**兼容性，
  `peerDependencies` 被完全忽略；未声明时才逐项比对 `@deepseek-ai/dsh*` peers。
  本插件声明 `dsh: "^0.2.1-rc.1"`，语义更明确（peer 保留供包管理器解析）。
- **`exports` 新增 `./icon`**：0.2.1 的 display checklist 要求导出
  `./locale/*.json` 与 `./icon`；宿主 `iconOf` 优先读顶层 `icon`、缺失时回退
  `./icon` 导出，现两条路径都指向 `./icon.svg`。
- **依赖线**：peers/devDeps 升 `dsh-llm@^0.2.1-rc.1`、
  `dsh-agent-preset-registry@^0.2.1-rc.1`、cordis `^4.0.5`。
- **API 面 0.2.1 全绿**：`agentPresets`（服务名与 `resolve/mount/serviceFor` 不变）、
  `agents.create(options)`、`workspaceRegistry` 三件套、
  `compaction.compactNow(agent, signal, commandId)`、`commands.register`、
  `session.requestHeader / deriveMessages`、seed 三 knob 事件词表、
  `BlockAssembler / createUserMessage`、`dsh.client.platform:"web"`。
- **真机验证**（隔离 profile）：门禁 0 跳过、`/fresh command registered` 正常输出、
  client 组合脚本 200、宿主 `readPluginMeta` 读出双语元数据与 icon，无 error。

0.1.7-rc.2 → 0.2.0-rc.2 验证轮（1.6.0，结论见 CHANGELOG 1.6.0）：

- **peer 版本门禁（0.2.0 新增，当时的实际断点）**：宿主启动时用
  `dsh-app-boot` 的 `evaluatePluginCompatibility` 校验每个 profile bundle 的
  `package.json` 中所有 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` 前缀 peer 范围
  是否满足运行时版本（预发布参与比较）；不满足即 `skipping profile bundle` 并
  整个跳过该插件（旧版是静默加载）。1.5.1 声明的 `^0.1.7-rc.2` 对 `0.2.0-rc.2`
  不成立，故被跳过 → 当时把两个 dsh peer 升到 `^0.2.0-rc.2`。
  （0.2.1 起改用 `engines.dsh` 优先，见上。）
- **插件管理机制变化（不影响本插件形态）**：新增 `dsh-plugin-manager` 服务与
  Web 侧边栏 Plugins 页；bundle 的启用/禁用改由 profile `cordis.patch.yml` 的
  `disabled` 覆盖行管理，安装/移除走 `pnpm add`，安装后自动加入
  `dsh.profile.bundles`（安装即启用）。本插件的 `dsh.bundle.patch` +
  `dsh.client.platform` 声明与 `- insert:` patch 形态在新机制下仍然有效（与
  `dsh-checkpoint-rewind` 等在用插件一致），无需改动。
- **client 半边交付形式变化（排障须知）**：0.2.0 起 client 脚本由「每包一个
  `/plugins/<pkg>/client.js`」改为组合脚本
  `plugins/??pkg1/client.js,pkg2/client.js&rev=<hash>`；裸包路径不再响应（404 正常），
  排障时须带 `?rev=`。本插件满足新扫描条件（`dsh.client.platform:"web"` +
  `exports["./client"]`），实测已被正确组合。
- **真机端到端验证**（隔离测试 profile）：门禁放行（`--dump-config` 无 skipping
  行、patch 层进树）；真实 web 结构 profile 启动日志输出
  `[fresh-start] installed: /fresh command registered`；client 组合脚本
  `plugins/??dsh-fresh-start/client.js&rev=…` 返回 200 且内容含
  `__ModuleLoader__` 注册与跳转逻辑。headless profile 下 entry 为
  `pending (waiting for services: agentPresets, workspaceRegistry)`——这两个服务由
  web-app bundle 提供，属 profile 差异，非兼容性问题。
- **其余 API 逐一核对 0.2.0 全部健在**：`agentPresets` 服务（仍由
  `dsh-agent-preset-registry` 提供，服务名与 `resolve/mount/serviceFor` 不变）、
  `agents.create(options)`（`dsh-agent` 的 `AgentRegistry`，单对象签名）、
  `workspaceRegistry`（`archiveSession / resolveByPath / attachSession`，由
  `dsh-workspace` 提供）、`ctx.compaction.compactNow(agent, signal, commandId)`、
  `commands.register`、`session.requestHeader / deriveMessages`、seed 三 knob 事件
  仍在词表、`BlockAssembler / createUserMessage` 导出不变、`dsh.client.platform:"web"`。
  （`requestHeader()` 仍不含 `system` —— 沿用 1.3.3 记录的降级路径。）
- 依赖图进一步简化：0.2.0 下 clean install 后无需任何 `--no-save` 辅助闭包，
  66 断言（57+9）ALL PASS。

0.1.7-rc.1 → 0.1.7-rc.2 验证轮：结论见 CHANGELOG 1.5.1。

1.3.0 对 alpha.5 的适配点（沿袭仍有效）：

- `@deepseek-ai/dsh-agent-presets#resolveSessionPreset` 已删除 → 内联等价实现
  （`agent-preset/selected` 事件倒序扫描取 `data.agentPreset`，回退
  `header.agentPreset`，与宿主投影语义一致）；
- 内置 preset `code` 更名 `ptc` 且不留别名 → 别名表反转（`/fresh ptc` 直接命中
  内置 id，`/fresh code` 作旧输入兼容映射到 `ptc`）；
- compaction 变为全局服务 → Compact-First 优先 `ctx.compaction`（`/compact` 同款
  seam），rc.2 的 per-preset `serviceFor` 形态兜底；
- `@deepseek-ai/dsh-client-runtime` 在 alpha 线停止发布 → 移除 peer 依赖与
  `dsh.client.inject` 引用（client 半边零宿主 import，注册方式与 alpha.5
  client-modules 机制一致，不受影响）。

其余用到的宿主 API（`agents.create` 的 seed/meta/setup 形状、
`workspaceRegistry.archiveSession / resolveByPath / attachSession`、
`commands.register`、`session.requestHeader / deriveMessages`、`BlockAssembler` /
`createUserMessage`、`agentPresets.resolve / mount`、permission seeded 分支）逐一
核对 alpha.5 均未变。

历史：rc.7 → rc.8、rc.1 → rc.2 时代的逐包发布产物比对均为增量变更（rc.2 中
`sessions.create` 收窄的参数本插件从未使用）。

> 1.4.0 起移除了 dsh-std Community v0.15 清单（原 `dsh-plugin.json` / 占位入口 /
> 结构测试）：std 生态自 2026-08-31 后停更，其 `adapter-dsh` 的 peer 窗口
> （`>=0.1.2-alpha.2 <0.1.3`）与本插件当前宿主线（0.1.5）不兼容，该轨道从未在真实
> 宿主中生效；待生态恢复并补齐协议后再评估接入。移除不影响 `/fresh` 任何功能。

## 开发与测试

```sh
npm install   # 安装 devDependencies（@deepseek-ai/dsh-llm 0.2.1-rc.1 + cordis 4.0.5，来自 npm）
npm test
```

测试在 `@deepseek-ai/*` 依赖 `0.2.1-rc.1` 下运行（依赖图不含 agent-presets，
无需额外补装）：

- `tests/smoke_test.mjs`（57 断言）：命令注册 / 全流程 / 总结失败降级 / 新会话失败仍归档 /
  无 workspaces 降级 / `parentSession` 标记 / 不污染 `deriveMessages()` 返回值 /
  provider-model 不完整时回退与降级 / 取消中止 / header 异常结构化报错 —— ALL PASS
- `tests/client_test.mjs`（9 断言）：归档后按 parentId 自动跳转 / pending 兜底补跳 /
  不相关归档不跳 / open 异常吞掉且不无限重试 —— ALL PASS

## 已知局限

- 总结依赖 `session.deriveMessages()`（dsh 上传的完整上下文），超大会话的上下文若超出
  模型窗口，总结可能失败（此时仍会开新对话 + 归档，只是新对话不带摘要）。

## 发布

包已按 dsh 官方 bundle 规范与 npm 发布惯例准备，可直接 `npm publish`：

```sh
npm publish        # prepublishOnly 会自动跑测试；发布到 npm 公共 registry
```

发布物（`npm pack --dry-run` 可核对）：`lib/`（host + client）、`cordis.patch.yml`、
`locale/*.json`（Plugin Manager 卡片显示文本）、`icon.svg`、README/LICENSE/CHANGELOG。

关键声明与官方规范对齐：

- `dsh.bundle.patch` 指向 `cordis.patch.yml`（bundle 挂载）；
- `dsh.client.platform: "web"` + `exports["./client"]`（浏览器半边交付条件）；
- `exports` 暴露 `./locale/*.json` 与 `./package.json`（宿主 `readPluginMeta` 经子路径
  读取显示元数据与图标，缺任一项卡片就退化为默认文案）；
- `icon` 为相对路径（SVG ≤256 KiB），发布时由宿主内联为 data URI；
- `peerDependencies` 精确声明 dsh 运行时线（0.2.0 起有 peer 门禁，范围不符会被
  `skipping profile bundle` 整体跳过）；
- `engines.node >= 22`、`publishConfig.access: "public"`。

## 更新日志

见 [CHANGELOG.md](CHANGELOG.md)。
