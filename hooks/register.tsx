import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Activity, Blip, CritterProps, Mood, Position } from '../types'

const CALM: Mood = { activity: 'working', blip: null, seq: 0, drafting: false }

export const mood = atom({ plugin: 'mascot', key: 'mood' } as const, CALM)

// The mood is cosmetic: a failed write must never get in the way of a tool call.
const setActivity = ($: EngineInterface, activity: Activity) =>
  update($, mood, m => ({ ...m, activity })).catch(() => undefined)

// A blip is a short reaction; the seq bump is what tells the critter it just happened.
const react = ($: EngineInterface, blip: Blip) =>
  update($, mood, m => ({ ...m, blip, seq: m.seq + 1 })).catch(() => undefined)

export const register: Register = (on, options) => {
  const position: Position = options.position === 'left' || options.position === 'center' ? options.position : 'right'

  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    const drafting = box.text.trim() !== ''
    await update($, mood, (m): Mood => ({ ...m, blip: 'typing', seq: m.seq + 1, drafting })).catch(() => undefined)
    return box
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, mood, m => ({ ...m, drafting: false })).catch(() => undefined)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await setActivity($, 'working')
    return next(e)
  })

  // Deep thinking is the main agent's response streaming thinking; its text and tool calls are work.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId) {
      return yield* next(e)
    }
    let deep = false
    for await (const chunk of next(e)) {
      const isThinking = chunk.kind === 'thinking'
      if (isThinking !== deep && (isThinking || chunk.kind === 'text' || chunk.kind === 'tool' || chunk.kind === 'input')) {
        deep = isThinking
        await setActivity($, deep ? 'thinking' : 'working')
      }
      yield chunk
    }
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId) {
      return next(e)
    }
    await setActivity($, String(e.tool) === 'AskUserQuestion' ? 'waiting' : 'working')
    try {
      const result = await next(e)
      if (result.isError) {
        await react($, 'oops')
      }
      return result
    } finally {
      await setActivity($, 'working')
    }
  })

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    // Only a real call waits on the person; a plugin's dry-run $.tool.check has no tool_use_id.
    if (verdict.decision === 'ask' && e.tool_use_id) {
      await setActivity($, 'waiting')
    }
    return verdict
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      await react($, e.reason === 'answer' ? 'happy' : 'oops')
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (e.surface !== 'terminal' && e.surface !== 'desktop')) {
      return next(e)
    }

    const { Client } = $.ui.resolve(e)
    const props: CritterProps = { ...(await read($, mood)), isWorking: e.props.isWorking, position }

    return <Client key="critter" module="./critter.tsx" props={props} width="100%" height={4} />
  })
}
