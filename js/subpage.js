/* Shared enhancement for the long-form subpages: scroll reveals + FAQ accordion.
   The html.js gate is set inline in each page head; if this file never runs,
   the inline 2.5s fallback removes the gate so content can't get stuck hidden. */

window.__icpSubBooted = true;

const reveals = [...document.querySelectorAll('[data-reveal]')];
if ('IntersectionObserver' in window) {
    // instant jumps (End key, find-in-page, anchors) skip IO events for the
    // bypassed cards — whenever anything fires, also catch up everything
    // that now sits at or above the viewport
    const catchUp = () => reveals.forEach((el) => {
        if (!el.classList.contains('is-in') && el.getBoundingClientRect().top < window.innerHeight) {
            el.classList.add('is-in');
        }
    });
    const io = new IntersectionObserver((entries) => {
        for (const e of entries) {
            if (!e.isIntersecting) continue;
            e.target.classList.add('is-in');
            io.unobserve(e.target);
        }
        catchUp();
    }, { rootMargin: '0px 0px -10% 0px' });
    reveals.forEach((el) => io.observe(el));
} else {
    reveals.forEach((el) => el.classList.add('is-in'));
}

// FAQ accordion (support page; no-op elsewhere) — one open per category
document.querySelectorAll('.faq-question').forEach((btn) => {
    btn.addEventListener('click', () => {
        const item = btn.closest('.faq-item');
        const isOpen = item.classList.contains('open');
        item.closest('.faq-category').querySelectorAll('.faq-item.open').forEach((openItem) => {
            openItem.classList.remove('open');
            openItem.querySelector('.faq-question').setAttribute('aria-expanded', 'false');
        });
        if (!isOpen) {
            item.classList.add('open');
            btn.setAttribute('aria-expanded', 'true');
        }
    });
});
