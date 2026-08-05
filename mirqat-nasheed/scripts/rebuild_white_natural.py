#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Rebuild: pure white bg + logo on top + natural male Arabic voice."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import wave
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from verses import VERSES

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
AUDIO = ROOT / "audio"
FRAMES = ROOT / "frames"
OUTPUT = ROOT / "output"
LINES = AUDIO / "lines_natural"

W, H = 1920, 1080
FPS = 24
SR = 44100

GREEN = (27, 77, 62)
GOLD = (196, 163, 90)
WHITE = (255, 255, 255)
BRAND = "مرقاة القرب"


def write_wav(path: Path, samples: np.ndarray, sr: int = SR) -> None:
    samples = np.clip(samples, -1.0, 1.0)
    pcm = (samples * 32767.0).astype(np.int16)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(pcm.tobytes())


def read_wav(path: Path):
    with wave.open(str(path), "rb") as wf:
        sr = wf.getframerate()
        ch = wf.getnchannels()
        data = np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    if ch > 1:
        data = data.reshape(-1, ch).mean(axis=1)
    return data, sr


def resample_linear(x, sr_in, sr_out):
    if sr_in == sr_out:
        return x.astype(np.float32)
    n_out = int(len(x) * sr_out / sr_in)
    return np.interp(np.linspace(0, 1, n_out, endpoint=False), np.linspace(0, 1, len(x), endpoint=False), x).astype(np.float32)


def silence(seconds: float) -> np.ndarray:
    return np.zeros(int(seconds * SR), dtype=np.float32)


def soft_clip(x, drive=1.05):
    return np.tanh(x * drive).astype(np.float32)


def synthesize_natural_line(text: str, out_path: Path) -> None:
    """Male Arabic poetic line — clean, minimal FX (not robotic/metallic)."""
    if out_path.exists() and out_path.stat().st_size > 1000:
        return
    raw = out_path.with_suffix(".raw.wav")
    # mb-ar1 male; moderate speed, natural pitch, slight word gaps
    for voice in ("mb-ar1", "mb-ar2", "ar"):
        r = subprocess.run(
            [
                "espeak-ng",
                "-v",
                voice,
                "-s",
                "112",
                "-p",
                "42",
                "-a",
                "160",
                "-g",
                "6",
                text,
                "-w",
                str(raw),
            ],
            capture_output=True,
            text=True,
        )
        if r.returncode == 0 and raw.exists() and raw.stat().st_size > 800:
            break
    else:
        raise RuntimeError(text)

    # Clean natural polish: gentle EQ + tiny room only (NO chorus)
    tmp = out_path.with_suffix(".tmp.wav")
    subprocess.run(
        [
            "sox",
            str(raw),
            "-r",
            str(SR),
            "-c",
            "1",
            str(tmp),
            "highpass",
            "90",
            "lowpass",
            "6500",
            "equalizer",
            "220",
            "0.7q",
            "2",
            "equalizer",
            "2800",
            "1.2q",
            "-2",
            "compand",
            "0.02,0.18",
            "-60,-50,-30,-18,-12,-8,-3,-3",
            "-2",
            "-6",
            "0.1",
            "reverb",
            "25",
            "20",
            "25",
            "40",
            "0",
            "gain",
            "-n",
            "-1",
        ],
        check=True,
        capture_output=True,
    )
    raw.unlink(missing_ok=True)
    tmp.rename(out_path)


def make_soft_bed(duration: float) -> np.ndarray:
    """Very soft ambient pad under voice — not competing."""
    n = int(duration * SR)
    t = np.arange(n, dtype=np.float32) / SR
    root = 130.81  # C3
    bed = np.zeros(n, dtype=np.float32)
    for ratio, amp in [(1.0, 0.035), (1.5, 0.018), (2.0, 0.015)]:
        bed += amp * np.sin(2 * np.pi * root * ratio * t) * (0.55 + 0.45 * np.sin(2 * np.pi * 0.05 * t))
    # gentle fade edges
    fade = int(2.0 * SR)
    bed[:fade] *= np.linspace(0, 1, fade)
    bed[-fade:] *= np.linspace(1, 0, fade)
    peak = np.max(np.abs(bed)) + 1e-9
    return (bed * (0.25 / peak)).astype(np.float32)


