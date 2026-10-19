// work-path-store.ts —— 工作路线的落盘存储（#1261 落地；规格见 #1259 第 1–2 条）。
//
// 这份存储只认「(工作区, 会话, 票)」三元组：内存里按工作区根散列分账，每账下按会话
// 分页，每页下按票键去重（同一会话同一票后来居上，只留最新一条）。内存是真源，
// 落盘是它的整份镜像：记一笔就把整账写回磁盘，写失败也不回滚内存——
// 读口（snapshot）只读内存不读盘，所以下一次写入会按内存真源把整份重写一遍，
// 盘上缺的、旧的都会被这次写入补齐。
//
// 本票（#1261）只做最小可用的读写：其余落盘可信（读-合并-写、临时文件、读回校验、
// 2MB 上限、30 天磁盘清理、换后端改名、日志事件、隐私白名单与 ADR）归 #1083。
// 文件头把归属写死，后续票动写路径时先读这段注释。
//
// 这份文件零 Node 导入：读写目录的能力全部由调用方以函数形式注入
// （readFile/writeFile/mkdir），路径用斜杠拼接——Node 的文件系统在 Windows 上
// 同样认斜杠，所以不需要 path 模块。时钟也注入（now），门禁可以用固定时钟
// 把落盘内容钉死。

/** 读出口只读的账页形状（深拷贝，调用方随便改都不会污染内存真源）。 */
export interface WorkPathLedger {
  v: 3;
  at: number;
  backend: string;
  workers: Array<{
    session: string;
    label: string;
    labelAt: number;
    entries: Array<{
      ticketKey: string;
      effortId: string;
      title: string;
      action: string;
      actionAt: number;
      source: string;
    }>;
  }>;
}

import { chainRootHash } from '../../shared/refresh/chain.js';

/** 记一笔的输入：调用方（工具壳）从回执里能拿到的就是这些。 */
export interface WorkPathNoteInput {
  /** 工作区键（workspace.key）：落到哪一份文件由本存储按 chainRootHash 算，不由调用方拼。 */
  rootKey: string;
  /** 当前会话 id（原始值只进内存与磁盘，绝不进回执）。 */
  sessionId: string;
  /** 会话当时的标题快照：空串表示这次没带来标题，不覆盖旧的。 */
  sessionLabel?: string;
  /** 哪条后端链：github / markdown 等；空串表示调用方没说。 */
  backend?: string;
  ticketKey: string;
  effortId?: string;
  title?: string;
  /** 这一次的动作类别：report（上报）等。 */
  action: string;
  /** 这条记录的来源：reported（人/AI 上报）等。 */
  source: string;
}

/** 记一笔的结果：成功带这条票与本会话条数，失败带原因（壳会把原因写进回执备注）。 */
export type WorkPathNoteResult =
  | { ok: true; ticketKey: string; count: number }
  | { ok: false; reason: string };

export interface WorkPathStoreDeps {
  /** 用户主目录：文件落在 <home>/.dsh/mattskillsdeck/work-path/<根散列>.json。 */
  homeDir?: string;
  now?: () => number;
  /** 读整份文件：文件不存在时回 null（不是报错）。 */
  readFile?: (path: string) => Promise<string | null>;
  writeFile?: (path: string, text: string) => Promise<void>;
  /** 建目录（要能建多层，相当于 mkdir -p）。 */
  mkdir?: (dir: string) => Promise<void>;
}

interface WorkerPage {
  label: string;
  labelAt: number;
  entries: Map<string, { ticketKey: string; effortId: string; title: string; action: string; actionAt: number; source: string }>;
}

interface RootLedger {
  backend: string;
  workers: Map<string, WorkerPage>;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

export function createWorkPathStore(deps?: WorkPathStoreDeps) {
  const d = deps || {};
  const homeDir = typeof d.homeDir === 'string' ? d.homeDir : '';
  const now = typeof d.now === 'function' ? d.now : Date.now;
  const readFile = typeof d.readFile === 'function' ? d.readFile : async function () { return null; };
  const writeFile = typeof d.writeFile === 'function' ? d.writeFile : async function () { /* 无写能力时静默跳过，调用方负责报错 */ };
  const mkdir = typeof d.mkdir === 'function' ? d.mkdir : async function () { /* 同上 */ };

  // 内存真源：key 是工作区根散列（调用方给工作区键，这里按 chainRootHash 换算）。
  // seen 记下「已经从盘上恢复过」的账，同一账第二次记直接走内存，不再读盘。
  const ledgers = new Map<string, RootLedger>();
  const seen = new Set<string>();

  function hashOf(rootKey: string): string {
    try {
      return String(chainRootHash(rootKey));
    } catch {
      return '';
    }
  }

  function filePathFor(rootKey: string): string {
    return homeDir + '/.dsh/mattskillsdeck/work-path/' + hashOf(rootKey) + '.json';
  }

  function dirOf(filePath: string): string {
    const i = filePath.lastIndexOf('/');
    return i < 0 ? '.' : filePath.slice(0, i);
  }

  function emptyLedger(): RootLedger {
    return { backend: '', workers: new Map() };
  }

  // 盘上形状（v3）→ 内存形状：字段缺了就按空补，版本不对就整账不要。
  // 坏文件（解析失败、版本不对、结构不认）一律按空账处理，不抛错：
  // 下一次成功写入会按内存真源重写整份，坏文件自然被覆盖掉。
  function loadFromText(text: string): RootLedger {
    const ledger = emptyLedger();
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      return ledger;
    }
    if (!parsed || typeof parsed !== 'object' || parsed.v !== 3 || !Array.isArray(parsed.workers)) return ledger;
    if (typeof parsed.backend === 'string') ledger.backend = parsed.backend;
    for (const w of parsed.workers) {
      if (!w || typeof w !== 'object' || !isNonEmptyString(w.session) || !Array.isArray(w.entries)) continue;
      const page: WorkerPage = {
        label: typeof w.label === 'string' ? w.label : '',
        labelAt: typeof w.labelAt === 'number' ? w.labelAt : 0,
        entries: new Map(),
      };
      for (const e of w.entries) {
        if (!e || typeof e !== 'object' || !isNonEmptyString(e.ticketKey)) continue;
        page.entries.set(e.ticketKey, {
          ticketKey: e.ticketKey,
          effortId: typeof e.effortId === 'string' ? e.effortId : '',
          title: typeof e.title === 'string' ? e.title : '',
          action: typeof e.action === 'string' ? e.action : '',
          actionAt: typeof e.actionAt === 'number' ? e.actionAt : 0,
          source: typeof e.source === 'string' ? e.source : '',
        });
      }
      ledger.workers.set(w.session, page);
    }
    return ledger;
  }

