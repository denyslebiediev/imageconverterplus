/* Landing page orchestration: hero boot, GSAP scenes, lazy demo wiring. */

window.__icpBooted = true;

// i18n: the locale build injects window.__icpI18n; EN pages fall back to the literal.
const t = (k, f) => (window.__icpI18n && window.__icpI18n[k]) || f;

const doc = document.documentElement;
const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const reducedMotion = motionQuery.matches;
// scenes/GL are wired once at load; a mid-session preference flip is rare
// enough that a clean reload is the honest response
motionQuery.addEventListener?.('change', () => location.reload());
const hasGsap = typeof window.gsap !== 'undefined' && typeof window.ScrollTrigger !== 'undefined';

if (!hasGsap) {
    // vendor scripts failed: show everything, keep demos working
    doc.classList.remove('js');
}

// smooth anchor scrolling in JS, not CSS: html { scroll-behavior: smooth }
// makes ScrollTrigger sample rects mid-animated-scroll on any refresh that
// happens while the page is scrolled, permanently corrupting the hero pin.
// The .skip-link keeps the native instant jump (focus semantics).
document.querySelectorAll('a[href^="#"]:not(.skip-link)').forEach((a) => {
    a.addEventListener('click', (e) => {
        const target = document.getElementById(a.getAttribute('href').slice(1));
        if (!target) return;
        e.preventDefault();
        target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
        history.pushState(null, '', a.getAttribute('href'));
    });
});

/* ---------- Lazy demo wiring (independent of GSAP) ---------- */

function lazyDemo(panelId, importer) {
    const panel = document.getElementById(panelId);
    if (!panel) return;
    let modPromise = null;
    const ensure = () => (modPromise ||= importer().then((m) => m.init(panel)).catch((e) => {
        modPromise = null; // allow retry on the next interaction
        throw e;
    }));

    panel.addEventListener('dragover', (e) => {
        e.preventDefault();
        panel.querySelector('.dropzone')?.classList.add('is-over');
        ensure();
    });
    panel.addEventListener('dragleave', () => {
        panel.querySelector('.dropzone')?.classList.remove('is-over');
    });
    panel.addEventListener('drop', (e) => {
        e.preventDefault();
        panel.querySelector('.dropzone')?.classList.remove('is-over');
        const file = e.dataTransfer?.files?.[0];
        ensure().then((api) => file && api.handleFile(file));
    });
    panel.addEventListener('change', (e) => {
        if (e.target.matches('input[type="file"]')) {
            const file = e.target.files?.[0];
            e.target.value = ''; // so re-picking the same file fires change again
            ensure().then((api) => file && api.handleFile(file));
        }
    });
    panel.addEventListener('pointerenter', ensure, { once: true });
    panel.addEventListener('focusin', ensure, { once: true });
    return ensure;
}

const ensureExif = lazyDemo('exif-panel', () => import('./demo-exif.js'));
document.getElementById('exif-sample')?.addEventListener('click', () => {
    ensureExif().then((api) => api.loadSample());
});

/* ---------- Feature steps: crossfade the sticky phone ---------- */

const phone = document.getElementById('features-phone');
if (phone) {
    const shots = phone.querySelectorAll('img');
    const steps = document.querySelectorAll('.feature-step');
    const stepIO = new IntersectionObserver((entries) => {
        for (const e of entries) {
            if (!e.isIntersecting) continue;
            const n = +e.target.dataset.step;
            shots.forEach((img) => img.classList.toggle('is-active', +img.dataset.shot === n));
            if (!reducedMotion) phone.style.transform = `rotate(${n % 2 ? -2 : 2}deg)`;
        }
    }, { rootMargin: '-45% 0px -45% 0px' });
    steps.forEach((s) => stepIO.observe(s));
}

/* ---------- Marquee: pause the CSS loop while off-screen ---------- */

document.querySelectorAll('.marquee').forEach((m) => {
    new IntersectionObserver(([e]) => {
        m.classList.toggle('is-offscreen', !e.isIntersecting);
    }).observe(m);
});

/* ---------- Hero ---------- */

const hero = document.getElementById('hero');
const heroContent = hero?.querySelector('.hero-content');

