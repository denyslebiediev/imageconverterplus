#!/usr/bin/env python3
"""Locale fan-out build tool. Stdlib only. See tools/i18n/en.json for the manifest.

Subcommands (built incrementally):
  selftest   Identity round-trip: apply_fragments(index.html, EN) must equal index.html byte-for-byte.
"""
import html as _html
import json
import os
import re
import subprocess
import sys
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
I18N = os.path.join(ROOT, "tools", "i18n")
EN_JSON = os.path.join(I18N, "en.json")
HARVEST_DIR = os.path.join(I18N, "harvest")
LOCALES_DIR = os.path.join(I18N, "locales")

# Prefill keys extractable from the OLD landing by a stable, language-independent
# anchor (no positional alignment). Everything else is translated fresh.
PREFILL_KEYS = ("title", "meta_desc", "nav_privacy", "nav_terms", "nav_support", "badge_alt")


def load_manifest():
    with open(EN_JSON, encoding="utf-8") as f:
        data = json.load(f)
    return data["keys"]


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def resolve(spec, text):
    """Search/replace string for a key: anchor with its single '{}' filled by text."""
    anchor = spec.get("anchor", "{}")
    if "{}" not in anchor:
        raise ValueError("anchor missing '{}': %r" % anchor)
    left, right = anchor.split("{}", 1)
    return left + text + right


def sentinel(key):
    return "\x00" + key + "\x00"


def keys_for(manifest, scope):
    """Keys whose scope includes `scope`, longest search string first (order-independent)."""
    items = [(k, v) for k, v in manifest.items() if scope in v.get("scope", [])]
    items.sort(key=lambda kv: len(resolve(kv[1], kv[1]["en"])), reverse=True)
    return items


def apply_fragments(html, items, values):
    """Two-phase, collision-immune substitution.

    Pass 1: EN search string -> \\x00KEY\\x00 sentinel (assert exact occurrence count).
    Pass 2: sentinel -> translated value.
    """
    for key, spec in items:
        search = resolve(spec, spec["en"])
        n = html.count(search)
        if n != spec["count"]:
            raise AssertionError(
                "count mismatch for %r: found %d, expected %d\n  search=%r"
                % (key, n, spec["count"], search)
            )
        html = html.replace(search, resolve(spec, sentinel(key)))
    for key, spec in items:
        tok = sentinel(key)
        if tok not in html:
            raise AssertionError("sentinel for %r vanished before fill (overlap bug)" % key)
        val = values[key]
        if not spec.get("html"):
            val = esc(val)  # html:true values carry intentional markup; leave them raw
        # Pass 1 already kept the anchor's left/right literal around the sentinel,
        # so only the bare value is swapped in here.
        html = html.replace(tok, val)
    return html


def esc(s):
    return (s.replace("&", "&amp;").replace("<", "&lt;")
             .replace(">", "&gt;").replace('"', "&quot;"))


def check_counts(html, items):
    """Report every key whose actual occurrence count != expected. Returns list of bad keys."""
    bad = []
    for key, spec in items:
        search = resolve(spec, spec["en"])
        n = html.count(search)
        if n != spec["count"]:
            bad.append((key, n, spec["count"], search))
    return bad


def cmd_selftest():
    manifest = load_manifest()
    index = read(os.path.join(ROOT, "index.html"))
    items = keys_for(manifest, "landing")
    print("landing keys: %d" % len(items))

    bad = check_counts(index, items)
    if bad:
        print("\nCOUNT MISMATCHES (%d):" % len(bad))
        for key, got, want, search in bad:
            print("  %-22s got=%d want=%d  search=%r" % (key, got, want, search[:80]))
        sys.exit(1)
    print("all counts OK")

    values = {k: v["en"] for k, v in items}
    out = apply_fragments(index, items, values)
    if out == index:
        print("IDENTITY ROUND-TRIP: byte-identical ✓")
    else:
        # locate first divergence
        for i, (a, b) in enumerate(zip(out, index)):
            if a != b:
                lo = max(0, i - 60)
                print("DIVERGENCE at offset %d" % i)
                print("  out : ...%r" % out[lo:i + 20])
                print("  orig: ...%r" % index[lo:i + 20])
                break
        else:
            print("length differs: out=%d orig=%d" % (len(out), len(index)))
        sys.exit(1)


