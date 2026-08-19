/** Same IP + same repo + same action counts at most once per window. */
export const CLICK_LOCK = 'dsh_plugin_board_click'
export const CLICK_WINDOW_MS = 15 * 60 * 1000

/** @type {readonly string[]} */
export const CLICK_KINDS = ['install', 'interpret', 'recommend']

/**
 * @param {unknown} raw
 * @returns {'' | 'install' | 'interpret' | 'recommend'}
 */
export function parseClickKind(raw) {
  const value = String(raw ?? '').trim().toLowerCase()
  if (value === 'install' || value === 'download' || value === 'copy') return 'install'
  if (value === 'interpret' || value === 'explain' || value === 'read') return 'interpret'
  if (value === 'recommend' || value === 'rec' || value === 'like') return 'recommend'
  return ''
}

/**
 * @param {number} lastMs
 * @param {number} nowMs
 * @param {number} [windowMs]
 * @returns {'count' | 'cooldown'}
 */
export function decideClick(lastMs, nowMs, windowMs = CLICK_WINDOW_MS) {
  if (lastMs <= 0) return 'count'
  return nowMs - lastMs < windowMs ? 'cooldown' : 'count'
}
