'use strict';
/* Sakta Cab — anketas lietotne (kopīgs atbilžu pūls Atim un Dinai)
 *
 * Režīmi:
 *  - DEMO (config.apiUrl tukšs): viss glabājas pārlūkā (localStorage + IndexedDB).
 *    ?p=anketa (aizpildīšana) | ?p=admin (Linarda apskats), vai izvēles ekrāns.
 *  - LIVE (apiUrl uzstādīts): kopīgā saite ?t=<token>; backend izlemj lomu (anketa/admin).
 *
 * Anketa ir VIENA: visas 11 sadaļas vienā pūlā. Sadaļas 1–6 pieder Atim,
 * 7–9 Dinai, 10–11 abiem; pie katras atbildes ir norāde `by` — kurš atbild
 * ('atis' | 'dina' | 'abi'). Kopīgajās sadaļās to var pārslēgt pie katra jautājuma.
 *
 * ===== API kontrakts (Google Apps Script backend) =====
 * POST apiUrl, Content-Type: text/plain, body JSON — visiem: { token, action, ... }
 *  getState                                  -> { ok, role:'anketa'|'admin', state:{answers, completed, introSeen} }
 *  saveAnswer  {qid,data,skipped,status,by}  -> { ok }
 *  uploadFile  {qid,name,mime,dataB64}       -> { ok, file:{id,name,mime,url,thumb} }
 *  deleteFile  {qid,fileId}                  -> { ok }
 *  sectionComplete {sectionId}               -> { ok }   (nosūta e-pastu Linardam)
 *  setStatus   {qid,status,comment}          -> { ok }   (tikai admin tokenam)
 *  notifyPrecizejumi {items:[{qid,num,text,comment}]} -> { ok, sent } (admin; viens digest e-pasts Atim & Dinai)
 * Dziļās saites (e-pastos): ?t=<token>&s=<sadaļa> vai &q=<qid> — atver un izgaismo konkrēto vietu.
 * atbildes ieraksts (rec): { data:{lauks:vērtība}, files:[meta], skipped, status, comment, by }
 * status: null | 'jauns' | 'atjaunots' | 'apstiprinats' | 'precizet'
 */

const CFG = window.TAXI_CONFIG || {};
const PARAMS = new URLSearchParams(location.search);
const QBYID = Object.fromEntries(QUESTIONS.map((q) => [q.id, q]));
const SBYID = Object.fromEntries(SECTIONS.map((s) => [s.id, s]));

const App = {
  mode: 'demo', token: null,
  role: null,          // 'resp' | 'admin'
  state: null,         // vienīgais atbilžu pūls (live)
  screen: 'picker',
  view: { section: null },
  filter: 'visi',
  errMsg: '',
  _kopa: null,         // demo krātuves kešs
  _arm: null,          // "pabeigt sadaļu" dubultklikšķa stāvoklis
  deepQ: null,         // dziļā saite: konkrēts jautājums (?q=S5-3)
  deepS: null,         // dziļā saite: sadaļa (?s=5)
  _deepPending: false, // patērē dziļo saiti tikai pirmajā renderā
};

const thumbCache = {};
const pendingUploads = new Set();

/* ───────────────────────── Helpers ───────────────────────── */

function root() { return document.getElementById('app'); }

function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of kids.flat(9)) {
    if (c === null || c === undefined || c === false) continue;
    n.append(c.nodeType ? c : document.createTextNode(c));
  }
  return n;
}

function uid() { return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function qnum(q) { return q.id.slice(1).replace('-', '.'); }
function questionsOf(sid) { return QUESTIONS.filter((q) => q.s === sid); }
function whoDefault(s) { return s.who; } // sadaļas saimnieks; 'abi' kopīgajām

function normalizeStore(s) {
  const st = s && typeof s === 'object' ? s : {};
  st.answers = st.answers || {};
  st.completed = Array.isArray(st.completed) ? st.completed : [];
  st.introSeen = !!st.introSeen;
  for (const r of Object.values(st.answers)) {
    r.data = r.data || {}; r.files = r.files || [];
    r.skipped = !!r.skipped; r.status = r.status || null;
    r.comment = r.comment || ''; r.by = r.by || null;
  }
  return st;
}

/* ───────────────────────── Krātuve ───────────────────────── */

const LS_KEY = 'taxi.v1.kopa';
function mirrorKey() { return 'taxi.v1.live.' + App.token; }
function outboxKey() { return 'taxi.v1.outbox.' + App.token; }
function introKey() { return 'taxi.v1.introSeen.' + (App.token || 'kopa'); }

function store() {
  if (App.mode === 'live') return App.state;
  if (!App._kopa) {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) {}
    App._kopa = normalizeStore(raw);
  }
  return App._kopa;
}

function getRec(qid) {
  const st = store();
  if (!st.answers[qid]) st.answers[qid] = { data: {}, files: [], skipped: false, status: null, comment: '', by: null };
  return st.answers[qid];
}

function persistLocal() {
  if (App.mode === 'demo') {
    try { localStorage.setItem(LS_KEY, JSON.stringify(store())); } catch (e) {}
  } else if (App.role === 'resp') {
    try { localStorage.setItem(mirrorKey(), JSON.stringify(App.state)); } catch (e) {}
  }
}

/* ───────────────────────── API ───────────────────────── */

async function api(payload) {
  const res = await fetch(CFG.apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ token: App.token }, payload)),
  });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || 'API kļūda');
  return j;
}

/* ─────────────────── Atbilžu statusi & saglabāšana ─────────────────── */

function hasVal(f, v) {
  if (v === null || v === undefined) return false;
  if (f.t === 'rank') return !!(v && v.done);
  if (f.t === 'table') {
    return Array.isArray(v) && v.some((row) => Object.values(row || {}).some((x) => String(x ?? '').trim() !== ''));
  }
  return String(v).trim() !== '';
}

function isAnswered(q, r) {
  return r.skipped || r.files.length > 0 || q.fields.some((f) => hasVal(f, r.data[f.k]));
}

