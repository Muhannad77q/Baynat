#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Produce مرقاة القرب nasheed video: voice, musical bed, animated frames."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import wave
from pathlib import Path

import arabic_reshaper
import numpy as np
from bidi.algorithm import get_display
from PIL import Image, ImageDraw, ImageEnhance, ImageFont

from verses import BRAND, VERSES

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
AUDIO = ROOT / "audio"
FRAMES = ROOT / "frames"
OUTPUT = ROOT / "output"

SR = 44100
W, H = 1920, 1080
FPS = 24

GREEN = (27, 77, 62)
GOLD = (196, 163, 90)
CREAM = (244, 241, 234)


def ensure_dirs() -> None:
    for p in (AUDIO, FRAMES, OUTPUT):
        p.mkdir(parents=True, exist_ok=True)


def write_wav(path: Path, samples: np.ndarray, sr: int = SR) -> None:
    samples = np.clip(samples, -1.0, 1.0)
    pcm = (samples * 32767.0).astype(np.int16)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(pcm.tobytes())


def read_wav(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as wf:
        sr = wf.getframerate()
        n = wf.getnframes()
        ch = wf.getnchannels()
        raw = wf.readframes(n)
    data = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    if ch > 1:
        data = data.reshape(-1, ch).mean(axis=1)
    return data, sr


def resample_linear(x: np.ndarray, sr_in: int, sr_out: int) -> np.ndarray:
    if sr_in == sr_out:
        return x.astype(np.float32)
    n_out = int(len(x) * sr_out / sr_in)
    t_in = np.linspace(0, 1, len(x), endpoint=False)
    t_out = np.linspace(0, 1, n_out, endpoint=False)
    return np.interp(t_out, t_in, x).astype(np.float32)


def soft_clip(x: np.ndarray, drive: float = 1.15) -> np.ndarray:
    return np.tanh(x * drive).astype(np.float32)


def envelope(n: int, attack: float, release: float, sr: int = SR) -> np.ndarray:
    a = max(1, int(attack * sr))
    r = max(1, int(release * sr))
    env = np.ones(n, dtype=np.float32)
    env[:a] = np.linspace(0, 1, a, dtype=np.float32)
    if r < n:
        env[-r:] = np.linspace(1, 0, r, dtype=np.float32)
    return env


def tone(freq: float, dur: float, amp: float = 0.2, kind: str = "sine") -> np.ndarray:
    n = int(dur * SR)
    t = np.arange(n, dtype=np.float32) / SR
    if kind == "pluck":
        # Karplus-strong-ish: noise burst through decaying resonator
        noise = (np.random.randn(n).astype(np.float32) * 0.5)
        delay = max(2, int(SR / max(freq, 40.0)))
        out = np.zeros(n, dtype=np.float32)
        buf = noise[:delay].copy()
        idx = 0
        for i in range(n):
            val = 0.5 * (buf[idx] + buf[(idx - 1) % delay])
            buf[idx] = val * 0.996
            out[i] = val
            idx = (idx + 1) % delay
        wave_ = out
    elif kind == "pad":
        wave_ = (
            0.55 * np.sin(2 * np.pi * freq * t)
            + 0.25 * np.sin(2 * np.pi * freq * 2 * t)
            + 0.12 * np.sin(2 * np.pi * freq * 3 * t)
            + 0.08 * np.sin(2 * np.pi * freq * 4.02 * t)
        )
        wave_ *= 0.5 * (1 + np.sin(2 * np.pi * 0.08 * t))
    else:
        wave_ = np.sin(2 * np.pi * freq * t)
    return (wave_ * amp * envelope(n, 0.02, min(0.45, dur * 0.35))).astype(np.float32)


# Maqam Bayati-inspired scale degrees around D
MAQAM = {
    "root": 146.83,  # D3
    "degrees": [1.0, 1.067, 1.2, 1.333, 1.5, 1.6, 1.778, 2.0],
}


def melody_phrase(start: float, bars: int = 2) -> np.ndarray:
    """Soft oud-like phrase over a few bars."""
    beat = 0.72
    out = np.zeros(int(bars * 4 * beat * SR) + SR, dtype=np.float32)
    pattern = [0, 2, 4, 5, 4, 2, 3, 1, 0, 4, 7, 5, 4, 2, 0, 0]
    for i, deg in enumerate(pattern[: bars * 8]):
        freq = MAQAM["root"] * MAQAM["degrees"][deg % len(MAQAM["degrees"])]
        if i % 4 == 0:
            freq *= 0.5
        note = tone(freq, beat * 0.85, amp=0.11, kind="pluck")
        pos = int((start + i * (beat * 0.5)) * SR)
        end = pos + len(note)
        if end > len(out):
            out = np.pad(out, (0, end - len(out)))
        out[pos:end] += note
    return out


def make_musical_bed(duration: float) -> np.ndarray:
    n = int(duration * SR)
    bed = np.zeros(n, dtype=np.float32)
    root = MAQAM["root"]

    # Drone / soft pad
    for ratio, amp in [(1.0, 0.07), (1.5, 0.035), (2.0, 0.03), (0.5, 0.05)]:
        pad = tone(root * ratio, duration, amp=amp, kind="pad")
        bed[: len(pad)] += pad[:n]

    # Gentle rhythmic pulse (duff-like soft thud)
    beat = 0.72
    thump_n = int(0.08 * SR)
    for i, t0 in enumerate(np.arange(0, duration, beat)):
        pos = int(t0 * SR)
        if pos + thump_n >= n:
            break
        t = np.arange(thump_n, dtype=np.float32) / SR
        thud = np.sin(2 * np.pi * 55 * t) * np.exp(-28 * t)
        if i % 4 == 0:
            thud *= 0.9
        else:
            thud *= 0.35
        bed[pos : pos + thump_n] += thud * 0.12

    # Recurring melodic phrases
    cursor = 2.0
    while cursor < duration - 8:
        phrase = melody_phrase(0.0, bars=2)
        pos = int(cursor * SR)
        end = min(n, pos + len(phrase))
        bed[pos:end] += phrase[: end - pos] * 0.85
        cursor += 11.5

    # Soft shimmer
    t = np.arange(n, dtype=np.float32) / SR
    shimmer = 0.008 * np.sin(2 * np.pi * 740 * t) * (0.5 + 0.5 * np.sin(2 * np.pi * 0.05 * t))
    bed += shimmer

    bed = soft_clip(bed, 1.05)
    peak = np.max(np.abs(bed)) + 1e-9
    bed *= 0.55 / peak
    return bed


def synthesize_line(text: str, out_path: Path, speed: int = 95, pitch: int = 42) -> None:
    """Arabic poetic line via espeak-ng mbrola, then polish with sox into chant-like tone."""
    if out_path.exists() and out_path.stat().st_size > 1000:
        return
    raw = out_path.with_suffix(".raw.wav")
    for voice in ("mb-ar1", "mb-ar2", "ar"):
        cmd = [
            "espeak-ng",
            "-v",
            voice,
            "-s",
            str(speed),
            "-p",
            str(pitch),
            "-a",
            "145",
            "-g",
            "10",
            text,
            "-w",
            str(raw),
        ]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode == 0 and raw.exists() and raw.stat().st_size > 1000:
            break
    else:
        raise RuntimeError(f"espeak failed for: {text}")

    # Warm nasheed-like atmosphere: slow slightly, deep reverb, soft chorus
    tmp = out_path.with_suffix(".tmp.wav")
    sox_cmd = [
        "sox",
        str(raw),
        "-r",
        str(SR),
        "-c",
        "1",
        str(tmp),
        "tempo",
        "-s",
        "0.92",
        "pitch",
        "20",
        "highpass",
        "90",
        "lowpass",
        "4800",
        "equalizer",
        "280",
        "0.8q",
        "5",
        "equalizer",
        "1100",
        "1q",
        "2.5",
        "chorus",
        "0.5",
        "0.7",
        "40",
        "0.4",
        "0.25",
        "2",
        "-t",
        "reverb",
        "65",
        "50",
        "45",
        "90",
        "20",
        "compand",
        "0.05,0.3",
        "-60,-45,-30,-18,-12,-8,-3,-3",
        "-3",
        "-8",
        "0.15",
        "gain",
        "-n",
        "-1",
    ]
    subprocess.run(sox_cmd, check=True, capture_output=True)
    raw.unlink(missing_ok=True)
    tmp.rename(out_path)


def silence(seconds: float) -> np.ndarray:
    return np.zeros(int(seconds * SR), dtype=np.float32)


def build_voice_track() -> tuple[np.ndarray, list[dict]]:
    """Return full voice audio and timing metadata for each verse."""
    timeline: list[dict] = []
    chunks: list[np.ndarray] = []

    # Intro silence for title card
    intro = 4.5
    chunks.append(silence(intro))
    t = intro

    for i, (a, b) in enumerate(VERSES, start=1):
        verse_dir = AUDIO / "lines"
        verse_dir.mkdir(exist_ok=True)
        path_a = verse_dir / f"{i:02d}a.wav"
        path_b = verse_dir / f"{i:02d}b.wav"
        synthesize_line(a, path_a, speed=100, pitch=40)
        synthesize_line(b, path_b, speed=100, pitch=38)
        wa, sra = read_wav(path_a)
        wb, srb = read_wav(path_b)
        wa = resample_linear(wa, sra, SR)
        wb = resample_linear(wb, srb, SR)

        gap = silence(0.55)
        after = silence(1.15)
        start = t
        chunks.extend([wa, gap, wb, after])
        dur = (len(wa) + len(gap) + len(wb) + len(after)) / SR
        timeline.append(
            {
                "index": i,
                "hemistich_a": a,
                "hemistich_b": b,
                "start": start,
                "mid": start + len(wa) / SR,
                "end": start + dur - 0.35,
                "a_end": start + len(wa) / SR,
                "b_start": start + (len(wa) + len(gap)) / SR,
            }
        )
        t += dur

    # Outro
    chunks.append(silence(5.0))
    voice = np.concatenate(chunks)
    return voice, timeline


def mix_audio(voice: np.ndarray) -> np.ndarray:
    dur = len(voice) / SR
    bed = make_musical_bed(dur + 1.0)[: len(voice)]
    # Sidechain-ish duck: lower bed when voice is loud
    frame = int(0.02 * SR)
    voice_env = np.abs(voice)
    smoothed = np.copy(voice_env)
    # simple moving max
    win = int(0.12 * SR)
    kernel = np.ones(win, dtype=np.float32) / win
    smoothed = np.convolve(voice_env, kernel, mode="same")
    duck = 1.0 - 0.55 * np.clip(smoothed * 4.0, 0, 1)
    mixed = soft_clip(voice * 0.95 + bed * 0.55 * duck, 1.1)
    peak = np.max(np.abs(mixed)) + 1e-9
    mixed *= 0.92 / peak
    return mixed


def reshape_ar(text: str) -> str:
    # Pillow has raqm: keep original Arabic (with tashkeel) and rely on RTL shaping.
    return text


def load_fonts() -> dict[str, ImageFont.FreeTypeFont]:
    path = "/usr/share/fonts/truetype/noto/NotoNaskhArabic-Bold.ttf"
    if not os.path.exists(path):
        path = "/usr/share/fonts/truetype/noto/NotoSansArabic-Bold.ttf"
    return {
        "title": ImageFont.truetype(path, 92),
        "verse": ImageFont.truetype(path, 54),
        "small": ImageFont.truetype(path, 36),
        "num": ImageFont.truetype(path, 30),
    }


def prepare_background() -> Image.Image:
    # Prefer plain textured plate so verses remain readable
    plain = ASSETS / "mirqat-plain-bg.png"
    src = plain if plain.exists() else ASSETS / "mirqat-video-bg.png"
    img = Image.open(src).convert("RGB")
    img = img.resize((W, H), Image.Resampling.LANCZOS)
    overlay = Image.new("RGB", (W, H), CREAM)
    img = Image.blend(img, overlay, 0.22)
    img = ImageEnhance.Brightness(img).enhance(1.03)
    return img


def draw_centered(draw: ImageDraw.ImageDraw, text: str, y: int, font, fill) -> None:
    bbox = draw.textbbox((0, 0), text, font=font, direction="rtl", language="ar")
    tw = bbox[2] - bbox[0]
    draw.text(((W - tw) // 2, y), text, font=font, fill=fill, direction="rtl", language="ar")



def render_title_frame(bg: Image.Image, fonts, logo: Image.Image, alpha_logo: float = 1.0) -> Image.Image:
    frame = bg.copy().convert("RGBA")
    vignette = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    vd = ImageDraw.Draw(vignette)
    for i in range(160):
        a = int(70 * (i / 160) ** 2)
        vd.rectangle([i, i, W - i, H - i], outline=(40, 55, 40, a))
    frame = Image.alpha_composite(frame, vignette)

    logo_r = logo.copy()
    logo_r.thumbnail((1100, 560), Image.Resampling.LANCZOS)
    if alpha_logo < 1:
        r, g, b, a = logo_r.split()
        a = a.point(lambda p: int(p * alpha_logo))
        logo_r = Image.merge("RGBA", (r, g, b, a))
    lx = (W - logo_r.size[0]) // 2
    ly = (H - logo_r.size[1]) // 2 - 50
    frame.paste(logo_r, (lx, ly), logo_r if logo_r.mode == "RGBA" else None)
    draw = ImageDraw.Draw(frame)
    draw_centered(draw, "إنشاد في حُسن الخُلق والقرب", H // 2 + 200, fonts["small"], GOLD)
    return frame.convert("RGB")


def render_verse_frame(
    bg: Image.Image,
    fonts,
    logo_small: Image.Image,
    verse: dict,
    t: float,
    phase: str,
) -> Image.Image:
    frame = bg.copy().convert("RGBA")
    panel = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    pd = ImageDraw.Draw(panel)
    pd.rounded_rectangle(
        [140, 300, W - 140, H - 220],
        radius=28,
        fill=(255, 252, 245, 175),
        outline=(*GOLD, 140),
        width=2,
    )
    frame = Image.alpha_composite(frame, panel)

    # logo watermark top (transparent)
    frame.paste(logo_small, ((W - logo_small.size[0]) // 2, 36), logo_small)

    draw = ImageDraw.Draw(frame)
    draw_centered(draw, str(verse["index"]), 270, fonts["num"], GOLD)

    if phase == "a":
        a_alpha, b_alpha = 255, 90
    elif phase == "b":
        a_alpha, b_alpha = 120, 255
    else:
        a_alpha = b_alpha = 220

    line_a = verse["hemistich_a"]
    line_b = verse["hemistich_b"]

    text_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    td = ImageDraw.Draw(text_layer)

    ba = td.textbbox((0, 0), line_a, font=fonts["verse"], direction="rtl", language="ar")
    bb = td.textbbox((0, 0), line_b, font=fonts["verse"], direction="rtl", language="ar")
    td.text(
        ((W - (ba[2] - ba[0])) // 2, 420),
        line_a,
        font=fonts["verse"],
        fill=(*GREEN, a_alpha),
        direction="rtl",
        language="ar",
    )
    td.line([W // 2 - 140, 520, W // 2 + 140, 520], fill=(*GOLD, 170), width=2)
    td.text(
        ((W - (bb[2] - bb[0])) // 2, 555),
        line_b,
        font=fonts["verse"],
        fill=(*GREEN, b_alpha),
        direction="rtl",
        language="ar",
    )
    frame = Image.alpha_composite(frame, text_layer)

    fd = ImageDraw.Draw(frame)
    draw_centered(fd, BRAND, H - 110, fonts["small"], GREEN)
    return frame.convert("RGB")


def render_outro(bg: Image.Image, fonts, logo: Image.Image) -> Image.Image:
    frame = render_title_frame(bg, fonts, logo, 1.0)
    draw = ImageDraw.Draw(frame)
    draw_centered(draw, "وَمَرِقَاةَ قُرْبٍ لِلْمَلِيْكِ، فَأُنْجِحَا", H - 160, fonts["small"], GREEN)
    return frame


def make_logo_image() -> Image.Image:
    """Prefer generated brand plate; crop to lockup."""
    path = ASSETS / "mirqat-logo-bg.png"
    img = Image.open(path).convert("RGBA")
    # trim excess margins for overlay use
    return img


def build_video(timeline: list[dict], audio_path: Path, duration: float) -> Path:
    fonts = load_fonts()
    bg = prepare_background()
    logo_full = make_logo_image()
    logo_title = logo_full.copy()
    logo_title.thumbnail((980, 520), Image.Resampling.LANCZOS)
    logo_small = logo_full.copy()
    logo_small.thumbnail((420, 200), Image.Resampling.LANCZOS)

    for old in FRAMES.glob("*"):
        old.unlink()

    print("Rendering key visuals...")
    title = render_title_frame(bg, fonts, logo_title)
    outro = render_outro(bg, fonts, logo_title)
    title_path = FRAMES / "title.png"
    outro_path = FRAMES / "outro.png"
    title.save(title_path)
    outro.save(outro_path)

    segments: list[tuple[Path, float]] = []
    # intro until first verse
    intro_dur = timeline[0]["start"]
    segments.append((title_path, intro_dur))

    for idx, v in enumerate(timeline):
        a_path = FRAMES / f"v{v['index']:02d}_a.png"
        b_path = FRAMES / f"v{v['index']:02d}_b.png"
        render_verse_frame(bg, fonts, logo_small, v, 0, "a").save(a_path)
        render_verse_frame(bg, fonts, logo_small, v, 0, "b").save(b_path)
        a_dur = max(0.4, v["b_start"] - v["start"])
        if idx + 1 < len(timeline):
            next_start = timeline[idx + 1]["start"]
            b_end = next_start
        else:
            b_end = v["end"] + 0.8
        b_dur = max(0.4, b_end - v["b_start"])
        segments.append((a_path, a_dur))
        segments.append((b_path, b_dur))

    outro_start = timeline[-1]["end"] + 0.8
    outro_dur = max(1.0, duration - outro_start)
    segments.append((outro_path, outro_dur))

    # ffmpeg concat with still images + crossfade-ish via xfade would be complex;
    # use concat demuxer of image2 loops.
    list_path = FRAMES / "concat.txt"
    with list_path.open("w", encoding="utf-8") as f:
        for path, dur in segments:
            f.write(f"file '{path.resolve()}'\n")
            f.write(f"duration {dur:.4f}\n")
        # concat demuxer needs last file repeated
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
    print("Encoding video with ffmpeg...")
    subprocess.run(cmd, check=True)
    return out_path


def main() -> None:
    ensure_dirs()
    print("Synthesizing Arabic poetic voice...")
    voice, timeline = build_voice_track()
    print(f"Verses timed: {len(timeline)}; voice duration {len(voice)/SR:.1f}s")
    print("Composing musical bed + mix...")
    mixed = mix_audio(voice)
    audio_path = AUDIO / "mirqat_nasheed_mix.wav"
    write_wav(audio_path, mixed)
    # also mp3 for convenience
    mp3_path = AUDIO / "mirqat_nasheed_mix.mp3"
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(audio_path), "-b:a", "192k", str(mp3_path)],
        check=True,
        capture_output=True,
    )
    duration = len(mixed) / SR
    (OUTPUT / "timeline.json").write_text(
        json.dumps(timeline, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    video = build_video(timeline, audio_path, duration)
    art = Path("/opt/cursor/artifacts")
    art.mkdir(parents=True, exist_ok=True)
    final = art / "mirqat_al_qurb_nasheed.mp4"
    shutil.copy2(video, final)
    shutil.copy2(mp3_path, art / "mirqat_nasheed_audio.mp3")
    print(f"Done: {final}")
    print(f"Duration: {duration:.1f}s")


if __name__ == "__main__":
    main()
