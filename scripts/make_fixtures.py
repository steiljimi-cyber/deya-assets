"""Deterministic synthetic test photos (no third-party images needed)."""
import numpy as np, os, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter
out = sys.argv[1] if len(sys.argv) > 1 else "tests/fixtures"
os.makedirs(out, exist_ok=True)
rng = np.random.default_rng(42)

def to8(lin):
    a = np.clip(lin, 0, 1)
    e = np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(a, 1 / 2.4) - 0.055)
    return (np.clip(e, 0, 1) * 255 + 0.5).astype(np.uint8)

W, H = 3000, 2000
y, x = np.mgrid[0:H, 0:W].astype(np.float32)
img = np.zeros((H, W, 3), np.float32)
# sky gradient (linear light)
t = y / H
img[...] = np.stack([0.25 + 0.35 * t, 0.42 + 0.25 * t, 0.85 - 0.2 * t], -1) * 0.6
# ground
g = y > H * 0.62
img[g] = np.array([0.08, 0.11, 0.05]) + 0.04 * rng.random((g.sum(), 1))
# sun / lamp highlights (well above 1.0 after exposure → halation test)
for cx, cy, r, c in [(2400, 420, 90, (1.0, 0.95, 0.85)), (700, 1400, 35, (1.0, 0.7, 0.35)), (1100, 1380, 20, (1.0, 0.75, 0.4))]:
    d = np.hypot(x - cx, y - cy)
    m = np.clip(1.5 - d / r, 0, 1)
    img += m[..., None] * np.array(c) * 0.99
# colour patches (Macbeth-ish, sRGB values)
patches = [(115,82,68),(194,150,130),(98,122,157),(87,108,67),(133,128,177),(103,189,170),(214,126,44),(80,91,166),(193,90,99),(94,60,108),(157,188,64),(224,163,46),(56,61,150),(70,148,73),(175,54,60),(231,199,31),(187,86,149),(8,133,161),(243,243,242),(200,200,200),(160,160,160),(122,122,121),(85,85,85),(52,52,52)]
pw = 110
for i, c in enumerate(patches):
    px, py = 300 + (i % 6) * (pw + 12), 1450 + (i // 6) * (pw + 12)
    lin = np.array([((v / 255 + 0.055) / 1.055) ** 2.4 for v in c], np.float32)
    img[py:py + pw, px:px + pw] = lin
# skin-tone face-like ellipse with soft shading
d = ((x - 1700) / 260) ** 2 + ((y - 1150) / 330) ** 2
m = np.clip((1 - d) * 4, 0, 1)
shade = 0.75 + 0.25 * np.clip((x - 1500) / 400, 0, 1)
skin = np.array([0.62, 0.38, 0.27]) * shade[..., None]
img = img * (1 - m[..., None]) + skin * m[..., None]
# smooth grey ramp (banding test)
img[1900:1990, 1300:2900] = np.linspace(0, 1, 1600, dtype=np.float32)[None, :, None] ** 2.2
im = Image.fromarray(to8(img))
dr = ImageDraw.Draw(im)
for i in range(0, 600, 6):  # fine lines: resampling / aliasing detail
    dr.line([(2300 + i, 1450), (2300 + i, 1850)], fill=(240, 240, 240) if (i // 6) % 2 else (20, 20, 20), width=2)
dr.text((2350, 1300), "FIXER FILM LAB 0123456789", fill=(250, 250, 250))
im.save(os.path.join(out, "scene.jpg"), quality=95, icc_profile=None)
im.rotate(90, expand=True).save(os.path.join(out, "portrait.jpg"), quality=92)
# 16-bit TIFF chart in linear-ish smooth gradients
arr = (np.clip(to8(img[:1000, :1500]).astype(np.float32) / 255, 0, 1) * 65535).astype(np.uint16)
Image.fromarray(arr[..., 0]).save(os.path.join(out, "mono16.png"))
small = im.resize((600, 400), Image.LANCZOS)
small.save(os.path.join(out, "small.png"))
# textures for the library test
tdir = os.path.join(out, "textures")
for sub in ["Light Leaks", "dust & scratches", "misc", "Paper"]:
    os.makedirs(os.path.join(tdir, sub), exist_ok=True)
lk = np.zeros((800, 1200, 3), np.float32)
d = np.hypot(np.mgrid[0:800, 0:1200][1] - 1200, np.mgrid[0:800, 0:1200][0] - 100)
lk[..., 0] = np.clip(1.2 - d / 900, 0, 1); lk[..., 1] = np.clip(0.9 - d / 700, 0, 1) * 0.6; lk[..., 2] = np.clip(0.5 - d / 600, 0, 1) * 0.2
Image.fromarray((lk * 255).astype(np.uint8)).save(os.path.join(tdir, "Light Leaks", "leak 01.jpg"), quality=92)
dust = np.zeros((1000, 1000), np.uint8)
for _ in range(400):
    cx, cy, r = rng.integers(0, 1000), rng.integers(0, 1000), rng.integers(1, 5)
    dust[max(cy - r, 0):cy + r, max(cx - r, 0):cx + r] = 255
Image.fromarray(dust).convert("RGB").save(os.path.join(tdir, "dust & scratches", "specks.png"))
paper = (rng.normal(225, 8, (900, 900, 1)).clip(0, 255) * np.array([1.0, 0.98, 0.93])).astype(np.uint8)
Image.fromarray(paper).filter(ImageFilter.GaussianBlur(1.2)).save(os.path.join(tdir, "Paper", "cotton.jpg"))
gl = np.zeros((600, 900, 3), np.uint8)
for row in range(0, 600, 8):
    gl[row:row + 4, :, rng.integers(0, 3)] = 255
    gl[row:row + 4] = np.roll(gl[row:row + 4], rng.integers(-200, 200), axis=1)
Image.fromarray(gl).save(os.path.join(tdir, "misc", "IMG_2041.png"))
print("fixtures in", out)
