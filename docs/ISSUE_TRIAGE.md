# Issue 自动关闭策略

> 适用仓库：[dsh-fresh-start](https://github.com/orangeofcarl0-sys/dsh-fresh-start)
> 实现：[`.github/workflows/auto-close-awaiting-response.yml`](../.github/workflows/auto-close-awaiting-response.yml)

## 目标

本侧已经回复、正在等待报告者补充信息的 issue，如果 **14 天**内没有任何人类回复，自动关闭，避免维护队列被长期挂起的 issue 占满。

自动关闭只作用于显式打了标签的 issue，不会对仓库里的所有 issue 计时。

## 标签

| 标签 | 作用 |
|---|---|
| `awaiting-response` | 本侧已回复，等待报告者回复。只有带此标签的 issue 会进入自动关闭检查 |
| `keep-open` | 永不自动关闭（长期跟踪、设计讨论等） |
| `security` | 永不自动关闭（安全相关 issue） |

首次启用时创建标签：

```sh
gh label create awaiting-response \
  --color FBCA04 \
  --description "Waiting for reporter response; auto-closes after 14 days"

gh label create keep-open \
  --color 0E8A16 \
  --description "Never auto-close"

gh label create security \
  --color D93F0B \
  --description "Security-sensitive; never auto-close"
```

## 判定规则

每天定时运行一次，逐个检查带 `awaiting-response` 的 open issue：

1. 跳过 PR、带 `keep-open` / `security` 的 issue；
2. 读取全部评论，忽略机器人评论（`user.type === "Bot"` 或 `github-actions[bot]`）；
3. 取最后一条人类评论：
   - 没有人类评论 → 跳过；
   - 最后一条来自报告者 → 跳过（轮到本侧处理，不能自动关闭）；
   - 最后一条不是 `OWNER` / `MEMBER` / `COLLABORATOR` → 跳过；
4. 最后一条维护者评论距今 **≥ 14 天** → 添加关闭说明并关闭（`state_reason: not_planned`）；
5. 否则跳过，等下一次运行。

维护者再次回复后，14 天从新的最后一条维护者评论重新计算。

## 手动运行

GitHub Actions → **Auto-close awaiting response** → **Run workflow**：

- `dry_run: true`：只输出「would close」，不发评论、不改状态；
- `dry_run: false`：执行真实关闭。

建议首次启用时先跑一次 dry run，确认名单符合预期。

## 启用步骤

1. 创建上述三个标签；
2. 将工作流文件提交到默认分支（`master`）；
3. 在 Actions 页手动运行一次 `dry_run: true`；
4. 之后按以下节奏使用：
   - 本侧回复并等待报告者 → 加 `awaiting-response`；
   - 报告者回复后 → 维护者处理时移除 `awaiting-response`（脚本本身不会误关，因为最后一条是报告者）；
   - 需要长期保留 → 加 `keep-open`。

## 边界

- 工作流只关闭 issue，不会自动重新打开；报告者回复后由维护者重新打开。
- 机器人评论不参与计时；如果最后一条人类评论是本侧维护者，才可能触发关闭。
- issue 作者本身是仓库成员时，若最后一条评论作者与 issue 作者相同，仍会跳过，避免误关自己发起的 issue。
- 定时任务使用 GitHub Actions 的 UTC cron（每天 `03:17 UTC`），实际触发可能因 Actions 队列略有延迟。
- `GITHUB_TOKEN` 只需要 `issues: write` 和 `contents: read`；工作流没有额外第三方 action。
