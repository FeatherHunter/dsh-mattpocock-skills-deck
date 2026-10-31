// 门禁归属: tests/fixtures/1700/closeout-matrix.json
// 门禁归属: docs/design/20261030-panel-snapshot-closeout.md
//
// 规格 #1681 收口（票 #1700）的验收矩阵门禁。
//
// 它守三件事：
// 1. 30 条验收逐条有判据、有负例、有结果，编号 1..30 连续、七个阶段（0..6）全部出现，
//    引用的门禁必须真的在链上（tests/ 下存在且登记进 tests/gate-map.json），
//    不许写一个不存在的门禁名字来凑数。
// 2. 已知红登记表清零：matrix.knownReds 必须为空数组，且 knownRedTable 三类处置齐全
//    （结构性已知红 / 并发假红 / 已修真红），不许把真红藏在别处。
// 3. 收口文档、两份 ADR 与迁移计划的真数一致：30 条、七个阶段、实测票数（1659 工单 + 64 PR）、
//    检索时刻、真红 0，且旧数（433 张票）不许再出现。
//
// 负例自测写在文件末尾：对 5 种坏矩阵，validateMatrix 必须报出问题；坏矩阵不报问题即本门禁失效。

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { printGateResult } from './lib/gate-result.ts';

const GATE = 'verify-closeout-acceptance';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MATRIX_PATH = path.join(ROOT, 'tests/fixtures/1700/closeout-matrix.json');
const GATE_MAP_PATH = path.join(ROOT, 'tests/gate-map.json');
const CLOSEOUT_DOC = 'docs/design/20261030-panel-snapshot-closeout.md';
const ADR_FILES = [
  'docs/adr/20261030-panel-snapshot-single-source.md',
  'docs/adr/20261030-github-room-channel-layering.md',
];
const PLAN_FILE = 'docs/design/20261030-panel-snapshot-and-room-layering-plan.md';
const DRILL_REQUIRED_IDS = [1, 10, 14, 17, 18, 22, 24, 27, 29];

let total = 0;
let failed = 0;
function check(cond: any, message: string, detail?: any): boolean {
  total += 1;
  if (cond) {
    console.log('PASS ' + message);
    return true;
  }
  failed += 1;
  console.log('FAIL ' + message + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)));
  return false;
}

function resolvePath(file: string): string {
  return path.isAbsolute(file) ? file : path.join(ROOT, file);
}

function readJson(file: string): any {
  return JSON.parse(fs.readFileSync(resolvePath(file), 'utf8'));
}

function validateMatrix(m: any, gateMap: any): string[] {
  const problems: string[] = [];
  if (!m || typeof m !== 'object') return ['matrix 不是对象'];
  if (m.version !== 1) problems.push('version 不是 1');
  if (m.ticket !== 1700) problems.push('ticket 不是 1700');
  if (m.spec !== 1681) problems.push('spec 不是 1681');
  if (typeof m.issueCountMeasured !== 'number' || m.issueCountMeasured <= 0) problems.push('issueCountMeasured 缺失');
  if (typeof m.pullRequestCountMeasured !== 'number' || m.pullRequestCountMeasured < 0) problems.push('pullRequestCountMeasured 缺失');
  if (typeof m.measuredAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(m.measuredAt)) problems.push('measuredAt 不是时刻');
  const rows = Array.isArray(m.rows) ? m.rows : [];
  if (rows.length !== 30) problems.push('rows 不是 30 行，实际 ' + rows.length);
  const ids = rows.map((r: any) => r && r.id);
  for (let i = 1; i <= 30; i += 1) {
    if (ids.indexOf(i) < 0) problems.push('缺少第 ' + i + ' 条');
  }
  const phases = Array.isArray(m.phases) ? m.phases.slice().sort() : [];
  const wantPhases = [0, 1, 2, 3, 4, 5, 6];
  if (JSON.stringify(phases) !== JSON.stringify(wantPhases)) problems.push('phases 不是 0..6');
  for (const row of rows) {
    if (!row || typeof row !== 'object') { problems.push('行不是对象'); continue; }
    const tag = '第 ' + row.id + ' 条';
    if (wantPhases.indexOf(row.phase) < 0) problems.push(tag + ' phase 非法');
    if (!Array.isArray(row.gate) || row.gate.length === 0) problems.push(tag + ' gate 为空');
    else {
      for (const g of row.gate) {
        if (g === 'FULL_CHAIN') continue;
        if (typeof g !== 'string' || !/^verify-[a-z0-9-]+$/.test(g)) { problems.push(tag + ' 门禁名形状坏: ' + g); continue; }
        const file = 'tests/' + g + '.ts';
        if (!fs.existsSync(path.join(ROOT, file))) problems.push(tag + ' 引用的门禁文件不存在: ' + file);
        const onChain = Array.isArray(gateMap.gates) && gateMap.gates.some((x: any) => x && x.file === file);
        if (!onChain) problems.push(tag + ' 引用的门禁不在链上: ' + file);
      }
    }
    if (typeof row.negative !== 'string' || row.negative.trim().length < 4) problems.push(tag + ' negative 缺失');
    if (row.result !== 'pass') problems.push(tag + ' result 不是 pass');
    if (DRILL_REQUIRED_IDS.indexOf(row.id) >= 0 && (typeof row.drill !== 'string' || row.drill.trim().length < 4)) {
      problems.push(tag + ' 应写演练记录但没有');
    }
  }
  if (!Array.isArray(m.knownReds) || m.knownReds.length !== 0) problems.push('knownReds 必须为空数组（已知红清零）');
  const table = Array.isArray(m.knownRedTable) ? m.knownRedTable : [];
  for (const kind of ['结构性已知红', '并发假红', '已修真红']) {
    if (!table.some((x: any) => x && x.kind === kind)) problems.push('knownRedTable 缺一类: ' + kind);
  }
  return problems;
}

