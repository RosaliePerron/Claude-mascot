export type Activity = 'thinking' | 'tool' | 'waiting'
export type Blip = 'typing' | 'happy' | 'oops'
export type Mood = { activity: Activity; blip: Blip | null; seq: number; drafting: boolean }
export type CritterProps = Mood & { isWorking: boolean }

declare module 'claude-code' {
  interface PluginState {
    mascot: { mood: Mood }
  }
}
