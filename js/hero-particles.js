/* Hero particle effect: the source photo rendered as GL_POINTS that assemble
   on load, shudder on "re-encode" pulses, and dissolve on scroll.
   Hand-rolled WebGL1 — one fixed effect doesn't justify a 3D library. */

const VERT = `
attribute vec2 aUV;
attribute vec3 aColor;
attribute vec4 aRand;
uniform vec2 uRes;
uniform vec4 uArea;      // photo rect in device px: x, y, w, h (y down)
uniform float uAssemble; // 0 scattered -> 1 photo
uniform float uDissolve; // 0 photo -> 1 gone
uniform float uPulse;    // re-encode shudder amount
uniform float uKeep;     // fraction of particles kept (smaller file = fewer)
uniform float uTime;
uniform float uSize;     // base point size in device px
uniform float uRange;    // scatter-radius scale: 1 at boot, smaller for swaps
uniform float uRadius;   // photo corner radius in device px (matches the img)
varying vec3 vColor;
varying float vAlpha;

float easeOut(float t) { return 1.0 - pow(1.0 - t, 3.0); }

void main() {
    vec2 rest = uArea.xy + aUV * uArea.zw;
    vec2 center = uArea.xy + uArea.zw * 0.5;

    // scattered spherical cloud (projected)
    float ang = aRand.x * 6.28318;
    float rad = (0.45 + aRand.y * 0.9) * max(uRes.x, uRes.y) * 0.6 * uRange;
    vec2 scattered = center + vec2(cos(ang), sin(ang) * 0.8) * rad;

    // assemble with per-particle delay: "the image develops"
    float t = clamp((uAssemble - aRand.w * 0.55) / 0.45, 0.0, 1.0);
    vec2 pos = mix(scattered, rest, easeOut(t));

    // idle shimmer + re-encode shudder
    vec2 wob = vec2(sin(uTime * 1.3 + aRand.x * 40.0), cos(uTime * 1.1 + aRand.y * 40.0));
    pos += wob * (0.6 + uPulse * (8.0 + 14.0 * aRand.z));

    // scroll dissolve: stream down through the bottom edge, spread evenly
    // across the width — aRand.x, NOT aRand.z: the keep-cull keys on aRand.z,
    // and sharing it emptied the right side whenever uKeep < 1
    vec2 sink = vec2(aRand.x * uRes.x, uRes.y * (1.02 + aRand.y * 0.1));
    float d = easeOut(clamp(uDissolve - aRand.w * 0.15, 0.0, 1.0));
    pos = mix(pos, sink, d);
    // mid-dissolve turbulence
    pos += wob * sin(3.14159 * d) * 26.0 * aRand.z;

    vec2 clip = (pos / uRes * 2.0 - 1.0) * vec2(1.0, -1.0);
    gl_Position = vec4(clip, 0.0, 1.0);

    float size = uSize * (0.75 + 0.5 * aRand.w);
    gl_PointSize = size * (1.0 - 0.55 * d);

    vColor = aColor;
    float keep = step(aRand.z, uKeep);
    float appear = clamp(t * 2.0, 0.0, 1.0);
    // corner mask: particles whose rest cell lies outside the image's rounded
    // rect are never part of the photo, so the gather lands on the same
    // rounded shape the settled <img> shows (no corner blink at hand-off)
    vec2 q = abs(aUV * uArea.zw - uArea.zw * 0.5) - (uArea.zw * 0.5 - vec2(uRadius));
    float inShape = smoothstep(1.0, -1.0, length(max(q, vec2(0.0))) - uRadius);
    // fade toward the hero's bottom border so the stream vanishes into the
    // incoming section instead of piling up on it
    float edgeFade = 1.0 - smoothstep(0.8, 0.99, pos.y / uRes.y);
    vAlpha = appear * keep * (1.0 - d * d) * inShape * edgeFade;
}`;

const FRAG = `
precision mediump float;
varying vec3 vColor;
varying float vAlpha;
uniform vec3 uTint;
void main() {
    float dist = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.18, dist) * vAlpha;
    if (a < 0.003) discard;
    vec3 c = mix(vColor, uTint, 0.15);
    gl_FragColor = vec4(c, a);
}`;

function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(s));
    }
    return s;
}

