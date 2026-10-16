import type { ClientModule } from 'claude-code'

import type { CritterProps, Position } from '../types'

// Each cell is 2x2 pixels; index = topLeft*8 + topRight*4 + bottomLeft*2 + bottomRight.
const QUADS = ' ▗▖▄▝▐▞▟▘▚▌▙▀▜▛█'
const ROWS = 4
const REST = 2 // the pixel row it stands on; the row of cells above is headroom for hops and its thought bubble
const TICK = 100
const ROAM = 40 // pixels of the row the critter wanders over, from its home
const SPRITE_WIDTH = 16
const SLEEP_AFTER = 120_000
const BLIP_MS = { typing: 1200, happy: 1600, oops: 1000 }
const BOUNCE_FOR = 3000 // then it stands and watches the prompt until the draft is sent
const SWITCH_EVERY = 12_000 // a state that lasts this long moves on to another of its animations
const POKE_MS = 1200 // how long it reacts to a click
const ENTER_MS = 800 // a subagent's mascot making its entrance
const LEAVE_MS = 900 // and its exit

type Eyes = 'front' | 'left' | 'right' | 'down' | 'downLeft' | 'downRight' | 'shut'
type ArmRow = 0 | 1 | 2 | 3 // the body row an arm sticks out of; 2 is where it rests
export type Mode =
  | 'idle'
  | 'sleep'
  | 'typing'
  | 'watching'
  | 'happy'
  | 'oops'
  | 'thinking'
  | 'working'
  | 'waiting'
  | 'poked'
  | 'entering'
  | 'leaving'

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
  pokeAt: number
  leftAt: number // when a subagent's mascot was told to leave
  mode: Mode
  variant: number // which of the mode's animations is playing
  variantAt: number
}

export const initial = (props: CritterProps): Sim => {
  const s: Sim = {
    t: 0,
    x: Infinity,
    dir: -1,
    target: Infinity,
    nextStroll: 5000,
    props,
    changedAt: 0,
    blipAt: -Infinity,
    draftSince: -Infinity,
    pokeAt: -Infinity,
    leftAt: -Infinity,
    mode: 'idle',
    variant: 0,
    variantAt: 0,
  }
  const mode = modeOf(s)
  // A subagent's mascot makes a different entrance each time; everything else starts on its first animation.
  return { ...s, mode, variant: mode === 'entering' ? pick(ANIMATIONS.entering.length, -1) : 0 }
}

export const modeOf = (s: Sim): Mode => {
  const { blip, isWorking, activity, drafting, isHelper, isLeaving } = s.props
  if (isLeaving) return 'leaving'
  if (s.t - s.pokeAt < POKE_MS) return 'poked'
  if (isHelper && s.t < ENTER_MS) return 'entering'
  if (blip && s.t - s.blipAt < BLIP_MS[blip] && (blip !== 'typing' || s.t - s.draftSince < BOUNCE_FOR)) return blip
  if (isWorking) return activity
  if (drafting) return 'watching'
  return s.t - s.changedAt > SLEEP_AFTER ? 'sleep' : 'idle'
}

export const receive = (s: Sim, props: CritterProps): Sim => ({
  ...s,
  // A new position sends it straight to its new home.
  ...(props.position !== s.props.position && { x: Infinity, target: Infinity }),
  props,
  changedAt: s.t,
  blipAt: props.seq !== s.props.seq ? s.t : s.blipAt,
  draftSince: props.drafting && !s.props.drafting ? s.t : s.draftSince,
  leftAt: props.isLeaving && !s.props.isLeaving ? s.t : s.leftAt,
})

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const even = (n: number) => n - (n % 2)

// A random index below `count`, never `avoid` when there is another to take.
const pick = (count: number, avoid: number) => {
  const others = avoid >= 0 && count > 1
  const n = Math.floor(Math.random() * (others ? count - 1 : count))
  return others && n >= avoid ? n + 1 : n
}

// Its home and the stretch of the row it wanders over, in pixels: from its edge inward, or around the middle.
const patch = (columns: number, position: Position) => {
  const last = even(Math.max(0, columns * 2 - SPRITE_WIDTH - 4))
  if (position === 'left') {
    const home = Math.min(4, last)
    return { home, lo: home, hi: Math.min(last, home + ROAM) }
  }
  if (position === 'center') {
    const home = even(Math.floor(last / 2))
    return { home, lo: Math.max(0, home - ROAM / 2), hi: Math.min(last, home + ROAM / 2) }
  }
  return { home: last, lo: Math.max(0, last - ROAM), hi: last }
}