function applyStatusOnEdit(qid) {
  const q = QBYID[qid];
  const r = getRec(qid);
  if (!isAnswered(q, r)) { r.status = null; return; }
  if (r.status === 'apstiprinats' || r.status === 'precizet') r.status = 'atjaunots';
  else if (!r.status) r.status = 'jauns';
}

const saveTimers = {};
let retryTimer = null;

function outbox() { try { return JSON.parse(localStorage.getItem(outboxKey()) || '{}'); } catch (e) { return {}; } }
function outboxSet(o) { try { localStorage.setItem(outboxKey(), JSON.stringify(o)); } catch (e) {} }
function outboxAdd(qid) { const o = outbox(); o[qid] = 1; outboxSet(o); }
function outboxDel(qid) { const o = outbox(); delete o[qid]; outboxSet(o); }

function touched(qid) {
  applyStatusOnEdit(qid);
  updateCardState(qid);
  persistLocal();
  setInd('saving');
  clearTimeout(saveTimers[qid]);
  saveTimers[qid] = setTimeout(() => doSave(qid), 700);
}

async function doSave(qid) {
  if (App.mode === 'demo') { setInd('saved'); return; }
  const r = getRec(qid);
  outboxAdd(qid);
  try {
    await api({ action: 'saveAnswer', qid, data: r.data, skipped: r.skipped, status: r.status, by: r.by });
    outboxDel(qid);
    if (!Object.keys(outbox()).length) setInd('saved');
  } catch (e) {
    setInd('error');
    scheduleRetry();
  }
}

function scheduleRetry() {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    for (const qid of Object.keys(outbox())) doSave(qid);
  }, 6000);
}

function flushOutboxBoot() {
  const o = Object.keys(outbox());
  if (!o.length) return;
  let mirror = null;
  try { mirror = normalizeStore(JSON.parse(localStorage.getItem(mirrorKey()) || 'null')); } catch (e) {}
  for (const qid of o) {
    if (mirror && mirror.answers[qid]) App.state.answers[qid] = mirror.answers[qid];
    doSave(qid);
  }
}

function setInd(state) {
  const n = document.getElementById('saveind');
  if (!n) return;
  n.className = 'saveind ' + state;
  n.textContent = state === 'saving' ? 'Saglabā…' : state === 'saved' ? 'Saglabāts ✓' : state === 'error' ? 'Nesaglabājas — mēģinās vēlreiz' : '';
}

/* ───────────────────────── Faili ───────────────────────── */

const idb = {
  _p: null,
  open() {
    if (!this._p) {
      this._p = new Promise((res, rej) => {
        const rq = indexedDB.open('taxi-anketa', 1);
        rq.onupgradeneeded = () => rq.result.createObjectStore('files', { keyPath: 'id' });
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => rej(rq.error);
      });
    }
    return this._p;
  },
};
async function idbPut(rec) {
  const db = await idb.open();
  return new Promise((res, rej) => {
    const t = db.transaction('files', 'readwrite');
    t.objectStore('files').put(rec);
    t.oncomplete = res; t.onerror = () => rej(t.error);
  });
}
async function idbGet(id) {
  const db = await idb.open();
  return new Promise((res, rej) => {
    const rq = db.transaction('files').objectStore('files').get(id);
    rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
  });
}
async function idbDel(id) {
  const db = await idb.open();
  return new Promise((res, rej) => {
    const t = db.transaction('files', 'readwrite');
    t.objectStore('files').delete(id);
    t.oncomplete = res; t.onerror = () => rej(t.error);
  });
}

function readAsDataURL(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(file);
  });
}

async function compressImage(file) {
  const bmp = await createImageBitmap(file);
  const maxDim = 1600;
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * scale));
  c.height = Math.max(1, Math.round(bmp.height * scale));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}

async function addFiles(q, fileList) {
  const files = Array.from(fileList || []);
  for (const file of files) {
    const isPdf = file.type === 'application/pdf';
    const isImg = /^image\//.test(file.type);
    if (!isPdf && !isImg) { toast('Var pievienot attēlus un PDF: ' + file.name, true); continue; }

    let dataURL;
    try {
      dataURL = isPdf ? await readAsDataURL(file) : await compressImage(file).catch(() => readAsDataURL(file));
    } catch (e) { toast('Neizdevās nolasīt failu: ' + file.name, true); continue; }
    if (dataURL.length > 9 * 1024 * 1024) { toast('Fails par lielu (maks. ~8 MB): ' + file.name, true); continue; }

    const r = getRec(q.id);
    const meta = { id: uid(), name: file.name, mime: isPdf ? 'application/pdf' : 'image/jpeg' };
    thumbCache[meta.id] = isPdf ? null : dataURL;

    if (App.mode === 'demo') {
      try { await idbPut({ id: meta.id, dataURL }); } catch (e) {}
      r.files.push(meta);
      touched(q.id);
      renderFiles(q);
    } else {
      pendingUploads.add(meta.id);
      r.files.push(meta);
      renderFiles(q);
      try {
        const j = await api({ action: 'uploadFile', qid: q.id, name: file.name, mime: meta.mime, dataB64: dataURL.split(',')[1] });
        const old = meta.id;
        Object.assign(meta, j.file);
        thumbCache[meta.id] = thumbCache[old];
        pendingUploads.delete(old);
        touched(q.id);
      } catch (e) {
        pendingUploads.delete(meta.id);
        r.files = r.files.filter((x) => x !== meta);
        toast('Augšupielāde neizdevās: ' + file.name, true);
      }
      renderFiles(q);
    }
  }
}

function removeFile(q, meta) {
  const r = getRec(q.id);
  r.files = r.files.filter((x) => x !== meta);
  if (App.mode === 'demo') idbDel(meta.id).catch(() => {});
  else api({ action: 'deleteFile', qid: q.id, fileId: meta.id }).catch(() => toast('Neizdevās izdzēst failu serverī', true));
  touched(q.id);
  renderFiles(q);
}

