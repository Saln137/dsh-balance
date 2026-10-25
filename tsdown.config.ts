import { defineConfig } from 'tsdown'

/**
 * 两个产物、两种运行环境：
 *
 * - `lib/index.js`：宿主半侧（Node ESM）。DSH 的 Loader 以 ESM 导入它，
 *   `apply(ctx, config)` 里的路由、定时器、会话监听都在这里注册。
 * - `lib/client.js`：浏览器半侧。必须是**普通副作用脚本**：加载时调用
 *   `window.__ModuleLoader__.load({ id, factory })`，不能有顶层 import/export，
 *   react 由 factory 的 `require` 在运行时取（见 src/client/index.ts）。
 *
 * 两侧都不引入 `@deepseek-ai/*` 运行时代码：宿主只用 `ctx.get()` 软取服务，
 * 浏览器只用平台种子模块，因此产物自包含、可跨 DSH 版本安装。
 */
export default defineConfig([
  {
    name: 'host',
    entry: { index: 'src/host/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'node22',
    dts: false,
    sourcemap: false,
    clean: false,
    // 固定产物名：package.json 的 main / exports 指向 lib/index.js。
    outputOptions: { entryFileNames: 'index.js' },
  },
  {
    name: 'client',
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: ['iife'],
    platform: 'browser',
    target: 'chrome120',
    dts: false,
    sourcemap: false,
    clean: false,
    // 客户端模块系统按 exports["./client"] 取文件，名字固定为 lib/client.js。
    outputOptions: { entryFileNames: 'client.js' },
  },
])
