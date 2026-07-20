/* Footer language switcher: outside-click + Esc close, remember the explicit choice.
   Markup is <details>/<summary>; links work fine without this file. */
(function () {
    'use strict';
    var menu = document.querySelector('.lang-menu');
    if (!menu) return;
    var summary = menu.querySelector('summary');

    document.addEventListener('click', function (e) {
        if (menu.open && !menu.contains(e.target)) menu.open = false;
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && menu.open) {
            menu.open = false;
            summary.focus();
        }
    });
    menu.addEventListener('click', function (e) {
        var a = e.target && e.target.closest ? e.target.closest('a[hreflang]') : null;
        if (!a) return;
        try { localStorage.setItem('icp-lang', a.getAttribute('hreflang')); } catch (err) {}
    });
})();