async function bootHero() {
    const isMobile = window.matchMedia('(max-width: 767px)').matches;
    const visual = document.getElementById('hero-visual');

    const glPromise = (!reducedMotion && hero)
        ? import('./hero-particles.js')
            .then((m) => m.initHero({
                canvas: document.getElementById('hero-canvas'),
                hero,
                visual,
                imgURL: new URL('../images/hero-source.webp', import.meta.url).href,
                maxParticles: isMobile ? 12000 : 34000,
                dprCap: isMobile ? 1.5 : 2,
            }))
            .catch(() => null)
        : Promise.resolve(null);

    if (!hasGsap || reducedMotion) {
        glPromise.then((api) => {
            if (!api) return;
            api.state.assemble = 1; // no GSAP to animate it; show the photo formed
            hero.classList.add('gl-on');
        });
        return;
    }

    const { gsap } = window;

    // Settled hand-off: GL points are soft discs and never pixel-crisp, so
    // once the particles collapse, the real <img> takes over the rest state
    // (CSS .is-settled crossfades img in / canvas out). Any motion — swap
    // tick or scroll dissolve — hands back to the particles first.
    const settle = () => hero.classList.add('is-settled');
    const unsettle = () => hero.classList.remove('is-settled');

    function armGL(api) {
        // idle re-encode cycle
        const chipFrom = document.getElementById('hero-chip-from');
        const chipTo = document.getElementById('hero-chip-to');
        const fallback = document.getElementById('hero-fallback');
        // real sizes: measured at the app's default quality 90 on a 12MP photo
        // (sips/cwebp), scaled to a 24MP shot; sources cover all six image
        // formats of the app's seven (PDF is output-only);
        // keep = output/source ratio clamped to [0.5, 1]
        const cycle = [
            { from: 'PNG · 18 MB', to: 'WebP · 1.5 MB', keep: 0.5 },
            { from: 'HEIC · 1.8 MB', to: 'JPEG · 3.7 MB', keep: 1 },
            { from: 'TIFF · 72 MB', to: 'HEIC · 2.0 MB', keep: 0.5 },
            { from: 'WebP · 1.5 MB', to: 'JPEG · 3.7 MB', keep: 1 },
            { from: 'JPEG · 3.7 MB', to: 'AVIF · 1.9 MB', keep: 0.5 },
            { from: 'HEIC · 1.8 MB', to: 'PNG · 18 MB', keep: 1 },
            { from: 'AVIF · 1.9 MB', to: 'JPEG · 3.7 MB', keep: 1 },
            { from: 'JPEG · 3.7 MB', to: 'PDF · 2.9 MB', keep: 0.8 },
            { from: 'JPEG · 3.7 MB', to: 'HEIC · 2.3 MB', keep: 0.6 },
        ];
        let i = 0, heroInView = true;
        new IntersectionObserver(([e]) => { heroInView = e.isIntersecting; }).observe(hero);
        // warm the six hero photos after boot so each swap is a cache hit and
        // never competes with the LCP fetch; only photos that actually load
        // enter the rotation, so a missing file can never show a broken image
        const heroURL = (n) => new URL(`../images/hero/0${n}.webp`, import.meta.url).href;
        const available = [];
        setTimeout(() => {
            for (let n = 1; n <= 6; n++) {
                const im = new Image();
                im.onload = () => available.push(n);
                im.src = heroURL(n);
            }
        }, 2500);
        // photo picker: shuffle-bag (each available photo shown once per pass)
        // with a no-last-3 window, so swaps look random but never starve or clump
        const recent = [];
        let bag = [];
        function nextPhoto() {
            if (!available.length) return 0;
            if (!bag.length) {
                bag = available.slice();
                for (let k = bag.length - 1; k > 0; k--) {         // Fisher–Yates
                    const j = (Math.random() * (k + 1)) | 0;
                    [bag[k], bag[j]] = [bag[j], bag[k]];
                }
            }
            for (let k = 0; k < bag.length && recent.includes(bag[0]); k++) bag.push(bag.shift());
            const n = bag.shift();
            recent.push(n);
            if (recent.length > 3) recent.shift();
            return n;
        }
        setInterval(() => {
            if (document.hidden || !heroInView || api.state.dissolve > 0.05 || api.state.assemble < 1) return;
            i = (i + 1) % cycle.length;
            const step = cycle[i];
            // half-scatter to dust, repaint the particles at the trough, then
            // let the new photo develop back — the chip flips under the dust.
            // range 0.5 halves the flight distance for the swap only (boot
            // keeps the full-viewport gather); both .set()s land while the
            // photo is at rest, so they're invisible.
            gsap.timeline()
                .set(api.state, { range: 0.5 }, 0)
                .add(unsettle, 0)
                .to(api.state, { pulse: 1, duration: 0.6, ease: 'power2.out' }, 0)
                .to(api.state, { assemble: 0.35, duration: 1.8, ease: 'power2.inOut' }, 0)
                .to([chipFrom, chipTo], { opacity: 0, duration: 0.25, ease: 'power1.out' }, 1.5)
                .add(() => {
                    const n = nextPhoto();
                    chipFrom.textContent = step.from.replace(' MB', ' ' + t('unit_mb', 'MB'));
                    chipTo.textContent = step.to.replace(' MB', ' ' + t('unit_mb', 'MB'));
                    if (n) {
                        const photo = heroURL(n);
                        api.swap(photo).catch(() => {});
                        fallback.src = photo; // hidden right now; crisp copy for the settle
                    }
                }, 1.8)
                .to([chipFrom, chipTo], { opacity: 1, duration: 0.35, ease: 'power1.in' }, 1.85)
                .to(api.state, { assemble: 1, duration: 3.6, ease: 'power3.out' }, 2.0)
                .to(api.state, { pulse: 0, duration: 1.8, ease: 'power2.inOut' }, 1.8)
                .to(api.state, { keep: step.keep, duration: 2.0, ease: 'power2.inOut' }, 1.8)
                // settle at the same gather phase as boot (assemble ≈ 0.76, ~45% of
                // particles still flying): the focus-pull overlaps live motion, so the
                // swap resolves like the boot gather instead of parking on the mosaic
                .add(settle, 3.0)
                .set(api.state, { range: 1 }, 5.8);
        }, 9000);

        // scroll dissolve (desktop only): the photo becomes the format chips
        if (!isMobile) {
            const dtl = gsap.timeline({
                scrollTrigger: {
                    trigger: hero, start: 'top top', end: 'bottom top', pin: true, pinSpacing: false, scrub: 0.8,
                    // the crisp settled img would sit on top of the dissolve —
                    // hand back to the particles whenever the pin is entered
                    onEnter: unsettle,
                    onEnterBack: unsettle,
                    // A fast flick back to the top outruns the 0.8s scrub
                    // catch-up and parks the hero half-faded; force the
                    // catch-up tween to finish the moment we cross back above.
                    // Deferred one tick: inside the callback the scrub tween
                    // still targets the pre-jump scroll state.
                    onLeaveBack: (self) => {
                        settle();
                        gsap.delayedCall(0, () => { const t = self.getTween(); if (t) t.progress(1); });
                    },
                },
            })
                .to(api.state, { dissolve: 1, ease: 'none', duration: 1 }, 0)
                .to(heroContent, { opacity: 0, ease: 'none', duration: 0.3 }, 0);
            // rAF (and with it the scrub catch-up) freezes while the tab is
            // hidden; on return, land the timeline exactly where the scroll
            // position says it should be instead of resuming a stale lerp.
            document.addEventListener('visibilitychange', () => {
                if (document.hidden || !dtl.scrollTrigger) return;
                const t = dtl.scrollTrigger.getTween();
                if (t) t.progress(1);
            });
            // pin created after the other triggers; re-measure them all
            window.ScrollTrigger.refresh();
        }
    }

    // content reveals must NOT wait on WebGL: give GL a short head start, then go
    let glApi = await Promise.race([
        glPromise,
        new Promise((res) => setTimeout(() => res('late'), 600)),
    ]);
    // SplitText measures line boxes: wait for the webfont so masks don't mis-break
    try { await document.fonts.ready; } catch (e) {}
    const cameLate = glApi === 'late';
    if (cameLate) glApi = null;

    const kids = [...heroContent.children];
    const chip = document.getElementById('hero-chip');
    const title = hero.querySelector('.hero-title');
    const rest = kids.filter((k) => k !== visual && k !== chip && k !== title);

    const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
    gsap.set(visual, { opacity: 1 });
    if (glApi) {
        hero.classList.add('gl-on');
        tl.to(glApi.state, { assemble: 1, duration: 2.2, ease: 'none' }, 0);
        // overlap the gather's tail: the crisp <img> pulls into focus (CSS) as the
        // last particles land, so it reads as one resolve, not soft-then-sharp
        tl.add(settle, 1.7);
    }
    let split = null;
    try { split = new window.SplitText(title, { type: 'lines', mask: 'lines' }); } catch (e) {}
    gsap.set(title, { opacity: 1 });
    if (split) {
        tl.from(split.lines, { yPercent: 110, duration: 0.9, stagger: 0.09, ease: 'power3.out' }, glApi ? 1.1 : 0.2);
    }
    tl.to(chip, { opacity: 1, y: 0, duration: 0.7 }, glApi ? 1.4 : 0.4);
    tl.to(rest, { opacity: 1, y: 0, duration: 0.8, stagger: 0.08 }, glApi ? 1.5 : 0.5);
    // The entrance is time-based and rAF-driven: in a hidden tab it never
    // advances, leaving the hero blank until seconds after the tab returns.
    // A hidden tab needs no entrance — land it finished.
    // tl.progress(1) suppresses nested callbacks, so re-apply the settle here
    const finishRevealIfHidden = () => {
        if (!document.hidden) return;
        tl.progress(1);
        if (hero.classList.contains('gl-on')) settle();
    };
    finishRevealIfHidden();
    document.addEventListener('visibilitychange', finishRevealIfHidden);

    if (glApi) {
        armGL(glApi);
    } else if (cameLate) {
        // GL arrived after the content: develop the photo in place, no replay of text
        glPromise.then((api) => {
            if (!api) return;
            hero.classList.add('gl-on');
            gsap.to(api.state, { assemble: 1, duration: 2.2, ease: 'none' });
            gsap.delayedCall(1.7, settle); // overlap the gather's tail, as in the main boot
            armGL(api);
        });
    }
}
bootHero();

