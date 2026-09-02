# dsh-fresh-start

[![Version](https://img.shields.io/badge/version-1.3.0-blue)]()
[![dsh](https://img.shields.io/badge/dsh-0.1.2--alpha.5-green)]()
[![dsh-std](https://img.shields.io/badge/dsh--std-Community_v0.15-blue)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

DSH（DeepSeek Harness）`/fresh` 命令：**一键总结当前对话 → 开启新对话（自动跳转）→ 归档老对话**。

## 为什么需要它

超大会话（数十万事件）工作一段时间后，live 事件树越滚越大，每次构建上下文都更慢、更占内存——
在一个 67 万事件的会话里继续工作，卡顿和内存压力会持续恶化。

`/fresh` 把这个收尾动作变成一键操作：把历史压缩成一份自然语言摘要，开一个继承当前工作环境
的新会话并把摘要作为开场消息，然后归档老会话释放内存、自动跳转到新会话继续工作。

## 快速开始

### 安装

```sh
dsh plugin --profile web add github:orangeofcarl0-sys/dsh-fresh-start
```

插件源为 GitHub 仓库（不走本地路径）。之后插件发新版，同步仓库后更新：

```sh
dsh plugin --profile web update dsh-fresh-start
```

重启 `dsh web`，日志出现 `[fresh-start] installed: /fresh command registered` 即成功。
client 插件会随 `dsh.client` 声明自动进入浏览器清单（`/plugins/dsh-fresh-start/client.js`
返回 200）。

> 若 profile 的 `cordis.patch.yml` 里已有本插件的手工挂载行，请先删除，否则会双实例。

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
│   ├── client.js       # client 侧：监听归档事件，自动跳转
│   └── std/host.js     # dsh-std 占位宿主入口（惰性，见下文）
├── cordis.patch.yml    # dsh bundle 挂载清单
├── dsh-plugin.json     # dsh-std Community v0.15 清单（惰性）
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

以 `0.1.2-alpha.5` 为准（2026-09-03 跨越式更新适配，1.3.0）。插件依赖 dsh 内部 API
（`ctx.agents.create` / `ctx.workspaceRegistry` / `ctx.sessions.open` /
`session.deriveMessages()` 等），dsh 升级可能导致兼容性问题。

1.3.0 对 alpha.5 的适配点：

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

### dsh-std（双轨制）

1.2.10 起本插件**双轨制**：

- **功能路径唯一**：`/fresh` 全部能力仍由原生 cordis 入口（`lib/index.js` +
  `cordis.patch.yml`）提供，这是唯一的功能实现路径。
- **dsh-std 清单（惰性）**：附带 dsh-std Community v0.15 的 `dsh-plugin.json`
  （std 运行时包 `@dsh-std/core` / `@dsh-std/manifest` `0.1.0-rc1`，2026-08-18），宿主
  facet 入口为占位实现 `lib/std/host.js`（空 `activate()`）。std 侧尚无 session/workspace
  生命周期协议可承载本插件能力，故 `contributes.commands` 刻意留空——避免在装有
  `@dsh-std/adapter-dsh` 的环境里向原生注册表投影第二个 `/fresh` 造成冲突。
- **默认完全惰性**：dsh 原生加载器不读取 `dsh-plugin.json`；只有显式安装
  `@dsh-std/adapter-dsh` 后清单才会被发现与校验（占位入口可通过其装载管线，空贡献 ⇒ 零投影）。
- **前向兼容**：清单在 `@dsh-std/manifest@0.1.1-rc.1` 的新版校验器下同样可解析
  （2026-08-28 实测；`@dsh-std/*` 已全线发布 0.1.1-rc.1，含 `adapter-dsh`）。

## 开发与测试

```sh
npm install   # 安装 devDependencies（@deepseek-ai/* rc.2、@dsh-std/manifest，来自 npm）
npm test
```

测试在 `@deepseek-ai/*` 依赖 `0.1.2-alpha.5` 下运行：

- `tests/smoke_test.mjs`（34 断言）：命令注册 / 全流程 / 总结失败降级 / 新会话失败仍归档 /
  无 workspaces 降级 / `parentSession` 标记 / 不污染 `deriveMessages()` 返回值 /
  provider-model 不完整时回退与降级 / 取消中止 / header 异常结构化报错 —— ALL PASS
- `tests/client_test.mjs`（9 断言）：归档后按 parentId 自动跳转 / pending 兜底补跳 /
  不相关归档不跳 / open 异常吞掉且不无限重试 —— ALL PASS
- `tests/std_manifest_test.mjs`：`dsh-plugin.json` 的 Community v0.15 结构断言
  （可解析 / 版本同步 / 入口存在）—— ALL PASS

## 已知局限

- 总结依赖 `session.deriveMessages()`（dsh 上传的完整上下文），超大会话的上下文若超出
  模型窗口，总结可能失败（此时仍会开新对话 + 归档，只是新对话不带摘要）。

## 更新日志

见 [CHANGELOG.md](CHANGELOG.md)。