// Where it stands, in pixels: at home until it has taken its first step.
const xOf = (s: Sim, columns: number) => (Number.isFinite(s.x) ? s.x : patch(columns, s.props.position).home)

// A click on the mascot: it reacts at once, with a different reaction than the one playing, and wakes up.
export const poke = (s: Sim): Sim => ({
  ...s,
  pokeAt: s.t,
  changedAt: s.t,
  mode: 'poked',
  variant: pick(ANIMATIONS.poked.length, s.mode === 'poked' ? s.variant : -1),
  variantAt: s.t,
})

// Whether a click at this cell lands on the mascot, a cell of slack on either side.
export const hits = (s: Sim, columns: number, cell: { x: number }) => {
  const from = Math.floor(xOf(s, columns) / 2)
  return cell.x >= from - 1 && cell.x <= from + SPRITE_WIDTH / 2
}

// Moves a whole cell (2px) at a time so the sprite always lands crisp.
export const step = (s: Sim, columns: number): Sim => {
  const t = s.t + TICK
  const { home, lo, hi } = patch(columns, s.props.position)
  let { x, dir, target, nextStroll, variant, variantAt } = s
  x = clamp(Number.isFinite(x) ? x : home, lo, hi)
  target = clamp(Number.isFinite(target) ? target : home, lo, hi)

  // Entering a state picks one of its animations at random; staying in it long enough picks another.
  const mode = modeOf({ ...s, t })
  if (mode !== s.mode || t - variantAt >= SWITCH_EVERY) {
    variant = pick(ANIMATIONS[mode].length, mode === s.mode ? variant : -1)
    variantAt = t
  }

  if (mode === 'working' && ANIMATIONS.working[variant]?.travels && t % 200 === 0) {
    if (x <= lo) dir = 1
    if (x >= hi) dir = -1
    x += 2 * dir
  } else if (mode === 'idle') {
    if (x === target && t >= nextStroll) {
      target = lo + 2 * Math.floor(Math.random() * ((hi - lo) / 2 + 1))
      nextStroll = t + 6000 + Math.random() * 9000
    }
    if (x !== target && t % 400 === 0) x += 2 * Math.sign(target - x)
  }

  return { ...s, t, x, dir, target, nextStroll, mode, variant, variantAt }
}

// The welcome logo's pixels, one cell narrower: ' ▐▛██▜▌ ' / '▝▜████▛▘' / '  ▘▘▝▝  '.
const BODY = '...##########...'
const LEGS = ['....#.#..#.#....', '...#.#....#.#...']
// Where the eye holes sit along their row; looking down, the eyes drop a row, toward the prompt.
const HOLES: Record<Eyes, number[]> = {
  front: [5, 10],
  left: [4, 9],
  right: [6, 11],
  down: [5, 10],
  downLeft: [4, 9],
  downRight: [6, 11],
  shut: [],
}
const ARM_COLS = { left: [1, 2], right: [13, 14] }
const WAVE: ArmRow[] = [2, 1, 0, 1]

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
const JUMP = [0, 1, 2, 2, 1, 0, 0, 0]
const DROP = [8, 6, 4, 2, 0, 0, 0, 0] // pixels above its spot as it falls in
const RISE = [6, 5, 4, 3, 2, 1, 0, 0] // and below it as it pops up
const STARTLE = [1, 2, 2, 2, 1]
const SPIN: Eyes[] = ['front', 'left', 'shut', 'right', 'front'] // shut, it shows the back of its head

type Pose = {
  x: number
  y: number
  eyes: Eyes
  stride: number
  tucked: boolean // legs folded under: lying down asleep, or sitting to think
  squashed: boolean // one row flatter: breathing out in its sleep, or landing
  hidden: boolean // not drawn: beaming in or out
  arms: { left: ArmRow; right: ArmRow }
  mark: string | null
}
type Plot = (x: number, y: number) => void

// One way of acting out a state: it shapes the pose for this beat and may draw around it.
type Animation = { travels?: boolean; act: (pose: Pose, beat: number, plot: Plot, s: Sim) => void }

