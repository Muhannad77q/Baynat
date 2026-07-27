# كالجبال الشمّ — فيديو إنشاد مرقاة القرب

إنتاج فيديو إنشادي لأبيات «مرقاة القرب» بهوية **كالجبال الشمّ** (جبال هندسية + خط كوفي بحري على خلفية ورقية حبيبية).

## المخرجات

- `output/mirqat_al_qurb_nasheed.mp4` — الفيديو النهائي (~7 دقائق، 1920×1080)
- `audio/mirqat_nasheed_mix.mp3` — المسار الصوتي
- `assets/kaljibal-logo.png` / `kaljibal-title.png` — هوية اللوجو

## التشغيل

```bash
cd mirqat-nasheed/scripts
python3 produce.py                  # توليد الصوت + فيديو أولي
python3 rebuild_kaljibal_brand.py   # إعادة بناء الإطارات بهوية كالجبال الشمّ
```

المتطلبات: `ffmpeg`, `sox`, `espeak-ng` + `mbrola-ar1`, وحزم Python: `pillow`, `numpy`, `arabic-reshaper`, `python-bidi`.
