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
import { readFileSync } from 'node:fs';
import { shortestUniqueSuffix } from '../src/shared/version-control/src/state.js';
import {
  computeWsOverviewRows,
  wsDisplayOf,
  wsFactsKeyOf,
  wsSuffixKeepOf,
  wsOuterShownOf,
  wsRowOuterInOf,
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

  // #1806 第 3 步：设置页要写「位于 X 内」，宿主回的外面那个工作区是折算过的键（小写、正斜杠），
  //   直接显示会说成 d:/work。这里把「按这一行的原始写法逐段还原」那条纯函数钉住：
  //   外面那层一定是这一行的祖先，所以取原始路径的前几段就能还原；还原不了就原样回，不猜。
  console.log('— 「位于 X 内」那句里外面工作区的写法（#1806 第 3 步）');
  {
    check(wsOuterShownOf('d:\\work', 'D:\\work\\proj') === 'D:\\work', '宿主回小写键时按这一行的反斜杠写法还原');
    check(wsOuterShownOf('d:/work/proj', 'D:/work/proj/sub') === 'D:/work/proj', '正斜杠写法同样还原（取原始路径的前几段）');
    check(wsOuterShownOf('d:\\work', 'D:\\work\\proj\\deep\\er') === 'D:\\work', '外面那层与这一行隔了好几层也没关系，按段数取');
    check(wsOuterShownOf('/home/w', '/home/w/proj') === '/home/w', 'POSIX 绝对路径开头的斜杠要保住');
    check(wsOuterShownOf('', 'D:/work/proj') === '', '没有外面那层就不说这句话（不编一个根出来）');
    check(wsOuterShownOf('d:/work', '') === 'd:/work', '这一行没有原始路径可借时原样回宿主给的值，不硬造写法');
  }

  // #1806 第 5 步真机复核发现的缺陷：设置页把「判定事实表」写进去与查出来的钥匙不一样，
  //   真机（Windows）上依据标签与两个纠正按钮永远不出现（面板上的标记却正常，因为面板自己问宿主）。
  //   这里钉两件事：① 规整函数把 Windows 原样路径与正斜杠写法落到同一个键；
  //   ② 源码里写侧与查侧只用这一个函数，回退到旧的 normCwdClient 写法就红。
  console.log('— 判定事实表的键（#1806 第 5 步真机复核回归）');
  {
    const raw = 'D:\\2Study\\StudyNotes\\SKILLS\\智剪工坊';
    check(wsFactsKeyOf(raw) === wsFactsKeyOf('D:/2Study/StudyNotes/SKILLS/智剪工坊'), '反斜杠与正斜杠写法落到同一个键');
    check(wsFactsKeyOf(raw + '\\') === wsFactsKeyOf(raw), '带不带尾斜杠是同一行');
    check(wsFactsKeyOf('') === '', '空目录给空串，不回退成当前目录');
  }
  {
    const src = readFileSync(new URL('../src/client/views/SettingsWorkspaces.ts', import.meta.url), 'utf8');
    check(src.includes('facts[wsFactsKeyOf(cwd)]'), '写事实表时用与查表同一把钥匙');
    check(!src.includes('facts[normCwdClient(cwd)]'), '不再用 normCwdClient 给事实表当键（Windows 上会查不到）');
    check(src.includes('const normOf = wsFactsKeyOf'), '查表与行归并用同一把钥匙');
  }

  // #1806 第 5 步真机复核发现的第二个问题：子目录行的「位于 X 内」原本取的是根外面那层（StudyNotes），
  //   而面板标记说数据来自根（SKILLS）。这一行要说的是它被归到哪个工作区，不是根自己又套在谁里面。
  //   这里钉住纯函数与渲染的用法：回退到直接取 f.outer 就红。
  console.log('— 子目录行「位于 X 内」说的是它归属的工作区（#1806 第 5 步真机复核回归）');
  {
    const child = 'D:\\2Study\\StudyNotes\\SKILLS\\智剪工坊';
    const facts = {
      cwd: 'd:/2study/studynotes/skills/智剪工坊',
      root: 'd:/2study/studynotes/skills',
      source: 'git',
      outer: { root: 'd:/2study/studynotes' },
    };
    check(wsRowOuterInOf(facts, child) === 'D:\\2Study\\StudyNotes\\SKILLS', '子目录行说它被归到的根（SKILLS），不是根外面那层（StudyNotes）');
  }
  {
    const facts = { cwd: 'd:/work/proj', root: 'd:/work/proj', source: 'git', outer: { root: 'd:/work' } };
    check(wsRowOuterInOf(facts, 'D:\\work\\proj') === 'D:\\work', '根行本身照旧说外面套着的工作区');
  }
  {
    check(wsRowOuterInOf({ cwd: 'd:/w/proj', root: 'd:/w/proj', source: 'git', outer: null }, 'D:/w/proj') === '', '根行外面没有工作区就不说这句话');
    check(wsRowOuterInOf(null, 'D:/w/proj') === '', '事实没拿到就不说这句话');
    check(wsRowOuterInOf({ cwd: 'd:/a/b', root: '', outer: { root: 'd:/a' } }, 'D:/a/b') === '', '认不出归属的根就不说，不拿别层凑');
  }
  {
    const src = readFileSync(new URL('../src/client/views/SettingsWorkspaces.ts', import.meta.url), 'utf8');
    check(src.includes('const outerInRoot = wsRowOuterInOf(f, cwd)'), '渲染「位于 X 内」时用这条纯函数，不直接取 f.outer');
  }

  // #1806 第 5 步真机复核发现的第三处：并进上级以后这一层只剩从属记录，canMarkIndependent 是假，
  //   设置页原来没有任何撤销入口，可并入时的提示却承诺「以后还能改回来」。这里钉住撤销入口的接线：
  //   事实层给 canUnjoin、渲染层按它换提示文案与日志点，回退成只认 canMarkIndependent 就红。
  console.log('— 并入上级后能撤销（#1806 第 5 步真机复核回归）');
  {
    const src = readFileSync(new URL('../src/client/views/SettingsWorkspaces.ts', import.meta.url), 'utf8');
    check(src.includes('const canUnjoin = !!(f && f.canUnjoin === true)'), '渲染层读撤销并入的事实（canUnjoin）');
    check(src.includes("canUnjoin ? tr('cfg.wsUnjoinTip')"), '撤销并入时提示文案换成「写回独立记录」的说法');
    check(src.includes("(canMark || canUnjoin) ?"), '按钮在「标为独立」与「撤销并入」两种状态下都出现');
    check(src.includes("'settings.workspaces.unjoin'"), '撤销并入有自己的日志点（事后能分清点了哪种）');
  }

  console.log(`共 ${total} 条`);
  if (failed) {
    console.log('存在失败');
    process.exit(1);
  }
  console.log('全部通过');
}

void main();
