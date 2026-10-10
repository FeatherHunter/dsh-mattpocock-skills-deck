#!/bin/bash
# scripts/build.sh — T0 阶段 0 构建入口（DSH 插件生产线惯例）
# 构建（esbuild 双 entry）→ 门禁（vm 编译 loud fail）。永不同步本机已装配置。
# 用法: bash scripts/build.sh
#   本地同步已于 1.8.0-rc.1 彻底移除：构建只写仓库内产物，不碰本机 DSH 环境；
#   新版本一律由人自己升级（市场升级、软件内升级、自己敲安装命令）。
# 依赖: node + npm（esbuild 已装于根 devDependencies）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

for a in "$@"; do
  if [[ "$a" == "--sync" || "$a" == "--no-sync" ]]; then
    echo "本地同步已取消：构建不再支持 --sync（新版本请走市场升级、软件内升级或自己敲安装命令）" >&2
    exit 1
  fi
done

echo "==> [1/2] 构建（esbuild 双 entry：_pkg → package/lib/*，_dev → 根 client.js/host.js）"
node scripts/build.mjs

echo "==> [2/2] 产物 vm 编译 loud fail（门禁在 build.mjs 内：precheckCode / 语法 / __ModuleLoader__ / 单组件单声明）"
node -e "
const fs = require('fs')
const vm = require('vm')
for (const f of ['client.js', 'host.js']) {
  new vm.Script('(async () => {\n' + fs.readFileSync(f, 'utf8') + '\n})()', { filename: f })
  console.log('  precheckCode OK:', f)
}
for (const f of ['package/lib/client.js']) {
  new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f })
  console.log('  vm 编译 OK:', f)
}
"

echo "==> 完成。构建只写仓库内产物，不碰本机已装配置；刷新 DSH 浏览器（Ctrl+F5）即可看到新 client；host 半需重启 DSH 应用。"
