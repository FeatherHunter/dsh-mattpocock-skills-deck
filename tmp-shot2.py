
from PIL import Image
from collections import Counter
src = r"C:\Users\辰辰洋洋\.dsh\attachments\v1\objects\1b\1ba8ba5cd04b3eb6dfb8ae7f7ab2d1e54e53890680570f4847ebc8881eaabb76"
im = Image.open(src).convert("RGB")
w,h = im.size
def region_stats(x0,y0,x1,y1,label):
    px = []
    for y in range(y0,y1):
        for x in range(x0,x1):
            px.append(im.getpixel((x,y)))
    c = Counter(px)
    print(f"--- {label} ({x0},{y0})-({x1},{y1})")
    print("top colors:", c.most_common(5))
    lum = sorted(px, key=lambda p: p[0]+p[1]+p[2])
    print("darkest:", lum[:3], "brightest:", lum[-3:])
# 理由行的值（3x 图中 y ~ 150-205 → 原图 50-68；x 从 ~380/3=127 到 860）
region_stats(320, 48, 875, 70, "理由 value")
# 优点行的值
region_stats(320, 80, 875, 100, "优点 value")
# 标签列
region_stats(30, 30, 170, 140, "labels column")
# 气泡背景空白处
region_stats(700, 100, 860, 120, "bg blank right")