  function toText(ledger: RootLedger, at: number): string {
    const out: WorkPathLedger = {
      v: 3,
      at: at,
      backend: ledger.backend,
      workers: [],
    };
    for (const [session, page] of ledger.workers) {
      const entries = [];
      for (const row of page.entries.values()) {
        entries.push({
          ticketKey: row.ticketKey,
          effortId: row.effortId,
          title: row.title,
          action: row.action,
          actionAt: row.actionAt,
          source: row.source,
        });
      }
      out.workers.push({ session: session, label: page.label, labelAt: page.labelAt, entries: entries });
    }
    return JSON.stringify(out);
  }

  async function ensureLoaded(rootHash: string): Promise<void> {
    if (seen.has(rootHash)) return;
    seen.add(rootHash);
    if (!ledgers.has(rootHash)) ledgers.set(rootHash, emptyLedger());
    let text: string | null = null;
    try {
      text = await readFile(filePathFor(rootHash));
    } catch {
      text = null;
    }
    if (typeof text === 'string' && text.length > 0) {
      ledgers.set(rootHash, loadFromText(text));
    }
  }

  // 记一笔：先合进内存，再整账写回磁盘。写失败时内存不动（已经是真源），
  // 只把 ok:false 与原因交还给调用方，由调用方写进回执备注。
  async function note(input: WorkPathNoteInput): Promise<WorkPathNoteResult> {
    const rootKey = input ? input.rootKey : '';
    const rootHash = isNonEmptyString(rootKey) ? hashOf(rootKey) : '';
    const sessionId = input ? input.sessionId : '';
    const ticketKey = input ? input.ticketKey : '';
    if (rootHash === '') return { ok: false, reason: 'no-root-hash' };
    if (!isNonEmptyString(sessionId)) return { ok: false, reason: 'no-session' };
    if (!isNonEmptyString(ticketKey)) return { ok: false, reason: 'no-ticket' };
    await ensureLoaded(rootHash);
    const ledger = ledgers.get(rootHash) || emptyLedger();
    ledgers.set(rootHash, ledger);
    const at = now();
    const backend = input && typeof input.backend === 'string' ? input.backend : '';
    if (backend !== '') ledger.backend = backend;
    let page = ledger.workers.get(sessionId);
    if (!page) {
      page = { label: '', labelAt: 0, entries: new Map() };
      ledger.workers.set(sessionId, page);
    }
    const label = input && typeof input.sessionLabel === 'string' ? input.sessionLabel : '';
    if (label !== '') {
      page.label = label;
      page.labelAt = at;
    }
    const prev = page.entries.get(ticketKey);
    page.entries.set(ticketKey, {
      ticketKey: ticketKey,
      effortId: input && typeof input.effortId === 'string' ? input.effortId : (prev ? prev.effortId : ''),
      title: input && typeof input.title === 'string' ? input.title : (prev ? prev.title : ''),
      action: input && typeof input.action === 'string' ? input.action : (prev ? prev.action : ''),
      actionAt: at,
      source: input && typeof input.source === 'string' ? input.source : (prev ? prev.source : ''),
    });
    try {
      await mkdir(dirOf(filePathFor(rootKey)));
      await writeFile(filePathFor(rootKey), toText(ledger, at));
    } catch {
      return { ok: false, reason: 'write-failed' };
    }
    return { ok: true, ticketKey: ticketKey, count: page.entries.size };
  }

  // 快照：只读内存，不读盘（重启后恢复归 #1083；调用方是读出口）。
  // 返回深拷贝——调用方改了返回值也不会污染内存真源。
  function snapshot(rootKey: string): WorkPathLedger | null {
    if (!isNonEmptyString(rootKey)) return null;
    const ledger = ledgers.get(hashOf(rootKey));
    if (!ledger) return null;
    const text = toText(ledger, now());
    return JSON.parse(text) as WorkPathLedger;
  }

  return { note: note, snapshot: snapshot, filePathFor: filePathFor };
}

export type WorkPathStore = ReturnType<typeof createWorkPathStore>;
