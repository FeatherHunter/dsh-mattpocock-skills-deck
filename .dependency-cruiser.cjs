// .dependency-cruiser.cjs —— 源码引用方向的检查配置（issue #1017，地图 #1013）。
//
// 这个文件替掉两条只读 .js 文本的老门禁：
//   tests/verify-no-same-layer-import.js（同层互引，档 #439）
//   tests/verify-no-cross-import.js（三个后端房间互引，档 #326）
// 换轨的原因写在 #1014 的 Q2 结论里：老门禁按路径扫 .js 文本，改名之后扫不到文件还会判绿（空集合假绿），
// 而且 .ts 是空窗。改成读依赖图之后，两种源码一起看，且「文件在不在」由解析器说了算。
//
// 为什么用 .cjs 而不是 .js：仓库根 package.json 没有 type 字段，x.js 一律当 CommonJS 解析；
// 而 dependency-cruiser 本身是纯 ESM 包。配置文件用 .cjs 后两种装包方式（npm / pnpm）下都不会有歧义。
//
// 怎么跑（在仓库根目录，手工复核用）：
//   pnpm exec depcruise src\host src\shared src\seam src\tracker --config .dependency-cruiser.cjs --output-type err-long --no-progress
// 正式门禁是 tests/verify-dependency-rules.ts，它把本配置跑一遍、再核对存量豁免清单，最后判红或判绿。
// 退出码就是「error 级违规的条数」，所以命令行直接跑也能当门禁用。
//
// 三条口径上的约定（改本文件前先读这三条）：
//   1. 只看 src/host、src/shared、src/seam、src/tracker 四棵树 —— 前三棵与两条老门禁的扫描域逐字相同；
//      第四棵 src/tracker 是 #1136 补上的：房间（src/tracker/rooms/**）在那棵树里，而房间只靠 import 边
//      入图，没人引的房间文件根本不进图（实测盘上 65 个房间源码只有 56 个进得来）。写进根清单之后，
//      「图是完整的」就不再依赖「import 边碰巧够长」，房间纪律也才真的落在房间上。
//      src/deck/** 是搬家后的目标树（#1019 起存在），由 tests/verify-dependency-rules.ts 的
//      OPTIONAL_TREES 一起喂给引擎。它多数文件本来就被 src/host/tools/** 的 import 边带进图里，
//      写进根清单是为了让「图是完整的」不靠 import 边碰巧够长：实测有两个文件
//      （src/deck/rules/index.ts 与 src/deck/registration/agent-row.ts）只有写进根清单才会进图。
//      src/client/** 不进这个图：那里每个 .ts 旁边都有一份构建生成的同名 .js，
//      同一个逻辑模块会在图里出现两次（真源一次、产物一次），引用边会重复计数。
//   2. tsPreCompilationDeps 开着：类型级别的 import（import type）也算一条引用边。
//      老门禁是扫文本的，import type 那行同样带 from '...'，所以那时候也算；这里必须对齐，不能悄悄放松。
//   3. 非字面量动态 import（例如 await import('./' + name + '.js')）是 dependency-cruiser 的盲区——
//      解析器只在参数是字符串字面量时才产生依赖。老门禁的口径是「一律算违规」，这条严格度不能丢，
//      所以由 tests/verify-dependency-rules.ts 用文本扫描补上（今天这四棵树里一条都没有）。

// 房间（src/tracker/rooms/<名字>/）可以引用的房外目录，来自 tests/tracker-room-imports.json。
//
// **那份 JSON 是这份清单的唯一真源**（#1136 定的形态，决策见 docs/adr/20261014-tracker-room-boundary.md）：
// 引擎经下面这行读它，门禁 tests/verify-dependency-rules.ts 直接读同一份文件 —— 一份数据、两个读者。
// 为什么不把登记表直接写在配置里：dependency-cruiser 对配置的顶层键做白名单校验，多一个自定义键它就
// 拒绝启动（报 data must NOT have additional properties），所以数据只能放在旁边的文件里。
// 房间说明 src/tracker/rooms/README.md 只指路、不再抄第二份 —— 抄两份正是这次漂移（#1136）的机制。
//
// 每条必须写清「为什么在」与「归哪张票」：门禁的五条判据会逐条核对（活着 / 有名有据 / 不吃自己 /
// 不被吸收 / 报分母），写不出理由、或者匹配不到任何源码文件的条目过不了门禁。
const ROOM_IMPORTS = require('./tests/tracker-room-imports.json')
const ROOM_IMPORT_PATTERNS = ROOM_IMPORTS.entries.map((entry) => entry.pattern)

