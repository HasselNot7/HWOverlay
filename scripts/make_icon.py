"""生成应用图标 assets/app.ico —— 与 frontend/public/favicon.svg 同款设计：
CPU 芯片轮廓 + 监控心跳线，HeroUI 蓝描在深色圆角底上。

    python scripts/make_icon.py

Pillow 直接按 24 格设计稿画（1 单位 = 88px，超采样后缩到各尺寸抗锯齿）。
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "app.ico"

# 设计稿坐标按 24x24 网格给，S 是每格像素数（超采样）
S = 88
BLUE = (56, 132, 255, 255)      # text-primary，与侧栏品牌色一致
BG_TOP = (30, 33, 40, 255)      # 深色底，微渐变到 BG_BOT
BG_BOT = (18, 19, 23, 255)
N = 24 * S


def seg(d, p1, p2, w):
    """带圆头的线段：直线 + 两端圆帽（PIL 的 line 不画圆帽）。"""
    d.line([p1, p2], fill=BLUE, width=int(w))
    r = w / 2
    for x, y in (p1, p2):
        d.ellipse([x - r, y - r, x + r, y + r], fill=BLUE)


def build() -> Image.Image:
    img = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # 圆角底 + 纵向渐变
    mask = Image.new("L", (N, N), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, N - 1, N - 1], radius=int(5.2 * S), fill=255)
    grad = Image.new("RGBA", (N, N))
    gd = ImageDraw.Draw(grad)
    for y in range(N):
        t = y / N
        gd.line([(0, y), (N, y)],
                fill=tuple(int(a + (b - a) * t) for a, b in zip(BG_TOP, BG_BOT)))
    img.paste(grad, (0, 0), mask)
    # 极淡的描边，让图标在深色任务栏上有个边界
    d.rounded_rectangle([S * 0.2, S * 0.2, N - S * 0.2, N - S * 0.2],
                        radius=int(5.0 * S), outline=(56, 132, 255, 60), width=int(0.5 * S))

    lw = 1.9 * S
    u = lambda v: v * S  # noqa: E731 设计稿坐标换算

    # 芯片本体
    d.rounded_rectangle([u(6.5), u(6.5), u(17.5), u(17.5)],
                        radius=u(2.6), outline=BLUE, width=int(lw))
    # 引脚：每边三根
    for c in (9.5, 12, 14.5):
        seg(d, (u(c), u(6.5)), (u(c), u(3.6)), lw)
        seg(d, (u(c), u(17.5)), (u(c), u(20.4)), lw)
        seg(d, (u(6.5), u(c)), (u(3.6), u(c)), lw)
        seg(d, (u(17.5), u(c)), (u(20.4), u(c)), lw)
    # 心跳线
    pulse = [(8.7, 12), (10.0, 12), (11.1, 9.6), (12.8, 14.3), (13.9, 12), (15.4, 12)]
    for a, b in zip(pulse, pulse[1:]):
        seg(d, (u(a[0]), u(a[1])), (u(b[0]), u(b[1])), 1.7 * S)
    return img


def main():
    OUT.parent.mkdir(exist_ok=True)
    img = build().resize((256, 256), Image.LANCZOS)
    img.save(OUT, format="ICO", sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
    # 顺手存一张 PNG 预览，方便肉眼检查
    img.save(OUT.parent / "app_preview.png")
    print(f"已生成 {OUT}")


if __name__ == "__main__":
    main()
