/**
 * src/shared/workspaceKey.ts — 工作区键单源（#301 / #324 规格）
 *
 * 共享语义：同一工作区的所有会话共享同一份面板数据，判定“同一工作区”的唯一钥匙
 * 就是本文件的 keyOf 纯函数。客户端全部按工作区归一的抽屉（快照缓存、
 * 在途去重、链在途、选择集、仓库、链共享、扇出分组、工作区列表收敛）都用它；
 * 宿主侧 canonicalWorkspaceKey 曾是它的包装（绝对路径短路、相对路径经文件系统
 * 解析后落到同一归一，见 src/host/workspaceKey.ts）。从 #1498 起两者在 UNC 的
 * 大小写上分家：本文件继续折叠（只为认人），宿主读盘那一路不再折叠 —— 理由与
 * 代价见下方说明和文件末的已知边界。
 *
 * 本文件只产「认人」的身份键（缓存桶、在途去重、列表收敛），不产读盘路径、也不当 cwd 送给宿主：
 * 送给宿主的一律是调用方手上的原样路径，宿主自己按 src/host/workspaceKey.ts 的规则规整后才读盘。
 * 那条读盘规则从 #1498 起与这里不同：盘符路径仍折叠大小写，UNC（\\wsl.localhost\…、\\wsl$\…）保留
 * 原始大小写 —— 因为 UNC 背后可能是区分大小写的 WSL 盘，小写化会洗出根本不存在的目录。
 * 两边口径不同是有意的：界面上的「同一工作区」按折叠后的键归并（沿用 2026-08-28 的规矩），
 * 读盘则必须用真实存在的路径。代价见文件末的已知边界。
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

// 下面两行把运行环境里可能缺席的全局量照实声明出来：浏览器闭包里没有 process，
// Node 直跑时没有 navigator。真正用之前一律沿用原文的 typeof 守卫写法，
// 所以声明成「可能缺席」才是实话，写成必在反而是撒谎。
declare const process: { platform: string } | undefined;
declare const navigator: { platform: string } | undefined;

// 同一工作区的两种写法必须落到同一个键：大小写、斜杠方向、尾斜杠不同只是写法不同，不是两个地方。
export function keyOf(raw: unknown, os?: unknown): string {
  if (raw == null) return '';
  let s = String(raw).trim();
  if (!s) return '';
  // 判定操作系统：显式 os 参数优先，否则按全局环境或路径形态推断
  let isWin: boolean | undefined;
  if (typeof os === 'string' && os) {
    isWin = os === 'win32';
  } else {
    try {
      if (typeof navigator !== 'undefined' && navigator && (navigator as { platform?: unknown }).platform && /Win/i.test(String((navigator as { platform?: unknown }).platform))) {
        isWin = true;
      } else if (typeof process !== 'undefined' && process && process.platform === 'win32') {
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
    // 小写折叠只在这里做、且只为「认人」（读盘见 src/host/workspaceKey.ts，那里 UNC 保留原始大小写，
    // #1498）；同一个工作区的大小写写法要在界面上并成一桶，代价见文件末的已知边界。
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

// currentOs 只做一件事：告诉 keyOf 第二个参数该传什么，判不准时回 linux（POSIX 那半不分大小写）。
// 便捷：返回当前运行时的操作系统标识，供客户端调用 keyOf 时传入
export function currentOs(): string {
  try {
    if (typeof navigator !== 'undefined' && navigator && (navigator as { platform?: unknown }).platform) {
      if (/Win/i.test(String((navigator as { platform?: unknown }).platform))) return 'win32';
      if (/Mac/i.test(String((navigator as { platform?: unknown }).platform))) return 'darwin';
      return 'linux';
    }
    if (typeof process !== 'undefined' && process && process.platform) {
      if (process.platform === 'win32') return 'win32';
      if (process.platform === 'darwin') return 'darwin';
      return 'linux';
    }
  } catch (e) {}
  return 'linux';
}

// normalizeWorkspacePath 只是旧名的包装：宿主侧历史导入不断，行为与 keyOf 完全一致。
// 兼容宿主侧旧导入：normalizeWorkspacePath(raw, platform) 包装 keyOf
export function normalizeWorkspacePath(raw: unknown, platform?: { os?: unknown } | string): string {
  const os = platform && typeof platform === 'object' ? (platform as { os?: unknown }).os : (typeof platform === 'string' ? platform : undefined);
  return keyOf(raw, os);
}

// 已知边界：客户端身份键在 UNC 上仍折叠大小写（#1498 之后仍然如此，是有意的）。
// 本文件的 keyOf 对 win32 路径一律小写折叠，包括 UNC（\\wsl.localhost\…、\\wsl$\…）。
// 这类 UNC 背后可能是区分大小写的 WSL 盘，盘上真的可以同时存在 .../repo/A 与 .../repo/a
// 两个不同目录：在界面上它们会共用同一个缓存桶（快照缓存、在途去重等），而宿主从 #1498 起
// 按原始大小写把它们当成两个工作区。读盘不受影响（宿主读盘用的是自己那份规整结果，从不拿
// 客户端键当路径），代价只是那两个目录的面板数据在客户端可能串桶。
// 要按盘的实际情况决定折还是不折，得先知道 UNC 指向的卷是否区分大小写，这件事从字符串
// 看不出来，所以这次没有改动客户端这一层；真遇到 WSL 里共存仅大小写不同的两个工作区再开票。

// 只有具名导出、没有默认导出：原文就没有，拼接（剥行首 export 拼进闭包）与文本直读门禁都只认行首具名形态，
// 调用方按名字引用即可。
