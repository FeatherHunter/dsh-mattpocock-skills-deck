/**
 * platform/darwin/index.js — macOS 实现。
 * ⌈ 占位 ⌉ #113 实现：getHome（环境变量 HOME）、path（/）、resolveExecutable 等。
 */
export default function darwinPlatform(ctx) {
  void ctx
  return {
    os: () => 'darwin',
    env: () => (process.env.HOME ?? ''),
    path: { join: (...p) => p.join('/') },
    fs: {},
    resolveExecutable: async () => null,
  }
}
