// 临时行为对拍脚本（#1247 task-6 自验用，验完即删）：
// 同一份脚本跑两遍 —— 不带钩子（加载 .js）与带 scripts/ts-hook.mjs（加载同名 .ts），
// 把 11 个文件的关键导出行为逐项记成 JSON，逐字对拍。
// 确定性：Date.now 冻住；不用真实磁盘/网络/定时器；磁盘相关走内存桩。
const FROZEN = 1720000000000;
Date.now = () => FROZEN;

import { formatLogFileName, createLogStore, LOG_DIR_NAME, LOG_SWITCH_FILE, LOG_DEBOUNCE_MS } from './src/host/logStore.js';
import { createMapBody } from './src/host/mapBody.js';
import { createMapTickets } from './src/host/mapTickets.js';
import { createNamingGuardian } from './src/host/namingGuardian.js';
import { createPickerShell } from './src/host/pickerShell.js';
import { createRpcChannel, DSW_RPC_CHANNEL, DSW_RPC_ROUTE, DSW_ENDPOINT_PATTERN } from './src/host/rpcChannel.js';
import { createRunningMarkers, RUNNING_MARKERS_SOURCE } from './src/host/runningMarkers.js';
import { createSessionLifecycle } from './src/host/sessionLifecycle.js';
import { createSettingsPhones, isSettingsAbsenceError } from './src/host/settingsPhones.js';
import { createSkillDoc } from './src/host/skillDoc.js';
import { createSkillProbe } from './src/host/skillProbe.js';

const out = {};
const rec = (k, v) => { out[k] = v; };
const memfs = (seed) => {
  const files = new Map(Object.entries(seed || {}));
  const writes = [];
  return {
    files, writes,
    resolve: async (p) => String(p),
    readText: async (t) => (files.has(String(t)) ? files.get(String(t)) : ''),
    writeText: async (t, x) => { writes.push({ target: String(t), text: String(x) }); files.set(String(t), String(x)); },
    mkdir: async () => {},
  };
};

// ---------- logStore ----------
rec('log.consts', { dir: LOG_DIR_NAME, switchFile: LOG_SWITCH_FILE, debounceMs: LOG_DEBOUNCE_MS });
rec('log.fmt', formatLogFileName(new Date(FROZEN)));
{
  const fs = memfs();
  const store = createLogStore({ fs, timer: { timeout: () => 0 }, getCacheDir: async () => '/cache', getPlatform: async () => ({}), DEFAULT_CWD: '/w', logCtx: null });
  rec('log.keys', Object.keys(store).sort());
  rec('log.enabledInfo', store.isEnabled('info'));
  rec('log.enabledError', store.isEnabled('error'));
  rec('log.batch', await store.handleLogBatch({ entries: [{ level: 'info', event: 'e1', fields: { a: 1 } }, { level: 'error', event: 'e2' }] }));
  await store.flushNow();
  rec('log.writes', fs.writes);
  rec('log.dropped', store.getDroppedCount());
  rec('log.setSwitch', await store.setSwitch(true, 5));
  const fs2 = memfs({ '/cache/log-switch.json': '{"enabled":true,"sampleRate":5}' });
  const store2 = createLogStore({ fs: fs2, timer: { timeout: () => 0 }, getCacheDir: async () => '/cache', getPlatform: async () => ({}), DEFAULT_CWD: '/w', logCtx: null });
  rec('log.loadSwitch', await store2.loadSwitch());
}

