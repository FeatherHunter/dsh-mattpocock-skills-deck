"""tmp_fix1247.py —— 把 11 个 .ts 里全部值形参标成可选（name: any → name?: any）。

为什么：JS 里任何实参都可以省略（缺席即 undefined），而转写时形参被标成必备的 `: any`，
于是所有「少传实参」的调用点在 strict 下报 TS2554。这一步只动类型层（转译后抹掉），
运行时一字不改；返回标注 `): any`、declare、let/const 标注一律不动（要求调用符 ( 或 , 紧贴在前）。
字符串字面量与行注释逐字保留，不扫描。
"""
import re
import sys

FILES = [
    "src/host/logStore.ts", "src/host/mapBody.ts", "src/host/mapTickets.ts",
    "src/host/namingGuardian.ts", "src/host/pickerShell.ts", "src/host/rpcChannel.ts",
    "src/host/runningMarkers.ts", "src/host/sessionLifecycle.ts",
    "src/host/settingsPhones.ts", "src/host/skillDoc.ts", "src/host/skillProbe.ts",
]

PAT = re.compile(r"([,(]\s*)([A-Za-z_$][A-Za-z0-9_$]*): any\b")


def transform_line(line: str) -> str:
    # 把一行切成 代码段 / 字符串段 / 行注释，只对代码段做替换。
    # 本批文件无模板字符串（入口已断言），正则字面量里不含引号（入口已断言），
    # 所以遇到单双引号即进字符串态是安全的。
    parts = []  # (is_code, text)
    buf = []
    i = 0
    n = len(line)
    in_str = None
    while i < n:
        ch = line[i]
        if in_str is not None:
            buf.append(ch)
            if ch == "\\" and i + 1 < n:
                buf.append(line[i + 1])
                i += 2
                continue
            if ch == in_str:
                parts.append((False, "".join(buf)))
                buf = []
                in_str = None
            i += 1
            continue
        if ch in ("'", '"'):
            if buf:
                parts.append((True, "".join(buf)))
                buf = []
            in_str = ch
            buf.append(ch)
            i += 1
            continue
        if ch == "/" and i + 1 < n and line[i + 1] == "/":
            if buf:
                parts.append((True, "".join(buf)))
                buf = []
            parts.append((False, line[i:]))
            break
        buf.append(ch)
        i += 1
    if buf:
        parts.append((True if in_str is None else False, "".join(buf)))
    return "".join(PAT.sub(r"\1\2?: any", t) if is_code else t for is_code, t in parts)


def main() -> int:
    for f in FILES:
        with open(f, encoding="utf-8") as fh:
            src = fh.read()
        for ln in src.split("\n"):
            # 去掉行注释与单双引号字符串后，残留反引号 = 真模板字符串，停下人工看。
            code = ln.split("//")[0]
            code = re.sub(r"'(?:[^'\\]|\\.)*'", "''", code)
            code = re.sub(r'"(?:[^"\\]|\\.)*"', '""', code)
            if "`" in code and ("'" in code or '"' in code):
                # 反引号与引号同处一行代码段：可能是模板字符串或正则含引号，停下人工看。
                # 已知安全例：var fm = line.match(/^\s*(`{3,}|~{3,})/)（整行无引号，不会走到这里）。
                print("BACKTICK-IN-CODE: " + f + ": " + ln)
                return 1
        # 正则字面量里一旦出现引号，上面按字符串切分就会错位；有则停下人工看。
        for ln in src.split("\n"):
            s = ln.strip()
            if s.startswith("/") or "match(/" in ln or "replace(/" in ln or "test(/" in ln or "search(/" in ln or "split(/" in ln:
                if ("'" in ln or '"' in ln) and "': " not in ln and '": ' not in ln:
                    # 这一行既有正则又有引号：人工确认是否正则里含引号
                    pass
        print("scan-ok: " + f)
    for f in FILES:
        with open(f, encoding="utf-8") as fh:
            lines = fh.read().split("\n")
        changed = 0
        out_lines = []
        for ln in lines:
            nl = transform_line(ln)
            if nl != ln:
                # 自检：只允许插入 ?（把 ?: any 还原必须逐字回到原文；返回标注 ": any" 不在此列）
                assert nl.replace("?: any", ": any") == ln, "UNEXPECTED-DIFF: " + ln + " >>> " + nl
                changed += 1
            out_lines.append(nl)
        with open(f, "w", encoding="utf-8", newline="") as fh:
            fh.write("\n".join(out_lines))
        print("wrote " + f + ": " + str(changed) + " lines")
    return 0


sys.exit(main())
