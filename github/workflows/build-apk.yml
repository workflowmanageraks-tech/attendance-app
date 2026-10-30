'use strict';
// VCS Processing - live activity monitor.
// Keeps the last events in memory (nothing is written to the sheet) and streams them to the main admin.
// Every API request gets a "trace"; every outgoing call made while it runs (Google Sheets, Calendar, Drive, ...) is attached to it.
const { AsyncLocalStorage } = require('async_hooks');
const als = new AsyncLocalStorage();

const MAX_EVENTS = 900, REPLAY = 300;
const buf = [], subs = new Set(), open = new Map(), names = new Map(), recent = [];
const info = { integrations: [], started: Date.now() };
let seq = 0, lag = 0;

// background polling the app does all the time (hidden by default in the viewer)
const POLL = new Set(['chatLive', 'callPoll', 'ludoPoll', 'callConfig', 'chatPing', 'chatFetch', 'getAll', 'status']);
// only these request fields are ever shown (names of fields are shown for everything else, never their values)
const SAFE = new Set(['date', 'month', 'year', 'emp', 'code', 'status', 'id', 'to', 'with', 'kind', 'purpose', 'cat', 'category', 'type', 'amount', 'slot', 'group', 'username']);

function emit(ev) {
  ev.n = ++seq; ev.t = Date.now();
  buf.push(ev); if (buf.length > MAX_EVENTS) buf.splice(0, buf.length - MAX_EVENTS);
  const line = 'data: ' + JSON.stringify(ev) + '\n\n';
  for (const s of subs) { try { s.write(line); } catch (e) { subs.delete(s); } }
  return ev;
}

function who(uid) {
  if (!uid) return '';
  if (names.has(uid)) return names.get(uid);
  let n = uid;
  try {
    const a = globalThis.getAccount_(uid, globalThis.readSettings_().values);
    if (a) n = a.name || a.username || uid;
    names.set(uid, n);
  } catch (e) { /* sheet data not loaded yet - show the id for now */ }
  return n;
}
const tokenUid = t => { try { return (t && globalThis.checkToken_(t)) || ''; } catch (e) { return ''; } };

function fieldsOf(req) {
  const out = [];
  Object.keys(req || {}).forEach(k => {
    if (k === 'action' || k === 'token' || k[0] === '_') return;
    const v = req[k];
    if (SAFE.has(k) && (typeof v === 'string' || typeof v === 'number') && String(v).length <= 40) out.push(k + '=' + v);
    else out.push(k);
  });
  return out.slice(0, 14);
}

// ---- one trace per request ----
function begin(body) {
  let req = {}; try { req = JSON.parse(body) || {}; } catch (e) { /* not JSON */ }
  const rid = (typeof req._rid === 'string' && /^[\w-]{4,20}$/.test(req._rid)) ? req._rid : 's' + (seq + 1).toString(36);
  const uid = tokenUid(req.token);
  const tr = { rid, action: String(req.action || '?').slice(0, 40), uid, req, t0: Date.now(), tStart: 0, done: false, steps: 0 };
  open.set(rid, tr);
  emit({ k: 'req', rid, a: tr.action, u: who(uid) || (req.username ? String(req.username).slice(0, 30) : ''), f: fieldsOf(req), poll: POLL.has(tr.action), sz: String(body || '').length });
  return tr;
}
function started(tr) {
  tr.tStart = Date.now();
  emit({ k: 'go', rid: tr.rid, q: tr.tStart - tr.t0 });
}
function end(tr, res, crashed) {
  if (tr.done) return; tr.done = true; open.delete(tr.rid);
  const ms = Date.now() - tr.t0, ok = !!(res && res.ok !== false) && !crashed;
  const uid = tr.uid || tokenUid(res && res.token);
  const user = who(uid) || (tr.req && tr.req.username ? String(tr.req.username).slice(0, 30) : '');
  recent.push({ t: Date.now(), ok, ms, poll: POLL.has(tr.action) }); while (recent.length && recent[0].t < Date.now() - 300000) recent.shift();
  emit({ k: 'end', rid: tr.rid, ok, ms, q: tr.tStart ? tr.tStart - tr.t0 : 0, u: user, code: ok ? '' : String((res && res.code) || 'ERR'), err: ok ? '' : String((res && res.error) || 'Unknown error').slice(0, 300) });
}
const within = (tr, fn) => als.run(tr, fn);