def build_voice_and_timeline():
    LINES.mkdir(parents=True, exist_ok=True)
    chunks = [silence(3.5)]
    t = 3.5
    timeline = []
    for i, (a, b) in enumerate(VERSES, 1):
        pa = LINES / f"{i:02d}a.wav"
        pb = LINES / f"{i:02d}b.wav"
        synthesize_natural_line(a, pa)
        synthesize_natural_line(b, pb)
        wa, sra = read_wav(pa)
        wb, srb = read_wav(pb)
        wa = resample_linear(wa, sra, SR)
        wb = resample_linear(wb, srb, SR)
        gap = silence(0.45)
        after = silence(0.95)
        start = t
        chunks.extend([wa, gap, wb, after])
        dur = (len(wa) + len(gap) + len(wb) + len(after)) / SR
        timeline.append(
            {
                "index": i,
                "hemistich_a": a,
                "hemistich_b": b,
                "start": start,
                "b_start": start + (len(wa) + len(gap)) / SR,
                "end": start + dur - 0.25,
            }
        )
        t += dur
    chunks.append(silence(4.0))
    voice = np.concatenate(chunks)
    bed = make_soft_bed(len(voice) / SR)[: len(voice)]
    # light duck
    env = np.convolve(np.abs(voice), np.ones(int(0.1 * SR)) / int(0.1 * SR), mode="same")
    duck = 1.0 - 0.7 * np.clip(env * 5.0, 0, 1)
    mixed = soft_clip(voice * 1.0 + bed * duck)
    peak = np.max(np.abs(mixed)) + 1e-9
    mixed *= 0.92 / peak
    return mixed, timeline


def fonts():
    path = "/usr/share/fonts/truetype/noto/NotoNaskhArabic-Bold.ttf"
    return {
        "verse": ImageFont.truetype(path, 56),
        "small": ImageFont.truetype(path, 34),
        "num": ImageFont.truetype(path, 28),
    }


