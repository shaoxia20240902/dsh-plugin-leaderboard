/** CSS injected once when the client factory runs. */
export const LEADERBOARD_CSS = `
.dsh-lb-layer{position:relative;flex:none;display:flex;align-items:center;width:100%;height:49px;margin:8px 0 0}
.dsh-lb-layer.is-rail{width:36px;height:36px;margin:0}
.dsh-lb-badge{display:inline-flex;align-items:center;gap:8px;width:100%;height:49px;padding:0 8px 0 6px;border:none;border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;cursor:pointer;overflow:hidden}
.dsh-lb-badge:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}
.dsh-lb-badge[data-active]{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-lb-layer.is-rail .dsh-lb-badge{justify-content:center;width:36px;height:36px;padding:0;border-radius:50%}
.dsh-lb-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-lb-layer.is-rail .dsh-lb-label{display:none}
.dsh-lb-icon{flex:none;display:inline-flex}
.dsh-lb-panel{position:fixed;left:12px;bottom:128px;z-index:40;display:flex;flex-direction:column;width:400px;max-width:calc(100vw - 24px);max-height:68vh;overflow:hidden;border:1px solid var(--dsw-alias-border-l1);border-radius:16px;background:var(--dsw-alias-bg-base);box-shadow:var(--dsw-shadow-lv2)}
.dsh-lb-header{flex:none;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px 8px}
.dsh-lb-heading{min-width:0}
.dsh-lb-title{display:block;font-size:13px;font-weight:600;line-height:18px;color:var(--dsw-alias-label-primary)}
.dsh-lb-sub{display:block;margin-top:1px;font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary)}
.dsh-lb-refresh{flex:none;height:24px;padding:0 8px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;cursor:pointer}
.dsh-lb-refresh:hover{background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-secondary)}
.dsh-lb-refresh:disabled{opacity:.55;cursor:default}
.dsh-lb-banner{flex:none;margin:0;padding:0 12px 6px;font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary)}
.dsh-lb-tabs{flex:none;display:flex;gap:0;padding:0 8px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dsh-lb-tab{flex:1;height:30px;padding:0;border:none;border-bottom:2px solid transparent;border-radius:0;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;cursor:pointer}
.dsh-lb-tab[data-active]{border-bottom-color:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary);font-weight:600}
.dsh-lb-body{flex:1;min-height:0;overflow-y:auto;padding:4px 4px 8px}
.dsh-lb-note,.dsh-lb-error{margin:10px 8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dsh-lb-error{color:var(--dsw-alias-state-error-primary)}
.dsh-lb-list{display:flex;flex-direction:column;margin:0;padding:0;list-style:none}
.dsh-lb-row{display:grid;grid-template-columns:28px minmax(0,1fr);gap:8px;align-items:start;padding:10px 8px;border:none;border-bottom:1px solid var(--dsw-alias-border-l2);background:transparent}
.dsh-lb-row:last-child{border-bottom:none}
.dsh-lb-rank{width:22px;height:22px;margin-top:1px;display:inline-flex;align-items:center;justify-content:center;border-radius:6px;font-size:11px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary);background:transparent}
.dsh-lb-rank.is-1{color:#8a5a00;background:#f6d58b}
.dsh-lb-rank.is-2{color:#3d4a5c;background:#d5dde8}
.dsh-lb-rank.is-3{color:#6a3b16;background:#e8c4a0}
.dsh-lb-main{min-width:0}
.dsh-lb-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600;line-height:18px;color:var(--dsw-alias-label-primary);text-decoration:none}
.dsh-lb-name:hover{text-decoration:underline}
.dsh-lb-desc{display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden;margin:2px 0 0;font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.dsh-lb-meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.dsh-lb-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.dsh-lb-action{height:24px;padding:0 8px;border:none;border-radius:6px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer;white-space:nowrap}
.dsh-lb-action:hover{background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-primary)}
.dsh-lb-action:disabled{opacity:.6;cursor:default}
`.trim()

/** Inject or replace the panel stylesheet. */
export function ensureLeaderboardStyles(): void {
  if (typeof document === 'undefined') return
  const existing = document.querySelector('style[data-plugin-css="dsh-plugin-leaderboard"]')
  if (existing !== null) {
    existing.textContent = LEADERBOARD_CSS
    return
  }
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-plugin-leaderboard'
  tag.dataset.pluginCss = 'dsh-plugin-leaderboard'
  tag.textContent = LEADERBOARD_CSS
  document.head.appendChild(tag)
}