// ---------- mapBody（纯函数） ----------
{
  const b = createMapBody();
  rec('body.keys', Object.keys(b).sort());
  rec('body.normBomLiteral', b.normalizeBody('﻿a\\nb\\nc'));
  rec('body.normReal', b.normalizeBody('x\ny\nz'));
  const sample = '## Destination\nship it\nxxx##Notes\nn1\n## Decisions so far\n- [T](http://t/u) - g1\n- **B2**：g2\n## Not yet specified\n- f1\n<!--x-->\n## Out of scope\n- o1';
  rec('body.parse', b.parseMapBody(sample));
  rec('body.progress', [b.parseProgress('## 进度：90%'), b.parseProgress('Progress: 12%'), b.parseProgress('nothing'), b.parseProgress('进度：150%'), b.parseProgress(null)]);
  rec('body.ticket', b.mapTicket({ number: 7, title: 'T', labels: { nodes: [{ name: 'wayfinder:task' }, { name: 'bug' }] }, state: 'CLOSED', assignees: { nodes: [{ login: 'u1' }] }, blockedBy: { nodes: [{ number: 1 }] }, blocking: { nodes: [] }, url: 'http://u', body: '## 进度：30%', author: { login: 'a', name: 'n', avatarUrl: 'av' } }));
}

// ---------- pickerShell ----------
{
  const fired = [];
  const sh = createPickerShell({ DEFAULT_CWD: '/w', getPlatform: async () => null, logCtx: { fire: (...a) => fired.push(a) } });
  rec('picker.keys', Object.keys(sh).sort());
  rec('picker.openNoCwd', await sh.handleOpenFolder({}));
  rec('picker.openNoPlat', await sh.handleOpenFolder({ cwd: '/w' }));
  rec('picker.pickDir', await sh.handlePickDirectory({}));
  rec('picker.pickFile', await sh.handlePickFile({}));
  rec('picker.openPathEmpty', await sh.handleOpenPath({}));
  rec('picker.openPathNoPlat', await sh.handleOpenPath({ path: 'x' }));
}

// ---------- runningMarkers ----------
{
  const P = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'REBASE_HEAD'];
  rec('markers.source', RUNNING_MARKERS_SOURCE);
  const mk = (fsMap, probeMap, detail) => createRunningMarkers({
    existsViaFs: async (p) => { const k = String(p).split('/').pop(); if (fsMap[k] === 'throw') throw new Error('fs-boom'); return fsMap[k]; },
    runProbe: async (rel) => probeMap[rel],
    paths: P,
    ...(detail === undefined ? {} : { getFsDetail: () => detail }),
  });
  rec('markers.allFs', await mk({ MERGE_HEAD: true, CHERRY_PICK_HEAD: false, REVERT_HEAD: false, REBASE_HEAD: true }, {}).read('/g/', null));
  rec('markers.fsThrowGitMixed', await mk({ MERGE_HEAD: 'throw', CHERRY_PICK_HEAD: 'throw', REVERT_HEAD: 'throw', REBASE_HEAD: 'throw' }, { MERGE_HEAD: true, CHERRY_PICK_HEAD: false, REVERT_HEAD: null, REBASE_HEAD: null }).read('/g', null));
  rec('markers.bothBlind', await mk({ MERGE_HEAD: 'throw', CHERRY_PICK_HEAD: 'throw', REVERT_HEAD: 'throw', REBASE_HEAD: 'throw' }, {}).read('/g', null));
  rec('markers.bothBlindDetail', await mk({ MERGE_HEAD: 'throw', CHERRY_PICK_HEAD: 'throw', REVERT_HEAD: 'throw', REBASE_HEAD: 'throw' }, {}, 'detail-xyz').read('/g', null));
  rec('markers.emptyPaths', await createRunningMarkers({ existsViaFs: async () => true, runProbe: async () => true, paths: [] }).read('/g', null));
}

