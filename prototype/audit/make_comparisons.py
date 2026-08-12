from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent / "current"
BEFORE = ROOT / "before"
AFTER = ROOT / "after"
OUTPUT = ROOT / "comparisons"
OUTPUT.mkdir(parents=True, exist_ok=True)

FONT = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 22)
SMALL = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 16)


def contain(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    copy = image.copy().convert("RGB")
    copy.thumbnail(size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", size, "#171514")
    canvas.paste(copy, ((size[0] - copy.width) // 2, (size[1] - copy.height) // 2))
    return canvas


def board(name: str, reference: Path, implementation: Path, note: str) -> None:
    ref = contain(Image.open(reference), (640, 844))
    impl = contain(Image.open(implementation), (640, 844))
    canvas = Image.new("RGB", (1320, 940), "#11100e")
    draw = ImageDraw.Draw(canvas)
    canvas.paste(ref, (10, 62))
    canvas.paste(impl, (670, 62))
    draw.text((20, 18), "设计稿", font=FONT, fill="#ffe11a")
    draw.text((680, 18), "修复后实现", font=FONT, fill="#1bc8d1")
    draw.text((20, 914), note, font=SMALL, fill="#fff1c8")
    canvas.save(OUTPUT / f"{name}.jpg", quality=92)


def mobile_board(name: str, reference: Path, implementation: Path) -> None:
    ref = Image.open(reference).convert("RGB").resize((390, 844), Image.Resampling.LANCZOS)
    impl = Image.open(implementation).convert("RGB").resize((390, 844), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (840, 920), "#11100e")
    draw = ImageDraw.Draw(canvas)
    canvas.paste(ref, (20, 56))
    canvas.paste(impl, (430, 56))
    draw.text((20, 14), f"{name} · 设计稿", font=SMALL, fill="#ffe11a")
    draw.text((430, 14), "修复后实现", font=SMALL, fill="#1bc8d1")
    canvas.save(OUTPUT / f"screen-{name}.jpg", quality=92)


def final_mobile_board(name: str, reference: Path, implementation: Path) -> None:
    ref = Image.open(reference).convert("RGB").resize((390, 844), Image.Resampling.LANCZOS)
    impl = Image.open(implementation).convert("RGB")
    if impl.size != (390, 844):
        raise ValueError(f"{implementation.name} must be a direct 390×844 capture, got {impl.size}")
    canvas = Image.new("RGB", (840, 920), "#11100e")
    draw = ImageDraw.Draw(canvas)
    canvas.paste(ref, (20, 56))
    canvas.paste(impl, (430, 56))
    draw.text((20, 14), f"{name} · 设计稿", font=SMALL, fill="#ffe11a")
    draw.text((430, 14), "实现 · 真实 390×844", font=SMALL, fill="#1bc8d1")
    canvas.save(OUTPUT / f"final-{name}.jpg", quality=94)


board(
    "01-login",
    BEFORE / "reference-login.jpg",
    AFTER / "implementation-login.jpg",
    "390×844 状态复核：启动页层级、主按钮与角色资产一致；补回登录进度条。",
)

MOBILE_PAIRS = {
    "login": "login",
    "home": "home",
    "play-mode": "play-mode",
    "create": "create",
    "join": "join",
    "lobby": "lobby",
    "lobby-member": "lobby-member",
    "game": "game",
    "other-turn": "other-turn",
    "attack": "attack-debt",
    "response": "response",
    "favor": "favor",
    "give-card": "give-card",
    "defuse": "defuse",
    "future": "future",
    "explosion": "explosion",
    "eliminated": "eliminated",
    "result": "result",
    "tutorial": "tutorial",
    "rules": "rules",
    "history": "history",
    "game-menu": "game-menu",
    "network": "network",
    "settings": "settings",
    "card-detail": "card-detail",
}

for implementation_name, reference_name in MOBILE_PAIRS.items():
    mobile_board(
        implementation_name,
        BEFORE / f"reference-{reference_name}-mobile.png",
        AFTER / f"implementation-{implementation_name}-mobile.png",
    )
    final_mobile_board(
        implementation_name,
        BEFORE / f"reference-{reference_name}-mobile.png",
        AFTER / f"implementation-{implementation_name}-390x844-final.png",
    )

board(
    "05-card-detail",
    BEFORE / "reference-card-detail-mobile.png",
    AFTER / "implementation-card-detail-mobile.png",
    "390×844 同状态复核：卡牌图、标题、效果说明、属性与底部 CTA 对齐设计稿。",
)
board(
    "02-home",
    BEFORE / "reference-home.jpg",
    AFTER / "implementation-home.jpg",
    "390×844 状态复核：首页恢复“开一局”、入口顺序与方案 1 漫画视觉。",
)
board(
    "03-create",
    BEFORE / "reference-create.jpg",
    AFTER / "implementation-create.jpg",
    "390×844 状态复核：标题可读性、表单层级、计时与底部 CTA 均可见。",
)
board(
    "04-result-vs-source-style",
    BEFORE / "reference-lobby.jpg",
    AFTER / "implementation-result.jpg",
    "同一设计系统复核：结算页使用相同色板、轮廓、头像资产与底部动作层级。",
)