def locales():
    """The 60 locale directory names (every dir with an index.html, excluding en)."""
    out = []
    for name in sorted(os.listdir(ROOT)):
        if name == "en":
            continue
        if os.path.isfile(os.path.join(ROOT, name, "index.html")):
            out.append(name)
    return out


def git_show(rel):
    try:
        return subprocess.check_output(["git", "show", "HEAD:" + rel], cwd=ROOT,
                                       text=True, stderr=subprocess.DEVNULL)
    except subprocess.CalledProcessError:
        return ""


class _Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.buf = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.skip += 1

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self.skip:
            self.skip -= 1

    def handle_data(self, data):
        if self.skip:
            return
        s = " ".join(data.split())
        if s:
            self.buf.append(s)


def visible_text(html):
    p = _Text()
    p.feed(html)
    return "\n".join(p.buf)


def extract_prefill(html, badge_alt):
    """Pull the 6 stable prefill strings from an OLD landing (values decoded to
    plain text; the build re-escapes on substitution)."""
    def one(pat):
        m = re.search(pat, html, re.S)
        return _html.unescape(m.group(1).strip()) if m else None
    return {
        "title": one(r"<title>(.*?)</title>"),
        "meta_desc": one(r'<meta name="description" content="(.*?)"\s*/?>'),
        "nav_privacy": one(r'<a href="privacy\.html"[^>]*>(.*?)</a>'),
        "nav_terms": one(r'<a href="terms\.html"[^>]*>(.*?)</a>'),
        "nav_support": one(r'<a href="support\.html"[^>]*>(.*?)</a>'),
        "badge_alt": badge_alt,
    }


def cmd_harvest():
    badges = json.load(open(os.path.join(I18N, "badges.json"), encoding="utf-8"))
    os.makedirs(HARVEST_DIR, exist_ok=True)
    missing = 0
    for loc in locales():
        html = git_show(loc + "/index.html")
        pre = extract_prefill(html, badges.get(loc, {}).get("alt"))
        for k, v in pre.items():
            if not v:
                print("  MISSING %s for %s" % (k, loc))
                missing += 1
        out = {"locale": loc, "prefill": pre, "terminology": visible_text(html)}
        with open(os.path.join(HARVEST_DIR, loc + ".json"), "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=1)
    print("harvested %d locales -> tools/i18n/harvest/ (%d missing fields)"
          % (len(locales()), missing))
    if missing:
        sys.exit(1)


def cmd_prefill():
    os.makedirs(LOCALES_DIR, exist_ok=True)
    for loc in locales():
        hv = json.load(open(os.path.join(HARVEST_DIR, loc + ".json"), encoding="utf-8"))
        path = os.path.join(LOCALES_DIR, loc + ".json")
        data = {}
        if os.path.exists(path):
            data = json.load(open(path, encoding="utf-8"))
        for k in PREFILL_KEYS:
            data[k] = hv["prefill"][k]
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1, sort_keys=True)
    print("prefilled %d keys into %d locale files" % (len(PREFILL_KEYS), len(locales())))


def _tokens(s):
    """HTML tags + entities that must survive translation, as a sorted multiset."""
    return sorted(re.findall(r"</?[a-z][^>]*>|&[a-z]+;", s))


