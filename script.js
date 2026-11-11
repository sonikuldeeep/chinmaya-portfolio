/* =========================================================================
   Chinmaya Shrivastava — interactions
   Vanilla JS, no dependencies. Each feature is a self-contained init function.
   ========================================================================= */
(() => {
  'use strict';

  /* Snapshot the untouched page source before any script changes the DOM.
     Admin mode edits a copy of this snapshot and writes it back as index.html. */
  const SOURCE = (() => {
    const html = document.documentElement.cloneNode(true);
    html.classList.remove('js');
    if (!html.getAttribute('class')) html.removeAttribute('class');
    return `<!doctype html>\n${html.outerHTML}\n`;
  })();

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const isEditing = () => document.body.classList.contains('admin-editing');

  /* ---------- Footer year ---------- */
  function initYear() {
    const el = $('#year');
    if (el) el.textContent = String(new Date().getFullYear());
  }

  /* ---------- Navigation: scrolled state, active section, indicator ---------- */
  function initNav() {
    const nav = $('#nav');
    const links = $$('[data-nav]');
    const indicator = $('.nav__indicator');
    if (!nav) return;

    const onScroll = () => nav.classList.toggle('is-scrolled', window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    const moveIndicator = (link) => {
      if (!indicator) return;
      if (!link || !link.offsetParent) { indicator.style.opacity = '0'; return; }
      const menu = indicator.parentElement.getBoundingClientRect();
      const r = link.getBoundingClientRect();
      indicator.style.opacity = '1';
      indicator.style.width = `${r.width - 24}px`;
      indicator.style.transform = `translateX(${r.left - menu.left + 12}px)`;
    };

    const setActive = (id) => {
      let active = null;
      links.forEach((a) => {
        const on = a.getAttribute('href') === `#${id}`;
        a.classList.toggle('is-active', on);
        if (on) { a.setAttribute('aria-current', 'true'); active = a; }
        else a.removeAttribute('aria-current');
      });
      moveIndicator(active);
    };

    // Sections without their own nav item roll up into the nearest one.
    const map = { home: 'home', about: 'about', expertise: 'expertise', journey: 'journey',
      projects: 'projects', insights: 'insights', engagement: 'insights', education: 'insights', contact: 'contact' };
    const sections = Object.keys(map).map((id) => document.getElementById(id)).filter(Boolean);

    const visible = new Map();
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => visible.set(e.target.id, e.isIntersecting ? e.intersectionRect.height : 0));
      let best = null; let max = 0;
      visible.forEach((h, id) => { if (h > max) { max = h; best = id; } });
      if (best) setActive(map[best]);
    }, { rootMargin: '-35% 0px -55% 0px', threshold: [0, 0.01, 0.25, 0.5, 0.75, 1] });
    sections.forEach((s) => io.observe(s));

    window.addEventListener('resize', () => moveIndicator($('[data-nav].is-active')), { passive: true });
    document.fonts && document.fonts.ready.then(() => moveIndicator($('[data-nav].is-active')));
  }

  /* ---------- Mobile menu ---------- */
  function initMobileMenu() {
    const toggle = $('#nav-toggle');
    const menu = $('#mobile-menu');
    if (!toggle || !menu) return;
    let closeTimer;

    const open = () => {
      clearTimeout(closeTimer);
      menu.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('aria-label', 'Close menu');
      document.body.classList.add('menu-open');
      requestAnimationFrame(() => {
        menu.classList.add('is-open');
        // Focus once the menu is visible (hidden elements can't take focus).
        requestAnimationFrame(() => { const first = $('a', menu); first && first.focus({ preventScroll: true }); });
      });
    };
    const close = (returnFocus = true) => {
      menu.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Open menu');
      document.body.classList.remove('menu-open');
      closeTimer = setTimeout(() => { menu.hidden = true; }, reducedMotion.matches ? 0 : 500);
      if (returnFocus) toggle.focus({ preventScroll: true });
    };
    const isOpen = () => toggle.getAttribute('aria-expanded') === 'true';

    toggle.addEventListener('click', () => (isOpen() ? close() : open()));
    menu.addEventListener('click', (e) => { if (e.target.closest('a')) close(false); });

    document.addEventListener('keydown', (e) => {
      if (!isOpen()) return;
      if (e.key === 'Escape') { close(); return; }
      if (e.key === 'Tab') {
        const items = [toggle, ...$$('a', menu)];
        const i = items.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); items[items.length - 1].focus(); }
        else if (!e.shiftKey && i === items.length - 1) { e.preventDefault(); items[0].focus(); }
      }
    });

    window.matchMedia('(min-width: 1181px)').addEventListener('change', (mq) => { if (mq.matches && isOpen()) close(false); });
  }

  /* ---------- Scroll reveals ---------- */
  function initReveals() {
    const items = $$('.reveal');
    items.forEach((el) => {
      const siblings = Array.from(el.parentElement.children).filter((c) => c.classList.contains('reveal'));
      const i = siblings.indexOf(el);
      if (i > 0) el.style.setProperty('--rd', `${Math.min(i, 6) * 80}ms`);
    });

    if (!('IntersectionObserver' in window)) { items.forEach((el) => el.classList.add('is-in')); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.08 });
    items.forEach((el) => io.observe(el));
  }

  /* ---------- Portraits: set data-portrait to an image path; empty keeps the monogram ---------- */
  function loadPortrait(fig) {
    const src = fig.dataset.portrait;
    $$('img[data-runtime]', fig).forEach((img) => img.remove());
    fig.classList.remove('has-image');
    if (!src) return;
    const img = new Image();
    img.decoding = 'async';
    img.alt = fig.dataset.alt || '';
    img.dataset.runtime = '';
    img.onload = () => { fig.prepend(img); fig.classList.add('has-image'); };
    img.src = src;
  }
  function initPortraits() { $$('[data-portrait]').forEach(loadPortrait); }

  /* ---------- Hero ecosystem: particles along network paths ---------- */
  function initEcosystem() {
    const eco = $('#eco');
    const svg = $('.eco__svg', eco || document);
    const layer = $('#eco-particles');
    if (!eco || !svg || !layer) return;

    const io = new IntersectionObserver(([e]) => {
      eco.classList.toggle('is-live', e.isIntersecting || eco.classList.contains('is-live'));
      if (typeof svg.pauseAnimations === 'function') {
        e.isIntersecting ? svg.unpauseAnimations() : svg.pauseAnimations();
      }
    });
    io.observe(eco);

    if (reducedMotion.matches) return;

    const routes = [
      ...['s1', 's2', 's3', 's4', 's5', 's6'].map((id, i) => ({ id, dur: 2.6 + (i % 3) * 0.5, begin: i * 0.45, r: 2.2, reverse: i % 2 === 1 })),
      ...['m1', 'm2', 'm3', 'm4', 'm5', 'm6'].map((id, i) => ({ id, dur: 4.2 + (i % 2) * 0.8, begin: i * 0.7, r: 1.8, reverse: false })),
    ];

    const frag = document.createDocumentFragment();
    routes.forEach((route) => {
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('r', String(route.r));
      c.setAttribute('opacity', '0');

      const motion = document.createElementNS(SVG_NS, 'animateMotion');
      motion.setAttribute('dur', `${route.dur}s`);
      motion.setAttribute('begin', `${route.begin}s`);
      motion.setAttribute('repeatCount', 'indefinite');
      if (route.reverse) { motion.setAttribute('keyPoints', '1;0'); motion.setAttribute('keyTimes', '0;1'); motion.setAttribute('calcMode', 'linear'); }
      const mpath = document.createElementNS(SVG_NS, 'mpath');
      mpath.setAttribute('href', `#${route.id}`);
      mpath.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', `#${route.id}`);
      motion.appendChild(mpath);

      const fade = document.createElementNS(SVG_NS, 'animate');
      fade.setAttribute('attributeName', 'opacity');
      fade.setAttribute('values', '0;1;1;0');
      fade.setAttribute('keyTimes', '0;0.15;0.8;1');
      fade.setAttribute('dur', `${route.dur}s`);
      fade.setAttribute('begin', `${route.begin}s`);
      fade.setAttribute('repeatCount', 'indefinite');

      c.append(motion, fade);
      frag.appendChild(c);
    });
    layer.appendChild(frag);
  }

  /* ---------- Expertise: counter follows the domain in view ---------- */
  function initExpertise() {
    const num = $('#exp-num');
    const domains = $$('.domain');
    if (!num || !domains.length) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        domains.forEach((d) => d.classList.toggle('is-current', d === e.target));
        if (num.textContent !== e.target.dataset.index) {
          num.style.opacity = '0';
          setTimeout(() => { num.textContent = e.target.dataset.index; num.style.opacity = '1'; }, 160);
        }
      });
    }, { rootMargin: '-45% 0px -45% 0px' });
    domains.forEach((d) => io.observe(d));
  }

  /* ---------- Timeline: accordion (delegated, so added roles work too) + scroll progress ---------- */
  function initTimeline() {
    const tl = $('#timeline');
    if (!tl) return;

    const setOpen = (btn, open) => {
      btn.setAttribute('aria-expanded', String(open));
      const item = btn.closest('.tl__item');
      if (item) item.classList.toggle('is-open', open);
    };
    $$('.tl__toggle', tl).forEach((btn) => setOpen(btn, btn.getAttribute('aria-expanded') === 'true'));

    tl.addEventListener('click', (e) => {
      const head = e.target.closest('.tl__head');
      if (!head) return;
      // While editing text, clicks place the caret instead of toggling.
      if (isEditing() && !e.target.closest('.tl__toggle')) return;
      const btn = $('.tl__toggle', head);
      if (btn) setOpen(btn, btn.getAttribute('aria-expanded') !== 'true');
    });

    tl.addEventListener('keydown', (e) => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
      const toggles = $$('.tl__toggle', tl);
      const i = toggles.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? toggles.length - 1
        : (i + (e.key === 'ArrowDown' ? 1 : -1) + toggles.length) % toggles.length;
      toggles[next].focus();
    });

    let ticking = false;
    const update = () => {
      const r = tl.getBoundingClientRect();
      const vh = window.innerHeight;
      const p = Math.min(1, Math.max(0, (vh * 0.6 - r.top) / r.height));
      tl.style.setProperty('--progress', `${(p * 100).toFixed(1)}%`);
      ticking = false;
    };
    window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    update();
  }

  /* ---------- Insights: featured article reader (delegated) ---------- */
  let refreshInsights = () => {};
  function initInsights() {
    const list = $('#reads');
    const feature = $('#feature');
    if (!list || !feature) return;

    const el = {
      cat: $('#feature-cat'), title: $('#feature-title'), excerpt: $('#feature-excerpt'),
      meta: $('#feature-meta'), link: $('#feature-link'), idx: $('#feature-idx'), total: $('#feature-total'),
    };
    const fallbackUrl = 'https://www.linkedin.com/in/chinmaya-shrivastava-iimk-83421528/recent-activity/all/';
    const items = () => $$('.read', list);
    const pad = (n) => String(n).padStart(2, '0');
    const ph = (text) => { const s = document.createElement('span'); s.className = 'ph'; s.textContent = text; return s; };
    const fill = (node, value, placeholder) => { node.replaceChildren(value ? document.createTextNode(value) : ph(placeholder)); };
    let current = 0;

    const show = (i, animate = true) => {
      const all = items();
      if (!all.length) return;
      current = (i + all.length) % all.length;
      const d = all[current].dataset;
      const apply = () => {
        el.cat.textContent = d.cat || '';
        fill(el.title, d.title, 'Article title');
        fill(el.excerpt, d.excerpt, 'A two to three sentence excerpt from the article, quoted or faithfully summarised.');
        fill(el.meta, d.meta, 'Date · X min read');
        el.link.href = d.url || fallbackUrl;
        el.idx.textContent = pad(current + 1);
        el.total.textContent = pad(all.length);
        feature.classList.remove('is-swapping');
        updateDrafts();
      };
      all.forEach((b, j) => { b.classList.toggle('is-active', j === current); b.setAttribute('aria-pressed', String(j === current)); });
      if (!animate || reducedMotion.matches) apply();
      else { feature.classList.add('is-swapping'); setTimeout(apply, 220); }
    };

    list.addEventListener('click', (e) => {
      const b = e.target.closest('.read');
      if (b) show(items().indexOf(b));
    });
    list.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const all = items();
      const i = all.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length].focus();
    });
    $('#feature-prev').addEventListener('click', () => show(current - 1));
    $('#feature-next').addEventListener('click', () => show(current + 1));

    refreshInsights = () => show(Math.min(current, items().length - 1), false);
    el.total.textContent = pad(items().length);
    if (items()[0] && items()[0].dataset.title) show(0, false);
  }

  /* ---------- Contact: ambient network canvas ---------- */
  function initContactNet() {
    const canvas = $('#contact-net');
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext('2d');
    let w = 0; let h = 0; let dpr = 1; let points = []; let raf = 0; let running = false;

    const build = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round(Math.min(70, Math.max(24, (w * h) / 22000)));
      points = Array.from({ length: count }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.18, vy: (Math.random() - 0.5) * 0.18,
        r: Math.random() * 1.4 + 0.6,
      }));
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const max = Math.min(170, w / 6);
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        for (let j = i + 1; j < points.length; j++) {
          const q = points[j];
          const dist = Math.hypot(p.x - q.x, p.y - q.y);
          if (dist < max) {
            ctx.strokeStyle = `rgba(52,120,246,${(1 - dist / max) * 0.28})`;
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
          }
        }
      }
      ctx.fillStyle = 'rgba(0,194,224,.75)';
      points.forEach((p) => { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); });
    };

    const step = () => {
      points.forEach((p) => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
      });
      draw();
      if (running) raf = requestAnimationFrame(step);
    };

    const start = () => { if (running || reducedMotion.matches) return; running = true; raf = requestAnimationFrame(step); };
    const stop = () => { running = false; cancelAnimationFrame(raf); };

    build(); draw();
    new IntersectionObserver(([e]) => (e.isIntersecting ? start() : stop())).observe(canvas);

    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { build(); draw(); }, 150);
    }, { passive: true });
  }

  /* ---------- Back to top with progress ring ---------- */
  function initToTop() {
    const btn = $('#to-top');
    const ring = $('#to-top-ring');
    if (!btn) return;
    const len = 2 * Math.PI * 20;
    let ticking = false;
    const update = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? window.scrollY / max : 0;
      btn.classList.toggle('is-visible', window.scrollY > window.innerHeight * 0.8);
      if (ring) ring.style.strokeDashoffset = String(len * (1 - p));
      ticking = false;
    };
    window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    btn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
      const brand = $('.brand');
      brand && brand.focus({ preventScroll: true });
    });
    update();
  }

  /* ---------- Draft helper: count and highlight editable placeholders ---------- */
  const draftBtn = $('#draft');
  function updateDrafts() {
    if (!draftBtn) return;
    const n = $$('main .ph').length;
    draftBtn.hidden = n === 0;
    draftBtn.innerHTML = `<span class="draft__long">Draft · </span>${n}<span class="draft__long"> field${n === 1 ? '' : 's'} to complete</span>`;
    draftBtn.setAttribute('aria-label', `${n} editable placeholders on this page. Toggle highlighting.`);
  }
  function initDrafts() {
    if (!draftBtn) return;
    updateDrafts();
    draftBtn.addEventListener('click', () => {
      const on = document.body.classList.toggle('show-drafts');
      draftBtn.setAttribute('aria-pressed', String(on));
    });
  }

  /* ---------- Admin loader: the editor is only downloaded when requested ---------- */
  function initAdminLoader() {
    let loading = false;
    const load = () => {
      if (loading) { if (window.SiteAdmin) window.SiteAdmin.open(); return; }
      loading = true;
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = 'admin/admin.css'; css.dataset.admin = '';
      const js = document.createElement('script');
      js.src = 'admin/admin.js'; js.dataset.admin = '';
      js.onerror = () => { loading = false; console.warn('Admin editor could not be loaded (admin/admin.js missing).'); };
      document.head.append(css, js);
    };
    const link = $('#admin-link');
    if (link) link.addEventListener('click', (e) => { e.preventDefault(); load(); });
    let resume = false;
    try { resume = sessionStorage.getItem('cs-admin-session') !== null; } catch (_) { /* storage blocked */ }
    if (location.hash === '#admin' || resume) load();
    window.addEventListener('hashchange', () => { if (location.hash === '#admin') load(); });
  }

  /* ---------- Hooks used by the admin editor ---------- */
  window.Site = {
    source: () => SOURCE,
    loadPortrait,
    refresh() { refreshInsights(); updateDrafts(); },
  };

  /* ---------- Boot ---------- */
  function init() {
    initYear();
    initNav();
    initMobileMenu();
    initReveals();
    initPortraits();
    initEcosystem();
    initExpertise();
    initTimeline();
    initInsights();
    initContactNet();
    initToTop();
    initDrafts();
    initAdminLoader();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
