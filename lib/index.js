// dsh-fresh-start — host half
//
// `/fresh` 命令：一键总结当前对话 → 开启新对话 → 归档老对话。
//
// 目的：超大会话（数十万事件）的内存/卡顿缓解。在一个超大会话里工作一段
// 时间后，用 /fresh 把历史压缩成摘要、归档（释放 live 事件树内存）、开一个
// 继承同 cwd 与 preset 的新对话继续工作。
//
// 关键实现点（dsh 0.1.0-rc.6 源码级）：
//   - compaction 引擎是 per-agent preset 挂载的服务，profile 插件拿不到全局
//     `ctx.compaction`（isolate 作用域）。正确取法是
//     `ctx.agentPresets.serviceFor(agent, 'compaction')`（同 auto-compact）。
//   - 命令须在 root ctx 用 `ctx.commands.register` 注册（`inject: ['commands']`
//     声明），才进入全局命令列表（UI 可见）。
//
// 流程（每步独立、失败降级不阻断后续）：
//   1. 总结：engine.compactNow(agent, signal, commandId)
//   2. 开新对话：ctx.agents.create({ sessionId, meta:{cwd, agentPreset}, setup })
//   3. 归档：ctx.workspaces.archiveSession(oldId)

import { randomUUID } from 'node:crypto'
import { ManualCompactionError } from '@deepseek-ai/dsh-compaction'
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'

export const name = 'dsh-fresh-start'
export const inject = ['commands', 'agentPresets', 'agents', 'workspaceRegistry']

const TAG = '[fresh-start]'
const log = (...args) => console.log(TAG, ...args)
const logErr = (...args) => console.error(TAG, ...args)

function compactFailureText(error) {
  if (error instanceof ManualCompactionError) {
    switch (error.code) {
      case 'busy': return 'compaction skipped (active compaction or agent not idle)'
      case 'cancelled': return 'compaction cancelled'
      case 'summary': return 'compaction skipped (no useful summary)'
      case 'changed': return 'compaction skipped (history changed)'
      case 'commit': return 'compaction incomplete (history may be unchanged)'
      case 'persistence': return 'compaction done but session not saved'
      default: return `compaction failed (${error.code})`
    }
  }
  return `compaction failed (${error?.message ?? error})`
}

export function apply(ctx) {
  const disposers = []
  const active = new Set()

  async function executeFresh(invocation) {
    const agent = invocation.agent
    const session = agent.session
    const oldId = session.id
    const cwd = session.header.cwd
    const preset = resolveSessionPreset(session) ?? session.header.agentPreset

    const parts = []

    // ---- 1. 总结（per-agent preset 挂载的 compaction 引擎）----
    try {
      const engine = ctx.agentPresets.serviceFor(agent, 'compaction')
      if (engine && typeof engine.compactNow === 'function') {
        const result = await engine.compactNow(agent, invocation.signal, invocation.commandId)
        parts.push(result === null
          ? 'history already compact (nothing to summarize)'
          : `summarized ${result.shadowedSeqs.length} items (~${result.shadowedTokenCount} tokens)`)
      } else {
        parts.push('compaction unavailable (no compaction engine in this preset)')
      }
    } catch (error) {
      if (invocation.signal.aborted) return { kind: 'error', text: 'fresh-start cancelled' }
      parts.push(compactFailureText(error))
    }

    // ---- 2. 开新对话 ----
    let newId = null
    try {
      const newSessionId = `session-${randomUUID()}`
      let setup = async () => {}
      let resolvedPreset = preset
      if (preset !== void 0) {
        try {
          resolvedPreset = (await ctx.agentPresets.resolve(preset)).id
          setup = async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, resolvedPreset) }
        } catch (error) {
          logErr(`preset resolve/mount setup failed for "${preset}": ${error?.message ?? error}; starting with default preset`)
          resolvedPreset = void 0
          setup = async () => {}
        }
      }
      await ctx.agents.create({
        sessionId: newSessionId,
        meta: {
          ...(cwd !== void 0 ? { cwd } : {}),
          ...(resolvedPreset !== void 0 ? { agentPreset: resolvedPreset } : {}),
        },
        agentOptions: {},
        setup,
      })
      newId = newSessionId
      parts.push(`new session ${newSessionId} started`)
    } catch (error) {
      logErr(`new session failed: ${error?.message ?? error}`)
      parts.push(`new session FAILED (${error?.message ?? error})`)
    }

    // ---- 3. 归档老对话 ----
    try {
      if (ctx.workspaceRegistry && typeof ctx.workspaceRegistry.archiveSession === 'function') {
        await ctx.workspaceRegistry.archiveSession(oldId)
        parts.push(`archived ${oldId}`)
      } else {
        parts.push('archive skipped (workspaceRegistry service unavailable)')
      }
    } catch (error) {
      logErr(`archive failed for ${oldId}: ${error?.message ?? error}`)
      parts.push(`archive FAILED (${error?.message ?? error})`)
    }

    const ok = newId !== null
    log(`fresh-start ${oldId}: ${parts.join('; ')}`)
    return {
      kind: ok ? 'success' : 'error',
      text: parts.join('; '),
      ...(newId !== null ? { sessionId: newId } : {}),
    }
  }

  const handler = (invocation) => {
    const operation = executeFresh(invocation)
    active.add(operation)
    operation.then(() => active.delete(operation), () => active.delete(operation))
    return operation
  }

  // 命令在 root ctx 注册（进入全局命令列表，UI 可见）
  ctx.effect(function* () {
    yield async () => {
      await Promise.allSettled([...active])
    }
    yield ctx.commands.register({
      name: 'fresh',
      description: 'Summarize this conversation, start a new one, and archive the old one',
      handler,
    })
    log('installed: /fresh command registered')
  }, 'dsh-fresh-start lifecycle')

  return () => {
    for (const dispose of disposers.splice(0).reverse()) {
      try { dispose() } catch (error) { logErr('dispose failed:', String(error?.message ?? error)) }
    }
    log('disposed')
  }
}
