
from PIL import Image
src = r"C:\Users\辰辰洋洋\.dsh\attachments\v1\objects\1b\1ba8ba5cd04b3eb6dfb8ae7f7ab2d1e54e53890680570f4847ebc8881eaabb76"
im = Image.open(src).convert("RGB")
w,h = im.size
print("size", w, h)
# 统计整个图里出现最多的 12 种颜色
from collections import Counter
c = Counter(im.getdata())
for color,n in c.most_common(15):
    print(color, n)
# 裁出气泡区域并放大 3 倍，存到仓库临时目录
crop = im.crop((0,0,w,h)).resize((w*3, h*3), Image.LANCZOS)
out = r"D:\dsh-plugin\dsh-mattpocock-skills-deck\tmp-suggest-bug-zoom.png"
crop.save(out)
print("saved", out)
# 采样几处：气泡背景、标签字、值字位置
def px(x,y):
    return im.getpixel((x,y))
print("popover bg sample (400,130):", px(400,130))
print("label pixel (60,40):", px(60,40))

