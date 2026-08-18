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
.dsh-lb-panel{position:fixed;left:12px;bottom:128px;z-index:40;display:flex;flex-direction:column;width:460px;max-width:calc(100vw - 24px);max-height:70vh;overflow:hidden;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-base);box-shadow:var(--dsw-shadow-lv2)}
.dsh-lb-header{flex:none;display:flex;align-items:flex-start;justify-content:space-between;gap:8px;padding:12px 12px 8px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dsh-lb-heading{min-width:0}
.dsh-lb-title{display:block;font-size:14px;font-weight:600;line-height:20px;color:var(--dsw-alias-label-primary)}
.dsh-lb-sub{display:block;margin-top:2px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.dsh-lb-refresh{flex:none;height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.dsh-lb-refresh:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}
.dsh-lb-tabs{flex:none;display:flex;gap:4px;padding:8px 12px 0}
.dsh-lb-tab{flex:1;height:32px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;cursor:pointer}
.dsh-lb-tab[data-active]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-weight:600}
.dsh-lb-body{flex:1;min-height:0;overflow-y:auto;padding:8px 12px 12px}
.dsh-lb-note,.dsh-lb-error{margin:8px 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dsh-lb-error{color:var(--dsw-alias-state-error-primary)}
.dsh-lb-list{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}
.dsh-lb-row{display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:8px;align-items:start;padding:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-elevated,transparent)}
.dsh-lb-rank{width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;border-radius:8px;font-size:12px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover)}
.dsh-lb-rank.is-1{color:#7a4b00;background:#f6d58b}
.dsh-lb-rank.is-2{color:#3d4a5c;background:#d5dde8}
.dsh-lb-rank.is-3{color:#6a3b16;background:#e8c4a0}
.dsh-lb-main{min-width:0}
.dsh-lb-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600;line-height:18px;color:var(--dsw-alias-label-primary);text-decoration:none}
.dsh-lb-name:hover{text-decoration:underline}
.dsh-lb-desc{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin:2px 0 0;font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary)}
.dsh-lb-meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.dsh-lb-actions{display:flex;flex-direction:column;gap:4px}
.dsh-lb-action{height:26px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer;white-space:nowrap}
.dsh-lb-action:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}
.dsh-lb-foot{flex:none;padding:8px 12px 10px;border-top:1px solid var(--dsw-alias-border-l2);font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
`.trim()

/** Inject the panel stylesheet once per page. */
export function ensureLeaderboardStyles(): void {
  if (typeof document === 'undefined') return
  if (document.querySelector('style[data-plugin-css="dsh-plugin-leaderboard"]') !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-plugin-leaderboard'
  tag.dataset.pluginCss = 'dsh-plugin-leaderboard'
  tag.textContent = LEADERBOARD_CSS
  document.head.appendChild(tag)
}
