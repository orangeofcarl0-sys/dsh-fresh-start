# dsh-fresh-start

[![Version](https://img.shields.io/badge/version-1.2.10-blue)]()
[![dsh](https://img.shields.io/badge/dsh-0.1.1--rc.2-green)]()
[![dsh-std](https://img.shields.io/badge/dsh--std-Community_v0.15-blue)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

DSH `/fresh` 命令：一键总结当前对话 → 开启新对话（自动跳转）→ 归档老对话。

## 用途

超大会话（数十万事件）的内存/卡顿缓解。在一个超大会话里工作一段时间后，输入
`/fresh` 即可把历史压缩成摘要、归档（释放 live 事件树内存）、开一个继承同 `cwd`
与 preset 的新对话并**自动跳转**过去继续工作——避免继续在 67 万事件的会话里反复构建上下文。

## 行为

在对话输入框输入 `/fresh`（可带可选参数 `/fresh <preset>`）：

1. **压缩（Compact-First）**：若当前 preset 挂载了宿主压缩引擎（standard/code/cordis），
   先 `compactNow` 强制压缩会话——`deriveMessages()` 跟随 surface shadow 收紧，
   后续总结请求体显著缩小并复用压缩摘要。引擎不可用（minimal）、agent busy、
   无可压缩范围或失败时安静降级，不阻断流程（spec：`docs/COMPACT_FIRST_SPEC.md`）。
2. **总结**：直接提取 dsh 上传给 LLM 的**当前上下文**（`session.requestHeader()` 的
   system + `session.deriveMessages()` 的全部消息，已压缩时为收紧后的上下文），
   用一条简单指令让 LLM 总结成自然语言摘要。区别于 dsh 的 `/compact`（用工程
   checkpoint 指令 + token 比较，普通对话上常失败）；本实现把 compact 作为前置
   收紧、对话总结作为最终 seed 生成器。
3. **开新对话**：`ctx.agents.create` 继承老会话的 `cwd` 与 agent preset，并把摘要作为
   新对话的开场消息（seed）。新会话的 `header.parentSession` 指向老会话。
   可选参数 `/fresh <preset>` 用指定 preset 覆盖继承值（例如在极简模式下
   `/fresh standard` 直接开一个 standard 新会话并带上摘要）；preset 不存在或
   不可用时命令直接报错，不会静默回退。四大内置模式都可用，且支持友好别名：

   | 输入 | 目标 preset | 模式 |
   |---|---|---|
   | `/fresh standard` | `standard` | 标准模式 |
   | `/fresh ptc` | `code` | PTC 模式（Code Mode SDK） |
   | `/fresh minimal` | `minimal` | 极简模式 |
   | `/fresh create` / `/fresh creator` | `cordis` | 创造模式 |
4. **归档 + 自动跳转**：`ctx.workspaceRegistry.archiveSession` 归档老会话；配套的
   **client 插件**（`lib/client.js`）监听归档事件，找到 `parentId === 归档会话` 的新会话
   并 `ctx.sessions.open` 自动跳转过去。

每步独立、失败降级不阻断后续（例如总结失败时仍会开新对话 + 归档），完整结果在命令
返回文本里。

## 双端结构

- **host 侧**（`lib/index.js`）：`/fresh` 命令，总结 + 创建（带摘要 seed + `parentSession` 标记）+ 归档。
- **client 侧**（`lib/client.js`）：监听 `host/archived-sessions-changed`，归档发生时按
  `parentId` 匹配新会话并自动 `ctx.sessions.open` 跳转。含时序兜底：归档广播与新会话
  列表同步是两个通道，若新会话尚未同步则进 pending，等会话列表更新后补跳。

## 安装

```sh
dsh plugin --profile web add github:orangeofcarl0-sys/dsh-fresh-start
```

插件源为 GitHub 仓库（不走本地路径），之后 dsh 发新版只需同步仓库再更新：

```sh
dsh plugin --profile web update dsh-fresh-start
```

重启 `dsh web`，日志出现 `[fresh-start] installed: /fresh command registered` 即成功。
client 插件会随 `dsh.client` 声明自动进入浏览器清单（`/plugins/dsh-fresh-start/client.js` 返回 200）。

## 验证

```sh
npm install   # 安装 devDependencies（@deepseek-ai/* rc.2、@dsh-std/manifest，来自 npm）
npm test
```

测试在 `@deepseek-ai/*` 依赖 `0.1.1-rc.2` 下运行。

- `tests/smoke_test.mjs`（31 断言）：命令注册 / 全流程 / 总结失败降级 / 新会话失败仍归档 /
  无 workspaces 降级 / `parentSession` 标记 / 不污染 `deriveMessages()` 返回值 /
  provider-model 不完整时回退与降级 / 取消中止 / header 异常结构化报错 —— ALL PASS
- `tests/client_test.mjs`（9 断言）：归档后按 parentId 自动跳转 / pending 兜底补跳 /
  不相关归档不跳 / open 异常吞掉且不无限重试 —— ALL PASS
- `tests/std_manifest_test.mjs`：`dsh-plugin.json` 的 Community v0.15 结构断言
  （可解析 / 版本同步 / 入口存在）—— ALL PASS

## dsh-std 兼容性

1.2.10 起本插件**双轨制**：

- **功能路径唯一**：`/fresh` 全部能力仍由原生 cordis 入口（`lib/index.js` +
  `cordis.patch.yml`）提供，这是唯一的功能实现路径。
- **dsh-std 清单（惰性）**：附带 dsh-std Community v0.15 的 `dsh-plugin.json`
  （std 运行时包 `@dsh-std/core` / `@dsh-std/manifest` `0.1.0-rc1`，2026-08-18），宿主
  facet 入口为占位实现 `lib/std/host.js`（空 `activate()`）。std 侧尚无 session/workspace
  生命周期协议可承载本插件能力，故 `contributes.commands` 刻意留空——避免在装有
  `@dsh-std/adapter-dsh` 的环境里向原生注册表投影第二个 `/fresh` 造成冲突。
- **默认完全惰性**：dsh 原生加载器不读取 `dsh-plugin.json`；只有显式安装
  `@dsh-std/adapter-dsh` 后清单才会被发现与校验（占位入口可通过其装载管线，
  空贡献 ⇒ 零投影）。
- **结构断言**：`tests/std_manifest_test.mjs` 用 `@dsh-std/manifest` 的 `parseManifest`
  校验清单可解析、版本与 package.json 同步、入口文件存在。
- **前向兼容**：清单在 `@dsh-std/manifest@0.1.1-rc.1` 的新版校验器下同样可解析
  （2026-08-28 实测；`@dsh-std/*` 已全线发布 0.1.1-rc.1，含 `adapter-dsh`）。

## 局限

- 总结依赖 `session.deriveMessages()`（dsh 上传的完整上下文），超大会话的上下文若超出
  模型窗口，总结可能失败（此时仍会开新对话 + 归档，只是新对话不带摘要）。
- 本插件与 dsh 版本高度相关（依赖 `ctx.agents.create` / `ctx.workspaceRegistry` /
  `ctx.sessions.open` 等内部 API），dsh 升级可能导致兼容性问题，请以 `0.1.1-rc.2` 为准。
  已对相邻版本做过逐包发布产物比对（rc.7 → rc.8、rc.1 → rc.2）：均为增量变更，
  不影响本插件使用的 API（rc.2 中 `sessions.create` 收窄的参数本插件从未使用）；
  测试套件在 rc.2 依赖下全部通过。