function thumbNode(q, meta, readonly) {
  const isPdf = meta.mime === 'application/pdf';
  const t = el('div', { class: 'thumb' + (pendingUploads.has(meta.id) ? ' uploading' : '') });
  if (isPdf) {
    t.append(el('div', { class: 'pdf' }, el('span', { class: 'fico' }, '📄'), meta.name));
  } else {
    const img = el('img', { alt: meta.name });
    const src = meta.thumb || thumbCache[meta.id];
    if (src) img.src = src;
    else if (App.mode === 'demo') idbGet(meta.id).then((rec) => { if (rec) { thumbCache[meta.id] = rec.dataURL; img.src = rec.dataURL; } });
    t.append(img);
  }
  if (pendingUploads.has(meta.id)) t.append(el('div', { class: 'spin' }));
  t.addEventListener('click', () => {
    if (isPdf) { if (meta.url) window.open(meta.url, '_blank'); return; }
    const src = meta.url || thumbCache[meta.id] || meta.thumb;
    if (src) lightbox(src);
  });
  if (!readonly) {
    t.append(el('button', { class: 'tdel', title: 'Izdzēst', onclick: (e) => { e.stopPropagation(); removeFile(q, meta); } }, '✕'));
  }
  return t;
}

function renderFiles(q, readonly) {
  const box = document.querySelector('[data-files="' + q.id + '"]');
  if (!box) return;
  const r = getRec(q.id);
  box.innerHTML = '';
  for (const meta of r.files) box.append(thumbNode(q, meta, readonly));
}

function dropzone(q) {
  const input = el('input', { type: 'file', multiple: '', accept: 'image/*,application/pdf', style: 'display:none' });
  input.addEventListener('change', () => { addFiles(q, input.files); input.value = ''; });
  const main = q.ev ? (q.evHint || 'Šeit īpaši gaidām ekrānuzņēmumu!') : 'Ievelc failus šeit vai klikšķini, lai pievienotu';
  const z = el('div', { class: 'drop' + (q.ev ? ' strong' : '') },
    el('span', { class: 'dico' }, '📎'),
    el('div', {},
      el('span', { class: 'dmain' }, main),
      el('span', { class: 'dhint' }, 'Aizklāj pasažieru vārdus, adreses un telefonus, ja tie redzami.')),
    input);
  z.addEventListener('click', () => input.click());
  z.addEventListener('dragover', (e) => { e.preventDefault(); z.classList.add('over'); });
  z.addEventListener('dragleave', () => z.classList.remove('over'));
  z.addEventListener('drop', (e) => { e.preventDefault(); z.classList.remove('over'); addFiles(q, e.dataTransfer.files); });
  return z;
}

/* ───────────────────────── Lauku logrīki ───────────────────────── */

function autosize(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight + 2, 600) + 'px';
}