// ---- steps = outgoing calls made while a request runs ----
function step(dest, label, status, ms, detail, failed) {
  const tr = als.getStore();
  emit({ k: 'step', rid: tr ? tr.rid : '', d: dest, l: String(label).slice(0, 90), s: status || 0, ms: Math.round(ms || 0), x: String(detail || '').slice(0, 240),
    ok: !failed && !(status >= 400), bg: !!(tr && tr.done) });
}
function sys(level, text) { emit({ k: 'sys', lv: level, text: String(text).slice(0, 400) }); }

// ---- classify outgoing HTTP calls (query strings are never shown: they can hold keys) ----
function classify(rawUrl, method) {
  let u; try { u = new URL(rawUrl); } catch (e) { return null; }
  const h = u.hostname, p = u.pathname, m = String(method || 'GET').toUpperCase();
  if (h === 'sheets.googleapis.com') return null;                        // shown by the store wrapper (load / save)
  if (h === 'oauth2.googleapis.com' || p.startsWith('/oauth2/')) return { d: 'oauth', l: m + ' ' + p };
  if (h === 'translate.googleapis.com') return { d: 'translate', l: 'Translate text' };
  if (h === 'www.googleapis.com' && p.startsWith('/calendar/')) return { d: 'calendar', l: m + ' ' + p.replace(/^\/calendar\/v3\/calendars\/primary\//, '') };
  if (h === 'www.googleapis.com' && /^\/(upload\/)?drive\//.test(p)) return { d: 'drive', l: m + ' ' + p.replace(/^\/(upload\/)?drive\/v3\//, '') };
  if (h === 'api.github.com') return { d: 'github', l: m + ' ' + p.replace(/^\/repos\/[^/]+\/[^/]+/, '') };
  if (h.endsWith('metered.live')) return { d: 'turn', l: 'Call-relay (TURN) credentials' };
  return { d: 'other', l: m + ' ' + h + p };
}
function patchFetch() {
  if (!globalThis.fetch || globalThis.fetch.__live) return;
  const orig = globalThis.fetch;
  const f = async function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    const c = classify(url, (init && init.method) || (input && input.method));
    if (!c) return orig.apply(this, arguments);
    const t0 = Date.now();
    try { const r = await orig.apply(this, arguments); step(c.d, c.l, r.status, Date.now() - t0, r.ok ? '' : 'HTTP ' + r.status + ' ' + (r.statusText || '')); return r; }
    catch (e) { step(c.d, c.l, 0, Date.now() - t0, e && e.message, true); throw e; }
  };
  f.__live = true; globalThis.fetch = f;
}

// ---- Google Sheets = the database: wrap the store so every read / save is visible ----
function wrapStore(store) {
  const sum = ops => { const c = {}; ops.forEach(o => { const k = Object.keys(o)[0]; c[k] = (c[k] || 0) + 1; }); return Object.keys(c).map(k => k + (c[k] > 1 ? ' x' + c[k] : '')).join(', '); };
  return {
    load: async () => {
      const t0 = Date.now();
      try { const r = await store.load(); step('sheets', 'Read all sheets', 200, Date.now() - t0, (Array.isArray(r) ? r.length : '?') + ' sheets loaded'); return r; }
      catch (e) { step('sheets', 'Read all sheets', 0, Date.now() - t0, e && e.message, true); throw e; }
    },
    flush: async ops => {
      const t0 = Date.now();
      try { const r = await store.flush(ops); step('sheets', 'Save ' + ops.length + ' change' + (ops.length === 1 ? '' : 's'), 200, Date.now() - t0, sum(ops)); return r; }
      catch (e) { step('sheets', 'Save ' + ops.length + ' change' + (ops.length === 1 ? '' : 's'), 0, Date.now() - t0, e && e.message, true); throw e; }
    }
  };
}

// ---- plain HTTP routes (downloads, uploads, OAuth ...). POST / is the API and is traced by begin() ----
function http(rq, rs, fn) {
  const url = (rq.url || '/').split('?')[0];
  if (rq.method === 'OPTIONS' || url === '/live/stream' || (rq.method === 'POST' && url === '/')) return fn();
  const tr = { rid: 'h' + (seq + 1).toString(36), action: rq.method + ' ' + url, uid: '', req: {}, t0: Date.now(), tStart: Date.now(), done: false };
  open.set(tr.rid, tr);
  emit({ k: 'req', rid: tr.rid, a: tr.action, u: '', f: [], poll: rq.method === 'GET' && url === '/', sz: 0, http: true });
  rs.on('finish', () => end(tr, { ok: rs.statusCode < 400, code: 'HTTP ' + rs.statusCode, error: 'HTTP ' + rs.statusCode }));
  rs.on('close', () => { if (!tr.done) end(tr, { ok: false, code: 'ABORT', error: 'Connection closed before the answer was sent' }); });
  return als.run(tr, fn);
}

// ---- live stream to the main admin (Server-Sent Events over fetch) ----
function snapshotStats() {
  const now = Date.now(), win = recent.filter(r => r.t > now - 60000 && !r.poll), real = recent.filter(r => !r.poll);
  let queued = 0, running = 0; open.forEach(t => { if (t.tStart) running++; else queued++; });
  const mu = process.memoryUsage();
  return { k: 'stats', up: Math.round(process.uptime()), boot: info.started, mem: Math.round(mu.rss / 1048576), heap: Math.round(mu.heapUsed / 1048576), lag: Math.round(lag),
    queued, running, rpm: win.length, epm: win.filter(r => !r.ok).length, avg: real.length ? Math.round(real.reduce((a, r) => a + r.ms, 0) / real.length) : 0, subs: subs.size, node: process.version, now };
}
function stream(rq, rs, cors, token) {
  if (tokenUid(token) !== 'ADMIN') { rs.writeHead(403, Object.assign({ 'Content-Type': 'application/json' }, cors)); return rs.end(JSON.stringify({ ok: false, error: 'Only the main admin can watch this.', code: 'PERM' })); }
  rs.writeHead(200, Object.assign({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }, cors));
  const since = Number(new URL(rq.url, 'http://x').searchParams.get('since')) || 0;
  const send = o => rs.write('data: ' + JSON.stringify(o) + '\n\n');
  const past = buf.filter(e => e.n > since).slice(-REPLAY);
  send({ k: 'hello', n: seq, integrations: info.integrations, started: info.started, events: past, open: [...open.values()].map(t => ({ rid: t.rid, a: t.action, t: t.t0, go: !!t.tStart })), stats: snapshotStats() });
  subs.add(rs);
  const hb = setInterval(() => { try { rs.write(': ping\n\n'); send(snapshotStats()); } catch (e) { cleanup(); } }, 3000);
  const cleanup = () => { clearInterval(hb); subs.delete(rs); };
  rq.on('close', cleanup); rs.on('close', cleanup);
}

// event-loop lag = how busy / slow the server itself is
(function () { let last = Date.now(); setInterval(() => { const n = Date.now(); lag = Math.max(0, n - last - 1000); last = n; }, 1000).unref(); })();

function setIntegrations(list) { info.integrations = list; }
sys('info', 'Server started (Node ' + process.version + ')');

module.exports = { begin, started, end, within, step, sys, patchFetch, wrapStore, http, stream, setIntegrations, POLL };
