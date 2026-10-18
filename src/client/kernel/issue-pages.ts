/**
 * src/client/kernel/issue-pages.ts — 内核模块（#690 新加）：历史票的页数据
 *
 * 契约：本文件为模块真源；构建时去掉行首 export 后拼回 src/client/index.js，
 * 一源两物、src 零复制。同名 .js 是构建产物，改这里。
 *
 * 它解决什么：已关闭的票在首屏只装最近一百条；用户翻历史时，界面向后端按页要更多，
 * 这一份就是要回来的那些页在客户端住的地方。规格见 677 完整性规格第 7.2 节，
 * 四条硬要求逐条落在这里：一是按工作区加后端加仓库加工作单元加视图加筛选分桶存放；
 * 二是按票身份去重，同号票以后到的那份为准；三是静默刷新时只更新内容、不清空已加载的页，
 * 所以本模块根本不去动快照：桶挂在 st.issuePages 上，与快照是两份东西；
 * 四是内存里最多留 10 页，超出从最旧的页开始丢，并把要重新加载告诉界面。
 * 不落磁盘：历史随时可以再取，多留一份真源只会带来哪份对的问题。
 *
 * 页请求带什么、不带什么（这条是刻意的，别顺手改）：只带已关闭状态与页大小、游标，
 * 不带标签——后端的标签筛是都要有，而界面上那些标签是多选任一，两套语义不一样；
 * 下推过去会筛掉用户其实想看的行。标签照样在客户端筛。
 * 桶键里仍然带上当前筛选：换了筛选就换一个桶，免得两套筛选共用同一份页数据。
 *
 * 反例：不要让视图渲染建桶（渲染只读）；不要把上限调大到不丢页，内存会一直涨。
 */
// 跨闭包的值引用按仓里规矩写模块级 declare（实现只在拼好的闭包里有一份，类型检查各看各的）。
declare const idOf: any;
declare const emit: any;
declare const fetchIssuesPage: any;
/** 内存里最多留几页（规格第 7.2 节：约 500~2000 行）；超了从最旧的页开始丢。 */
export const ISSUE_PAGE_MAX: number = 10;
/** 一次要几行（与契约「分页契约」的缺省值同一个数）。 */
export const ISSUE_PAGE_LIMIT: number = 50;
/** 页行的身份：工作单元 + 编号（与列表其它地方同一把钥匙）。 */
const issuePageRowId = function (x: any): string { try { return idOf(x); } catch (e) { return ''; } };
/** 当前筛选指纹：状态筛选 + 标签筛选（标签排序后拼，点选顺序不同算同一个桶）。 */
export const issuePageFilterOf = function (st: any): string {
  const stf: string = String((st && st.stateFilter) || 'all');
  const labels: string[] = ((st && st.lblFilters) || []).slice().map(String).sort();
  const effs: string[] = ((st && st.effFilters) || []).slice().map(String).sort();
  return stf + '|' + labels.join(',') + '|' + effs.join(',');
};
/** 桶键：工作区 + 后端 + 仓库 + 视图 + 筛选指纹。切工作区或切后端等于换一把钥匙，
 * 旧桶的数据不再显示（但也不主动删：用户切回去时手上还有已经翻过的页）。 */
