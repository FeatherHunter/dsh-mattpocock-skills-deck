"""一次性脚本：#1047 取一手来源用——按行号打印 asar 里抽出来的 DSH 源码（原文件含非 UTF-8 字节）。"""
import sys

path = sys.argv[1]
start = int(sys.argv[2])
end = int(sys.argv[3])
data = open(path, 'rb').read().decode('utf-8', 'replace')
lines = data.split('\n')
for i in range(start - 1, min(end, len(lines))):
    print('%5d| %s' % (i + 1, lines[i]))
