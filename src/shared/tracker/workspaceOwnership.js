// src/shared/tracker/workspaceOwnership.js —— 「这个工作区的属主是不是当前运行用户」的单一判断。
//
// 为什么要有这个文件（票 #993 与 #994 共用，别说成其中一张票的私货）：
//   · #994 要的是预防：动手之前先问一次「git 能不能在这个工作区里干活」；
//   · #993 要的是解释：git 命令失败之后，把「属主不一致」认出来，单独给一档、给一句短修法，
//     而不是像以前那样落进兜底、显示成「权限不足，请检查登录账号」。
//   这两件事都在回答同一个问题。写两套必然漂移，会出现「探针说属主问题、兜底说权限不足」
//   这种同一个场景两种说法的情况。所以判断只写在这里，两边都调它。
//
// 本文件零依赖（不 import 任何东西）：它住在 src/shared/tracker/ 下，按仓库门禁
//   tests/verify-no-cross-import.js 的白名单，三个后端房间都可以引用它；反过来它不许引用任何房间。
//
// 判断依据（全部来自 git 自己的输出，不猜）：
//   属主与运行用户不一致时，git 在「找仓库」这一步就拒绝，stderr 原文形如
//     fatal: detected dubious ownership in repository at '<路径>'
//     To add an exception for this directory, call:
//             git config --global --add safe.directory <路径>
//   这段文本由 git 的 setup.c 产出（GIT_DIR_INVALID_OWNERSHIP 分支）。已实测：本文件下面这条
//   签名字符串，在 git 2.49 上打开 GIT_TEST_ASSUME_DIFFERENT_OWNER 时逐字出现。
//
// 为什么只认这一条签名、不做更多猜测：认不出来的错误要有认不出来的说法（#993 的验收标准就是
//   「不许把认不出的错误说成权限」）。宁可落进 unknown 让用户看到原始报错，也不要硬翻译。

/** 「属主不一致」这一档的名字。它是 igu 错误分类结果里的一档，不是日志标签。 */
export const KIND_GIT_OWNERSHIP = 'git-ownership'

/** 认不出来的错误落这一档（#993：兜底不再等于 permission）。 */
export const KIND_UNKNOWN = 'unknown'

/** git 拒绝操作时那句报错的签名。大小写不敏感匹配。 */
const OWNERSHIP_SIGNATURE = 'dubious ownership'

/**
 * 「这段 git 输出是不是属主不一致」。
 * @param {string} errText git 的 stderr / 错误文本（任意大小写）
 * @returns {boolean}
 */
export function isOwnershipMismatch(errText) {
  return String(errText || '').toLowerCase().includes(OWNERSHIP_SIGNATURE)
}

/**
 * 从 git 报错原文里取出它报的那个路径。
 * 取自 `detected dubious ownership in repository at '<路径>'` 里单引号之间的那一段。
 * 为什么用原文而不是自己去拼工作区路径：git 报的就是它实际比对过的那个路径，方向天然正确；
 * 自己拼一个「规范化」的路径反而可能拼出 git 不认的那个（Android 上 /sdcard 常是软链接，
 * 两种写法在配置里是两个不同字符串）。
 * @param {string} errText
 * @returns {string} 取不到时回空串，由调用方决定退路
 */
export function ownershipPathFrom(errText) {
  const m = String(errText || '').match(/dubious ownership in repository at '([^']+)'/)
  return m ? m[1] : ''
}

/**
 * 把一段 git 错误文本归一成错误档位。
 * 目前只认属主不一致这一档；其余一律 unknown —— 认不出来就说认不出来，这是 #993 的核心要求。
 * 网络/登录/同名已存在那些档位由 GitHub 后端自己的分类器判定，不走这里。
 * @param {string} errText
 * @returns {string} KIND_GIT_OWNERSHIP 或 KIND_UNKNOWN
 */
export function classifyGitFailure(errText) {
  return isOwnershipMismatch(errText) ? KIND_GIT_OWNERSHIP : KIND_UNKNOWN
}

/**
 * 给出「让 git 在这个工作区里能干活」要补的那一条设置，做成可以直接照做的一行命令。
 * @param {string} dirPath 要放行的目录（优先用 ownershipPathFrom 从 git 原文取到的那个）
 * @returns {string} 例如 `git config --global --add safe.directory /sdcard/Download/dsha`
 */
export function safeDirectoryCommand(dirPath) {
  const p = String(dirPath || '').trim()
  if (!p) return ''
  return 'git config --global --add safe.directory ' + p
}

/**
 * 自愈第一步与重试之间的判断用不到「环境档」，这里只保留一个名字，免得各调用点各起别名。
 * @returns {string} 'git-ownership'
 */
export function ownershipKind() {
  return KIND_GIT_OWNERSHIP
}
