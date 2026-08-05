#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Rebuild nasheed video with كالجبال الشمّ mountain brand identity."""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFont

from verses import VERSES

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
AUDIO = ROOT / "audio"
FRAMES = ROOT / "frames"
OUTPUT = ROOT / "output"

W, H = 1920, 1080
FPS = 24

NAVY = (29, 50, 68)
CREAM = (235, 228, 209)
GOLD = (181, 142, 63)
WHITE = (255, 252, 245)

BRAND = "كالجبال الشمّ"


def load_fonts():
    path = "/usr/share/fonts/truetype/noto/NotoKufiArabic-Bold.ttf"
    if not os.path.exists(path):
        path = "/usr/share/fonts/truetype/noto/NotoNaskhArabic-Bold.ttf"
    return {
        "verse": ImageFont.truetype(path, 52),
        "small": ImageFont.truetype(path, 34),
        "num": ImageFont.truetype(path, 28),
    }


def draw_centered(draw, text, y, font, fill):
    bbox = draw.textbbox((0, 0), text, font=font, direction="rtl", language="ar")
    tw = bbox[2] - bbox[0]
    draw.text(((W - tw) // 2, y), text, font=font, fill=fill, direction="rtl", language="ar")


def prepare_bg() -> Image.Image:
    src = ASSETS / "kaljibal-video-bg.png"
    img = Image.open(src).convert("RGB").resize((W, H), Image.Resampling.LANCZOS)
    # Lift center for readability while keeping mountains
    veil = Image.new("RGB", (W, H), CREAM)
    # stronger veil in upper/middle text zone
    mask = Image.new("L", (W, H), 0)
    md = ImageDraw.Draw(mask)
    md.rectangle([0, 0, W, int(H * 0.72)], fill=140)
    md.rectangle([0, int(H * 0.72), W, H], fill=40)
    img = Image.composite(Image.blend(img, veil, 0.35), img, mask)
    return ImageEnhance.Contrast(img).enhance(1.05)


def make_logo_badge() -> Image.Image:
    logo = Image.open(ASSETS / "kaljibal-logo.png").convert("RGBA")
    logo.thumbnail((380, 380), Image.Resampling.LANCZOS)
    return logo


def title_frame(fonts, logo_full: Image.Image) -> Image.Image:
    title_src = ASSETS / "kaljibal-title.png"
    if title_src.exists():
        img = Image.open(title_src).convert("RGB").resize((W, H), Image.Resampling.LANCZOS)
        return img
    bg = prepare_bg()
    frame = bg.convert("RGBA")
    logo = logo_full.copy()
    logo.thumbnail((900, 900), Image.Resampling.LANCZOS)
    lx = (W - logo.size[0]) // 2
    ly = (H - logo.size[1]) // 2 - 40
    frame.paste(logo, (lx, ly), logo)
    draw = ImageDraw.Draw(frame)
    draw_centered(draw, "إنشاد في حُسن الخُلق والقرب", H - 160, fonts["small"], GOLD)
    return frame.convert("RGB")


def verse_frame(bg, fonts, logo_small, verse, phase) -> Image.Image:
    frame = bg.copy().convert("RGBA")

    panel = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    pd = ImageDraw.Draw(panel)
    pd.rounded_rectangle(
        [120, 220, W - 120, H - 200],
        radius=18,
        fill=(245, 240, 225, 200),
        outline=(*NAVY, 160),
        width=2,
    )
    frame = Image.alpha_composite(frame, panel)

    # small mountain logo top-left-ish centered
    frame.paste(logo_small, ((W - logo_small.size[0]) // 2, 28), logo_small)

    draw = ImageDraw.Draw(frame)
    draw_centered(draw, str(verse["index"]), 200, fonts["num"], GOLD)

    a_alpha, b_alpha = (255, 95) if phase == "a" else (120, 255)
    line_a, line_b = verse["hemistich_a"], verse["hemistich_b"]

    text_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    td = ImageDraw.Draw(text_layer)
    ba = td.textbbox((0, 0), line_a, font=fonts["verse"], direction="rtl", language="ar")
    bb = td.textbbox((0, 0), line_b, font=fonts["verse"], direction="rtl", language="ar")
    td.text(
        ((W - (ba[2] - ba[0])) // 2, 380),
        line_a,
        font=fonts["verse"],
        fill=(*NAVY, a_alpha),
        direction="rtl",
        language="ar",
    )
    td.line([W // 2 - 130, 490, W // 2 + 130, 490], fill=(*GOLD, 180), width=2)
    td.text(
        ((W - (bb[2] - bb[0])) // 2, 520),
        line_b,
        font=fonts["verse"],
        fill=(*NAVY, b_alpha),
        direction="rtl",
        language="ar",
    )
    frame = Image.alpha_composite(frame, text_layer)

    fd = ImageDraw.Draw(frame)
    draw_centered(fd, BRAND, H - 120, fonts["small"], NAVY)
    return frame.convert("RGB")


def outro_frame(fonts, logo_full) -> Image.Image:
    frame = title_frame(fonts, logo_full)
    draw = ImageDraw.Draw(frame)
    # soft footer band
    band = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    bd = ImageDraw.Draw(band)
    bd.rectangle([0, H - 180, W, H], fill=(235, 228, 209, 210))
    frame = Image.alpha_composite(frame.convert("RGBA"), band)
    draw = ImageDraw.Draw(frame)
    draw_centered(draw, "وَمَرِقَاةَ قُرْبٍ لِلْمَلِيْكِ، فَأُنْجِحَا", H - 120, fonts["small"], NAVY)
    return frame.convert("RGB")


def main():
    FRAMES.mkdir(parents=True, exist_ok=True)
    for old in FRAMES.glob("*"):
        old.unlink()

    timeline = json.loads((OUTPUT / "timeline.json").read_text(encoding="utf-8"))
    # ensure brand fields present
    for i, v in enumerate(timeline):
        if "hemistich_a" not in v:
            a, b = VERSES[i]
            v["hemistich_a"], v["hemistich_b"] = a, b

    audio_path = AUDIO / "mirqat_nasheed_mix.wav"
    if not audio_path.exists():
        # fallback decode from mp3
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(AUDIO / "mirqat_nasheed_mix.mp3"), str(audio_path)],
            check=True,
            capture_output=True,
        )

    # duration from audio
    probe = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "csv=p=0",
            str(audio_path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    duration = float(probe.stdout.strip())

    fonts = load_fonts()
    bg = prepare_bg()
    logo_full = Image.open(ASSETS / "kaljibal-logo.png").convert("RGBA")
    logo_small = make_logo_badge()

    print("Rendering mountain-branded frames...")
    title = title_frame(fonts, logo_full)
    outro = outro_frame(fonts, logo_full)
    title_path = FRAMES / "title.png"
    outro_path = FRAMES / "outro.png"
    title.save(title_path)
    outro.save(outro_path)

    segments = []
    segments.append((title_path, timeline[0]["start"]))

    for idx, v in enumerate(timeline):
        a_path = FRAMES / f"v{v['index']:02d}_a.png"
        b_path = FRAMES / f"v{v['index']:02d}_b.png"
        verse_frame(bg, fonts, logo_small, v, "a").save(a_path)
        verse_frame(bg, fonts, logo_small, v, "b").save(b_path)
        a_dur = max(0.4, v["b_start"] - v["start"])
        if idx + 1 < len(timeline):
            b_end = timeline[idx + 1]["start"]
        else:
            b_end = v["end"] + 0.8
        b_dur = max(0.4, b_end - v["b_start"])
        segments.append((a_path, a_dur))
        segments.append((b_path, b_dur))

    outro_start = timeline[-1]["end"] + 0.8
    segments.append((outro_path, max(1.0, duration - outro_start)))

    list_path = FRAMES / "concat.txt"
    with list_path.open("w", encoding="utf-8") as f:
        for path, dur in segments:
            f.write(f"file '{path.resolve()}'\n")
            f.write(f"duration {dur:.4f}\n")
        f.write(f"file '{segments[-1][0].resolve()}'\n")

    out_path = OUTPUT / "mirqat_al_qurb_nasheed.mp4"
    cmd = [
        "ffmpeg",
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(list_path),
        "-i",
        str(audio_path),
        "-vf",
        f"fps={FPS},format=yuv420p",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "18",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-shortest",
        "-movflags",
        "+faststart",
        str(out_path),
    ]
    print("Encoding...")
    subprocess.run(cmd, check=True)

    art = Path("/opt/cursor/artifacts")
    import shutil

    shutil.copy2(out_path, art / "mirqat_al_qurb_nasheed.mp4")
    shutil.copy2(out_path, art / "kaljibal_nasheed.mp4")
    print(f"Done: {out_path}")


if __name__ == "__main__":
    main()