// deck 层深引的白名单：今天为空（src/host/tools/、src/shared/deck-tools/ 与未来的 src/deck/
// 一处深引都没有）。格式与 ROOM_IMPORTS.entries 同：写在这里的路径前缀放行。
const DECK_DEEP_IMPORT_WHITELIST = []

module.exports = {
  // 注意：登记表不在这里导出。dependency-cruiser 只认 forbidden / allowed / allowedSeverity /
  // required / options / extends 这几个顶层键，多一个就拒绝启动；登记表在
  // tests/tracker-room-imports.json，规则文件与门禁各自读它（一份数据、两个读者）。
  forbidden: [
    // ── 同层互引（老门禁 verify-no-same-layer-import 的判据，一条不丢）────────────────────
    // 层的划分与老门禁逐字相同：platform / host / shared / seam 四层；
    // src/tracker/rooms 三房间不算层（它们的同房间放行、跨房间禁止由下面的房间规则管）。
    {
      name: 'same-layer-import-platform',
      severity: 'error',
      comment:
        '同一层内部禁止互相 import（平台抽象层）。层内互引会让这一层退化成一个大文件，'
        + '要复用的东西往上提到 src/shared 的公开接口，或者由调用方传进来。跨层引用不受本规则限制。',
      from: { path: '^src/host/platform/' },
      to: { path: '^src/host/platform/' },
    },
    {
      name: 'same-layer-import-host',
      severity: 'error',
      comment:
        '同一层内部禁止互相 import（宿主层，即 src/host 去掉 platform）。'
        + '接线由装配文件负责，干活的文件之间不许互相引用。',
      from: { path: '^src/host/', pathNot: ['^src/host/platform/'] },
      to: { path: '^src/host/', pathNot: ['^src/host/platform/'] },
    },
    {
      name: 'same-layer-import-shared',
      severity: 'error',
      comment:
        '同一层内部禁止互相 import（共享层）。共享层的每个文件都应该是自包含的纯模块：'
        + '需要别的模块的数据一律由调用方传进来。存量豁免记在 tests/same-layer-baseline.json，只许减不许增。',
      from: { path: '^src/shared/' },
      to: { path: '^src/shared/' },
    },
    {
      name: 'same-layer-import-seam',
      severity: 'error',
      comment: '同一层内部禁止互相 import（接缝层，src/seam）。',
      from: { path: '^src/seam/' },
      to: { path: '^src/seam/' },
    },

    // ── 后端房间纪律（老门禁 verify-no-cross-import 的判据，一条不丢）──────────────────────
    {
      name: 'cross-room-import',
      severity: 'error',
      comment:
        'github / gitlab / markdown 三个后端房间之间禁止互相 import，也不许引用房外登记表之外的目录。'
        + '允许的方向只有三条：同房间内部、下面 ROOM_IMPORTS.entries 列出的共享/宿主目录、Node 内置模块。'
        + '加一条例外只改本文件的 ROOM_IMPORTS（唯一真源）；src/tracker/rooms/README.md 只指路，不抄第二份。'
        + '起点不写房名：房间名从 from.path 的捕获组里取（见下面 $1 的用法），将来加第四间房不用改这里。',
      from: { path: '^src/tracker/rooms/([^/]+)/' },
      to: {
        path: '^src/',
        // $1 是 from.path 里捕获到的房间名：同房间放行靠它一句顶三条规则。
        pathNot: ['^src/tracker/rooms/$1/'].concat(ROOM_IMPORT_PATTERNS),
      },
    },
    {
      name: 'room-imports-third-party-package',
      severity: 'error',
      comment:
        '后端房间只许引 Node 内置模块，不许引任何第三方包（例如 ws）。'
        + '房间要发网络请求就走宿主注入的端口，不许自己挑实现。',
      from: { path: '^src/tracker/rooms/' },
      to: {
        dependencyTypes: [
          'npm',
          'npm-dev',
          'npm-optional',
          'npm-peer',
          'npm-bundled',
          'npm-no-pkg',
          'npm-unknown',
          'unknown',
          'undetermined',
        ],
      },
    },

    // ── deck 层不许深引房间实现与探测内部（#1014 Q2 的「深引白名单」这一面）────────────────
    // Q2 的口径：deck 的文件只许连到契约层的公开入口（src/tracker/contract/），
    // 连到房间实现（src/tracker/rooms/<名字>/）、共享内核（src/tracker/kernel/，#1159 归口后的新目录）
    // 或探测内部（src/tracker/detection/）都算违规。
    // from 里那几处就是 deck 的落点：src/host/tools/ 是九个 deck 工具的宿主侧实现，
    // src/shared/deck-tools/ 是它们共用的纯逻辑件；src/deck/ 是搬家后的目标树，今天还没有，
    // 提前写在这里，是为了搬家之后这条规则自己就跟上，不用再改一次配置。
    // to 里的 src/tracker/kernel/ 同理：那个目录一建起来，deck 就必须照旧只连契约层，
    // 不许借新目录绕开（#1159 的验收里有一条专门盯它）。
    // 白名单今天是空的（这三处一条深引都没有）；将来确有正当深引，加进 DECK_DEEP_IMPORT_WHITELIST
    // 这一处就够 —— 房间说明只指路，不抄第二份。
    {
      name: 'deck-deep-import',
      severity: 'error',
      comment:
        'deck 层只许连契约层的公开入口（src/tracker/contract/），不许直接连房间实现、共享内核或探测内部。'
        + '需要后端的能力时，先把那件事加到契约层的公开面上，再从 deck 引它。',
      from: {
        path: '^(src/deck/|src/host/tools/|src/shared/deck-tools/)',
        pathNot: DECK_DEEP_IMPORT_WHITELIST,
      },
      to: { path: '^(src/tracker/rooms/|src/tracker/kernel/|src/host/tracker/detection/)' },
    },

    // ── 反方向：房间实现只许被装配点与房间自身引用（#1161 上线）────────────────────────────
    // 为什么装配点是唯一出口：房间的实现细节（client / normalize / parse 这些件）是房间私有的，
    // 谁都能深引就没人守得住「房间与宿主之间的边界」；宿主侧真正需要的少数几个件，由装配点
    // src/tracker/registry/builtins.ts 从房间的公开面转出（房间里那几行 re-export 就是为这件事写的）。
    // 这条规则从前上不了：5 个宿主文件、7 处深引，硬加会把全链判红。装配点立起来之后才上线。
    // from.path 写 '^src/' 而不是留空：起点空着与起点指错地方在门禁上长得一模一样（#1136 的假绿成因），
    //   所以判据一/六要求每条规则都有能落地的起点判据（见 tests/verify-dependency-rules.ts 的文件头）。
    {
      name: 'rooms-imported-only-by-assembly',
      severity: 'error',
      comment:
        '房间实现只许被装配点引用：别处要房间里的东西，先让装配点把它从房间公开面转出来，或走契约层。',
      from: {
        path: '^src/',
        pathNot: ['^src/tracker/rooms/', '^src/tracker/registry/builtins\\.(ts|js)$'],
      },
      to: { path: '^src/tracker/rooms/' },
    },

    // ── 纯规则侧只许算，不许碰世界（#1039 的 #1108 定版：纯侧不许引宿主能力）──────────────
    // src/deck/rules/ 是「纯规则侧」：只做计算，不取会话、不起进程、不读写文件、不读钟。
    // 往外只许引一样东西：契约层 src/tracker/contract/（纯类型与数据，没有运行时实现）——
    // 「纯规则只引用契约接口，不深引用房间与宿主能力」是 #1038 第 4 条与 #1108 架构条的原话。
    // 这条规矩在 #1038 定版时靠约定与代码评审守；这里把它变成机器判据 —— 引用方向这一面由下面两条守，
    // 全局调用那一面（Date.now()、Math.random()、fetch() 这类没有 import 边的写法）由
    // tests/verify-1039-rules-pure.ts 的文本扫描守。两层都要有：光有文本扫描漏 import 边，
    // 光有依赖图漏全局调用。
    //
    // 为什么拆成两条：本配置里 to 的各个条件之间是「同时满足」（dependency-cruiser 的匹配是 and），
    // 一条规则里既写 path 又写 dependencyTypes，就变成「既要落在这几个目录、又要是内置模块」，
    // 两边都漏。所以「不许去哪些目录」与「不许用内置模块」各写一条。
    {
      name: 'deck-rules-stay-pure',
      severity: 'error',
      comment:
        '纯规则侧（src/deck/rules/）只许做计算，不许引宿主能力：src/host（宿主层）、src/tracker 里除'
        + '契约层以外的部分（注册表、房间实现）、src/client（界面）、src/seam（接缝），以及同一棵 deck'
        + '树里的 shell / tools / registration —— 这几处正是「碰世界」的那一侧（取会话、起进程、注册工具）。'
        + '契约层 src/tracker/contract/ 是唯一放行的往外引用：它是纯类型与数据、没有运行时实现，'
        + '纯侧引它不算碰世界（#1038 第 4 条与 #1108 架构条：纯规则只引用契约接口）。'
        + '需要外部数据一律由调用方当参数传进来（本层的 workspace-file.ts 就是这么接编解码器的）。',
      from: { path: '^src/deck/rules/' },
      to: {
        path: [
          '^src/host/',
          '^src/tracker/',
          '^src/client/',
          '^src/seam/',
          '^src/deck/(shell|tools|registration)/',
        ],
        // 契约层放行（#1038 第 4 条与 #1108 架构条：「纯规则只引用契约接口，不深引用房间与宿主能力」）。
        // 写法选 pathNot 而不是把 ^src/tracker/ 拆成一串具体子目录：禁的是「追踪器里除契约以外的部分」
        // 这件事本身，将来 tracker 下新增目录会自动落进禁列，不会因为漏写一个新目录而悄悄放行。
        pathNot: '^src/tracker/contract/',
      },
    },
    {
      name: 'deck-rules-no-node-builtins',
      severity: 'error',
      comment:
        '纯规则侧（src/deck/rules/）不许引 Node 内置模块（fs、child_process、node:path 之类）。'
        + '纯侧要拼路径就自己算字符串，要读文件就把内容当参数收进来。'
        + '要往纯侧加一条会碰世界的能力，先改 #1038 的分层定版，不要在这里加白名单绕过去。',
      from: { path: '^src/deck/rules/' },
      to: { dependencyTypes: ['core'] },
    },

    // ── 图上的环 ────────────────────────────────────────────────────────────────────────────
    {
      name: 'circular-dependency',
      severity: 'error',
      comment:
        '禁止循环依赖。两条老门禁都管不到环（只按同层/跨房两条线判），这条是新增的判据；'
        + '今天这三棵树里一条环都没有，所以它是从零开始守。',
      from: {},
      to: { circular: true },
    },
  ],

  options: {
    // 不跟着 import 走进 node_modules：只关心本仓源码之间的引用边。
    doNotFollow: { path: 'node_modules' },
    // 类型级别的 import 也算边（见文件头第 2 条）。
    tsPreCompilationDeps: true,
    // 三棵树的扫描范围由命令行参数给出（门禁脚本里写着），这里不再写 exclude：
    // exclude 掉被引用的目录会让引用变成「解析不到」，反而制造噪音。
    // 显式指定扩展名列表无关紧要——能被扫到哪些扩展名由装没装 typescript 决定（见 package.json 的 devDependencies）。
  },
}
