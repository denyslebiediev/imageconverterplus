#!/usr/bin/env python3
"""Convert ASC screenshot sources (../Screenshots/6.9/<Language>/*.png) into the
web set: timestamp-sort -> 1..N, sips resample to 600px wide -> cwebp -q78 ->
images/screenshots/<locale>/<i>.webp.

Variant folders (English AU/CA/UK, French Canada, Spanish Mexico) collapse: only
the canonical folder per locale is mapped. 'en' is intentionally NOT regenerated
(the reviewed images/screenshots/en/ baseline is preserved). Locales with no
source fall back to ../images/screenshots/en/ at build time.

Emits tools/i18n/screenshots.json = sorted list of locales that have own screenshots.
Idempotent: existing <i>.webp are skipped.
"""
import json
import os
import subprocess
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "..", "Screenshots", "6.9")
DEST = os.path.join(ROOT, "images", "screenshots")
OUT = os.path.join(ROOT, "tools", "i18n", "screenshots.json")

FOLDER_MAP = {
    "Arabic": "ar", "Catalan": "ca", "Chinese (Simplified)": "zh-Hans",
    "Chinese (Traditional)": "zh-Hant", "Croatian": "hr", "Czech": "cs",
    "Danish": "da", "Dutch": "nl", "English (US)": "en", "Finnish": "fi",
    "French": "fr", "German": "de", "Greek": "el", "Hebrew": "he", "Hindi": "hi",
    "Hungarian": "hu", "Indonesian": "id", "Italian": "it", "Japanese": "ja",
    "Korean": "ko", "Malay": "ms", "Norwegian": "nb", "Polish": "pl",
    "Portuguese (Brazil)": "pt-BR", "Portuguese (Portugal)": "pt-PT",
    "Romanian": "ro", "Slovak": "sk", "Spanish (Spain)": "es", "Swedish": "sv",
    "Thai": "th", "Turkish": "tr", "Ukrainian": "uk", "Vietnamese": "vi",
}


def convert(src_png, out_webp):
    if os.path.exists(out_webp):
        return False
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tf:
        tmp = tf.name
    try:
        subprocess.run(["sips", "--resampleWidth", "600", src_png, "--out", tmp],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(["cwebp", "-quiet", "-q", "78", tmp, "-o", out_webp], check=True)
    finally:
        os.unlink(tmp)
    return True


def main():
    if not os.path.isdir(SRC):
        raise SystemExit("missing screenshot source dir: %s" % SRC)
    have = []
    made = 0
    for folder, loc in sorted(FOLDER_MAP.items(), key=lambda kv: kv[1]):
        path = os.path.join(SRC, folder)
        if not os.path.isdir(path):
            print("WARN missing source folder: %s" % folder)
            continue
        if loc == "en":
            have.append("en")  # baseline already exists; do not regenerate
            continue
        pngs = sorted(f for f in os.listdir(path) if f.lower().endswith(".png"))
        if len(pngs) < 8:
            print("WARN %s (%s): only %d PNGs (need >=8)" % (folder, loc, len(pngs)))
        outdir = os.path.join(DEST, loc)
        os.makedirs(outdir, exist_ok=True)
        for i, png in enumerate(pngs, 1):
            if convert(os.path.join(path, png), os.path.join(outdir, "%d.webp" % i)):
                made += 1
        have.append(loc)

    have = sorted(set(have))
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(have, f, ensure_ascii=False, indent=1)
    print("locales with own screenshots: %d | new webp encoded: %d" % (len(have), made))
    print("wrote %s" % os.path.relpath(OUT, ROOT))


if __name__ == "__main__":
    main()
