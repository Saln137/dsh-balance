#!/usr/bin/env node
/**
 * 把本包安装进某个 DSH profile（默认 `desktop`）。
 *
 * 为什么不用 `dsh plugin add`：那会驱动 pnpm 重新解析整个 profile 的依赖
 * （可能顺带升级用户已装的其它插件）。这里做**最小改动**：
 *   1. 备份 profile/package.json；
 *   2. 在 dependencies 里加一条 `link:<本仓库绝对值>`；
 *   3. 在 dsh.profile.bundles 里追加本包名；
 *   4. 在 profile/node_modules 下建一个 junction 指向本仓库（Node 直接可用）。
 * 声明进 dependencies 后，用户以后无论自己跑 pnpm install，还是用插件管理器
 * 操作，这条依赖都会作为 `link:` 被重新装好，不会丢。
 *
 * 卸载：`node scripts/install.mjs --uninstall`（或手动删 junction + 两处清单项）。
 */
import { existsSync, lstatSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))

/**
 * 解析命令行参数。
 * @param {string[]} argv - 进程参数。
 * @returns {{profile: string, home: string, uninstall: boolean, dryRun: boolean}}
 */
function parseArgs(argv) {
  const options = {
    profile: 'desktop',
    home: process.env.DSH_HOME ?? join(homedir(), '.dsh'),
    uninstall: false,
    dryRun: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--profile') options.profile = argv[++index]
    else if (arg === '--home') options.home = argv[++index]
    else if (arg === '--uninstall') options.uninstall = true
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--help' || arg === '-h') {
      console.log('用法: node scripts/install.mjs [--profile desktop] [--home ~/.dsh] [--uninstall] [--dry-run]')
      process.exit(0)
    } else {
      console.error(`未知参数: ${arg}`)
      process.exit(2)
    }
  }
  return options
}

const options = parseArgs(process.argv.slice(2))
const profileDir = join(resolve(options.home), 'profiles', options.profile)
const manifestPath = join(profileDir, 'package.json')
const linkPath = join(profileDir, 'node_modules', pkg.name)
const backupPath = join(profileDir, 'package.json.bak-dsh-balance')

if (!existsSync(manifestPath)) {
  console.error(`找不到 profile 清单：${manifestPath}`)
  console.error('请先用 DSH 启动过一次该 profile（或用 dsh plugin --profile <name> add ...）初始化。')
  process.exit(1)
}

if (!options.uninstall && !existsSync(join(projectRoot, 'lib', 'index.js'))) {
  console.error('缺少构建产物 lib/index.js：请先运行 pnpm install && pnpm build')
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.dependencies ??= {}
manifest.dsh ??= {}
manifest.dsh.profile ??= {}
manifest.dsh.profile.bundles ??= []

const specifier = `link:${projectRoot.replaceAll('\\', '/')}`
const alreadyLinked = manifest.dependencies[pkg.name] !== undefined
const alreadyListed = manifest.dsh.profile.bundles.includes(pkg.name)

if (options.uninstall) {
  delete manifest.dependencies[pkg.name]
  manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter((bundle) => bundle !== pkg.name)
} else {
  manifest.dependencies[pkg.name] = specifier
  if (!alreadyListed) manifest.dsh.profile.bundles.push(pkg.name)
}

if (options.dryRun) {
  console.log(`[dry-run] 将写入 ${manifestPath}:`)
  console.log(JSON.stringify(manifest, undefined, 2))
  process.exit(0)
}

// 备份只在第一次安装时留一份「原始」清单，避免反复运行把备份覆盖成已改过的版本。
if (!options.uninstall && !existsSync(backupPath)) {
  writeFileSync(backupPath, readFileSync(manifestPath))
  console.log(`已备份 profile 清单 → ${backupPath}`)
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)

if (options.uninstall && existsSync(linkPath)) {
  // 只删「链接」；如果 pnpm 装成了实体目录，交给插件管理器移除依赖。
  if (lstatSync(linkPath).isSymbolicLink()) {
    unlinkSync(linkPath)
  } else {
    console.log(`提示：${linkPath} 不是链接（可能是 pnpm 安装的实体目录），请用 dsh plugin 移除依赖。`)
  }
} else if (!options.uninstall && !existsSync(linkPath)) {
  symlinkSync(projectRoot, linkPath, 'junction')
}

console.log(options.uninstall ? '已从 profile 移除：' : '已安装到 profile：')
console.log(`  profile : ${profileDir}`)
console.log(`  包      : ${pkg.name}@${pkg.version} (${options.uninstall ? '已删除' : specifier})`)
console.log(`  链接    : ${linkPath}`)
if (!options.uninstall) {
  console.log('\n重启 DeepSeek Harness 后生效（侧边栏底部会出现「余额」）。')
}
