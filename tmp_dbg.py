import re

line = "          try { ctx.effect(() => () => { try { if (typeof _skillsInvalidateSub === 'function') _skillsInvalidateSub(); } catch {} _skillsInvalidateSub = null }) } catch {}"
m = re.match(r"^(\s*(?:async\s+)?)([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*(\{.*)$", line)
print("method match:", m.groups() if m else None)

# arrow paren regex: find all matches
for m2 in re.finditer(r"(async\s+)?\(([^)]*)\)\s*=>", line):
    print("arrow match:", repr(m2.group(0)), "params:", repr(m2.group(2)))

# single arrow regex
for m3 in re.finditer(r"(?<![\w$):\"'])\b([A-Za-z_$][\w$]*)\s*=>", line):
    print("single match:", repr(m3.group(0)))
