/**
 * 浏览器半侧的装配层：取平台种子模块 → 建组件 → 注册进侧边栏底部插槽。
 *
 * 这一层不写界面（界面在 widget.ts），只负责「插件三件套」（name/inject/apply）
 * 与生命周期登记，和 DSH 内置客户端插件的写法一致。
 */
import type * as ReactNS from 'react'
import { PLUGIN_ID } from '../shared/types.ts'
import type { ClientContext } from './context.ts'
import { en, NS, zh } from './locales.ts'
import { createBalanceWidget, type IconsModule, type PortalLike } from './widget.ts'

/** `__ModuleLoader__` 交给 factory 的 require。 */
export type RequireFn = (id: string) => unknown

/**
 * 取一个可选平台模块。
 * @param require - 模块表的 require。
 * @param id - 模块名。
 * @returns 模块；缺失或加载抛错时 undefined。
 */
function optionalModule<T>(require: RequireFn, id: string): T | undefined {
  try {
    const loaded = require(id)
    return loaded === undefined || loaded === null ? undefined : (loaded as T)
  } catch {
    // 平台种子模块随版本变化：取不到只降级（用内置 SVG 图标），不能让插件加载失败。
    return undefined
  }
}

/**
 * 创建插件 factory（`(require) => module`）。
 * @returns `__ModuleLoader__.load` 需要的 factory。
 */
export function makeFactory(): (require: RequireFn) => unknown {
  return (require) => {
    const React = require('react') as typeof ReactNS

    // 官方图标集与 react-dom 都是**可选**的：
    // - 图标缺失 → 内置 SVG；
    // - createPortal 缺失 → 浮层就地渲染（仍在 .dshb-root 内，position: fixed）。
    const icons = optionalModule<IconsModule>(require, '@deepseek-ai/dsh-client-ui-primitives')
    const reactDom = optionalModule<{ createPortal?: PortalLike }>(require, 'react-dom')
    const portal = typeof reactDom?.createPortal === 'function' ? reactDom.createPortal : undefined

    const Widget = createBalanceWidget({ React, icons, portal })

    /** 装配前提：插槽服务 + 本地化服务（都属于 Web 客户端内核）。 */
    const inject = ['slots', 'locale']

    /**
     * 注册「余额」到侧边栏底部动作区。
     *
     * 为什么选 `sidebar.footer.action` 而不是会话头/输入框：
     * - `kind: 'list'`（可叠加）且无人占用，属于**追加**而不是替换别人；
     * - `scope: 'root'`，在任何会话、任何页面状态下都常驻，符合「随时可见的余额」；
     * - owner 直接给出 `wide`（侧边栏是否展开），折叠成图标栏时自动切成 36×36 图标。
     * @param ctx - 浏览器侧上下文。
     */
    function apply(ctx: ClientContext): void {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), `${PLUGIN_ID}: dictionaries`)

      // 用 inject 而不是直接 register：贡献的生命周期跟随插槽声明的存活期，
      // 侧边栏卸载/重建时我们的注册会一起收起、再一起回来。
      ctx.slots.inject('sidebar.footer.action', () =>
        ctx.slots.register(
          {
            name: 'sidebar.footer.action',
            id: 'balance',
            // 排在其它页脚动作之前：余额是只读信息，靠上更符合阅读顺序。
            order: 40,
            locale: NS,
            label: () => 'Balance',
          },
          Widget,
        ),
      )
    }

    return { name: PLUGIN_ID, inject, apply }
  }
}
