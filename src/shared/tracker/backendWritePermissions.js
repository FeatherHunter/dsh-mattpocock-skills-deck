// src/shared/tracker/backendWritePermissions.js —— 「这个后端不用问远端也知道写得了吗」的唯一判断（#992 收口）。
//
// 为什么要有这个文件：
//   面板要如实告诉人「这个仓库只读，标签与写操作不可用」，先得知道仓库的写权限。三个后端的答案来路不同：
//     · 票就存在本地文件里的后端：没有远端权限模型，写不写得了由本地文件可写性决定
//       （面板另有 md:scratchWritable 那条检查），所以这里直接给「可写」——既不去问远端，也不显示「只读」；
//     · 有远端权限模型的后端（如 GitHub）：这里不下结论，交给调用方去问后端自己的写权限旁路，
//       问到了用真值，问不到按未知处理；
//     · 没实现写权限旁路的后端（如 GitLab）：同样交给调用方，按未知处理，不捏造。
//
// 为什么单独成一份：仓库门禁 tests/verify-deck-tools.js 第 ⑪ 段不许工具层自己拿后端 id 做等值比较判后端，
//   而「本地文件后端恒可写」这条后端知识必须有唯一出处，所以收成这里的具名判断，由工具层调用。
//
// 本文件零依赖（不 import 任何东西）：它住在 src/shared/tracker/ 下，按仓库门禁
//   tests/verify-no-cross-import.js 的白名单，三个后端房间与工具层都可以引用它。

/** 票就存在本地文件里的后端 id：这类后端没有远端权限模型。 */
const LOCAL_FILE_BACKEND_IDS = new Set(['markdown'])

/**
 * 不用问远端就能确定的写权限。
 * @param {string} backendId 当前后端 id
 * @returns {{push: boolean, triage: boolean}|null} 不用问远端就是这一份；要问远端、或按未知处理时回 null
 */
export function knownWritePermissions(backendId) {
  const id = (backendId === null || backendId === undefined) ? '' : String(backendId)
  return LOCAL_FILE_BACKEND_IDS.has(id) ? { push: true, triage: true } : null
}