function buildField(q, f) {
  const r = getRec(q.id);
  const wrap = el('div', { class: 'field' });
  if (f.label) wrap.append(el('div', { class: 'flabel' }, f.label));
  const set = (v) => { r.data[f.k] = v; touched(q.id); };

  if (f.t === 'text') {
    wrap.append(el('input', { class: 'tinput', type: 'text', placeholder: f.ph || '', value: r.data[f.k] || '', oninput: (e) => set(e.target.value) }));

  } else if (f.t === 'textarea') {
    const ta = el('textarea', { class: 'tarea', rows: String(f.rows || 4), placeholder: f.ph || '' });
    ta.value = r.data[f.k] || '';
    ta.addEventListener('input', () => { set(ta.value); autosize(ta); });
    wrap.append(ta);

  } else if (f.t === 'number') {
    wrap.append(el('div', { class: 'numwrap' },
      el('input', { class: 'tinput', type: 'text', inputmode: 'decimal', placeholder: f.ph || '0', value: r.data[f.k] ?? '', oninput: (e) => set(e.target.value) }),
      f.unit ? el('span', { class: 'unit' }, f.unit) : null));

  } else if (f.t === 'choice') {
    const row = el('div', { class: 'pillrow' });
    for (const opt of f.opts) {
      const b = el('button', { class: 'pill' + (r.data[f.k] === opt ? ' on' : ''), type: 'button' }, opt);
      b.addEventListener('click', () => {
        set(r.data[f.k] === opt ? null : opt);
        row.querySelectorAll('.pill').forEach((p) => p.classList.toggle('on', p.textContent === r.data[f.k]));
      });
      row.append(b);
    }
    wrap.append(row);

  } else if (f.t === 'scale') {
    const row = el('div', { class: 'pillrow scale' });
    for (let i = 0; i <= 10; i++) {
      const on = r.data[f.k] === i;
      const b = el('button', { class: 'pill' + (on ? ' on' : ''), type: 'button' }, String(i));
      b.addEventListener('click', () => {
        set(r.data[f.k] === i ? null : i);
        row.querySelectorAll('.pill').forEach((p, idx) => p.classList.toggle('on', r.data[f.k] === idx));
      });
      row.append(b);
    }
    wrap.append(row);

  } else if (f.t === 'slider') {
    const cur = r.data[f.k];
    const unset = cur === null || cur === undefined || cur === '';
    const valEl = el('span', { class: 'sliderval' }, unset ? '—' : cur + (f.unit || ''));
    const range = el('input', { type: 'range', min: String(f.min), max: String(f.max), step: '1', value: String(unset ? f.min : cur) });
    const holder = el('div', { class: 'sliderwrap' + (unset ? ' unset' : '') }, range, valEl);
    range.addEventListener('input', () => {
      holder.classList.remove('unset');
      set(Number(range.value));
      valEl.textContent = range.value + (f.unit || '');
    });
    const clear = el('button', { class: 'sclear', type: 'button', title: 'Notīrīt' }, '✕');
    clear.addEventListener('click', () => {
      set(null); holder.classList.add('unset');
      range.value = String(f.min); valEl.textContent = '—';
    });
    holder.append(clear);
    wrap.append(holder);

  } else if (f.t === 'rank') {
    const container = el('div', { class: 'rank' });
    const order = () => (r.data[f.k] && r.data[f.k].order) ? r.data[f.k].order.slice() : f.items.slice();
    const draw = () => {
      container.innerHTML = '';
      const o = order();
      o.forEach((item, i) => {
        const up = el('button', { class: 'rbtn', type: 'button', title: 'Uz augšu' }, '▲');
        const dn = el('button', { class: 'rbtn', type: 'button', title: 'Uz leju' }, '▼');
        up.disabled = i === 0; dn.disabled = i === o.length - 1;
        const move = (d) => {
          const no = order();
          const t = no[i]; no[i] = no[i + d]; no[i + d] = t;
          r.data[f.k] = { order: no, done: true };
          touched(q.id); draw();
        };
        up.addEventListener('click', () => move(-1));
        dn.addEventListener('click', () => move(1));
        container.append(el('div', { class: 'rankrow' },
          el('span', { class: 'rn' }, String(i + 1)), el('span', { class: 'rt' }, item), up, dn));
      });
      const okBtn = el('button', { class: 'addrow', type: 'button' },
        (r.data[f.k] && r.data[f.k].done) ? 'Secība saglabāta ✓' : 'Secība jau ir pareiza — apstiprinu');
      okBtn.addEventListener('click', () => { r.data[f.k] = { order: order(), done: true }; touched(q.id); draw(); });
      container.append(okBtn);
    };
    draw();
    wrap.append(container);

  } else if (f.t === 'table') {
    const fixed = !!f.fixedRows;
    if (!Array.isArray(r.data[f.k])) {
      r.data[f.k] = fixed ? f.fixedRows.map(() => ({})) : [{}, {}, {}];
    } else if (fixed && r.data[f.k].length < f.fixedRows.length) {
      while (r.data[f.k].length < f.fixedRows.length) r.data[f.k].push({});
    }
    const rows = r.data[f.k];
    const holder = el('div', { class: 'tblwrap' });
    const draw = () => {
      holder.innerHTML = '';
      const thead = el('tr', {}, fixed ? el('th', {}) : null, f.cols.map((c) => el('th', {}, c.label)), fixed ? null : el('th', {}));
      const tbody = el('tbody');
      rows.forEach((row, ri) => {
        const tr = el('tr');
        if (fixed) tr.append(el('td', { class: 'rowlabel' }, f.fixedRows[ri]));
        for (const c of f.cols) {
          const inp = el('input', { class: 'tinput', type: 'text', inputmode: c.num ? 'decimal' : null, value: row[c.k] || '' });
          inp.addEventListener('input', () => { row[c.k] = inp.value; touched(q.id); });
          tr.append(el('td', { class: c.num ? 'num-col' : null }, inp));
        }
        if (!fixed) {
          const del = el('button', { class: 'rowdel', type: 'button', title: 'Dzēst rindu' }, '✕');
          del.addEventListener('click', () => { rows.splice(ri, 1); if (!rows.length) rows.push({}); touched(q.id); draw(); });
          tr.append(el('td', {}, del));
        }
        tbody.append(tr);
      });
      const table = el('table', { class: 'tbl' }, el('thead', {}, thead), tbody);
      holder.append(table);
      if (!fixed) {
        const add = el('button', { class: 'addrow', type: 'button' }, '+ Pievienot rindu');
        add.addEventListener('click', () => { rows.push({}); draw(); });
        holder.append(add);
      }
    };
    draw();
    wrap.append(holder);
  }

  return wrap;
}

/* ─────────────── "Kurš atbild?" norāde ─────────────── */

function whoBadge(q, r) {
  const by = r.by || whoDefault(SBYID[q.s]);
  return el('span', { class: 'badge who who-' + by, 'data-who': q.id }, WHO[by].ico + ' ' + WHO[by].n);
}

function whoControl(q) {
  const s = SBYID[q.s];
  if (s.who !== 'abi') return null; // fiksētajām sadaļām pietiek ar nozīmīti galvenē
  const r = getRec(q.id);
  const keys = ['atis', 'dina', 'abi'];
  const row = el('span', { class: 'pillrow mini who-toggle' });
  for (const k of keys) {
    const b = el('button', { class: 'pill p-' + k + (r.by === k ? ' on' : ''), type: 'button' }, WHO[k].ico + ' ' + WHO[k].n);
    b.addEventListener('click', () => {
      r.by = k;
      touched(q.id); // atjauno arī galvenes nozīmīti caur updateCardState
      row.querySelectorAll('.pill').forEach((p, i) => p.classList.toggle('on', keys[i] === r.by));
    });
    row.append(b);
  }
  return el('span', { class: 'wholabel' }, 'Atbild:', row);
}

/* ───────────────────── Statusa nozīmītes ───────────────────── */

function badgeFor(q, r, adminView) {
  if (r.skipped) return ['Izlaists', 'st-izlaists'];
  if (r.status === 'apstiprinats') return ['✓ Apstiprināts', 'st-apstiprinats'];
  if (r.status === 'precizet') return [adminView ? '❓ Gaida precizējumu' : '❓ Precizē, lūdzu', 'st-precizet'];
  if (r.status === 'atjaunots') return ['↻ Atjaunots', 'st-atjaunots'];
  if (r.status === 'jauns') return [adminView ? 'Jauns' : 'Iesniegts', 'st-jauns'];
  if (adminView) return ['Nav atbildēts', 'st-nav'];
  return null;
}

function updateCardState(qid) {
  const q = QBYID[qid];
  const r = getRec(qid);
  const card = document.querySelector('[data-q="' + qid + '"]');
  if (!card) return;
  card.classList.toggle('skipped', r.skipped);
  card.classList.toggle('st-precizet', r.status === 'precizet');
  const holder = card.querySelector('.qbadges');
  if (holder) {
    holder.innerHTML = '';
    holder.append(whoBadge(q, r));
    const b = badgeFor(q, r, false);
    if (b) holder.append(el('span', { class: 'badge ' + b[1] }, b[0]));
  }
  const skipBtn = card.querySelector('.skipbtn');
  if (skipBtn) skipBtn.textContent = r.skipped ? 'Atcelt izlaišanu' : 'Izlaist jautājumu';
  updateSidebar();
}

