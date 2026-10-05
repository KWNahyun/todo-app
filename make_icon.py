"""앱 아이콘(icon.ico) 생성.
숲 그라데이션 바탕 + 앱의 '완료 체크' 동그라미 + 위로 돋아난 새싹 두 잎 + 햇살 점."""
from PIL import Image, ImageDraw, ImageFilter

S = 1024  # 크게 그린 뒤 줄여서 가장자리를 매끄럽게


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def hex_rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


# 1) 둥근 사각형 바탕: 위는 밝은 숲, 아래는 짙은 숲
top, bottom = hex_rgb("#5a9e63"), hex_rgb("#2c5a36")
grad = Image.new("RGB", (S, S))
gd = ImageDraw.Draw(grad)
for y in range(S):
    gd.line([(0, y), (S, y)], fill=lerp(top, bottom, y / S))
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle((32, 32, S - 32, S - 32), radius=230, fill=255)
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
img.paste(grad, (0, 0), mask)

# 위쪽 은은한 빛 (유리 느낌)
shine = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(shine).ellipse((-200, -520, S + 200, 430), fill=(255, 255, 255, 34))
img.alpha_composite(Image.composite(shine, Image.new("RGBA", (S, S)), mask))

# 2) 새싹: 두 잎 (동그라미 뒤에서 위로 돋아남)
def leaf(cx, cy, w, h, angle, color):
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(layer).ellipse((cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2), fill=color)
    # 잎맥
    ImageDraw.Draw(layer).line([(cx, cy + h / 2 - 30), (cx, cy - h / 2 + 50)], fill=(63, 122, 74, 70), width=9)
    return layer.rotate(angle, center=(cx, cy + h / 2), resample=Image.BICUBIC)

stem_x, stem_y = 512, 300
ImageDraw.Draw(img).line([(stem_x, 420), (stem_x, stem_y)], fill="#a8d69a", width=26)
img.alpha_composite(leaf(stem_x - 95, stem_y - 70, 150, 250, 48, "#b7e0a5"))
img.alpha_composite(leaf(stem_x + 95, stem_y - 70, 150, 250, -48, "#cdeab9"))

# 3) 동그라미 그림자 + 크림색 동그라미 + 초록 체크
cx, cy, r = 512, 600, 250
shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(shadow).ellipse((cx - r, cy - r + 28, cx + r, cy + r + 28), fill=(16, 40, 22, 120))
img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(26)))
d = ImageDraw.Draw(img)
d.ellipse((cx - r, cy - r, cx + r, cy + r), fill="#fbf6ec")
d.ellipse((cx - r + 26, cy - r + 26, cx + r - 26, cy + r - 26), outline="#e9dcc2", width=10)
pts = [(cx - 125, cy + 5), (cx - 35, cy + 100), (cx + 140, cy - 95)]
d.line(pts, fill="#3f7a4a", width=72, joint="curve")
for x, y in (pts[0], pts[-1]):
    d.ellipse((x - 36, y - 36, x + 36, y + 36), fill="#3f7a4a")

# 4) 햇살(진행 중 타이머) 점
d.ellipse((800, 120, 900, 220), fill="#f0b64a")
d.ellipse((818, 138, 860, 180), fill=(255, 236, 190, 200))

# 크기마다 1024 원본에서 따로 줄여 담음 (작은 크기를 256에서 또 줄이면 흐려짐).
# 고배율 화면(150~200%)의 작업 표시줄·창 제목용으로 40/64/96 도 포함.
SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
frames = [img.resize((n, n), Image.LANCZOS) for n in SIZES]
frames[-1].save("icon.ico", sizes=[(n, n) for n in SIZES], append_images=frames[:-1])
frames[-1].save("icon.png")
# 작은 크기 확인용 미리보기
preview = Image.new("RGBA", (256 + 16 + 48 + 16 + 32 + 16 + 16 + 16, 256), (243, 233, 214, 255))
x = 0
for size in (256, 48, 32, 16):
    preview.alpha_composite(img.resize((size, size), Image.LANCZOS), (x, (256 - size) // 2))
    x += size + 16
preview.save("icon_preview.png")
print("icon.ico 생성")
