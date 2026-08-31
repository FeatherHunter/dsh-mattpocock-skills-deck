#!/usr/bin/env bash
# scripts/wizard-release.sh — 只扫码的发布向导（基于 wizard/template.sh，AI 全驱动零手动命令）
#
# 旅程：确认提交已推送与工作区干净 → 发布并弹浏览器完成 2FA → 官方源验证 → 已装形态验证
# 体验：需要浏览器授权时在用户桌面弹出可见窗口并打开授权链接，用户仅需扫码一次，
#       其余轮询与验证由工具在后台完成；可中断重跑，已落盘值被记住。
# 原则：零手动命令 — 本向导由 AI 触发与步进（AI 执行 bash/scripts 与 git/npm/gh），人仅扫码；禁止要求人手动敲命令。
# 发布契约：以单一高层 gate（tests/verify-release-contract.js）覆盖 8 项清单同源性与双入口一致性，
#           任一失败即阻断，不为每项各起低层测试。
# 用法：
#   bash scripts/wizard-release.sh [vX.Y.Z]          # 交互式向导
#   bash scripts/wizard-release.sh --version v1.7.9  # 显式版本
#   bash scripts/wizard-release.sh --dry-run v1.7.9  # 仅校验不发布
#   ENV_FILE=.wizard-release.env bash scripts/wizard-release.sh  # 自定义落盘文件

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 加载统一向导库（分段清屏、进度、显式打开链接、确认、落盘与收尾）
WIZARD_LIB="$ROOT/wizard/template.sh"
if [[ ! -f "$WIZARD_LIB" ]]; then
  echo "缺失向导库：$WIZARD_LIB（请确认 wizard/template.sh 已存在）" >&2
  exit 1
fi
# shellcheck source=../wizard/template.sh
source "$WIZARD_LIB"

# 本向导的落盘文件（覆盖模板默认的 .env，避免污染）
ENV_FILE="${ENV_FILE:-.wizard-release.env}"
export ENV_FILE

TOTAL_STAGES=6
PKG="dsh-mattpocock-skills-deck"
REGISTRY="https://registry.npmjs.org"

# 解析参数
VERSION_RAW=""
DRY_RUN=0
SKIP_CONTRACT=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --skip-contract) SKIP_CONTRACT=1 ;;
    --version) shift || true ;; # handled via next arg iteration
    -h|--help)
      sed -n '1,30p' "$0" | head -n 30
      exit 0
      ;;
    v*.*.*) VERSION_RAW="$arg" ;;
    *.*.*) VERSION_RAW="$arg" ;;
  esac