/* ───────────────────────── Skati ───────────────────────── */

function topbar() {
  return el('div', {},
    el('div', { class: 'checker' }),
    el('div', { class: 'topbar' },
      el('div', { class: 'topbar-inner' },
        el('span', { class: 'brand' }, el('span', { class: 'cab' }, '🚕'), 'Sakta Cab'),
        el('span', { class: 'spacer' }),
        App.mode === 'demo' ? el('span', { class: 'chip demo' }, 'DEMO') : null,
        el('span', { class: 'chip person' }, App.role === 'admin' ? '🔑 Linards' : 'Atis & Dina'),
        el('span', { class: 'saveind', id: 'saveind' }))));
}

function demoBanner() {
  if (App.mode !== 'demo') return null;
  return el('div', { class: 'banner-wrap' },
    el('div', { class: 'banner-demo' },
      'DEMO režīms — atbildes glabājas tikai šajā pārlūkā. Kad būs pieslēgts Google backend (config.js), tā pati kopīgā anketa strādās ar vienu saiti un visu saglabās Linarda Drive.'));
}

/* ── Izvēles ekrāns (demo) ── */
function renderPicker() {
  root().append(
    el('div', { class: 'checker' }),
    el('div', { class: 'hero' },
      el('div', { class: 'introcard' },
        el('h1', {}, '🚕 Sakta Cab'),
        el('p', { class: 'lead' }, 'Anketa par taksometru tirgu Latvijā — pirmais solis, lai izveidotu godīgāku alternatīvu Bolt. Anketa ir viena, kopīga: atbildes krājas vienā pūlā, un pie katras redzams, kurš atbild — Atis vai Dina.'),
        el('div', { class: 'picker' },
          pickBtn('📝', 'Aizpildīt anketu', 'Atis & Dina · 11 sadaļas kopā', 'anketa'),
          pickBtn('🔑', 'Linards (apskats)', 'atbilžu pārskatīšana un ✓', 'admin')),
        el('p', { style: 'color:var(--dim);font-size:13px;margin-top:22px' },
          'DEMO režīms: atbildes paliek šajā pārlūkā. Publicētajā versijā tā pati viena saite būs Atim un Dinai kopīga.'))));
}
function pickBtn(ico, title, desc, p) {
  return el('button', { class: 'pickbtn', onclick: () => { location.search = '?p=' + p; } },
    el('span', { class: 'pi' }, ico), el('span', { class: 'pt' }, title), el('div', { class: 'pd' }, desc));
}

/* ── Ievads ── */
function renderIntro() {
  root().append(
    topbar(), demoBanner(),
    el('div', { class: 'hero' },
      el('div', { class: 'introcard' },
        el('h1', {}, INTRO.greet + '!'),
        INTRO.body.map((p) => el('p', { class: 'lead' }, p)),
        el('ul', {}, INTRO.points.map((p) => el('li', {}, p))),
        el('div', { class: 'actions' },
          el('button', {
            class: 'btn', onclick: () => {
              store().introSeen = true;
              persistLocal();
              try { localStorage.setItem(introKey(), '1'); } catch (e) {}
              App.screen = 'main'; render();
            },
          }, 'Sākt →')))));
}

/* ── Galvenais skats ── */
function sectionStats(sid) {
  const qs = questionsOf(sid);
  const done = qs.filter((q) => isAnswered(q, getRec(q.id))).length;
  return { done, total: qs.length };
}

function updateSidebar() {
  if (App.role === 'admin') return;
  const sub = document.querySelector('.sec-sub');
  if (sub && App.view.section) {
    const st = sectionStats(App.view.section);
    sub.textContent = 'Atbildēts: ' + st.done + ' no ' + st.total;
  }
  const sb = document.querySelector('.sidebar');
  if (!sb) return;
  for (const s of SECTIONS) {
    const btn = sb.querySelector('[data-sec="' + s.id + '"]');
    if (!btn) continue;
    const st = sectionStats(s.id);
    const cnt = btn.querySelector('.cnt');
    if (cnt) cnt.textContent = st.done + '/' + st.total;
    const bar = btn.querySelector('.pbar');
    if (bar) {
      bar.classList.toggle('full', st.done === st.total);
      bar.firstChild.style.width = Math.round((st.done / st.total) * 100) + '%';
    }
  }
}

function renderMain() {
  if (!App.view.section) App.view.section = SECTIONS[0].id;
  const st0 = store();

  const sidebar = el('div', { class: 'sidebar' }, el('div', { class: 'side-h' }, 'Sadaļas'));
  for (const s of SECTIONS) {
    const st = sectionStats(s.id);
    const completed = st0.completed.includes(s.id);
    const btn = el('button', {
      class: 'secbtn' + (s.id === App.view.section ? ' active' : ''), 'data-sec': String(s.id),
      onclick: () => { App.view.section = s.id; App._arm = null; render(); window.scrollTo({ top: 0 }); },
    },
      el('div', { class: 'row1' },
        el('span', { class: 'num' }, String(s.id)),
        el('span', { class: 't' }, s.title),
        el('span', { class: 'who who-' + s.who }, WHO[s.who].n),
        completed ? el('span', { class: 'done' }, '✓') : null),
      el('div', { class: 'meta' },
        el('span', { class: 'pbar' + (st.done === st.total ? ' full' : '') }, el('i', { style: 'width:' + Math.round((st.done / st.total) * 100) + '%' })),
        el('span', { class: 'cnt' }, st.done + '/' + st.total)));
    sidebar.append(btn);
  }

  const s = SBYID[App.view.section];
  const qs = questionsOf(s.id);
  const st = sectionStats(s.id);
  const completed = st0.completed.includes(s.id);

  const main = el('div', { class: 'main' },
    el('div', { class: 'sec-head' },
      el('div', { class: 'sec-kicker' }, 'Sadaļa ' + s.id + ' · ~' + s.min + ' min · ' + WHO[s.who].dat),
      el('div', { class: 'sec-title' }, s.title),
      el('div', { class: 'sec-sub' }, 'Atbildēts: ' + st.done + ' no ' + st.total)),
    s.note ? el('div', { class: 'note-card' }, el('span', {}, '⚠️'), el('span', {}, s.note)) : null,
    qs.map((q) => questionCard(q)),
    sectionFooter(s, completed));

  root().append(topbar(), demoBanner(), el('div', { class: 'layout' }, sidebar, main));
  document.querySelectorAll('.tarea').forEach(autosize);
}