def validate_locale(manifest, loc, data):
    """Return (errors, en_equal_count, total_str). errors is a list of strings."""
    errs = []
    en_equal = 0
    total_str = 0
    keys = set(manifest)
    have = set(data)
    for k in sorted(keys - have):
        errs.append("missing key: %s" % k)
    for k in sorted(have - keys):
        errs.append("unknown key: %s" % k)

    for k in sorted(keys & have):
        spec = manifest[k]
        en = spec["en"]
        val = data[k]
        if spec.get("plural"):
            if not isinstance(val, dict):
                errs.append("%s: expected plural object" % k)
                continue
            if "other" not in val:
                errs.append("%s: plural missing 'other'" % k)
            for cat, form in val.items():
                if "{n}" not in form:
                    errs.append("%s[%s]: missing {n}" % (k, cat))
                if _tokens(form) != _tokens(en["other"]):
                    errs.append("%s[%s]: markup/entities differ from EN" % (k, cat))
            continue
        if not isinstance(val, str):
            errs.append("%s: expected string" % k)
            continue
        total_str += 1
        if spec.get("html") and _tokens(val) != _tokens(en):
            errs.append("%s: markup/entities differ from EN (%r vs %r)"
                        % (k, _tokens(val), _tokens(en)))
        for ph in re.findall(r"\{[a-z]+\}", en if isinstance(en, str) else ""):
            if ph not in val:
                errs.append("%s: missing placeholder %s" % (k, ph))
        if val.strip() == en.strip():
            en_equal += 1
    return errs, en_equal, total_str


def cmd_validate():
    manifest = load_manifest()
    targets = sys.argv[2:] or locales()
    bad = 0
    for loc in targets:
        path = os.path.join(LOCALES_DIR, loc + ".json")
        if not os.path.exists(path):
            print("FAIL %s: no locale file" % loc)
            bad += 1
            continue
        data = json.load(open(path, encoding="utf-8"))
        errs, en_equal, total = validate_locale(manifest, loc, data)
        ratio = (en_equal / total) if total else 0
        if ratio > 0.6:
            errs.append("EN-identical ratio %.0f%% > 60%% (likely untranslated)" % (ratio * 100))
        if errs:
            bad += 1
            print("FAIL %s (%d issue%s):" % (loc, len(errs), "" if len(errs) == 1 else "s"))
            for e in errs[:20]:
                print("   " + e)
        else:
            print("PASS %s  (EN-identical %d/%d = %.0f%%)" % (loc, en_equal, total, ratio * 100))
    print("\n%d/%d locale(s) failed validation" % (bad, len(targets)))
    sys.exit(1 if bad else 0)


RTL = {"ar", "fa", "he", "ur"}
SITE = "https://denyslebiediev.github.io/imageconverterplus"
EXTRA_PRELOAD = {
    "uk": "cyrillic", "be": "cyrillic", "bg": "cyrillic", "mk": "cyrillic", "sr": "cyrillic",
    "el": "greek", "vi": "vietnamese",
}
PILOT = ["uk", "ar", "ja"]

# Footer language switcher. Display order: Latin A-Z, Cyrillic, Greek, RTL, Indic/SEA, CJK.
LANGS = (
    ("af", "Afrikaans"), ("id", "Bahasa Indonesia"), ("ms", "Bahasa Melayu"),
    ("bs", "Bosanski"), ("ca", "Català"), ("cs", "Čeština"), ("cy", "Cymraeg"),
    ("da", "Dansk"), ("de", "Deutsch"), ("et", "Eesti"), ("en", "English"),
    ("es", "Español"), ("fil", "Filipino"), ("fr", "Français"), ("ga", "Gaeilge"),
    ("hr", "Hrvatski"), ("is", "Íslenska"), ("it", "Italiano"), ("sw", "Kiswahili"),
    ("lv", "Latviešu"), ("lt", "Lietuvių"), ("hu", "Magyar"), ("mt", "Malti"),
    ("nl", "Nederlands"), ("nb", "Norsk bokmål"), ("pl", "Polski"),
    ("pt-BR", "Português (Brasil)"), ("pt-PT", "Português (Portugal)"),
    ("ro", "Română"), ("sq", "Shqip"), ("sk", "Slovenčina"), ("sl", "Slovenščina"),
    ("fi", "Suomi"), ("sv", "Svenska"), ("vi", "Tiếng Việt"), ("tr", "Türkçe"),
    ("be", "Беларуская"), ("bg", "Български"), ("mk", "Македонски"),
    ("sr", "Српски"), ("uk", "Українська"), ("el", "Ελληνικά"),
    ("ar", "العربية"), ("he", "עברית"), ("ur", "اردو"), ("fa", "فارسی"),
    ("hi", "हिन्दी"), ("mr", "मराठी"), ("gu", "ગુજરાતી"), ("pa", "ਪੰਜਾਬੀ"),
    ("bn", "বাংলা"), ("or", "ଓଡ଼ିଆ"), ("ta", "தமிழ்"), ("te", "తెలుగు"), ("kn", "ಕನ್ನಡ"),
    ("ml", "മലയാളം"), ("th", "ไทย"),
    ("ja", "日本語"), ("ko", "한국어"), ("zh-Hans", "简体中文"), ("zh-Hant", "繁體中文"),
)
ENDONYMS = dict(LANGS)


