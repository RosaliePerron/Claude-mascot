import type { ClientModule } from 'claude-code'

import { cells, sprite } from './critter'
import type { Pose } from './critter'

export type DinoProps = { presses: number; ducks: number }

// A cactus (kind: which shape) on the ground, or a bird flying at head height.
type Obstacle = { x: number; kind: number | 'bird' }
export type Game = {
  phase: 'ready' | 'running' | 'over'
  t: number
  y: number // how high its feet are off the ground, in pixels
  vy: number
  cacti: Obstacle[]
  speed: number // pixels the ground moves each tick
  distance: number
  nextIn: number // pixels of ground until the next cactus
  best: number
  presses: number
  ducks: number
  duckUntil: number // ducking on the ground until then
  overAt: number
}

const TICK = 40
const GRAVITY = 0.2
const LEAP = 1.8 // about 0.7s in the air, its feet 8 pixels up: clears any cactus timed within ~400ms
const START_SPEED = 3.2 // pixels a tick: a cactus crosses a 110-column terminal in about 2.6s
const TOP_SPEED = 10 // a cactus crosses the terminal in under a second
const SPEEDS_UP_OVER = 600 // pixels of run per extra pixel a tick: top speed after about 20s
const BIG_CACTI_FROM = 300 // pixels into the run, about 3s, before the tall cactus and the cluster turn up
const TIGHTENS_OVER = 4000 // pixels of run over which the gaps between cacti lose most of their slack
const BIRDS_FROM = 600 // pixels into the run, about 6s, before birds turn up
const BIRD_ODDS = 0.35 // of each obstacle after that
const DUCK_MS = 450 // one press of s ducks this long; holding it, the key's repeats keep it down
// A bird flaps at head height: it hits a mascot standing or jumping into it, and clears one ducking.
const BIRD = [
  ['#.....#', '.##.##.', '..###..'],
  ['..###..', '.##.##.', '#.....#'],
]
const BIRD_LOW = 3 // pixels above the ground of its lowest
const STANDING = 4 // pixels from its feet to the top of its head
const DUCKING = 2 // and ducking
const PLAYER_X = 6
const HIT = [PLAYER_X + 5, PLAYER_X + 10] // the middle of its body: brushing a cactus with an arm or a foot is fine
// Each pixel is twice as tall as it is wide, so these read taller than they are drawn.
const CACTI = [
  ['.#.', '###', '.#.', '.#.'],
  ['..#..', '#.#.#', '#####', '..#..'],
  ['.#..#.', '###.##', '.#..#.'],
  ['..#..', '..#.#', '#.#.#', '#.###', '###..', '..#..'],
  ['.#..#..#.', '###.#.###', '.#.###.#.', '.#..#..#.'],
]

export const newGame = (best = 0, presses = 0, ducks = 0): Game => ({
  phase: 'ready',
  t: 0,
  y: 0,
  vy: 0,
  cacti: [],
  speed: START_SPEED,
  distance: 0,
  nextIn: 60,
  best,
  presses,
  ducks,
  duckUntil: 0,
  overAt: 0,
})

export const isDucking = (g: Game) => g.phase === 'running' && g.y === 0 && g.t < g.duckUntil

export const score = (g: Game) => Math.floor(g.distance / 5)

// Space or w: starts the run, jumps while on the ground, or after a crash starts another.
export const press = (g: Game): Game => {
  if (g.phase === 'ready') return { ...g, phase: 'running', vy: LEAP }
  if (g.phase === 'over') return g.t - g.overAt < 400 ? g : { ...newGame(g.best, g.presses, g.ducks), phase: 'running', vy: LEAP }
  return g.y === 0 ? { ...g, vy: LEAP, duckUntil: 0 } : g
}

// s: ducks on the ground; in the air, drops it fast and ducks as it lands.
export const duck = (g: Game): Game => {
  if (g.phase !== 'running') return g
  return { ...g, vy: g.y > 0 ? Math.min(g.vy, -LEAP) : g.vy, duckUntil: g.t + DUCK_MS }
}