export const issuePageKeyOf = function (st: any, view: any): string {
  const snap: any = (st && st.snapshot) || {};
  const sel: any = (st && st.selection) || (snap && snap.selection) || {};
  const repo: any = (snap && snap.repository) || {};
  const ws: string = String((st && st.workspaceRoot) || (st && st.cwd) || '');
  const backendId: string = String((sel && sel.backendId) || (repo && repo.backend) || '');
  const repoId: string = String((repo && (repo.refId || repo.name)) || '');
  return [ws, backendId, repoId, String(view || 'list'), issuePageFilterOf(st)].join('|');
};
/** 读桶：只读，不建（视图渲染时会调它，渲染不该产生状态）。 */
export const issuePageBucketRead = function (st: any, view: any): any {
  try {
    const pages: any = st && st.issuePages;
    if (!pages || typeof pages !== 'object') return null;
    return pages[issuePageKeyOf(st, view)] || null;
  } catch (e) { return null; }
};
/** 取桶：没有就建一个（写路径才用）。形状简单到可以一眼看完 —— 页数组就是全部真源。 */
export const issuePageBucketOf = function (st: any, view: any): any {
  const v: string = view || 'list';
  if (!st) return null;
  if (!st.issuePages || typeof st.issuePages !== 'object') st.issuePages = {};
  const key: string = issuePageKeyOf(st, v);
  let b: any = st.issuePages[key];
  if (!b) {
    b = { key: key, pages: [], nextCursor: '', total: null, loading: false, notice: '', error: null, trimmed: false, at: 0 };
    st.issuePages[key] = b;
  }
  return b;
};
/** 把页数组摊成行：按身份去重，同号票以「后到的那份」为准；顺序按第一次出现的位置（页序）。 */
const mergedPageRows = function (b: any): any[] {
  const out: any[] = [];
  if (!b || !Array.isArray(b.pages)) return out;
  const at: Record<string, number> = {};
  for (let i: number = 0; i < b.pages.length; i++) {
    const items: any[] = (b.pages[i] && b.pages[i].items) || [];
    for (let j: number = 0; j < items.length; j++) {
      const r: any = items[j];
      const id: string = issuePageRowId(r);
      if (!id) continue;
      if (at[id] === undefined) { at[id] = out.length; out.push(r); } else { out[at[id]] = r; }
    }
  }
  return out;
};
/** 池子里所有票的身份（快照的 issues 加每张地图的子票）—— 用来把页数据里那些「池子里已经有」的行挑出去。 */
const poolIndexById = function (st: any): Record<string, any> {
  const idx: Record<string, any> = {};
  try {
    const snap: any = (st && st.snapshot) || {};
    const put = function (x: any): void { const id: string = issuePageRowId(x); if (id) idx[id] = x; };
    (Array.isArray(snap.issues) ? snap.issues : []).forEach(put);
    (Array.isArray(snap.maps) ? snap.maps : []).forEach(function (m: any): void { ((m && m.tickets) || []).forEach(put); });
  } catch (e) { /* 坏数据当成空池子：页数据照常显示 */ }
  return idx;
};
/** 给列表拼接用的行：页数据里、**池子里没有的**那些（池子里有的那一份由池子自己画，别重复）。
 * 这就是「静默刷新之后已加载的页仍在」的落点：刷新只换快照，这里读的页桶一个字没动。 */
export const issuePageRowsOf = function (st: any, view: any): any[] {
  const b: any = issuePageBucketRead(st, view);
  if (!b || !b.pages.length) return [];
  const pool: Record<string, any> = poolIndexById(st);
  const out: any[] = [];
  const rows: any[] = mergedPageRows(b);
  for (let i: number = 0; i < rows.length; i++) {
    const id: string = issuePageRowId(rows[i]);
    if (pool[id]) continue;
    out.push(rows[i]);
  }
  return out;
};
/** 「已加载多少张 / 一共多少张」：x 用页数据自己的行数（含池子里那份，界面那边会再加上池子里的行数），
 * n 用后端这次给的 total（还没有回包时为 null，界面据此退回手上的行数）。 */
export const issuePageStatOf = function (st: any, view: any): any {
  const b: any = issuePageBucketRead(st, view);
  if (!b) return { loaded: 0, total: null, pages: 0, hasMore: false, loading: false, notice: '', error: null, trimmed: false };
  return {
    loaded: mergedPageRows(b).length,
    total: (typeof b.total === 'number' && b.total >= 0) ? b.total : null,
    pages: b.pages.length,
    hasMore: !!b.nextCursor,
    loading: b.loading === true,
    notice: String(b.notice || ''),
    error: b.error || null,
    trimmed: b.trimmed === true,
  };
};
/**
 * 取页。两种叫法：
 * loadIssuePage(st) —— 备好第一页（已经有页就什么都不做，直接返回）；
 * loadIssuePage(st, {next:true}) —— 顺着游标取下一页（没有下一页就直接返回）。
 * 回包 {ok} 或 {ok:false, error}。界面只看桶里的状态，不必自己接回包。
 *
 * 游标失效（后端回 not-found / parse）：把桶清空、丢掉游标、重取第一页，并把已从最近的一页重新开始
 * 这件事记在 notice 上给界面说 —— 失效不是历史到头了，要认得出、要说出来。
 * 后端说做不到（unsupported）：不重试、不重取，notice 记 noweb，界面显示在网页上看全部。
 */
