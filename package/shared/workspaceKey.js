/**
 * src/shared/workspaceKey.js — 工作区键单源（#301 / #324 规格）
 *
 * 共享语义：同一工作区的所有会话共享同一份面板数据，判定“同一工作区”的唯一钥匙
 * 就是本文件的 keyOf 纯函数。客户端全部按工作区归一的抽屉（快照缓存、
 * 在途去重、链在途、选择集、仓库、链共享、扇出分组、工作区列表收敛）都用它；
 * 宿主侧 canonicalWorkspaceKey 是它的包装（绝对路径短路、相对路径经文件系统
 * 解析后落到同一归一，见 src/host/workspaceKey.js）。
 *
 * 规则（维护者 2026-08-28 拍板）：
 *  - trim 去首尾空白
 *  - Windows：小写折叠、反斜杠转正斜杠、折叠连续斜杠、去尾斜杠
 *    根白名单：盘符根 (如 d:/)、裸斜杠 (/)、POSIX 根 (/) 保留；
 *    UNC 共享根 (//srv/share) 统一去尾斜杠（与盘符根不同）
 *  - POSIX (darwin / linux)：保留大小写，只做斜杠归一（折叠连续斜杠、去尾斜杠）
 *  - 符号链接 / junction：不解析，作为已知边界留档（真路径与链接路径按两个工作区）
 *  - 空值：返回 ''，调用方回退到默认目录
 */

export function keyOf(raw, os) {
  if (raw == null) return '';
  let s = String(raw).trim();
  if (!s) return '';
  // 判定操作系统：显式 os 参数优先，否则按全局环境或路径形态推断
  let isWin;
  if (typeof os === 'string' && os) {
    isWin = os === 'win32';
  } else {
    try {
      if (typeof navigator !== 'undefined' && navigator.platform && /Win/i.test(navigator.platform)) {
        isWin = true;
      } else if (typeof process !== 'undefined' && process.platform === 'win32') {
        isWin = true;
      } else {
        // 启发式：含反斜杠或盘符形态则按 win 处理，否则按 posix
        isWin = /^[a-zA-Z]:[\\/]/.test(s) || s.indexOf('\\') >= 0;
      }
    } catch (e) {
      isWin = /^[a-zA-Z]:[\\/]/.test(s) || s.indexOf('\\') >= 0;
    }
    if (isWin == null) isWin = false;
  }

  if (isWin) {
    // Windows：统一用正斜杠，折叠，去尾
    s = s.replace(/\\/g, '/');
    const isUNC = s.indexOf('//') === 0;
    if (isUNC) {
      // 保留恰好两个开头斜杠，其余折叠；避免 '////' -> '///' 的多余斜杠
      // 先去除开头的全部斜杠，再补回恰好两个
      const rest = s.slice(2).replace(/^\/+/, '').replace(/\/+/g, '/');
      s = '//' + rest;
    } else {
      s = s.replace(/\/+/g, '/');
    }
    s = s.toLowerCase();
    // 根白名单：盘符根（如 d:/）、裸斜杠保留；UNC 根不保留，去尾
    let keep = false;
    if (/^[a-z]:\/$/.test(s)) keep = true;
    if (s === '/') keep = true;
    // 注意：UNC 共享根 '//srv/share' 不进白名单，带尾斜杠会被去掉，满足“统一去尾”
    if (!keep) {
      while (s.length > 1 && s.charAt(s.length - 1) === '/') {
        // 避免把 '//' 啃成 '/'
        if (s === '//') break;
        s = s.slice(0, -1);
      }
    }
    return s;
  } else {
    // POSIX：保留大小写，仅斜杠归一
    s = s.replace(/\/+/g, '/');
    while (s.length > 1 && s.charAt(s.length - 1) === '/') {
      s = s.slice(0, -1);
    }
    // 额外：空归一后若为 '//' 这种（POSIX 不应有 UNC），也折为 '/'
    if (s.indexOf('//') === 0) {
      s = '/' + s.slice(2).replace(/^\/+/, '');
      s = s.replace(/\/+/g, '/');
      if (s.length > 1 && s.endsWith('/')) s = s.slice(0,-1);
    }
    return s;
  }
}

// 便捷：返回当前运行时的操作系统标识，供客户端调用 keyOf 时传入
export function currentOs() {
  try {
    if (typeof navigator !== 'undefined' && navigator.platform) {
      if (/Win/i.test(navigator.platform)) return 'win32';
      if (/Mac/i.test(navigator.platform)) return 'darwin';
      return 'linux';
    }
    if (typeof process !== 'undefined' && process.platform) {
      if (process.platform === 'win32') return 'win32';
      if (process.platform === 'darwin') return 'darwin';
      return 'linux';
    }
  } catch (e) {}
  return 'linux';
}

// 兼容宿主侧旧导入：normalizeWorkspacePath(raw, platform) 包装 keyOf
export function normalizeWorkspacePath(raw, platform) {
  const os = platform && platform.os ? platform.os : (typeof platform === 'string' ? platform : undefined);
  return keyOf(raw, os);
}

// default export removed for splice compatibility — use named imports
