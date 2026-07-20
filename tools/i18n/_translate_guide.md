# Translation task — Image Converter Plus marketing website

You are a professional software + marketing localizer. Translate the site into each target language assigned to you. All paths are under `/Users/Denys_Lebiediev/Projects/ios_projects/ImageConverterPlus/legal/`.

## For EACH locale `<loc>` assigned to you

**Inputs**
- WORKLIST: `tools/i18n/_fresh.json` — a JSON object `{key: {en, ctx?, plural?, html?}}`. Translate the `en` value of EVERY key (104 total). Same worklist for all locales.
- TERMINOLOGY REFERENCE: `tools/i18n/harvest/<loc>.json` — its `terminology` field is the FULL previous professional translation of this site into that language. Match its established terminology, tone, and Apple-style wording. IGNORE any phrasing about a "size estimate in real time" — that feature no longer exists; do NOT reintroduce it.

**Output**: write `tools/i18n/locales/<loc>.json` — a JSON object mapping each of the 104 keys to its translation. Overwrite. Valid JSON, UTF-8, no comments, no trailing prose. Exactly 104 keys. Do NOT include `title`, `meta_desc`, `nav_privacy`, `nav_terms`, `nav_support`, `badge_alt` (handled separately — they are not in the worklist).

## Rules
1. Translate every key. Brand tone: confident, clean, privacy-first, concise. Eyebrows/hero strings are short.
2. **HTML keys** (`html:true`): preserve EVERY HTML tag and `&entity` EXACTLY as in `en` — `<span class="grad">…</span>`, `<strong>…</strong>`, `<br>`, `<a href="privacy.html">…</a>`, `&amp;`, `&nbsp;`, and the characters `↓ → ·`. Translate only the human text between/around them. A validator rejects ANY change to the tag/entity set.
3. **Plural keys** (`verdict_reveal`, `verdict_almost`): output an OBJECT of CLDR plural category → form, using the CORRECT CLDR **cardinal** categories for the language. Examples: English `one/other`; German/Dutch/Nordic/Greek/Turkish/Hungarian/most `one/other`; Polish/Czech/Slovak/Lithuanian `one/few/many/other`; Croatian/Serbian/Bosnian/Romanian `one/few/other`; French/Spanish/Portuguese/Italian/Catalan `one/many/other`; Slovenian `one/two/few/other`; Latvian `zero/one/other`; Irish `one/two/few/many/other`; Welsh/Arabic use many categories; Chinese/Japanese/Korean/Vietnamese/Indonesian/Malay/Thai only `other`. Every form contains the literal `{n}` and keeps `<strong>…</strong>`. Use ASCII digits.
4. Keep AS-IS (do NOT translate): brand `Image Converter Plus`; format tokens `JPEG PNG WebP HEIC AVIF TIFF PDF`; Apple terms Apple ships in English in the language (verify `VoiceOver` / `Dynamic Type`; keep English if Apple does). Numbers stay ASCII digits.
5. Apple terminology: `App Store`, `Share Sheet` / `Share Extension`, `Family Sharing`, `Airplane Mode` — use Apple's official localized names (cross-check the terminology reference).
6. `unit_mb` = the megabyte unit per Apple convention for the language (e.g. French `Mo`; German/Italian/Spanish/Portuguese/most Latin-script `MB`; Ukrainian `МБ`; Greek `MB`; use the script's conventional form).
7. RTL languages (Arabic, Hebrew, Persian, Urdu): natural RTL text; do NOT insert RTL/LTR marks inside html-key values.

After writing each file, re-open it and confirm it parses as JSON with exactly 104 keys. Do not run build scripts or touch any other file. Final message: one line per locale ("wrote <loc>: N keys") + up to 3 short notes on genuine judgment calls.
