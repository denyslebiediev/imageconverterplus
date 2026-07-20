#!/usr/bin/env python3
"""Harvest each locale's App Store badge token + localized alt from the OLD
landings (git HEAD), download the distinct localized SVG badges, and write
tools/i18n/badges.json = {locale: {token, alt}}.

- 'en-us' token locales reuse the existing images/badges/app-store-{black,white}.svg.
- Every other distinct token -> images/badges/<token>-{black,white}.svg (idempotent).

Apple serves the SVG via a 302 from tools.applemediaservices.com to
toolbox.marketingtools.apple.com and requires a browser User-Agent.
"""
import json
import os
import re
import subprocess
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BADGES_DIR = os.path.join(ROOT, "images", "badges")
OUT = os.path.join(ROOT, "tools", "i18n", "badges.json")
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15"

# <img src="...download-on-the-app-store/black/<token>?size=250x83" alt="<localized>">
BLACK_RE = re.compile(r'download-on-the-app-store/black/([a-z][a-z-]*)\?[^"]*"\s+alt="([^"]*)"')


def locales():
    for name in sorted(os.listdir(ROOT)):
        if name == "en":
            continue
        if os.path.isfile(os.path.join(ROOT, name, "index.html")):
            yield name


def old_page(loc):
    try:
        return subprocess.check_output(
            ["git", "show", "HEAD:%s/index.html" % loc], cwd=ROOT, text=True,
            stderr=subprocess.DEVNULL)
    except subprocess.CalledProcessError:
        return ""


def download(token, color):
    dest = os.path.join(BADGES_DIR, "%s-%s.svg" % (token, color))
    if os.path.exists(dest):
        return "skip"
    url = ("https://tools.applemediaservices.com/api/badges/"
           "download-on-the-app-store/%s/%s" % (color, token))
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = r.read()
    if b"<svg" not in data[:400]:
        raise RuntimeError("not SVG for %s/%s (got %r)" % (color, token, data[:60]))
    with open(dest, "wb") as f:
        f.write(data)
    return "get"


def main():
    os.makedirs(BADGES_DIR, exist_ok=True)
    mapping = {}
    for loc in locales():
        m = BLACK_RE.search(old_page(loc))
        if not m:
            print("WARN no badge token in old %s/index.html" % loc, file=sys.stderr)
            mapping[loc] = {"token": "en-us", "alt": "Download on the App Store"}
            continue
        mapping[loc] = {"token": m.group(1), "alt": m.group(2)}

    tokens = sorted({v["token"] for v in mapping.values()} - {"en-us"})
    print("locales: %d | distinct non-en tokens: %d" % (len(mapping), len(tokens)))
    got = 0
    for tok in tokens:
        for color in ("black", "white"):
            if download(tok, color) == "get":
                got += 1
    print("downloaded %d new SVG(s); en-us locales reuse app-store-*.svg" % got)

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(mapping, f, ensure_ascii=False, indent=1, sort_keys=True)
    print("wrote %s" % os.path.relpath(OUT, ROOT))


if __name__ == "__main__":
    main()
