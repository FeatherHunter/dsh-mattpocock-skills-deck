#!/usr/bin/env bash
#
# 向导：把一个 npm 包发到官方源，并验证官方源真的能取到。
# 这是 /npm-publish 能力的「按包传参」版本：#586 迁移要发两个包
# （dsh-plugin-update 与 dsh-mattpocock-skills-deck），旧脚本 scripts/wizard-npm-publish.sh
# 把包名和版本号写死在 1.7.3，发第二个包时用不上。
#
# 执行主体：AI 触发与步进；人只做一件事——在浏览器里完成 npm 的二次验证。
# 依据：docs/releases/RELEASE-RUNBOOK.md 第 5、7、8 节（交互终端真相、只扫码、发布顺序）。
#
# 用法：
#   bash scripts/wizard-npm-publish-package.sh --pkg-dir packages/dsh-plugin-update
#   bash scripts/wizard-npm-publish-package.sh --pkg-dir package --version 1.8.0
#   bash scripts/wizard-npm-publish-package.sh --pkg-dir packages/dsh-plugin-update --otp-file .tmp-otp
#   ENV_FILE=.wizard-publish-update.env bash scripts/wizard-npm-publish-package.sh --pkg-dir packages/dsh-plugin-update
#   --dry-run 只跑到打包预览，不执行发布
#
# 两种二次验证路线（按环境选）：
#   A. 不带 --otp-file：npm 打印浏览器授权链接，等你在浏览器里放行。
#      要求 stdout 是终端；bash 由 PowerShell 调起时 stdout 不是终端，会报 EOTP（2026-09-10 实测）。
#   B. 带 --otp-file <文件>：验证码从文件读入并用 --otp= 传给 npm，不进交互提示，
#      因此不受「stdout 必须是终端」限制，适合终端由工具驱动、看不到提示行的场景。

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 本向导的落盘文件：必须在加载向导库之前设好。
# 向导库里有自己的默认值 .env；先 source 再赋值的话，库里的默认值会先占位（2026-09-08 实测踩到）。
ENV_FILE="${ENV_FILE:-.wizard-publish.env}"
export ENV_FILE

# ── 参数 ─────────────────────────────────────────────────────────────────────
PKG_DIR=""
VERSION_RAW=""
DRY_RUN=0
OTP_FROM_FILE=""
# --yes：不再逐段等回车，一路走到「发布」，把交互次数压到最少。
# 用在「人只需要在浏览器里扫码」的场景：确认由调用方（AI）先行完成，人只剩扫码一件事。
# 选它即跳过打包预览的人工确认，所以只在该包已经预览过、清单没变时用。
ASSUME_YES="${ASSUME_YES:-0}"
if [[ "${YES:-}" == "1" ]]; then ASSUME_YES=1; fi
# --no-open：不替用户弹浏览器（只把链接打印出来）。
# 需要它的原因：WSL 里 open_url 走 explorer.exe 这种跨系统互操作调用，
# 由工具驱动终端时会把这个会话带崩（2026-09-10 实测，脚本到这一步就退出）。
# 人只需要看到链接自己点，所以这条路完全够用。
NO_OPEN="${NO_OPEN:-0}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --pkg-dir)  PKG_DIR="${2:-}"; shift 2 ;;
    --version)  VERSION_RAW="${2:-}"; shift 2 ;;
    --registry) REGISTRY="${2:-}"; shift 2 ;;
    --otp-file) OTP_FROM_FILE="${2:-}"; shift 2 ;;
    --dry-run)  DRY_RUN=1; shift ;;
    --yes)      ASSUME_YES=1; shift ;;
    --no-open)  NO_OPEN=1; shift ;;
    -h|--help)  sed -n '1,30p' "$0"; exit 0 ;;
    *) echo "不认识的参数：$1（可用：--pkg-dir / --version / --registry / --otp-file / --yes / --no-open / --dry-run）" >&2; exit 2 ;;
  esac
done

WIZARD_LIB="$ROOT/wizard/template.sh"
if [[ ! -f "$WIZARD_LIB" ]]; then
  echo "缺少向导库：$WIZARD_LIB（请确认 wizard/template.sh 已存在）" >&2
  exit 1
fi
# shellcheck source=../wizard/template.sh
source "$WIZARD_LIB"

# --yes 的覆盖必须落在库加载之后：pause / confirm 由库在 source 时定义。
# 覆盖的是库的实现，wizard/template.sh 本身一个字节不动。
if [[ "$ASSUME_YES" == "1" ]]; then
  pause() { :; }
  confirm() { return 0; }
