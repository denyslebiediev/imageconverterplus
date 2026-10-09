#!/usr/bin/env python3
"""Convert the framed iPhone 16 Plus screenshots (<app repo>/screenshots/iphone16plus/
framed/<Language>/1.png..8.png, 1350x2760 RGBA with the device bezel baked in) into
the web set: filename-sort -> 1..N, sips resample to 675px wide (exact half) ->
cwebp -q78 (alpha kept) -> images/screenshots/<locale>/<i>.webp.

Slot order is the filename sort, so a folder whose capture order differs from the
canonical screen order must be renamed 1.png..8.png first. Locales with no source
fall back to ../images/screenshots/en/ at build time.

Only the slots the site actually uses are encoded (WEB_SLOTS); the sources carry
8 shots per language but the landing page curates 6.

Emits tools/i18n/screenshots.json = sorted list of locales that have own screenshots.
Always re-encodes, so a re-run picks up new sources.
"""
import json
import os
import subprocess
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.expanduser("~/Projects/ios_projects/ImageConverterPlus/screenshots/iphone16plus/framed")
DEST = os.path.join(ROOT, "images", "screenshots")
OUT = os.path.join(ROOT, "tools", "i18n", "screenshots.json")
WEB_SLOTS = {1, 2, 5, 6, 7, 8}

FOLDER_MAP = {
    "Arabic": "ar", "Bangla": "bn", "Catalan": "ca", "Chinese (Simplified)": "zh-Hans",
    "Chinese (Traditional)": "zh-Hant", "Croatian": "hr", "Czech": "cs",
    "Danish": "da", "Dutch": "nl", "English": "en", "Finnish": "fi",
    "French": "fr", "German": "de", "Greek": "el", "Gujarati": "gu", "Hebrew": "he",
    "Hindi": "hi", "Hungarian": "hu", "Indonesian": "id", "Italian": "it",
    "Japanese": "ja", "Kannada": "kn", "Korean": "ko", "Malay": "ms",
    "Malayalam": "ml", "Marathi": "mr", "Norwegian": "nb", "Odia": "or",
    "Polish": "pl", "Portuguese (Brazil)": "pt-BR", "Portuguese (Portugal)": "pt-PT",
    "Punjabi": "pa", "Romanian": "ro", "Slovak": "sk", "Slovenian": "sl",
    "Spanish": "es", "Swedish": "sv", "Tamil": "ta", "Telugu": "te", "Thai": "th",
    "Turkish": "tr", "Ukrainian": "uk", "Urdu": "ur", "Vietnamese": "vi",
}


def convert(src_png, out_webp):
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tf:
        tmp = tf.name
    try:
        subprocess.run(["sips", "--resampleWidth", "675", src_png, "--out", tmp],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(["cwebp", "-quiet", "-q", "78", tmp, "-o", out_webp], check=True)
    finally:
        os.unlink(tmp)


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
        pngs = sorted(f for f in os.listdir(path) if f.lower().endswith(".png"))
        if len(pngs) < 8:
            print("WARN %s (%s): only %d PNGs (need >=8)" % (folder, loc, len(pngs)))
        outdir = os.path.join(DEST, loc)
        os.makedirs(outdir, exist_ok=True)
        for i, png in enumerate(pngs, 1):
            if i not in WEB_SLOTS:
                continue
            convert(os.path.join(path, png), os.path.join(outdir, "%d.webp" % i))
            made += 1
        have.append(loc)

    have = sorted(set(have))
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(have, f, ensure_ascii=False, indent=1)
    print("locales with own screenshots: %d | webp encoded: %d" % (len(have), made))
    print("wrote %s" % os.path.relpath(OUT, ROOT))


if __name__ == "__main__":
    main()
