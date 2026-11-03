
import os
f = r"C:\Users\辰辰洋洋\.dsh\profiles\desktop\node_modules\dsh-mattpocock-skills-deck\lib\client.js"
s = open(f, encoding="utf-8", errors="replace").read()
for key in ["popText", "popLabelText", "popBg", "lightPopBg"]:
    idx = 0; n = 0
    while True:
        i = s.find(key, idx)
        if i < 0: break
        n += 1
        if n <= 3:
            print("====", key, "occ", n, "@", i)
            print(repr(s[max(0,i-160):i+260]))
        idx = i + 1
    print(f"total {key}: {n}")

