# dsh-fresh-start

[![Version](https://img.shields.io/badge/version-1.0.0-blue)]()
[![dsh](https://img.shields.io/badge/dsh-0.1.0--rc.6-green)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

DSH `/fresh` 命令：一键总结当前对话 → 开启新对话 → 归档老对话。

## 用途

超大会话（数十万事件）的内存/卡顿缓解。在一个超大会话里工作一段时间后，输入
`/fresh` 即可把历史压缩成摘要、归档（释放 live 事件树内存）、开一个继承同 `cwd`
与 preset 的新对话继续工作——避免继续在 67 万事件的会话里反复构建上下文。

## 行为

在对话输入框输入 `/fresh`：

1. **总结**：`ctx.compaction.compactNow` 复用 dsh 的手动压缩通道，把早期历史替换为
   一条摘要节点。
2. **开新对话**：`ctx.agents.create` 继承老会话的 `cwd` 与 agent preset，挂载同一
   preset。
3. **归档**：`ctx.workspaces.archiveSession` 把老会话移入归档集，释放其事件树内存。

每步独立、失败降级不阻断后续（例如 compaction 因 busy 失败时仍会开新对话 + 归档），
完整结果在命令返回文本里。

## 安装

```sh
dsh plugin --profile web add github:orangeofcarl0-sys/dsh-fresh-start
```

重启 `dsh web`，日志出现 `[fresh-start] installed: /fresh command registered` 即成功。

## 验证

- `tests/smoke_test.mjs`（17 断言）：命令注册 / 全流程 / compact null / busy 降级 /
  新会话失败仍归档 / 无 workspaces 降级 / 无 presets 继承 —— ALL PASS

## 局限

- compaction 需要 agent 空闲（若在流式生成中触发会报 busy，此时仍会开新对话 + 归档，
  但不会产生摘要）。
- 「开新对话」后 UI 不会自动跳转——新会话会出现在侧栏，点一下即可。命令结果里携带
  `sessionId`，前端可据此做自动切换（如需）。
