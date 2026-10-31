/**
 * src/shared/version-control/src/rebase-ops.ts —— 交互式变基与换基座的共享协议（#1749，纯函数）
 *
 * 这份文件是「变基待办页」（规格 #1586 域 5 的 5.6–5.8、5.10）的唯一口径：
 *   · 四条写动作：交互式变基（待办清单由面板生成）、换基座（--onto）、自动吸收（--autosquash）、
 *     保留合并结构（--rebase-merges）；
 *   · 五条只读动作：读当前操作状态、读待办窗口、读换基座范围、读将吸收的提交对、读保留合并结构的代价；
 *   · 待办清单的生成与解析、以及所有参数形状的守卫都只写在这里，宿主与界面都从这里取。
 *
 * 为什么没有一行 import：本文件要按 scripts/build.mts 的 shared 片段拼进界面闭包，闭包里不能有
 * import 语句；宿主侧另有一份宿主叶子负责起进程，读取判定与参数形状都在这里。
 *
 * argv 是「子命令 + 各自独立的参数」数组，不含可执行文件名，也不拼接 shell 字符串：
 *   · 交互式变基：rebase -i <基座>，待办内容由面板用 GIT_SEQUENCE_EDITOR 覆盖；
 *   · 换基座：rebase --onto <新基座> <旧基座>，新基座在前、旧基座在后，顺序不能颠倒；
 *   · 自动吸收：rebase -i --autosquash <基座>；
 *   · 保留合并结构：rebase -i --rebase-merges <基座>（git 2.18 才有这个开关）。
 *
 * 本票明确不做的三件事，写在这里防止以后被顺手加回来：edit、break、--update-refs
 * （--update-refs 归 #1746 之后的说明票；面板发现仓库开着 rebase.updateRefs=true 就拒绝）。
 */

/** 交互式变基的四个写动作标识符。 */
export type RebaseWriteOp = 'rebase-todo' | 'rebase-onto' | 'rebase-autosquash' | 'rebase-merges';

/** 待办清单里允许的五个改写动词（另外两个「上移 / 下移」只是界面重排，不写进待办文件）。 */
export const TODO_ACTIONS = ['pick', 'reword', 'squash', 'fixup', 'drop'];

/** 界面上的两个纯重排动作：只改行的顺序，不改变提交内容。 */
export const TODO_MOVES = ['move-up', 'move-down'];

/** --rebase-merges 需要的最低 git 版本；低于这个版本预检明确拒绝，不让命令跑出去再失败。 */
export const REBASE_MERGES_MIN_VERSION = '2.18';

/** 预检契约名与版本：宿主与界面据此确认两边说的是同一件事。 */
export const REBASE_CHECK_CONTRACT = 'vc-rebase-check';
export const REBASE_CHECK_VERSION = 1;

/** 三条电话的名字：界面只认这三个名字，装配层按名字注册。 */
export const REBASE_PHONES = {
  read: 'wf.gitRebaseRead',
  check: 'wf.gitRebaseCheck',
  write: 'wf.gitRebaseWrite',
};

interface RebaseOpMeta {
  id: string;
  capId: string;
  kind: 'write' | 'read';
  dangerous: boolean;
  confirm: boolean;
  reversible: boolean;
  needs: 'todo' | 'onto' | 'base' | 'none';
  labelKey: string;
  command: string;
}
/**
 * 四条写动作。capId 对齐能力账本里的 5.6 / 5.7 / 5.8 / 5.10，
 * 顺序就是界面上的顺序（先交互式变基，再两个带参数的变体，最后保留合并结构）。
 */
