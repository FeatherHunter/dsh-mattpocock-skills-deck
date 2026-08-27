/**
 * host/workspaceKey.js — 统一路径入口（交付块② · ADR 第四条）
 *
 * 规约：原始描述进、规整键出。全仓任何按 cwd 分桶的状态（宿主命令、缓存、
 * per-workspace 内存表）必须经此入口取值，键只允许使用规整键，杜绝跨工作区串味。
 *
 * 三种合法写法在同一目录上产出字节一致的规整键：
 *   1. 绝对路径 + 尾斜杠有无   e.g. D:\repo vs D:\repo\ vs D:\repo\.
 *   2. 斜杠风格                e.g. D:/repo vs D:\repo（win32）
 *   3. 大小写（仅 win32）       e.g. D:\Repo vs d:\repo
 *
 * 另覆盖：尾随 ./  、冗余分隔、相对路径经 fs.resolve / home 归一、空白修剪。
 * 同一语义全部坍缩为同一键，快照级回归以字符串相等断言。
 */

export function normalizeWorkspacePath(raw, platform) {
  if (raw == null) return '';
  let s = String(raw).trim();
  if (!s) return s;
  try {
    if (platform && platform.path && typeof platform.path.normalize === 'function') {
      let n = platform.path.normalize(s);
      const sep = platform.path.sep;
      // 判定根：win32 为 C:\ / \\server\share\ / \ ，posix 为 /
      let isRoot = false;
      if (platform.os === 'win32') {
        isRoot = /^[A-Za-z]:\\$/.test(n) || /^\\\\[^\\]+\\[^\\]+\\?$/.test(n) || n === '\\' || n === '/';
        // C: 不视为根，后续追加内容可能
      } else {
        isRoot = n === '/';
      }
      if (!isRoot) {
        // 去尾部分隔符（除根之外）
        while (n.length > 1 && n.endsWith(sep)) n = n.slice(0, -1);
        const otherSep = sep === '\\' ? '/' : '\\';
        while (n.length > 1 && n.endsWith(otherSep)) n = n.slice(0, -1);
      }
      if (platform.os === 'win32') n = n.toLowerCase();
      return n;
    }
  } catch {}
  return s;
}

/**
 * 将任意工作区描述解析为规整键（async）。
 * @param {string} raw - 客户端传入的 cwd / path / 相对名等
 * @param {{ getPlatform: () => Promise<any>, getFs: () => any, getDefaultCwd: () => string }} deps
 * @returns {Promise<string>} 规整后的绝对键（始终可用作 Map key 与 spawn cwd）
 */
export async function canonicalWorkspaceKey(raw, deps) {
  const getPlatform = deps && deps.getPlatform;
  const getFs = deps && deps.getFs;
  const getDefaultCwd = deps && deps.getDefaultCwd;
  let input = raw;
  if (input == null || (typeof input === 'string' && !input.trim())) {
    try { input = getDefaultCwd ? getDefaultCwd() : ''; } catch { input = ''; }
    if (!input) return '';
  }
  if (typeof input !== 'string') input = String(input);
  input = input.trim();
  if (!input) {
    try { input = getDefaultCwd ? getDefaultCwd() : ''; } catch {}
  }

  let platform = null;
  try { platform = getPlatform ? await getPlatform() : null; } catch {}

  // 1) 绝对路径直规整
  try {
    if (platform && platform.path && typeof platform.path.isAbsolute === 'function' && platform.path.isAbsolute(input)) {
      return normalizeWorkspacePath(input, platform);
    }
  } catch {}

  // 2) 相对路径：尝试 DSH fs.resolve（可感知 workspaces 根）
  try {
    const fss = getFs ? getFs() : null;
    if (fss && typeof fss.resolve === 'function') {
      const t = await fss.resolve(input);
      const target = (t && typeof t === 'object') ? (t.path || t.target || t.displayPath || '') : t;
      if (typeof target === 'string' && target) {
        const isAbs = (platform && platform.path && typeof platform.path.isAbsolute === 'function')
          ? platform.path.isAbsolute(target)
          : (/^[A-Za-z]:[\\\/]/.test(target) || /^\//.test(target) || /^\\\\/.test(target));
        if (isAbs) return normalizeWorkspacePath(target, platform);
      }
    }
  } catch {}

  // 3) 相对名：按 home 归一（如 matt-demo-markdown → ~/matt-demo-markdown）
  try {
    if (platform && typeof platform.getHome === 'function') {
      const home = await platform.getHome();
      if (home && platform.path) {
        const joined = platform.path.join(home, input);
        return normalizeWorkspacePath(joined, platform);
      }
    }
  } catch {}

  // 4) 兜底：按当前语义规整原始串
  if (platform) return normalizeWorkspacePath(input, platform);
  return input;
}

export default { normalizeWorkspacePath, canonicalWorkspaceKey };
