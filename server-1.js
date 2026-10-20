'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { Workbook, install } = require('./gas-shim');

function makeApp(store, env) {
  const wb = new Workbook(store);
  const rt = { delay: 0, mails: [], cal: [] };
  install(wb, env, rt);
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8'), { filename: 'Code.gs' });

  // Sessions survive restarts: signed tokens instead of the Apps Script cache.
  const secret = env.TOKEN_SECRET || crypto.createHash('sha256').update('tok:' + (env.GOOGLE_PRIVATE_KEY || env.SHEET_ID || 'dev')).digest('hex');
  const sign = p => crypto.createHmac('sha256', secret).update(p).digest('hex');
  const revoked = new Set();
  globalThis.newToken_ = function (uid) {
    const p = uid + '|' + getVersion_(uid) + '|' + (Date.now() + TOKEN_TTL * 1000) + '|' + crypto.randomBytes(6).toString('hex');
    return Buffer.from(p).toString('base64url') + '.' + sign(p);
  };
  globalThis.checkToken_ = function (t) {
    if (!t || String(t).indexOf('.') < 0) return '';
    const [b, s] = String(t).split('.');
    const p = Buffer.from(b, 'base64url').toString();
    const good = sign(p);
    if (s.length !== good.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(good))) return '';
    if (revoked.has(t)) return '';
    const [uid, ver, exp] = p.split('|');
    return (Number(exp) > Date.now() && ver === getVersion_(uid)) ? uid : '';
  };

  // ---------- Google Calendar (per-user OAuth; refresh tokens encrypted in the sheet) ----------
  const REFRESH = Number(env.REFRESH_SECONDS || 20) * 1000;
  const calKey = crypto.createHash('sha256').update('cal:' + secret).digest();
  const enc = t => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', calKey, iv);
    const ct = Buffer.concat([c.update(String(t), 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url'); };
  const dec = t => { try { const b = Buffer.from(String(t), 'base64url'), d = crypto.createDecipheriv('aes-256-gcm', calKey, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'); } catch (e) { return ''; } };
  const publicUrl = String(env.PUBLIC_URL || '').replace(/\/+$/, '');
  globalThis.CAL_CFG_ = { clientId: env.CAL_CLIENT_ID || '', redirect: publicUrl + '/oauth/google/callback',
    ready: !!(env.CAL_CLIENT_ID && env.CAL_CLIENT_SECRET && publicUrl) };
  globalThis.calState_ = uid => { const p = uid + '|' + (Date.now() + 600000) + '|' + crypto.randomBytes(6).toString('hex');
    return Buffer.from(p).toString('base64url') + '.' + sign('cal:' + p); };
  const calCheck = st => { const [b, g] = String(st || '').split('.'); if (!b || !g) return '';
    const p = Buffer.from(b, 'base64url').toString(), good = sign('cal:' + p);
    if (g.length !== good.length || !crypto.timingSafeEqual(Buffer.from(g), Buffer.from(good))) return '';
    const [uid, exp] = p.split('|'); return Number(exp) > Date.now() ? uid : ''; };
  const TZ = env.TZ || 'Asia/Kolkata', REMIND = Number(env.CAL_REMIND_MIN || 10);
  const accessCache = new Map();
  async function calAccess(uid, refresh) {
    const c = accessCache.get(uid); if (c && c.tok && c.exp > Date.now() + 30000) return c.tok;
    if (c && c.bad && c.bad > Date.now()) return '';
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: env.CAL_CLIENT_ID, client_secret: env.CAL_CLIENT_SECRET, refresh_token: refresh, grant_type: 'refresh_token' }) });
    const j = await r.json().catch(() => ({}));
    if (!j.access_token) { console.warn('Calendar token refresh failed for', uid, j.error); accessCache.set(uid, { bad: Date.now() + 300000 }); return ''; }
    accessCache.set(uid, { tok: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 }); return j.access_token;
  }
  const addMin = (date, slot, m) => { const [h, mi] = slot.split(':').map(Number); let t = h * 60 + mi + m, d = new Date(date + 'T00:00:00Z');
    if (t >= 1440) { t -= 1440; d = new Date(d.getTime() + 86400000); }
    return d.toISOString().slice(0, 10) + 'T' + String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0') + ':00'; };
  async function calDo(j) {
    const tok = await calAccess(j.uid, j.refresh); if (!tok) return;
    const base = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
    const id = 'kstt' + j.date.replace(/-/g, '') + j.slot.replace(':', '');
    const H = { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' };
    const call = async (url, method, body) => { for (let i = 0; i < 3; i++) {
      const r = await fetch(url, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
      if (r.status === 429 || r.status === 403 || r.status >= 500) { await new Promise(x => setTimeout(x, 700 * (i + 1))); continue; }
      return r; } return { status: 0 }; };
    if (!j.cat) { await call(base + '/' + id, 'DELETE'); return; }
    const body = { summary: j.cat, status: 'confirmed', start: { dateTime: j.date + 'T' + j.slot + ':00', timeZone: TZ },
      end: { dateTime: addMin(j.date, j.slot, 30), timeZone: TZ }, reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: REMIND }] } };
    let r = await call(base + '/' + id, 'PUT', body);
    if (r.status === 404) { r = await call(base, 'POST', Object.assign({ id }, body)); if (r.status === 409) r = await call(base + '/' + id, 'PUT', body); }
  }
  let calChain = Promise.resolve();
  function calRun(jobs) {            // background, one by one - never blocks the app's own requests
    jobs.forEach(j => { calChain = calChain.then(() => calDo(j)).catch(e => console.warn('Calendar sync:', e.message)); });
  }
  const page = (code, msg) => ({ code, html: '<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><body style="font-family:system-ui;padding:32px;max-width:480px;margin:auto"><h2>' +
    (code === 200 ? '✅ Google Calendar connected' : '⚠️ Could not connect') + '</h2><p>' + String(msg).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) + '</p></body>' });
  async function runOauth(q) {
    if (q.error) return page(400, 'Google said: ' + q.error);
    const uid = calCheck(q.state); if (!uid) return page(400, 'This link expired. Go back to the app and click "Connect Google Calendar" again.');
    if (!globalThis.CAL_CFG_.ready) return page(400, 'Calendar sync is not configured on the server.');
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: q.code || '', client_id: env.CAL_CLIENT_ID, client_secret: env.CAL_CLIENT_SECRET, redirect_uri: globalThis.CAL_CFG_.redirect, grant_type: 'authorization_code' }) });
    const j = await r.json().catch(() => ({}));
    if (!j.access_token) return page(400, j.error_description || j.error || 'Google did not return a token.');
    if (!j.refresh_token) return page(400, 'Google did not give offline access. Remove this app from myaccount.google.com/permissions and connect again.');
    let email = '';
    try { email = (await (await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: 'Bearer ' + j.access_token } })).json()).email || ''; } catch (e) {}
    if (!wb.loadedAt || Date.now() - wb.loadedAt > REFRESH) await wb.load();
    const p = globalThis.PropertiesService.getScriptProperties();
    p.setProperty('CAL_TOK_' + uid, enc(j.refresh_token));
    p.setProperty('CAL_META_' + uid, JSON.stringify({ email, at: Date.now() }));
    await wb.flush(); accessCache.delete(uid);
    return page(200, (email ? email + ' is' : 'Your account is') + ' now linked. Close this tab and go back to the app.');
  }

  // ---------- Fingerprint / Face / screen-lock unlock (WebAuthn passkeys) ----------
  // The phone's own biometric check happens on the device; the server only stores a PUBLIC key per device
  // and verifies a signature over a one-time challenge. No fingerprint or face data ever leaves the phone.
  const BIO_ACTIONS = new Set(['bioChallenge', 'bioRegister', 'bioLogin', 'bioList', 'bioRemove']);
  const challenges = new Map();                       // one-time challenges (in memory, 2 min)
  const bioFails = new Map();
  const b64u = b => Buffer.from(b).toString('base64url');
  const sha256 = b => crypto.createHash('sha256').update(b).digest();
  const bioKey = uid => 'BIO_' + uid;
  const bioIdx = id => 'BIOIDX_' + sha256(id).toString('hex').slice(0, 40);
  const bioRead = uid => { try { return JSON.parse(globalThis.PropertiesService.getScriptProperties().getProperty(bioKey(uid)) || '[]'); } catch (e) { return []; } };
  const bioWrite = (uid, list) => globalThis.PropertiesService.getScriptProperties().setProperty(bioKey(uid), JSON.stringify(list));
  const bioView = list => list.map(c => ({ id: c.cid.slice(0, 16), label: c.label, at: c.at, last: c.last || '' }));
  function newChallenge(kind, uid) {
    const now = Date.now(); for (const [k, v] of challenges) if (v.exp < now) challenges.delete(k);
    const id = crypto.randomBytes(12).toString('hex'), ch = b64u(crypto.randomBytes(32));
    challenges.set(id, { ch, kind, uid: uid || '', exp: now + 120000 }); return { chId: id, challenge: ch };
  }
  function useChallenge(id, kind, uid) {              // single use
    const c = challenges.get(String(id || '')); challenges.delete(String(id || ''));
    if (!c || c.exp < Date.now() || c.kind !== kind || (uid && c.uid !== uid)) globalThis.fail_('This request expired. Please try again.', 'BIO');
    return c.ch;
  }
  function checkClientData(cdB64, type, challenge, origin) {
    let cd; try { cd = JSON.parse(Buffer.from(String(cdB64), 'base64url').toString('utf8')); } catch (e) { globalThis.fail_('Bad biometric response.', 'BIO'); }
    if (cd.type !== type || cd.challenge !== challenge) globalThis.fail_('Biometric check failed. Please try again.', 'BIO');
    const want = String(env.ALLOWED_ORIGIN || '');
    if (want && want !== '*' && cd.origin !== want.replace(/\/+$/, '')) globalThis.fail_('This website address is not allowed for biometric unlock.', 'BIO');
    if (origin && cd.origin !== origin) globalThis.fail_('Biometric was set up on a different website address.', 'BIO');
    return cd;
  }
  function bioRoute(req) {
    const a = req.action;
    if (a === 'bioChallenge') {                       // public: needed before login
      if (req.purpose === 'register') {
        const uid = globalThis.checkToken_(req.token); if (!uid) globalThis.fail_('Session expired. Please log in again.', 'AUTH');
        return Object.assign({ ok: true }, newChallenge('reg', uid), { userId: b64u(uid) });
      }
      return Object.assign({ ok: true }, newChallenge('get'));
    }
    if (a === 'bioLogin') return bioLogin(req);
    const uid = globalThis.checkToken_(req.token); if (!uid) globalThis.fail_('Session expired. Please log in again.', 'AUTH');
    if (a === 'bioList') return { ok: true, list: bioView(bioRead(uid)) };
    if (a === 'bioRemove') {
      const list = bioRead(uid), keep = list.filter(c => c.cid.slice(0, 16) !== String(req.id));
      list.filter(c => !keep.includes(c)).forEach(c => globalThis.PropertiesService.getScriptProperties().deleteProperty(bioIdx(c.cid)));
      bioWrite(uid, keep); return { ok: true, list: bioView(keep) };
    }
    if (a === 'bioRegister') {
      const ch = useChallenge(req.chId, 'reg', uid);
      const cd = checkClientData(req.clientDataJSON, 'webauthn.create', ch, '');
      let pub; try { pub = crypto.createPublicKey({ key: Buffer.from(String(req.publicKey), 'base64url'), format: 'der', type: 'spki' }); } catch (e) { globalThis.fail_('This device did not return a usable key.', 'BIO'); }
      const cid = String(req.credId || ''); if (cid.length < 16 || cid.length > 1400) globalThis.fail_('Bad credential.', 'BIO');
      const P = globalThis.PropertiesService.getScriptProperties(), owner = P.getProperty(bioIdx(cid));
      if (owner && owner !== uid) globalThis.fail_('This device key is already linked to another account.', 'BIO');
      const list = bioRead(uid).filter(c => c.cid !== cid);
      if (list.length >= 5) globalThis.fail_('You can link up to 5 devices. Remove one first.', 'BIO');
      list.push({ cid, pub: pub.export({ type: 'spki', format: 'der' }).toString('base64url'), origin: cd.origin,
        label: String(req.label || 'This device').replace(/[\r\n\t<>]+/g, ' ').slice(0, 60), at: new Date().toISOString(), counter: 0 });
      bioWrite(uid, list); P.setProperty(bioIdx(cid), uid);
      return { ok: true, list: bioView(list) };
    }
  }
  function bioLogin(req) {
    const info = globalThis.cleanInfo_(req.client), P = globalThis.PropertiesService.getScriptProperties();
    const cid = String(req.credId || ''), uid = cid ? P.getProperty(bioIdx(cid)) : '';
    const ch = useChallenge(req.chId, 'get');
    const bad = why => { globalThis.logLogin_(null, uid || '(biometric)', 'Failed', 'Biometric: ' + why, info); const e = new Error('Biometric unlock failed. Use your password.'); e.code = 'BIO'; throw e; };
    const nf = bioFails.get(uid || cid) || 0; if (nf >= 8) globalThis.fail_('Too many failed attempts. Use your password.', 'LOCKED');
    if (!uid) bad('unknown device');
    const list = bioRead(uid), rec = list.find(c => c.cid === cid); if (!rec) bad('unknown device');
    let ok = false;
    try {
      const cd = checkClientData(req.clientDataJSON, 'webauthn.get', ch, rec.origin);
      const ad = Buffer.from(String(req.authenticatorData), 'base64url'), sig = Buffer.from(String(req.signature), 'base64url');
      const rpId = new URL(cd.origin).hostname;
      if (ad.length < 37 || !ad.subarray(0, 32).equals(sha256(rpId))) bad('wrong site');
      if (!(ad[32] & 1) || !(ad[32] & 4)) bad('no biometric/PIN check');     // user present + user verified
      const key = crypto.createPublicKey({ key: Buffer.from(rec.pub, 'base64url'), format: 'der', type: 'spki' });
      const data = Buffer.concat([ad, sha256(Buffer.from(String(req.clientDataJSON), 'base64url'))]);
      ok = crypto.verify(key.asymmetricKeyType === 'ed25519' ? null : 'sha256', data, key, sig);
      const cnt = ad.readUInt32BE(33); if (cnt && rec.counter && cnt <= rec.counter) ok = false;   // cloned-key guard
      if (ok && cnt) rec.counter = cnt;
    } catch (e) { if (e.code === 'BIO' || e.code === 'LOCKED') throw e; ok = false; }
    if (!ok) { bioFails.set(uid, nf + 1); bad('bad signature'); }
    bioFails.delete(uid);
    // same rules as a password login
    const acc = globalThis.getAccount_(uid, globalThis.readSettings_().values);
    if (!acc) bad('account removed');
    if (!acc.active) { globalThis.logLogin_(acc, acc.username, 'Blocked', 'Account disabled', info); globalThis.fail_('This account is disabled. Please contact the admin.', 'DISABLED'); }
    if (acc.needLoc && info.lat === '') { globalThis.logLogin_(acc, acc.username, 'Blocked', 'Location not shared', info); globalThis.fail_('Your admin requires location to sign in. Allow location access for this site and try again.', 'LOCREQ'); }
    if (globalThis.payExpired_(acc.payDue)) { globalThis.logLogin_(acc, acc.username, 'Blocked', 'Payment pending', info); globalThis.fail_('Payment pending. Please pay to continue using this account.', 'PAYDUE'); }
    rec.last = new Date().toISOString(); bioWrite(uid, list);
    if (acc.row) { const c = globalThis.getSheet_('USERS').getRange(acc.row, 11); c.setNumberFormat('@'); c.setValue(globalThis.nowStr_()); }
    globalThis.logLogin_(acc, acc.username, 'Success', 'Biometric', info);
    return { ok: true, token: globalThis.newToken_(acc.id), username: acc.username };
  }

  // ---------- Voice / video calls (WebRTC signalling over plain HTTPS polling, kept in memory) ----------
  // Audio and video never pass through this server: it only hands the "offer" / "answer" between the two phones.
  const CALL_ACTIONS = new Set(['callConfig', 'callStart', 'callPoll', 'callAnswer', 'callEnd']);
  const vcalls = new Map(), vbusy = new Map();          // callId -> call ; userId -> callId
  let iceCache = { at: 0, v: null };
  async function iceServers() {
    if (iceCache.v && Date.now() - iceCache.at < 600000) return iceCache.v;   // { servers, turn }
    let v = null;
    if (env.ICE_SERVERS) { try { v = JSON.parse(env.ICE_SERVERS); } catch (e) { v = null; } }
    else if (env.METERED_APP && env.METERED_API_KEY) {
      try { const r = await fetch('https://' + env.METERED_APP + '.metered.live/api/v1/turn/credentials?apiKey=' + encodeURIComponent(env.METERED_API_KEY)); v = await r.json(); } catch (e) { v = null; }
    }
    const hasTurn = Array.isArray(v) && v.length > 0;
    if (!hasTurn) v = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
    iceCache = { at: Date.now(), v: { servers: v, turn: hasTurn } }; return iceCache.v;
  }
  function vcSweep() {
    const now = Date.now();
    for (const c of vcalls.values()) {
      if (c.state === 'ringing' && now - c.t0 > 45000) vcFinish(c, '', 'missed');
      else if (c.state === 'active' && now - Math.min(c.seen.from, c.seen.to) > 20000) vcFinish(c, '', 'lost');
      else if (c.state === 'ended' && now - c.endAt > 30000) vcalls.delete(c.id);
    }
  }
  function vcFinish(c, by, reason) {
    if (c.state === 'ended') return;
    c.state = 'ended'; c.endedBy = by; c.reason = reason; c.endAt = Date.now();
    if (vbusy.get(c.from) === c.id) vbusy.delete(c.from);
    if (vbusy.get(c.to) === c.id) vbusy.delete(c.to);
  }
  const vcSdp = o => { if (!o || typeof o !== 'object' || typeof o.sdp !== 'string' || o.sdp.length > 60000 || (o.type !== 'offer' && o.type !== 'answer')) globalThis.fail_('Bad call data.', 'CALL'); return { type: o.type, sdp: o.sdp }; };
  async function callRoute(req) {
    const uid = globalThis.checkToken_(req.token); if (!uid) globalThis.fail_('Session expired. Please log in again.', 'AUTH');
    vcSweep(); const a = req.action, now = Date.now();
    if (a === 'callConfig') { const r = await iceServers(); return { ok: true, iceServers: r.servers, turn: r.turn }; }
    if (a === 'callStart') {
      const to = String(req.to || ''), kind = req.kind === 'video' ? 'video' : 'audio';
      const S0 = globalThis.readSettings_().values, peer = to && to !== uid ? globalThis.getAccount_(to, S0) : null;
      if (!peer || !peer.active || !peer.username) globalThis.fail_('That user was not found.', 'CALL');
      if (vbusy.has(uid)) globalThis.fail_('You are already in a call.', 'BUSY');
      if (vbusy.has(to)) globalThis.fail_((peer.name || peer.username) + ' is busy on another call.', 'BUSY');
      const me = globalThis.getAccount_(uid, S0), id = crypto.randomBytes(9).toString('hex');
      const c = { id, from: uid, to, fromName: (me && (me.name || me.username)) || 'Someone', kind, offer: vcSdp(req.offer), answer: null,
        state: 'ringing', t0: now, seen: { from: now, to: now }, endedBy: '', reason: '', endAt: 0 };
      vcalls.set(id, c); vbusy.set(uid, id); vbusy.set(to, id);
      return { ok: true, id };
    }
    if (a === 'callPoll') {
      const c = vcalls.get(String(req.cid || ''));
      if (req.cid) {                                       // I am in this call
        if (!c || (c.from !== uid && c.to !== uid)) return { ok: true, call: { state: 'ended', reason: 'gone' } };
        c.seen[c.from === uid ? 'from' : 'to'] = now;
        return { ok: true, call: { state: c.state, answer: c.from === uid ? c.answer : null, reason: c.reason, byMe: c.endedBy === uid } };
      }
      const cur = vcalls.get(vbusy.get(uid) || '');         // idle: is somebody calling me?
      if (cur && cur.to === uid && cur.state === 'ringing')
        return { ok: true, incoming: { id: cur.id, from: cur.from, fromName: cur.fromName, kind: cur.kind, offer: cur.offer, age: now - cur.t0 } };
      return { ok: true, incoming: null };
    }
    const c = vcalls.get(String(req.cid || ''));
    if (!c || (c.from !== uid && c.to !== uid)) globalThis.fail_('This call has ended.', 'CALL');
    if (a === 'callAnswer') {
      if (c.to !== uid || c.state !== 'ringing') globalThis.fail_('This call has ended.', 'CALL');
      c.answer = vcSdp(req.answer); c.state = 'active'; c.seen = { from: now, to: now };
      return { ok: true };
    }
    if (a === 'callEnd') {
      const why = String(req.reason || '');
      vcFinish(c, uid, c.state === 'ringing' ? (c.to === uid ? 'declined' : 'cancelled') : (why === 'failed' ? 'failed' : 'hangup'));
      return { ok: true };
    }
  }

  // ---------- AI assistant (Gemini): turns a spoken/typed sentence into a list of proposed actions ----------
  // The server ONLY parses. Nothing is saved here: the app shows the proposal, the user confirms,
  // and the app then runs the normal actions (setAttendance / addExpense / addWork) with all usual permission checks.
  const AI_ACTIONS = new Set(['aiParse']);
  const aiHits = new Map(), aiModel = { name: '' };
  const isoDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !isNaN(new Date(v + 'T00:00:00Z')) ? String(v) : '';
  async function aiRoute(req) {
    const uid = globalThis.checkToken_(req.token); if (!uid) globalThis.fail_('Session expired. Please log in again.', 'AUTH');
    if (!env.GEMINI_API_KEY) globalThis.fail_('AI is not set up on the server (GEMINI_API_KEY missing).', 'AI');
    const now = Date.now(), hits = (aiHits.get(uid) || []).filter(t => now - t < 60000);
    if (hits.length >= 20) globalThis.fail_('Too many AI requests. Please wait a minute.', 'AI');
    hits.push(now); aiHits.set(uid, hits);
    const text = String(req.text || '').trim().slice(0, 500); if (!text) globalThis.fail_('Say or type something first.', 'AI');
    const today = isoDate(req.today) || new Date().toISOString().slice(0, 10);
    const statuses = (Array.isArray(req.statuses) ? req.statuses : []).slice(0, 30).map(x => ({ code: String(x.code || '').slice(0, 10), label: String(x.label || '').slice(0, 40) }));
    const cats = (Array.isArray(req.categories) ? req.categories : []).slice(0, 60).map(x => String(x).slice(0, 40));
    const sys = 'You are the command parser of an attendance / expense / work-log app. The user speaks Hindi, English or Hinglish. ' +
      'Convert the user\'s sentence into actions. Today is ' + today + ' (' + new Date(today + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }) + '). ' +
      'Resolve words like aaj/today, kal/tomorrow, parso, beeta hua kal/yesterday into exact YYYY-MM-DD dates.\n' +
      'Attendance status codes (use ONLY these codes): ' + JSON.stringify(statuses) + '. Map words like present/hazir -> the code whose label means Present, chhutti/leave/absent likewise.\n' +
      'Expense categories (use ONLY one of these names, pick the closest): ' + JSON.stringify(cats) + '.\n' +
      'Reply with JSON only, shape: {"ops":[...],"say":"short reply in the user\'s language, only when ops is empty or something is unclear"}. Each op is one of:\n' +
      '{"type":"attendance","dates":["YYYY-MM-DD",...],"code":"<status code>"}  (expand ranges like "15 se 18 tak" into every date, max 31)\n' +
      '{"type":"expense","date":"YYYY-MM-DD","amount":<number>,"category":"<category>","note":"<short note>"}\n' +
      '{"type":"work","date":"YYYY-MM-DD","name":"","product":"","number":"","sticker":"","desc":"<what was done>"}\n' +
      'Never invent actions the user did not ask for. If the request is not about attendance, expense or work, return {"ops":[],"say":"..."}.';
    const GL = 'https://generativelanguage.googleapis.com/v1beta/';
    const callModel = async model => {
      const gen = { responseMimeType: 'application/json', temperature: 0 };
      if (/2\.5-flash/.test(model)) gen.thinkingConfig = { thinkingBudget: 0 };
      const r = await fetch(GL + 'models/' + encodeURIComponent(model) + ':generateContent', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: sys }] }, contents: [{ role: 'user', parts: [{ text }] }], generationConfig: gen }) });
      return { r, j: await r.json().catch(() => ({})) };
    };
    const listModels = async () => {                   // models this key can really use, best first
      const r = await fetch(GL + 'models?pageSize=100', { headers: { 'x-goog-api-key': env.GEMINI_API_KEY } });
      const l = ((await r.json().catch(() => ({}))).models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map(m => String(m.name).replace(/^models\//, '')).filter(n => /^gemini-/.test(n) && !/(embed|image|tts|live|audio|vision|robotics|computer|thinking|exp)/.test(n));
      const rank = n => (/flash/.test(n) ? 0 : 5) + (/lite/.test(n) ? 1 : 0) + (/preview/.test(n) ? 2 : 0) - (/latest/.test(n) ? 0.5 : 0);
      return l.sort((a, b) => rank(a) - rank(b));
    };
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const busy = st => st === 503 || st === 429 || st === 500 || st === 502 || st === 504;
    let j, res, listed = false;
    try {
      const queue = [...new Set([aiModel.name, env.GEMINI_MODEL, 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest', 'gemini-flash-lite-latest'].filter(Boolean))];
      let sawBusy = false;
      for (let round = 0; round < 2 && !(res && res.r.ok); round++) {
        for (let i = 0; i < queue.length && !(res && res.r.ok); i++) {
          res = await callModel(queue[i]);
          if (res.r.ok) { aiModel.name = queue[i]; break; }
          console.warn('Gemini', queue[i], res.r.status, JSON.stringify(res.j).slice(0, 200));
          if (busy(res.r.status)) { sawBusy = true; await sleep(400); }
          if (res.r.status === 404 && !listed) {          // names we guessed may be retired: ask Google what exists
            listed = true; (await listModels()).slice(0, 4).forEach(n => { if (!queue.includes(n)) queue.push(n); });
          }
        }
        if (!(res && res.r.ok) && round === 0 && sawBusy) await sleep(1500);
        else if (!sawBusy) break;
      }
      j = res.j;
      if (!res.r.ok) {
        const st = res.r.status, why = (j.error && j.error.message) ? ' - ' + String(j.error.message).slice(0, 120) : '';
        globalThis.fail_(busy(st) ? 'Google AI abhi bahut busy hai. 1-2 minute baad phir try karo.' : 'AI service error (' + st + ')' + why, 'AI');
      }
    } catch (e) { if (e.code === 'AI') throw e; globalThis.fail_('Could not reach the AI service.', 'AI'); }
    let out; try { out = JSON.parse(String(((((j.candidates || [])[0] || {}).content || {}).parts || [])[0].text || '{}').replace(/```json|```/g, '')); } catch (e) { out = {}; }
    const okCodes = new Set(statuses.map(x => x.code.toUpperCase()));
    const ops = [];
    (Array.isArray(out.ops) ? out.ops : []).slice(0, 10).forEach(o => {
      if (!o || typeof o !== 'object') return;
      if (o.type === 'attendance') {
        const code = String(o.code || '').toUpperCase(), dates = [...new Set((Array.isArray(o.dates) ? o.dates : []).map(isoDate).filter(Boolean))].slice(0, 31);
        if (okCodes.has(code) && dates.length) ops.push({ type: 'attendance', code, dates });
      } else if (o.type === 'expense') {
        const amount = Number(o.amount), date = isoDate(o.date) || today; if (!(amount > 0)) return;
        const want = String(o.category || '').trim().toLowerCase(), category = cats.find(c => c.toLowerCase() === want) || cats.find(c => want && c.toLowerCase().includes(want)) || cats[0] || '';
        if (category) ops.push({ type: 'expense', date, amount, category, note: String(o.note || '').slice(0, 300) });
      } else if (o.type === 'work') {
        const w = { type: 'work', date: isoDate(o.date) || today };
        ['name', 'product', 'number', 'sticker', 'desc'].forEach(k => w[k] = String(o[k] || '').slice(0, k === 'desc' ? 500 : 100));
        if (w.name || w.product || w.number || w.sticker || w.desc) ops.push(w);
      }
    });
    return { ok: true, ops, say: String(out.say || '').slice(0, 300) };
  }

  let chain = Promise.resolve();
  async function run(body) {
    if (!wb.loadedAt || Date.now() - wb.loadedAt > REFRESH) await wb.load();
    rt.delay = 0; rt.mails = []; rt.cal = [];
    let req, res;
    try { req = JSON.parse(body); res = BIO_ACTIONS.has(req.action) ? bioRoute(req) : globalThis.route_(req); }
    catch (err) { res = { ok: false, error: err.message || String(err), code: err.code || 'ERR' }; }
    if (req && req.action === 'logout') revoked.add(req.token);
    try { await wb.flush(); } catch (e) { res = { ok: false, error: 'Could not save to the sheet: ' + e.message, code: 'ERR' }; }
    if (rt.cal.length && !(res && res.ok === false)) {          // attach each user's (decrypted) refresh token, then sync in the background
      const P = globalThis.PropertiesService.getScriptProperties(), tk = {};
      const jobs = rt.cal.map(j => { if (!(j.uid in tk)) tk[j.uid] = dec(P.getProperty('CAL_TOK_' + j.uid) || ''); return Object.assign({}, j, { refresh: tk[j.uid] }); }).filter(j => j.refresh);
      if (jobs.length) calRun(jobs);
    }
    for (const m of rt.mails) {
      try { await sendMail(m, env); }
      catch (e) { res = { ok: false, error: 'Could not send the e-mail: ' + e.message }; }
    }
    if (rt.delay) await new Promise(r => setTimeout(r, Math.min(rt.delay, 1500)));
    return res;
  }
  const fastCall = body => {                           // call polling / AI parsing never wait behind slow sheet saves
    let r; try { r = JSON.parse(body); } catch (e) { return null; }
    if (!r || !(CALL_ACTIONS.has(r.action) || AI_ACTIONS.has(r.action))) return null;
    return Promise.resolve().then(() => AI_ACTIONS.has(r.action) ? aiRoute(r) : callRoute(r)).catch(err => ({ ok: false, error: err.message || String(err), code: err.code || 'ERR' }));
  };
  return { handle: body => fastCall(body) || (chain = chain.then(() => run(body), () => run(body))),
           oauth: q => (chain = chain.then(() => runOauth(q), () => runOauth(q)).catch(e => page(500, e.message))) };
}

async function sendMail(m, env) {
  if (!env.SMTP_USER || !env.SMTP_PASS) throw new Error('SMTP_USER / SMTP_PASS are not set on the server.');
  const nodemailer = require('nodemailer');
  const t = nodemailer.createTransport({ service: 'gmail', auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } });
  await t.sendMail({ from: '"' + (m.name || 'Attendance App') + '" <' + env.SMTP_USER + '>', to: m.to, subject: m.subject, text: m.body });
}

function start(app, env) {
  const origin = env.ALLOWED_ORIGIN || '*';
  const cors = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
  return http.createServer((rq, rs) => {
    const send = (code, obj) => { rs.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, cors)); rs.end(JSON.stringify(obj)); };
    if (rq.method === 'OPTIONS') { rs.writeHead(204, cors); return rs.end(); }
    if (rq.method === 'GET' && rq.url.startsWith('/oauth/google/callback') && app.oauth) {
      const q = Object.fromEntries(new URL(rq.url, 'http://x').searchParams);
      return app.oauth(q).then(o => { rs.writeHead(o.code, { 'Content-Type': 'text/html; charset=utf-8' }); rs.end(o.html); });
    }
    if (rq.method === 'GET') return send(200, { ok: true, app: 'Attendance & Expense Tracker API', time: new Date().toISOString() });
    let body = '';
    rq.on('data', c => { body += c; if (body.length > 2e6) rq.destroy(); });
    rq.on('end', async () => send(200, await app.handle(body)));
  });
}
module.exports = { makeApp, start };

if (require.main === module) {
  const env = process.env;
  let email = env.GOOGLE_CLIENT_EMAIL, key = env.GOOGLE_PRIVATE_KEY;
  if (env.GOOGLE_SERVICE_ACCOUNT_JSON) { const j = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON); email = j.client_email; key = j.private_key; }
  if (!email || !key || !env.SHEET_ID) { console.error('Set GOOGLE_SERVICE_ACCOUNT_JSON and SHEET_ID.'); process.exit(1); }
  const { GoogleStore } = require('./google-store');
  const app = makeApp(new GoogleStore({ email, key, sheetId: env.SHEET_ID }), Object.assign({}, env, { GOOGLE_PRIVATE_KEY: key }));
  start(app, env).listen(env.PORT || 3000, () => console.log('API running on port ' + (env.PORT || 3000)));
}
