/* Headless render sweep. Serves nothing itself — point it at a running static
   server. Usage: node verify_render.mjs <baseURL> <spec.json>
   spec.json = [{ "path": "/index.html", "lang": "en", "i18n": false }, ...]
   Checks per page: module boots, <html lang> matches, i18n injection presence
   matches expectation, no uncaught errors, no same-origin 4xx/5xx. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const [, , baseURL, specPath] = process.argv;
if (!baseURL || !specPath) {
    console.error('usage: verify_render.mjs <baseURL> <spec.json>');
    process.exit(2);
}
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const origin = new URL(baseURL).origin;

const browser = await chromium.launch();
let failures = 0;

for (const page of spec) {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    const errors = [];
    const badResponses = [];
    p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    p.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
    p.on('response', (r) => {
        const u = r.url();
        if (u.startsWith(origin) && r.status() >= 400) badResponses.push(`${r.status()} ${u}`);
    });

    const url = baseURL.replace(/\/$/, '') + page.path;
    let state = {};
    try {
        await p.goto(url, { waitUntil: 'load', timeout: 20000 });
        await p.waitForFunction(
            () => window.__icpBooted === true || window.__icpSubBooted === true,
            { timeout: 10000 });
        // let deferred vendor scripts + reveal settle so late errors surface
        await p.waitForTimeout(1500);
        state = await p.evaluate(() => ({
            booted: !!(window.__icpBooted || window.__icpSubBooted),
            i18n: !!window.__icpI18n,
            lang: document.documentElement.lang,
            dir: document.documentElement.dir,
        }));
        if (process.env.SHOTDIR) {
            const name = (page.lang || page.path.replace(/\W+/g, '_')) + '.png';
            await p.screenshot({ path: process.env.SHOTDIR + '/' + name, fullPage: true });
        }
    } catch (e) {
        errors.push('NAV/BOOT: ' + e.message);
    }

    const problems = [];
    if (!state.booted) problems.push('did not boot');
    if (page.lang && state.lang !== page.lang) problems.push(`lang=${state.lang} expected ${page.lang}`);
    if (page.i18n !== undefined && state.i18n !== page.i18n) problems.push(`i18n injection=${state.i18n} expected ${page.i18n}`);
    if (page.dir && state.dir !== page.dir) problems.push(`dir=${state.dir} expected ${page.dir}`);
    if (errors.length) problems.push(`${errors.length} console/page errors`);
    if (badResponses.length) problems.push(`${badResponses.length} same-origin 4xx/5xx`);

    if (problems.length) {
        failures++;
        console.log(`FAIL ${page.path}: ${problems.join('; ')}`);
        errors.slice(0, 8).forEach((e) => console.log('   err: ' + e.slice(0, 200)));
        badResponses.slice(0, 8).forEach((r) => console.log('   404: ' + r));
    } else {
        console.log(`PASS ${page.path}  (lang=${state.lang} dir=${state.dir || 'ltr'} i18n=${state.i18n})`);
    }
    await ctx.close();
}

await browser.close();
console.log(failures ? `\n${failures} page(s) FAILED` : '\nall pages passed');
process.exit(failures ? 1 : 0);