/* ---------- GSAP scroll scenes ---------- */

if (hasGsap && !reducedMotion) {
    const { gsap, ScrollTrigger } = window;
    gsap.registerPlugin(ScrollTrigger);
    if (window.SplitText) gsap.registerPlugin(window.SplitText);

    // generic reveals — IntersectionObserver, not ScrollTrigger.batch: IO stays
    // correct on deep links, reload scroll-restoration, and keyboard jumps
    {
        let pending = [];
        let flush = 0;
        const onReveal = (entries, obs) => {
            for (const e of entries) {
                if (!e.isIntersecting) continue;
                obs.unobserve(e.target);
                pending.push(e.target);
            }
            if (pending.length && !flush) {
                flush = setTimeout(() => {
                    gsap.to(pending, { opacity: 1, y: 0, duration: 0.8, stagger: 0.08, ease: 'expo.out', overwrite: true });
                    pending = [];
                    flush = 0;
                }, 40);
            }
        };
        const io = new IntersectionObserver(onReveal, { rootMargin: '0px 0px -10% 0px' });
        // the chips ride up over the dissolving hero, which owns the eye — at the
        // generic -10% line their stagger finishes at the screen's bottom edge
        // before anyone looks; fire them at the 75% line so they form in clear view
        const chipIO = new IntersectionObserver(onReveal, { rootMargin: '0px 0px -25% 0px' });
        document.querySelectorAll('[data-reveal]').forEach((el) => {
            (el.matches('.format-chips .chip') ? chipIO : io).observe(el);
        });
    }

    // masked line reveals for the two manifesto headlines (post-font, so
    // SplitText measures final line boxes)
    document.fonts.ready.then(() => {
        document.querySelectorAll('.split-lines:not(.hero-title)').forEach((el) => {
            let lines = null;
            try { lines = new window.SplitText(el, { type: 'lines', mask: 'lines' }).lines; } catch (e) {}
            gsap.set(el, { visibility: 'visible' });
            if (!lines) return;
            gsap.from(lines, {
                yPercent: 110, duration: 0.9, stagger: 0.09, ease: 'power3.out',
                scrollTrigger: { trigger: el, start: 'top 78%', once: true },
            });
        });
    });

    // privacy metadata tags: gentle drift (the page's single parallax allowance)
    gsap.fromTo('.meta-tags', { y: 34 }, {
        y: -14, ease: 'none',
        scrollTrigger: { trigger: '.privacy-manifesto', start: 'top bottom', end: 'bottom top', scrub: 0.8 },
    });

    // manifesto rule line draws in
    gsap.fromTo('.rule-line', { scaleX: 0 }, {
        scaleX: 1, ease: 'none',
        scrollTrigger: { trigger: '.rule-line', start: 'top 85%', end: 'top 45%', scrub: 0.8 },
    });

    // panels rise in
    ['.pro-panel', '.inspector'].forEach((sel) => {
        gsap.from(sel, {
            opacity: 0, y: 32, duration: 0.9, ease: 'expo.out',
            scrollTrigger: { trigger: sel, start: 'top 85%', once: true },
        });
    });
} else if (hasGsap && reducedMotion) {
    // content is already visible via CSS overrides; nothing to animate
    document.querySelectorAll('.split-lines').forEach((el) => { el.style.visibility = 'visible'; });
}