export const advance = (g: Game, width: number): Game => {
  const t = g.t + TICK
  if (g.phase !== 'running') return { ...g, t }

  let y = g.y + g.vy
  let vy = g.vy - GRAVITY
  if (y <= 0) {
    y = 0
    vy = 0
  }
  const speed = Math.min(TOP_SPEED, START_SPEED + g.distance / SPEEDS_UP_OVER)
  let cacti = g.cacti.map(c => ({ ...c, x: c.x - speed })).filter(c => c.x > -10)
  let nextIn = g.nextIn - speed
  if (nextIn <= 0) {
    const kinds = g.distance < BIG_CACTI_FROM ? 3 : CACTI.length
    const bird = g.distance >= BIRDS_FROM && Math.random() < BIRD_ODDS
    cacti = [...cacti, { x: width, kind: bird ? 'bird' : Math.floor(Math.random() * kinds) }]
    // never closer than a jump and a landing; the slack on top shrinks the further it gets
    nextIn = 40 + speed * 18 + Math.random() * 80 * Math.max(0.25, 1 - g.distance / TIGHTENS_OVER)
  }
  const distance = g.distance + speed

  const ducking = y === 0 && g.t < g.duckUntil
  const crashed = cacti.some(c => {
    const art = c.kind === 'bird' ? BIRD[0]! : CACTI[c.kind]!
    if (c.x > HIT[1]! || c.x + art[0]!.length - 1 < HIT[0]!) return false
    if (c.kind !== 'bird') return y < art.length - 1
    const top = y + (ducking ? DUCKING : STANDING)
    return top > BIRD_LOW + 0.5 && y < BIRD_LOW + art.length - 0.5
  })
  if (crashed) {
    return { ...g, t, y, vy: 0, cacti, distance, phase: 'over', overAt: t, best: Math.max(g.best, score({ ...g, distance })) }
  }
  return { ...g, t, y, vy, cacti, speed, distance, nextIn }
}

const pad = (n: number) => String(n).padStart(5, '0')

// The run's rows: the field it jumps in, standing on a ground line, then pebbles scrolling by under it.
export const drawGame = (g: Game, columns: number, rows: number): string[] => {
  const width = columns * 2
  const height = Math.max(1, rows - 1) * 2
  const ground = height - 1 // a solid line along the bottom of the field; standing on it, it is crisp

  const px = Array.from({ length: height }, () => new Array<boolean>(width).fill(false))
  const plot = (x: number, y: number) => {
    const col = Math.round(x)
    if (col >= 0 && col < width && y >= 0 && y < height) px[y]![col] = true
  }
  for (let x = 0; x < width; x++) plot(x, ground)

  for (const c of g.cacti) {
    const bird = c.kind === 'bird'
    const art = bird ? BIRD[Math.floor(g.t / (TICK * 4)) % 2]! : CACTI[c.kind as number]!
    const bottom = bird ? ground - 1 - BIRD_LOW : ground - 1
    art.forEach((row, dy) => [...row].forEach((p, dx) => p === '#' && plot(c.x + dx, bottom - art.length + 1 + dy)))
  }

  // ducking, it tucks its legs and flattens: three rows, low to the ground
  const ducking = isDucking(g)
  const pose: Pose = {
    x: PLAYER_X,
    y: ground - (ducking ? 3 : 5) - Math.round(g.y),
    eyes: g.phase === 'over' ? 'shut' : 'front',
    stride: g.phase === 'running' && g.y === 0 ? Math.floor(g.t / (TICK * 3)) : 0,
    tucked: ducking,
    squashed: ducking,
    hidden: false,
    arms: { left: 2, right: 2 },
    mark: null,
  }
  sprite(pose).forEach((row, dy) => [...row].forEach((p, dx) => p === '#' && plot(pose.x + dx, pose.y + dy)))

  // pebbles scroll by under the ground line, so the ground moves even between cacti
  const scroll = Math.floor(g.distance / 2)
  const pebbles = Array.from({ length: columns }, (_, c) => ((c + scroll) % 11 === 0 ? '·' : ' ')).join('')
  const lines = [...cells(px, columns), pebbles]
  const corner = `${g.best ? `HI ${pad(g.best)}  ` : ''}${pad(score(g))}`
  const hint =
    g.phase === 'ready'
      ? 'space to jump · s to duck · q to quit'
      : g.phase === 'over'
        ? 'game over · space to try again · q to quit'
        : ''
  const put = (text: string, at: number) => {
    if (at >= 0) lines[0] = lines[0]!.slice(0, at) + text + lines[0]!.slice(at + text.length)
  }
  put(corner, columns - corner.length - 1)
  if (hint) put(hint, Math.floor((columns - hint.length) / 2))
  return lines
}

const Dino: ClientModule<DinoProps, Game> = (props, surface) => {
  const g = surface.state
  if (g === undefined) {
    surface.every(TICK, () => surface.setState(advance(surface.state!, surface.columns * 2)))
    surface.setState(newGame(0, props.presses, props.ducks))
  } else if (props.presses !== g.presses) {
    surface.setState({ ...press(g), presses: props.presses })
  } else if (props.ducks !== g.ducks) {
    surface.setState({ ...duck(g), ducks: props.ducks })
  }

  const { Box, Text } = surface.elements
  const lines = g ? drawGame(g, surface.columns, surface.rows || 7) : []
  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        <Text key={String(i)} color="claude" wrap="truncate">
          {line}
        </Text>
      ))}
    </Box>
  )
}

export default Dino
