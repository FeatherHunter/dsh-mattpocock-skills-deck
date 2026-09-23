// 违规样本一（#706 T2 第二批 · tests/verify-gh-gateway.js 的反证夹具）：
// 这个文件绕过唯一出口闸，直接起 gh 进程。它一个字都没登记在本门禁的出口登记表里，
// 所以扫描器必须把它抓出来判红。
// 注意：默认扫描根是仓库根（src/），tests/fixtures/gh-gateway/ 整个目录在扫仓库时被跳过，
// 所以这棵夹具树不会把「现状那一跑」判红；只有用 --root 指向它时才会被扫到。
export function badBypass(subprocess, cwd) {
  return subprocess.spawn({ argv: ['gh', 'issue', 'list', '--limit', '100'], cwd: cwd })
}
