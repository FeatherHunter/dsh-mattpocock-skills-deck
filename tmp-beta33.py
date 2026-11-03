
import os, glob, json
paths = glob.glob(r"C:\\Users\\辰辰洋洋\\.dsh\\profiles\\desktop\\node_modules\\.dsh-mattpocock-skills-deck-beta33-backup-20261102-192134/**/client.js", recursive=True) + glob.glob(r"C:\\Users\\辰辰洋洋\\.dsh\\profiles\\desktop\\node_modules\\.dsh-mattpocock-skills-deck-beta33-backup-20261102-192134/**/suggestStyles*", recursive=True) + glob.glob(r"C:\\Users\\辰辰洋洋\\.dsh\\profiles\\desktop\\node_modules\\.dsh-mattpocock-skills-deck-beta33-backup-20261102-192134/**/suggestAppearance*", recursive=True)
print("files:", paths[:10])
for f in paths:
    s = open(f, encoding="utf-8", errors="replace").read()
    for key in ["popLabelText", "popText", "dsws-sugg-pop{", "dsws-sugg-pop-label"]:
        i = s.find(key)
        print(f, "|", key, "->", "MISSING" if i<0 else repr(s[max(0,i-120):i+180]))

