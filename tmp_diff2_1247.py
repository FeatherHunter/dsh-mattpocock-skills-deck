"""Transpile-diff part 2: compare tmp_tscheck/*.out.js with src/host/*.js (normalized)."""
import pathlib
import difflib

ROOT = pathlib.Path(r"D:\dsh-plugin\dsh-mattpocock-skills-deck")
HOST = ROOT / "src" / "host"
OUT = ROOT / "tmp_tscheck"
FILES = [
    "logStore", "mapBody", "mapTickets", "namingGuardian", "pickerShell",
    "rpcChannel", "runningMarkers", "sessionLifecycle", "settingsPhones",
    "skillDoc", "skillProbe",
]

def normalize(text: str) -> list:
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
    ts_out = (OUT / (base + ".out.js")).read_text(encoding="utf-8")
    a = normalize(js)
    b = normalize(ts_out)
    if a == b:
        print(f"{base}: IDENTICAL ({len(a)} lines)")
        continue
    diff = list(difflib.unified_diff(a, b, lineterm="", n=0))
    print(f"{base}: DIFFERS ({len(a)} vs {len(b)} norm lines):")
    shown = 0
    for d in diff:
        if d.startswith("---") or d.startswith("+++") or d.startswith("@@"):
            continue
        print("   ", d[:240])
        shown += 1
        if shown > 30:
            print("    ... (truncated)")
            break
    problems += 1

print("PROBLEMS:", problems)
