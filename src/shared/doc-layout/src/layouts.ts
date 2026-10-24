/**
 * src/shared/doc-layout/src/layouts.ts —— 域文档布局取值的唯一真源（#1342）
 *
 * 域文档布局只有两种取值：
 *   · single —— 单上下文：各部分共用一套用语，仓库根目录一份 GLOSSARY.md；
 *   · multi  —— 多上下文：子项目各一份 GLOSSARY.md，仓库根目录再放一份 GLOSSARY-MAP.md 指过去。
 * 这两句话的界面文案在词表里（注入文案与卡片选项），这里只放取值本身。
 *
 * 为什么单独立域：同一份名单原来在三个地方各写了一遍 ——
 *   宿主侧选择记忆（src/host/choiceStore.ts：文件里遗留的布局记录仍按这份名单校验）、
 *   工作区配置文件核（src/shared/config-store/src/workspace.ts 的 LAYOUTS，读配置时校验取值）、
 *   界面侧状态栏与初始化卡（src/client/statusbar/StatusBackend.ts 的 SETUP_LAYOUT_VALUES）。
 * 三处任意一处改了、另外两处没跟上，磁盘上就会写出第三种取值、或者界面拒收一个合法值，
 * 而且三处各说各话时没有任何一处能当场报错。所以名单收到这里，只许从这里读。
 *
 * 为什么配置核不直接 import 本文件：配置核所在的共享层有一条「同层互引」禁令
 * （.dependency-cruiser.ts 的 same-layer-import-shared，唯一例外是 time-config 那份纯数据），
 * 所以核的 parse/stringify 改成收「允许的取值」参数，由调用方把本文件的值传进去；
 * 核里不再保留自己的字面量。
 *
 * 界面那一半怎么拿到它：客户端闭包今天没有任何对 src/shared 的运行时 import，按既有做法
 * 在 scripts/build.mts 的 SHARED_SPLICE 登记、拼进界面闭包（标记见 src/client/index.ts 的
 * shared:docLayout），界面只许消费这个名单，不许再写一份。
 */

/**
 * 全部合法取值，顺序即「第一项默认选中」的那一项（初始化卡没有答过时按第一项预选，见
 * src/client/statusbar/StatusBackend.ts 的 SETUP_LAYOUT_FALLBACK）。
 * 只读：调用方要可变副本自己拷一份，不许改这份名单本身。
 * 取值与类型只写这一处：类型从名单推出。加第三种取值只改这一行的名单，但界面文案键
 * （kernel/prompts.ts 的 SETUP_LAYOUT_TEXT_KEYS 与 config/copy 词表）要同步各补一条。
 */
export const DOC_LAYOUT_VALUES = ['single', 'multi'] as const

/** 域文档布局的取值：单上下文（根目录一份总表）还是多上下文（子项目各一份加一份总表）；由上面的名单推出，别处不再手写联合。 */
export type DocLayoutValue = (typeof DOC_LAYOUT_VALUES)[number]
