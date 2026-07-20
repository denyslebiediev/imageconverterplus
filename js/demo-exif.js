/* EXIF privacy inspector: parse a dropped photo's metadata locally (exifr),
   type the dossier in, drop a location fix if GPS exists, then strip it all. */

import exifr from './vendor/exifr.esm.js';

// i18n: the locale build injects window.__icpI18n; EN pages fall back to the literal.
const I18N = window.__icpI18n || {};
const LANG = document.documentElement.lang || 'en';
// BCP-47 tag for Intl/date/Maps APIs (Chinese script tags need a region; en -> en-US keeps the original formatting byte-identical).
const LOCALE = ({ 'zh-Hans': 'zh-CN', 'zh-Hant': 'zh-TW', en: 'en-US' })[LANG] || LANG;
const t = (k, f) => I18N[k] || f;
const PR = (() => { try { return new Intl.PluralRules(LOCALE); } catch (e) { return new Intl.PluralRules('en'); } })();
function tp(k, n, fallback) {
    const forms = I18N[k] || fallback;
    return (forms[PR.select(n)] || forms.other).replace('{n}', n);
}

/* Maps Static API key (referer-restricted to this site). Empty = no external
   request at all; the panel falls back to the abstract radar grid. */
const MAPS_KEY = 'AIzaSyBF1C4WcLeSd3DkMPUWHPc2xXBJ3LjzdAc';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Controls-free dark-styled static map centered on the fix. The marker is our
   own SVG crosshair overlay (panel center = the coords), not a Google pin. */
function staticMapURL(lat, lon) {
    const p = new URLSearchParams({
        center: `${lat.toFixed(5)},${lon.toFixed(5)}`,
        zoom: '15',
        size: '640x356',
        scale: '2',
        language: LOCALE,
        key: MAPS_KEY,
    });
    [
        'feature:all|element:geometry|color:0x0b0e14',
        'feature:all|element:labels.text.fill|color:0x8a93a6',
        'feature:all|element:labels.text.stroke|color:0x05060a',
        'feature:all|element:labels.icon|visibility:off',
        'feature:road|element:geometry|color:0x1a2030',
        'feature:water|element:geometry|color:0x0e1420',
        'feature:poi|visibility:off',
        'feature:transit|visibility:off',
    ].forEach((s) => p.append('style', s));
    return `https://maps.googleapis.com/maps/api/staticmap?${p}`;
}

