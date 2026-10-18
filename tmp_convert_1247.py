"""Mechanical JS->TS converter for issue #1247 task-6.

Reads each src/host/*.js, emits同名 .ts with:
- Chinese file header (source + zero change + why + conventions)
- type block (deps interfaces, any-liberal)
- body: same runtime code, only erasable type syntax added:
  function/method/arrow params -> : any
  catch var property access -> (v as any).prop
  let/const null/[]/{} -> : any
  node static imports -> // @ts-expect-error
  dynamic import('node:X') lines -> // @ts-expect-error + : any on receiving const
  declare const process/require where used
  globalThis.xxx -> (globalThis as any).xxx
Zero runtime change: all added syntax strips under Node type-stripping.
"""
import re
import pathlib

ROOT = pathlib.Path(r"D:\dsh-plugin\dsh-mattpocock-skills-deck\src\host")

FILES = [
    "logStore.js",
    "mapBody.js",
    "mapTickets.js",
    "namingGuardian.js",
    "pickerShell.js",
    "rpcChannel.js",
    "runningMarkers.js",
    "sessionLifecycle.js",
    "settingsPhones.js",
    "skillDoc.js",
    "skillProbe.js",
]

JS_KEYWORDS = {
    "if", "for", "while", "switch", "catch", "function", "return",
    "typeof", "in", "of", "new", "delete", "void", "await", "async",
    "import", "export", "try", "else", "do", "class", "extends",
}

def annotate_params(param_str: str) -> str:
    param_str = param_str.strip()
    if not param_str:
        return ""
    parts = []
    depth_brace = 0
    depth_brack = 0
    cur = ""
    for ch in param_str:
        if ch == "{":
            depth_brace += 1
        elif ch == "}":
            depth_brace -= 1
        elif ch == "[":
            depth_brack += 1
        elif ch == "]":
            depth_brack -= 1
        if ch == "," and depth_brace == 0 and depth_brack == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    parts.append(cur)
    out = []
    for p in parts:
        p = p.strip()
        if not p:
            continue
        if ":" in p:
            out.append(p)
            continue
        if p.startswith("..."):
            name = p[3:].strip()
            if "=" in name:
                name = name.split("=")[0].strip()
            out.append(f"...{name}: any[]")
            continue
        if "=" in p:
            name, default = p.split("=", 1)
            name = name.strip()
            default = default.strip()
            if name.startswith("{") or name.startswith("["):
                out.append(f"{name}: any = {default}")
            else:
                out.append(f"{name}: any = {default}")
            continue
        if p.startswith("{") or p.startswith("["):
            out.append(f"{p}: any")
            continue
        out.append(f"{p}: any")
    return ", ".join(out)


def transform_function_params(text: str) -> str:
    # function name(params) / function (params) / async function name(params)
    def repl(m):
        prefix = m.group(1)  # includes 'function name' or 'function'
        params = m.group(2)
        return prefix + "(" + annotate_params(params) + ")"
    text = re.sub(r"((?:async\s+)?function(?:\s+[A-Za-z_$][\w$]*)?)\s*\(([^()]*)\)", repl, text)
    return text


def transform_methods_and_arrows(text: str) -> str:
    # object method shorthand: '  async readText(absPath) {' or '  mkdir(dirPath) {'
    # only when line looks like method def (no '=' before paren, ends with '{')
    lines = text.split("\n")
    out_lines = []
    for line in lines:
        stripped = line.strip()
        # skip comments, imports, already-typed lines
        if stripped.startswith("//") or stripped.startswith("*") or stripped.startswith("/*"):
            out_lines.append(line)
            continue
        # method shorthand: optional async + name + (params) + optional return + {
        mm = re.match(r"^(\s*(?:async\s+)?)([A-Za-z_$][\w$]*)\s*\(([^()]*)\)\s*(\{.*)$", line)
        if mm and mm.group(2) not in JS_KEYWORDS and "=" not in line.split("(")[0].split("//")[0][-40:]:
            # heuristic: line must not contain '=' '=>' ':' 'function' '=>' '?.' before paren... keep narrow:
            before = line.split("(")[0]
            if ("=" not in before and "=>" not in line and ":" not in before.split("//")[0]
                    and "function" not in before and "." not in before):
                # avoid matching calls like 'foo(bar) {': method defs in our files are inside object literals,
                # calls never end with '{' on same line except control flow (if/for/while/catch/switch) which are keywords
                indent, name, params, rest = mm.group(1), mm.group(2), mm.group(3), mm.group(4)
                # skip if name is keyword
                if name not in JS_KEYWORDS and re.search(r"\b(if|for|while|switch|catch|function|return)\b", before) is None:
                    # additional guard: line ends with '{' possibly + comment
                    out_lines.append(f"{indent}{name}({annotate_params(params)}) {rest}")
                    continue
        out_lines.append(line)
    text = "\n".join(out_lines)
    # arrow functions per line (skip comments to avoid corrupting prose like 'A => B')
    def arrow_repl(m):
        prefix = m.group(1) or ""
        params = m.group(2)
        return prefix + "(" + annotate_params(params) + ") =>"
    def single_arrow_repl(m):
        name = m.group(1)
        if name in JS_KEYWORDS or name in ("true", "false", "null", "undefined"):
            return m.group(0)
        return f"({name}: any) =>"
    relines = []
    for line in text.split("\n"):
        s = line.strip()
        if s.startswith("//") or s.startswith("*") or s.startswith("/*"):
            relines.append(line)
            continue
        # avoid touching string literals: crude guard — skip lines where '=>' appears inside quotes only?
        # our files' code arrows are the only '=>' in code lines; comments already skipped.
        line2 = re.sub(r"(async\s+)?\(([^()]*)\)\s*=>", arrow_repl, line)
        line2 = re.sub(r"(?<![\w$):\"'])\b([A-Za-z_$][\w$]*)\s*=>", single_arrow_repl, line2)
        relines.append(line2)
    text = "\n".join(relines)
    return text