export const REBASE_WRITE_OPS: RebaseOpMeta[] = [
  {
    id: 'rebase-todo',
    capId: '5.6',
    kind: 'write',
    dangerous: true,
    confirm: true,
    reversible: true,
    needs: 'todo',
    labelKey: 'vc.rebase.op.rebaseTodo',
    command: 'git rebase -i',
  },
  {
    id: 'rebase-onto',
    capId: '5.7',
    kind: 'write',
    dangerous: true,
    confirm: true,
    reversible: true,
    needs: 'onto',
    labelKey: 'vc.rebase.op.rebaseOnto',
    command: 'git rebase --onto',
  },
  {
    id: 'rebase-autosquash',
    capId: '5.8',
    kind: 'write',
    dangerous: true,
    confirm: true,
    reversible: true,
    needs: 'base',
    labelKey: 'vc.rebase.op.rebaseAutosquash',
    command: 'git rebase -i --autosquash',
  },
  {
    id: 'rebase-merges',
    capId: '5.10',
    kind: 'write',
    dangerous: true,
    confirm: true,
    reversible: true,
    needs: 'base',
    labelKey: 'vc.rebase.op.rebaseMerges',
    command: 'git rebase -i --rebase-merges',
  },
];

/**
 * 五条只读动作。它们没有能力编号：能力账本只登记四个「操作」，
 * 这五条是这个页面的支撑读数，不会单独算成能力。
 */
export const REBASE_READ_OPS: RebaseOpMeta[] = [
  { id: 'rebase-state', capId: '', kind: 'read', dangerous: false, confirm: false, reversible: true, needs: 'none', labelKey: 'vc.rebase.op.rebaseState', command: 'git status / git rev-parse' },
  { id: 'rebase-window', capId: '', kind: 'read', dangerous: false, confirm: false, reversible: true, needs: 'base', labelKey: 'vc.rebase.op.rebaseWindow', command: 'git log --reverse <基座>..HEAD' },
  { id: 'rebase-onto-range', capId: '', kind: 'read', dangerous: false, confirm: false, reversible: true, needs: 'onto', labelKey: 'vc.rebase.op.rebaseOntoRange', command: 'git log <旧基座>..<新基座> 与 <旧基座>..HEAD' },
  { id: 'rebase-autosquash-pairs', capId: '', kind: 'read', dangerous: false, confirm: false, reversible: true, needs: 'base', labelKey: 'vc.rebase.op.rebaseAutosquashPairs', command: 'git rebase -i --autosquash（只捕获待办，不执行）' },
  { id: 'rebase-merges-cost', capId: '', kind: 'read', dangerous: false, confirm: false, reversible: true, needs: 'base', labelKey: 'vc.rebase.op.rebaseMergesCost', command: 'git log --merges <基座>..HEAD' },
];

/** 九条动作合在一起，给「认一条动作」与门禁对账用。 */
export const REBASE_OPS: RebaseOpMeta[] = REBASE_WRITE_OPS.concat(REBASE_READ_OPS);

/** 按标识符查动作元数据；不认得回 null，调用方据此拒绝（不认识的动作一律不猜）。 */
export function rebaseOpMetaOf(op: any): RebaseOpMeta | null {
  const want = String(op === undefined || op === null ? '' : op);
  for (let i = 0; i < REBASE_OPS.length; i += 1) {
    if (REBASE_OPS[i].id === want) return REBASE_OPS[i];
  }
  return null;
}

/** 计划对象的键序固定；写进票据再读回来时，canonicalJson 的摘要才稳定。 */
export function rebasePlanOf(partial: any): any {
  const p = partial || {};
  const rows = Array.isArray(p.rows) ? p.rows : null;
  return {
    op: p.op === undefined ? null : p.op,
    base: p.base === undefined ? null : p.base,
    baseOid: p.baseOid === undefined ? null : p.baseOid,
    branch: p.branch === undefined ? null : p.branch,
    rows: rows,
    oldBase: p.oldBase === undefined ? null : p.oldBase,
    oldBaseOid: p.oldBaseOid === undefined ? null : p.oldBaseOid,
    newBase: p.newBase === undefined ? null : p.newBase,
    newBaseOid: p.newBaseOid === undefined ? null : p.newBaseOid,
    merges: p.merges === true,
    autosquash: p.autosquash === true,
  };
}

