#!/usr/bin/env bash
# wizard/template.sh — 统一向导库（被各向导 source，不直接执行）
# 提供：分段清屏、进度、显式打开链接、确认、落盘与收尾 的一致体验。
# 约定：向导脚本在 source 本文件后，设置 TOTAL_STAGES 并按 stage() 节律编写旅程；
#       中途可 Ctrl-C 中断，已落盘值在 ENV_FILE 中被记住，重跑时自动回填。
# 参考：scripts/wizard-gh-auth.sh 的库段为单一真源，本文件为其抽取与收敛。

# 避免重复加载
if [[ -n "${__WIZARD_TEMPLATE_LOADED:-}" ]]; then
  return 0 2>/dev/null || exit 0
fi
__WIZARD_TEMPLATE_LOADED=1

# 颜色（仅终端支持时启用）
if [[ -t 1 ]] && command -v tput >/dev/null 2>&1 && [[ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]]; then
  BOLD=$(tput bold); DIM=$(tput dim); RESET=$(tput sgr0)
  BLUE=$(tput setaf 4); GREEN=$(tput setaf 2); YELLOW=$(tput setaf 3); RED=$(tput setaf 1)
else
  BOLD=""; DIM=""; RESET=""; BLUE=""; GREEN=""; YELLOW=""; RED=""
fi

TOTAL_STAGES=0
_STAGE_INDEX=0
ENV_FILE="${ENV_FILE:-${WIZARD_ENV_FILE:-.env}}"
WRITTEN_ENV=()
WRITTEN_SECRET=()
SKIPPED=()

# _clear — 仅在交互终端清屏，管道日志保持可读
_clear() {
  [[ -t 1 ]] || return 0
  if command -v tput >/dev/null 2>&1; then tput clear; else printf '\033[2J\033[3J\033[H'; fi
}

# banner "标题" — 开场帧：说明本向导做什么，展示总段数
banner() {
  _clear
  printf '\n%s%s  %s%s\n' "$BOLD" "$BLUE" "$1" "$RESET"
  printf '%s  %s stages%s\n\n' "$DIM" "$TOTAL_STAGES" "$RESET"
  printf '%s  你来操作浏览器；向导只告诉你该做什么，并记录你带回的值。\n' "$DIM"
  printf '  随时 Ctrl-C 中断，重跑会记住已保存的值。%s\n' "$RESET"
  pause "准备开始？"
}

# stage "名称" — 清屏并宣告当前段，展示进度 Stage X/Y
stage() {
  _clear
  _STAGE_INDEX=$((_STAGE_INDEX + 1))
  printf '\n%s%s▸ Stage %s/%s · %s%s\n' \
    "$BOLD" "$BLUE" "$_STAGE_INDEX" "$TOTAL_STAGES" "$1" "$RESET"
}

say()  { printf '  %s\n' "$1"; }
step() { printf '  %s•%s %s\n' "$BLUE" "$RESET" "$1"; }
note() { printf '  %s%s%s\n' "$DIM" "$1" "$RESET"; }
warn() { printf '  %s⚠ %s%s\n' "$YELLOW" "$1" "$RESET"; }

# open_url URL — 跨平台尝试在用户桌面弹出可见浏览器窗口并打开链接
# 调起器一律当「发射后不管」：explorer.exe 打开成功也常返回非零退出码，
# 拿退出码判成败会误报「浏览器未自动弹出」（2026-09-08 实测），所以只看有没有可用的调起器。
open_url() {
  local url="$1"
  printf '  %s↗ opening%s %s\n' "$GREEN" "$RESET" "$url"
  { if   command -v wslview      >/dev/null 2>&1; then wslview "$url"
    elif command -v explorer.exe  >/dev/null 2>&1; then explorer.exe "$url"
    elif command -v xdg-open     >/dev/null 2>&1; then xdg-open "$url"
    elif command -v open         >/dev/null 2>&1; then open "$url"
    else warn "未找到浏览器打开命令，请手动访问：$url"; fi
  } >/dev/null 2>&1 || true
  # 末行的 `|| true` 才是「发射后不管」真正生效的那一半。
  # 只把输出重定向掉不退掉退出码：花括号这个命令组的退出码就是组内最后一条命令的退出码，
  # 于是调起器的退出码会变成 open_url 的返回值；调用处多在 `set -e` 下，这一个返回值就能当场结束整个向导
  # （2026-09-12 实测：explorer.exe 打开包主页返回 1，发布向导因此在第 287 行无声结束）。
  # 有没有弹出浏览器，人自己看得见；这里绝不能替调用处下结论，更不该决定脚本生死。
}

