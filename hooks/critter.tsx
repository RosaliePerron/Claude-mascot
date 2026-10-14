import type { ClientModule } from 'claude-code'

import type { CritterProps } from '../types'

// Each cell is 2x2 pixels; index = topLeft*8 + topRight*4 + bottomLeft*2 + bottomRight.
const QUADS = ' ▗▖▄▝▐▞▟▘▚▌▙▀▜▛█'
const ROWS = 4
const REST = 2 // the pixel row it stands on; the row of cells above is headroom for hops and its thought bubble
const TICK = 100
const ROAM = 40 // pixels the critter wanders left of its home at the right edge
const SPRITE_WIDTH = 16
const SLEEP_AFTER = 120_000
const BLIP_MS = { typing: 1200, happy: 1600, oops: 1000 }
const BOUNCE_FOR = 3000 // then it stands and watches the prompt until the draft is sent

type Eyes = 'front' | 'left' | 'right' | 'down' | 'shut'
export type Mode = 'idle' | 'sleep' | 'typing' | 'watching' | 'happy' | 'oops' | 'thinking' | 'working' | 'waiting'

export type Sim = {
  t: number
  x: number
  dir: 1 | -1
  target: number
  nextStroll: number
  props: CritterProps
  changedAt: number
  blipAt: number
  draftSince: number
}

export const initial = (props: CritterProps): Sim => ({
  t: 0,
  x: Infinity,
  dir: -1,
  target: Infinity,
  nextStroll: 5000,
  props,
  changedAt: 0,
  blipAt: -Infinity,
  draftSince: -Infinity,
})

export const modeOf = (s: Sim): Mode => {
  const { blip, isWorking, activity, drafting } = s.props
  if (blip && s.t - s.blipAt < BLIP_MS[blip] && (blip !== 'typing' || s.t - s.draftSince < BOUNCE_FOR)) return blip
  if (isWorking) return activity
  if (drafting) return 'watching'
  return s.t - s.changedAt > SLEEP_AFTER ? 'sleep' : 'idle'
}

export const receive = (s: Sim, props: CritterProps): Sim => ({
  ...s,
  props,
  changedAt: s.t,
  blipAt: props.seq !== s.props.seq ? s.t : s.blipAt,
  draftSince: props.drafting && !s.props.drafting ? s.t : s.draftSince,
})

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const even = (n: number) => n - (n % 2)

// Moves a whole cell (2px) at a time so the sprite always lands crisp.
export const step = (s: Sim, columns: number): Sim => {
  const t = s.t + TICK
  const home = even(Math.max(0, columns * 2 - SPRITE_WIDTH - 4))
  const left = even(Math.max(0, home - ROAM))
  let { x, dir, target, nextStroll } = s
  x = clamp(x, left, home)
  target = clamp(target, left, home)

  const mode = modeOf({ ...s, t })
  if (mode === 'working' && t % 200 === 0) {
    if (x <= left) dir = 1
    if (x >= home) dir = -1
    x += 2 * dir
  } else if (mode === 'idle') {
    if (x === target && t >= nextStroll) {
      target = left + 2 * Math.floor(Math.random() * ((home - left) / 2 + 1))
      nextStroll = t + 6000 + Math.random() * 9000
    }
    if (x !== target && t % 400 === 0) x += 2 * Math.sign(target - x)
  }

  return { ...s, t, x, dir, target, nextStroll }
}

// The welcome logo's pixels, one cell narrower: ' ▐▛██▜▌ ' / '▝▜████▛▘' / '  ▘▘▝▝  '.
const BODY = '...##########...'
const EYES = { front: '...##.####.##...', left: '...#.####.###...', right: '...###.####.#...', down: BODY, shut: BODY }
const ARMS = '.##############.'
const ARMS_EYES_DOWN = '.####.####.####.' // the eyes drop into the arm row: looking down at the prompt
const LEGS = ['....#.#..#.#....', '...#.#....#.#...']

// The thought bubble over the sitting critter's head, relative to its top-left, in the order its
// parts appear: a dot by its head, a bigger dot, then a cloud right above it.
const BUBBLE: [number, number][][] = [
  [[15, -1]],
  [[12, -2], [13, -2]],
  [
    ...[4, 5, 6, 7, 8, 9].map((dx): [number, number] => [dx, -4]),
    ...[3, 4, 5, 6, 7, 8, 9, 10].map((dx): [number, number] => [dx, -3]),
  ],
]

