import { expect, test } from 'claude-code/testing'

import { advance, drawGame, duck, isDucking, newGame, press, score } from './dino'
import type { Game } from './dino'

const WIDTH = 200
const ticks = (g: Game, n: number) => {
  for (let i = 0; i < n; i++) g = advance(g, WIDTH)
  return g
}
// A run with one cactus just ahead, and no more coming.
const facing = (x: number): Game => ({ ...newGame(), phase: 'running', cacti: [{ x, kind: 0 }], nextIn: Infinity })

test('a press starts the run with a jump; no second jump in mid-air; it lands', () => {
  const started = press(newGame())
  expect(started.phase).toBe('running')
  const up = ticks(started, 3)
  expect(up.y).toBeGreaterThan(0)
  expect(press(up).vy).toBe(up.vy)
  expect(ticks(up, 40).y).toBe(0)
})

test('running into a cactus ends the run; jumping over it does not', () => {
  const crashed = ticks(facing(30), 60)
  expect(crashed.phase).toBe('over')
  let near = facing(60)
  while (near.cacti[0]!.x > 24) near = advance(near, WIDTH)
  const cleared = ticks(press(near), 60)
  expect(cleared.phase).toBe('running')
  expect(score(cleared)).toBeGreaterThan(0)
})

test('after a crash, a press starts a new run and keeps the best score', () => {
  const over = ticks(facing(120), 300)
  expect(over.phase).toBe('over')
  const again = press(ticks(over, 15))
  expect(again.phase).toBe('running')
  expect(again.cacti).toEqual([])
  expect(again.best).toBe(over.best)
})

test('the run spans the row: the mascot on the left, the score at the right', () => {
  const lines = drawGame(ticks(press(newGame()), 50), 80, 8)
  expect(lines).toHaveLength(8)
  expect(lines[7]).toMatch(/^[· ]+$/)
  expect(lines[0]!.trimEnd().endsWith(String(score(ticks(press(newGame()), 50))).padStart(5, '0'))).toBe(true)
  expect(lines.some(line => /^\s{0,4}[▐▌▝▜]/.test(line))).toBe(true)
})

test('/dino swaps the mascots for the run, which loads and shows how to play', async $ => {
  const ui = await $.ui.mount({
    plugin: 'mascot',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  })
  await $.command.run({ command: 'dino', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  await ui.resize({ columns: 80, rows: 8 })
  await ui.advance(100)
  expect(await ui.find({ type: 'Text', text: /space to jump/, in: 'dino' })).toBeDefined()
  await ui.unmount()
})

test('harder, never impossible: every cactus can be cleared, at the start and at top speed', () => {
  for (let kind = 0; kind < 5; kind++) {
    for (const distance of [0, 1_000_000]) {
      const run: Game = { ...newGame(), phase: 'running', distance, cacti: [{ x: 120, kind }], nextIn: Infinity }
      const cleared = Array.from({ length: 60 }, (_, wait) => ticks(press(ticks(run, wait)), 80)).some(g => g.phase === 'running')
      expect(cleared).toBe(true)
    }
  }
})

// A run with one bird just ahead, and nothing more coming.
const bird = (x: number, distance = 0): Game => ({ ...newGame(), phase: 'running', distance, cacti: [{ x, kind: 'bird' }], nextIn: Infinity })
// Holds down: a press now and then, as a held key repeats.
const ducked = (g: Game, n: number) => {
  for (let i = 0; i < n; i++) g = advance(i % 5 === 0 ? duck(g) : g, WIDTH)
  return g
}

test('a bird at head height hits it standing; ducking, it passes under', () => {
  expect(ticks(bird(40), 60).phase).toBe('over')
  const under = ducked(bird(40), 60)
  expect(under.phase).toBe('running')
})

test('down ducks for a moment on the ground, and drops it fast in the air', () => {
  const g = duck(press(newGame()))
  expect(isDucking(ticks({ ...g, y: 0, vy: 0 }, 2))).toBe(true)
  expect(isDucking(ticks({ ...g, y: 0, vy: 0 }, 20))).toBe(false)
  const up = ticks(press(newGame()), 3)
  expect(duck(up).vy).toBeLessThan(up.vy)
})

test('birds turn up only after the opening stretch', () => {
  const early: Game = { ...newGame(), phase: 'running', nextIn: 0 }
  const kinds = Array.from({ length: 80 }, () => advance(early, WIDTH).cacti[0]?.kind)
  expect(kinds).not.toContain('bird')
})

test('every bird can be ducked, at the start and at top speed', () => {
  for (const distance of [700, 1_000_000]) {
    expect(ducked(bird(120, distance), 80).phase).toBe('running')
  }
})