fi

# --no-open：只打印链接，不调跨系统的浏览器调起器（原因见上面 NO_OPEN 的注释）。
if [[ "$NO_OPEN" == "1" ]]; then
  open_url() {
    printf '  %s请打开这个链接%s %s\n' "$YELLOW" "$RESET" "$1"
  }
fi

REGISTRY="${REGISTRY:-https://registry.npmjs.org}"

# 一次性验证码可以用 --otp= 直接传进去，这样 npm 不必进入交互提示，
# 也就不依赖「stdout 必须是终端」这一条（2026-09-10 实测：bash 若由 PowerShell 调起，
# stdout 不是 TTY，npm 直接报 EOTP 且不给授权链接）。
# 验证码从文件读，避免写进命令行参数被命令历史与进程列表看到。
OTP_CODE=""
if [[ -n "$OTP_FROM_FILE" ]]; then
  if [[ -f "$OTP_FROM_FILE" ]]; then
    OTP_CODE="$(tr -d ' \t\r\n' < "$OTP_FROM_FILE")"
  else
    warn "给了 --otp-file 但文件不存在：$OTP_FROM_FILE"
    exit 2
  fi
fi

if [[ -z "$PKG_DIR" ]]; then
  PKG_DIR=$(_existing WIZARD_PUBLISH_PKG_DIR || true)
fi
if [[ -z "$PKG_DIR" ]]; then
  warn "必须给包目录：--pkg-dir <相对仓库根的目录>，例如 --pkg-dir packages/dsh-plugin-update"
  exit 2
fi
if [[ ! -f "$PKG_DIR/package.json" ]]; then
  warn "目录下没有 package.json：$PKG_DIR"
  exit 2
fi

write_env WIZARD_PUBLISH_PKG_DIR "$PKG_DIR"

# 读包清单（用 node 而不是 grep，避免把 description 里的花括号当版本号）
PKG_NAME=$(node -e "process.stdout.write(require('./$PKG_DIR/package.json').name)")
PKG_VERSION=$(node -e "process.stdout.write(require('./$PKG_DIR/package.json').version)")
PKG_PRIVATE=$(node -e "process.stdout.write(String(require('./$PKG_DIR/package.json').private === true))")
PKG_DESC=$(node -e "process.stdout.write(String(require('./$PKG_DIR/package.json').description || ''))")
PKG_DEPS=$(node -e "const d=require('./$PKG_DIR/package.json').dependencies; process.stdout.write(d?Object.keys(d).join(','):'（无）')")

if [[ -n "$VERSION_RAW" ]]; then
  TARGET_VERSION="${VERSION_RAW#v}"
elif [[ -n "${PKG_VERSION:-}" ]]; then
  TARGET_VERSION="$PKG_VERSION"
else
  warn "无法确定版本号：包清单里没有 version，也没给 --version"
  exit 2
fi

if [[ "$PKG_PRIVATE" == "true" ]]; then
  warn "$PKG_NAME 的 package.json 里 private 为真，npm 会以 EPRIVATE 拒绝发布（这正是根 package.json 不能发的原因）"
  exit 2
fi

TOTAL_STAGES=6
banner "发布 $PKG_NAME@$TARGET_VERSION 到 npm 官方源"

# ── Stage 1：环境与登录态 ────────────────────────────────────────────────────
stage "环境与登录态（node / npm / 源 / 账号）"
say "本向导发布的是 $PKG_DIR 这个包目录；官方源 $REGISTRY 与镜像不同步时，只有官方源的版本才算数。"
echo ""
step "运行时自检"
printf '    node      %s\n' "$(node -v 2>&1)"
printf '    npm       %s\n' "$(npm -v 2>&1)"
printf '    默认源    %s\n' "$(npm config get registry 2>&1)"
printf '    发布源    %s\n' "$REGISTRY"
echo ""
step "登录态（必须查官方源，镜像上的登录不算数）"
if WHO=$(npm whoami --registry="$REGISTRY" 2>/dev/null); then
  printf '    已登录：%s\n' "$WHO"
  if [[ "$WHO" != "feather_wch" ]]; then
    warn "登录账号是 $WHO，不是预期的发布账号 feather_wch —— 确认后再继续"
  fi
else
  printf '    未登录（下一阶段会引导登录）\n'
fi
echo ""
say "包标识"
printf '    包名      %s\n' "$PKG_NAME"
printf '    本地版本  %s\n' "$PKG_VERSION"
printf '    本次目标  %s\n' "$TARGET_VERSION"
printf '    运行依赖  %s\n' "$PKG_DEPS"
pause "看完回车进入就绪检查"