function questionCard(q) {
  const r = getRec(q.id);
  if (!r.by) r.by = whoDefault(SBYID[q.s]);
  const b = badgeFor(q, r, false);
  const card = el('div', {
    class: 'qcard' + (r.skipped ? ' skipped' : '') + (r.status === 'precizet' ? ' st-precizet' : ''),
    'data-q': q.id,
  },
    el('div', { class: 'qhead' },
      el('span', { class: 'qnum' }, qnum(q)),
      el('span', { class: 'qtext' }, q.text),
      el('span', { class: 'qbadges' },
        whoBadge(q, r),
        b ? el('span', { class: 'badge ' + b[1] }, b[0]) : null)),
    (r.comment && r.status === 'precizet')
      ? el('div', { class: 'comment-bubble' }, el('span', {}, '💬'), el('span', {}, el('b', {}, 'Linards: '), r.comment))
      : null,
    el('div', { class: 'fields' }, q.fields.map((f) => buildField(q, f))),
    dropzone(q),
    el('div', { class: 'thumbs', 'data-files': q.id }),
    el('div', { class: 'qfoot' },
      whoControl(q),
      el('span', { class: 'spacer' }),
      el('button', { class: 'skipbtn', type: 'button', onclick: () => { r.skipped = !r.skipped; touched(q.id); } },
        r.skipped ? 'Atcelt izlaišanu' : 'Izlaist jautājumu')));
  queueMicrotask(() => renderFiles(q));
  return card;
}

function sectionFooter(s, completed) {
  const info = completed
    ? 'Sadaļa atzīmēta kā pabeigta ✓ — atbildes joprojām var papildināt un labot.'
    : 'Kad šī sadaļa ir gatava, atzīmējiet to kā pabeigtu' + (App.mode === 'live' ? ' — Linards saņems ziņu e-pastā.' : '.');

  const btn = completed
    ? el('button', { class: 'btn ghost', disabled: '' }, 'Pabeigta ✓')
    : el('button', {
      class: 'btn', onclick: (e) => {
        const fresh = sectionStats(s.id);
        const rem = fresh.total - fresh.done;
        if (rem > 0 && App._arm !== s.id) {
          App._arm = s.id;
          e.target.textContent = 'Vēl ' + rem + ' bez atbildes — spied vēlreiz';
          e.target.classList.add('orange');
          setTimeout(() => {
            App._arm = null;
            if (document.body.contains(e.target)) {
              e.target.textContent = 'Pabeigt sadaļu ✓';
              e.target.classList.remove('orange');
            }
          }, 4000);
          return;
        }
        completeSection(s.id);
      },
    }, 'Pabeigt sadaļu ✓');

  return el('div', { class: 'secfoot' }, el('div', { class: 'info' }, info), btn);
}

function completeSection(sid) {
  const st = store();
  if (!st.completed.includes(sid)) st.completed.push(sid);
  persistLocal();
  if (App.mode === 'live') api({ action: 'sectionComplete', sectionId: sid }).catch(() => toast('Neizdevās paziņot serverim, bet atbildes ir saglabātas', true));
  toast('Sadaļa pabeigta 🚕');
  App._arm = null;
  const next = SECTIONS.find((s) => !st.completed.includes(s.id));
  if (next) { App.view.section = next.id; render(); window.scrollTo({ top: 0 }); }
  else { App.screen = 'finish'; render(); }
}

function renderFinish() {
  root().append(topbar(), demoBanner(),
    el('div', { class: 'finish' },
      el('div', { class: 'big' }, '🚕🎉'),
      el('h2', {}, 'Paldies!'),
      el('p', {}, OUTRO),
      el('button', { class: 'btn ghost', onclick: () => { App.screen = 'main'; render(); } }, 'Atvērt sadaļas vēlreiz')));
}

/* ───────────────────────── Admin ───────────────────────── */

function adminCounts() {
  const c = { total: QUESTIONS.length, answered: 0, waiting: 0, precizet: 0, apstiprinats: 0, nav: 0, completed: store().completed.length, sections: SECTIONS.length };
  for (const q of QUESTIONS) {
    const r = getRec(q.id);
    const ans = isAnswered(q, r);
    if (ans) c.answered++; else if (!r.skipped) c.nav++;
    if (r.status === 'jauns' || r.status === 'atjaunots') c.waiting++;
    if (r.status === 'precizet') c.precizet++;
    if (r.status === 'apstiprinats') c.apstiprinats++;
  }
  return c;
}

function matchesFilter(q, r) {
  const ans = isAnswered(q, r);
  switch (App.filter) {
    case 'gaida': return r.status === 'jauns' || r.status === 'atjaunots';
    case 'precizet': return r.status === 'precizet';
    case 'apstiprinats': return r.status === 'apstiprinats';
    case 'nav': return !ans;
    default: return true;
  }
}

function openPrecizejumi() {
  return QUESTIONS.filter((q) => getRec(q.id).status === 'precizet')
    .map((q) => ({ qid: q.id, num: qnum(q), text: q.text, comment: getRec(q.id).comment || '' }));
}

