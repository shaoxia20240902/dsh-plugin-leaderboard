export const CLICK_LOCK: string
export const CLICK_WINDOW_MS: number
export const CLICK_KINDS: readonly string[]

export function parseClickKind(raw: unknown): '' | 'install' | 'interpret' | 'recommend'
export function decideClick(lastMs: number, nowMs: number, windowMs?: number): 'count' | 'cooldown'
