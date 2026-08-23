/**
 * platform/linux/index.js — Linux 实现。
 * ⌈ 占位 ⌉ #113 实现：getHome（HOME）、path（/）、resolveExecutable 等。
 */
export default function linuxPlatform(ctx) {
  void ctx
  return {
    os: () => 'linux',
    env: () => (process.env.HOME ?? ''),
    path: { join: (...p) => p.join('/') },
    fs: {},
    resolveExecutable: async () => null,
  }
}