def draw_centered(draw, text, y, font, fill):
    bbox = draw.textbbox((0, 0), text, font=font, direction="rtl", language="ar")
    tw = bbox[2] - bbox[0]
    draw.text(((W - tw) // 2, y), text, font=font, fill=fill, direction="rtl", language="ar")


def load_logo(max_w=520):
    p = ASSETS / "mirqat-logo-top.png"
    if not p.exists():
        p = ASSETS / "mirqat-logo-clean-white.png"
    img = Image.open(p).convert("RGBA")
    img.thumbnail((max_w, max_w), Image.Resampling.LANCZOS)
    return img


def title_frame(logo, fnt):
    frame = Image.new("RGB", (W, H), WHITE)
    # logo upper center
    lx = (W - logo.size[0]) // 2
    frame.paste(logo, (lx, 120), logo)
    draw = ImageDraw.Draw(frame)
    draw_centered(draw, "إنشاد في حُسن الخُلق والقرب", H // 2 + 80, fnt["small"], GOLD)
    return frame


def verse_frame(logo_small, fnt, verse, phase):
    frame = Image.new("RGB", (W, H), WHITE)
    # logo top
    lx = (W - logo_small.size[0]) // 2
    frame.paste(logo_small, (lx, 36), logo_small)

    draw = ImageDraw.Draw(frame)
    draw_centered(draw, str(verse["index"]), 280, fnt["num"], GOLD)

    a_alpha = 255 if phase == "a" else 120
    b_alpha = 95 if phase == "a" else 255
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    td = ImageDraw.Draw(layer)
    a, b = verse["hemistich_a"], verse["hemistich_b"]
    ba = td.textbbox((0, 0), a, font=fnt["verse"], direction="rtl", language="ar")
    bb = td.textbbox((0, 0), b, font=fnt["verse"], direction="rtl", language="ar")
    td.text(((W - (ba[2] - ba[0])) // 2, 400), a, font=fnt["verse"], fill=(*GREEN, a_alpha), direction="rtl", language="ar")
    td.line([W // 2 - 120, 510, W // 2 + 120, 510], fill=(*GOLD, 180), width=2)
    td.text(((W - (bb[2] - bb[0])) // 2, 540), b, font=fnt["verse"], fill=(*GREEN, b_alpha), direction="rtl", language="ar")
    frame = Image.alpha_composite(frame.convert("RGBA"), layer).convert("RGB")
    draw = ImageDraw.Draw(frame)
    draw_centered(draw, BRAND, H - 90, fnt["small"], GREEN)
    return frame


def outro_frame(logo, fnt):
    frame = title_frame(logo, fnt)
    draw = ImageDraw.Draw(frame)
    draw_centered(draw, "وَمَرِقَاةَ قُرْبٍ لِلْمَلِيْكِ، فَأُنْجِحَا", H - 160, fnt["small"], GREEN)
    return frame


def main():
    for p in (FRAMES, OUTPUT, AUDIO):
        p.mkdir(parents=True, exist_ok=True)
    for old in FRAMES.glob("*"):
        old.unlink()

    print("Building natural male voice...")
    # force regenerate
    if LINES.exists():
        shutil.rmtree(LINES)
    mixed, timeline = build_voice_and_timeline()
    audio_path = AUDIO / "mirqat_natural_mix.wav"
    write_wav(audio_path, mixed)
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(audio_path), "-b:a", "192k", str(AUDIO / "mirqat_natural_mix.mp3")],
        check=True,
        capture_output=True,
    )
    (OUTPUT / "timeline_natural.json").write_text(json.dumps(timeline, ensure_ascii=False, indent=2), encoding="utf-8")
    duration = len(mixed) / SR

    print("Rendering white + logo frames...")
    fnt = fonts()
    logo = load_logo(640)
    logo_small = load_logo(420)
    title = title_frame(logo, fnt)
    outro = outro_frame(logo, fnt)
    title_p = FRAMES / "title.png"
    outro_p = FRAMES / "outro.png"
    title.save(title_p)
    outro.save(outro_p)

    segments = [(title_p, timeline[0]["start"])]
    for idx, v in enumerate(timeline):
        ap = FRAMES / f"v{v['index']:02d}_a.png"
        bp = FRAMES / f"v{v['index']:02d}_b.png"
        verse_frame(logo_small, fnt, v, "a").save(ap)
        verse_frame(logo_small, fnt, v, "b").save(bp)
        a_dur = max(0.4, v["b_start"] - v["start"])
        b_end = timeline[idx + 1]["start"] if idx + 1 < len(timeline) else v["end"] + 0.6
        b_dur = max(0.4, b_end - v["b_start"])
        segments += [(ap, a_dur), (bp, b_dur)]
    segments.append((outro_p, max(1.0, duration - (timeline[-1]["end"] + 0.6))))

    concat = FRAMES / "concat.txt"
    with concat.open("w") as f:
        for path, dur in segments:
            f.write(f"file '{path.resolve()}'\n")
            f.write(f"duration {dur:.4f}\n")
        f.write(f"file '{segments[-1][0].resolve()}'\n")

    out = OUTPUT / "mirqat_white_natural.mp4"
    print("Encoding...")
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat),
            "-i",
            str(audio_path),
            "-vf",
            f"fps={FPS},format=yuv420p",
            "-c:v",
            "libx264",
            "-profile:v",
            "main",
            "-pix_fmt",
            "yuv420p",
            "-preset",
            "medium",
            "-crf",
            "18",
            "-c:a",
            "aac",
            "-ac",
            "2",
            "-b:a",
            "192k",
            "-shortest",
            "-movflags",
            "+faststart",
            str(out),
        ],
        check=True,
    )

    # compatible copies
    art = Path("/opt/cursor/artifacts")
    shutil.copy2(out, art / "mirqat_white_natural.mp4")
    shutil.copy2(out, art / "mirqat_al_qurb_nasheed.mp4")
    # also 720p smaller
    p720 = art / "mirqat_white_natural_720p.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(out),
            "-vf",
            "scale=1280:720",
            "-c:v",
            "libx264",
            "-profile:v",
            "main",
            "-crf",
            "22",
            "-c:a",
            "aac",
            "-ac",
            "2",
            "-b:a",
            "128k",
            "-movflags",
            "+faststart",
            str(p720),
        ],
        check=True,
        capture_output=True,
    )
    shutil.copy2(AUDIO / "mirqat_natural_mix.mp3", art / "mirqat_natural_audio.mp3")
    shutil.copy2(ASSETS / "mirqat-logo-top.png", art / "mirqat_logo_top.png")
    print("Done", out, "duration", duration)


if __name__ == "__main__":
    main()