function fmtDate(d) {
    if (!(d instanceof Date) || isNaN(d)) return null;
    const day = d.toLocaleDateString(LOCALE, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    const time = d.toLocaleTimeString(LOCALE, { hour12: false });
    return `${day} · ${time}`;
}
function fmtExposure(x) {
    if (!x) return null;
    return x >= 1 ? `${x} s` : `1/${Math.round(1 / x)} s`;
}

function buildRows(d) {
    if (!d) return [];
    const rows = [];
    const push = (label, value) => value && rows.push([label, String(value)]);

    push(t('dl_device', 'Device'), [d.Make, d.Model].filter(Boolean).join(' '));
    push(t('dl_lens', 'Lens'), d.LensModel);
    push(t('dl_software', 'Software'), d.Software || d.CreatorTool);
    push(t('dl_captured', 'Captured'), fmtDate(d.DateTimeOriginal || d.CreateDate || d.ModifyDate));
    push(t('dl_exposure', 'Exposure'), [fmtExposure(d.ExposureTime), d.FNumber && `f/${d.FNumber}`, (d.ISO || d.ISOSpeedRatings) && `ISO ${d.ISO || d.ISOSpeedRatings}`].filter(Boolean).join(' · '));
    push(t('dl_focal', 'Focal length'), d.FocalLength && `${d.FocalLength} mm`);
    push(t('dl_dimensions', 'Dimensions'), d.ExifImageWidth && d.ExifImageHeight && `${d.ExifImageWidth} × ${d.ExifImageHeight}`);
    push(t('dl_author', 'Author'), d.Artist || (Array.isArray(d.creator) ? d.creator.join(', ') : d.creator));
    push(t('dl_copyright', 'Copyright'), d.Copyright);
    push(t('dl_caption', 'Caption'), d.ImageDescription || d.description?.value || d.description);
    if (d.latitude != null && d.longitude != null) {
        push(t('dl_location', 'Location'), `${d.latitude.toFixed(5)}, ${d.longitude.toFixed(5)}`);
        if (d.GPSAltitude) push(t('dl_altitude', 'Altitude'), `${Math.round(d.GPSAltitude)} ${t('alt_suffix', 'm above sea level')}`);
    }
    return rows;
}

export function init(panel) {
    const el = (id) => panel.querySelector(id);
    const intro = el('#exif-intro');
    const result = el('#exif-result');
    const thumb = el('#exif-thumb');
    const thumbName = el('#exif-thumbname');
    const scanline = el('#exif-scanline');
    const count = el('#exif-count');
    const countLabel = el('#exif-count-label');
    const rowsDl = el('#exif-rows');
    const map = el('#exif-map');
    const mapImg = el('#exif-map-img');
    const mapCaption = el('#exif-map-caption');
    const coordsEl = el('#exif-coords');
    const fixH = map.querySelector('.fix-h');
    const fixV = map.querySelector('.fix-v');
    const ring = map.querySelector('.fix-ring');
    const dot = map.querySelector('.fix-dot');
    const verdict = el('#exif-verdict');
    const stripBtn = el('#exif-strip');
    const againBtn = el('#exif-again');
    const clean = el('#exif-clean');
    const actions = panel.querySelector('.dossier-actions');

    let thumbURL = null;
    let timers = [];

    function clearTimers() {
        timers.forEach(clearTimeout);
        timers = [];
    }
    function later(fn, ms) {
        if (reducedMotion) { fn(); return; }
        timers.push(setTimeout(fn, ms));
    }

    function reset() {
        clearTimers();
        rowsDl.innerHTML = '';
        count.textContent = '0';
        countLabel.textContent = t('insp_fields', 'fields found');
        map.hidden = true;
        map.classList.remove('is-stripped', 'has-map');
        mapImg.removeAttribute('src');
        mapCaption.textContent = t('insp_mapcaption', 'THIS PHOTO KNOWS WHERE YOU WERE.');
        verdict.textContent = '';
        clean.hidden = true;
        stripBtn.hidden = false;
        stripBtn.disabled = false;
        actions.hidden = false;
        if (thumbURL) { URL.revokeObjectURL(thumbURL); thumbURL = null; }
        thumb.hidden = false;
    }

    function showFix(lat, lon) {
        let x = ((lon + 180) / 360) * 360;
        let y = ((90 - lat) / 180) * 200;
        if (MAPS_KEY) {
            // Real map is centered on the fix, so the crosshair sits at panel
            // center; until the image loads (or if it fails) the same point
            // reads fine on the fallback grid.
            x = 180; y = 100;
            mapImg.src = staticMapURL(lat, lon);
        }
        fixH.setAttribute('y1', y); fixH.setAttribute('y2', y);
        fixV.setAttribute('x1', x); fixV.setAttribute('x2', x);
        ring.setAttribute('cx', x); ring.setAttribute('cy', y);
        dot.setAttribute('cx', x); dot.setAttribute('cy', y);
        coordsEl.textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
        map.hidden = false;
        if (!reducedMotion) {
            // one red pulse — not looping
            const t0 = performance.now();
            const pulse = (now) => {
                const p = Math.min((now - t0) / 800, 1);
                ring.setAttribute('r', 9 + p * 18);
                ring.style.opacity = String(1 - p);
                if (p < 1) requestAnimationFrame(pulse);
                else { ring.setAttribute('r', 9); ring.style.opacity = ''; }
            };
            requestAnimationFrame(pulse);
        }
    }

    async function handleFile(file) {
        reset();
        intro.hidden = true;
        result.hidden = false;
        result.focus({ preventScroll: true });

        thumbURL = URL.createObjectURL(file);
        thumb.src = thumbURL;
        thumb.onerror = () => {
            thumb.hidden = true;
            thumbName.textContent = `${file.name} ${t('thumb_nopreview', '(no preview in this browser — metadata still reads fine)')}`;
        };
        thumbName.textContent = file.name;

        if (!reducedMotion && scanline.animate) {
            scanline.animate(
                [{ top: '0%', opacity: 1 }, { top: '99%', opacity: 1 }, { top: '99%', opacity: 0 }],
                { duration: 700, easing: 'ease-in-out' }
            );
        }

        let data = null;
        try {
            data = await exifr.parse(file, { tiff: true, exif: true, gps: true, xmp: true, iptc: true });
        } catch (e) {
            verdict.textContent = t('err_read', "Couldn't read that file. Try a JPEG or HEIC straight from a camera.");
            stripBtn.hidden = true;
            return;
        }

        const rows = buildRows(data);
        const hasGPS = data && data.latitude != null && data.longitude != null;

        if (rows.length === 0) {
            verdict.textContent = t('no_metadata', 'No metadata found — this image is already clean. Photos straight from your camera usually say much more. Try one, or inspect the sample.');
            stripBtn.hidden = true;
            return;
        }

        rows.forEach(([label, value], i) => {
            later(() => {
                const dt = document.createElement('dt');
                dt.textContent = label;
                const dd = document.createElement('dd');
                dd.textContent = value;
                rowsDl.append(dt, dd);
                count.textContent = String(i + 1);
            }, 350 + i * 90);
        });

        const revealDone = 350 + rows.length * 90;
        if (hasGPS) {
            later(() => showFix(data.latitude, data.longitude), revealDone + 150);
        }
        later(() => {
            if (rows.length <= 2 && !hasGPS) {
                verdict.innerHTML = tp('verdict_almost', rows.length, {
                    one: "Almost clean — only <strong>{n} technical field</strong>. Photos straight from your camera usually say much more.",
                    other: "Almost clean — only <strong>{n} technical fields</strong>. Photos straight from your camera usually say much more.",
                });
            } else {
                verdict.innerHTML = tp('verdict_reveal', rows.length, {
                    one: "This photo reveals <strong>{n} thing</strong> you can't see.",
                    other: "This photo reveals <strong>{n} things</strong> you can't see.",
                });
            }
        }, revealDone + (hasGPS ? 500 : 100));
    }

    function strip() {
        clearTimers(); // kill any still-pending reveal timers so rows can't resurrect
        stripBtn.disabled = true;
        const dds = [...rowsDl.querySelectorAll('dd')];
        const glyphs = '▚▞▖▗▘░▒';
        dds.forEach((dd, i) => {
            later(() => {
                if (!reducedMotion) {
                    let f = 0;
                    const scramble = setInterval(() => {
                        f += 1;
                        if (f >= 5) {
                            clearInterval(scramble);
                            dd.textContent = '––––––––';
                            dd.classList.add('is-stripped');
                        } else {
                            dd.textContent = Array.from({ length: Math.min(dd.textContent.length, 24) },
                                () => glyphs[(Math.random() * glyphs.length) | 0]).join('');
                        }
                    }, 45);
                    timers.push(scramble);
                } else {
                    dd.textContent = '––––––––';
                    dd.classList.add('is-stripped');
                }
                count.textContent = String(Math.max(0, dds.length - i - 1));
            }, i * 80);
        });
        later(() => {
            // force-finish any row whose scramble interval got throttled away
            dds.forEach((dd) => {
                if (!dd.classList.contains('is-stripped')) {
                    dd.textContent = '––––––––';
                    dd.classList.add('is-stripped');
                }
            });
            map.classList.add('is-stripped');
            mapCaption.textContent = t('map_removed', 'LOCATION REMOVED.');
            coordsEl.textContent = '––';
            countLabel.textContent = t('insp_fields_left', 'fields left');
            verdict.textContent = t('meta_removed', 'Metadata removed.'); // role=status announces completion
            stripBtn.hidden = true;
            clean.hidden = false;
            againBtn.focus({ preventScroll: true });
        }, dds.length * 80 + 400);
    }

    async function loadSample() {
        intro.hidden = true;
        result.hidden = false;
        try {
            const res = await fetch(new URL('../images/sample-exif.jpg', import.meta.url));
            const blob = await res.blob();
            handleFile(new File([blob], 'sample-exif.jpg', { type: 'image/jpeg' }));
        } catch (e) {
            verdict.textContent = t('err_sample', "Couldn't load the sample photo. Drop one of your own instead.");
        }
    }

    mapImg.addEventListener('load', () => map.classList.add('has-map'));
    mapImg.addEventListener('error', () => map.classList.remove('has-map'));

    stripBtn.addEventListener('click', strip);
    againBtn.addEventListener('click', () => {
        reset();
        result.hidden = true;
        intro.hidden = false;
        el('#exif-drop').querySelector('input')?.focus({ preventScroll: true });
    });

    return { handleFile, loadSample };
}
