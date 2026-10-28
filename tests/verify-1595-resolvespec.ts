/**
 * tests/verify-1595-resolvespec.ts —— #1595 Q1=A：resolveSpecFile 读侧多候选诚实失败的回归门禁。
 *
 * 病根：src/tracker/rooms/markdown/issues-locate.ts 的 resolveSpecFile 在无范围读到多个
 * 规格文件（多个 .scratch/<目录>/spec.md）时，直接取 hits[0] 按目录顺序回落，把“猜中哪一个”
 * 当成正确答案交回去。调用方拿到第一个规格，还以为全仓库只有一个规格。
 *
 * 裁决（Q1=A）：读侧也不猜。无范围且命中超过一个规格文件时，与写侧同一口径报 conflict，
 * 原文（raw）列出命中的文件与各自所属目录，人看到就知道该给哪一个目录加范围。
 * 单候选保持原样，直接返回那一个文件。
 *
 * 本门禁钉住四件事（都用真实临时目录，不依赖既有仓库盘面）：
 *   1. 两个规格并存时，无范围读（mode:'read' 与不带 mode）都报 conflict，话术点名 00 与数量，
 *      原文列出两个目录；
 *   2. 两个规格并存时，无范围写照旧报 conflict（行为不变）；
 *   3. 只有一个规格时，无范围读写都直接返回那一个文件（单候选保持现状）；
 *   4. 两个规格并存但调用方给了范围时，只看范围内的那一个，读写都成功；
 *   5. 一个规格都没有时，无范围读报 not-found。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-1595-resolvespec.ts
 *
 * 门禁归属: src/tracker/rooms/markdown/issues-locate.ts
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { resolveSpecFile } from '../src/tracker/rooms/markdown/issues-locate.ts';

let failed = false;
let checked = 0;
const check = (ok: boolean, msg: string): void => {
  checked += 1;
  console.log((ok ? '  PASS ' : '  FAIL ') + msg);
  if (!ok) failed = true;
};

type LogLine = { level: string; event: string; fields: Record<string, unknown> };
type Ctx = {
  platform: { path: typeof path; fs: Record<string, unknown> };
  fs: Record<string, unknown>;
  cwd: string;
  events: LogLine[];
  logEvent: (level: string, event: string, fields: Record<string, unknown>) => void;
  get: (name: string) => unknown;
};

/** 与 tests/verify-1480-review-fixes.ts 同一套适配器：真实文件系统加事件收集。 */
function makeCtx(cwd: string): Ctx {
  const plat = {
    path: path,
    fs: {
      async resolve(p: string) { return p; },
      async readText(t: string) { return fs.readFileSync(t, 'utf8'); },
      async writeText(t: string, c: string) { fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, c, 'utf8'); },
      async lstat(t: string) { try { return fs.statSync(t); } catch { return null; } },
      async listDir(t: string) { try { return fs.readdirSync(t); } catch { return []; } },
      async stat(t: string) { try { return fs.statSync(t); } catch { return null; } },
    },
  };
  const events: LogLine[] = [];
  return {
    platform: plat,
    fs: plat.fs,
    cwd,
    events,
    logEvent(level: string, event: string, fields: Record<string, unknown>) { events.push({ level, event, fields }); },
    get(name: string) { if (name === 'fs') return plat.fs; return undefined; },
  };
}

function writeSpec(root: string, dir: string, title: string): string {
  const d = path.join(root, '.scratch', dir);
  fs.mkdirSync(d, { recursive: true });
  const p = path.join(d, 'spec.md');
  fs.writeFileSync(p, '# ' + title + '\n\n## Problem Statement\n\n' + title + '的问题陈述。\n', 'utf8');
  return p;
}