export async function initHero({ canvas, hero, visual, imgURL, maxParticles, dprCap }) {
    if (new URLSearchParams(location.search).has('nowebgl')) return null;
    let gl;
    try {
        gl = canvas.getContext('webgl', { alpha: true, antialias: false, powerPreference: 'low-power' });
    } catch (e) { gl = null; }
    if (!gl) return null;

    // load event, NOT decode(): decode() defers indefinitely in hidden tabs
    const img = new Image();
    img.src = imgURL;
    try {
        await new Promise((res, rej) => {
            if (img.complete && img.naturalWidth) return res();
            img.onload = res;
            img.onerror = rej;
        });
    } catch (e) { return null; }

    // sample the photo into a particle grid
    const aspect = img.naturalWidth / img.naturalHeight;
    let gridW = Math.round(Math.sqrt(maxParticles * aspect));
    let gridH = Math.round(gridW / aspect);
    const off = document.createElement('canvas');
    off.width = gridW; off.height = gridH;
    const ctx = off.getContext('2d', { willReadFrequently: true });
    const count = gridW * gridH;

    // aColor is the photo itself; every swappable source is normalized to the
    // same 512×682 aspect, so the grid (and every other buffer) never changes
    function sampleColors(image) {
        ctx.drawImage(image, 0, 0, gridW, gridH);
        const px = ctx.getImageData(0, 0, gridW, gridH).data;
        const out = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            out[i * 3] = px[i * 4] / 255;
            out[i * 3 + 1] = px[i * 4 + 1] / 255;
            out[i * 3 + 2] = px[i * 4 + 2] / 255;
        }
        return out;
    }

    const uv = new Float32Array(count * 2);
    const rand = new Float32Array(count * 4);
    for (let y = 0, i = 0; y < gridH; y++) {
        for (let x = 0; x < gridW; x++, i++) {
            uv[i * 2] = (x + 0.5) / gridW;
            uv[i * 2 + 1] = (y + 0.5) / gridH;
            rand[i * 4] = Math.random();
            rand[i * 4 + 1] = Math.random();
            rand[i * 4 + 2] = Math.random();
            rand[i * 4 + 3] = Math.random();
        }
    }
    const color = sampleColors(img);

    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);

    function attrib(name, arr, size) {
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(prog, name);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
        return buf;
    }
    attrib('aUV', uv, 2);
    const colorBuf = attrib('aColor', color, 3);
    attrib('aRand', rand, 4);

    // repaint the particles with a new same-aspect photo (used by the idle
    // re-encode cycle); only the color buffer changes
    async function swap(url) {
        const next = new Image();
        next.src = url;
        try {
            await new Promise((res, rej) => {
                if (next.complete && next.naturalWidth) return res();
                next.onload = res;
                next.onerror = rej;
            });
        } catch (e) { return false; }
        if (gl.isContextLost()) return false;
        gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf);
        gl.bufferData(gl.ARRAY_BUFFER, sampleColors(next), gl.STATIC_DRAW);
        return true;
    }

    const U = {};
    for (const n of ['uRes', 'uArea', 'uAssemble', 'uDissolve', 'uPulse', 'uKeep', 'uTime', 'uSize', 'uTint', 'uRange', 'uRadius']) {
        U[n] = gl.getUniformLocation(prog, n);
    }
    gl.uniform3f(U.uTint, 0.243, 0.427, 0.961); // --accent-a
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);

    const state = { assemble: 0, dissolve: 0, pulse: 0, keep: 1, range: 1 };
    let dpr = 1;

    function resize() {
        dpr = Math.min(window.devicePixelRatio || 1, dprCap);
        const w = hero.clientWidth, h = hero.clientHeight;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform2f(U.uRes, canvas.width, canvas.height);
        const vr = visual.getBoundingClientRect();
        const hr = hero.getBoundingClientRect();
        gl.uniform4f(U.uArea,
            (vr.left - hr.left) * dpr, (vr.top - hr.top) * dpr,
            vr.width * dpr, vr.height * dpr);
        gl.uniform1f(U.uSize, (vr.width * dpr / gridW) * 1.9);
        gl.uniform1f(U.uRadius, 18 * dpr); // .hero-fallback border-radius

    }
    resize();
    window.addEventListener('resize', resize);

    let running = true, visible = true, raf = 0;
    function frame(ms) {
        raf = 0;
        if (!running || !visible) return;
        gl.uniform1f(U.uAssemble, state.assemble);
        gl.uniform1f(U.uDissolve, state.dissolve);
        gl.uniform1f(U.uPulse, state.pulse);
        gl.uniform1f(U.uKeep, state.keep);
        gl.uniform1f(U.uRange, state.range);
        gl.uniform1f(U.uTime, ms / 1000);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.POINTS, 0, count);
        raf = requestAnimationFrame(frame);
    }
    function kick() { if (!raf && running && visible) raf = requestAnimationFrame(frame); }

    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; kick(); });
    io.observe(hero);
    document.addEventListener('visibilitychange', () => {
        running = !document.hidden;
        kick();
    });
    canvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        running = false;
        hero.classList.remove('gl-on'); // static photo fades back in
    });
    kick();

    return { state, resize, swap };
}
