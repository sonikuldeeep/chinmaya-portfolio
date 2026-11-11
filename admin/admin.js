/* =========================================================================
   Admin editor: password-gated, in-page content editing.

   How it works
   - script.js snapshots the untouched page source on load (Site.source()).
   - This editor parses that snapshot into a "model" document and pairs every
     live element with its model twin. Edits are applied to both: the live page
     shows them instantly, the model stays free of runtime/animation state.
   - Publish (GitHub connected in Settings): commits index.html and uploaded
     images to the GitHub repository in one commit; GitHub Pages then serves
     the update to every visitor within about a minute.
   - Save (not connected, working locally): writes index.html and images into
     the site folder via the File System Access API (Chrome / Edge), or
     downloads an index.html with images embedded in other browsers.

   Security: the password only gates the editor UI. The real key is the
   GitHub access token, which is stored only in the admin's own browser and
   never in the site. Without it, nobody can change the published site.
   ========================================================================= */
(() => {
  'use strict';
  if (window.SiteAdmin) { window.SiteAdmin.open(); return; }

  const SALT = 'cs-portfolio:';
  const SESSION_KEY = 'cs-admin-session';
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');

  /* ---------------------------------------------------------------------
     What can be edited
     --------------------------------------------------------------------- */
  // Never inline-edit inside these (handled by dedicated tools or not content).
  const SKIP = [
    'svg', 'script', 'style', 'summary', '#feature', '#reads', '.footer__copy', '.footer__admin',
    '.expertise__counter', '.tl__logo', '.tl__toggle', '.frame__img', '.portrait', '.scroll-cue',
    '.case__visual', '.edu__mark', '[data-admin]', '[data-runtime]',
  ].join(',');

  // Repeatable items: duplicate / delete / reorder.
  const ITEMS = [
    { sel: '.tl__item', label: 'Role', current: true },
    { sel: '#reads > li', label: 'Article', article: true },
    { sel: '.work .case', label: 'Project' },
    { sel: '.domains > .domain', label: 'Expertise' },
    { sel: '.engage__strip > .frame', label: 'Event' },
    { sel: '.edu__list > .edu__row', label: 'Qualification' },
    { sel: '.edu__dl > div', label: 'Detail' },
    { sel: '.facts > div', label: 'Fact' },
    { sel: '.hero__meta > div', label: 'Item' },
    { sel: '.about__cols > div', label: 'Paragraph' },
    { sel: '.case__notes > div', label: 'Note' },
    { sel: '.tl__cols li', label: 'Point' },
    { sel: '.tags > li', label: 'Tag' },
  ];

  // Image slots.
  const SLOTS = [
    { sel: 'figure[data-portrait]', kind: 'portrait', folder: 'profile', max: 1400, label: 'portrait' },
    { sel: '.case__visual', kind: 'cover', folder: 'projects', max: 1800, label: 'project image' },
    { sel: '.frame__img', kind: 'frame', folder: 'events', max: 1800, label: 'event photo' },
    { sel: '.tl__logo', kind: 'logo', folder: 'logos', max: 256, label: 'logo' },
  ];

  /* ---------------------------------------------------------------------
     State
     --------------------------------------------------------------------- */
  let model = null;                 // parsed copy of the page source
  const twin = new WeakMap();       // live element -> model element
  const pending = new Map();        // token -> { blob, folder, name }
  let dirty = false;
  let editing = false;
  let ui = null;
  let plaintextOK = null;

  /* ---------------------------------------------------------------------
     Small utilities
     --------------------------------------------------------------------- */
  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  const storedHash = () => ($('meta[name="admin-key"]')?.getAttribute('content') || '').trim();
  const session = {
    get() { try { return sessionStorage.getItem(SESSION_KEY); } catch (_) { return null; } },
    set(v) { try { sessionStorage.setItem(SESSION_KEY, v); } catch (_) { /* ignore */ } },
    clear() { try { sessionStorage.removeItem(SESSION_KEY); } catch (_) { /* ignore */ } },
  };

  const idb = (() => {
    let p;
    const open = () => (p ||= new Promise((res, rej) => {
      const r = indexedDB.open('cs-admin', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
    const run = async (mode, fn) => {
      const db = await open();
      return new Promise((res, rej) => {
        const req = fn(db.transaction('kv', mode).objectStore('kv'));
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
    };
    return {
      get: (k) => run('readonly', (s) => s.get(k)).catch(() => undefined),
      set: (k, v) => run('readwrite', (s) => s.put(v, k)).catch(() => undefined),
      del: (k) => run('readwrite', (s) => s.delete(k)).catch(() => undefined),
    };
  })();

  /* ---------------------------------------------------------------------
     Model: pair live elements with their twins in the source copy
     --------------------------------------------------------------------- */
  const liveChildren = (el) => Array.from(el.children).filter((c) => !c.hasAttribute('data-runtime') && !c.hasAttribute('data-admin'));
  let mismatches = 0;
  function pairTree(live, mod) {
    twin.set(live, mod);
    if (live.matches('svg, #feature')) return;
    const lc = liveChildren(live);
    const mc = Array.from(mod.children);
    if (lc.length !== mc.length) mismatches++;
    for (let i = 0; i < Math.min(lc.length, mc.length); i++) {
      if (lc[i].tagName === mc[i].tagName) pairTree(lc[i], mc[i]);
      else mismatches++;
    }
  }
  function buildModel() {
    model = new DOMParser().parseFromString(window.Site.source(), 'text/html');
    mismatches = 0;
    ['main', 'footer'].forEach((sel) => { const l = $(sel); const m = $(sel, model); if (l && m) pairTree(l, m); });
    const lm = $('meta[name="admin-key"]'); const mm = $('meta[name="admin-key"]', model);
    if (lm && mm) twin.set(lm, mm);
    if (mismatches) console.warn(`[admin] ${mismatches} structural mismatches between page and source.`);
  }
  // Apply the same change to the live element and its model twin.
  function both(liveEl, fn) {
    fn(liveEl, false);
    const m = twin.get(liveEl);
    if (m) fn(m, true);
  }

  /* ---------------------------------------------------------------------
     Inline text editing
     --------------------------------------------------------------------- */
  const hasOwnText = (el) => Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
  function collectEditables(root) {
    const out = [];
    const visit = (el) => {
      if (el.matches(SKIP)) return;
      if (hasOwnText(el)) { out.push(el); return; }
      Array.from(el.children).forEach(visit);
    };
    if (root && root.parentElement && root.parentElement.closest(SKIP)) return out;
    (root ? [root] : $$('main, footer')).forEach(visit);
    return out;
  }
  // Editing renders source whitespace literally, so trim indentation at the edges.
  function trimEdges(el) {
    const first = el.firstChild; const last = el.lastChild;
    if (first && first.nodeType === 3) first.textContent = first.textContent.replace(/^\s+/, '');
    if (last && last.nodeType === 3) last.textContent = last.textContent.replace(/\s+$/, '');
    Array.from(el.childNodes).forEach((n) => { if (n.nodeType === 3) n.textContent = n.textContent.replace(/\s*\n\s*/g, ' '); });
  }
  const dropEmptyClass = (el) => { if (el.getAttribute('class') === '') el.removeAttribute('class'); };
  function setEditable(el, on) {
    if (on) {
      if (!el.hasAttribute('data-edit')) trimEdges(el);
      if (plaintextOK === null) { el.contentEditable = 'plaintext-only'; plaintextOK = el.contentEditable === 'plaintext-only'; }
      el.contentEditable = plaintextOK ? 'plaintext-only' : 'true';
      el.dataset.edit = '';
      el.spellcheck = true;
    } else {
      el.removeAttribute('contenteditable');
    }
  }
  function prepareEditables(root) {
    collectEditables(root).forEach((el) => setEditable(el, editing));
  }

  // Copy every edited text block from the live page into the model.
  function syncText() {
    $$('[data-edit]').forEach((live) => {
      const m = twin.get(live);
      if (!m || !live.isConnected) return;
      const clone = live.cloneNode(true);
      $$('[data-admin],[data-runtime]', clone).forEach((n) => n.remove());
      $$('[contenteditable],[data-edit]', clone).forEach((n) => { n.removeAttribute('contenteditable'); n.removeAttribute('data-edit'); n.removeAttribute('spellcheck'); });
      $$('[class=""]', clone).forEach(dropEmptyClass);
      m.innerHTML = clone.innerHTML;
      if (!live.classList.contains('ph')) { m.classList.remove('ph'); dropEmptyClass(m); }
    });
  }

  // The featured-article panel in the saved HTML mirrors the first article.
  function syncFeature() {
    const reads = $$('#reads .read', model);
    const set = (id, fn) => { const n = $(`#${id}`, model); if (n) fn(n); };
    const total = pad(reads.length);
    set('feature-total', (n) => { n.textContent = total; });
    set('feature-idx', (n) => { n.textContent = '01'; });
    const d = reads[0] ? reads[0].dataset : {};
    const phHtml = (t) => `<span class="ph">${esc(t)}</span>`;
    set('feature-cat', (n) => { n.textContent = d.cat || ''; });
    set('feature-title', (n) => { n.innerHTML = d.title ? esc(d.title) : phHtml('Article title'); });
    set('feature-excerpt', (n) => { n.innerHTML = d.excerpt ? esc(d.excerpt) : phHtml('A two to three sentence excerpt from the article, quoted or faithfully summarised.'); });
    set('feature-meta', (n) => { n.innerHTML = d.meta ? esc(d.meta) : `${phHtml('Date')} · ${phHtml('X min read')}`; });
    if (d.url) set('feature-link', (n) => n.setAttribute('href', d.url));
  }

  /* ---------------------------------------------------------------------
     Dirty state
     --------------------------------------------------------------------- */
  let refreshTimer;
  function markDirty() {
    dirty = true;
    if (ui) { ui.status.textContent = 'Unsaved changes'; ui.bar.classList.add('is-dirty'); }
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => window.Site.refresh(), 250);
  }
  function markClean(msg = 'All changes saved') {
    dirty = false;
    if (ui) { ui.status.textContent = msg; ui.bar.classList.remove('is-dirty'); }
  }
  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------------------------------------------------------------------
     Dialogs and toasts
     --------------------------------------------------------------------- */
  let dlgSeq = 0;
  function dialog({ title, html, actions, onSubmit, onOpen, wide }) {
    return new Promise((resolve) => {
      const id = `adm-dlg-${++dlgSeq}`;
      const dlg = document.createElement('dialog');
      dlg.className = `adm-dialog${wide ? ' adm-dialog--wide' : ''}`;
      dlg.dataset.admin = '';
      dlg.setAttribute('aria-labelledby', id);
      dlg.innerHTML = `
        <form method="dialog" class="adm-form" novalidate>
          <header class="adm-dialog__head">
            <h2 id="${id}">${esc(title)}</h2>
            <button type="button" class="adm-x" data-close aria-label="Close">&times;</button>
          </header>
          <div class="adm-dialog__body">${html}</div>
          <footer class="adm-dialog__foot">
            ${actions.map((a) => `<button type="submit" value="${a.value}" class="adm-btn${a.primary ? ' adm-btn--primary' : ''}${a.danger ? ' adm-btn--danger' : ''}"${a.left ? ' data-left' : ''}>${esc(a.label)}</button>`).join('')}
          </footer>
        </form>`;
      document.body.appendChild(dlg);
      const form = $('form', dlg);
      $('[data-close]', dlg).addEventListener('click', () => dlg.close(''));
      form.addEventListener('submit', async (e) => {
        const value = e.submitter ? e.submitter.value : 'ok';
        if (value === 'cancel' || !onSubmit) return; // native close
        e.preventDefault();
        const ok = await onSubmit(form, value, dlg);
        if (ok !== false) dlg.close(value);
      });
      dlg.addEventListener('close', () => { resolve({ value: dlg.returnValue, form }); setTimeout(() => dlg.remove(), 0); });
      dlg.showModal();
      if (onOpen) onOpen(form, dlg);
    });
  }
  async function confirmBox(title, text, okLabel = 'Confirm', danger = false) {
    const { value } = await dialog({
      title, html: `<p class="adm-p">${esc(text)}</p>`,
      actions: [{ label: 'Cancel', value: 'cancel' }, { label: okLabel, value: 'ok', primary: !danger, danger }],
    });
    return value === 'ok';
  }
  function toast(msg, type = 'info') {
    if (!ui) return;
    const t = document.createElement('div');
    t.className = `adm-toast adm-toast--${type}`;
    t.textContent = msg;
    ui.toasts.appendChild(t);
    setTimeout(() => t.classList.add('is-out'), 4200);
    setTimeout(() => t.remove(), 4700);
  }
  const fieldError = (form, msg) => { const e = $('.adm-error', form); if (e) { e.textContent = msg; e.hidden = !msg; } };

  /* ---------------------------------------------------------------------
     Login
     --------------------------------------------------------------------- */
  async function login() {
    if (!window.crypto || !crypto.subtle) {
      alert('The admin editor needs a secure context. Open the site as a local file, on localhost, or over https.');
      return false;
    }
    if (!storedHash()) { alert('No admin password is configured (meta name="admin-key" is missing).'); return false; }
    const s = session.get();
    if (s && s === storedHash()) return true;

    const { value } = await dialog({
      title: 'Admin sign in',
      html: `
        <p class="adm-p">Enter the admin password to edit this site.</p>
        <label class="adm-field"><span>Password</span>
          <input type="password" name="pw" autocomplete="current-password" required>
        </label>
        <p class="adm-error" role="alert" hidden></p>`,
      actions: [{ label: 'Cancel', value: 'cancel' }, { label: 'Sign in', value: 'ok', primary: true }],
      onOpen: (form) => form.pw.focus(),
      onSubmit: async (form) => {
        const h = await sha256(SALT + form.pw.value);
        if (h !== storedHash()) { fieldError(form, 'Incorrect password.'); form.pw.select(); return false; }
        session.set(h);
        return true;
      },
    });
    return value === 'ok';
  }

  /* ---------------------------------------------------------------------
     Admin UI
     --------------------------------------------------------------------- */
  const ICON = {
    edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/></svg>',
    eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    save: '<svg viewBox="0 0 24 24"><path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/></svg>',
    out: '<svg viewBox="0 0 24 24"><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/></svg>',
    img: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/></svg>',
    up: '<svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/></svg>',
    link: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/></svg>',
    article: '<svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6z"/><path d="M9 11h7M9 15h7M9 7h3"/></svg>',
  };

  function buildUI() {
    const bar = document.createElement('div');
    bar.className = 'adm-bar';
    bar.dataset.admin = '';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Admin editor');
    bar.innerHTML = `
      <span class="adm-bar__brand"><span class="adm-dot" aria-hidden="true"></span>Admin</span>
      <span class="adm-bar__status" aria-live="polite">All changes saved</span>
      <button type="button" class="adm-tbtn" data-act="mode" aria-pressed="true">${ICON.edit}<span>Editing</span></button>
      <button type="button" class="adm-tbtn adm-tbtn--primary" data-act="save" title="Save (Ctrl+S)">${ICON.save}<span>Save</span></button>
      <button type="button" class="adm-tbtn" data-act="settings" aria-label="Settings">${ICON.gear}<span class="adm-hide-sm">Settings</span></button>
      <button type="button" class="adm-tbtn" data-act="logout" aria-label="Log out">${ICON.out}<span class="adm-hide-sm">Log out</span></button>`;

    const itemBar = document.createElement('div');
    itemBar.className = 'adm-item';
    itemBar.dataset.admin = '';
    itemBar.hidden = true;

    const imgBtn = document.createElement('button');
    imgBtn.type = 'button';
    imgBtn.className = 'adm-imgbtn';
    imgBtn.dataset.admin = '';
    imgBtn.hidden = true;
    imgBtn.innerHTML = `${ICON.img}<span>Change image</span>`;

    const linkBtn = document.createElement('button');
    linkBtn.type = 'button';
    linkBtn.className = 'adm-linkbtn';
    linkBtn.dataset.admin = '';
    linkBtn.hidden = true;
    linkBtn.innerHTML = `${ICON.link}<span>Edit link</span>`;

    const toasts = document.createElement('div');
    toasts.className = 'adm-toasts';
    toasts.dataset.admin = '';
    toasts.setAttribute('aria-live', 'polite');

    document.body.append(bar, itemBar, imgBtn, linkBtn, toasts);
    ui = { bar, itemBar, imgBtn, linkBtn, toasts, status: $('.adm-bar__status', bar), current: { item: null, slot: null, link: null } };

    bar.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      ({ mode: () => setEditing(!editing), save, settings: openSettings, logout })[b.dataset.act]();
    });
    imgBtn.addEventListener('click', () => ui.current.slot && openImageDialog(ui.current.slot));
    linkBtn.addEventListener('click', () => ui.current.link && openLinkDialog(ui.current.link));
    itemBar.addEventListener('click', (e) => {
      const b = e.target.closest('[data-do]');
      if (b && ui.current.item) itemAction(b.dataset.do, ui.current.item);
    });
  }

  /* ---------------------------------------------------------------------
     Edit mode on/off
     --------------------------------------------------------------------- */
  function setEditing(on) {
    editing = on;
    document.body.classList.toggle('admin-editing', on);
    prepareEditables();
    if (!on) $$('[data-edit]').forEach((el) => setEditable(el, false));
    SLOTS.forEach((s) => $$(s.sel).forEach((el) => {
      if (on) { el.setAttribute('tabindex', '0'); el.setAttribute('data-slot', ''); }
      else { el.removeAttribute('tabindex'); el.removeAttribute('data-slot'); }
    }));
    if (on) {
      // Reveal everything that is normally collapsed so it can be edited.
      $$('#timeline .tl__toggle').forEach((b) => { b.setAttribute('aria-expanded', 'true'); b.closest('.tl__item')?.classList.add('is-open'); });
      $$('details.case__more').forEach((d) => { d.open = true; });
    }
    hideFloating();
    if (ui) {
      const b = $('[data-act="mode"]', ui.bar);
      b.setAttribute('aria-pressed', String(on));
      b.innerHTML = on ? `${ICON.edit}<span>Editing</span>` : `${ICON.eye}<span>Preview</span>`;
    }
  }

  /* ---------------------------------------------------------------------
     Floating controls: item toolbar, image button, link button
     --------------------------------------------------------------------- */
  const findItem = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const def = ITEMS.find((d) => n.matches(d.sel));
      if (def) return { el: n, def };
    }
    return null;
  };
  const findSlot = (el) => {
    for (const s of SLOTS) { const n = el.closest(s.sel); if (n && n.closest('main')) return { el: n, def: s }; }
    return null;
  };
  const place = (node, rect, where) => {
    node.hidden = false;
    const w = node.offsetWidth; const h = node.offsetHeight;
    let top; let left;
    if (where === 'item') {
      top = rect.top - h - 4;
      left = rect.right - w;
    } else if (where === 'slot') {
      top = rect.bottom - h - 10; left = rect.left + 10;
      if (rect.height < 70) { top = rect.bottom + 6; left = rect.left; }
    } else { top = rect.top - h - 8; left = rect.left; }
    left = Math.max(8, Math.min(left, document.documentElement.clientWidth - w - 8));
    node.style.top = `${top + window.scrollY}px`;
    node.style.left = `${left + window.scrollX}px`;
  };

  function showItemBar(found) {
    if (!found) { ui.itemBar.hidden = true; ui.current.item = null; return; }
    if (ui.current.item && ui.current.item.el === found.el && !ui.itemBar.hidden) return;
    ui.current.item = found;
    const { def, el } = found;
    const isCurrent = el.classList.contains('tl__item--current');
    ui.itemBar.innerHTML = `
      <span class="adm-item__label">${esc(def.label)}</span>
      ${def.article ? `<button type="button" data-do="article" title="Edit article">${ICON.article}<span>Edit</span></button>` : ''}
      ${def.current ? `<button type="button" data-do="current" aria-pressed="${isCurrent}" title="${isCurrent ? 'Unmark as current role' : 'Mark as current role'}">${ICON.star}<span class="sr-only">Current role</span></button>` : ''}
      <button type="button" data-do="up" title="Move up">${ICON.up}<span class="sr-only">Move up</span></button>
      <button type="button" data-do="down" title="Move down">${ICON.down}<span class="sr-only">Move down</span></button>
      <button type="button" data-do="dup" title="Duplicate">${ICON.copy}<span class="sr-only">Duplicate</span></button>
      <button type="button" data-do="del" class="is-danger" title="Delete">${ICON.trash}<span class="sr-only">Delete</span></button>`;
    place(ui.itemBar, el.getBoundingClientRect(), 'item');
  }
  function showSlot(found) {
    if (!found) { ui.imgBtn.hidden = true; ui.current.slot = null; return; }
    ui.current.slot = found;
    $('span', ui.imgBtn).textContent = hasImage(found) ? `Change ${found.def.label}` : `Add ${found.def.label}`;
    place(ui.imgBtn, found.el.getBoundingClientRect(), 'slot');
  }
  function showLink(editable) {
    const a = editable && (editable.closest('a[href]') || $('a[href]', editable));
    if (!a || a.getAttribute('href').startsWith('#')) { ui.linkBtn.hidden = true; ui.current.link = null; return; }
    ui.current.link = a;
    place(ui.linkBtn, editable.getBoundingClientRect(), 'link');
  }
  function hideFloating() {
    if (!ui) return;
    ui.itemBar.hidden = true; ui.imgBtn.hidden = true; ui.linkBtn.hidden = true;
    ui.current = { item: null, slot: null, link: null };
  }

  let hideTimer;
  function bindEditorEvents() {
    document.addEventListener('mouseover', (e) => {
      if (!editing) return;
      if (e.target.closest('[data-admin]')) { clearTimeout(hideTimer); return; }
      const item = findItem(e.target);
      const slot = findSlot(e.target);
      clearTimeout(hideTimer);
      if (item) showItemBar(item);
      if (slot) showSlot(slot);
      if (!item || !slot) {
        hideTimer = setTimeout(() => {
          if (!item) { ui.itemBar.hidden = true; ui.current.item = null; }
          if (!slot) { ui.imgBtn.hidden = true; ui.current.slot = null; }
        }, 350);
      }
    });

    document.addEventListener('focusin', (e) => {
      if (!editing || e.target.closest('[data-admin]')) return;
      const item = findItem(e.target);
      if (item) { ui.current.item = null; showItemBar(item); }
      const slot = findSlot(e.target);
      if (slot) showSlot(slot);
      const ed = e.target.closest('[data-edit]');
      showLink(ed);
      if (ed && ed.classList.contains('ph')) selectAll(ed);
    });

    // Typing.
    document.addEventListener('input', (e) => {
      const ed = e.target.closest && e.target.closest('[data-edit]');
      if (!ed) return;
      ed.classList.remove('ph');
      const sel = window.getSelection();
      const node = sel && sel.anchorNode;
      const inner = node && (node.nodeType === 1 ? node : node.parentElement)?.closest('.ph');
      if (inner && ed.contains(inner)) { inner.classList.remove('ph'); dropEmptyClass(inner); }
      markDirty();
    });

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && ui) { e.preventDefault(); save(); return; }
      const ed = e.target.closest && e.target.closest('[data-edit]');
      if (ed && editing) {
        if (e.key === 'Enter') e.preventDefault();          // single-line blocks; duplicate items for more
        if (e.key === 'Escape') ed.blur();
      }
      const slot = editing && e.target.matches && e.target.matches('[data-slot]');
      if (slot && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openImageDialog(findSlot(e.target)); }
    });

    // Paste as plain text where plaintext-only isn't supported.
    document.addEventListener('paste', (e) => {
      const ed = e.target.closest && e.target.closest('[data-edit]');
      if (!ed || plaintextOK) return;
      e.preventDefault();
      document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain').replace(/\s*\n\s*/g, ' '));
    });

    // Clicks: no navigation while editing; click placeholders to replace them; click images to change them.
    document.addEventListener('click', (e) => {
      if (!editing || e.target.closest('[data-admin]')) return;
      const a = e.target.closest('a[href]');
      if (a && a.closest('main, footer') && e.target.closest('[data-edit]')) e.preventDefault();
      if (a && a.closest('main, footer') && !a.closest('#feature')) e.preventDefault();
      const ph = e.target.closest('.ph');
      if (ph && ph.closest('[data-edit]')) selectAll(ph);
      if (e.target.closest('#feature') && !e.target.closest('button')) {
        const active = $('#reads .read.is-active');
        if (active) { e.preventDefault(); openArticleDialog(active.closest('li')); }
        return;
      }
      if (!e.target.closest('[data-edit]')) {
        const slot = findSlot(e.target);
        if (slot) { e.preventDefault(); openImageDialog(slot); }
      }
    }, true);

    window.addEventListener('resize', hideFloating, { passive: true });
  }
  function selectAll(node) {
    requestAnimationFrame(() => {
      const r = document.createRange();
      r.selectNodeContents(node);
      const s = window.getSelection();
      s.removeAllRanges(); s.addRange(r);
    });
  }

  /* ---------------------------------------------------------------------
     Item actions: duplicate, delete, move, current, article
     --------------------------------------------------------------------- */
  function siblingsOf(el, def) {
    return Array.from(el.parentElement.children).filter((c) => c.matches(def.sel));
  }
  function renumberReads() {
    const apply = (root) => $$('#reads > li', root).forEach((li, i) => { const n = $('.read__num', li); if (n) n.textContent = pad(i + 1); });
    apply(document); apply(model);
  }
  function uniquifyIds(liveClone, modelClone) {
    const suffix = Math.random().toString(36).slice(2, 7);
    const map = {};
    const lIds = [liveClone, ...$$('[id]', liveClone)].filter((n) => n.id);
    const mIds = [modelClone, ...$$('[id]', modelClone)].filter((n) => n.id);
    lIds.forEach((n, i) => { const nid = `${n.id}-${suffix}`; map[n.id] = nid; n.id = nid; if (mIds[i]) mIds[i].id = nid; });
    const refs = ['aria-controls', 'aria-labelledby', 'aria-describedby', 'for'];
    [liveClone, modelClone].forEach((root) => {
      [root, ...$$('*', root)].forEach((n) => refs.forEach((attr) => {
        const v = n.getAttribute && n.getAttribute(attr);
        if (v) n.setAttribute(attr, v.split(/\s+/).map((x) => map[x] || x).join(' '));
      }));
    });
  }
  function setCurrent(liveItem, on) {
    both(liveItem, (el) => {
      el.classList.toggle('tl__item--current', on);
      const date = $('.tl__date', el);
      const badge = date && $('.tl__badge', date);
      if (on && date && !badge) {
        const b = el.ownerDocument.createElement('span');
        b.className = 'tl__badge'; b.textContent = 'Current';
        date.prepend(b);
      }
      if (!on && badge) badge.remove();
    });
  }

  async function itemAction(action, { el, def }) {
    const mEl = twin.get(el);
    if (!mEl && action !== 'article') { toast('This item can’t be changed (not found in the page source).', 'error'); return; }

    if (action === 'dup') {
      const lc = el.cloneNode(true);
      const mc = mEl.cloneNode(true);
      $$('[data-admin]', lc).forEach((n) => n.remove());
      uniquifyIds(lc, mc);
      el.after(lc); mEl.after(mc);
      pairTree(lc, mc);
      $$('[data-edit]', lc).forEach((n) => setEditable(n, editing));
      prepareEditables(lc);
      if (def.current && lc.classList.contains('tl__item--current')) setCurrent(lc, false);
      if (def.article) { const b = $('.read', lc); if (b) { b.classList.remove('is-active'); b.setAttribute('aria-pressed', 'false'); } renumberReads(); }
      lc.classList.add('is-in');
      markDirty();
      hideFloating();
      lc.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      const first = $('[data-edit]', lc) || (lc.matches('[data-edit]') ? lc : null);
      if (first) first.focus();
      toast(`${def.label} duplicated. Edit the copy, then Save.`);
    }

    if (action === 'del') {
      if (siblingsOf(el, def).length <= 1 && !(await confirmBox(`Delete the last ${def.label.toLowerCase()}?`, 'This is the only one left in this list. You can undo by not saving (reload the page).', 'Delete', true))) return;
      else if (siblingsOf(el, def).length > 1 && !(await confirmBox(`Delete this ${def.label.toLowerCase()}?`, 'It will be removed from the page when you save.', 'Delete', true))) return;
      el.remove(); mEl.remove();
      if (def.article) renumberReads();
      markDirty(); hideFloating();
    }

    if (action === 'up' || action === 'down') {
      const sibs = siblingsOf(el, def);
      const i = sibs.indexOf(el);
      const j = action === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= sibs.length) return;
      const other = sibs[j]; const mOther = twin.get(other);
      if (!mOther) return;
      if (action === 'up') { other.before(el); mOther.before(mEl); } else { other.after(el); mOther.after(mEl); }
      if (def.article) renumberReads();
      markDirty();
      ui.current.item = null;
      showItemBar({ el, def });
    }

    if (action === 'current') {
      setCurrent(el, !el.classList.contains('tl__item--current'));
      markDirty();
      ui.current.item = null; showItemBar({ el, def });
    }

    if (action === 'article') openArticleDialog(el);
  }

  /* ---------------------------------------------------------------------
     Article editor (Insights)
     --------------------------------------------------------------------- */
  async function openArticleDialog(li) {
    const btn = $('.read', li);
    if (!btn) return;
    const d = btn.dataset;
    const { value, form } = await dialog({
      title: 'Edit article',
      wide: true,
      html: `
        <p class="adm-p adm-p--muted">Only add articles that were actually published, with a link to the source.</p>
        <div class="adm-grid">
          <label class="adm-field"><span>Category</span><input name="cat" value="${esc(d.cat)}" placeholder="e.g. Digital Payments"></label>
          <label class="adm-field"><span>Date &amp; reading time</span><input name="meta" value="${esc(d.meta)}" placeholder="e.g. 12 Mar 2026 · 4 min read"></label>
        </div>
        <label class="adm-field"><span>Title</span><input name="title" value="${esc(d.title)}" placeholder="Article title"></label>
        <label class="adm-field"><span>Excerpt</span><textarea name="excerpt" rows="4" placeholder="Two or three sentences, quoted or faithfully summarised">${esc(d.excerpt)}</textarea></label>
        <label class="adm-field"><span>Link (LinkedIn post or article URL)</span><input name="url" type="url" value="${esc(d.url)}" placeholder="https://www.linkedin.com/..."></label>
        <p class="adm-error" role="alert" hidden></p>`,
      actions: [{ label: 'Cancel', value: 'cancel' }, { label: 'Apply', value: 'ok', primary: true }],
      onOpen: (f) => f.title.focus(),
      onSubmit: (f) => {
        const url = f.url.value.trim();
        if (url && !/^https?:\/\//i.test(url)) { fieldError(f, 'The link must start with https://'); return false; }
        return true;
      },
    });
    if (value !== 'ok') return;
    const v = { cat: form.cat.value.trim(), title: form.title.value.trim(), excerpt: form.excerpt.value.trim(), meta: form.meta.value.trim(), url: form.url.value.trim() };
    both(btn, (b) => {
      Object.entries(v).forEach(([k, val]) => b.setAttribute(`data-${k}`, val));
      const doc = b.ownerDocument;
      const cat = $('.read__cat', b); if (cat) cat.textContent = v.cat;
      const t = $('.read__title', b);
      if (t) {
        if (v.title) t.textContent = v.title;
        else { const s = doc.createElement('span'); s.className = 'ph'; s.textContent = 'Article title'; t.replaceChildren(s); }
      }
    });
    markDirty();
    btn.click();
    window.Site.refresh();
    toast('Article updated.');
  }

  /* ---------------------------------------------------------------------
     Link editor
     --------------------------------------------------------------------- */
  async function openLinkDialog(a) {
    const { value, form } = await dialog({
      title: 'Edit link',
      html: `
        <label class="adm-field"><span>URL</span><input name="href" value="${esc(a.getAttribute('href'))}" placeholder="https://… or mailto:…"></label>
        <p class="adm-error" role="alert" hidden></p>`,
      actions: [{ label: 'Cancel', value: 'cancel' }, { label: 'Apply', value: 'ok', primary: true }],
      onOpen: (f) => f.href.select(),
      onSubmit: (f) => {
        if (!/^(https?:\/\/|mailto:|tel:|#)/i.test(f.href.value.trim())) { fieldError(f, 'Use a full URL (https://…), mailto: or tel: link.'); return false; }
        return true;
      },
    });
    if (value !== 'ok') return;
    both(a, (el) => el.setAttribute('href', form.href.value.trim()));
    markDirty();
    toast('Link updated.');
  }

  /* ---------------------------------------------------------------------
     Images
     --------------------------------------------------------------------- */
  function hasImage({ el, def }) {
    if (def.kind === 'portrait') return !!el.dataset.portrait;
    if (def.kind === 'logo') return el.tagName === 'IMG';
    return el.classList.contains('has-image');
  }
  function currentImage({ el, def }) {
    if (def.kind === 'portrait') return { src: el.dataset.portrait || '', alt: el.dataset.alt || '' };
    if (def.kind === 'logo') return el.tagName === 'IMG' ? { src: el.src, alt: el.alt } : { src: '', alt: '' };
    const img = $(':scope > img', el);
    return img ? { src: img.src, alt: img.alt } : { src: '', alt: '' };
  }
  function defaultAlt({ el, def }) {
    if (def.kind === 'portrait') return 'Portrait of Chinmaya Shrivastava';
    if (def.kind === 'logo') { const org = $('.tl__org', el.closest('.tl__item'))?.textContent.split('·')[0].trim(); return org ? `${org} logo` : 'Organization logo'; }
    if (def.kind === 'cover') return $('.case__title', el.closest('.case'))?.textContent.trim() || '';
    return $('.frame__cap', el.closest('.frame'))?.textContent.trim() || '';
  }

  async function processImage(file, def) {
    if (!/^image\//.test(file.type)) throw new Error('Please choose an image file.');
    if (file.size > 25 * 1024 * 1024) throw new Error('That image is larger than 25 MB.');
    if (file.type === 'image/svg+xml' || file.type === 'image/gif') return { blob: file, ext: file.type === 'image/gif' ? 'gif' : 'svg' };
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, def.max / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale); const h = Math.round(bmp.height * scale);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const png = def.kind === 'logo';
    if (!png) { ctx.fillStyle = '#0D1629'; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(bmp, 0, 0, w, h);
    const type = png ? 'image/png' : 'image/jpeg';
    const blob = await new Promise((res) => c.toBlob(res, type, 0.86));
    return { blob, ext: png ? 'png' : 'jpg' };
  }

  // Put an image (or remove it) on both live element and model twin.
  function applyImage(found, src, token, alt) {
    const { def } = found;
    let { el } = found;
    const mEl = twin.get(el);

    if (def.kind === 'portrait') {
      el.dataset.portrait = src || ''; el.dataset.alt = alt;
      if (mEl) { mEl.setAttribute('data-portrait', token || ''); mEl.setAttribute('data-alt', alt); }
      window.Site.loadPortrait(el);
      return el;
    }

    if (def.kind === 'logo') {
      const make = (doc, s) => {
        if (!s) { const sp = doc.createElement('span'); sp.className = 'tl__logo tl__logo--ph'; sp.setAttribute('aria-hidden', 'true'); sp.textContent = '—'; return sp; }
        const img = doc.createElement('img');
        img.className = 'tl__logo'; img.src = s; img.alt = alt; img.width = 44; img.height = 44; img.loading = 'lazy'; img.decoding = 'async';
        return img;
      };
      const nl = make(document, src); const nm = mEl ? make(model, token) : null;
      if (editing && src) { nl.setAttribute('tabindex', '0'); nl.setAttribute('data-slot', ''); }
      el.replaceWith(nl); if (mEl && nm) mEl.replaceWith(nm);
      if (nm) twin.set(nl, nm);
      return nl;
    }

    // cover / frame: <img> inside the container
    const set = (container, s, isModel) => {
      let img = $(':scope > img', container);
      if (!s) {
        if (img) img.remove();
        container.classList.remove('has-image');
        container.setAttribute('aria-hidden', 'true');
        return;
      }
      if (!img) {
        img = container.ownerDocument.createElement('img');
        if (def.kind === 'cover') img.className = 'case__img';
        img.loading = 'lazy'; img.decoding = 'async';
        container.prepend(img);
      }
      img.setAttribute('src', s);
      img.setAttribute('alt', alt);
      container.classList.add('has-image');
      if (alt) container.removeAttribute('aria-hidden'); else container.setAttribute('aria-hidden', 'true');
      return img;
    };
    const li = set(el, src, false);
    const mi = mEl ? set(mEl, token, true) : null;
    if (li && mi) twin.set(li, mi);
    return el;
  }

  async function openImageDialog(found) {
    if (!found) return;
    hideFloating();
    const cur = currentImage(found);
    const had = hasImage(found);
    let processed = null;
    let previewUrl = '';
    const { value, form } = await dialog({
      title: had ? `Change ${found.def.label}` : `Add ${found.def.label}`,
      html: `
        <div class="adm-drop" tabindex="-1">
          <img class="adm-drop__preview" alt="" ${cur.src ? `src="${esc(cur.src)}"` : 'hidden'}>
          <div class="adm-drop__empty" ${cur.src ? 'hidden' : ''}>${ICON.img}<p>Drop an image here or choose a file</p></div>
        </div>
        <label class="adm-field adm-file"><span>Image file</span><input type="file" name="file" accept="image/*"></label>
        <label class="adm-field"><span>Description (alt text)</span><input name="alt" value="${esc(cur.alt || defaultAlt(found))}" placeholder="Describe the image for screen readers"></label>
        <p class="adm-p adm-p--muted">Large photos are resized automatically. Images are written to <code>assets/images/${found.def.folder}/</code> when you save.</p>
        <p class="adm-error" role="alert" hidden></p>`,
      actions: [
        ...(had ? [{ label: 'Remove image', value: 'remove', danger: true, left: true }] : []),
        { label: 'Cancel', value: 'cancel' },
        { label: 'Apply', value: 'ok', primary: true },
      ],
      onOpen: (f, dlg) => {
        const drop = $('.adm-drop', dlg);
        const take = async (file) => {
          fieldError(f, '');
          try {
            processed = await processImage(file, found.def);
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            previewUrl = URL.createObjectURL(processed.blob);
            const p = $('.adm-drop__preview', dlg); p.src = previewUrl; p.hidden = false;
            $('.adm-drop__empty', dlg).hidden = true;
          } catch (err) { processed = null; fieldError(f, err.message || 'Could not read that image.'); }
        };
        f.file.addEventListener('change', () => f.file.files[0] && take(f.file.files[0]));
        drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
        drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
        drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('is-over'); const file = e.dataTransfer.files[0]; if (file) take(file); });
        drop.addEventListener('click', () => f.file.click());
      },
      onSubmit: (f, v) => {
        if (v === 'ok' && !processed && !had) { fieldError(f, 'Choose an image first.'); return false; }
        return true;
      },
    });

    const alt = form.alt.value.trim();
    if (value === 'remove') {
      applyImage(found, '', '', '');
      markDirty(); toast('Image removed.');
      return;
    }
    if (value !== 'ok') { if (previewUrl) URL.revokeObjectURL(previewUrl); return; }

    if (processed) {
      const token = `admin-pending:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const name = `${found.def.kind}-${Date.now().toString(36)}.${processed.ext}`;
      pending.set(token, { blob: processed.blob, folder: found.def.folder, name });
      applyImage(found, previewUrl, token, alt);
      toast('Image added. Save to keep it.');
    } else {
      // Alt text change only.
      const curModel = twin.get(found.el);
      const modelSrc = found.def.kind === 'portrait' ? curModel?.getAttribute('data-portrait')
        : found.def.kind === 'logo' ? curModel?.getAttribute('src') : $(':scope > img', curModel || document.createElement('div'))?.getAttribute('src');
      applyImage(found, cur.src, modelSrc || '', alt);
      toast('Description updated.');
    }
    markDirty();
  }

  /* ---------------------------------------------------------------------
     Saving
     --------------------------------------------------------------------- */
  const serialize = (doc) => `<!doctype html>\n${doc.documentElement.outerHTML}\n`;
  const blobToDataUrl = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
  const tokenNodes = (doc, token) => $$(`[src="${token}"], [data-portrait="${token}"]`, doc);

  async function getFolder(forcePick) {
    let handle = forcePick ? null : await idb.get('folder');
    if (handle) {
      try {
        let perm = await handle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') perm = await handle.requestPermission({ mode: 'readwrite' });
        if (perm !== 'granted') handle = null;
      } catch (_) { handle = null; }
    }
    if (!handle) {
      const ok = await confirmBox('Choose the site folder',
        'Your browser will ask for a folder. Select the "chinmaya-portfolio" folder (the one containing index.html). This is only asked once.', 'Choose folder');
      if (!ok) return null;
      handle = await window.showDirectoryPicker({ id: 'cs-portfolio', mode: 'readwrite' });
      let looksRight = true;
      try { await handle.getFileHandle('index.html'); await handle.getFileHandle('script.js'); } catch (_) { looksRight = false; }
      if (!looksRight && !(await confirmBox('Is this the right folder?', `"${handle.name}" doesn't contain index.html and script.js. Save into it anyway?`, 'Use this folder'))) return null;
      await idb.set('folder', handle);
    }
    return handle;
  }
  async function writeFile(dir, path, data) {
    const parts = path.split('/');
    const name = parts.pop();
    let d = dir;
    for (const p of parts) d = await d.getDirectoryHandle(p, { create: true });
    const fh = await d.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(data);
    await w.close();
  }

  /* ---------------------------------------------------------------------
     Publishing to GitHub (GitHub Pages): changes go live for everyone
     --------------------------------------------------------------------- */
  const GH_KEY = 'cs-admin-github';
  const gh = {
    load() {
      let cfg = {};
      try { cfg = JSON.parse(localStorage.getItem(GH_KEY) || '{}'); } catch (_) { /* ignore */ }
      let token = cfg.token || '';
      if (!token) { try { token = sessionStorage.getItem(`${GH_KEY}-token`) || ''; } catch (_) { /* ignore */ } }
      const guess = gh.guess();
      return { owner: cfg.owner || guess.owner || '', repo: cfg.repo || guess.repo || '', branch: cfg.branch || 'main', dir: cfg.dir || '', token, remember: !!cfg.token, saved: !!cfg.owner };
    },
    store({ owner, repo, branch, dir, token, remember }) {
      try {
        localStorage.setItem(GH_KEY, JSON.stringify(remember ? { owner, repo, branch, dir, token } : { owner, repo, branch, dir }));
        if (remember) sessionStorage.removeItem(`${GH_KEY}-token`); else sessionStorage.setItem(`${GH_KEY}-token`, token);
      } catch (_) { /* storage blocked */ }
    },
    clear() { try { localStorage.removeItem(GH_KEY); sessionStorage.removeItem(`${GH_KEY}-token`); } catch (_) { /* ignore */ } },
    ready(c = gh.load()) { return !!(c.saved && c.owner && c.repo && c.branch && c.token); },
    // On a *.github.io address, the owner and repository can be read from the URL.
    guess() {
      const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
      if (!m) return {};
      const seg = location.pathname.split('/').filter(Boolean)[0];
      return { owner: m[1], repo: seg && !/\.html?$/i.test(seg) ? seg : `${m[1]}.github.io` };
    },
  };
  const isRemoteHost = () => /^https?:$/.test(location.protocol) && !/^(localhost|127\.|\[::1\])/.test(location.hostname);

  async function ghApi(c, method, path, body) {
    const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}${path}`, {
      method,
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${c.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let msg = '';
      try { msg = (await res.json()).message || ''; } catch (_) { /* no body */ }
      const hint = {
        401: 'The access token is invalid or has expired.',
        403: 'The token isn’t allowed to do this. It needs “Contents: Read and write” on this repository.',
        404: 'Repository, branch or index.html not found, or the token can’t access the repository.',
        409: 'The repository changed while publishing. Please try again.',
        422: 'The repository changed while publishing. Please try again.',
      }[res.status];
      const err = new Error(hint || msg || `GitHub error ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }
  const ghPath = (c, p) => `${c.dir ? `${c.dir.replace(/^\/+|\/+$/g, '')}/` : ''}${p}`;
  const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');
  let ghBaseSha = null; // index.html version the current edits are based on

  async function ghIndexSha(c) {
    const data = await ghApi(c, 'GET', `/contents/${encPath(ghPath(c, 'index.html'))}?ref=${encodeURIComponent(c.branch)}`);
    return data.sha;
  }
  async function ghTest(c) {
    const repo = await ghApi(c, 'GET', '');
    if (repo.permissions && !repo.permissions.push) throw new Error('This token can read the repository but not write to it.');
    await ghIndexSha(c); // confirms the branch and folder contain index.html
    return repo;
  }
  const blobBase64 = async (blob) => (await blobToDataUrl(blob)).split(',')[1];
  // Where visitors see the site: the current address when hosted (Vercel, custom domain, …), else GitHub Pages.
  const liveUrl = (c) => {
    if (isRemoteHost()) return `${location.origin}${location.pathname.replace(/[^/]*$/, '')}`;
    return c.repo.toLowerCase() === `${c.owner.toLowerCase()}.github.io` ? `https://${c.owner}.github.io/` : `https://${c.owner}.github.io/${c.repo}/`;
  };

  async function publishToGitHub() {
    const c = gh.load();
    ui.status.textContent = 'Publishing…';
    ui.bar.classList.add('is-busy');
    try {
      const current = await ghIndexSha(c);
      if (ghBaseSha && current !== ghBaseSha) {
        const go = await confirmBox('The live site changed since you started editing',
          'A newer version was published (perhaps from another device). Publishing now replaces it with the page as you see it here. Continue?', 'Publish anyway', true);
        if (!go) { ui.status.textContent = 'Not published'; return; }
      }
      const ref = await ghApi(c, 'GET', `/git/ref/heads/${encodeURIComponent(c.branch)}`);
      const head = ref.object.sha;
      const base = await ghApi(c, 'GET', `/git/commits/${head}`);

      // Upload new images, then index.html, as one commit.
      const tree = [];
      const done = [];
      for (const [token, img] of pending) {
        const rel = `assets/images/${img.folder}/${img.name}`;
        const blob = await ghApi(c, 'POST', '/git/blobs', { content: await blobBase64(img.blob), encoding: 'base64' });
        tree.push({ path: ghPath(c, rel), mode: '100644', type: 'blob', sha: blob.sha });
        done.push([token, rel]);
      }
      const copy = model.cloneNode(true);
      done.forEach(([token, rel]) => tokenNodes(copy, token).forEach((n) => n.setAttribute(n.hasAttribute('data-portrait') ? 'data-portrait' : 'src', rel)));
      const html = await ghApi(c, 'POST', '/git/blobs', { content: serialize(copy), encoding: 'utf-8' });
      tree.push({ path: ghPath(c, 'index.html'), mode: '100644', type: 'blob', sha: html.sha });

      const newTree = await ghApi(c, 'POST', '/git/trees', { base_tree: base.tree.sha, tree });
      const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
      const commit = await ghApi(c, 'POST', '/git/commits', { message: `Update site content via admin (${stamp} UTC)`, tree: newTree.sha, parents: [head] });
      await ghApi(c, 'PATCH', `/git/refs/heads/${encodeURIComponent(c.branch)}`, { sha: commit.sha });

      // Only now point the real model at the published image paths.
      done.forEach(([token, rel]) => {
        tokenNodes(model, token).forEach((n) => n.setAttribute(n.hasAttribute('data-portrait') ? 'data-portrait' : 'src', rel));
        pending.delete(token);
      });
      ghBaseSha = html.sha;
      markClean('Published');
      toast(`Published. Everyone will see the changes at ${liveUrl(c)} within about a minute (once the site has redeployed).`, 'success');
    } catch (err) {
      ui.status.textContent = 'Publish failed';
      toast(`Publish failed: ${err.message}`, 'error');
    } finally {
      if (ui) ui.bar.classList.remove('is-busy');
    }
  }

  function updateSaveLabel() {
    if (!ui) return;
    const b = $('[data-act="save"]', ui.bar);
    const live = gh.ready();
    b.innerHTML = `${ICON.save}<span>${live ? 'Publish' : 'Save'}</span>`;
    b.title = live ? 'Publish to the live site (Ctrl+S)' : 'Save to this computer (Ctrl+S)';
  }

  async function save() {
    if (!ui || ui.bar.classList.contains('is-busy')) return;
    syncText(); syncFeature();
    if (gh.ready()) return publishToGitHub();
    if (isRemoteHost()) {
      toast('Connect your GitHub repository in Settings to publish changes for everyone.', 'error');
      return openSettings();
    }
    if (!('showDirectoryPicker' in window)) return downloadCopy();
    let dir;
    try { dir = await getFolder(false); } catch (err) { if (err.name !== 'AbortError') toast(`Couldn't open the folder: ${err.message}`, 'error'); return; }
    if (!dir) return;
    ui.status.textContent = 'Saving…';
    try {
      // 1. Back up the current index.html.
      try {
        const old = await (await (await dir.getFileHandle('index.html')).getFile()).text();
        const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
        await writeFile(dir, `admin/backups/index-${stamp}.html`, old);
      } catch (_) { /* no existing file: nothing to back up */ }
      // 2. Write new images and point the model at them.
      for (const [token, img] of pending) {
        const path = `assets/images/${img.folder}/${img.name}`;
        await writeFile(dir, path, img.blob);
        tokenNodes(model, token).forEach((n) => n.setAttribute(n.hasAttribute('data-portrait') ? 'data-portrait' : 'src', path));
        pending.delete(token);
      }
      // 3. Write index.html.
      await writeFile(dir, 'index.html', serialize(model));
      markClean(`Saved to ${dir.name}/index.html`);
      toast('Saved. A backup of the previous version is in admin/backups/.', 'success');
    } catch (err) {
      ui.status.textContent = 'Save failed';
      toast(`Save failed: ${err.message}`, 'error');
    }
  }

  async function downloadCopy() {
    syncText(); syncFeature();
    const copy = model.cloneNode(true);
    for (const [token, img] of pending) {
      const data = await blobToDataUrl(img.blob);
      tokenNodes(copy, token).forEach((n) => n.setAttribute(n.hasAttribute('data-portrait') ? 'data-portrait' : 'src', data));
    }
    const url = URL.createObjectURL(new Blob([serialize(copy)], { type: 'text/html' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'index.html';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    markClean('Downloaded index.html');
    toast('Downloaded index.html. Replace the index.html in your site folder with it.', 'success');
  }

  /* ---------------------------------------------------------------------
     Settings: password, contact email, save location
     --------------------------------------------------------------------- */
  async function openSettings() {
    hideFloating();
    const emailLink = $('#contact [data-contact-email]');
    const folder = await idb.get('folder');
    const canFS = 'showDirectoryPicker' in window;
    const ghc = gh.load();
    const ghFromForm = (f) => ({
      owner: f.ghOwner.value.trim(), repo: f.ghRepo.value.trim(), branch: f.ghBranch.value.trim() || 'main',
      dir: f.ghDir.value.trim(), token: f.ghToken.value.trim() || ghc.token, remember: f.ghRemember.checked, saved: true,
    });
    const ghChanged = (f) => { const n = ghFromForm(f); return !ghc.saved || n.owner !== ghc.owner || n.repo !== ghc.repo || n.branch !== ghc.branch || n.dir !== ghc.dir || !!f.ghToken.value.trim() || n.remember !== ghc.remember; };
    const { value, form } = await dialog({
      title: 'Settings',
      wide: true,
      html: `
        <section class="adm-sec">
          <h3>Change password</h3>
          <div class="adm-grid adm-grid--3">
            <label class="adm-field"><span>Current</span><input type="password" name="cur" autocomplete="current-password"></label>
            <label class="adm-field"><span>New</span><input type="password" name="pw1" autocomplete="new-password" minlength="8"></label>
            <label class="adm-field"><span>Repeat new</span><input type="password" name="pw2" autocomplete="new-password"></label>
          </div>
          <p class="adm-p adm-p--muted">At least 8 characters. Takes effect after you save.</p>
        </section>
        <section class="adm-sec">
          <h3>Contact email</h3>
          <label class="adm-field"><span>Shown as a button in the contact section (leave empty to hide)</span>
            <input type="email" name="email" value="${esc(emailLink ? emailLink.getAttribute('href').replace(/^mailto:/, '') : '')}" placeholder="name@domain.com"></label>
        </section>
        <section class="adm-sec">
          <h3>Publish to the live site (GitHub Pages)</h3>
          <p class="adm-p">When connected, <strong>Publish</strong> commits your changes to the repository and every visitor sees them about a minute later.
            Create a <a class="adm-a" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">fine-grained access token</a>
            with access to <em>only this repository</em> and the permission <em>Contents: Read and write</em>.</p>
          <div class="adm-grid">
            <label class="adm-field"><span>GitHub owner</span><input name="ghOwner" value="${esc(ghc.owner)}" placeholder="your-username" autocomplete="off"></label>
            <label class="adm-field"><span>Repository</span><input name="ghRepo" value="${esc(ghc.repo)}" placeholder="chinmaya-portfolio" autocomplete="off"></label>
            <label class="adm-field"><span>Branch</span><input name="ghBranch" value="${esc(ghc.branch)}" placeholder="main" autocomplete="off"></label>
            <label class="adm-field"><span>Site folder in repo (usually empty)</span><input name="ghDir" value="${esc(ghc.dir)}" placeholder="(repository root)" autocomplete="off"></label>
          </div>
          <label class="adm-field"><span>Access token</span>
            <input type="password" name="ghToken" autocomplete="off" placeholder="${ghc.token ? '•••••••• saved. Leave empty to keep it' : 'github_pat_…'}"></label>
          <label class="adm-check"><input type="checkbox" name="ghRemember" ${ghc.remember || !ghc.token ? 'checked' : ''}> Remember the token on this device (don't tick this on a shared computer)</label>
          <div class="adm-row">
            <button type="button" class="adm-btn" data-gh-test>Test connection</button>
            ${ghc.saved ? '<button type="button" class="adm-btn adm-btn--danger" data-gh-off>Disconnect</button>' : ''}
            <span class="adm-gh-state adm-p adm-p--muted" aria-live="polite">${gh.ready(ghc) ? `Connected to <strong>${esc(ghc.owner)}/${esc(ghc.repo)}</strong>` : 'Not connected'}</span>
          </div>
        </section>
        <section class="adm-sec">
          <h3>Save to this computer</h3>
          <p class="adm-p">${canFS
            ? `Save writes <code>index.html</code> and uploaded images straight into ${folder ? `the folder <strong>${esc(folder.name)}</strong>` : 'your site folder (you\'ll be asked to choose it the first time)'}. The previous version is backed up to <code>admin/backups/</code>.`
            : 'This browser can\'t write to folders, so Save downloads an <code>index.html</code> with images embedded. Use Chrome or Edge to save directly into the site folder.'}</p>
          <div class="adm-row">
            ${canFS ? '<button type="button" class="adm-btn" data-folder>Choose a different folder</button>' : ''}
            <button type="button" class="adm-btn" data-download>Download index.html instead</button>
          </div>
        </section>
        <p class="adm-error" role="alert" hidden></p>`,
      actions: [{ label: 'Close', value: 'cancel' }, { label: 'Apply', value: 'ok', primary: true }],
      onOpen: (f, dlg) => {
        const fb = $('[data-folder]', dlg);
        if (fb) fb.addEventListener('click', async () => { try { const h = await getFolder(true); if (h) toast(`Save folder set to "${h.name}".`, 'success'); } catch (err) { if (err.name !== 'AbortError') toast(err.message, 'error'); } });
        $('[data-download]', dlg).addEventListener('click', () => downloadCopy());
        const state = $('.adm-gh-state', dlg);
        $('[data-gh-test]', dlg).addEventListener('click', async () => {
          const c = ghFromForm(f);
          if (!c.owner || !c.repo || !c.token) { state.textContent = 'Fill in owner, repository and token first.'; return; }
          state.textContent = 'Testing…';
          try { const r = await ghTest(c); state.innerHTML = `✓ Can publish to <strong>${esc(r.full_name)}</strong> (${esc(c.branch)}).`; }
          catch (err) { state.textContent = `✗ ${err.message}`; }
        });
        const off = $('[data-gh-off]', dlg);
        if (off) off.addEventListener('click', () => { gh.clear(); ghBaseSha = null; updateSaveLabel(); dlg.close(''); toast('Disconnected from GitHub. Save now writes to this computer.'); });
      },
      onSubmit: async (f) => {
        if (ghChanged(f) && (f.ghOwner.value.trim() || f.ghRepo.value.trim() || f.ghToken.value.trim())) {
          const c = ghFromForm(f);
          if (!c.owner || !c.repo || !c.token) { fieldError(f, 'To publish, fill in GitHub owner, repository and access token.'); return false; }
          fieldError(f, 'Checking GitHub connection…');
          try { await ghTest(c); } catch (err) { fieldError(f, `GitHub: ${err.message}`); return false; }
          fieldError(f, '');
        }
        if (f.cur.value || f.pw1.value || f.pw2.value) {
          if ((await sha256(SALT + f.cur.value)) !== storedHash()) { fieldError(f, 'Current password is incorrect.'); return false; }
          if (f.pw1.value.length < 8) { fieldError(f, 'The new password must be at least 8 characters.'); return false; }
          if (f.pw1.value !== f.pw2.value) { fieldError(f, 'The new passwords don\'t match.'); return false; }
        }
        const email = f.email.value.trim();
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { fieldError(f, 'That email address doesn\'t look valid.'); return false; }
        return true;
      },
    });
    if (value !== 'ok') return;

    if (ghChanged(form) && form.ghOwner.value.trim() && form.ghRepo.value.trim() && (form.ghToken.value.trim() || ghc.token)) {
      const c = ghFromForm(form);
      gh.store(c);
      try { ghBaseSha = await ghIndexSha(c); } catch (_) { ghBaseSha = null; }
      updateSaveLabel();
      toast(`Connected to ${c.owner}/${c.repo}. Publish now updates the live site.`, 'success');
    }

    let changed = false;
    if (form.pw1.value) {
      const h = await sha256(SALT + form.pw1.value);
      both($('meta[name="admin-key"]'), (m) => m.setAttribute('content', h));
      session.set(h);
      changed = true;
      toast('Password changed. Save to apply it to the site.', 'success');
    }
    const email = form.email.value.trim();
    const current = emailLink ? emailLink.getAttribute('href').replace(/^mailto:/, '') : '';
    if (email !== current) { setContactEmail(email); changed = true; toast(email ? 'Contact email updated.' : 'Contact email removed.'); }
    if (changed) markDirty();
  }

  function setContactEmail(email) {
    const actions = $('#contact .contact__actions');
    if (!actions) return;
    const mActions = twin.get(actions);
    [[actions, document], [mActions, model]].forEach(([wrap, doc]) => {
      if (!wrap) return;
      let a = $('[data-contact-email]', wrap);
      if (!email) { if (a) a.remove(); return; }
      if (!a) {
        a = doc.createElement('a');
        a.className = 'btn btn--ghost btn--lg';
        a.setAttribute('data-contact-email', '');
        wrap.appendChild(a);
      }
      a.setAttribute('href', `mailto:${email}`);
      a.textContent = email;
    });
    const la = $('[data-contact-email]', actions); const ma = mActions && $('[data-contact-email]', mActions);
    if (la && ma) twin.set(la, ma);
  }

  /* ---------------------------------------------------------------------
     Session lifecycle
     --------------------------------------------------------------------- */
  async function logout() {
    if (dirty && !(await confirmBox('Log out with unsaved changes?', 'Your unsaved edits stay on this page until you reload, but they are not written to the site.', 'Log out', true))) return;
    session.clear();
    setEditing(false);
    $$('[data-edit]').forEach((el) => el.removeAttribute('data-edit'));
    [ui.bar, ui.itemBar, ui.imgBtn, ui.linkBtn, ui.toasts].forEach((n) => n.remove());
    ui = null;
    document.body.classList.remove('admin-on');
    if (location.hash === '#admin') history.replaceState(null, '', location.pathname + location.search);
  }

  let eventsBound = false;
  async function open() {
    if (ui) { ui.bar.classList.add('is-pulse'); setTimeout(() => ui && ui.bar.classList.remove('is-pulse'), 600); return; }
    const ok = await login();
    if (!ok) { if (location.hash === '#admin') history.replaceState(null, '', location.pathname + location.search); return; }
    if (!model) buildModel();
    buildUI();
    if (!eventsBound) { bindEditorEvents(); eventsBound = true; }
    document.body.classList.add('admin-on');
    setEditing(true);
    if (dirty) markDirty(); else markClean('Signed in');
    updateSaveLabel();
    toast('Click any text to edit it. Hover an item for more options; click an image to replace it.');
    if (gh.ready()) {
      // Remember which live version these edits start from (to detect edits made elsewhere).
      ghIndexSha(gh.load()).then((sha) => { if (!ghBaseSha) ghBaseSha = sha; })
        .catch((err) => toast(`GitHub: ${err.message} Check Settings before publishing.`, 'error'));
    } else if (isRemoteHost()) {
      toast('To publish changes for everyone, connect your GitHub repository in Settings.');
    }
  }

  window.SiteAdmin = { open };
  open();
})();