async function main(): Promise<void> {
  console.log('-- 多规格并存：无范围读必须诚实失败，不取第一个 --');
  const tmpMulti = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1595-multi-'));
  try {
    const specA = writeSpec(tmpMulti, 'feat-a', '规格甲');
    const specB = writeSpec(tmpMulti, 'feat-b', '规格乙');
    const ctx = makeCtx(tmpMulti);

    const readMulti: any = await resolveSpecFile(ctx as never, null, { mode: 'read' });
    check(readMulti.ok === false, '多规格无范围读不再返回成功（实得 ' + JSON.stringify(readMulti.ok) + '）');
    check(readMulti.ok === false && String(readMulti.error.kind) === 'conflict', '多规格无范围读档位是 conflict（实得 ' + (readMulti.ok ? 'ok' : String(readMulti.error.kind)) + '）');
    check(readMulti.ok === false && /00/.test(String(readMulti.error.message)) && /2/.test(String(readMulti.error.message)), '多规格无范围读话术点名 00 与数量 2：' + (readMulti.ok ? '' : readMulti.error.message));
    const rawMulti = readMulti.ok ? '' : String(readMulti.error.raw);
    check(rawMulti.includes('feat-a') && rawMulti.includes('feat-b'), '多规格无范围读原文列出两个候选目录：' + rawMulti);
    check(rawMulti.includes(specA.replace(/\\/g, '/')) || rawMulti.includes('feat-a'), '多规格原文带出候选文件归属（至少含目录名）');

    const defaultMode: any = await resolveSpecFile(ctx as never, null, {});
    check(defaultMode.ok === false && String(defaultMode.error.kind) === 'conflict', '多规格无范围默认模式（不带 mode）同样报 conflict（实得 ' + (defaultMode.ok ? 'ok' : String(defaultMode.error.kind)) + '）');

    const writeMulti: any = await resolveSpecFile(ctx as never, null, { mode: 'write' });
    check(writeMulti.ok === false && String(writeMulti.error.kind) === 'conflict', '多规格无范围写照旧报 conflict（实得 ' + (writeMulti.ok ? 'ok' : String(writeMulti.error.kind)) + '）');

    console.log('-- 多规格并存但给了范围：只看范围内的那一个 --');
    const scopedA: any = await resolveSpecFile(ctx as never, null, { effortId: 'feat-a', mode: 'read' });
    check(scopedA.ok === true && String(scopedA.effortId) === 'feat-a', '按目录 feat-a 读只返回 feat-a 的规格（实得 ' + JSON.stringify(scopedA.ok ? scopedA.effortId : scopedA.error) + '）');
    check(scopedA.ok === true && String(scopedA.path).replace(/\\/g, '/').endsWith('/.scratch/feat-a/spec.md'), '按目录 feat-a 读命中的是 feat-a/spec.md：' + (scopedA.ok ? scopedA.path : ''));
    const scopedB: any = await resolveSpecFile(ctx as never, null, { effortId: 'feat-b', mode: 'read' });
    check(scopedB.ok === true && String(scopedB.effortId) === 'feat-b', '按目录 feat-b 读只返回 feat-b 的规格（实得 ' + JSON.stringify(scopedB.ok ? scopedB.effortId : scopedB.error) + '）');
    const scopedWrite: any = await resolveSpecFile(ctx as never, null, { effortId: 'feat-a', mode: 'write' });
    check(scopedWrite.ok === true && String(scopedWrite.effortId) === 'feat-a', '按目录 feat-a 写同样只看范围内（实得 ' + JSON.stringify(scopedWrite.ok ? scopedWrite.effortId : scopedWrite.error) + '）');
  } finally {
    fs.rmSync(tmpMulti, { recursive: true, force: true });
  }

  console.log('-- 单规格：无范围读写都直接返回（保持现状） --');
  const tmpSingle = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1595-single-'));
  try {
    writeSpec(tmpSingle, 'only-one', '唯一规格');
    const ctx = makeCtx(tmpSingle);
    const readSingle: any = await resolveSpecFile(ctx as never, null, { mode: 'read' });
    check(readSingle.ok === true && String(readSingle.effortId) === 'only-one', '单规格无范围读直接返回（实得 ' + JSON.stringify(readSingle.ok ? readSingle.effortId : readSingle.error) + '）');
    check(readSingle.ok === true && String(readSingle.path).replace(/\\/g, '/').endsWith('/.scratch/only-one/spec.md'), '单规格读命中的是 only-one/spec.md：' + (readSingle.ok ? readSingle.path : ''));
    const writeSingle: any = await resolveSpecFile(ctx as never, null, { mode: 'write' });
    check(writeSingle.ok === true && String(writeSingle.effortId) === 'only-one', '单规格无范围写同样直接返回（实得 ' + JSON.stringify(writeSingle.ok ? writeSingle.effortId : writeSingle.error) + '）');
  } finally {
    fs.rmSync(tmpSingle, { recursive: true, force: true });
  }

  console.log('-- 零规格：无范围读报 not-found --');
  const tmpEmpty = fs.mkdtempSync(path.join(os.tmpdir(), 'md-1595-empty-'));
  try {
    const ctx = makeCtx(tmpEmpty);
    const readEmpty: any = await resolveSpecFile(ctx as never, null, { mode: 'read' });
    check(readEmpty.ok === false && String(readEmpty.error.kind) === 'not-found', '零规格无范围读档位是 not-found（实得 ' + (readEmpty.ok ? 'ok' : String(readEmpty.error.kind)) + '）');
  } finally {
    fs.rmSync(tmpEmpty, { recursive: true, force: true });
  }

  console.log('');
  if (failed) {
    console.log('FAILED（' + checked + ' 条断言里有失败）');
    process.exitCode = 1;
  } else {
    console.log('ALL PASS（' + checked + ' 条断言）');
  }
}

void main();
