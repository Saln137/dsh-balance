/**
 * 侧边栏底部的余额控件：一个常驻胶囊 + 一个详情浮层。
 *
 * 交互契约：
 * - 胶囊常驻（`sidebar.footer.action`），左键展开详情，`Escape`/点外部关闭；
 * - 数据来自宿主 `GET /dsh-balance/state`：页面只管展示，不自己排定时器去查官方接口；
 * - 轮询间隔由宿主下发（`pollMs`），页面重新可见/获得焦点时补一次；
 * - 「刷新」按钮走 `POST /dsh-balance/refresh`，绕过缓存的定时器。
 *
 * 渲染方式：`react` 由 `__ModuleLoader__` 的 factory `require` 注入（平台种子模块），
 * 组件里只用 `React.createElement`，因此客户端产物是一个**没有顶层 import** 的
 * 普通脚本——这正是 DSH 客户端模块系统要求的形态。
 */
import type * as ReactNS from 'react'
import { formatAmount, formatClock, pickPrimaryWallet } from '../shared/format.ts'
import { ROUTE_PREFIX, type BalanceStatus, type BalanceView } from '../shared/types.ts'
import type { Translate } from './context.ts'
import { ensureStyles } from './styles.ts'

/** 图标组件的最小 props（与 dsh-client-ui-primitives 的 IconProps 同形）。 */
export interface IconProps {
  size?: number
  className?: string
}

/** 可选使用的官方图标集；缺失时退回内置 SVG。 */
export interface IconsModule {
  IconGaugeOutlineMedium?: ReactNS.ComponentType<IconProps>
  IconRefreshOutlineMedium?: ReactNS.ComponentType<IconProps>
}

/** `react-dom.createPortal`；缺失时就地渲染浮层。 */
export type PortalLike = (node: ReactNS.ReactNode, container: Element) => ReactNS.ReactNode

/** 创建控件所需的外部依赖（全部由装配层注入）。 */
export interface WidgetDeps {
  React: typeof ReactNS
  icons: IconsModule | undefined
  portal: PortalLike | undefined
}

/** 插槽注入的 props：`wide` 来自侧边栏 owner，`t` 来自声明的 locale 命名空间。 */
export interface WidgetProps {
  wide?: boolean
  t: Translate
}

/** 浮层定位（相对视口）。 */
interface Placement {
  left: number
  bottom: number
}

/** 浮层宽度：与侧边栏收起的按钮同宽（256），浮层正好叠在胶囊上方不越出栏位。 */
const POPOVER_WIDTH = 256

/** 宿主没下发轮询间隔时的兜底值。 */
const POLL_FALLBACK_MS = 15_000

/** 状态 → 视觉语气。 */
type Tone = 'ok' | 'warn' | 'error' | 'muted'

/**
 * 状态到视觉语气：只有 warn/error/muted 会显示状态点，
 * 「一切正常」不该在界面上常驻一个绿点打扰用户。
 * @param status - 快照状态。
 * @returns 语气。
 */
function toneOf(status: BalanceStatus): Tone {
  if (status === 'ready') return 'ok'
  if (status === 'stale') return 'warn'
  if (status === 'failed') return 'error'
  return 'muted'
}

/**
 * 没有可展示金额时的占位文案键。
 * @param status - 快照状态。
 * @returns 文案键。
 */
function placeholderKey(status: BalanceStatus): string {
  if (status === 'loading') return 'loading'
  if (status === 'signed-out') return 'signedOutShort'
  if (status === 'no-credential') return 'notConfiguredShort'
  if (status === 'failed') return 'unavailable'
  return 'unavailable'
}

/**
 * 创建余额控件组件。
 * @param deps - React 与可选的平台模块。
 * @returns 可直接交给 `ctx.slots.register` 的组件。
 */
