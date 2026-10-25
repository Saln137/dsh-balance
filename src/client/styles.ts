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

/* 双行行高 52：与上下相邻的账号/设置行节奏一致，又留得下「今日消费」这行小字。 */
.dshb-trigger {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 52px;
  margin: 0;
  padding: 0 10px 0 8px;
  box-sizing: border-box;
  border: 0;
  border-radius: var(--dsw-radius-md, 12px);
  background: transparent;
  color: var(--dsw-alias-label-primary, inherit);
  font-family: inherit;
  font-size: 14px;
  line-height: 20px;
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

.dshb-text {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.dshb-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.dshb-label {
  flex: none;
  color: var(--dsw-alias-label-primary, inherit);
  white-space: nowrap;
}

/* 第二行（今日消费）始终占位，避免数据到达时行高跳动。 */
.dshb-sub {
  min-height: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-tertiary, inherit);
  font-size: 11px;
  line-height: 14px;
  font-variant-numeric: tabular-nums;
}

/* 金额独立成右列、随整行垂直居中（不再被第二行顶到上面）。 */
.dshb-value {
  flex: none;
  margin-left: auto;
  padding-left: 8px;
  white-space: nowrap;
  font-size: 15px;
  line-height: 22px;
  font-weight: 600;
  letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
}

.dshb-low-tag {
  flex: none;
  padding: 0 5px;
  border-radius: var(--dsw-radius-xs, 4px);
  color: var(--dsw-alias-state-error-primary, #d93a3a);
  background: rgba(217, 58, 58, 0.12);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d93a3a) 14%, transparent);
  font-size: 10px;
  line-height: 14px;
  font-weight: 500;
}

/* ---- 低余额：整行染红 + 警示图标缓慢呼吸，扫一眼就能发现 ---- */
.dshb-root.dshb-low .dshb-trigger {
  background: rgba(217, 58, 58, 0.08);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d93a3a) 10%, transparent);
}

.dshb-root.dshb-low .dshb-trigger:hover {
  background: rgba(217, 58, 58, 0.14);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d93a3a) 16%, transparent);
}

/* ---- 余额流速：表面扫光（品牌蓝打底 + 白色高光核心，从左向右掠过） ----
   三档只差宽度/周期/强度；只动 transform，不触发重排。 */
.dshb-root.dshb-flow-1 {
  --dshb-sheen-w: 28%;
  --dshb-sheen-d: 4.6s;
  --dshb-sheen-core: 0.22;
  --dshb-sheen-a: 6%;
  --dshb-sheen-b: 14%;
}

.dshb-root.dshb-flow-2 {
  --dshb-sheen-w: 32%;
  --dshb-sheen-d: 2.8s;
  --dshb-sheen-core: 0.34;
  --dshb-sheen-a: 9%;
  --dshb-sheen-b: 22%;
}

.dshb-root.dshb-flow-3 {
  --dshb-sheen-w: 36%;
  --dshb-sheen-d: 1.8s;
  --dshb-sheen-core: 0.46;
  --dshb-sheen-a: 12%;
  --dshb-sheen-b: 30%;
}

