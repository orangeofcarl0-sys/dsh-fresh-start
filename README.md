# dsh-fresh-start

[![Version](https://img.shields.io/badge/version-1.2.5-blue)]()
[![dsh](https://img.shields.io/badge/dsh-0.1.0--rc.6-green)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

DSH `/fresh` 命令：一键总结当前对话 → 开启新对话（自动跳转）→ 归档老对话。

## 用途

超大会话（数十万事件）的内存/卡顿缓解。在一个超大会话里工作一段时间后，输入
`/fresh` 即可把历史压缩成摘要、归档（释放 live 事件树内存）、开一个继承同 `cwd`
与 preset 的新对话并**自动跳转**过去继续工作——避免继续在 67 万事件的会话里反复构建上下文。

## 行为

在对话输入框输入 `/fresh`：

1. **总结**：直接提取 dsh 上传给 LLM 的**完整上下文**（`session.requestHeader()` 的
   system/tools + `session.deriveMessages()` 的全部消息），用一条简单指令让 LLM 总结成
   自然语言摘要。区别于 dsh 的 `/compact`（用工程 checkpoint 指令 + token 比较，普通
   对话上常失败）。
2. **开新对话**：`ctx.agents.create` 继承老会话的 `cwd` 与 agent preset，并把摘要作为
   新对话的开场消息（seed）。新会话的 `header.parentSession` 指向老会话。
3. **归档 + 自动跳转**：`ctx.workspaceRegistry.archiveSession` 归档老会话；配套的
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

重启 `dsh web`，日志出现 `[fresh-start] installed: /fresh command registered` 即成功。
client 插件会随 `dsh.client` 声明自动进入浏览器清单（`/plugins/dsh-fresh-start/client.js` 返回 200）。

## 验证

```sh
npm install   # 安装 devDependencies（@deepseek-ai/dsh-llm / dsh-agent-presets，来自 npm）
npm test
```

- `tests/smoke_test.mjs`（31 断言）：命令注册 / 全流程 / 总结失败降级 / 新会话失败仍归档 /
  无 workspaces 降级 / `parentSession` 标记 / 不污染 `deriveMessages()` 返回值 /
  provider-model 不完整时回退与降级 / 取消中止 / header 异常结构化报错 —— ALL PASS
- `tests/client_test.mjs`（9 断言）：归档后按 parentId 自动跳转 / pending 兜底补跳 /
  不相关归档不跳 / open 异常吞掉且不无限重试 —— ALL PASS

## 局限

- 总结依赖 `session.deriveMessages()`（dsh 上传的完整上下文），超大会话的上下文若超出
  模型窗口，总结可能失败（此时仍会开新对话 + 归档，只是新对话不带摘要）。
- 本插件与 dsh 版本高度相关（依赖 `ctx.agents.create` / `ctx.workspaceRegistry` /
  `ctx.sessions.open` 等内部 API），dsh 升级可能导致兼容性问题，请以 `0.1.0-rc.6` 为准。
