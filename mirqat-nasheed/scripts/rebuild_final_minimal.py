#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Minimal video: white bg, logo top ONLY, short male voice, no extra text."""

from __future__ import annotations

import json
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
LINES = AUDIO / "lines_short"

W, H = 1920, 1080
FPS = 24
SR = 44100
GREEN = (27, 77, 62)
GOLD = (196, 163, 90)
WHITE = (255, 255, 255)

# Keep full poem but deliver faster (~2.5–3 min target)
TARGET_MAX_SEC = 180.0


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
    return np.interp(
        np.linspace(0, 1, n_out, endpoint=False),
        np.linspace(0, 1, len(x), endpoint=False),
        x,
    ).astype(np.float32)


def silence(seconds: float) -> np.ndarray:
    return np.zeros(int(max(0, seconds) * SR), dtype=np.float32)


def synth_line(text: str, out_path: Path) -> None:
    raw = out_path.with_suffix(".raw.wav")
    for voice in ("mb-ar1", "mb-ar2", "ar"):
        r = subprocess.run(
            ["espeak-ng", "-v", voice, "-s", "145", "-p", "40", "-a", "170", "-g", "3", text, "-w", str(raw)],
            capture_output=True,
            text=True,
        )
        if r.returncode == 0 and raw.exists() and raw.stat().st_size > 600:
            break
    # clean male voice, almost dry (nasheed lyric videos often dry vocal + light space)
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
            "100",
            "lowpass",
            "7000",
            "equalizer",
            "200",
            "0.8q",
            "1.5",
            "compand",
            "0.02,0.15",
            "-50,-40,-25,-15,-10,-6,-3,-3",
            "-2",
            "-5",
            "0.08",
            "reverb",
            "18",
            "15",
            "20",
            "30",
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


def build_audio():
    if LINES.exists():
        shutil.rmtree(LINES)
    LINES.mkdir(parents=True)

    chunks = [silence(1.2)]
    t = 1.2
    timeline = []
    for i, (a, b) in enumerate(VERSES, 1):
        pa, pb = LINES / f"{i:02d}a.wav", LINES / f"{i:02d}b.wav"
        synth_line(a, pa)
        synth_line(b, pb)
        wa, sra = read_wav(pa)
        wb, srb = read_wav(pb)
        wa, wb = resample_linear(wa, sra, SR), resample_linear(wb, srb, SR)
        gap, after = silence(0.18), silence(0.35)
        start = t
        chunks += [wa, gap, wb, after]
        dur = (len(wa) + len(gap) + len(wb) + len(after)) / SR
        timeline.append(
            {
                "index": i,
                "hemistich_a": a,
                "hemistich_b": b,
                "start": start,
                "b_start": start + (len(wa) + len(gap)) / SR,
                "end": start + dur - 0.1,
            }
        )
        t += dur
    chunks.append(silence(1.2))
    voice = np.concatenate(chunks)

    # Speed up whole track if still too long (preserve pitch via sox later)
    dur = len(voice) / SR
    speed = max(1.0, dur / TARGET_MAX_SEC)
    audio_raw = AUDIO / "short_raw.wav"
    write_wav(audio_raw, voice)

    audio_path = AUDIO / "short_mix.wav"
    if speed > 1.02:
        # sox tempo changes duration while keeping pitch
        tempo = min(speed, 1.55)
        subprocess.run(
            ["sox", str(audio_raw), str(audio_path), "tempo", "-s", f"{tempo:.3f}", "gain", "-n", "-1"],
            check=True,
            capture_output=True,
        )
        # scale timeline
        for v in timeline:
            for k in ("start", "b_start", "end"):
                v[k] = v[k] / tempo
        # intro also scaled: first start becomes start/tempo but we had 1.2 intro
        # rebuild starts relative already divided
    else:
        shutil.copy2(audio_raw, audio_path)

    data, sr = read_wav(audio_path)
    data = resample_linear(data, sr, SR)
    # very light soft bed
    n = len(data)
    tt = np.arange(n, dtype=np.float32) / SR
    bed = 0.02 * np.sin(2 * np.pi * 130.8 * tt)
    bed += 0.01 * np.sin(2 * np.pi * 196.0 * tt)
    mixed = np.tanh(data * 1.0 + bed).astype(np.float32)
    peak = np.max(np.abs(mixed)) + 1e-9
    mixed *= 0.92 / peak
    write_wav(audio_path, mixed)
    final_dur = len(mixed) / SR
    return audio_path, timeline, final_dur


def fonts():
    path = "/usr/share/fonts/truetype/noto/NotoNaskhArabic-Bold.ttf"
    return {
        "verse": ImageFont.truetype(path, 58),
        "num": ImageFont.truetype(path, 26),
    }


