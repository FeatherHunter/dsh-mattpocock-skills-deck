/**
 * src/client/kernel/health-check.ts — 内核模块（#685：「体检」按钮的件数派生与开新会话注入）
 *
 * 契约：本文件为模块真源；构建时去掉行首 export 后拼回 src/client/index.ts，
 * 源码树里只有这一份真源。源码树里只有这一份真源，改这里就够。
 *
 * 三样东西只此一份（界面只按结果渲染，自己不算、不拼、不识别后端）：
 * 1) 件数——游离票的件数（口径见 #678）；
 * 2) 显隐——这颗按钮显不显示（#681 定版：三种情况整颗不渲染）；
 * 3) 注入——按当前后端取体检提示词并开一个新会话。
 * 数据全部来自契约快照与后端声明，不新增宿主电话、不新增取数。
 *
 * 反例：门禁会单独把这一个文件拼成模块跑，所以票身份在这里自足，
 * 不要走别处的 idOf；不要把算不出来（null）读成零（0），两件事必须分开。
 */
// 跨闭包的值引用按仓里规矩写模块级 declare（实现只在拼好的闭包里有一份，类型检查各看各的）。
declare const promptTextFor: any;
declare const newSessionTitleNew: any;
declare const openTextInNewSession: any;
declare const tr: any;
declare const log: any;
// 票身份（与仓库既有口径一致）：effortId + NUL + key；effortId 为空时就是 key。
//   本文件必须自足：门禁会单独把这一个文件拼成模块跑，所以这里不走别处的 idOf。
const healthCheckRowIdOf = function (x: any): string {
  if (!x) return '';
  const effort: string = (x.effortId === undefined || x.effortId === null) ? '' : String(x.effortId);
  let k: string = (x.key === undefined || x.key === null) ? '' : String(x.key);
  if (!k && x.number !== undefined && x.number !== null) k = String(x.number);
  return effort ? effort + '\u0000' + k : k;
};
// 游离票的件数（#678 定版的三条结构事实：未关闭 + 不是地图 + 不在任何地图的子票里）。
//   第三条必须自己查一遍「在不在某张地图的子票里」：客户端手上这份 issues 是扁平的 ——
//   宿主把「地图容器 + 地图下所有子票 + 未挂图的票」拼成一个数组再交给界面，
//   所以挂在地图下的票也躺在 issues 里。只数 issues 会把它们当游离一起算进去。
//   判定口径与件数要求一致：以「在不在 maps[].tickets 里」为准，
//   父票指向已删地图的破链票不在任何地图的子票里，照样算游离。
//   算不出来时返回 null（不是 0）—— 0 会被读成「一张都没有」，两件事必须分得开（#681 定版）。
export const healthCheckCountOf = function (st: any): number | null {
  try {
    const snap: any = st && st.snapshot;
    const issues: any = (snap && Array.isArray(snap.issues)) ? snap.issues : null;
    if (!issues) return null;
    const maps: any[] = Array.isArray(snap.maps) ? snap.maps : [];
    const attached: Record<string, boolean> = {};
    for (let i: number = 0; i < maps.length; i++) {
      const ts: any[] = (maps[i] && maps[i].tickets) || [];
      for (let j: number = 0; j < ts.length; j++) {
        const id: string = healthCheckRowIdOf(ts[j]);
        if (id) attached[id] = true;
      }
    }
    let n: number = 0;
    for (let i: number = 0; i < issues.length; i++) {
      const x: any = issues[i];
      if (!x || String(x.state || '').toUpperCase() === 'CLOSED') continue;
      if (x.type === 'map') continue;
      if ((x.labels || []).some(function (l: any): boolean { return l && l.name === 'wayfinder:map'; })) continue;
      if (attached[healthCheckRowIdOf(x)]) continue;
      n += 1;
    }
    return n;
  } catch (e) { return null; }
};
// 这颗按钮显不显示（#681 定版：三种情况整颗不渲染，第一性原理是「不许点出一颗空按钮」）。
//   ① 没绑定后端 —— 没有后端就没有任何体检科目可注入；
//   ② 工作区还没初始化 —— 还没有远端关联，体检无从谈起（快照的 repository 一项就是那个判据，
//      与面板头部「未关联远端」那枚红章同源）；
//   ③ 当前后端没有声明体检科目 —— 点了只会开一个空会话。
//   三条都只读现成的快照与后端声明，界面不自己造状态、不按后端 id 分支。
export const healthCheckVisible = function (st: any): boolean {
  try {
    if (!st) return false;
    const sel: any = st.selection || (st.snapshot && st.snapshot.selection) || null;
    const backendId: any = sel ? sel.backendId : null;
    if (backendId == null || String(backendId) === '') return false;
    if (!(st.snapshot && st.snapshot.repository)) return false;
    const list: any[] = (st.backendModules && st.backendModules.length) ? st.backendModules
      : ((st.snapshot && Array.isArray(st.snapshot.backendModules)) ? st.snapshot.backendModules : []);
    for (let i: number = 0; i < list.length; i++) {
      const m: any = list[i];
      if (m && String(m.id) === String(backendId) && m.prompts && m.prompts.healthCheck) return true;
    }
    return false;
  } catch (e) { return false; }
};
// 题面：当前后端有几个游离票。算不出来时回 null，由界面自己决定少显示什么（本函数只报事实）。
export const healthCheckSubjectOf = function (st: any): number | null { return healthCheckCountOf(st); };
// 按钮点一下：按当前后端取体检提示词，开一个新会话把它带过去（走页签行「+ 新建需求」同一条路）。
//   记一条常驻日志：用户点一下、插件往会话里写字，成败都要留痕。
//   落点在本文件（内核目录）而不是渲染目录：渲染文件里能写日志的是点名白名单，列表页不在里面。
//   字段只两个短枚举：哪个后端、注入成功还是失败 —— 提示词正文一个字都不记。
export const healthCheckLogEvent: string = 'healthCheck.inject';
export const openHealthCheck = function (st: any): boolean {
  let backend: string = '';
  try {
    const sel: any = st && (st.selection || (st.snapshot && st.snapshot.selection));
    backend = (sel && sel.backendId != null) ? String(sel.backendId) : '';
  } catch (eSel) { backend = ''; }
  let text: string = '';
  // 取不到（渲染抛错）就算没注成。注意「当前后端没声明体检科目」不是失败 —— 那种情况会被替换掉，
  //   注入给会话的仍是完整的体检总纲，只是少了后端那一节；
  //   而且界面那颗按钮在「后端没有科目」时整颗不渲染，根本点不到。
  let injected: boolean = false;
  try { text = promptTextFor(st, 'healthCheck'); injected = !!text; } catch (e) { injected = false; }
  // 标题给占位，不再拿悬浮提示那一整句当标题：那句既不是占位也不是编号档，
  //   命名守护收不了它，会话标题也就一直是一句说明书。
  let title: any = null;
  try { title = newSessionTitleNew('health'); } catch (eT) { title = null; }
  try { openTextInNewSession(st, text, title || tr('list.healthCheckTitle')); } catch (eOpen) {}
  try {
    log('info', 'healthCheck.inject', { backend: backend, outcome: (injected ? 'ok' : 'fail') });
  } catch (eL) {}
  return injected;
};
