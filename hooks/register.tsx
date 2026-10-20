import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Activity, Blip, CritterProps, Dino, Helper, Mood, Position } from '../types'

const CALM: Mood = { activity: 'working', blip: null, seq: 0, drafting: false }
const MAIN_WIDTH = 32 // cells the main mascot wanders over
const HELPER_MIN = 12 // the fewest cells a subagent's mascot gets; past that, more of them go undrawn
const HELPER_REACTS = 1600 // ms a finished subagent's mascot celebrates (or flinches) before it leaves
const HELPER_LEAVES = 1000 // ms its exit takes

export const mood = atom({ plugin: 'mascot', key: 'mood' } as const, CALM)
// One mascot per running subagent, by agent id.
export const helpers = atom({ plugin: 'mascot', key: 'helpers' } as const, {} as Record<string, Helper>)
const OFF: Dino = { isOn: false, presses: 0, ducks: 0 }
export const game = atom({ plugin: 'mascot', key: 'game' } as const, OFF)

const GAME_ROWS = 8
// While the run is on, these keys typed in the prompt jump or duck; q quits; anything else is swallowed.
// The arrows never reach a prompt hook: the prompt keeps them for its history.
const JUMP_KEYS = new Set([' ', 'space', 'w'])
const DUCK_KEYS = new Set(['s'])

// The mood is cosmetic: a failed write must never get in the way of a tool call.
const setActivity = ($: EngineInterface, activity: Activity) =>
  update($, mood, m => ({ ...m, activity })).catch(() => undefined)

// A blip is a short reaction; the seq bump is what tells the critter it just happened.
const react = ($: EngineInterface, blip: Blip) =>
  update($, mood, m => ({ ...m, blip, seq: m.seq + 1 })).catch(() => undefined)

// A subagent's mood; its mascot appears the first time the subagent is seen.
const setHelper = ($: EngineInterface, id: string, change: (h: Helper) => Helper) =>
  update($, helpers, all => ({ ...all, [id]: change(all[id] ?? { ...CALM, isDone: false, isLeaving: false }) })).catch(() => undefined)

const dropHelper = ($: EngineInterface, id: string) =>
  update($, helpers, ({ [id]: _gone, ...rest }) => rest).catch(() => undefined)

// How many subagents' mascots fit beside the main one, and how wide each one's patch is: they share
// what's left of the row, each up to as much room as the main mascot has.
export const crewRoom = (columns: number, count: number) => {
  const free = Math.max(0, columns - MAIN_WIDTH)
  const shown = Math.min(count, Math.floor(free / HELPER_MIN))
  return { shown, width: shown ? Math.min(MAIN_WIDTH, Math.floor(free / shown)) : 0 }
}

type Slot = { kind: 'space' } | { kind: 'main' } | { kind: 'helper'; id: string }

// How the mascots line up across the row: the main one on its side, the subagents' beside it toward the middle.
export const lineUp = (position: Position, crew: string[]): Slot[] => {
  const main: Slot = { kind: 'main' }
  const space: Slot = { kind: 'space' }
  const others = crew.map((id): Slot => ({ kind: 'helper', id }))
  if (position === 'left') return [main, ...others, space]
  if (position === 'center') return [space, main, ...others, space]
  return [space, ...others, main]
}