function readDoc(rel: string): string {
  const p = resolvePath(rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

async function main() {
  const matrix = readJson(MATRIX_PATH);
  const gateMap = readJson(GATE_MAP_PATH);

  // A 矩阵本体
  const problems = validateMatrix(matrix, gateMap);
  check(problems.length === 0, 'A1 验收矩阵 30 条自洽、编号连续、七阶段齐全、门禁都在链上', problems.slice(0, 6));
  check(matrix.knownReds.length === 0, 'A2 已知红登记表清零（knownReds 为空数组）');
  const recordedGates = (gateMap.gates || []).filter((g: any) => g && g.completionRecord === true);
  check(recordedGates.length >= 40, 'A3 链上已开闸门禁 ' + recordedGates.length + ' 扇（≥40）');
  const mapped = new Set<string>();
  for (const row of matrix.rows) for (const g of row.gate) if (g !== 'FULL_CHAIN') mapped.add(g);
  let mappedOnChain = 0;
  for (const g of mapped) {
    if ((gateMap.gates || []).some((x: any) => x && x.file === 'tests/' + g + '.ts')) mappedOnChain += 1;
  }
  check(mapped.size >= 20 && mappedOnChain === mapped.size, 'A4 矩阵引用 ' + mapped.size + ' 扇门禁，全部在链上（' + mappedOnChain + '/' + mapped.size + '）');
  const drillRows = matrix.rows.filter((r: any) => typeof r.drill === 'string' && r.drill.trim().length >= 4);
  check(drillRows.length >= 9, 'A5 真机/演练行 ' + drillRows.length + ' 条（≥9）');

  // B 收口文档真数
  const closeout = readDoc(CLOSEOUT_DOC);
  check(closeout.length > 0, 'B1 收口文档存在：' + CLOSEOUT_DOC);
  const docMusts: any[] = [
    ['30 条', '30 条验收'],
    ['七个阶段', '七个阶段'],
    ['1659', '实测工单数 1659'],
    ['64', '实测 PR 数 64'],
    ['2026-10-31T14:23', '检索时刻'],
    ['真红 0', '真红为零'],
    ['已知红', '已知红处置'],
    ['## 6', '第 6 节演练记录'],
    ['演练', '演练记录'],
  ];
  const missingDoc: string[] = [];
  for (const [needle, label] of docMusts) if (closeout.indexOf(needle) < 0) missingDoc.push(label);
  check(missingDoc.length === 0, 'B2 收口文档含真数与演练记录（缺 ' + missingDoc.length + ' 项）', missingDoc);
  check(closeout.indexOf('433') < 0, 'B3 收口文档不再出现旧数 433');
  check(closeout.indexOf('verify-rest-fallback-completion') >= 0 && closeout.indexOf('verify-rest-detail-completion') >= 0, 'B4 收口文档写明降级补齐两扇门禁的实际名字');

  // C 两份 ADR 与迁移计划
  for (const adr of ADR_FILES) {
    const text = readDoc(adr);
    check(text.indexOf('收口记录') >= 0, 'C ' + adr + ' 含收口记录');
  }
  const plan = readDoc(PLAN_FILE);
  check(plan.indexOf('收口记录') >= 0, 'C 迁移计划含收口记录');
  check(plan.indexOf('433 张票') < 0, 'C 迁移计划不再出现旧数「433 张票」');
  check(plan.indexOf('1659') >= 0 && plan.indexOf('64') >= 0, 'C 迁移计划写实测票数（1659 工单 + 64 PR）');

  // D 负例自测：坏矩阵必须报问题
  const clone = () => JSON.parse(JSON.stringify(matrix));
  const badCases: any[] = [];
  const missRow = clone(); missRow.rows.pop(); badCases.push(['缺一行', missRow]);
  const brokenId = clone(); brokenId.rows[4].id = 55; badCases.push(['编号断', brokenId]);
  const badGate = clone(); badGate.rows[6].gate = ['verify-closeout-does-not-exist']; badCases.push(['坏门禁', badGate]);
  const emptyNeg = clone(); emptyNeg.rows[8].negative = ''; badCases.push(['空负例', emptyNeg]);
  const dirtyReds = clone(); dirtyReds.knownReds = ['verify-xxx']; badCases.push(['knownReds 非空', dirtyReds]);
  for (const [label, bad] of badCases) {
    const got = validateMatrix(bad, gateMap);
    check(got.length > 0, 'D 负例自测：' + label + ' 必须被判红（报出 ' + got.length + ' 个问题）', got.slice(0, 3));
  }
  check(validateMatrix(matrix, gateMap).length === 0, 'D 正例自测：原矩阵零问题');

  console.log('');
  printGateResult(GATE, total, failed ? 1 : 0);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.log('门禁执行异常：' + (e && e.stack ? e.stack : String(e)));
  printGateResult(GATE, total, 1);
  process.exit(1);
});
