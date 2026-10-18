"""Transpile-diff: prove each generated .ts is runtime-identical to its .js.
Uses esbuild to strip types, then normalizes (drop comments/blank lines) and diffs.
"""
import pathlib
import subprocess
import re

ROOT = pathlib.Path(r"D:\dsh-plugin\dsh-mattpocock-skills-deck")
HOST = ROOT / "src" / "host"
FILES = [
    "logStore", "mapBody", "mapTickets", "namingGuardian", "pickerShell",
    "rpcChannel", "runningMarkers", "sessionLifecycle", "settingsPhones",
    "skillDoc", "skillProbe",
]

def normalize(text: str) -> list:
    # drop single-line comments (whole-line only to avoid touching strings) and blank lines
    out = []
    in_block = False
    for line in text.split("\n"):
        s = line.strip()
        if in_block:
            if "*/" in s:
                in_block = False
            continue
        if s.startswith("//"):
            continue
        if s.startswith("/*"):
            if "*/" not in s:
                in_block = True
            continue
        if not s:
            continue
        out.append(s)
    return out

problems = 0
for base in FILES:
    js = (HOST / (base + ".js")).read_text(encoding="utf-8")
    r = subprocess.run(
        ["npx", "esbuild", str(HOST / (base + ".ts")), "--loader=ts", "--format=esm"],
        capture_output=True, text=True, cwd=str(ROOT),
    )
    if r.returncode != 0:
        print(f"{base}: ESBUILD FAIL\n{r.stderr[:2000]}")
        problems += 1
        continue
    a = normalize(js)
    b = normalize(r.stdout)
    # esbuild may add/remove trailing semicolons? compare directly first
    if a == b:
        print(f"{base}: IDENTICAL ({len(a)} lines)")
        continue
    # show first few differing lines
    import difflib
    diff = list(difflib.unified_diff(a, b, lineterm="", n=1))
    print(f"{base}: DIFFERS ({len(a)} vs {len(b)} norm lines), first hunks:")
    shown = 0
    for d in diff:
        print("   ", d[:220])
        shown += 1
        if shown > 25:
            print("    ... (truncated)")
            break
    problems += 1

print("PROBLEMS:", problems)
