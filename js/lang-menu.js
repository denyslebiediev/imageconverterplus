/* Footer language switcher: outside-click + Esc close, remember the explicit choice,
   and pin the browser's own language above the list so a mis-click is one click to undo.
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

    /* ---- Pinned browser-language row ---- */

    /* Same mapping as the head redirect IIFE, plus the zh regions it misses.
       ponytail: 9 pairs duplicated rather than shared — a module would cost a request. */
    var ALIASES = {
        'zh': 'zh-Hans', 'zh-cn': 'zh-Hans', 'zh-sg': 'zh-Hans',
        'zh-tw': 'zh-Hant', 'zh-hk': 'zh-Hant', 'zh-mo': 'zh-Hant',
        'pt': 'pt-BR', 'no': 'nb', 'tl': 'fil'
    };

    var panel = menu.querySelector('.lang-panel');
    var list = menu.querySelector('.lang-list');
    if (!panel || !list) return;

    /* the rendered list is the only locale registry we need */
    var byCode = Object.create(null);
    var links = list.querySelectorAll('a[hreflang]');
    for (var i = 0; i < links.length; i++) {
        byCode[links[i].getAttribute('hreflang').toLowerCase()] = links[i];
    }
    function lookup(tag) {
        return byCode[tag] || byCode[(ALIASES[tag] || '').toLowerCase()] || null;
    }

    var wanted = navigator.languages || [navigator.language || ''];
    var hit = null;
    for (var j = 0; j < wanted.length && !hit; j++) {
        var tag = String(wanted[j]).toLowerCase();
        hit = lookup(tag) || lookup(tag.split('-')[0]);
    }
    /* nothing we ship, or they are already reading it */
    if (!hit || hit.hasAttribute('aria-current')) return;

    /* clone: the anchor already carries the right relative href for this page's depth */
    var li = document.createElement('li');
    li.appendChild(hit.cloneNode(true));
    var pinned = document.createElement('ul');
    pinned.className = 'lang-list lang-pinned';
    pinned.setAttribute('role', 'list');
    pinned.setAttribute('translate', 'no');
    pinned.appendChild(li);
    panel.insertBefore(pinned, list);
    panel.classList.add('has-pinned');
})();
