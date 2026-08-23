/**
 * platform/win32/index.js — Windows 实现。
 * ⌈ 占位 ⌉ #113 实现：getHome（USERPROFILE / HOME）、path（\）、resolveExecutable（cmd.exe/gh）。
 */
export default function win32Platform(ctx) {
  void ctx
  return {
    os: () => 'win32',
    env: () => (process.env.USERPROFILE ?? process.env.HOME ?? ''),
    path: { join: (...p) => p.join('\\') },
    fs: {},
    resolveExecutable: async () => null,
  }
}
