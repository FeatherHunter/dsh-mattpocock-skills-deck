/**
 * tests/verify-1231-ws-overview-rows.ts —— 总览行计算的单测（对应 #1231，缝合点是统一判定契约）。
 *
 * 为什么要有它：总览过去同时看两份口径（统一判定结论与批量预读表），子目录与根各占一行，
 * 显示名只取最后一段，重名行长得一模一样。#1233 定版之后，渲染只许认统一判定结论这一处，
 * 行按工作区根合并，重名用最短唯一后缀区分。这三条收进总览叶子里的三个纯函数，
 * 这里只喂值、看返回值；任何一条红了，说明渲染改了口径，必须先修再往下走。
 *
 * 纯的意思是它们不碰宿主、不碰界面、不读钟：规整键与查根两件事由调用方当参数递进来，
 * 测试里用几行小函数冒充，不需要造会话、不需要起宿主。
 * 后缀算法与版本管理页签是同一套（来源 src/shared/version-control/src/state.ts），
 * 叶子构建拼不进运行时引用，所以这里实现一份、下面用同一组例子对拍，漂了就红。
 *
 * 用法: node --import ./scripts/ts-hook.mts tests/verify-1231-ws-overview-rows.ts。
 * 退出码 0 = 全通过；1 = 有断言不成立（会卡住 verify 链）。
 */
import { shortestUniqueSuffix } from '../src/shared/version-control/src/state.js';
import {
  computeWsOverviewRows,
  wsDisplayOf,
  wsSuffixKeepOf,
} from '../src/client/views/SettingsWorkspaces.js';

let failed = false;
let total = 0;
function check(ok: unknown, msg: string): void {
  total += 1;
  console.log(((ok ? '  PASS ' : '  FAIL ') + msg) as string);
  if (!ok) failed = true;
}