// ---------- rpcChannel ----------
{
  rec('rpc.consts', { ch: DSW_RPC_CHANNEL, route: DSW_RPC_ROUTE, pattern: DSW_ENDPOINT_PATTERN.source });
  const fired = [];
  const noConn = createRpcChannel({ ctx: { get: () => undefined }, handlers: new Map(), fireLog: (...a) => fired.push(a), dispatchMeta: async () => null });
  rec('rpc.noConn', { ...noConn, fired });
  let captured = null;
  const handlers = new Map([
    ['wf.echo', async (p) => ({ ok: true, echo: p })],
    ['wf.boom', async () => { throw new Error('kaput'); }],
    ['wf.empty', async () => undefined],
  ]);
  const okReg = createRpcChannel({ ctx: { get: () => ({ fetch: { register: (arg) => { captured = arg; return () => {}; } } }) }, handlers, fireLog: () => {}, dispatchMeta: async () => ({ shortArgHash: () => 'h', dispatchErrorKind: () => 'internal' }) });
  rec('rpc.reg', { ok: okReg.ok, path: okReg.path, methods: captured.methods, body: captured.requestBody });
  const call = async (method, body, url) => {
    const init = { method, headers: { 'content-type': 'application/json' } };
    if (typeof body === 'string') init.body = body; else if (body !== undefined) init.body = JSON.stringify(body);
    const r = await captured.fetch(new Request(url || ('https://h' + DSW_RPC_ROUTE), init));
    return { status: r.status, body: await r.text() };
  };
  const env = (method, payload, rpcId) => ({ type: 'client-request', rpcId: rpcId === undefined ? 'r1' : rpcId, payload: { method, payload } });
  rec('rpc.get', await call('GET'));
  rec('rpc.badJson', await call('POST', '{oops'));
  rec('rpc.unknown', await call('POST', env('wf.nope', {})));
  rec('rpc.echo', await call('POST', env('wf.echo', { a: 1 })));
  rec('rpc.boom', await call('POST', env('wf.boom', {})));
  rec('rpc.empty', await call('POST', env('wf.empty', {})));
  rec('rpc.badRpcId', await call('POST', env('wf.echo', {}, 'bad id!')));
  rec('rpc.badEndpoint', await call('POST', env('bad name!', {})));
  rec('rpc.wrongPath', await call('POST', env('wf.echo', {}), 'https://h/api/other'));
}

// ---------- sessionLifecycle ----------
{
  // 注意：handleCwd 里 sessions 为 null 会直接抛（`null.get`），只有 undefined 才走 no-service；
  // 这是原逻辑，探针照实走 undefined 那条可达分支，不替它补行为。
  const lc = createSessionLifecycle({ ctx: { get: () => undefined }, DEFAULT_CWD: '/w', errText: (e) => String((e && e.message) || e), getDetectionService: async () => null, getTrackerRegistry: async () => null, getPlatform: async () => ({}), canonicalKey: async (c) => String(c), logCtx: null });
  rec('lc.keys', Object.keys(lc).sort());
  rec('lc.ping', await lc.handlePing());
  rec('lc.cwdNoSid', await lc.handleCwd({}));
  rec('lc.cwdNoSvc', await lc.handleCwd({ sessionId: 's' }));
  rec('lc.selectEarly', await lc.selectEarly({ cwd: '/w' }));
  rec('lc.isComposer', [{ backendId: 'local-md' }, { backendId: 'github' }, { backendId: 'other' }, { backendId: '' }, {}, null, undefined].map((s) => lc.isComposerSelection(s)));
}

// ---------- settingsPhones ----------
{
  rec('set.absence', [null, {}, { code: 'ENOENT' }, { message: 'xx ENOENT yy' }, { message: 'cannot read X not found' }, new Error('boom')].map((e) => isSettingsAbsenceError(e)));
  const sp = createSettingsPhones({});
  rec('set.keys', Object.keys(sp).sort());
  const noPlat = createSettingsPhones({ logCtx: null });
  rec('set.noHome', await noPlat.handleGetSettings());
  rec('set.noReader', await createSettingsPhones({ getPlatform: async () => ({ getHome: async () => '/h' }), logCtx: null }).handleGetSettings());
  const mem = createSettingsPhones({ getPlatform: async () => ({ getHome: async () => '/h' }), readLocalSettings: async () => ({ ok: true, value: { a: 1 }, warnings: ['w'], readonly: false, from: 'yaml' }), writeLocalSettings: async () => ({ ok: true, from: 'yaml', warnings: [] }), logCtx: null });
  rec('set.getOk', await mem.handleGetSettings());
  rec('set.setOk', await mem.handleSetSettings({ value: { a: 2 } }));
  rec('set.setNull', await mem.handleSetSettings({ value: null }));
  const throwing = createSettingsPhones({ getPlatform: async () => ({ getHome: async () => '/h' }), readLocalSettings: async () => { throw new Error('disk-busy'); }, logCtx: null });
  rec('set.getThrow', await throwing.handleGetSettings());
}

