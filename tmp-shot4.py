
from PIL import Image
import numpy as np
src = r"C:\Users\辰辰洋洋\.dsh\attachments\v1\objects\1b\1ba8ba5cd04b3eb6dfb8ae7f7ab2d1e54e53890680570f4847ebc8881eaabb76"
im = Image.open(src).convert("RGB")
arr = np.asarray(im).astype(int)
def stats(x0,y0,x1,y1,label):
    reg = arr[y0:y1, x0:x1]
    lum = reg.sum(axis=2)
    print("====", label, "x", x0, x1, "y", y0, y1)
    print("lum p1/p5/p50/p95/p99/max:", [int(np.percentile(lum,p)) for p in (1,5,50,95,99)], int(lum.max()))
    dk = (lum < 650).sum(); br = (lum > 740).sum()
    print("count lum<650 (dark glyphs):", int(dk), " lum>740 (bright glyphs):", int(br), " of", lum.size)
    ys,xs = np.where(lum < 620)
    if len(xs):
        print(" dark glyph color sample:", arr[y0+ys[0], x0+xs[0]], "count", len(xs))
    ys2,xs2 = np.where(lum > 745)
    if len(xs2):
        print(" bright glyph sample:", arr[y0+ys2[0], x0+xs2[0]], "count", len(xs2))
stats(120, 46, 860, 74, "reason row full")
stats(120, 46, 300, 74, "reason row left (labels)")
stats(320, 46, 860, 74, "reason row values")
stats(120, 80, 860, 104, "gain row full")

