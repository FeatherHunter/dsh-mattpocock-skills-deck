"""一次性脚本：#1047 第二节取一手来源用——从 app.asar 里读出 dsh-fs-sandbox / dsh-sandbox 的实现源码到本地文件。"""
import struct, json, os, sys

ASAR = r'D:\DeepseekHarness\resources\app.asar'
OUT = r'D:\dsh-plugin\dsh-mattpocock-skills-deck\.r1047tmp\asar-out'

f = open(ASAR, 'rb')
hdr = f.read(16)
_, _, _, jsonlen = struct.unpack('<IIII', hdr)
raw = f.read(jsonlen)
header = json.loads(raw.decode('utf-8'))
base = 8 + jsonlen
# asar header 里 files 的 size 字段是字符串（可能有前导空格），offset 也是字符串
def to_int(v):
    if isinstance(v, str):
        return int(v.strip())
    return int(v)

def walk(node, prefix):
    for name, child in node.get('files', {}).items():
        p = prefix + '/' + name
        if 'files' in child:
            yield from walk(child, p)
        else:
            yield p, child

targets = []
for path, meta in walk(header, ''):
    if 'dsh-fs-sandbox' in path or '/dsh-sandbox/' in path or 'dsh-sandbox-policy' in path or 'dsh-fs-local' in path:
        targets.append((path, meta))

print('found %d entries' % len(targets))
for path, meta in targets:
    if meta.get('unpacked'):
        print('UNPACKED', path)
os.makedirs(OUT, exist_ok=True)
for path, meta in targets:
    rel = path.lstrip('/')
    dest = os.path.join(OUT, rel.replace('/', os.sep))
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    off = to_int(meta['offset'])
    size = to_int(meta['size'])
    f.seek(base + off)
    data = f.read(size)
    with open(dest, 'wb') as g:
        g.write(data)
    print('%-90s %8d bytes' % (rel, size))