def logo():
    p = ASSETS / "mirqat-logo-final.png"
    img = Image.open(p).convert("RGBA")
    # ensure white under transparent if any
    bg = Image.new("RGBA", img.size, (255, 255, 255, 255))
    bg.paste(img, (0, 0), img if img.mode == "RGBA" else None)
    return bg


def frame_title(logo_img):
    frame = Image.new("RGB", (W, H), WHITE)
    L = logo_img.copy()
    L.thumbnail((700, 380), Image.Resampling.LANCZOS)
    frame.paste(L, ((W - L.size[0]) // 2, (H - L.size[1]) // 2), L)
    return frame


def frame_verse(logo_small, fnt, verse, phase):
    frame = Image.new("RGB", (W, H), WHITE)
    frame.paste(logo_small, ((W - logo_small.size[0]) // 2, 40), logo_small)
    draw = ImageDraw.Draw(frame)
    # number only, no extra slogans
    num = str(verse["index"])
    bbox = draw.textbbox((0, 0), num, font=fnt["num"])
    draw.text(((W - (bbox[2] - bbox[0])) // 2, 250), num, font=fnt["num"], fill=GOLD)

    a_alpha = 255 if phase == "a" else 110
    b_alpha = 90 if phase == "a" else 255
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    td = ImageDraw.Draw(layer)
    a, b = verse["hemistich_a"], verse["hemistich_b"]
    ba = td.textbbox((0, 0), a, font=fnt["verse"], direction="rtl", language="ar")
    bb = td.textbbox((0, 0), b, font=fnt["verse"], direction="rtl", language="ar")
    td.text(((W - (ba[2] - ba[0])) // 2, 390), a, font=fnt["verse"], fill=(*GREEN, a_alpha), direction="rtl", language="ar")
    td.line([W // 2 - 100, 505, W // 2 + 100, 505], fill=(*GOLD, 160), width=2)
    td.text(((W - (bb[2] - bb[0])) // 2, 535), b, font=fnt["verse"], fill=(*GREEN, b_alpha), direction="rtl", language="ar")
    return Image.alpha_composite(frame.convert("RGBA"), layer).convert("RGB")


def main():
    for p in (FRAMES, OUTPUT, AUDIO):
        p.mkdir(parents=True, exist_ok=True)
    for old in FRAMES.glob("*"):
        old.unlink()

    print("Audio (short)...")
    audio_path, timeline, duration = build_audio()
    print(f"Duration: {duration:.1f}s")
    (OUTPUT / "timeline_short.json").write_text(json.dumps(timeline, ensure_ascii=False, indent=2), encoding="utf-8")

    fnt = fonts()
    L = logo()
    Lbig = L.copy()
    Lbig.thumbnail((720, 400), Image.Resampling.LANCZOS)
    Lsmall = L.copy()
    Lsmall.thumbnail((460, 240), Image.Resampling.LANCZOS)

    title = frame_title(Lbig)
    # outro = same as title only (no added phrases)
    outro = frame_title(Lbig)
    title_p, outro_p = FRAMES / "title.png", FRAMES / "outro.png"
    title.save(title_p)
    outro.save(outro_p)

    segments = [(title_p, max(0.8, timeline[0]["start"]))]
    for idx, v in enumerate(timeline):
        ap, bp = FRAMES / f"v{v['index']:02d}_a.png", FRAMES / f"v{v['index']:02d}_b.png"
        frame_verse(Lsmall, fnt, v, "a").save(ap)
        frame_verse(Lsmall, fnt, v, "b").save(bp)
        a_dur = max(0.25, v["b_start"] - v["start"])
        b_end = timeline[idx + 1]["start"] if idx + 1 < len(timeline) else max(v["end"], duration - 1.0)
        b_dur = max(0.25, b_end - v["b_start"])
        segments += [(ap, a_dur), (bp, b_dur)]
    used = sum(d for _, d in segments)
    segments.append((outro_p, max(0.8, duration - used)))

    concat = FRAMES / "concat.txt"
    with concat.open("w") as f:
        for path, dur in segments:
            f.write(f"file '{path.resolve()}'\n")
            f.write(f"duration {dur:.4f}\n")
        f.write(f"file '{segments[-1][0].resolve()}'\n")

    out = OUTPUT / "mirqat_final.mp4"
    print("Encode...")
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

    art = Path("/opt/cursor/artifacts")
    shutil.copy2(out, art / "mirqat_final.mp4")
    shutil.copy2(out, art / "mirqat_al_qurb_nasheed.mp4")
    # compact 720p
    p720 = art / "mirqat_final_720p.mp4"
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
    shutil.copy2(p720, OUTPUT / "mirqat_final_720p.mp4")
    shutil.copy2(ASSETS / "mirqat-logo-final.png", art / "mirqat_logo.png")
    print("Done", out, f"{duration:.1f}s")


if __name__ == "__main__":
    main()
