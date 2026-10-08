// write-queue.js —— 本地 Markdown 后端里「读—改—写」的单写者队列（#712 建票取号、#618 配色文件、#922 票文件）
//
// 为什么必须有这条队：本后端改文件的做法统一是「先读整份内容 → 在内存里改 → 整份覆盖写回去」
// （write.js 的 writeTextFile 只懂整份替换，没有独占创建、没有行级写）。
// 中间那一次读会让出事件循环，于是两路并发时会一起读到同一份旧内容、各自改成各自的样子、
// 再各自整份写回去，后写的那一路把先写的那一路的改动整份抹掉 —— 两路都回「成功」，盘上却少了一半改动。
// #712 已经用这条队治住了「建票取号」，#618 用它治住了配色文件；#922 把它接到票文件上。
//
// 队列按钥匙分队：同一把钥匙上的读—改—写排成一条链（后来的等前面做完），不同钥匙互不排队。
// 两种钥匙都在本文件里算，为的是「同一个东西」无论被写成哪种样子都落到同一条队上：
//   工作区钥匙（withWorkspaceWriter）—— 用在「要先读整个目录才知道该写哪一份」的地方（建票取号）。
//   文件钥匙（withFileWriter）—— 工作区钥匙 + 归一后的文件路径，用在「已经知道该写哪一份票」的地方。
//     为什么带上工作区钥匙：同一个工作区可能被写成 D盘:/ws 与 d:/ws 两种样子，只按文件路径分队会让这两路各排各的队。
//     为什么按文件分队、不按工作区分队：批量补边这类操作一次要改很多张票，它们是不同的文件、彼此并不冲突；
//     按文件分队才能让它们同时做（#919 的并发改造就是照这个口径放宽的，串成一条队会把那份并行又收回去）。
// 跨进程不在本队列的保护范围内：它只认本进程里的并发（票 #919 的「Not yet specified」记着这件事）。
const chains = new Map()

/** 同一把钥匙上的读—改—写排成一条链。上一条失败不把后面的调用一起带崩（链上只留「已经结束」这个事实）。 */
export function withSingleWriter(key, work) {
  const prev = chains.get(key) || Promise.resolve()
  const run = prev.then(work, work)
  chains.set(key, run.then(function () {}, function () {}))
  return run
}

/** 这个工作区是哪一个目录：会话给的 cwd 优先，其次仓库引用，最后进程当前目录。 */
export function workspaceDirOf(ctx, repo) {
  if (ctx && typeof ctx.cwd === 'string' && ctx.cwd) return ctx.cwd
  if (repo && typeof repo.refId === 'string' && repo.refId) return repo.refId
  return (typeof process !== 'undefined' && typeof process.cwd === 'function') ? process.cwd() : '.'
}

/** 归一后的工作区钥匙：统一斜杠、去掉尾部斜杠、折成小写。
 *  为什么不能直接用路径串当钥匙：大小写或斜杠写法不同的两串是同一个工作区，用原始串会各走一条队列。 */
export function workspaceWriteKey(ctx, repo) {
  return String(workspaceDirOf(ctx, repo)).replace(/[\\]/g, '/').replace(/[/]+$/, '').toLowerCase()
}

/** 一份文件在队列里的钥匙：工作区钥匙 + 归一后的文件路径。 */
export function fileWriteKey(ctx, repo, filePath) {
  const p = String(filePath || '').replace(/[\\]/g, '/').replace(/[/]+$/, '').toLowerCase()
  return workspaceWriteKey(ctx, repo) + '|' + p
}

/** 按工作区排队：这一步的读—改—写中间不许插进同一工作区的另一个读—改—写。 */
export function withWorkspaceWriter(ctx, repo, work) {
  return withSingleWriter(workspaceWriteKey(ctx, repo), work)
}

/** 按文件排队：同一个工作区里同一个文件的读—改—写排成一条链，不同文件各走各的队。 */
export function withFileWriter(ctx, repo, filePath, work) {
  return withSingleWriter(fileWriteKey(ctx, repo, filePath), work)
}

export default { withSingleWriter, workspaceDirOf, workspaceWriteKey, fileWriteKey, withWorkspaceWriter, withFileWriter }