def _load_locale(loc):
    return json.load(open(os.path.join(LOCALES_DIR, loc + ".json"), encoding="utf-8"))


def _js_injection(manifest, data):
    inj = {k: data[k] for k, s in manifest.items() if "js" in s.get("scope", [])}
    blob = json.dumps(inj, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
    return "<script>window.__icpI18n=%s;</script>\n" % blob


def build_landing(loc, manifest, data, badges, shot_locs):
    template = read(os.path.join(ROOT, "index.html"))
    items = keys_for(manifest, "landing")
    html = apply_fragments(template, items, {k: data[k] for k, _ in items})

    # screenshots + badges: swap before path-prefixing (still bare paths here)
    if loc in shot_locs:
        html = html.replace("images/screenshots/en/", "images/screenshots/%s/" % loc)
    token = badges.get(loc, {}).get("token", "en-us")
    if token != "en-us":
        for color in ("black", "white"):
            html = html.replace("images/badges/app-store-%s.svg" % color,
                                "images/badges/%s-%s.svg" % (token, color))

    # remove the locale auto-redirect IIFE (locale pages must not redirect)
    html = re.sub(r"    <script>\n    \(function\(\) \{.*?\}\)\(\);\n    </script>\n",
                  "", html, count=1, flags=re.S)

    # <html lang/dir>
    html = html.replace('<html lang="en" dir="ltr">',
                        '<html lang="%s" dir="%s">' % (loc, "rtl" if loc in RTL else "ltr"), 1)

    # absolute self-URLs (canonical / og:url / JSON-LD url); hreflang cluster untouched
    page = "%s/%s/index.html" % (SITE, loc)
    html = html.replace('rel="canonical" href="%s/">' % SITE, 'rel="canonical" href="%s">' % page, 1)
    html = html.replace('property="og:url" content="%s/">' % SITE,
                        'property="og:url" content="%s">' % page, 1)
    html = html.replace('"url": "%s/",' % SITE, '"url": "%s",' % page, 1)
    html = html.replace('"applicationCategory": "UtilitiesApplication",',
                        '"applicationCategory": "UtilitiesApplication",\n      "inLanguage": "%s",' % loc, 1)

    # path-prefix shared assets (src/href to css|js|images|fonts|site.webmanifest)
    html = re.sub(r'(src|href)="(css/|js/|images/|fonts/|site\.webmanifest)', r'\1="../\2', html)

    # per-locale extra font preload (Latin preload already applies everywhere)
    sub = EXTRA_PRELOAD.get(loc)
    if sub:
        latin = ('<link rel="preload" href="../fonts/inter-var-latin.woff2" '
                 'as="font" type="font/woff2" crossorigin>')
        extra = ('\n    <link rel="preload" href="../fonts/inter-var-%s.woff2" '
                 'as="font" type="font/woff2" crossorigin>' % sub)
        html = html.replace(latin, latin + extra, 1)

    # JS i18n injection before the home.js module tag
    html = html.replace('<script type="module" src="../js/home.js">',
                        _js_injection(manifest, data) + '<script type="module" src="../js/home.js">', 1)

    # footer language switcher: regenerate for this locale (../ prefix, own current-mark)
    if not MENU_RE.search(html):
        raise AssertionError("landing %s: lang-menu block missing in template" % loc)
    html = MENU_RE.sub(lambda m: _lang_menu(loc, "index.html", data["footer_language"], "../"),
                       html, count=1)
    return html


APP_URL = "https://apps.apple.com/app/image-converter-plus/id6759621930"
OLD_THEME = ('    <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">\n'
             '    <meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)">')
NEW_THEME = '    <meta name="theme-color" content="#05060A">'
JS_GATE = ('    <script>\n'
           "        document.documentElement.classList.add('js');\n"
           "        // if subpage.js never boots, un-gate the reveals so content can't stay hidden\n"
           "        setTimeout(function () { if (!window.__icpSubBooted) document.documentElement.classList.remove('js'); }, 2500);\n"
           '    </script>\n')
# The old subpage stylesheet run is base.css + subpage.css, plus support.css on
# support.html and rtl.css on RTL locales — consume the whole consecutive run.
STYLE_RUN_RE = re.compile(
    r'    <link rel="stylesheet" href="\.\./css/base\.css">'
    r'(?:\n +<link rel="stylesheet" href="\.\./css/[a-z-]+\.css">)+')
TAIL_SCRIPT_RE = re.compile(r'<script>\n    // Fade-in on scroll\n.*?</script>', re.S)
SUB_EYEBROW = {"privacy": "sub_eyebrow_privacy", "terms": "sub_eyebrow_terms", "support": "sub_eyebrow_support"}


def _preload_extra(loc):
    sub = EXTRA_PRELOAD.get(loc)
    return ('\n    <link rel="preload" href="../fonts/inter-var-%s.woff2" '
            'as="font" type="font/woff2" crossorigin>' % sub) if sub else ""


def _subpage_head(loc, page, og_title, og_desc):
    url = "%s/%s/%s.html" % (SITE, loc, page)
    return ('    <meta property="og:title" content="%s">\n'
            '    <meta property="og:description" content="%s">\n'
            '    <meta property="og:type" content="website">\n'
            '    <meta property="og:url" content="%s">\n'
            '    <meta property="og:image" content="%s/images/icon-512.png">\n'
            '    <link rel="canonical" href="%s">\n'
            '    <link rel="preload" href="../fonts/inter-var-latin.woff2" as="font" type="font/woff2" crossorigin>%s\n'
            '    <link rel="stylesheet" href="../css/home.css">\n'
            '    <link rel="stylesheet" href="../css/subpage-dark.css">'
            % (og_title, og_desc, url, SITE, url, _preload_extra(loc)))


GLOBE_SVG = ('<svg class="lang-globe" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">'
             '<circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" stroke-width="1.2"/>'
             '<ellipse cx="8" cy="8" rx="2.8" ry="6.3" fill="none" stroke="currentColor" stroke-width="1.2"/>'
             '<path d="M1.7 8h12.6M2.6 4.6h10.8M2.6 11.4h10.8" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>')
CHEV_SVG = ('<svg class="lang-chev" viewBox="0 0 10 6" width="10" height="6" aria-hidden="true">'
            '<path d="m1 1 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" '
            'stroke-linecap="round" stroke-linejoin="round"/></svg>')
CHECK_SVG = ('<svg class="lang-check" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">'
             '<path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" stroke-width="2" '
             'stroke-linecap="round" stroke-linejoin="round"/></svg>')
MENU_RE = re.compile(r"<!-- lang-menu -->.*?<!-- /lang-menu -->", re.S)


def _lang_menu(current, pagefile, label, prefix):
    """The footer language switcher block for one page. English targets the root
    pages with ?lang=en (defeats the auto-redirect IIFE); en/ stubs are never linked."""
    items = []
    for code, name in LANGS:
        href = ("%s%s?lang=en" % (prefix, pagefile) if code == "en"
                else "%s%s/%s" % (prefix, code, pagefile))
        cur = ' aria-current="true"' if code == current else ""
        check = CHECK_SVG if code == current else ""
        items.append('                    <li><a href="%s" lang="%s" hreflang="%s"%s>%s%s</a></li>'
                     % (href, code, code, cur, esc(name), check))
    return ('<!-- lang-menu -->\n'
            '        <details class="lang-menu">\n'
            '            <summary class="lang-trigger" aria-label="%s: %s">%s<span class="lang-current">%s</span>%s</summary>\n'
            '            <div class="lang-panel">\n'
            '                <ul class="lang-list" role="list" translate="no">\n'
            '%s\n'
            '                </ul>\n'
            '            </div>\n'
            '        </details>\n'
            '        <script defer src="%sjs/lang-menu.js"></script>\n'
            '        <!-- /lang-menu -->'
            % (esc(label), esc(ENDONYMS[current]), GLOBE_SVG, esc(ENDONYMS[current]),
               CHEV_SVG, "\n".join(items), prefix))


def _site_footer(labels, lang_menu):
    return ('<footer class="site-footer">\n'
            '    <div class="footer-inner">\n'
            '        <span class="copyright">© 2026 Denys Lebiediev</span>\n'
            '        <ul class="footer-links">\n'
            '            <li><a href="privacy.html">%s</a></li>\n'
            '            <li><a href="terms.html">%s</a></li>\n'
            '            <li><a href="support.html">%s</a></li>\n'
            '        </ul>\n'
            '        %s\n'
            '    </div>\n'
            '</footer>' % (labels["privacy"], labels["terms"], labels["support"], lang_menu))


def _sub(html, old, new, what):
    """Single, mandatory replacement (hard-fail if the anchor is absent)."""
    if old not in html:
        raise AssertionError("subpage op %r: anchor not found" % what)
    return html.replace(old, new, 1)


def build_subpage(loc, page, manifest, data):
    html = git_show("%s/%s.html" % (loc, page))
    if not html:
        raise SystemExit("no old %s/%s.html in HEAD" % (loc, page))

    skip, nav_cta, nav_aria = esc(data["skip"]), esc(data["nav_cta"]), esc(data["nav_aria"])
    eyebrow = esc(data[SUB_EYEBROW[page]])

    # OG source values are captured raw (already HTML-escaped in the old page)
    title = re.search(r"<title>(.*?)</title>", html, re.S).group(1)
    og_title = title.replace(" - ", " — ", 1)
    og_desc = re.search(r'<meta name="description" content="(.*?)">', html, re.S).group(1)

    html = _sub(html, OLD_THEME, NEW_THEME, "theme-color")
    html = _sub(html, "    <title>", JS_GATE + "    <title>", "js-gate")
    if not STYLE_RUN_RE.search(html):
        raise AssertionError("subpage %s/%s: stylesheet run not found" % (loc, page))
    html = STYLE_RUN_RE.sub(lambda m: _subpage_head(loc, page, og_title, og_desc), html, count=1)
    html = _sub(html, "<body>\n", '<body>\n\n<a class="skip-link" href="#main">%s</a>\n' % skip, "skip-link")

    # nav
    html = _sub(html, "<!-- Nav -->\n<nav>\n", '<nav class="site-nav" aria-label="%s">\n' % nav_aria, "nav-open")
    html = _sub(html,
                '        <a class="nav-title" href="index.html">Image Converter Plus</a>\n',
                '        <a class="nav-brand" href="index.html">\n'
                '            <img src="../images/AppIcon.png" alt="" width="28" height="28">\n'
                '            <span>Image Converter Plus</span>\n'
                '        </a>\n', "nav-brand")
    html = _sub(html, '<li><a href="%s.html">' % page,
                '<li><a href="%s.html" aria-current="page">' % page, "aria-current")
    html = _sub(html, "        </ul>\n    </div>\n</nav>",
                '        </ul>\n        <a class="nav-cta" href="%s">%s</a>\n    </div>\n</nav>'
                % (APP_URL, nav_cta), "nav-cta")

    html = _sub(html, '<div class="page">', '<div class="page" id="main">', "page-main")

    # hero -> page-head (capture h1 + subtitle by structure; support.html carries
    # an extra contact button inside the hero, which must be kept).
    # No re.S here: with DOTALL the subtitle's (.*?) runs past its own </div> and
    # swallows the rest of the page up to the next "</p>\n    </div>" — on support
    # that meant re-emitting the whole body inside <p class="subtitle">.
    m = re.search(r'    <div class="hero fade-in">\n        <h1>(.*?)</h1>\n'
                  r'        <p class="subtitle">(.*?)</p>\n'
                  r'((?:        <a [^\n]*class="contact-btn"[^\n]*</a>\n)?)'
                  r'    </div>', html)
    if not m:
        raise AssertionError("subpage %s/%s: hero block not found" % (loc, page))
    new_hero = ('    <header class="page-head">\n        <p class="eyebrow mono">%s</p>\n'
                '        <h1 class="headline">%s</h1>\n        <p class="subtitle">%s</p>\n'
                '%s    </header>'
                % (eyebrow, m.group(1), m.group(2), m.group(3)))
    html = html.replace(m.group(0), new_hero, 1)

    if page in ("privacy", "terms"):
        html = _sub(html, '    <div class="stagger">\n', "    <div>\n", "stagger")
    if page == "support":
        html = _sub(html, '<div class="formats-section fade-in">',
                    '<div class="formats-section" data-reveal>', "formats-section")
        html = _sub(html, '<div class="formats-row stagger">', '<div class="formats-row">', "formats-row")
        html = html.replace('<span class="format-badge fade-in">', '<span class="format-badge chip mono">')
        for fmt in ("PDF", "AVIF", "TIFF"):
            html = _sub(html,
                        '<span class="format-badge chip mono">%s</span>' % fmt,
                        '<span class="format-badge chip mono is-pro">%s <span class="pro-tag">PRO</span></span>' % fmt,
                        "format-pro-" + fmt)
        html = html.replace('<div class="faq-category fade-in">', '<div class="faq-category" data-reveal>')
        html = _sub(html, '<div class="requirements fade-in">',
                    '<div class="requirements" data-reveal>', "requirements")
    n_cards = html.count('<div class="content-card fade-in">')
    html = html.replace('<div class="content-card fade-in">', '<div class="content-card" data-reveal>')
    html = html.replace('<div class="links-section fade-in">', '<div class="links-section" data-reveal>', 1)
    html = html.replace('<div class="footer fade-in">', '<div class="footer">', 1)

    labels = {pg: re.search(r'<li><a href="%s\.html"[^>]*>(.*?)</a></li>' % pg, html).group(1)
              for pg in ("privacy", "terms", "support")}
    if not TAIL_SCRIPT_RE.search(html):
        raise AssertionError("subpage %s/%s: tail script not found" % (loc, page))
    html = TAIL_SCRIPT_RE.sub(
        lambda m2: _site_footer(labels, _lang_menu(loc, page + ".html", data["footer_language"], "../"))
                   + '\n\n<script defer src="../js/subpage.js"></script>',
        html, count=1)
    return html, n_cards


def cmd_build():
    args = sys.argv[2:]
    if args == ["--pilot"]:
        targets = PILOT
    elif args == ["--all"]:
        targets = locales()
    else:
        targets = args or locales()

    only = None
    if targets and targets[0] in ("--landing", "--subpages"):
        only = targets[0]
        targets = targets[1:] or locales()

    manifest = load_manifest()
    badges = json.load(open(os.path.join(I18N, "badges.json"), encoding="utf-8"))
    shot_locs = set(json.load(open(os.path.join(I18N, "screenshots.json"), encoding="utf-8")))
    for loc in targets:
        data = _load_locale(loc)
        if only != "--subpages":
            html = build_landing(loc, manifest, data, badges, shot_locs)
            with open(os.path.join(ROOT, loc, "index.html"), "w", encoding="utf-8") as f:
                f.write(html)
            print("built %s/index.html (%d bytes)" % (loc, len(html)))
        if only != "--landing":
            for page in ("privacy", "terms", "support"):
                html, n = build_subpage(loc, page, manifest, data)
                with open(os.path.join(ROOT, loc, page + ".html"), "w", encoding="utf-8") as f:
                    f.write(html)
                print("built %s/%s.html (%d cards)" % (loc, page, n))


ROOT_PAGES = ("index.html", "privacy.html", "terms.html", "support.html")
FOOT_ANCHOR = "        </ul>\n    </div>\n</footer>"


def cmd_footerize():
    """Inject/refresh the English footer language menu in the 4 root pages. Idempotent."""
    for pf in ROOT_PAGES:
        path = os.path.join(ROOT, pf)
        html = read(path)
        block = _lang_menu("en", pf, "Language", "")
        if MENU_RE.search(html):
            html = MENU_RE.sub(lambda m: block, html, count=1)
        elif FOOT_ANCHOR in html:
            html = html.replace(FOOT_ANCHOR,
                                "        </ul>\n        %s\n    </div>\n</footer>" % block, 1)
        else:
            raise SystemExit("footer anchor not found in " + pf)
        with open(path, "w", encoding="utf-8") as f:
            f.write(html)
        print("footerized " + pf)


def cmd_integrity():
    """Every visible text line in the OLD subpage must survive in the built one
    (the transform restyles chrome + tweaks classes but must not drop body text)."""
    targets = sys.argv[2:] or locales()
    bad = 0
    for loc in targets:
        for page in ("privacy", "terms", "support"):
            old = visible_text(git_show("%s/%s.html" % (loc, page)))
            newp = os.path.join(ROOT, loc, page + ".html")
            if not os.path.exists(newp):
                print("FAIL %s/%s: not built" % (loc, page))
                bad += 1
                continue
            new_set = set(visible_text(read(newp)).split("\n"))
            old_lines = [ln for ln in old.split("\n") if ln.strip()]
            missing = [ln for ln in old_lines if ln not in new_set]
            if missing:
                bad += 1
                print("FAIL %s/%s: %d body line(s) lost" % (loc, page, len(missing)))
                for ln in missing[:5]:
                    print("   - %r" % ln[:90])
            else:
                print("PASS %s/%s (%d lines preserved)" % (loc, page, len(old_lines)))
    print("\n%d subpage(s) failed integrity" % bad)
    sys.exit(1 if bad else 0)


def cmd_sitemap():
    """Emit sitemap.xml (4 root + 236 locale = 240 URLs; en/ stubs excluded) + robots.txt."""
    urls = ["%s/" % SITE]
    for pg in ("privacy", "terms", "support"):
        urls.append("%s/%s.html" % (SITE, pg))
    for loc in locales():
        urls.append("%s/%s/index.html" % (SITE, loc))
        for pg in ("privacy", "terms", "support"):
            urls.append("%s/%s/%s.html" % (SITE, loc, pg))

    body = "\n".join('  <url><loc>%s</loc></url>' % u for u in urls)
    xml = ('<?xml version="1.0" encoding="UTF-8"?>\n'
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
           '%s\n</urlset>\n' % body)
    with open(os.path.join(ROOT, "sitemap.xml"), "w", encoding="utf-8") as f:
        f.write(xml)
    robots = ("User-agent: *\nAllow: /\n\nSitemap: %s/sitemap.xml\n" % SITE)
    with open(os.path.join(ROOT, "robots.txt"), "w", encoding="utf-8") as f:
        f.write(robots)
    print("wrote sitemap.xml (%d URLs) + robots.txt" % len(urls))


def main():
    cmds = {"selftest": cmd_selftest, "harvest": cmd_harvest, "prefill": cmd_prefill,
            "validate": cmd_validate, "build": cmd_build, "footerize": cmd_footerize,
            "integrity": cmd_integrity, "sitemap": cmd_sitemap}
    if len(sys.argv) < 2 or sys.argv[1] not in cmds:
        print("usage: build_locales.py {%s}" % "|".join(cmds))
        sys.exit(2)
    cmds[sys.argv[1]]()


if __name__ == "__main__":
    main()
