/**
 * scripts/build.ts —— 把原型源码打成一个可直接用浏览器打开的文件。
 *
 * 只用 esbuild 做打包，不做压缩：原型需要能被人直接读构建产物排查问题，
 * 压缩后的行号对不上源码。产物 app.js 与 index.html 同级。
 *
 * 迁移期的说明符问题：真实源码里大量相对导入写的是 `.js`，而工作树里已经是 `.ts`。
 * 仓里 scripts/ts-hook.mts 在 Node 侧用同名 .ts 优先把这件事兜住；
 * 浏览器侧没有这个钩子，所以这里的 esbuild 插件做同一件事：
 * 先找同名 `.ts`，找不到才把原来的 `.js` 交给 Node 解析。
 *
 * 运行方式（Node 24 起原生剥离类型，不需要先编译这个脚本）：
 *   node docs/prototype/vc-redesign/scripts/build.ts
 */
import { build } from 'esbuild'
import type { PluginBuild } from 'esbuild'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

/** 同名 .ts 优先；只改写相对路径，裸模块名交给 esbuild 正常解析。 */
const remapJsToTs = {
  name: 'remap-js-to-ts',
  setup(bundle: PluginBuild): void {
    bundle.onResolve({ filter: /\.js$/ }, (args) => {
      if (!args.path.startsWith('.')) return null
      const candidate = resolve(args.resolveDir, `${args.path.slice(0, -3)}.ts`)
      return existsSync(candidate) ? { path: candidate } : null
    })
  },
}

async function main(): Promise<void> {
  await build({
    entryPoints: [resolve(ROOT, 'src/main.ts')],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    outfile: resolve(ROOT, 'app.js'),
    logLevel: 'warning',
    plugins: [remapJsToTs],
    banner: {
      js: '/* 构建产物：由 scripts/build.ts 从 src/main.ts 打包，不要手改。 */',
    },
  })
  console.log('已生成 docs/prototype/vc-redesign/app.js')
}

void main()