let armNotify = false;
function notifyButton() {
  const label = () => '📣 Paziņot Atim & Dinai (' + adminCounts().precizet + ')';
  const btn = el('button', {
    class: 'btn orange sm', onclick: async () => {
      const items = openPrecizejumi();
      if (!items.length) { toast('Nav atvērtu precizējumu — nav ko sūtīt'); return; }
      if (!armNotify) {
        armNotify = true;
        btn.textContent = 'Sūtīt e-pastu par ' + items.length + '? Spied vēlreiz';
        setTimeout(() => { armNotify = false; if (document.body.contains(btn)) btn.textContent = label(); }, 4000);
        return;
      }
      armNotify = false;
      btn.textContent = label();
      if (App.mode === 'demo') { toast('DEMO režīmā e-pastus nesūta — strādās publicētajā versijā 📣'); return; }
      try {
        const j = await api({ action: 'notifyPrecizejumi', items });
        toast('E-pasts nosūtīts — ' + j.sent + ' precizējumi 📣');
      } catch (err) { toast('Neizdevās nosūtīt: ' + err.message, true); }
    },
  }, label());
  return btn;
}

function renderAdmin() {
  const c = adminCounts();
  const st0 = store();

  const chips = [
    ['visi', 'Visi', c.total],
    ['gaida', 'Gaida pārskatīšanu', c.waiting],
    ['precizet', 'Precizējami', c.precizet],
    ['apstiprinats', 'Apstiprinātie', c.apstiprinats],
    ['nav', 'Neatbildētie', c.nav],
  ];

  const content = el('div', { class: 'main' },
    el('div', { class: 'adminbar' },
      el('span', { class: 'sec-title', style: 'font-size:22px' }, 'Atbilžu apskats'),
      el('span', { class: 'spacer', style: 'flex:1' }),
      notifyButton(),
      el('button', {
        class: 'btn ghost sm', onclick: async () => {
          if (App.mode === 'demo') { App._kopa = null; render(); }
          else {
            try { const j = await api({ action: 'getState' }); App.state = normalizeStore(j.state); render(); }
            catch (e) { toast('Neizdevās atsvaidzināt: ' + e.message, true); }
          }
        },
      }, '↻ Atsvaidzināt')),
    el('div', { class: 'statrow' },
      el('div', { class: 'stat' }, el('div', { class: 'v' }, c.answered + '/' + c.total), el('div', { class: 'l' }, 'atbildēti jautājumi')),
      el('div', { class: 'stat v-yellow' }, el('div', { class: 'v' }, String(c.waiting)), el('div', { class: 'l' }, 'gaida pārskatīšanu')),
      el('div', { class: 'stat v-orange' }, el('div', { class: 'v' }, String(c.precizet)), el('div', { class: 'l' }, 'gaida precizējumu')),
      el('div', { class: 'stat v-green' }, el('div', { class: 'v' }, String(c.apstiprinats)), el('div', { class: 'l' }, 'apstiprināti')),
      el('div', { class: 'stat' }, el('div', { class: 'v' }, c.completed + '/' + c.sections), el('div', { class: 'l' }, 'sadaļas pabeigtas'))),
    el('div', { class: 'chips' }, chips.map(([key, label, n]) =>
      el('button', { class: 'fchip' + (App.filter === key ? ' active' : ''), onclick: () => { App.filter = key; render(); } },
        label, el('span', { class: 'n' }, String(n))))));

  for (const s of SECTIONS) {
    const qs = questionsOf(s.id).filter((q) => matchesFilter(q, getRec(q.id)));
    if (!qs.length) continue;
    content.append(el('div', { class: 'asec-h', 'data-sec-anchor': String(s.id) },
      el('span', { class: 'yn' }, s.id + '.'), s.title,
      el('span', { class: 'badge who who-' + s.who }, WHO[s.who].ico + ' ' + WHO[s.who].dat),
      st0.completed.includes(s.id) ? el('span', { class: 'compl' }, '✓ pabeigta') : null));
    for (const q of qs) content.append(adminCard(q));
  }

  root().append(topbar(), demoBanner(), el('div', { class: 'layout', style: 'grid-template-columns:1fr' }, content));
}

function fmtAnswer(q, r) {
  const parts = [];
  for (const f of q.fields) {
    const v = r.data[f.k];
    if (!hasVal(f, v)) continue;
    if (f.label) parts.push(el('div', { class: 'avlabel' }, f.label));
    if (f.t === 'rank') {
      parts.push(el('ol', {}, v.order.map((it) => el('li', {}, it))));
    } else if (f.t === 'table') {
      const fixed = !!f.fixedRows;
      const rows = v.map((row, ri) => ({ row, ri })).filter(({ row }) => Object.values(row || {}).some((x) => String(x ?? '').trim() !== ''));
      parts.push(el('table', {},
        el('thead', {}, el('tr', {}, fixed ? el('th', {}) : null, f.cols.map((cc) => el('th', {}, cc.label)))),
        el('tbody', {}, rows.map(({ row, ri }) => el('tr', {},
          fixed ? el('td', {}, f.fixedRows[ri]) : null,
          f.cols.map((cc) => el('td', {}, String(row[cc.k] || ''))))))));
    } else if (f.t === 'scale') {
      parts.push(el('div', { class: 'bigval' }, v + ' / 10'));
    } else if (f.t === 'slider') {
      parts.push(el('div', { class: 'bigval' }, v + (f.unit || '')));
    } else if (f.t === 'number') {
      parts.push(el('div', { class: 'bigval' }, v + (f.unit ? ' ' + f.unit : '')));
    } else {
      parts.push(el('div', {}, String(v)));
    }
  }
  return parts;
}