# _require_human — 向导马上要等人应答，先确认真的有人在。
# 判据：读不到任何输入（read 的返回值就说明输入流已经结束、并没有人在按键）即为「没有人应答」。
# 为什么用这一条当判据：它是唯一一条既能在本机测出来、又不受「终端是不是 TTY」影响的证据——
#   `read` 拿到的输入流已经结束，就不会再有下一个按键；
#   反过来，本机 Git Bash 里 [[ -t 0 ]] 与 /dev/tty 的可读性在「stdin 被重定向」时也照旧报「可用」
#   （2026-09-12 实测：/dev/tty 可读性检查返回真，真去读却报 No such device or address），
#   所以不用它们当判据。空行算「有人按了回车」（read 成功返回空串），
#   于是「人自己按回车走默认那条路」与「根本没人应答」区分得开：后者不再静默冒充前者——
#   向导从前把「没人应答」当成「人按了否」，然后把「已发布」写进落盘文件，账目与事实相反。
# 停下的方式：打一行人能读懂的话并退出，退出码 3 表示「向导没有继续，后面的步骤一步都没走」。
#   退出码不用 0（那是成功）、也不用 1 与 2（这两个在本仓库里已经分别表示运行中失败与参数/形态错误）。
# 供 pause 与 confirm 共用：全脚本的每一处等待应答都走同一条判据，换一处位置也不会漏。
_last_await_prompt=""

_require_human() {
  printf '\n  %s✗ 向导已退出：没有人应答（读不到任何输入）。%s\n' "$RED" "$RESET" >&2
  printf '  %s止步于「%s」这一步；这一步之后的步骤一步都没走，本次没有发布任何东西。%s\n' "$DIM" "$_last_await_prompt" "$RESET" >&2
  exit 3
}

# pause "提示" — 等待用户确认已完成手工操作
pause() {
  _last_await_prompt="${1:-按回车继续}"
  printf '  %s%s%s ' "$DIM" "$_last_await_prompt" "$RESET"
  # 读成功（含空行）就放行；读失败只可能是输入流已经结束，也就是没有人应答，明确失败而不是静默继续。
  read -r _ || _require_human
}

# confirm "问题" — y/N 二选一，返回 0 表示确认
confirm() {
  local reply=""
  _last_await_prompt="$1"
  printf '  %s? %s [y/N] ' "$YELLOW" "$1"
  read -r reply || _require_human
  [[ "$reply" =~ ^[Yy] ]]
}

# _existing KEY — 读取 ENV_FILE 中 KEY 的当前值（若存在）
_existing() {
  [[ -f "$ENV_FILE" ]] || return 1
  local line; line=$(grep -E "^${1}=" "$ENV_FILE" | tail -n1) || return 1
  printf '%s' "${line#*=}"
}

# ask KEY "提示" — 读取可见输入，重跑时提供已落盘值为默认值（回车保留）
ask() {
  local key="$1" prompt="$2" current input
  current=$(_existing "$key" || true)
  if [[ -n "$current" ]]; then
    printf '  %s%s%s %s[回车保留：%s]%s ' "$BOLD" "$prompt" "$RESET" "$DIM" "$current" "$RESET"
  else
    printf '  %s%s%s ' "$BOLD" "$prompt" "$RESET"
  fi
  read -r input || true
  [[ -z "$input" && -n "$current" ]] && input="$current"
  printf -v "$key" '%s' "$input"
}

