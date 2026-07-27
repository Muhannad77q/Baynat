# مرقاة القرب — فيديو إنشاد

إنتاج فيديو إنشادي لأبيات «مرقاة القرب» مع هوية بصرية (أخضر غابي + ذهبي) على خلفية ورقية فاتحة.

## المخرجات

- `output/mirqat_al_qurb_nasheed.mp4` — الفيديو النهائي (~7 دقائق، 1920×1080)
- `audio/mirqat_nasheed_mix.mp3` — المسار الصوتي

## التشغيل

```bash
cd mirqat-nasheed/scripts
python3 produce.py
```

المتطلبات: `ffmpeg`, `sox`, `espeak-ng` + `mbrola-ar1`, وحزم Python: `pillow`, `numpy`, `arabic-reshaper`, `python-bidi`.