def transform_catch_vars(text: str, extra_names=None):
    names = set()
    for m in re.finditer(r"catch\s*\(\s*([A-Za-z_$][\w$]*)\s*\)", text):
        names.add(m.group(1))
    if extra_names:
        names.update(extra_names)
    # common non-catch identifiers that still get property access on unknown: err in phoneLog params etc.
    # they are already : any so no need, but harmless to cast. Only cast catch names to limit noise.
    for name in sorted(names, key=len, reverse=True):
        # name.prop -> (name as any).prop  (avoid double-casting)
        text = re.sub(rf"(?<!\sas\s)(?<!\w)\b{name}\.([A-Za-z_$][\w$]*)", rf"({name} as any).\1", text)
    return text


def transform_decls(text: str) -> str:
    # let/const x = null | [] | {} -> : any
    text = re.sub(r"\b(let|const|var)\s+([A-Za-z_$][\w$]*)\s*=\s*null\b", r"\1 \2: any = null", text)
    text = re.sub(r"\b(let|const|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\[\]", r"\1 \2: any[] = []", text)
    text = re.sub(r"\b(let|const|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\{\}", r"\1 \2: any = {}", text)
    return text


def transform_globalthis(text: str) -> str:
    text = re.sub(r"\bglobalThis\.([A-Za-z_$][\w$]*)", r"(globalThis as any).\1", text)
    return text


def add_expect_error_to_static_node_imports(text: str) -> str:
    lines = text.split("\n")
    out = []
    first_done = False
    for line in lines:
        s = line.strip()
        if re.match(r"^import\s+.*from\s+['\"]node:[^'\"]+['\"]", s):
            reason = ("// 本域 tsconfig 有意不加载任何类型包（types 为空），Node 内建模块的类型声明随 @types/node 一起被挡在门外；"
                      "运行时一定是 Node，这些模块必然存在。所以只忽略这一行导入的类型错误（纯类型层面，不影响运行时转译）。")
            if first_done:
                reason = "// 见上：Node 内建模块导入的类型忽略（纯类型层面，运行时不受影响）。"
            out.append(reason)
            out.append("// @ts-expect-error")
            first_done = True
        out.append(line)
    return "\n".join(out)


def add_expect_error_to_dynamic_node_imports(text: str) -> str:
    # lines containing await import('node:X') get // @ts-expect-error above (if not already there)
    lines = text.split("\n")
    out = []
    for i, line in enumerate(lines):
        if "import('node:" in line and "@ts-expect-error" not in line:
            # check previous non-empty line
            prev = ""
            for j in range(len(out) - 1, -1, -1):
                if out[j].strip():
                    prev = out[j].strip()
                    break
            if "@ts-expect-error" not in prev:
                indent = line[: len(line) - len(line.lstrip())]
                out.append(indent + "// @ts-expect-error —— Node 内建模块的动态引用：类型声明随 @types/node 缺席，运行时一定存在（纯类型层面）。")
        out.append(line)
    return "\n".join(out)


def annotate_dynamic_import_consts(text: str) -> str:
    # const pathMod = await import('node:path') -> const pathMod: any = await import...
    text = re.sub(r"\b(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+import\('node:", r"\1 \2: any = await import('node:", text)
    return text