.dshb-root.dshb-flow-1,
.dshb-root.dshb-flow-2,
.dshb-root.dshb-flow-3 {
  --dshb-sheen-accent: var(--dsw-alias-state-business-primary, #4176e6);
}

/* 低余额时扫光换成告警红：红色只属于「余额不足」，两个语义不打架。 */
.dshb-root.dshb-low {
  --dshb-sheen-accent: var(--dsw-alias-state-error-primary, #d93a3a);
}

.dshb-root.dshb-flow-1 .dshb-trigger::after,
.dshb-root.dshb-flow-2 .dshb-trigger::after,
.dshb-root.dshb-flow-3 .dshb-trigger::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: var(--dshb-sheen-w);
  background:
    linear-gradient(
      100deg,
      transparent 40%,
      rgba(255, 255, 255, var(--dshb-sheen-core)) 50%,
      transparent 60%
    ),
    linear-gradient(
      100deg,
      transparent 0%,
      color-mix(in srgb, var(--dshb-sheen-accent) var(--dshb-sheen-a), transparent) 24%,
      color-mix(in srgb, var(--dshb-sheen-accent) var(--dshb-sheen-b), transparent) 50%,
      color-mix(in srgb, var(--dshb-sheen-accent) var(--dshb-sheen-a), transparent) 72%,
      transparent 100%
    );
  transform: translateX(-150%) skewX(-16deg);
  animation: dshb-sheen var(--dshb-sheen-d) linear infinite;
  opacity: 0;
  pointer-events: none;
  /* 纵向渐隐：光带上下边缘融进底色，避免看起来像一块贴上去的蓝色色块。 */
  mask-image: linear-gradient(180deg, transparent 0%, #000 16%, #000 84%, transparent 100%);
  -webkit-mask-image: linear-gradient(180deg, transparent 0%, #000 16%, #000 84%, transparent 100%);
}

/* 折叠成 36×36 图标时：同一条光带，窄一点、淡一点。 */
.dshb-root.dshb-rail.dshb-flow-1 .dshb-trigger::after,
.dshb-root.dshb-rail.dshb-flow-2 .dshb-trigger::after,
.dshb-root.dshb-rail.dshb-flow-3 .dshb-trigger::after {
  width: 72%;
}

@keyframes dshb-sheen {
  0% {
    transform: translateX(-150%) skewX(-16deg);
    opacity: 0;
  }
  8% {
    opacity: 1;
  }
  92% {
    opacity: 1;
  }
  100% {
    transform: translateX(330%) skewX(-16deg);
    opacity: 0;
  }
}

.dshb-root.dshb-low .dshb-icon {
  color: var(--dsw-alias-state-error-primary, #d93a3a);
  animation: dshb-alert-pulse 2.4s ease-in-out infinite;
}

.dshb-root.dshb-low .dshb-value {
  color: var(--dsw-alias-state-error-primary, #d93a3a);
  font-weight: 600;
}

@keyframes dshb-alert-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
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

/* ---- 余额主数字 + 今日消费/充值 ---- */
.dshb-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 0 8px;
}

.dshb-hero-main {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.dshb-hero-amount {
  font-size: 24px;
  line-height: 32px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
  white-space: nowrap;
}

.dshb-hero-code {
  color: var(--dsw-alias-label-tertiary, inherit);
  font-size: 11px;
}

.dshb-hero-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  padding-bottom: 2px;
}

.dshb-chip {
  color: var(--dsw-alias-label-secondary, inherit);
  font-size: 11px;
  line-height: 15px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.dshb-chip-up {
  color: var(--dsw-alias-state-success-primary, #1a7f37);
}

/* ---- 低余额横幅 ---- */
.dshb-alert {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 2px 0 8px;
  padding: 8px 10px;
  border-radius: var(--dsw-radius-md, 12px);
  background: rgba(217, 58, 58, 0.10);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d93a3a) 12%, transparent);
}

.dshb-alert-main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.dshb-alert-title {
  color: var(--dsw-alias-state-error-primary, #d93a3a);
  font-size: 12px;
  line-height: 16px;
  font-weight: 600;
}

.dshb-alert-text {
  color: var(--dsw-alias-label-secondary, inherit);
  font-size: 11px;
  line-height: 15px;
}

.dshb-topup {
  flex: none;
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 10px;
  border-radius: var(--dsw-radius-sm, 8px);
  background: var(--dsw-alias-button-primary-fill, #171717);
  color: var(--dsw-alias-label-primary-inverted, #ffffff);
  font-size: 11px;
  font-weight: 500;
  text-decoration: none;
  white-space: nowrap;
}

.dshb-topup:hover {
  background: var(--dsw-alias-button-primary-hover, #333333);
}

.dshb-topup:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary, currentColor);
  outline-offset: 1px;
}

/* ---- 其余币种明细 ---- */
.dshb-wallet {
  padding: 7px 0;
  border-top: 0.5px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.2));
}

.dshb-wallet-main {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.dshb-wallet-amount {
  font-size: 16px;
  line-height: 24px;
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
  line-height: 18px;
}

.dshb-sep {
  color: var(--dsw-alias-label-tertiary, inherit);
}

/* 主币种分项直接跟在 hero 下面，给下方分隔线留一点呼吸。 */
.dshb-breakdown {
  padding-bottom: 8px;
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
  .dshb-root.dshb-low .dshb-icon { animation: none; }
  /* 减少动态偏好：扫光整条去掉（余额变化本身仍然可见）。 */
  .dshb-root.dshb-flow-1 .dshb-trigger::after,
  .dshb-root.dshb-flow-2 .dshb-trigger::after,
  .dshb-root.dshb-flow-3 .dshb-trigger::after {
    animation: none;
    opacity: 0;
  }
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
