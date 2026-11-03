
import os, re
files = ["C:\\Users\\辰辰洋洋\\.dsh\\profiles\\desktop\\node_modules\\dsh-mattpocock-skills-deck\\lib\\client.js","C:\\Users\\辰辰洋洋\\.dsh\\profiles\\desktop\\node_modules\\dsh-mattpocock-skills-deck\\client.js","D:\\dsh-plugin\\dsh-mattpocock-skills-deck\\client.js","D:\\dsh-plugin\\dsh-mattpocock-skills-deck\\package\\lib\\client.js"]
for f in files:
    print("=====", f, "exists:", os.path.exists(f))
    if not os.path.exists(f):
        continue
    print("size", os.path.getsize(f), "mtime", __import__("datetime").datetime.fromtimestamp(os.path.getmtime(f)))
    s = open(f, encoding="utf-8", errors="replace").read()
    idx = 0
    n = 0
    while True:
        i = s.find("dsws-sugg-pop", idx)
        if i < 0:
            break
        n += 1
        snippet = s[max(0,i-80):i+220]
        if n <= 12:
            print("--- occurrence", n, "@", i)
            print(repr(snippet))
        idx = i + 1
    print("total occurrences:", n)