done
# 兼容 --version vX.Y.Z 形式
for i in $(seq 1 $#); do
  eval "arg=\${$i}"
  if [[ "$arg" == "--version" ]]; then
    eval "next=\${$((i+1)):-}"
    [[ -n "${next:-}" ]] && VERSION_RAW="$next"
  fi
done

normalize_version() {
  local v="$1"
  v="$(echo "$v" | tr -d ' \t\r\n')"
  [[ -z "$v" ]] && return 1
  [[ "$v" != v* ]] && v="v$v"
  if [[ ! "$v" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    return 1
  fi
  printf '%s' "$v"
}

banner "发布 $PKG — 只扫码向导（基于 wizard/template.sh）"

# ── Stage 1：版本与契约前检（单一高层 gate） ───────────────────────
stage "1/6 版本与契约前检（单一高层 gate）"
say "本向导将按发布 Runbook（docs/releases/RELEASE-RUNBOOK.md，生效日期 2026-08-31）执行发布。"
say "单一高层校验覆盖：版本同源、说明锁定、变更历史与 Release 同文、包白名单、模板与网页卡同源。"
echo ""

# 版本：优先参数，其次 ENV_FILE 记录，其次 package.json 当前版本提示
PREV_VER=$(_existing WIZARD_RELEASE_VERSION || true)
if [[ -n "$VERSION_RAW" ]]; then
  VERSION_NORM=$(normalize_version "$VERSION_RAW" || true)
  if [[ -z "${VERSION_NORM:-}" ]]; then
    warn "版本号形态错误：$VERSION_RAW，期望 vX.Y.Z，例如 v1.7.9"
    exit 2
  fi
  VERSION="$VERSION_NORM"
elif [[ -n "$PREV_VER" ]]; then
  note "检测到上次落盘版本：$PREV_VER（回车保留，或输入新版本）"
  ask WIZARD_RELEASE_VERSION "本次发布版本号（vX.Y.Z）："
  VERSION_NORM=$(normalize_version "${WIZARD_RELEASE_VERSION:-$PREV_VER}" || true)
  if [[ -z "${VERSION_NORM:-}" ]]; then
    warn "版本号形态错误：${WIZARD_RELEASE_VERSION:-空}，期望 vX.Y.Z"
    exit 2
  fi
  VERSION="$VERSION_NORM"
else
  PKG_VER=$(node -p "require('./package.json').version" 2>/dev/null || echo "")
  [[ -n "$PKG_VER" ]] && note "当前 package.json 版本：v$PKG_VER（仅提示，发布需显式确认新版本）"
  ask WIZARD_RELEASE_VERSION "本次发布版本号（vX.Y.Z，例如 v1.7.9）："
  VERSION_NORM=$(normalize_version "${WIZARD_RELEASE_VERSION:-}" || true)
  if [[ -z "${VERSION_NORM:-}" ]]; then
    warn "未提供有效版本号。已追问而非猜测，请输入 vX.Y.Z 后重跑。"
    exit 2
  fi
  VERSION="$VERSION_NORM"
fi

# 规范化后再次落盘（确保带 v 前缀）
write_env WIZARD_RELEASE_VERSION "$VERSION"
VER_NUM="${VERSION#v}"
say "本次发布：$VERSION（数字：$VER_NUM）"
write_env WIZARD_RELEASE_VERSION_NUM "$VER_NUM"

# 本地版本提示
PKG_VER=$(node -p "require('./package/package.json').version" 2>/dev/null || echo "?")
ROOT_VER=$(node -p "require('./package.json').version" 2>/dev/null || echo "?")
say "根 package.json：v$ROOT_VER，package/package.json：v$PKG_VER"
if [[ "$PKG_VER" != "$VER_NUM" || "$ROOT_VER" != "$VER_NUM" ]]; then
  warn "本地版本号与目标 $VERSION 不一致——后续契约校验将失败，请先按 Runbook 第 1 节同步 8 项清单。"
fi

# 单一高层契约校验（任一失败即阻断）
if [[ "$SKIP_CONTRACT" -eq 1 ]]; then
  warn "已跳过契约校验（--skip-contract），仅用于排障。"
else
  say "执行单一高层发布契约校验：node tests/verify-release-contract.js --version $VERSION"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    note "dry-run 模式：仍执行校验，但不阻断发布（仅演示）"
  fi
  echo ""
  if node tests/verify-release-contract.js --version "$VERSION" 2>&1 | sed 's/^/  /' ; then
    say "✓ 契约校验通过"
    write_env WIZARD_RELEASE_CONTRACT_OK "1"
  else
    echo ""
    warn "契约校验失败——已给出待改清单（见上），已阻断后续发布步骤。"
    warn "请按清单逐项修复后重跑本向导（已落盘的 $VERSION 将被记住）。"
    if [[ "$DRY_RUN" -eq 1 ]]; then
      warn "dry-run：虽失败但继续演示后续旅程（正式发布请勿加 --dry-run）"
    else
      exit 1
    fi
  fi
fi

pause "契约段确认后按回车进入提交与工作区检查"

# ── Stage 2：确认提交已推送与工作区干净 ───────────────────────
stage "2/6 确认提交已推送与工作区干净"
say "发布顺序（无回滚）要求：门禁全绿后先在本地提交并推送到 main，再发布到官方源。"
echo ""
say "工作区状态："
if [[ -n "$(git status --porcelain 2>&1)" ]]; then
  warn "工作区不干净（存在未提交改动）："
  git status --porcelain 2>&1 | sed 's/^/    /'
  warn "请先提交或暂存，再重跑本向导（已落盘版本 $VERSION 仍被记住）。"
  if ! confirm "是否忽略不干净状态继续（不推荐）"; then
    exit 1
  fi
else
  say "✓ 工作区干净"
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>&1 || echo "?")
say "当前分支：$BRANCH"
if [[ "$BRANCH" != "main" && "$BRANCH" != "master" ]]; then
  warn "当前不在 main 分支（在 $BRANCH），发布通常在 main 上进行。"
  if ! confirm "是否在 $BRANCH 上继续"; then
    exit 1
  fi
fi

HEAD_MSG=$(git log --oneline -1 2>&1 || echo "")
say "最近提交：$HEAD_MSG"

# 检查是否已推送（对比 origin/main）
say "检查提交是否已推送到 origin/$BRANCH …"
if git rev-parse --verify "origin/$BRANCH" >/dev/null 2>&1; then
  AHEAD=$(git rev-list "origin/$BRANCH..HEAD" --count 2>&1 || echo "?")
  BEHIND=$(git rev-list "HEAD..origin/$BRANCH" --count 2>&1 || echo "?")
  say "与 origin/$BRANCH 对比：ahead=$AHEAD behind=$BEHIND"
  if [[ "$AHEAD" != "0" ]]; then
    warn "本地有 $AHEAD 个提交尚未推送到 origin/$BRANCH"
    if confirm "是否现在执行 git push origin $BRANCH"; then
      git push origin "$BRANCH"
      say "✓ 已推送"
    else
      warn "请手动执行：git push origin $BRANCH，然后重跑向导。"
      exit 1
    fi
  else
    say "✓ 已与 origin/$BRANCH 同步"
  fi
else
  warn "未找到 origin/$BRANCH，跳过推送检查（可能是新分支）。"
fi

write_env WIZARD_RELEASE_STAGE "2"
pause "确认提交已推送且工作区干净后按回车进入隔离门禁"

# ── Stage 3：隔离门禁（任一失败即阻断） ───────────────────────
stage "3/6 隔离门禁（任一失败即阻断）"
say "在隔离环境中执行构建与全部校验，不污染当前工作区与已装形态。"
echo ""

say "① 隔离构建：node scripts/build.mjs --no-sync（仅校验产物，不自动同步 profile）"
if node scripts/build.mjs 2>&1 | sed 's/^/  /' ; then
  say "✓ 构建完成"
else
  warn "构建失败，已阻断后续发布。"
  exit 1
fi

say "② 产物新鲜度与双产物一致性（verify-build-artifacts 覆盖）"
if node tests/verify-build-artifacts.js 2>&1 | sed 's/^/  /' ; then
  say "✓ 产物校验通过"
else
  warn "产物校验失败，请检查 src/ 与 package/lib 的一致性。"
  exit 1
fi

say "③ 冒烟与打包预览（白名单校验）"
note "打包预览：npm pack --dry-run（在 package/ 目录）"
if (cd package && npm pack --dry-run 2>&1 | sed 's/^/  /') ; then
  say "✓ 打包预览通过"
else
  warn "打包预览失败"
  exit 1
fi

say "④ 官方源包名占用预检（显式官方源并跳过缓存）"
LATEST=$(npm view "$PKG" version --registry "$REGISTRY" --prefer-online 2>&1 | tail -n1 | tr -d ' \r\n' || true)
say "官方源 latest：${LATEST:-<查询失败>}"
if [[ "$LATEST" == "$VER_NUM" ]]; then
  warn "官方源已存在 $VERSION（latest=$LATEST），重复发布会 E409，请递增 patch 后重跑。"
  if ! confirm "是否仍继续（将失败）"; then
    exit 1
  fi
else
  say "✓ 版本 $VERSION 尚未占用，可发布"
fi

write_env WIZARD_RELEASE_STAGE "3"
pause "门禁全绿后按回车进入发布（将弹浏览器）"

# 干跑模式：到此结束
if [[ "$DRY_RUN" -eq 1 ]]; then
  note "dry-run 模式：已完成门禁演示，未执行真实发布。"
  finish
  exit 0
fi

# ── Stage 4：发布 — 弹浏览器，一次扫码（网页 2FA） ───────────────────────
stage "4/6 发布 — 弹浏览器，一次扫码（网页 2FA）"
say "将把 package/ 目录的 $VERSION 发布到官方源 $REGISTRY，需浏览器授权一次。"
say "发布命令已显式指向官方源且不重定向输出，2FA 仅在浏览器完成，不隔空传递验证码。"
echo ""

say "检查 npm 登录态（官方源）："
if npm whoami --registry "$REGISTRY" >/dev/null 2>&1; then
  WHO=$(npm whoami --registry "$REGISTRY" 2>&1)
  say "✓ 已登录：$WHO（官方源）"
else
  warn "当前未登录或 token 失效（npm whoami 失败）"
  open_url "https://www.npmjs.com/login"
  step "浏览器已尝试打开 https://www.npmjs.com/login（若未弹出请手动访问）"
  say "请在可见的终端窗口执行登录（浏览器授权）："
  say "  npm login --registry $REGISTRY --auth-type=web"
  note "登录成功后会提示 Logged in as <user> on $REGISTRY"
  pause "完成登录后按回车继续"
  if npm whoami --registry "$REGISTRY" >/dev/null 2>&1; then
    say "✓ 登录已就绪：$(npm whoami --registry "$REGISTRY" 2>&1)"
  else
    warn "仍未登录，无法继续发布。请登录后重跑向导（版本 $VERSION 已记住）。"
    exit 1
  fi
fi

say "准备发布：package/ → $REGISTRY"
note "发布将在用户可见的交互窗口中完成；向导随后在后台轮询验证。"
open_url "https://www.npmjs.com/package/$PKG"
step "浏览器已尝试打开包主页 https://www.npmjs.com/package/$PKG（若未弹出请手动访问）"
echo ""
say "请选择执行方式："
say "  A. 在本终端直接发布（若本终端是可见的交互终端，推荐）"
say "  B. 在另一个可见的终端窗口手动执行（若本终端是 AI 后台/不可见）"
echo ""
say "方式 B 的手动命令（复制到可见的 PowerShell/终端执行）："
say "  cd $ROOT/package"
say "  npm publish --registry $REGISTRY --auth-type=web"
echo ""

if confirm "是否在本终端直接执行发布？选否将等待你在另一窗口手动完成"; then
  say "正在执行：(cd package && npm publish --registry $REGISTRY --auth-type=web)"
  echo ""
  note "若弹出浏览器授权页，请扫码一次完成 2FA；其余由 npm 在后台处理。"
  if (cd package && npm publish --registry "$REGISTRY" --auth-type=web 2>&1 | sed 's/^/  /') ; then
    say "✓ 发布命令已返回成功"
    write_env WIZARD_RELEASE_PUBLISHED "$VERSION"
  else
    echo ""
    warn "发布命令未成功（见上）。可能原因：未登录、2FA 超时、版本已存在、网络。"
    warn "请检查后在可见窗口重跑：cd package && npm publish --registry $REGISTRY --auth-type=web"
    if ! confirm "是否视为已在另一窗口完成发布并继续验证"; then
      exit 1
    fi
    write_env WIZARD_RELEASE_PUBLISHED "$VERSION"
  fi
else
  say "请在可见的终端窗口按上面命令完成发布。"
  say "发布时若弹出浏览器授权页，请扫码一次完成授权。后台无可见授权链接时，不会空等——直接在可见窗口完成发布即可。"
  pause "在另一窗口看到 + $PKG@$VER_NUM 且无报错后，按回车继续（向导将自动轮询验证）"
  write_env WIZARD_RELEASE_PUBLISHED "$VERSION"
fi

pause "发布步骤已完成，按回车进入官方源验证（后台轮询）"

# ── Stage 5：官方源验证（后台轮询） ───────────────────────
stage "5/6 官方源验证（后台轮询）"
say "查询官方源是否已出现 $VERSION，显式跳过本地缓存。"
if poll_npm_version "$PKG" "$VER_NUM" "$REGISTRY"; then
  say "✓ 官方源验证通过"
  write_env WIZARD_RELEASE_VERIFIED "$VERSION"
else
  warn "官方源尚未出现 $VERSION，可能延迟或发布未成功。"
  warn "可稍后手工重查：npm view $PKG version --registry $REGISTRY --prefer-online"
  if ! confirm "是否视为验证通过并继续"; then
    exit 1
  fi
  write_env WIZARD_RELEASE_VERIFIED "$VERSION"
fi

open_url "https://www.npmjs.com/package/$PKG"
step "已尝试打开 npm 包主页，确认 Latest 为 $VERSION"
pause "确认包主页 Latest 已是 $VERSION 后按回车"

# ── Stage 6：已装形态验证 ───────────────────────
stage "6/6 已装形态验证"
say "验证已装 DSH 形态中版本号可见且面板行为符合发布内容。"
echo ""
say "请在已装 DSH 中验证（任选其一）："
say "  方式 A：dsh plugin --profile web add $PKG@$VERSION --registry $REGISTRY"
say "  方式 B：DSH 桌面应用重启后，面板 tabs 行最右侧版本号应为 $VERSION"
open_url "http://127.0.0.1:43120"
step "已尝试打开 DSH 面板 http://127.0.0.1:43120（若本机未运行 DSH 可忽略）"
echo ""
say "快检（在 DSH 窗口 F12 控制台粘贴）："
say "  (()=>document.documentElement.innerHTML.includes('$VER_NUM') ? '✓ 已装形态含 $VERSION' : '✗ 未找到 $VERSION')()"
if confirm "是否看到已装形态已是 $VERSION 且面板行为符合发布内容"; then
  say "✓ 已装形态验证通过"
  write_env WIZARD_RELEASE_DONE "$VERSION"
else
  warn "已装形态尚未更新。请执行：dsh plugin --profile web add $PKG@$VERSION --registry $REGISTRY 并重启 DSH"
  write_env WIZARD_RELEASE_DONE "pending:$VERSION"
fi

write_env WIZARD_RELEASE_STAGE "6"

finish
say "发布旅程已完成：$VERSION"
say "下一步（按 Runbook 第 8 节顺序）：打标签并推送 → 创建 GitHub Release（与 CHANGELOG 同文）→ 验证已装形态。"
say "标签命令：git tag $VERSION && git push origin $VERSION"
say "Release 说明需与 CHANGELOG.md 中 $VERSION 小节同文。"