/**
 * 目标形状守卫（基座、旧基座、新基座都走这一个）。
 * 只放行分支名、标签名与完整提交号：拒绝空、超长、空白与控制字符、以短横线开头（会被 git 当选项）、
 * 含 .. 或 @{ 或反斜杠、以 / 或 .lock 结尾的写法。
 */
export function rebaseTargetProblem(target: any): string | null {
  if (typeof target !== 'string') return 'bad-target';
  if (target.length === 0 || target.length > 200) return 'bad-target';
  if (/[\s\u0000-\u001f\u007f]/.test(target)) return 'bad-target';
  if (target.charAt(0) === '-') return 'bad-target';
  if (target.charAt(0) === '/') return 'bad-target';
  if (target.indexOf('..') >= 0) return 'bad-target';
  if (target.indexOf('@{') >= 0) return 'bad-target';
  if (target.indexOf('\\') >= 0) return 'bad-target';
  if (target.charAt(target.length - 1) === '/') return 'bad-target';
  if (target.slice(-5) === '.lock') return 'bad-target';
  return null;
}

/**
 * 待办行的形状与集合校验。
 * rows 是界面排好的行（每行 {oid, action, subject?}）；expectedOids 是刷新时看到的窗口提交号。
 * 给了 expectedOids 就必须与它逐条对上（顺序可以不同，集合必须相同）：窗口在确认后变了说明
 * 用户看到的清单已经过期，这时候不能拿旧行去执行。
 */
export function rebaseRowsProblem(rows: any, expectedOids: any): string | null {
  if (!Array.isArray(rows) || rows.length === 0) return 'bad-todo';
  if (rows.length > 200) return 'todo-too-long';
  const seen: any = {};
  const got: string[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row || typeof row !== 'object') return 'bad-todo';
    const oid = row.oid;
    if (typeof oid !== 'string' || !/^[0-9a-fA-F]{4,64}$/.test(oid)) return 'bad-todo';
    if (TODO_ACTIONS.indexOf(String(row.action)) < 0) return 'bad-action';
    if (seen[oid]) return 'bad-todo';
    seen[oid] = true;
    got.push(oid);
  }
  if (Array.isArray(expectedOids)) {
    if (expectedOids.length !== got.length) return 'todo-mismatch';
    const want: any = {};
    for (let i = 0; i < expectedOids.length; i += 1) want[String(expectedOids[i])] = true;
    for (let i = 0; i < got.length; i += 1) if (!want[got[i]]) return 'todo-mismatch';
  }
  return null;
}

/** 待办清单里动词的中文词条键（上移 / 下移靠界面传 move-up / move-down）。 */
export function rebaseActionLabelKeyOf(action: any): string {
  const name = String(action === undefined || action === null ? '' : action);
  if (name === 'move-up') return 'vc.rebase.action.moveUp';
  if (name === 'move-down') return 'vc.rebase.action.moveDown';
  return 'vc.rebase.action.' + name;
}

/** 当前操作状态的词条键；空状态与 clean 都算「没有进行中的操作」。 */
export function rebaseStateLabelKeyOf(state: any): string {
  const name = String(state === undefined || state === null ? '' : state);
  if (name === '' || name === 'clean' || name === 'none') return 'vc.rebase.state.clean';
  if (name === 'cherry-pick') return 'vc.rebase.state.cherryPick';
  return 'vc.rebase.state.' + name;
}

/** 四条写动作在什么状态下可见：只有「没有进行中的操作」时才出现（否则先处理冲突）。 */
export function rebaseVisibleOf(state: any): string[] {
  const name = String(state === undefined || state === null ? '' : state);
  if (name !== '' && name !== 'clean' && name !== 'none') return [];
  return REBASE_WRITE_OPS.map(function (meta) { return meta.id; });
}

