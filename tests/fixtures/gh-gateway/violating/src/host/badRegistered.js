// 违规样本二（#706 T2 第二批 · tests/verify-gh-gateway.js 的反证夹具）：
// 这个文件登记在出口登记表里了（role 写的是 transport），但正文里压根没有把每一笔报给闸那一步
// —— 登记表说了话、代码没做到。门禁要求 transport 这类出口必须有报账调用，所以它必须判红。
export function badRegistered(subprocess, cwd) {
  return subprocess.spawn({ argv: ['gh', 'api', 'repos/o/r/issues'], cwd: cwd })
}
