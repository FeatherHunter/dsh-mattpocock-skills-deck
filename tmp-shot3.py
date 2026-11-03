
from PIL import Image
src = r"C:\Users\辰辰洋洋\.dsh\attachments\v1\objects\1b\1ba8ba5cd04b3eb6dfb8ae7f7ab2d1e54e53890680570f4847ebc8881eaabb76"
im = Image.open(src).convert("RGB")
w,h = im.size
print("size", w, h)
# 理由行区域 x 120..880, y 44..72
x0,y0,x1,y1 = 120,44,880,74
buckets = {}
dark = 0; bright = 0; total = 0
import numpy as np
arr = np.asarray(im).astype(int)
reg = arr[y0:y1, x0:x1]
lum = reg.sum(axis=2)
print("lum min/max/mean", lum.min(), lum.max(), round(lum.mean(),1))
for th in [200, 260, 320, 380, 440, 500, 560, 620, 680, 700, 710, 720]:
    print("pixels lum<" + str(th) + ":", int((lum < th).sum()))
print("pixels lum>690:", int((lum > 690).sum()), "of", lum.size)
# 找暗像素的坐标分布，看看是不是只在某些列（比如标签列）
ys, xs = np.where(lum < 320)
print("dark pixel count", len(xs))
if len(xs):
    print("dark x range", xs.min()+x0, xs.max()+x0, "y range", ys.min()+y0, ys.max()+y0)
    # 列直方图（每 20px 一桶）
    hist = {}
    for xx in (xs+x0):
        b = int(xx//20)*20
        hist[b] = hist.get(b,0)+1
    print("dark col hist:", dict(sorted(hist.items())))
# 亮像素分布（比背景更亮）
ys2, xs2 = np.where(lum > 695)
print("bright pixel count", len(xs2))
if len(xs2):
    hist2 = {}
    for xx in (xs2+x0):
        b = int(xx//20)*20
        hist2[b] = hist2.get(b,0)+1
    print("bright col hist:", dict(sorted(hist2.items())))
# 放大裁切保存
crop = im.crop((120, 40, 560, 110)).resize((440*4, 70*4), Image.LANCZOS)
crop.save(r"D:\dsh-plugin\dsh-mattpocock-skills-deck\tmp-shot3-zoom.png")
print("saved crop")

