import { expect, test } from 'claude-code/testing'

import type { CritterProps } from '../types'
import { draw, initial, modeOf, receive, step } from './critter'

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
  const lines = draw(run(initial(IDLE), 300), 40).map(line => line.trimEnd())
  const at = lines[1]!.search(/\S/)
  expect(lines.map(line => line.slice(at))).toEqual([' ▐▛██▜▌', '▝▜████▛▘', '  ▘▘▝▝'])
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

test('scuttles while a tool runs', () => {
  const s = run(initial({ ...IDLE, isWorking: true, activity: 'tool' }), 100)
  expect(modeOf(s)).toBe('tool')
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
