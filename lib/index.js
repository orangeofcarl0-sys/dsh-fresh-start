// dsh-fresh-start — host half
//
// `/fresh` 命令：一键总结当前对话 → 开启新对话 → 归档老对话。
//
// 目的：超大会话（数十万事件）的内存/卡顿缓解。在一个超大会话里工作一段
// 时间后，用 /fresh 把历史压缩成摘要、归档（释放 live 事件树内存）、开一个
// 继承同 cwd 与 preset 的新对话继续工作。
//
// 流程（每步独立、失败降级不阻断后续）：
//   1. 总结：ctx.compaction.compactNow(agent, signal, commandId)
//      —— 复用 dsh 的手动压缩通道，把早期历史替换为一条摘要节点。
//   2. 开新对话：ctx.agents.create({ sessionId, meta:{cwd, agentPreset}, setup })
//      —— 继承老会话的 cwd 与 agent preset，挂载同一 preset。
//   3. 归档：ctx.workspaces.archiveSession(oldId)
//      —— 老会话从 live 移入归档集，释放其事件树内存。
//
// 安全：compaction 失败（busy/无历史/agent 未空闲）只记录并继续；任何一步
// 异常都不影响前一步的成果，且完整报告在命令结果文本里。

import { randomUUID } from 'node:crypto'
import { ManualCompactionError } from '@deepseek-ai/dsh-compaction'
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'

export const name = 'dsh-fresh-start'
// 只声明早期就绪的全局服务；compaction 依赖 llm/tokenMeter，须在 apply 里
// 用 ctx.inject 动态等待（否则 loader 会报 pending waiting for service）。
export const inject = ['commands']

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

  // executeFresh 用注入的 compaction 上下文（sub.compaction）
  async function executeFresh(ictx, invocation) {
    const agent = invocation.agent
    const session = agent.session
    const oldId = session.id
    const cwd = session.header.cwd
    const preset = resolveSessionPreset(session) ?? session.header.agentPreset

    const parts = []

    // ---- 1. 总结 ----
    let compacted = null
    try {
      compacted = await ictx.compaction.compactNow(agent, invocation.signal, invocation.commandId)
      parts.push(compacted === null
        ? 'history already compact (nothing to summarize)'
        : `summarized ${compacted.shadowedSeqs.length} items (~${compacted.shadowedTokenCount} tokens)`)
    } catch (error) {
      if (invocation.signal.aborted) return { kind: 'error', text: 'fresh-start cancelled' }
      parts.push(compactFailureText(error))
    }

    // ---- 2. 开新对话 ----
    let newId = null
    try {
      const newSessionId = `session-${randomUUID()}`
      const presets = ictx.get('agentPresets')
      let setup = async () => {}
      let resolvedPreset = preset
      if (presets && preset !== void 0) {
        try {
          resolvedPreset = (await presets.resolve(preset)).id
          setup = async (agentCtx) => { await presets.mount(agentCtx, resolvedPreset) }
        } catch (error) {
          logErr(`preset resolve/mount setup failed for "${preset}": ${error?.message ?? error}; starting with default preset`)
          resolvedPreset = void 0
          setup = async () => {}
        }
      }
      await ictx.agents.create({
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
      const workspaces = ictx.get('workspaces')
      if (workspaces && typeof workspaces.archiveSession === 'function') {
        await workspaces.archiveSession(oldId)
        parts.push(`archived ${oldId}`)
      } else {
        parts.push('archive skipped (workspaces service unavailable)')
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

  const handler = (ictx) => (invocation) => {
    const operation = executeFresh(ictx, invocation)
    active.add(operation)
    operation.then(() => active.delete(operation), () => active.delete(operation))
    return operation
  }

  // compaction 服务须在 apply 后动态等待（依赖 llm/tokenMeter，不能放进 inject 声明）
  const register = (sub) => {
    const subCtx = sub ?? ctx
    subCtx.effect(function* () {
      yield async () => {
        await Promise.allSettled([...active])
      }
      yield subCtx.commands.register({
        name: 'fresh',
        description: 'Summarize this conversation, start a new one, and archive the old one',
        handler: handler(subCtx),
      })
    }, 'dsh-fresh-start lifecycle')
  }

  if (typeof ctx.inject === 'function') {
    ctx.inject(['compaction'], register)
  } else {
    register(ctx)
  }

  log('installed: /fresh command registered')

  return () => {
    for (const dispose of disposers.splice(0).reverse()) {
      try { dispose() } catch (error) { logErr('dispose failed:', String(error?.message ?? error)) }
    }
    log('disposed')
  }
}