# ── Stage 2：包就绪（重名 / 版本 / 描述） ────────────────────────────────────
stage "包就绪（重名检查 / 版本一致性 / 包说明）"
say "先查这个包名与版本在官方源上是什么状态，再决定怎么发。"
echo ""
step "官方源上的现状（--prefer-online 跳过本地缓存）"
if REMOTE=$(npm view "$PKG_NAME" version --registry="$REGISTRY" --prefer-online 2>&1); then
  printf '    官方源 latest：%s\n' "$(printf '%s' "$REMOTE" | tail -n1)"
  EXISTS=1
else
  printf '    官方源查不到（404）：包名未被占用，首版可直接发\n'
  EXISTS=0
fi
echo ""
case "$EXISTS" in
  0)
    note "首次发布：$PKG_NAME@$TARGET_VERSION 将占住这个包名。"
    ;;
  1)
    if npm view "$PKG_NAME@$TARGET_VERSION" version --registry="$REGISTRY" --prefer-online >/dev/null 2>&1; then
      warn "$PKG_NAME@$TARGET_VERSION 已经在官方源上了，再发会报 E409"
      if [[ "$DRY_RUN" == "0" ]]; then
        if ! confirm "仍要继续吗？（选 n 退出，改 version 后再跑）"; then
          note "已退出。请在 $PKG_DIR/package.json 里升版本号后重跑本向导。"
          exit 0
        fi
      fi
    else
      note "$PKG_NAME 已存在，但 $TARGET_VERSION 这个版本号还没被占用，可以直接发。"
    fi
    ;;
esac
echo ""
step "包说明（会显示在 npm 网页与搜索结果里，human-first 要求：人第一次读就能懂）"
printf '    %s\n' "$PKG_DESC"
pause "回车进入打包预览"

# ── Stage 3：打包预览 ────────────────────────────────────────────────────────
stage "打包预览（只发白名单里的文件）"
say "包清单里的 files 字段是发布白名单；测试、密钥、多余文档都不该进包。"
step "在 $PKG_DIR 下执行 npm pack --dry-run"
echo ""
(cd "$PKG_DIR" && npm pack --dry-run --registry="$REGISTRY" 2>&1 | sed 's/^/    /')
echo ""
note "上面 Tarball Contents 就是将要发出去的全部文件；total files 是文件数。"
if [[ "$DRY_RUN" == "1" ]]; then
  note "--dry-run：到此为止，不执行登录与发布。"
  finish
  exit 0
fi
if confirm "文件清单与预期一致，继续发布？"; then
  note "预览通过。"
else
  warn "已停下。请修正 $PKG_DIR 的 files 白名单或清理多余文件后重跑。"
  exit 1
fi

# ── Stage 4：发布 ────────────────────────────────────────────────────────────
stage "发布 —— 在交互终端完成二次验证"
echo ""
if [[ -n "$OTP_CODE" ]]; then
  # 带验证码的路线：npm 不进交互提示，因此不依赖 stdout 是不是终端。
  say "本次用一次性验证码（--otp-file 读入）发布：npm 不会进入交互提示，也就不受「stdout 必须是终端」限制。"
  step "将要执行：cd $PKG_DIR && npm publish --registry=$REGISTRY --otp=******"
  note "验证码只从文件读、只在内存里传递，不打印、不写日志。"
else
  warn "关键约束：不带验证码时，发布命令不能接管道、不能重定向输出"
  note "npm 只有在输出直连终端（TTY）时才会打印授权链接并等你完成二次验证；一旦接管道就退化成 EOTP 不给链接（2026-09-08 实测）。"
  note "bash 若由 PowerShell 调起，stdout 不是 TTY，会踩到这个坑（2026-09-10 实测）；此时改用 --otp-file 传验证码。"
  step "将要执行：cd $PKG_DIR && npm publish --registry=$REGISTRY --auth-type=web"
  note "账号开了二次验证时，终端会打印一行 Authenticate your account at: https://www.npmjs.com/auth/cli/<uuid>"
  step "按回车 → 浏览器完成二次验证 → 回终端再按回车 → 看到 + $PKG_NAME@$TARGET_VERSION 即发布成功"