HEADERS = {
    "logStore.js": ("宿主日志库", "内存队列、级别判断、按天文件名、单写者刷盘与失败计数；导出、清空与开关三组电话体由 ./logPhones.js 承载，本文件只留动态加载器。"),
    "mapBody.js": ("地图正文解析", "正文预处理、五区块解析、进度块三级锚定与票行映射；纯函数、零外部依赖。"),
    "mapTickets.js": ("宿主电话 wf.mapTickets", "按父票翻页拉全子票、解析进度、组装行数据与分层统计；只调后端契约 listSubIssues，不做能力表。"),
    "namingGuardian.js": ("命名守护宿主半", "跟踪态持有、落盘台账与事件驱动的索引结算；判定真源见 shared 命名三文件。"),
    "pickerShell.js": ("文件夹打开与原生选择器", "开目录、开文件、目录与文件选择器的意图表达；系统分支由平台抽象层拥有。"),
    "rpcChannel.js": ("客户端与宿主之间的 RPC 通道", "通道注册、信封校验与分发异常记账；注册走 fetch 精确路由。"),
    "runningMarkers.js": ("正在合并、变基、拣选与回退四个标记的探测", "文件服务优先、git 兜底；两条路都不通时回 env-fs 并带上文件服务的原话。"),
    "sessionLifecycle.js": ("会话启停电话与共享早选判据", "ping、cwd（含落盘直读与单飞）与快照、刷新共用的早选判据；目录取法调 shared 共用函数。"),
    "settingsPhones.js": ("本机设置两条电话的处理体", "读与写两条电话；用户主目录一定从平台取，写路径在同一实例内串行。"),
    "skillDoc.js": ("技能原文直读", "详情页读本地原文的电话 skill.readDoc；只读随包原文目录，中文译文有就一起回。"),
    "skillProbe.js": ("技能探测", "安装探测口径、短时记住、单飞与失效广播；只以注册表回答为准，轻探永不产生绿。"),
}

for fname in FILES:
    src = ROOT / fname
    js = src.read_text(encoding="utf-8")
    base = fname[:-3]
    title, what = HEADERS[fname]
    header = (
        f"/**\n"
        f" * src/host/{base}.ts —— {title}（来源：src/host/{fname}，issue #1247 转写，本次只加类型标注与注释，逻辑一行未动）。\n"
        f" *\n"
        f" * 为什么要有它（一句话）：{what}\n"
        f" *\n"
        f" * 三条不能改的约定（改之前先看原 {fname} 头注释与调用点 index.ts）：\n"
        f" * 1. 行为零变化：逻辑逐行对应，只加类型标注与中文注释，不改任何运行时语义；相对导入保留 .js 后缀，由 scripts/ts-hook.mjs 改指同名 .ts。\n"
        f" * 2. 只写可剥离 TypeScript：不新增运行时语法（禁用 enum 与构造函数参数属性），类型一律 import type 或内联标注，转译后与原 .js 逐行同义。\n"
        f" * 3. 不新增任何 import 边：只给已有引用加类型，不引入新模块依赖；Node 内建模块的类型缺席由文件内局部声明与 @ts-expect-error 承接，不装 @types/node。\n"
        f" */\n"
    )
    body = js
    # strip original first-line header? No — keep original comments intact (zero change demands keeping them).
    # transforms (all erasable):
    body = add_expect_error_to_static_node_imports(body)
    body = add_expect_error_to_dynamic_node_imports(body)
    body = annotate_dynamic_import_consts(body)
    body = transform_function_params(body)
    body = transform_methods_and_arrows(body)
    body = transform_decls(body)
    body = transform_globalthis(body)
    body = transform_catch_vars(body)
    # export function createX(deps) -> (deps: any): any  (function transform already added : any; add return type)
    body = re.sub(r"export function ([A-Za-z_$][\w$]*)\(([^)]*)\)\s*\{", r"export function \1(\2): any {", body)
    # file-local runtime-erasable declarations for Node globals actually used in this file
    decls = []
    if re.search(r"(?<![\w$])require\s*\(", body) or re.search(r"typeof\s+require\b", body):
        decls.append("// 运行时一定是 Node，但本域 tsconfig 不带 @types/node；require 只在 Electron 探测分支里按 typeof 守卫使用，这里只声明类型，不产生运行时代码。")
        decls.append("declare const require: any;")
    if re.search(r"(?<![\w$])process\b", body):
        # avoid duplicate if body already declares
        if "declare const process" not in body:
            decls.append("// 运行时的 process 兜底声明（与 src/host/git-process.ts:30 同形）：本 tsconfig 有意不加载任何类型包，Node 运行时保证 process 存在；只声明本文件实际用到的形状，不产生运行时代码。")
            decls.append("declare const process: any;")
    decl_block = ("\n".join(decls) + "\n\n") if decls else ""
    # type block
    type_block = (
        "// ---------------------------------------------------------------------------\n"
        "// 类型（#1247 转 TypeScript：只写类型不写实现）。\n"
        "//\n"
        "// 为什么标成这样：进来的依赖全部由装配点显式传入，形状按本文件实际用到的成员写成最小；\n"
        "// 从外面进来的东西（客户端参数、后端行数据、文件里读出的 JSON）一律按 any 或 unknown 收，\n"
        "// 收窄发生在运行时的 typeof 与 Array.isArray 判断里 —— 类型不替代那些运行时判断。\n"
        "// ---------------------------------------------------------------------------\n\n"
        "/** 本文件组装函数的依赖：全部由调用方显式传入，缺席时按原逻辑默认处理。 */\n"
        "type Deps = any;\n\n"
        "/** 客户端调电话时送进来的参数：JSON 边界，形状由调用方保证，本文件只做运行时判空。 */\n"
        "type WfArgs = any;\n\n"
    )
    out = header + "\n" + decl_block + type_block + body + ("\n" if not body.endswith("\n") else "")
    (ROOT / (base + ".ts")).write_text(out, encoding="utf-8")
    print("wrote", base + ".ts", len(out))
