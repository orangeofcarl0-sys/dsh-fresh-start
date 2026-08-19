// dsh-fresh-start — client half (browser)
//
// 配合 host 侧的 `/fresh` 命令：当老会话被归档时，自动把当前视图切换到
// `/fresh` 刚创建的新会话。
//
// 机制（dsh 0.1.0-rc.8 源码级）：
//   - host 侧 `/fresh` 用 `meta.parentSession = 老会话id` 创建新会话，于是新会话
//     的 header.parentSession 指向老会话，client 侧 summary 暴露为 `parentId`。
//   - 归档老会话时 host 广播 `host/archived-sessions-changed`，client 的
//     workspaces 运行时更新 `archivedSessionIds`（快照 store 触发订阅）。
//   - 本插件监听归档变化，找出「parentId === 新归档会话id」的新会话，调用
//     `ctx.sessions.open(id)` 跳转。
//
// 时序兜底：归档广播与新会话的会话列表同步是两个通道，顺序不保证。因此若
// 归档时新会话尚未出现在 sessions.list，先记入 pending，等 sessions.list 更新
// 后再补跳。
//
// 浏览器 bundle 约定：必须以 `window.__ModuleLoader__.load({ id, factory })` 注册，
// id 为包名（dsh-fresh-start），factory 返回 `{ apply, inject }`。

window.__ModuleLoader__.load({
  id: 'dsh-fresh-start',
  factory: function (require) {
    const inject = ['sessions', 'workspaces']

    function apply(ctx) {
      const disposers = []
      let prevArchived = new Set(ctx.workspaces.list.getSnapshot().archivedSessionIds ?? [])
      const pending = new Set()

      // 尝试打开「父会话 == parentId」的新会话。
      // 返回 'opened'（已跳转）/ 'missing'（新会话尚未同步到会话列表，可等下次）/
      // 'failed'（找到了但 sessions.open 抛错——重试大概率同样失败，放弃并告警）。
      function tryOpenChild(parentId) {
        const snap = ctx.sessions.list.getSnapshot()
        for (const id of snap.ids) {
          const summary = snap.byId[id]
          if (summary !== void 0 && summary.parentId === parentId) {
            try {
              ctx.sessions.open(id)
              return 'opened'
            } catch (error) {
              console.warn('[fresh-start] sessions.open failed for', id, error)
              return 'failed'
            }
          }
        }
        return 'missing'
      }

      function sweepPending() {
        for (const parentId of [...pending]) {
          if (tryOpenChild(parentId) !== 'missing') pending.delete(parentId)
        }
      }

      // 归档变化 → 立即尝试跳转，新会话尚未同步则进 pending
      disposers.push(ctx.workspaces.list.subscribe(() => {
        const snap = ctx.workspaces.list.getSnapshot()
        const archived = new Set(snap.archivedSessionIds ?? [])
        const newly = [...archived].filter((id) => !prevArchived.has(id))
        prevArchived = archived
        for (const oldId of newly) {
          if (tryOpenChild(oldId) === 'missing') pending.add(oldId)
        }
      }))

      // 会话列表更新 → 兜底补跳
      disposers.push(ctx.sessions.list.subscribe(sweepPending))

      // apply 时立即清扫一次（可能已有待跳转）
      sweepPending()

      return function () {
        for (const dispose of disposers) dispose()
      }
    }

    return { apply, inject }
  },
})
