# Changelog

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