const sprite = (eyes: Eyes, stride: number, tucked: boolean) => [
  BODY,
  EYES[eyes],
  eyes === 'down' ? ARMS_EYES_DOWN : ARMS,
  BODY,
  ...(tucked ? [] : [LEGS[stride % 2]!]),
]

export const draw = (s: Sim, columns: number): string[] => {
  const width = columns * 2
  const px = Array.from({ length: ROWS * 2 }, () => new Array<boolean>(width).fill(false))
  const plot = (x: number, y: number) => {
    if (x >= 0 && x < width && y >= 0 && y < ROWS * 2) px[y]![x] = true
  }

  const beat = Math.floor(s.t / TICK)
  let x = Number.isFinite(s.x) ? s.x : even(Math.max(0, width - SPRITE_WIDTH - 4))
  // Stands on whole cells so it lines up with the logo; hops dip half a cell.
  let y = REST
  let eyes: Eyes = 'front'
  let stride = 0
  let tucked = false // legs folded under: lying down asleep, or sitting to think
  let mark: string | null = null

  switch (modeOf(s)) {
    case 'idle':
      stride = x !== s.target ? Math.floor(beat / 4) : 0
      eyes = beat % 40 === 0 ? 'shut' : 'front'
      break
    case 'sleep':
      eyes = 'shut'
      tucked = true
      y = REST + 2
      if (beat % 30 < 10) plot(x + 1, y - 1)
      else if (beat % 30 < 20) plot(x, y - 2)
      break
    case 'typing':
      y = REST + (beat % 2)
      stride = beat
      break
    case 'watching':
      eyes = beat % 40 === 0 ? 'shut' : 'down'
      break
    case 'happy':
      y = REST + (beat % 4 < 2 ? 1 : 0)
      plot(x - 2, beat % 2 ? 0 : 3)
      plot(x + SPRITE_WIDTH + 1, beat % 2 ? 3 : 0)
      break
    case 'oops':
      x += beat % 2 ? 1 : -1
      eyes = 'shut'
      break
    case 'thinking': {
      // Sits down, eyes darting side to side, while a thought bubble grows over its head and pops.
      tucked = true
      y = REST + 2
      eyes = Math.floor(beat / 7) % 2 ? 'right' : 'left'
      const phase = beat % 20
      const stages = phase < 3 || phase >= 17 ? 0 : Math.min(3, Math.floor((phase + 1) / 4))
      BUBBLE.slice(0, stages).flat().forEach(([dx, dy]) => plot(x + dx, y + dy))
      break
    }
    case 'working':
      stride = Math.floor(beat / 2)
      break
    case 'waiting':
      y = REST + (beat % 12 < 2 ? 1 : 0)
      mark = '?'
      break
  }

  sprite(eyes, stride, tucked).forEach((row, dy) =>
    [...row].forEach((p, dx) => p === '#' && plot(x + dx, y + dy)),
  )

  const lines = Array.from({ length: ROWS }, (_, r) => {
    let line = ''
    for (let c = 0; c < columns; c++) {
      const bit = (dy: number, dx: number) => (px[r * 2 + dy]![c * 2 + dx] ? 1 : 0)
      line += QUADS[bit(0, 0) * 8 + bit(0, 1) * 4 + bit(1, 0) * 2 + bit(1, 1)]
    }
    return line
  })

  const markAt = Math.floor(x / 2) - 1
  if (mark && markAt >= 0) {
    lines[0] = lines[0]!.slice(0, markAt) + mark + lines[0]!.slice(markAt + 1)
  }

  return lines
}

const Critter: ClientModule<CritterProps, Sim> = (props, surface) => {
  const s = surface.state
  if (s === undefined) {
    surface.every(TICK, () => surface.setState(step(surface.state!, surface.columns)))
    surface.setState(initial(props))
  } else if (
    s.props.seq !== props.seq ||
    s.props.isWorking !== props.isWorking ||
    s.props.activity !== props.activity ||
    s.props.drafting !== props.drafting
  ) {
    surface.setState(receive(s, props))
  }

  const { Box, Text } = surface.elements
  const lines = s ? draw(s, surface.columns) : []

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

export default Critter