export function createBalanceWidget(deps: WidgetDeps): ReactNS.ComponentType<WidgetProps> {
  const { React, icons, portal } = deps
  const h = React.createElement
  const { useCallback, useEffect, useRef, useState } = React

  /** 内置钱包图标（官方图标集不可用时）。 */
  const fallbackWalletIcon = (size: number): ReactNS.ReactElement =>
    h(
      'svg',
      { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
      h('rect', {
        x: '1.75',
        y: '4.25',
        width: '12.5',
        height: '9',
        rx: '2',
        stroke: 'currentColor',
        strokeWidth: '1.2',
      }),
      h('path', {
        d: 'M1.75 6.75h12.5',
        stroke: 'currentColor',
        strokeWidth: '1.2',
        strokeLinecap: 'round',
      }),
      h('circle', { cx: '11', cy: '9.75', r: '1', fill: 'currentColor' }),
    )

  /** 内置刷新图标。 */
  const fallbackRefreshIcon = (size: number): ReactNS.ReactElement =>
    h(
      'svg',
      { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
      h('path', {
        d: 'M13 8a5 5 0 1 1-1.55-3.63',
        stroke: 'currentColor',
        strokeWidth: '1.2',
        strokeLinecap: 'round',
      }),
      h('path', {
        d: 'M13 2.75V5.5h-2.75',
        stroke: 'currentColor',
        strokeWidth: '1.2',
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
    )

  const WalletIcon = icons?.IconGaugeOutlineMedium
  const RefreshIcon = icons?.IconRefreshOutlineMedium

  return function BalanceWidget(props: WidgetProps): ReactNS.ReactElement {
    const wide = props.wide !== false
    const t = props.t

    const [view, setView] = useState<BalanceView | null>(null)
    const [open, setOpen] = useState(false)
    const [busy, setBusy] = useState(false)
    const [requestError, setRequestError] = useState<string | null>(null)
    const [placement, setPlacement] = useState<Placement | null>(null)

    const alive = useRef(true)
    const buttonRef = useRef<HTMLButtonElement | null>(null)
    const popoverRef = useRef<HTMLDivElement | null>(null)

    /**
     * 拉一次快照。
     * @param force - true 时走 `POST /refresh`（用户显式要求刷新）。
     */
    const request = useCallback(async (force: boolean): Promise<void> => {
      if (force) setBusy(true)
      try {
        const response = await fetch(`${ROUTE_PREFIX}${force ? '/refresh' : '/state'}`, {
          method: force ? 'POST' : 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { accept: 'application/json' },
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const body = (await response.json()) as BalanceView
        if (!alive.current) return
        setView(body)
        setRequestError(null)
      } catch (error) {
        if (!alive.current) return
        setRequestError(error instanceof Error ? error.message : String(error))
      } finally {
        if (alive.current && force) setBusy(false)
      }
    }, [])

    // 首次挂载：注入样式 + 读一次（不阻塞渲染）。
    useEffect(() => {
      alive.current = true
      ensureStyles()
      void request(false)
      return () => {
        alive.current = false
      }
    }, [request])

    // 定时轮询：间隔由宿主下发；页面在后台时不打扰。
    useEffect(() => {
      const interval = Math.max(5_000, view?.pollMs ?? POLL_FALLBACK_MS)
      const timer = setInterval(() => {
        if (document.visibilityState !== 'hidden') void request(false)
      }, interval)
      return () => clearInterval(timer)
    }, [view?.pollMs, request])

    // 回到前台 / 窗口重新获得焦点：立刻补一次（用户刚操作过，余额最可能变）。
    useEffect(() => {
      const onVisible = (): void => {
        if (document.visibilityState === 'visible') void request(false)
      }
      const onFocus = (): void => void request(false)
      document.addEventListener('visibilitychange', onVisible)
      window.addEventListener('focus', onFocus)
      return () => {
        document.removeEventListener('visibilitychange', onVisible)
        window.removeEventListener('focus', onFocus)
      }
    }, [request])

    /** 量一次按钮位置，算出浮层落点（浮层在按钮正上方）。 */
    const measure = useCallback((): Placement | null => {
      const button = buttonRef.current
      if (button === null) return null
      const rect = button.getBoundingClientRect()
      return {
        left: Math.max(8, Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 8)),
        bottom: Math.max(8, window.innerHeight - rect.top + 8),
      }
    }, [])

    // 打开时量位置；窗口尺寸变化时跟随。
    useEffect(() => {
      if (!open) return
      const update = (): void => {
        const next = measure()
        if (next !== null) setPlacement(next)
      }
      update()
      popoverRef.current?.focus()
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }, [open, measure])

    // 关闭路径：点外部 / Escape。
    useEffect(() => {
      if (!open) return
      const onPointerDown = (event: PointerEvent): void => {
        const target = event.target as Node | null
        if (target === null) return
        if (buttonRef.current?.contains(target) === true) return
        if (popoverRef.current?.contains(target) === true) return
        setOpen(false)
      }
      const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape') return
        setOpen(false)
        buttonRef.current?.focus()
      }
      document.addEventListener('pointerdown', onPointerDown, true)
      document.addEventListener('keydown', onKeyDown, true)
      return () => {
        document.removeEventListener('pointerdown', onPointerDown, true)
        document.removeEventListener('keydown', onKeyDown, true)
      }
    }, [open])

    /** 胶囊点击：展开时先量好落点再打开，避免浮层闪一下再归位。 */
    const toggleOpen = useCallback((): void => {
      if (open) {
        setOpen(false)
        return
      }
      const next = measure()
      if (next !== null) setPlacement(next)
      setOpen(true)
    }, [open, measure])

    // ---- 派生展示值 ----
    const status: BalanceStatus = view?.status ?? 'loading'
    const wallets = view?.wallets ?? []
    const primary = pickPrimaryWallet(wallets, view?.displayCurrency ?? 'auto')
    const tone = toneOf(status)
    const valueText =
      primary !== undefined ? formatAmount(primary.total, primary.currency) : t(placeholderKey(status))
    const sourceText =
      view === null || view.source === 'none'
        ? t('source.none')
        : view.source === 'account'
          ? t('source.account')
          : t('source.apiKey')
    const updatedText =
      view?.updatedAt != null ? t('updated', { time: formatClock(view.updatedAt) }) : t('neverUpdated')
    const emptyTitle =
      status === 'signed-out'
        ? t('signedOut')
        : status === 'no-credential'
          ? t('noCredential')
          : status === 'failed'
            ? t('failed')
            : t('loading')
    const emptyHint =
      status === 'signed-out'
        ? t('signedOutHint')
        : status === 'no-credential'
          ? t('noCredentialHint')
          : status === 'failed'
            ? (view?.error ?? requestError ?? '')
            : ''
    const noticeParts: string[] = []
    if (status === 'stale') {
      noticeParts.push(t('staleNote'))
      if (view?.error !== undefined) noticeParts.push(view.error)
    }
    if (requestError !== null && status !== 'failed') noticeParts.push(requestError)
    const notice = noticeParts.join(' · ')

    // ---- 渲染 ----
    const iconNode =
      WalletIcon !== undefined
        ? h(WalletIcon, { size: wide ? 16 : 18, className: 'dshb-icon-glyph' })
        : fallbackWalletIcon(wide ? 16 : 18)

    const refreshIconNode =
      RefreshIcon !== undefined
        ? h(RefreshIcon, { size: 13 })
        : fallbackRefreshIcon(13)

    const stateDot =
      tone === 'ok'
        ? null
        : h('span', { className: `dshb-dot dshb-dot-${tone}`, 'aria-hidden': 'true' })

    const trigger = h(
      'button',
      {
        ref: buttonRef,
        type: 'button',
        className: 'dshb-trigger',
        'aria-haspopup': 'dialog',
        'aria-expanded': open ? 'true' : 'false',
        'aria-label': t('ariaLabel', { value: valueText }),
        ...(wide ? {} : { title: t('ariaLabel', { value: valueText }) }),
        onClick: toggleOpen,
      },
      h('span', { className: 'dshb-icon', 'aria-hidden': 'true' }, iconNode),
      wide ? h('span', { className: 'dshb-label' }, t('label')) : null,
      wide ? h('span', { className: 'dshb-value' }, valueText) : null,
      stateDot,
    )

    const popover =
      open && placement !== null
        ? h(
            'div',
            {
              ref: popoverRef,
              className: 'dshb-pop',
              role: 'dialog',
              'aria-label': t('title'),
              tabIndex: -1,
              style: { left: `${placement.left}px`, bottom: `${placement.bottom}px` },
            },
            h(
              'div',
              { className: 'dshb-pop-head' },
              h('span', { className: 'dshb-pop-title' }, t('title')),
              h('span', { className: 'dshb-badge' }, sourceText),
            ),
            wallets.length > 0
              ? wallets.map((wallet) =>
                  h(
                    'div',
                    { className: 'dshb-wallet', key: wallet.currency },
                    h(
                      'div',
                      { className: 'dshb-wallet-main' },
                      h('span', { className: 'dshb-wallet-amount' }, formatAmount(wallet.total, wallet.currency)),
                      h('span', { className: 'dshb-wallet-code' }, wallet.currency),
                    ),
                    wallet.granted !== undefined || wallet.toppedUp !== undefined
                      ? h(
                          'div',
                          { className: 'dshb-wallet-sub' },
                          wallet.granted !== undefined
                            ? h('span', null, t('granted', { amount: formatAmount(wallet.granted, wallet.currency) }))
                            : null,
                          wallet.granted !== undefined && wallet.toppedUp !== undefined
                            ? h('span', { className: 'dshb-sep' }, '·')
                            : null,
                          wallet.toppedUp !== undefined
                            ? h('span', null, t('toppedUp', { amount: formatAmount(wallet.toppedUp, wallet.currency) }))
                            : null,
                        )
                      : null,
                  ),
                )
              : h(
                  'div',
                  { className: 'dshb-empty' },
                  h('div', { className: 'dshb-empty-title' }, emptyTitle),
                  emptyHint.length > 0 ? h('div', { className: 'dshb-empty-hint' }, emptyHint) : null,
                ),
            notice.length > 0 ? h('div', { className: 'dshb-notice' }, notice) : null,
            h(
              'div',
              { className: 'dshb-pop-foot' },
              h('span', { className: 'dshb-updated' }, updatedText),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dshb-refresh',
                  disabled: busy,
                  'aria-busy': busy ? 'true' : 'false',
                  onClick: () => void request(true),
                },
                h(
                  'span',
                  { className: `dshb-refresh-icon${busy ? ' dshb-spin' : ''}`, 'aria-hidden': 'true' },
                  refreshIconNode,
                ),
                h('span', null, busy ? t('refreshing') : t('refresh')),
              ),
            ),
          )
        : null

    const popoverLayer =
      popover !== null && portal !== undefined && typeof document !== 'undefined'
        ? portal(popover, document.body)
        : popover

    return h('div', { className: `dshb-root ${wide ? 'dshb-wide' : 'dshb-rail'}` }, trigger, popoverLayer)
  }
}
