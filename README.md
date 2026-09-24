# dsh-fresh-start

[![Version](https://img.shields.io/badge/version-1.3.5-blue)]()
[![dsh](https://img.shields.io/badge/dsh-0.1.7--rc.1-green)]()
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

以 `0.1.7-rc.1` 为准（2026-09-12 验证轮，1.5.0）。插件依赖 dsh 内部 API
（`ctx.agents.create` / `ctx.workspaceRegistry` / `ctx.sessions.open` /
`session.deriveMessages()` 等），dsh 升级可能导致兼容性问题。

0.1.5-rc.2 → 0.1.7-rc.1 验证结论：

- **宿主包拆分（唯一破坏点，对插件为声明级）**：`@deepseek-ai/dsh-agent-presets`
  拆为 `dsh-agent-preset`（agent facet）与 `dsh-agent-preset-registry`（服务提供方）。
  新 registry 注册的 cordis 服务名仍为 `agentPresets`（`super(ctx, "agentPresets")`），
  `resolve / mount / serviceFor / list` 方法签名不变——本插件自 1.3.0 起已不 import
  该包（仅使用注入服务），故**零代码改动**，仅 peer/devDeps 迁移到
  `dsh-agent-preset-registry ^0.1.7-rc.1`；
- **cordis 4.0.2 → 4.0.4**（dsh-llm peer 为 `~4.0.4`）→ 声明同步 `^4.0.4`；
- **内置 preset 数据迁移**：从 YAML 组合（`agent.cordis.yml`）改为
  `dsh-web-app/presets/*.patch.yml`（cordis/minimal/ptc/standard），**preset id 不变**，
  `/fresh <preset>` 与别名映射照常；
- **compaction**：实现仍在 `dsh-compaction-basic`，`ctx.compaction.compactNow(agent,
  signal, commandId)` 调用形状与返回（`shadowedSeqs` / `shadowedTokenCount` /
  `summarySeq`）不变；
- 其余逐一核对未变：`session.requestHeader / deriveMessages`、seed 的
  `approval/policy` / `permission/preset` / `sandbox/mode` 仍在事件词表、
  permission seeded 分支、`dsh.client.platform:"web"`、`commands.register`、
  `agents.create`（seed/setup/meta.parentSession）、workspaceRegistry 三件套。
  （`requestHeader()` 仍不含 `system` —— 沿用 1.3.3 记录的降级路径。）

0.1.5-rc.1 → 0.1.5-rc.2 验证轮：七个依赖包 lib 与数据目录逐字节一致，结论见
CHANGELOG 1.3.5。

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
npm install   # 安装 devDependencies（@deepseek-ai/dsh-llm 0.1.7-rc.1 线 + cordis 4.0.4，来自 npm）
npm test
```

测试在 `@deepseek-ai/*` 依赖 `0.1.7-rc.1` 线下运行（1.5.0 起依赖图不再含
agent-presets，无需额外补装）：

- `tests/smoke_test.mjs`（57 断言）：命令注册 / 全流程 / 总结失败降级 / 新会话失败仍归档 /
  无 workspaces 降级 / `parentSession` 标记 / 不污染 `deriveMessages()` 返回值 /
  provider-model 不完整时回退与降级 / 取消中止 / header 异常结构化报错 —— ALL PASS
- `tests/client_test.mjs`（9 断言）：归档后按 parentId 自动跳转 / pending 兜底补跳 /
  不相关归档不跳 / open 异常吞掉且不无限重试 —— ALL PASS

## 已知局限

- 总结依赖 `session.deriveMessages()`（dsh 上传的完整上下文），超大会话的上下文若超出
  模型窗口，总结可能失败（此时仍会开新对话 + 归档，只是新对话不带摘要）。

## 更新日志

见 [CHANGELOG.md](CHANGELOG.md)。
