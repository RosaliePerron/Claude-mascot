export type Activity = 'thinking' | 'working' | 'waiting'
export type Blip = 'typing' | 'happy' | 'oops'
export type Mood = { activity: Activity; blip: Blip | null; seq: number; drafting: boolean }
export type Position = 'left' | 'center' | 'right'
// A running subagent's mascot: its own mood, and whether its run has ended.
export type Helper = Mood & { isDone: boolean; isLeaving: boolean }
export type CritterProps = Mood & { isWorking: boolean; position: Position; isHelper: boolean; isLeaving: boolean }

declare module 'claude-code' {
  interface PluginState {
    mascot: { mood: Mood; helpers: Record<string, Helper> }
  }
}