// ---------- skillDoc ----------
{
  const d = createSkillDoc({});
  rec('doc.keys', Object.keys(d).sort());
  rec('doc.invalid', [await d.readDoc({}), await d.readDoc({ name: '' }), await d.readDoc({ name: 'a/b' }), await d.readDoc({ name: 'x'.repeat(65) }), await d.readDoc({ name: 'no-such-skill-xyz-123' })]);
}

// ---------- skillProbe ----------
{
  const sp = createSkillProbe({ ctx: { get: () => null }, getPlatform: async () => null, logCtx: null });
  rec('probe.keys', Object.keys(sp).sort());
  const seq = [];
  seq.push(await sp.probeSkill('demo', 'zh', '/w'));
  seq.push(await sp.probeSkill('demo', 'zh', '/w'));
  seq.push(await sp.probeSkill('demo-en', 'en', '/w'));
  rec('probe.seq', seq);
  rec('probe.invalidate', await sp.invalidateSkillProbeCaches());
  rec('probe.afterInvalidate', await sp.probeSkill('demo', 'zh', '/w'));
}

// ---------- mapTickets ----------
{
  const lc2 = createSessionLifecycle({ ctx: { get: () => undefined }, DEFAULT_CWD: '', errText: (e) => String((e && e.message) || e), getDetectionService: async () => null, getTrackerRegistry: async () => null, getPlatform: async () => ({}), canonicalKey: async (c) => String(c), logCtx: null });
  const tracker = { listSubIssues: async () => ({ ok: true, data: { items: [{ number: 3, title: 'T3', labels: { nodes: [] }, state: 'OPEN', assignees: { nodes: [] }, blockedBy: { nodes: [] }, blocking: { nodes: [] }, url: 'u', body: null, author: null }], total: 1, fetched: 1 } }) };
  const mkT = (sel) => createMapTickets({ canonicalKey: async (c) => String(c), selectEarly: async () => sel, isComposerSelection: (s) => lc2.isComposerSelection(s), getTrackerRegistry: async () => ({ get: () => tracker, describe: () => null }), getPlatform: async () => ({}), ctx: { get: () => null }, DEFAULT_CWD: '', logCtx: null, groupTickets: null, getMapBody: async () => null, detectionExec: async () => { throw new Error('no-exec'); } });
  rec('tickets.keys', Object.keys(mkT({ backendId: 'github' })).sort());
  rec('tickets.noCwd', await mkT({ backendId: 'github' }).handleMapTickets({}));
  rec('tickets.noKey', await mkT({ backendId: 'github' }).handleMapTickets({ cwd: '/w' }));
  rec('tickets.unsupported', await mkT({ backendId: 'github' }).handleMapTickets({ cwd: '/w', key: '1' }));
  rec('tickets.ok', await mkT({ backendId: 'local-md' }).handleMapTickets({ cwd: '/w', key: '2' }));
}

// ---------- namingGuardian ----------
{
  const g = createNamingGuardian({ fs: undefined, timer: { timeout: () => 0 }, DEFAULT_CWD: '/w', getCacheDir: async () => '/c', getPlatform: async () => ({ fs: { resolve: async (p) => String(p) }, path: { join: (a, b) => a + '/' + b } }), getRepoKey: async () => null, runGh: async () => { throw new Error('no-gh'); }, logCtx: null });
  rec('naming.keys', Object.keys(g).sort());
  rec('naming.getMissing', await g.getEntry('nope'));
  rec('naming.applyNoSid', await g.applySummaryResult({}));
  rec('naming.applyNoEntry', await g.applySummaryResult({ sessionId: 'x' }));
}

console.log(JSON.stringify(out, null, 1));
