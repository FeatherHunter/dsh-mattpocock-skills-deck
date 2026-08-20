#!/bin/bash
# scripts/build.sh — T0 阶段 0 构建入口（DSH 插件生产线惯例）
# 构建（esbuild 双 entry）→ 门禁（vm 编译 loud fail）→ 同步 DSH profile 安装目录。
# 用法: bash scripts/build.sh [--no-sync]
# 依赖: node + npm（esbuild 已装于根 devDependencies）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> [1/3] 构建（esbuild 双 entry：_pkg → package/lib/*，_dev → 根 client.js/host.js）"
node scripts/build.mjs

echo "==> [2/3] 产物 vm 编译 loud fail（门禁在 build.mjs 内：precheckCode / 语法 / __ModuleLoader__ / 单组件单声明）"
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

if [[ "${1:-}" == "--no-sync" ]]; then
  echo "==> [3/3] 跳过同步（--no-sync）"
  exit 0
fi

echo "==> [3/3] 同步 DSH profile 安装目录"
PROFILE_NM="$HOME/.dsh/profiles/web/node_modules/dsh-mattpocock-skills-deck"
if [ ! -d "$PROFILE_NM" ]; then
  echo "  ! profile 目录不存在：$PROFILE_NM（跳过同步）" >&2
  exit 0
fi
cp -f "$ROOT/package/lib/client.js" "$PROFILE_NM/lib/client.js"
cp -f "$ROOT/package/lib/index.js"  "$PROFILE_NM/lib/index.js"
node -e "
const fs = require('fs')
const a = fs.readFileSync('package/lib/client.js', 'utf8')
const b = fs.readFileSync(process.env.HOME + '/.dsh/profiles/web/node_modules/dsh-mattpocock-skills-deck/lib/client.js', 'utf8')
if (a !== b) { console.error('  ! client.js 同步 hash 校验失败'); process.exit(1) }
console.log('  client.js 同步 OK（hash 校验通过）')
"
echo "==> 完成。刷新 DSH 浏览器（Ctrl+F5）即可看到新 client；host 半需重启 DSH 应用。"