fi
echo ""
open_url "https://www.npmjs.com/package/$PKG_NAME"
echo ""
if confirm "现在执行发布？"; then
  set +e
  if [[ -n "$OTP_CODE" ]]; then
    (cd "$PKG_DIR" && npm publish --registry="$REGISTRY" --otp="$OTP_CODE")
  else
    # 输出直连终端、不接管道：见上面的关键约束。
    (cd "$PKG_DIR" && npm publish --registry="$REGISTRY" --auth-type=web)
  fi
  PUB_EXIT=$?
  set -e
  if [[ "$PUB_EXIT" == "0" ]]; then
    note "发布命令退出 0；成功时上方会出现 + $PKG_NAME@$TARGET_VERSION"
  else
    warn "发布未成功（exit $PUB_EXIT）。按错误码查原因："
    note "  EOTP    终端不是交互终端，或输出被接了管道/重定向 —— 改用 --otp-file 传验证码，或在可见窗口直接跑"
    note "  ENEEDAUTH / E401  未登录 —— 回上一阶段重新登录"
    note "  E403 / E409       该版本已在官方源存在 —— 升 version 后再发"
    note "  EPRIVATE          package.json 里 private 为真 —— 去掉后再发"
  fi
else
  warn "已跳过发布。可稍后在交互终端手跑：cd $PKG_DIR && npm publish --registry=$REGISTRY --auth-type=web"
fi
pause "回车进入官方源验证"

# ── Stage 5：官方源验证 ──────────────────────────────────────────────────────
stage "验证（官方源是否真的能取到）"
say "验证显式指向官方源并跳过缓存，避免被镜像的延迟骗过去。"
echo ""
if poll_npm_version "$PKG_NAME" "$TARGET_VERSION" "$REGISTRY"; then
  note "官方源可见 $PKG_NAME@$TARGET_VERSION"
else
  warn "官方源还没看到目标版本，可能仍在同步；稍后可重跑本阶段"
fi
echo ""
step "dist-tags（latest 应指向刚发的版本）"
npm view "$PKG_NAME" dist-tags --registry="$REGISTRY" --prefer-online --json 2>&1 | sed 's/^/    /'
echo ""
if confirm "现在做一次临时目录试装，证明别人能装到？"; then
  TMPDIR=$(mktemp -d 2>/dev/null || mktemp -d -t npm-verify)
  (cd "$TMPDIR" && npm init -y >/dev/null 2>&1; npm install "$PKG_NAME@$TARGET_VERSION" --registry="$REGISTRY" 2>&1 | sed 's/^/    /')
  echo "    试装目录：$TMPDIR"
  step "试装结果自检（包根可解析、导出的工厂函数在）"
  (cd "$TMPDIR" && node -e "
    const m = require('module').createRequire(process.cwd() + '/index.js');
    const p = m('$PKG_NAME');
    const names = Object.keys(p).filter(k => typeof p[k] === 'function');
    console.log('    导出函数：' + (names.join(', ') || '（无）'));
    console.log('    包版本：' + require('$PKG_NAME/package.json').version);
  " 2>&1 | sed 's/^/  /')
else
  note "已跳过试装 —— 可稍后手动：npm install $PKG_NAME@$TARGET_VERSION --registry=$REGISTRY"
fi
pause "回车查看收尾说明"

# ── Stage 6：收尾 ────────────────────────────────────────────────────────────
stage "收尾（已装形态生效 / 撤回预案 / 令牌安全）"
say "发布之后，让装了旧版的宿主拿到新版还要多一步。"
echo ""
if [[ "$PKG_NAME" == dsh-mattpocock-skills-deck ]]; then
  step "让宿主装上指定版本：dsh plugin --profile web add $PKG_NAME@$TARGET_VERSION --registry $REGISTRY"
  step "完全退出宿主再重开、刷新页面，才能看到新版本号"
else
  step "这是个库包：由依赖它的插件一起装；升级时改插件的依赖版本号后重新发布插件"
  note "宿主侧生效看插件版本，不看本包版本。"
fi
echo ""
say "撤回预案（发布时间即公开，慎用）"
note "72 小时内可 npm unpublish $PKG_NAME@$TARGET_VERSION --registry=$REGISTRY（历史记录仍保留，重发同版本可能 E409，需升版）"
note "超过 72 小时只能 npm deprecate $PKG_NAME@$TARGET_VERSION \"原因\" --registry=$REGISTRY 标记废弃"
echo ""
say "令牌安全"
note "本次登录令牌写在 npm 本地配置里；若怀疑泄露，立即到 https://www.npmjs.com/settings/feather_wch/tokens 吊销"
echo ""
write_env WIZARD_PUBLISH_LAST_PKG "$PKG_NAME"
write_env WIZARD_PUBLISH_LAST_VERSION "$TARGET_VERSION"
finish
