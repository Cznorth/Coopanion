/**
 * The dressing page's sticker export: a dialog that renders the twelve stickers (scenes.js) with captions
 * in the app language and a font the person picks, shows each as it is done, and saves one GIF or all of
 * them in a zip, through the browser's download (the app shows its save dialog).
 *
 * The built-in font is ZCOOL KuaiLe (OFL), which the build fetches into fonts/ (scripts/stage.ts); without it
 * the captions fall back to the system's sans-serif. Installed fonts are listed with `queryLocalFonts` on a
 * click; a font file the person picks (one that is not installed, or that the list leaves out) is loaded as a
 * FontFace under its file name.
 */
import { STICKERS, renderGif } from './scenes.js';
import { storeZip } from './zip.js';
import { applyText, t } from '../i18n.js';

const BUILTIN = { family: 'ZCOOL KuaiLe', url: new URL('fonts/ZCOOLKuaiLe-Regular.ttf', import.meta.url).href };
let builtin = null;
/** Loads the built-in font once; resolves to whether it is there. */
function loadBuiltin() {
  builtin ??= new FontFace(BUILTIN.family, `url(${BUILTIN.url})`).load()
    .then((face) => { document.fonts.add(face); return true; })
    .catch((err) => { console.warn(`[stickers] 内置字体没载入，字幕用系统字体:${err?.message ?? err}`); return false; });
  return builtin;
}

const toDataUrl = (bytes, type) => new Promise((ok, bad) => {
  const r = new FileReader();
  r.onload = () => ok(r.result); r.onerror = () => bad(r.error);
  r.readAsDataURL(new Blob([bytes], { type }));
});
function download(bytes, type, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** The dialog in `dlg`; `sfx` is the page's sound set. */
export function stickerExport(dlg, sfx) {
  let run = 0, font = BUILTIN.family, locals = null;
  /** Font files picked in this page, as their FontFace families. */
  const files = [];
  /** The finished GIFs of the current font, by sticker id. */
  let done = new Map();

  function show() {
    dlg.innerHTML = `<h2 id="stickerTitle" data-i18n="stickers.title"></h2>
      <p class="lead" data-i18n="stickers.lead"></p>
      <div class="font-row"><label for="stickerFont" data-i18n="stickers.font"></label><select id="stickerFont"></select>
        <button class="btn" type="button" data-local data-i18n="stickers.listLocal"></button>
        <button class="btn" type="button" data-file data-i18n="stickers.pickFile"></button>
        <input type="file" accept=".ttf,.otf,.ttc,.woff,.woff2" data-font-file hidden></div>
      <p class="meta" data-note></p>
      <div class="sticker-grid"></div>
      <div class="actions"><button class="btn" type="button" data-close data-i18n="stickers.close"></button><button class="btn primary" type="button" data-all data-i18n="stickers.saveAll" disabled></button></div>`;
    applyText(dlg);
    const grid = dlg.querySelector('.sticker-grid');
    for (const st of STICKERS) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'sticker'; b.dataset.id = st.id; b.disabled = true;
      b.setAttribute('aria-label', t('stickers.saveOne', { name: t(`stickers.cap.${st.id}`) }));
      b.title = b.getAttribute('aria-label');
      grid.append(b);
    }
    fillFonts();
    dlg.querySelector('#stickerFont').addEventListener('change', (e) => { font = e.target.value; void make(); });
    dlg.querySelector('[data-local]').addEventListener('click', () => void listLocal());
    dlg.querySelector('[data-file]').addEventListener('click', () => dlg.querySelector('[data-font-file]').click());
    dlg.querySelector('[data-font-file]').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) void useFile(f); });
    if (locals) dlg.querySelector('[data-local]').hidden = true;
    if (!dlg.open) dlg.showModal();
  }

  function fillFonts() {
    const sel = dlg.querySelector('#stickerFont');
    sel.textContent = '';
    sel.append(new Option(t('stickers.fontBuiltin'), BUILTIN.family));
    for (const fam of files) sel.append(new Option(fam, fam));
    if (locals?.length) {
      const group = Object.assign(document.createElement('optgroup'), { label: t('stickers.fontLocal') });
      for (const fam of locals) group.append(new Option(fam, fam));
      sel.append(group);
    }
    sel.value = font;
  }

  async function listLocal() {
    const note = dlg.querySelector('[data-note]');
    try {
      if (typeof window.queryLocalFonts !== 'function') throw new Error(t('stickers.localUnsupported'));
      const fonts = await window.queryLocalFonts();
      locals = [...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b));
      fillFonts();
      dlg.querySelector('[data-local]').hidden = true;
      dlg.querySelector('#stickerFont').focus();
    } catch (err) {
      note.textContent = t('stickers.localFailed', { reason: err?.message ?? String(err) });
    }
  }

  async function useFile(file) {
    const family = file.name.replace(/.[^.]+$/, '');
    try {
      if (!files.includes(family)) {
        document.fonts.add(await new FontFace(family, await file.arrayBuffer()).load());
        files.push(family);
      }
    } catch (err) {
      dlg.querySelector('[data-note]').textContent = t('stickers.fileFailed', { name: file.name, reason: err?.message ?? String(err) });
      return;
    }
    font = family;
    fillFonts();
    void make();
  }

  async function make() {
    const mine = ++run;
    done = new Map();
    const note = dlg.querySelector('[data-note]'), all = dlg.querySelector('[data-all]');
    all.disabled = true;
    for (const b of dlg.querySelectorAll('.sticker')) { b.disabled = true; b.textContent = ''; b.classList.add('pending'); }
    const hasBuiltin = await loadBuiltin();
    if (mine !== run) return;
    const base = font === BUILTIN.family && !hasBuiltin ? t('stickers.builtinMissing') : '';
    for (const [i, st] of STICKERS.entries()) {
      note.textContent = [base, t('stickers.making', { n: i + 1, total: STICKERS.length })].filter(Boolean).join(' ');
      let gif;
      try {
        gif = await renderGif(st, { text: t(`stickers.cap.${st.id}`), font });
      } catch (err) {
        if (mine === run) note.textContent = t('stickers.failed', { reason: err?.message ?? String(err) });
        return;
      }
      if (mine !== run) return;
      done.set(st.id, gif);
      const b = dlg.querySelector(`.sticker[data-id="${st.id}"]`);
      const img = Object.assign(document.createElement('img'), { src: await toDataUrl(gif, 'image/gif'), alt: '' });
      if (mine !== run) return;
      b.append(img); b.classList.remove('pending'); b.disabled = false;
    }
    note.textContent = base;
    all.disabled = false;
  }

  dlg.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { dlg.close(); return; }
    const one = e.target.closest('.sticker');
    if (one && done.has(one.dataset.id)) { download(done.get(one.dataset.id), 'image/gif', `coo-${one.dataset.id}.gif`); sfx.tick(); return; }
    if (e.target.closest('[data-all]') && done.size === STICKERS.length) {
      download(storeZip(STICKERS.map((st) => ({ name: `coo-${st.id}.gif`, data: done.get(st.id) }))), 'application/zip', 'Coo-stickers.zip');
      sfx.sparkle();
    }
  });
  // the event comes a task after close(): a dialog opened again by then keeps its new run
  dlg.addEventListener('close', () => { if (!dlg.open) run++; });

  return {
    /** Opens the dialog and renders the set in the font last picked. */
    open() { show(); void make(); },
  };
}