export const loadIssuePage = function (st: any, opts: any): any {
  const o: any = opts || {};
  const view: string = o.view || 'list';
  const b: any = issuePageBucketOf(st, view);
  if (!b) return Promise.resolve({ ok: false, error: { kind: 'env', message: 'no workspace state' } });
  if (b.loading) return Promise.resolve({ ok: false, error: { kind: 'throttle', message: 'loading' } });
  const wantNext: boolean = o.next === true;
  if (!wantNext && b.pages.length) return Promise.resolve({ ok: true, cached: true });
  // 后端已经答过「做不到」：不再反复撞。o.force 是给用户明确再点一次留的出口，正常触发点都不带它。
  if (!wantNext && b.notice === 'noweb' && o.force !== true) return Promise.resolve({ ok: false, error: b.error || { kind: 'unsupported', message: 'unsupported: listPage' } });
  const cursor: string = wantNext ? String(b.nextCursor || '') : '';
  if (wantNext && !cursor) return Promise.resolve({ ok: true, done: true });
  // 工作单元只有一个被选中时把它作为寻址范围带上去（多选了就不带：后端一条请求只能对应一个范围，
  // 多出来的那些行由界面的 effort 筛选挡住，行为与列表其它地方一致）。
  const effs: any[] = (st && st.effFilters) || [];
  const effortId: string = effs.length === 1 ? String(effs[0]) : '';
  b.loading = true;
  b.error = null;
  b.notice = 'loading';
  emit(st);
  const args: any = { state: 'closed', cursor: cursor, limit: ISSUE_PAGE_LIMIT, effortId: effortId, backendId: '' };
  return fetchIssuesPage(st, args).then(function (res: any): any {
    b.loading = false;
    if (res && res.ok) {
      b.pages.push({ cursor: cursor, items: res.items || [], at: Date.now() });
      b.nextCursor = res.nextCursor || '';
      b.total = (typeof res.total === 'number') ? res.total : null;
      b.notice = '';
      // 上限：最多留 10 页，超了从最旧的页开始丢（丢的是最早取回来的那一页，
      // 界面因此知道再往上滚要重新加载）。
      while (b.pages.length > ISSUE_PAGE_MAX) { b.pages.shift(); b.trimmed = true; }
      b.at = Date.now();
      emit(st);
      return { ok: true, items: res.items || [], nextCursor: b.nextCursor, total: b.total };
    }
    const err: any = (res && res.error) || { kind: 'network', message: 'no response' };
    const kind: string = String(err.kind || '');
    // 游标失效：认得出、丢游标、重取第一页。重取的那一次没有游标，所以不会再走回这一支（不会打转）。
    if (cursor && (kind === 'not-found' || kind === 'parse')) {
      b.pages = [];
      b.nextCursor = '';
      b.total = null;
      b.trimmed = false;
      b.notice = 'stale';
      b.error = err;
      emit(st);
      return loadIssuePage(st, { view: view }).then(function (r: any): any {
        // 重取那一次会把 notice 先清成 loading；取回来之后把位置失效已重新开始补回去，
        // 界面才说得出这一句（它是这一支的结论，不是中间态）。
        if (r && r.ok) { b.notice = 'stale'; emit(st); }
        return r;
      });
    }
    b.notice = (kind === 'unsupported') ? 'noweb' : 'fail';
    b.error = err;
    emit(st);
    return { ok: false, error: err };
  }).catch(function (e: any): any {
    b.loading = false;
    b.notice = 'fail';
    b.error = { kind: 'network', message: String((e && e.message) || e) };
    emit(st);
    return { ok: false, error: b.error };
  });
};
