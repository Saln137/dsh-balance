/**
 * 组件样式：一次性注入到 document.head 的 `<style>`。
 *
 * 为什么不用 CSS Module：客户端半侧是**单文件普通脚本**，没有构建期的样式
 * 管线（DSH 内置包才有），所以样式以字符串随包发布。类名统一 `dshb-` 前缀，
 * 颜色/圆角/阴影全部走 `--dsw-*` 主题变量并带兜底值——主题令牌改名时最坏是
 * 退回中性灰，而不是整块控件不可见。
 */

/** 样式标签 id（重复注入的哨兵）。 */
const STYLE_ID = 'dsh-balance-styles'

/** 全部样式。 */
const STYLES = `
.dshb-root {
  display: flex;
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
}

.dshb-root.dshb-rail {
  flex: none;
  width: 36px;
  justify-content: center;
}

.dshb-trigger {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 42px;
  margin: 0;
  padding: 0 10px 0 8px;
  box-sizing: border-box;
  border: 0;
  border-radius: var(--dsw-radius-md, 12px);
  background: transparent;
  color: var(--dsw-alias-label-primary, inherit);
  font-family: inherit;
  font-size: 14px;
  line-height: 22px;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  appearance: none;
  -webkit-appearance: none;
  transition: background-color 120ms ease;
}

.dshb-root.dshb-rail .dshb-trigger {
  flex: none;
  width: 36px;
  height: 36px;
  padding: 0;
  justify-content: center;
  gap: 0;
}

.dshb-trigger:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.12));
}

.dshb-trigger:active {
  background: var(--dsw-alias-interactive-bg-active, rgba(127, 127, 127, 0.18));
}

.dshb-trigger:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary, currentColor);
  outline-offset: -2px;
}

.dshb-icon {
  display: inline-flex;
  flex: none;
  /* 与相邻的「设置」行同色：图标跟随行文字色（label-primary），不额外调灰。 */
  color: inherit;
}

.dshb-label {
  flex: none;
  overflow: hidden;
  white-space: nowrap;
}

.dshb-value {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.dshb-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  corner-shape: round;
}

.dshb-root.dshb-rail .dshb-dot {
  position: absolute;
  top: 6px;
  right: 5px;
}

.dshb-dot-warn { background: var(--dsw-alias-state-warn-primary, #d9930d); }
.dshb-dot-error { background: var(--dsw-alias-state-error-primary, #d93a3a); }
.dshb-dot-muted { background: var(--dsw-alias-label-tertiary, #9aa0a6); }

.dshb-pop {
  position: fixed;
  z-index: 2000;
  width: 256px;
  box-sizing: border-box;
  padding: 12px;
  border: 0;
  border-radius: var(--dsw-radius-lg, 16px);
  background: var(--dsw-specific-menu, #f8f9fa);
  box-shadow: var(--dsw-elevation-panel, 0 8px 32px rgba(0, 0, 0, 0.18));
  color: var(--dsw-alias-label-primary, inherit);
  font-family: inherit;
  font-size: 13px;
  line-height: 20px;
  animation: dshb-pop-in 120ms ease-out;
}

.dshb-pop:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary, currentColor);
  outline-offset: 2px;
}

@keyframes dshb-pop-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
}

.dshb-pop-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}

.dshb-pop-title {
  font-weight: 500;
}

.dshb-badge {
  flex: none;
  padding: 0 6px;
  height: 18px;
  line-height: 18px;
  border-radius: var(--dsw-radius-xs, 4px);
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.12));
  color: var(--dsw-alias-label-secondary, inherit);
  font-size: 11px;
  white-space: nowrap;
}

.dshb-wallet {
  padding: 8px 0;
}

.dshb-wallet + .dshb-wallet {
  border-top: 0.5px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.2));
}

.dshb-wallet-main {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.dshb-wallet-amount {
  font-size: 20px;
  line-height: 28px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.dshb-wallet-code {
  color: var(--dsw-alias-label-tertiary, inherit);
  font-size: 11px;
}

.dshb-wallet-sub {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 2px;
  color: var(--dsw-alias-label-secondary, inherit);
  font-size: 12px;
}

.dshb-sep {
  color: var(--dsw-alias-label-tertiary, inherit);
}

.dshb-empty {
  padding: 10px 0 6px;
}

.dshb-empty-title {
  font-weight: 500;
}

.dshb-empty-hint {
  margin-top: 4px;
  color: var(--dsw-alias-label-secondary, inherit);
  font-size: 12px;
}

.dshb-notice {
  margin-top: 8px;
  padding: 6px 8px;
  border-radius: var(--dsw-radius-sm, 8px);
  background: var(--dsw-alias-state-warn-tertiary, rgba(217, 147, 13, 0.12));
  color: var(--dsw-alias-state-warn-label, inherit);
  font-size: 12px;
  word-break: break-word;
}

.dshb-pop-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 0.5px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.2));
}

.dshb-updated {
  color: var(--dsw-alias-label-tertiary, inherit);
  font-size: 12px;
}

.dshb-refresh {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 8px;
  box-sizing: border-box;
  border: 0;
  border-radius: var(--dsw-radius-sm, 8px);
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.12));
  color: var(--dsw-alias-label-primary, inherit);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}

.dshb-refresh:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-active, rgba(127, 127, 127, 0.2));
}

.dshb-refresh:disabled {
  opacity: 0.6;
  cursor: default;
}

.dshb-refresh:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary, currentColor);
  outline-offset: 1px;
}

.dshb-refresh-icon {
  display: inline-flex;
}

.dshb-spin {
  animation: dshb-spin 900ms linear infinite;
}

@keyframes dshb-spin {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .dshb-pop { animation: none; }
  .dshb-spin { animation: none; }
  .dshb-trigger { transition: none; }
}
`

/** 是否已经注入过（同页多入口也只注入一次）。 */
let installed = false

/**
 * 确保样式已注入。
 * 幂等：插件重载、多个页面副本都不会堆出第二份。
 */
export function ensureStyles(): void {
  if (installed || typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) {
    installed = true
    return
  }
  const element = document.createElement('style')
  element.id = STYLE_ID
  element.textContent = STYLES
  document.head.appendChild(element)
  installed = true
}