/**
 * 生成待办文件的内容。
 * reword 的改写说明放在面板输入里，执行时每个 reword 写一个临时文件，这里生成
 * exec git commit --amend -F "<说明文件>" 这一行；messagePathOf(oid, index) 由执行层提供，
 * 没给就是调用方漏了（明确失败，不能悄悄退化成 pick）。
 * 空待办要给 noop：留空文件 git 会认为「没有可做的事」并中止，不是我们想要的语义。
 */
export function rebaseTodoLinesOf(plan: any, messagePathOf: any): any {
  const rows = plan && Array.isArray(plan.rows) ? plan.rows : [];
  if (rows.length === 0) return { ok: true, lines: ['noop'] };
  const lines: string[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] || {};
    const oid = String(row.oid || '');
    const action = String(row.action || '');
    if (action === 'reword') {
      const msgPath = typeof messagePathOf === 'function' ? messagePathOf(oid, i) : null;
      if (!msgPath) return { ok: false, reason: 'missing-message' };
      lines.push('pick ' + oid);
      lines.push('exec git commit --amend -F "' + String(msgPath).replace(/"/g, '') + '"');
    } else {
      lines.push(action + ' ' + oid);
    }
  }
  return { ok: true, lines: lines };
}

/**
 * 从 git 自己生成的待办里读出「谁吸收谁」的提交对（--autosquash 的只读预演）。
 * git 会把 fixup!/squash!/amend! 开头的提交挪到目标提交后面，所以配对规则就是
 * 「它前面最近的一条 pick 行」；返回结果按待办里的出现顺序排列。
 */
export function rebaseAutosquashPairsOf(todoText: any): any {
  const text = String(todoText === undefined || todoText === null ? '' : todoText);
  const lines = text.split(/\r?\n/);
  const pairs: any[] = [];
  let lastOid: string | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].replace(/^\s+/, '');
    if (line === '' || line.charAt(0) === '#') continue;
    const parts = line.split(/\s+/);
    const verb = parts[0];
    if (verb === 'pick') {
      lastOid = parts[1] || null;
    } else if (verb === 'fixup' || verb === 'squash' || verb === 'amend!') {
      pairs.push({
        oid: parts[1] || null,
        kind: verb === 'amend!' ? 'amend' : verb,
        targetOid: lastOid,
      });
    }
  }
  return { ok: true, pairs: pairs };
}

/** 每个写动作真正要执行的 argv；缺参数时回空数组，让预检先拒（执行层不会再猜一遍）。 */
export function rebaseStepsOf(plan: any): string[][] {
  const p = plan || {};
  const base = p.base ? String(p.base) : '';
  const oldBase = p.oldBase ? String(p.oldBase) : '';
  const newBase = p.newBase ? String(p.newBase) : '';
  const op = String(p.op || '');
  if (op === 'rebase-todo') return base ? [['rebase', '-i', base]] : [];
  if (op === 'rebase-onto') return (oldBase && newBase) ? [['rebase', '--onto', newBase, oldBase]] : [];
  if (op === 'rebase-autosquash') return base ? [['rebase', '-i', '--autosquash', base]] : [];
  if (op === 'rebase-merges') return base ? [['rebase', '-i', '--rebase-merges', base]] : [];
  return [];
}

/** git 版本是否满足最低要求；读不出版本一律当不满足（不冒充能跑）。 */
export function gitVersionAtLeast(version: any, major: number, minor: number): boolean {
  const m = /git version (\d+)\.(\d+)/.exec(String(version === undefined || version === null ? '' : version));
  if (!m) return false;
  const haveMajor = Number(m[1]);
  const haveMinor = Number(m[2]);
  if (haveMajor !== major) return haveMajor > major;
  return haveMinor >= minor;
}

/** 共享协议的源码常量：门禁据此确认界面闭包里拼进来的就是这一份。 */
export const REBASE_OPS_SOURCE = 'rebase-ops/v1: rebase-todo(5.6), rebase-onto(5.7), rebase-autosquash(5.8), rebase-merges(5.10), rebase-state, rebase-window, rebase-onto-range, rebase-autosquash-pairs, rebase-merges-cost, --onto';