export const register: Register = (on, options) => {
  const position: Position = options.position === 'left' || options.position === 'center' ? options.position : 'right'

  on('session.start', async ($, e, next) => {
    await update($, helpers, () => ({})).catch(() => undefined)
    // A run never outlives a reload: a stuck one would swallow the prompt's keys.
    await update($, game, () => OFF).catch(() => undefined)
    // immediate: it starts (or stops) the run at once, even while a turn is still going
    await $.command.register({
      name: 'dino',
      description: 'Run the mascot through the dinosaur game: space to jump, s to duck, q to quit',
      immediate: true,
    })
    return next(e)
  })

  on('command.run', { command: 'dino' }, async $ => {
    const was = await read($, game)
    await update($, game, (): Dino => ({ isOn: !was.isOn, presses: 0, ducks: 0 }))
    // typing /dino left a draft behind as far as the mascot knows; the command took it
    await update($, mood, m => ({ ...m, drafting: false })).catch(() => undefined)
    return { text: was.isOn ? 'Dino run stopped.' : 'Dino run: space (or w) jumps the cacti, s ducks the birds, q quits.' }
  })

  on('prompt.edit', async ($, e, next) => {
    const run = await read($, game)
    if (run.isOn) {
      const key = e.key?.key ?? e.inputText
      if (key === 'q') {
        await update($, game, () => OFF).catch(() => undefined)
        await update($, mood, m => ({ ...m, drafting: false })).catch(() => undefined)
      } else if (JUMP_KEYS.has(key)) {
        await update($, game, (g): Dino => ({ ...g, presses: g.presses + 1 })).catch(() => undefined)
      } else if (DUCK_KEYS.has(key)) {
        await update($, game, (g): Dino => ({ ...g, ducks: g.ducks + 1 })).catch(() => undefined)
      }
      return { text: e.text, cursor: e.cursor }
    }
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

  // Deep thinking is a response streaming thinking; its text and tool calls are work. A subagent's
  // response moves its own mascot, which shows up with its first one.
  on('turn.step', async function* ($, e, next) {
    const id = e.agentId
    const set = (activity: Activity) =>
      id ? setHelper($, id, h => ({ ...h, activity, isDone: false })) : setActivity($, activity)
    if (id) {
      await set('working')
    }
    let deep = false
    for await (const chunk of next(e)) {
      const isThinking = chunk.kind === 'thinking'
      if (isThinking !== deep && (isThinking || chunk.kind === 'text' || chunk.kind === 'tool' || chunk.kind === 'input')) {
        deep = isThinking
        await set(deep ? 'thinking' : 'working')
      }
      yield chunk
    }
  })

  on('tool.call', async ($, e, next) => {
    const id = e.agentId
    if (id) {
      const result = await next(e)
      if (result.isError) {
        await setHelper($, id, h => ({ ...h, blip: 'oops', seq: h.seq + 1 }))
      }
      return result
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
    const id = e.agentId
    const blip: Blip = e.reason === 'answer' ? 'happy' : 'oops'
    if (id) {
      // A finished subagent's mascot reacts, makes its exit, then goes.
      await setHelper($, id, h => ({ ...h, isDone: true, blip, seq: h.seq + 1 }))
      $.clock.after(HELPER_REACTS, () => void setHelper($, id, h => ({ ...h, isLeaving: true })))
      $.clock.after(HELPER_REACTS + HELPER_LEAVES, () => void dropHelper($, id))
    } else {
      await react($, blip)
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (e.surface !== 'terminal' && e.surface !== 'desktop')) {
      return next(e)
    }

    const { Box, Client } = $.ui.resolve(e)
    const columns = e.props.bodyColumns
    const run = await read($, game)
    if (run.isOn) {
      return <Client key="dino" module="./dino.tsx" props={{ presses: run.presses, ducks: run.ducks }} width="100%" height={Math.max(3, Math.min(GAME_ROWS, e.props.maxRows))} />
    }
    // The band gets squeezed when the agent list or other panels take the space above the prompt.
    const rows = Math.max(1, Math.min(4, e.props.maxRows))
    const mine: CritterProps = { ...(await read($, mood)), isWorking: e.props.isWorking, position, isHelper: false, isLeaving: false }
    const crew = await read($, helpers)
    // ponytail: subagents past what the row has room for go undrawn until others finish
    const room = crewRoom(columns, Object.keys(crew).length)
    const shown = Object.keys(crew).slice(0, room.shown)

    return (
      <Box flexDirection="row" width="100%">
        {lineUp(position, shown).map((slot, i) => {
          if (slot.kind === 'space') {
            return <Box key={`space-${i}`} flexGrow={1} />
          }
          if (slot.kind === 'main') {
            return <Client key="critter" module="./critter.tsx" props={mine} width={Math.min(MAIN_WIDTH, columns)} height={rows} />
          }
          const helper = crew[slot.id]!
          const props: CritterProps = { ...helper, isWorking: !helper.isDone, position: 'center', isHelper: true }
          return <Client key={`helper-${slot.id}`} module="./critter.tsx" props={props} width={room.width} height={rows} />
        })}
      </Box>
    )
  })
}