const blink = (beat: number) => beat % 40 === 0
const sincePoke = (s: Sim) => Math.floor((s.t - s.pokeAt) / TICK)
const sinceLeft = (s: Sim) => Math.floor((s.t - s.leftAt) / TICK)
const puff = (p: Pose, k: number, plot: Plot) => {
  // a ring of specks spreading out from where it stood
  const r = 2 * k
  for (const [dx, dy] of [[-r, 0], [r, 0], [0, -r], [0, r], [-r, -r], [r, -r], [-r, r], [r, r]] as const) plot(p.x + 7 + dx, p.y + 2 + Math.round(dy / 2))
}
const strolling = (p: Pose, s: Sim, beat: number) => (p.x !== s.target ? Math.floor(beat / 4) : 0)
const bothArms = (row: ArmRow) => ({ left: row, right: row })
const sparkle = (p: Pose, beat: number, plot: Plot) => {
  plot(p.x - 2, beat % 2 ? 0 : 3)
  plot(p.x + SPRITE_WIDTH + 1, beat % 2 ? 3 : 0)
}
const sitDown = (p: Pose) => {
  p.tucked = true
  p.y = REST + 2
}
const lieDown = (p: Pose) => {
  sitDown(p)
  p.eyes = 'shut'
}

export const ANIMATIONS: Record<Mode, Animation[]> = {
  idle: [
    // Blinks, and strolls somewhere new every few seconds.
    { act: (p, beat, _, s) => {
      p.stride = strolling(p, s, beat)
      if (blink(beat)) p.eyes = 'shut'
    } },
    // Looks around as it goes.
    { act: (p, beat, _, s) => {
      p.stride = strolling(p, s, beat)
      p.eyes = blink(beat) ? 'shut' : (['front', 'left', 'front', 'right'] as const)[Math.floor(beat / 12) % 4]!
    } },
    // Waves now and then, its arm sliding up its side and back.
    { act: (p, beat, _, s) => {
      p.stride = strolling(p, s, beat)
      if (beat % 50 < 12) p.arms.left = WAVE[beat % WAVE.length]!
      if (blink(beat)) p.eyes = 'shut'
    } },
  ],
  sleep: [
    // Lies down, a bubble rising now and then.
    { act: (p, beat, plot) => {
      lieDown(p)
      if (beat % 30 < 10) plot(p.x + 1, p.y - 1)
      else if (beat % 30 < 20) plot(p.x, p.y - 2)
    } },
    // Lies down, breathing slowly.
    { act: (p, beat) => {
      lieDown(p)
      p.squashed = beat % 30 >= 15
    } },
    // Dozes off on its feet, head nodding.
    { act: (p, beat) => {
      p.eyes = 'shut'
      if (beat % 24 >= 20) p.y += 1
    } },
  ],
  typing: [
    // Bounces.
    { act: (p, beat) => {
      p.y += beat % 2
      p.stride = beat
    } },
    // Tap-dances, eyes on the prompt.
    { act: (p, beat) => {
      p.eyes = 'down'
      p.stride = beat
    } },
    // Cheers, both arms sliding up and down.
    { act: (p, beat) => {
      p.arms = bothArms(WAVE[beat % WAVE.length]!)
    } },
  ],
  watching: [
    // Looks down at the prompt.
    { act: (p, beat) => {
      p.eyes = blink(beat) ? 'shut' : 'down'
    } },
    // Reads along, eyes moving across the line.
    { act: (p, beat) => {
      p.eyes = blink(beat) ? 'shut' : (['downLeft', 'down', 'downRight'] as const)[Math.floor(beat / 6) % 3]!
    } },
    // Nods along.
    { act: (p, beat) => {
      p.eyes = blink(beat) ? 'shut' : 'down'
      if (beat % 15 < 2) p.y += 1
    } },
  ],
  happy: [
    // Bounces with sparkles.
    { act: (p, beat, plot) => {
      p.y += beat % 4 < 2 ? 1 : 0
      sparkle(p, beat, plot)
    } },
    // Throws its arms up high and flaps them.
    { act: (p, beat, plot) => {
      p.arms = bothArms(Math.floor(beat / 2) % 2 ? 1 : 0)
      sparkle(p, beat, plot)
    } },
    // Jumps for joy.
    { act: (p, beat, plot) => {
      p.y -= JUMP[beat % JUMP.length]!
      sparkle(p, beat, plot)
    } },
  ],
  oops: [
    // Shakes, eyes squeezed shut.
    { act: (p, beat) => {
      p.x += beat % 2 ? 1 : -1
      p.eyes = 'shut'
    } },
    // Flinches back, then shivers.
    { act: (p, beat, _, s) => {
      p.eyes = 'shut'
      if (s.t - s.blipAt < 400) {
        p.x += 2
        p.y -= 1
      } else {
        p.x += beat % 2
      }
    } },
  ],
  thinking: [
    // Sits, eyes darting side to side, while a thought bubble grows over its head and pops.
    { act: (p, beat, plot) => {
      sitDown(p)
      p.eyes = Math.floor(beat / 7) % 2 ? 'right' : 'left'
      const phase = beat % 20
      const stages = phase < 3 || phase >= 17 ? 0 : Math.min(3, Math.floor((phase + 1) / 4))
      BUBBLE.slice(0, stages).flat().forEach(([dx, dy]) => plot(p.x + dx, p.y + dy))
    } },
    // Sits and follows a spark of an idea drifting back and forth over its head.
    { act: (p, beat, plot) => {
      sitDown(p)
      const i = beat % 18
      const dx = 3 + (i < 9 ? i : 17 - i)
      const dy = dx >= 6 && dx <= 9 ? -3 : -2
      plot(p.x + dx, p.y + dy)
      plot(p.x + dx + 1, p.y + dy)
      p.eyes = dx < 6 ? 'left' : dx > 9 ? 'right' : 'front'
    } },
    // Sits and scratches its head, one arm rubbing up and down by its eyes.
    { act: (p, beat) => {
      sitDown(p)
      p.eyes = 'left'
      p.arms.right = Math.floor(beat / 2) % 2 ? 1 : 0
    } },
  ],
  working: [
    // Scuttles back and forth.
    { travels: true, act: (p, beat) => {
      p.stride = Math.floor(beat / 2)
    } },
    // Hammers away on the spot, eyes on its work, arms pumping in turn.
    { act: (p, beat) => {
      p.eyes = 'down'
      const leftUp = Math.floor(beat / 2) % 2 === 0
      p.arms = { left: leftUp ? 1 : 3, right: leftUp ? 3 : 1 }
    } },
    // Hops along.
    { travels: true, act: (p, beat) => {
      p.stride = Math.floor(beat / 2)
      p.y -= Math.floor(beat / 2) % 2
    } },
  ],
  waiting: [
    { act: (p, beat) => {
      if (beat % 12 < 2) p.y += 1
      p.mark = '?'
    } },
  ],
  entering: [
    // Drops in from above and lands with a squash.
    { act: (p, beat, _, s) => {
      const k = Math.floor(s.t / TICK)
      p.y -= DROP[k] ?? 0
      p.squashed = k === 4 || k === 5
    } },
    // Pops up out of the ground.
    { act: (p, _, __, s) => {
      p.y += RISE[Math.floor(s.t / TICK)] ?? 0
    } },
    // Beams in, flickering among sparkles.
    { act: (p, beat, plot, s) => {
      const k = Math.floor(s.t / TICK)
      p.hidden = k < 6 && k % 2 === 0
      if (k < 6) sparkle(p, beat, plot)
    } },
  ],
  leaving: [
    // Jumps up and out of sight.
    { act: (p, _, __, s) => {
      const k = sinceLeft(s)
      p.y -= k < 2 ? -k : 2 * (k - 1)
      p.stride = k
    } },
    // Sinks into the ground.
    { act: (p, _, __, s) => {
      p.y += sinceLeft(s)
      p.eyes = 'shut'
    } },
    // Waves goodbye, then vanishes in a puff.
    { act: (p, _, plot, s) => {
      const k = sinceLeft(s)
      if (k < 5) {
        p.arms.left = WAVE[k % WAVE.length]!
      } else {
        p.hidden = true
        if (k < 9) puff(p, k - 4, plot)
      }
    } },
  ],
  poked: [
    // Giggles, eyes squeezed shut, hands flapping by its face.
    { act: (p, beat) => {
      p.eyes = 'shut'
      p.y += beat % 2
      p.arms = bothArms(beat % 2 ? 1 : 2)
    } },
    // Jumps in surprise.
    { act: (p, _, __, s) => {
      const k = sincePoke(s)
      p.y -= STARTLE[k] ?? 0
      if (k < 8) p.mark = '!'
    } },
    // Spins around on the spot.
    { act: (p, _, __, s) => {
      const k = sincePoke(s)
      p.eyes = SPIN[Math.floor(k / 2)] ?? 'front'
      p.stride = k
    } },
    // Plays peekaboo: ducks down hiding, peeks out, then pops back up.
    { act: (p, _, __, s) => {
      const k = sincePoke(s)
      if (k < 8) {
        sitDown(p)
        p.eyes = k < 4 ? 'shut' : 'front'
      } else if (k < 10) {
        p.y -= 1
      }
    } },
  ],
}

