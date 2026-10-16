import { expect, test } from 'claude-code/testing'

import type { CritterProps } from '../types'
import { ANIMATIONS, draw, initial, modeOf, receive, step } from './critter'
import type { Mode, Sim } from './critter'

const IDLE: CritterProps = { activity: 'thinking', blip: null, seq: 0, drafting: false, isWorking: false }

const run = (s: ReturnType<typeof initial>, ms: number) => {
  for (let t = 0; t < ms; t += 100) s = step(s, 40)
  return s
}

const band = (isWorking: boolean) => ({
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking, maxRows: 10, bodyColumns: 40, scroll: { offset: 0, bodyRows: 10 }, view: {} },
})

test('at rest it is the welcome logo, one cell narrower', () => {
  const [headroom, ...rows] = draw(run(initial(IDLE), 300), 40).map(line => line.trimEnd())
  expect(headroom).toBe('')
  const at = rows[1]!.search(/\S/)
  expect(rows.map(line => line.slice(at))).toEqual([' ▐▛██▜▌', '▝▜████▛▘', '  ▘▘▝▝'])
})

test('falls asleep after two quiet minutes', () => {
  const s = initial(IDLE)
  expect(modeOf(run(s, 60_000))).toBe('idle')
  expect(modeOf(run(s, 121_000))).toBe('sleep')
})

const type = (s: ReturnType<typeof initial>, text = 'x') =>
  receive(s, { ...s.props, blip: 'typing', seq: s.props.seq + 1, drafting: text !== '' })

test('bounces for the first three seconds of writing, then watches the prompt', () => {
  let s = type(run(initial(IDLE), 1000))
  expect(modeOf(s)).toBe('typing')
  for (let i = 0; i < 7; i++) s = type(run(s, 500))
  expect(modeOf(s)).toBe('watching')
  expect(modeOf(run(s, 30_000))).toBe('watching')
})

test('a short pause mid-draft also settles into watching', () => {
  expect(modeOf(run(type(initial(IDLE)), 1500))).toBe('watching')
})

test('goes back to idle when the draft is cleared, and thinks once it is sent', () => {
  const s = run(type(initial(IDLE)), 4000)
  expect(modeOf(run(type(s, ''), 1500))).toBe('idle')
  expect(modeOf(receive(s, { ...s.props, drafting: false, isWorking: true }))).toBe('thinking')
})

test('scuttles while working', () => {
  const s = run(initial({ ...IDLE, isWorking: true, activity: 'working' }), 100)
  expect(modeOf(s)).toBe('working')
  expect(run(s, 500).x).not.toBe(s.x)
})

test('a reaction from before it mounted does not replay', () => {
  expect(modeOf(initial({ ...IDLE, blip: 'happy', seq: 7 }))).toBe('idle')
})

test('shows a ? while waiting on the person', () => {
  const s = run(initial({ ...IDLE, isWorking: true, activity: 'waiting' }), 300)
  expect(draw(s, 40).join('')).toContain('?')
})

test('the band draws the critter and no letters', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'mascot', surface, ...band(false) })
    await ui.resize({ columns: 40, rows: 3 })
    await ui.advance(300)
    expect(await ui.find({ type: 'Text', text: /[▐▌█]/, in: 'critter' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /[a-z]/i, in: 'critter' })).toBeUndefined()
    await ui.unmount()
  }
})

test('thinks in place, eyes darting, while a thought bubble grows and pops', () => {
  const thinking = run(initial({ ...IDLE, isWorking: true, activity: 'thinking' }), 100)
  const later = run(thinking, 3000)
  expect(modeOf(later)).toBe('thinking')
  expect(later.x).toBe(thinking.x)
  const frames = new Set(Array.from({ length: 20 }, (_, i) => draw(run(thinking, i * 100), 40).join('\n')))
  expect(frames.size).toBeGreaterThan(3)
})

test('the thought cloud floats over its head, not off to the side', () => {
  let s = run(initial({ ...IDLE, isWorking: true, activity: 'thinking' }), 100)
  while (Math.floor(s.t / 100) % 20 !== 12) s = run(s, 100)
  const [cloud, , head, arms] = draw(s, 40)
  const span = (line: string) => [line.search(/\S/), line.trimEnd().length]
  const [cloudFrom, cloudTo] = span(cloud!)
  expect(cloudFrom).toBeGreaterThanOrEqual(span(arms!)[0]!)
  expect(cloudTo).toBeLessThanOrEqual(span(arms!)[1]!)
  expect(head!.trim()).not.toBe('')
})

// A critter caught in each state, a moment after it began.
const inState = (mode: Mode): Sim => {
  const at = 130_000
  const props: Record<Mode, Partial<CritterProps>> = {
    idle: {},
    sleep: {},
    typing: { blip: 'typing', drafting: true },
    watching: { drafting: true },
    happy: { blip: 'happy' },
    oops: { blip: 'oops' },
    thinking: { isWorking: true, activity: 'thinking' },
    working: { isWorking: true, activity: 'working' },
    waiting: { isWorking: true, activity: 'waiting' },
  }
  const s = initial({ ...IDLE, ...props[mode] })
  const quiet = mode === 'sleep' ? 0 : at
  return { ...s, t: at, x: 40, target: 40, changedAt: quiet, blipAt: at, draftSince: at, mode }
}

const frames = (s: Sim) =>
  Array.from({ length: 9 }, (_, i) => draw({ ...s, t: s.t + i * 100 }, 40).join('\n')).join('\n--\n')

test('every state but waiting has alternate animations, each its own and all drawing the critter', () => {
  for (const mode of Object.keys(ANIMATIONS) as Mode[]) {
    const base = inState(mode)
    expect(modeOf(base)).toBe(mode)
    const looks = ANIMATIONS[mode].map((_, variant) => frames({ ...base, variant }))
    if (mode !== 'waiting') expect(looks.length).toBeGreaterThan(1)
    expect(new Set(looks).size).toBe(looks.length)
    for (const look of looks) {
      expect(look).toMatch(/[▐▌█]/)
      expect(look).not.toMatch(/[a-z]/i)
    }
  }
})

test('picks an animation at random on entering a state, and moves on to another when it lasts', () => {
  const idle = step(initial(IDLE), 40)
  const picked = new Set(
    Array.from({ length: 60 }, () => step(receive(idle, { ...IDLE, isWorking: true, activity: 'working' }), 40).variant),
  )
  expect(picked.size).toBeGreaterThan(1)
  const thinking = run(initial({ ...IDLE, isWorking: true, activity: 'thinking' }), 100)
  expect(run(thinking, 12_500).variant).not.toBe(thinking.variant)
})