function adminCard(q) {
  const r = getRec(q.id);
  const s = SBYID[q.s];
  const ans = isAnswered(q, r);
  const b = badgeFor(q, r, true);
  const by = r.by || whoDefault(s);

  const commentBox = el('textarea', { class: 'tarea', rows: '2', placeholder: 'Precizējošs jautājums vai komentārs…' });
  commentBox.value = r.comment || '';
  const cwrap = el('div', { class: 'cwrap', style: 'display:none' },
    commentBox,
    el('div', { style: 'margin-top:8px' },
      el('button', {
        class: 'btn orange sm', onclick: () => {
          const txt = commentBox.value.trim();
          if (!txt) { toast('Uzraksti komentāru', true); return; }
          setStatus(q.id, 'precizet', txt);
        },
      }, 'Nosūtīt precizējumu ❓')));

  const card = el('div', { class: 'qcard' + (r.status === 'precizet' ? ' st-precizet' : ''), 'data-q': q.id },
    el('div', { class: 'qhead' },
      el('span', { class: 'qnum' }, qnum(q)),
      el('span', { class: 'qtext' }, q.text),
      el('span', { class: 'qbadges' },
        el('span', { class: 'badge who who-' + by }, WHO[by].ico + ' ' + WHO[by].n),
        b ? el('span', { class: 'badge ' + b[1] }, b[0]) : null)),
    ans
      ? el('div', { class: 'answer-view' }, fmtAnswer(q, r))
      : el('div', { class: 'noanswer' }, r.skipped ? 'Izlaists.' : 'Vēl nav atbildēts.'),
    el('div', { class: 'thumbs', 'data-files': q.id }),
    r.comment ? el('div', { class: 'comment-bubble' }, el('span', {}, '💬'), el('span', {}, el('b', {}, 'Tavs komentārs: '), r.comment)) : null,
    el('div', { class: 'actrl' },
      el('button', { class: 'btn green sm', onclick: () => setStatus(q.id, 'apstiprinats', '') }, '✓ Apstiprināt'),
      el('button', {
        class: 'btn ghost sm', onclick: () => {
          cwrap.style.display = cwrap.style.display === 'none' ? 'block' : 'none';
          if (cwrap.style.display === 'block') commentBox.focus();
        },
      }, '❓ Precizēt'),
      cwrap));

  queueMicrotask(() => renderFiles(q, true));
  return card;
}

async function setStatus(qid, status, comment) {
  const r = getRec(qid);
  r.status = status;
  r.comment = comment;
  if (App.mode === 'demo') {
    persistLocal();
    render();
  } else {
    try {
      await api({ action: 'setStatus', qid, status, comment });
      render();
    } catch (e) { toast('Neizdevās saglabāt statusu: ' + e.message, true); return; }
  }
  toast(status === 'apstiprinats' ? 'Apstiprināts ✓' : 'Precizējums nosūtīts ❓');
}

/* ─────────────────── Toast & lightbox ─────────────────── */

let toastTimer = null;
function toast(msg, isErr) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 3400);
}

function lightbox(src) {
  const close = () => { lb.remove(); document.removeEventListener('keydown', esc); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  const lb = el('div', { class: 'lightbox', onclick: close }, el('img', { src }));
  document.addEventListener('keydown', esc);
  document.body.append(lb);
}

/* ───────────────────────── Render & boot ───────────────────────── */

function render() {
  root().innerHTML = '';
  if (App.screen === 'picker') renderPicker();
  else if (App.screen === 'intro') renderIntro();
  else if (App.screen === 'main') renderMain();
  else if (App.screen === 'finish') renderFinish();
  else if (App.screen === 'admin') renderAdmin();
  else if (App.screen === 'error') {
    root().append(el('div', { class: 'errscreen' },
      el('h2', {}, '🚧 Neizdevās ielādēt'),
      el('p', {}, App.errMsg || 'Pārbaudi saiti vai interneta savienojumu.'),
      el('button', { class: 'btn', onclick: () => location.reload() }, 'Mēģināt vēlreiz')));
  }
  applyDeepLink();
}

// Dziļā saite no e-pasta: aizritina līdz konkrētajam jautājumam vai sadaļai un
// uz brīdi to izgaismo. Patērē tikai vienreiz, lai vēlākie renderi neaizlec prom.
function applyDeepLink() {
  if (!App._deepPending) return;
  if (App.screen !== 'main' && App.screen !== 'admin') return;
  App._deepPending = false;
  const qid = App.deepQ, sid = App.deepS;
  requestAnimationFrame(() => {
    let target = null;
    if (qid) target = document.querySelector('[data-q="' + qid + '"]');
    else if (sid != null) target = document.querySelector('[data-sec-anchor="' + sid + '"]');
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const card = qid ? target : null;
    if (card) { card.classList.add('flash'); setTimeout(() => card.classList.remove('flash'), 2600); }
  });
}

async function boot() {
  App.deepQ = PARAMS.get('q');
  App.deepS = PARAMS.get('s') != null ? Number(PARAMS.get('s')) : null;
  if (App.deepQ && !QBYID[App.deepQ]) App.deepQ = null;
  if (App.deepS != null && !SBYID[App.deepS]) App.deepS = null;
  App._deepPending = !!(App.deepQ || App.deepS != null);

  const t = PARAMS.get('t');
  if (CFG.apiUrl && t) {
    App.mode = 'live';
    App.token = t;
    root().innerHTML = '<div class="errscreen"><p>Ielādē…</p></div>';
    try {
      const j = await api({ action: 'getState' });
      App.state = normalizeStore(j.state);
      if (j.role === 'admin') {
        App.role = 'admin';
        App.screen = 'admin';
      } else {
        App.role = 'resp';
        App.screen = (App.state.introSeen || localStorage.getItem(introKey())) ? 'main' : 'intro';
        pickStartSection();
        flushOutboxBoot();
      }
    } catch (e) {
      App.screen = 'error';
      App.errMsg = String(e.message || e);
    }
  } else {
    const p = PARAMS.get('p');
    if (p === 'anketa' || p === 'soferis' || p === 'dispecere') {
      App.role = 'resp';
      App.screen = store().introSeen ? 'main' : 'intro';
      pickStartSection();
    } else if (p === 'admin') {
      App.role = 'admin';
      App.screen = 'admin';
    } else {
      App.screen = 'picker';
    }
  }
  render();
}

function pickStartSection() {
  if (App.deepQ) { App.view.section = QBYID[App.deepQ].s; return; }
  if (App.deepS != null) { App.view.section = App.deepS; return; }
  const st = store();
  const next = SECTIONS.find((s) => !st.completed.includes(s.id)) || SECTIONS[0];
  App.view.section = next.id;
}

boot();
