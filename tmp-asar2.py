
path = r"D:\DeepseekHarness\resources\app.asar"
needles = [b"--dsw-alias-label-primary:", b"--dsw-alias-label-secondary:", b"sugg-pop-value", b"dsws-sugg-pop"]
found = {n: [] for n in needles}
size = __import__("os").path.getsize(path)
chunk = 4*1024*1024
carry = b""
pos = 0
with open(path, "rb") as f:
    while pos < size:
        buf = f.read(chunk)
        if not buf: break
        data = carry + buf
        for n in needles:
            idx = 0
            while len(found[n]) < 4:
                i = data.find(n, idx)
                if i < 0: break
                start = max(0, i-500); end = min(len(data), i+900)
                snippet = data[start:end].decode("utf-8", "replace")
                found[n].append((pos - len(carry) + i, snippet))
                idx = i + 1
        carry = data[-1400:]
        pos += len(buf)
for n in needles:
    print("=====", n.decode(), "hits:", len(found[n]))
    for off, snip in found[n][:4]:
        print("--- off", off)
        print(snip.replace("\n"," ")[:900])