# ask_secret KEY "提示" — 同 ask，但输入不回显
ask_secret() {
  local key="$1" prompt="$2" current input
  current=$(_existing "$key" || true)
  if [[ -n "$current" ]]; then
    printf '  %s%s%s %s[回车保留已存值]%s ' "$BOLD" "$prompt" "$RESET" "$DIM" "$RESET"
  else
    printf '  %s%s%s ' "$BOLD" "$prompt" "$RESET"
  fi
  read -rs input || true
  printf '\n'
  [[ -z "$input" && -n "$current" ]] && input="$current"
  printf -v "$key" '%s' "$input"
}

# write_env KEY VALUE — 将 KEY=VALUE 幂等地写入 ENV_FILE（创建或替换）
write_env() {
  local key="$1" value="$2" tmp
  touch "$ENV_FILE"
  tmp=$(mktemp)
  grep -vE "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
  WRITTEN_ENV+=("$key")
  printf '  %s✓ wrote%s %s → %s\n' "$GREEN" "$RESET" "$key" "$ENV_FILE"
}

# set_secret NAME VALUE — 通过 gh 设置 GitHub Actions 仓库 secret（失败则记录待手工）
set_secret() {
  local name="$1" value="$2"
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    if printf '%s' "$value" | gh secret set "$name" >/dev/null 2>&1; then
      WRITTEN_SECRET+=("$name")
      printf '  %s✓ set%s GitHub secret %s\n' "$GREEN" "$RESET" "$name"
      return
    fi
  fi
  SKIPPED+=("GitHub secret $name（手工：gh secret set $name）")
  warn "已跳过 GitHub secret $name：gh 未就绪，稍后手工设置"
}

# set_var NAME VALUE — 设置 GitHub Actions 仓库变量（非 secret）
set_var() {
  local name="$1" value="$2"
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    if gh variable set "$name" --body "$value" >/dev/null 2>&1; then
      printf '  %s✓ set%s GitHub variable %s\n' "$GREEN" "$RESET" "$name"
      return
    fi
  fi
  SKIPPED+=("GitHub variable $name")
  warn "已跳过 GitHub variable $name，gh 未就绪，稍后手工设置"
}

# finish — 清屏并展示收尾汇总（已写入、已设置、待手工）
finish() {
  _clear
  printf '\n%s%s  ✓ 全部完成%s\n' "$BOLD" "$GREEN" "$RESET"
  (( ${#WRITTEN_ENV[@]} ))    && note "已写入 ${#WRITTEN_ENV[@]} 项到 $ENV_FILE：${WRITTEN_ENV[*]}"
  (( ${#WRITTEN_SECRET[@]} )) && note "已设置 ${#WRITTEN_SECRET[@]} 个 GitHub secret：${WRITTEN_SECRET[*]}"
  if (( ${#SKIPPED[@]} )); then
    printf '\n'; warn "仍需手工处理："
    for s in "${SKIPPED[@]}"; do note "  - $s"; done
  fi
  printf '\n'
}

# poll_npm_version — 等待 npm 官方源出现指定版本，最多 90 秒
# 用法：poll_npm_version <package> <version> [registry]
poll_npm_version() {
  local pkg="$1" ver="$2" registry="${3:-https://registry.npmjs.org}" i latest
  say "轮询官方源：npm view $pkg version --registry $registry --prefer-online（最多 90s）"
  for i in $(seq 1 18); do
    latest=$(npm view "$pkg" version --registry "$registry" --prefer-online 2>&1 | tail -n1 | tr -d ' \r\n' || true)
    if [[ "$latest" == "$ver" || "$latest" == "v$ver" ]]; then
      printf '  %s✓ 官方源已可见%s %s\n' "$GREEN" "$RESET" "$latest"
      return 0
    fi
    printf '  %s·%s 第 %s/18 次：当前 latest=%s，等待 5s 后重试…\n' "$DIM" "$RESET" "$i" "${latest:-<空>}"
    sleep 5
  done
  warn "轮询超时：官方源仍未出现 $ver（latest=$latest），可能是网络或发布尚未完成"
  return 1
}
