export type Activity = 'thinking' | 'working' | 'waiting'
export type Blip = 'typing' | 'happy' | 'oops'
export type Mood = { activity: Activity; blip: Blip | null; seq: number; drafting: boolean }
export type Position = 'left' | 'center' | 'right'
export type CritterProps = Mood & { isWorking: boolean; position: Position }

declare module 'claude-code' {
  interface PluginState {
    mascot: { mood: Mood }
  }
}
