import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Activity, Blip, CritterProps, Mood } from '../types'

const CALM: Mood = { activity: 'thinking', blip: null, seq: 0, drafting: false }

export const mood = atom({ plugin: 'mascot', key: 'mood' } as const, CALM)

// The mood is cosmetic: a failed write must never get in the way of a tool call.
const setActivity = ($: EngineInterface, activity: Activity) =>
  update($, mood, m => ({ ...m, activity })).catch(() => undefined)

// A blip is a short reaction; the seq bump is what tells the critter it just happened.
const react = ($: EngineInterface, blip: Blip) =>
  update($, mood, m => ({ ...m, blip, seq: m.seq + 1 })).catch(() => undefined)

export const register: Register = on => {
  let toolsRunning = 0

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
    await setActivity($, 'thinking')
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    toolsRunning += 1
    await setActivity($, String(e.tool) === 'AskUserQuestion' ? 'waiting' : 'tool')
    try {
      const result = await next(e)
      if (result.isError) {
        await react($, 'oops')
      }
      return result
    } finally {
      toolsRunning -= 1
      await setActivity($, toolsRunning > 0 ? 'tool' : 'thinking')
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
    const props: CritterProps = { ...(await read($, mood)), isWorking: e.props.isWorking }

    return <Client key="critter" module="./critter.tsx" props={props} width="100%" height={3} />
  })
}
