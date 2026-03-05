const fs = require('fs');
const path = require('path');
const { LANGUAGES, RTL_LANGS, BASE_URL, APP_STORE_LOCALE_MAP, PAGES } = require('./config');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const TEMPLATES_DIR = path.join(ROOT, 'templates');
const TRANSLATIONS_DIR = path.join(ROOT, 'translations');

// ---- Helpers ----

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function resolve(obj, keyPath) {
  const keys = keyPath.split('.');
  let val = obj;
  for (const k of keys) {
    if (val == null) return undefined;
    val = val[k];
  }
  return val;
}

// ---- Template engine ----

function render(template, data) {
  // {{#each key.path}} ... {{/each}}
  let result = template.replace(
    /\{\{#each\s+([\w._]+)\}\}([\s\S]*?)\{\{\/each\}\}/g,
    (_, keyPath, body) => {
      const arr = resolve(data, keyPath);
      if (!Array.isArray(arr)) return '';
      return arr.map((item, index) => {
        // If item is a string, make it available as {{this}}
        const itemData = typeof item === 'string'
          ? { ...data, this: item, '@index': index }
          : { ...data, ...item, '@index': index };
        return render(body, itemData);
      }).join('');
    }
  );

  // {{#if key.path}} ... {{/if}}
  result = result.replace(
    /\{\{#if\s+([\w._]+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_, keyPath, body) => {
      const val = resolve(data, keyPath);
      if (!val || (Array.isArray(val) && val.length === 0)) return '';
      return render(body, data);
    }
  );

  // {{{key.path}}} — raw (no escaping)
  result = result.replace(
    /\{\{\{([\w._]+)\}\}\}/g,
    (_, keyPath) => {
      const val = resolve(data, keyPath);
      return val != null ? String(val) : '';
    }
  );

  // {{key.path}} — HTML-escaped
  result = result.replace(
    /\{\{([\w._]+)\}\}/g,
    (_, keyPath) => {
      const val = resolve(data, keyPath);
      return val != null ? escapeHtml(String(val)) : '';
    }
  );

  return result;
}

// ---- Build hreflang tags ----

function buildHreflangTags(page) {
  const tags = LANGUAGES.map(lang => {
    const url = `${BASE_URL}/${lang}/${page}`;
    return `    <link rel="alternate" hreflang="${lang}" href="${url}">`;
  });
  tags.push(`    <link rel="alternate" hreflang="x-default" href="${BASE_URL}/en/${page}">`);
  return tags.join('\n');
}

// ---- Build App Store badge URL ----

function buildBadgeUrl(lang) {
  const locale = APP_STORE_LOCALE_MAP[lang] || 'en-us';
  return `https://tools.applemediaservices.com/api/badges/download-on-the-app-store/black/${locale}?size=250x83`;
}

// ---- Language-detecting redirect ----

function buildRedirect(prefix, targetPage) {
  const langList = JSON.stringify(LANGUAGES);
  const fallback = `${prefix}en/${targetPage}`;
  return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Image Converter Plus</title>
    <noscript><meta http-equiv="refresh" content="0;url=${fallback}"></noscript>
    <script>
    (function() {
        var supported = ${langList};
        var set = {};
        for (var i = 0; i < supported.length; i++) set[supported[i]] = true;

        var aliases = {
            'zh-CN': 'zh-Hans', 'zh-TW': 'zh-Hant',
            'pt': 'pt-BR', 'no': 'nb', 'tl': 'fil'
        };

        var prefix = ${JSON.stringify(prefix)};
        var target = ${JSON.stringify(targetPage)};
        var langs = navigator.languages || [navigator.language || 'en'];
        for (var i = 0; i < langs.length; i++) {
            var tag = langs[i];
            if (aliases[tag]) tag = aliases[tag];
            if (set[tag]) { location.replace(prefix + tag + '/' + target); return; }
            var base = tag.split('-')[0];
            if (aliases[base]) base = aliases[base];
            if (set[base]) { location.replace(prefix + base + '/' + target); return; }
        }
        location.replace(prefix + 'en/' + target);
    })();
    <\/script>
</head>
<body></body>
</html>`;
}

// ---- Clean & create dist ----

function cleanDist() {
  if (fs.existsSync(DIST)) {
    fs.rmSync(DIST, { recursive: true });
  }
  fs.mkdirSync(DIST, { recursive: true });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// ---- Main build ----

function build() {
  console.log('Building...');
  cleanDist();

  // Copy static assets
  copyDir(path.join(ROOT, 'css'), path.join(DIST, 'css'));
  copyDir(path.join(ROOT, 'images'), path.join(DIST, 'images'));

  // Load templates
  const templates = {};
  for (const page of PAGES) {
    templates[page] = fs.readFileSync(path.join(TEMPLATES_DIR, page), 'utf8');
  }

  // Pre-compute hreflang blocks
  const hreflangBlocks = {};
  for (const page of PAGES) {
    hreflangBlocks[page] = buildHreflangTags(page);
  }

  let totalPages = 0;

  // Generate pages for each language
  for (const lang of LANGUAGES) {
    const transFile = path.join(TRANSLATIONS_DIR, `${lang}.json`);
    if (!fs.existsSync(transFile)) {
      console.warn(`  SKIP ${lang} — translation file not found`);
      continue;
    }

    const translation = JSON.parse(fs.readFileSync(transFile, 'utf8'));
    const dir = RTL_LANGS.has(lang) ? 'rtl' : 'ltr';
    const rtlCss = RTL_LANGS.has(lang)
      ? '    <link rel="stylesheet" href="../css/rtl.css">'
      : '';

    const langDir = path.join(DIST, lang);
    fs.mkdirSync(langDir, { recursive: true });

    for (const page of PAGES) {
      const data = {
        ...translation,
        __lang__: lang,
        __dir__: dir,
        __hreflang_tags__: hreflangBlocks[page],
        __rtl_css__: rtlCss,
        __app_store_badge_url__: buildBadgeUrl(lang)
      };

      const html = render(templates[page], data);
      fs.writeFileSync(path.join(langDir, page), html, 'utf8');
      totalPages++;
    }
  }

  // Write root redirect
  fs.writeFileSync(path.join(DIST, 'index.html'), buildRedirect('', 'index.html'), 'utf8');

  // Write subpage redirects (e.g. /support/ → ../{lang}/support.html)
  const subpageRedirects = ['support.html', 'privacy.html', 'terms.html'];
  for (const page of subpageRedirects) {
    const dirName = page.replace('.html', '');
    const subDir = path.join(DIST, dirName);
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, 'index.html'), buildRedirect('../', page), 'utf8');
  }

  console.log(`Done! Generated ${totalPages} pages for ${LANGUAGES.length} languages.`);
  console.log(`Output: ${DIST}`);
}

build();