/** 测试里冒充的规整键：斜杠统一、去尾斜杠、Windows 折大小写（与生产那把钥匙同形）。 */
function fakeKeyOf(p: string): string {
  return String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** 用一张「所选目录键 → 工作区根键」表冒充生产那张归属表，查不到就返回空串（宁可不标，也不猜）。 */
function fakeRootOf(table: Record<string, string>): (p: string) => string {
  return (p: string) => table[fakeKeyOf(p)] || '';
}

const depsOf = (table: Record<string, string>, modulesOrder: string[] = [], raws: string[] = []) => ({
  normKeyOf: fakeKeyOf,
  rootKeyOf: fakeRootOf(table),
  resolveRoot: (rootKey: string): string => {
    // 生产那张原样表里有清单上每一条目录（含根自己），这里同样从清单里找。
    for (const raw of raws) {
      if (fakeKeyOf(raw) === rootKey) return raw;
    }
    for (const raw of Object.keys(table)) {
      if (fakeKeyOf(raw) === rootKey) return raw;
    }
    return '';
  },
  modulesOrder,
});

async function main(): Promise<void> {
  console.log('— 只认统一判定结论（批量预读表不再是口径）');
  {
    const paths = ['D:/a/ilife'];
    const selections = { 'D:/a/ilife': { backendId: 'github', source: 'explicit' } };
    const out = computeWsOverviewRows(paths, selections, depsOf({}));
    check(out.total === 1 && out.boundCount === 1, '有人选记录的行显示已绑定，计数 1/1');
    check(out.rows[0].backendId === 'github', '显示的后端名就是统一结论里的那一个');
  }
  {
    // #1572 收尾：低置信线索也算有结论（行算已绑定），但来源词原样交给界面——
    // 界面据此标「推测」，不许把它显示成「显式」。
    const paths = ['D:/a/hinted'];
    const selections = { 'D:/a/hinted': { backendId: 'github', source: 'hint' } };
    const out = computeWsOverviewRows(paths, selections, depsOf({}));
    check(out.total === 1 && out.boundCount === 1, '低置信线索行同样算已绑定（后端有结论）');
    check(out.rows[0].source === 'hint', '来源词原样带出给界面（hint 不变 explicit）');
  }
  {
    const paths = ['D:/a/ilife'];
    const out = computeWsOverviewRows(paths, {}, depsOf({}));
    check(out.total === 1 && out.boundCount === 0, '没有记录的行显示未绑定，计数 1/0');
    check(out.rows[0].backendId === null && out.rows[0].bound === false, '无结论时后端名是空，不放行');
  }

  console.log('— 按工作区根合并计数（子目录不再单占一行）');
  {
    const root = 'D:/repo';
    const sub = 'D:/repo/packages/app';
    const table: Record<string, string> = {};
    table[fakeKeyOf(sub)] = fakeKeyOf(root);
    const selections = { [root]: { backendId: 'markdown', source: 'explicit' } };
    const out = computeWsOverviewRows([root, sub], selections, depsOf(table, [], [root, sub]));
    check(out.total === 1, '根与子目录合并成一行');
    check(out.rows[0].cwd === root && out.rows[0].members.length === 2, '代表行是根，成员两条都在');
    check(out.rows[0].root === root && out.rows[0].merged === true, '合并行的归属根标得出来，并打上合并标记');
    check(out.boundCount === 1, '根有记录则合并行算已绑定');
  }
  {
    const root = 'D:/repo';
    const sub = 'D:/repo/packages/app';
    const table: Record<string, string> = {};
    table[fakeKeyOf(sub)] = fakeKeyOf(root);
    const selections = { [sub]: { backendId: 'markdown', source: 'explicit' } };
    const out = computeWsOverviewRows([root, sub], selections, depsOf(table, [], [root, sub]));
    check(out.total === 1 && out.boundCount === 1, '记录挂在子目录上时合并行同样算已绑定（组内兜底）');
  }
  {
    const out = computeWsOverviewRows(
      ['D:/repo-a', 'D:/repo-b'],
      {},
      depsOf({}),
    );
    check(out.total === 2, '兄弟目录永不合并，各占一行');
  }

  console.log('— 重名用最短唯一后缀区分（与版本管理页签同一套写法）');
  {
    const paths = ['D:/a/dsh-log', 'D:/b/dsh-log', 'D:/c/ilife'];
    const keeps = wsSuffixKeepOf(paths);
    check(keeps[0] === 2 && keeps[1] === 2 && keeps[2] === 1, '重名各取两段，不重名只取末段');
    check(wsDisplayOf(paths[0], keeps[0]) === 'a/dsh-log', '重名显示两段后缀');
    check(wsDisplayOf(paths[2], keeps[2]) === 'ilife', '不重名显示末段');
  }
  {
    // 对拍：同一组例子，我这份与版本管理页签那份算出来的段数逐条一致，漂了就红。
    const fixtures: string[][] = [
      ['D:/a/dsh-log', 'D:/b/dsh-log'],
      ['D:/a/x', 'D:/b/y', 'D:/c/z'],
      ['D:/repo', 'D:/repo/packages/app', 'D:/other'],
      ['C:\\ws\\ilife', 'D:/ws/ilife'],
    ];
    for (const paths of fixtures) {
      const mine = wsSuffixKeepOf(paths);
      const theirs = shortestUniqueSuffix(paths);
      check(
        mine.length === theirs.length && mine.every((n, i) => n === theirs[i]),
        '对拍一致：' + paths.join(' ｜ '),
      );
    }
  }

  console.log('— 排序与计数（已绑定置顶，未绑定按名）');
  {
    const paths = ['D:/z-unbound', 'D:/a-unbound', 'D:/m-bound'];
    const selections = { 'D:/m-bound': { backendId: 'gitlab', source: 'matches' } };
    const out = computeWsOverviewRows(paths, selections, depsOf({}, ['github', 'gitlab']));
    check(out.rows[0].cwd === 'D:/m-bound', '已绑定的排前面');
    check(out.rows[1].cwd === 'D:/a-unbound' && out.rows[2].cwd === 'D:/z-unbound', '未绑定的按显示名排');
    check(out.total === out.rows.length && out.boundCount === 1, '总数与已绑定数与行数对得上');
  }

  console.log('— 未绑定行的失败线索（#1238：等就绪与查文件分得清，正常无记录保持原样）');
  {
    const out = computeWsOverviewRows(
      ['D:/a/bad'],
      { 'D:/a/bad': { backendId: null, source: 'fallback', state: 'undetermined' } },
      depsOf({}),
    );
    check(out.rows[0].bound === false && out.rows[0].unboundHint === 'check', '判定没查清的行带查文件线索，不再是普通未绑定');
  }
  {
    const out = computeWsOverviewRows(
      ['D:/a/empty'],
      { 'D:/a/empty': { backendId: null, source: 'fallback', state: 'no-backend' } },
      depsOf({}),
    );
    check(out.rows[0].bound === false && out.rows[0].unboundHint === null, '查清了确实没有的行保持普通未绑定，不加线索');
  }
  {
    const out = computeWsOverviewRows(
      ['D:/a/pend'],
      { 'D:/a/pend': { backendId: null, source: 'fallback', pending: true } },
      depsOf({}),
    );
    check(out.rows[0].unboundHint === 'wait', '还没判完的行带等就绪线索');
  }
  {
    const out = computeWsOverviewRows(
      ['D:/a/nr'],
      { 'D:/a/nr': { backendId: null, source: 'unknown', reason: 'workspace-not-ready' } },
      depsOf({}),
    );
    check(out.rows[0].unboundHint === 'wait', '工作区没就绪的行带等就绪线索');
  }
  {
    const out = computeWsOverviewRows(
      ['D:/a/ok'],
      { 'D:/a/ok': { backendId: 'github', source: 'explicit', state: 'decided' } },
      depsOf({}),
    );
    check(out.rows[0].bound === true && out.rows[0].unboundHint === null, '已绑定的行不带线索');
  }

  console.log(`共 ${total} 条`);
  if (failed) {
    console.log('存在失败');
    process.exit(1);
  }
  console.log('全部通过');
}

void main();