const sprite = (p: Pose) => {
  const rows = [BODY, BODY, BODY, BODY, ...(p.tucked ? [] : [LEGS[p.stride % 2]!])].map(row => [...row])
  const eyeRow = p.eyes.startsWith('down') ? 2 : 1
  for (const col of HOLES[p.eyes]) rows[eyeRow]![col] = '.'
  // An arm keeps its shape and slides up or down the side of the body.
  for (const side of ['left', 'right'] as const) {
    for (const col of ARM_COLS[side]) rows[p.arms[side]]![col] = '#'
  }
  return (p.squashed ? rows.slice(1) : rows).map(row => row.join(''))
}

export const draw = (s: Sim, columns: number): string[] => {
  const width = columns * 2
  const px = Array.from({ length: ROWS * 2 }, () => new Array<boolean>(width).fill(false))
  const plot: Plot = (x, y) => {
    if (x >= 0 && x < width && y >= 0 && y < ROWS * 2) px[y]![x] = true
  }

  const beat = Math.floor(s.t / TICK)
  const mode = modeOf(s)
  const animations = ANIMATIONS[mode]
  const animation = (s.mode === mode && animations[s.variant]) || animations[0]!
  // Stands on whole cells so it lines up with the logo; hops dip half a cell.
  const pose: Pose = {
    x: xOf(s, columns),
    y: REST,
    eyes: 'front',
    stride: 0,
    tucked: false,
    squashed: false,
    hidden: false,
    arms: { left: 2, right: 2 },
    mark: null,
  }
  animation.act(pose, beat, plot, s)

  if (!pose.hidden) {
    sprite(pose).forEach((row, dy) =>
      [...row].forEach((p, dx) => p === '#' && plot(pose.x + dx, pose.y + dy + (pose.squashed ? 1 : 0))),
    )
  }

  const lines = Array.from({ length: ROWS }, (_, r) => {
    let line = ''
    for (let c = 0; c < columns; c++) {
      const bit = (dy: number, dx: number) => (px[r * 2 + dy]![c * 2 + dx] ? 1 : 0)
      line += QUADS[bit(0, 0) * 8 + bit(0, 1) * 4 + bit(1, 0) * 2 + bit(1, 1)]
    }
    return line
  })

  const markAt = Math.floor(pose.x / 2) - 1
  if (pose.mark && markAt >= 0) {
    lines[0] = lines[0]!.slice(0, markAt) + pose.mark + lines[0]!.slice(markAt + 1)
  }

  return lines
}

// With fewer rows than it draws, it gives up the headroom first, then keeps its head and arms over its legs.
export const crop = (lines: string[], rows: number) => {
  const from = rows >= ROWS ? 0 : 1
  return lines.slice(from, from + Math.max(1, rows))
}

const Critter: ClientModule<CritterProps, Sim> = (props, surface) => {
  const s = surface.state
  if (s === undefined) {
    surface.every(TICK, () => surface.setState(step(surface.state!, surface.columns)))
    surface.onPointer(event => {
      const now = surface.state
      if (now && event.type === 'down' && hits(now, surface.columns, event)) surface.setState(poke(now))
    })
    surface.setState(initial(props))
  } else if (
    s.props.seq !== props.seq ||
    s.props.isWorking !== props.isWorking ||
    s.props.activity !== props.activity ||
    s.props.drafting !== props.drafting ||
    s.props.position !== props.position ||
    s.props.isLeaving !== props.isLeaving
  ) {
    surface.setState(receive(s, props))
  }

  const { Box, Text } = surface.elements
  const lines = s ? crop(draw(s, surface.columns), surface.rows || ROWS) : []

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
