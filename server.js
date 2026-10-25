'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { Readable } = require('stream');
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
    const wasRinging = c.state === 'ringing';
    c.state = 'ended'; c.endedBy = by; c.reason = reason; c.endAt = Date.now();
    if (wasRinging && (reason === 'missed' || reason === 'cancelled'))        // nobody picked up: leave a "missed call" on the phone
      pushToUser(c.to, { title: '📵 Missed ' + (c.kind === 'video' ? 'video' : 'voice') + ' call', body: 'from ' + c.fromName, tag: 'call', url: './?go=chat', kind: 'missed', ts: Date.now() }, { ttl: 3600 });
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
      if (!peer || !peer.active || !peer.username || !globalThis.chatCanSee_(uid, to)) globalThis.fail_('That user was not found.', 'CALL');
      if (vbusy.has(uid)) globalThis.fail_('You are already in a call.', 'BUSY');
      if (vbusy.has(to)) globalThis.fail_((peer.name || peer.username) + ' is busy on another call.', 'BUSY');
      const me = globalThis.getAccount_(uid, S0), id = crypto.randomBytes(9).toString('hex');
      const c = { id, from: uid, to, fromName: (me && (me.name || me.username)) || 'Someone', kind, offer: vcSdp(req.offer), answer: null,
        state: 'ringing', t0: now, seen: { from: now, to: now }, endedBy: '', reason: '', endAt: 0 };
      vcalls.set(id, c); vbusy.set(uid, id); vbusy.set(to, id);
      pushToUser(to, { title: kind === 'video' ? '📹 Incoming video call' : '📞 Incoming voice call', body: c.fromName + ' is calling you', tag: 'call', url: './?go=chat', kind: 'call', callId: id, ts: now }, { ttl: 45, urgency: 'high' });   // rings even if the app is closed
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


  // ---------- Ludo (2 to 4 players, kept in memory, the server is the referee: dice + rules run here) ----------
  // One-to-one: invite a single user. Group chat: the invite goes to EVERY member of the group; whoever accepts joins (max 4).
  // The host can start as soon as 2 people are in; the game also starts by itself when everybody has answered / the lobby is full / 90 s pass.
  const LUDO_ACTIONS = new Set(['ludoInvite', 'ludoPoll', 'ludoAccept', 'ludoStart', 'ludoRoll', 'ludoMove', 'ludoLeave']);
  const lgames = new Map(), lbusy = new Map();          // gameId -> game ; userId -> gameId
  const LU_SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);   // star + start squares (no capture)
  const LU_MAX = 4, LU_LOBBY_MS = 90000;
  const luColorsFor = n => n === 2 ? [0, 2] : [0, 1, 2, 3].slice(0, n);   // 2 players sit in opposite corners
  const luAbs = (ci, pos) => (13 * ci + pos) % 52;
  function luMovable(g, pi) {
    const out = [];
    if (!g.roll) return out;
    g.tokens[pi].forEach((pos, t) => {
      if (pos === 56) return;
      if (pos === -1 ? g.roll === 6 : pos + g.roll <= 56) out.push(t);
    });
    return out;
  }
  const luAlive = g => g.players.map((p, i) => i).filter(i => !g.out[i]);
  function luFinish(g, reason, winner) {
    if (g.state === 'over') return;
    g.state = 'over'; g.reason = reason; g.endAt = Date.now(); if (winner !== undefined) g.winner = winner;
    for (const id of g.all) if (lbusy.get(id) === g.id) lbusy.delete(id);
  }
  function luNote(g, text) { g.ev++; g.msg = text; }
  function luPass(g) {                                   // next player who is still in the game
    const n = g.players.length; let t = g.turn;
    for (let i = 0; i < n; i++) { t = (t + 1) % n; if (!g.out[t]) break; }
    g.turn = t; g.roll = 0; g.sixes = 0;
  }
  function luStartGame(g) {
    for (const p of g.pending) if (lbusy.get(p.id) === g.id) lbusy.delete(p.id);   // late / silent invitees are dropped
    g.pending = [];
    const n = g.players.length, now = Date.now();
    g.colors = luColorsFor(n); g.tokens = g.players.map(() => [-1, -1, -1, -1]); g.out = g.players.map(() => false);
    g.seen = g.players.map(() => now); g.turn = 0; g.roll = 0; g.sixes = 0; g.state = 'playing';
    luNote(g, g.players[0].name + ' starts');
  }
  function luInviteCheck(g) {                            // called after somebody accepted / declined / left the lobby
    if (g.state !== 'invite') return;
    if (g.players.length >= LU_MAX) return luStartGame(g);
    if (!g.pending.length) { if (g.players.length >= 2) luStartGame(g); else luFinish(g, 'declined'); }
  }
  function luDrop(g, pi, reason) {                       // a player leaves (or goes offline) during the game
    if (g.state !== 'playing' || g.out[pi]) return;
    g.out[pi] = true; if (lbusy.get(g.players[pi].id) === g.id) lbusy.delete(g.players[pi].id);
    const alive = luAlive(g);
    if (alive.length <= 1) { luFinish(g, reason, alive.length ? alive[0] : -1); return; }
    luNote(g, g.players[pi].name + ' left the game');
    if (g.turn === pi) luPass(g);
  }
  function luSweep() {
    const now = Date.now();
    for (const g of lgames.values()) {
      if (g.state === 'invite' && now - g.t0 > LU_LOBBY_MS) { if (g.players.length >= 2) luStartGame(g); else luFinish(g, 'noanswer'); }
      else if (g.state === 'playing') {
        g.players.forEach((p, i) => { if (!g.out[i] && now - g.seen[i] > 120000) luDrop(g, i, 'left'); });
      } else if (g.state === 'over' && now - g.endAt > 60000) lgames.delete(g.id);
    }
  }
  function luView(g, uid) {
    const me = g.players.findIndex(p => p.id === uid);
    return { id: g.id, state: g.state, players: g.players.map(p => ({ id: p.id, name: p.name })), pend: g.pending.map(p => p.name), host: me === 0,
      group: g.group ? g.group.name : '', me, colors: g.colors || luColorsFor(Math.max(2, g.players.length)), out: g.out || [],
      tokens: g.tokens || [], turn: g.turn, roll: g.roll, movable: g.state === 'playing' && g.turn === me ? luMovable(g, me) : [],
      winner: g.winner, reason: g.reason, ev: g.ev, msg: g.msg, last: g.last, left: Math.max(0, Math.ceil((LU_LOBBY_MS - (Date.now() - g.t0)) / 1000)) };
  }
  const luGone = { ok: true, game: { state: 'over', reason: 'gone', me: -1, players: [], tokens: [], movable: [], pend: [], out: [] } };
  async function ludoRoute(req) {
    const uid = globalThis.checkToken_(req.token); if (!uid) globalThis.fail_('Session expired. Please log in again.', 'AUTH');
    luSweep(); const a = req.action, now = Date.now();
    if (a === 'ludoInvite') {
      if (lbusy.has(uid)) globalThis.fail_('You are already in a Ludo game.', 'LUDO');
      const S0 = globalThis.readSettings_().values, me = globalThis.getAccount_(uid, S0);
      let invitees = [], group = null;
      if (req.group) {                                   // group chat: everybody in the group
        const gi = globalThis.chatGroupMembers_(String(req.group), uid);
        if (!gi) globalThis.fail_('Group not found.', 'LUDO');
        group = { id: gi.id, name: gi.name }; invitees = gi.members.filter(m => m.id !== uid);
        if (!invitees.length) globalThis.fail_('There is nobody else in this group.', 'LUDO');
      } else {                                           // one-to-one chat
        const to = String(req.to || ''), peer = to && to !== uid ? globalThis.getAccount_(to, S0) : null;
        if (!peer || !peer.active || !peer.username || !globalThis.chatCanSee_(uid, to)) globalThis.fail_('That user was not found.', 'LUDO');
        invitees = [{ id: to, name: peer.name || peer.username }];
      }
      const free = invitees.filter(m => !lbusy.has(m.id));
      if (!free.length) globalThis.fail_(invitees.length === 1 ? invitees[0].name + ' is busy in another Ludo game.' : 'Everybody in this group is busy in another Ludo game.', 'LUDO');
      const id = crypto.randomBytes(8).toString('hex');
      const g = { id, state: 'invite', group, players: [{ id: uid, name: (me && (me.name || me.username)) || 'Someone' }], pending: free.map(m => ({ id: m.id, name: m.name })),
        all: new Set([uid, ...free.map(m => m.id)]), colors: null, tokens: null, out: null, turn: 0, roll: 0, sixes: 0, winner: -1, reason: '', ev: 0, msg: '', last: null,
        t0: now, seen: [now], endAt: 0 };
      lgames.set(id, g); for (const x of g.all) lbusy.set(x, id);
      return { ok: true, id, invited: free.length, skipped: invitees.length - free.length };
    }
    if (a === 'ludoPoll') {
      if (req.gid) {
        const g = lgames.get(String(req.gid)); if (!g) return luGone;
        const pi = g.players.findIndex(p => p.id === uid); if (pi < 0) return luGone;
        if (g.seen) g.seen[pi] = now; return { ok: true, game: luView(g, uid) };
      }
      const cur = lgames.get(lbusy.get(uid) || '');
      if (cur && cur.state === 'invite' && cur.pending.some(p => p.id === uid))
        return { ok: true, incoming: { id: cur.id, fromName: cur.players[0].name, group: cur.group ? cur.group.name : '', total: cur.players.length + cur.pending.length } };
      return { ok: true, incoming: null };
    }
    const g = lgames.get(String(req.gid || ''));
    const pi = g ? g.players.findIndex(p => p.id === uid) : -1, pj = g ? g.pending.findIndex(p => p.id === uid) : -1;
    if (!g || (pi < 0 && pj < 0)) globalThis.fail_('This game has ended.', 'LUDO');
    if (a === 'ludoLeave') {
      if (g.state === 'invite') {
        if (pi === 0) luFinish(g, 'cancelled');
        else {
          if (pj >= 0) g.pending.splice(pj, 1); else g.players.splice(pi, 1);
          if (lbusy.get(uid) === g.id) lbusy.delete(uid);
          luInviteCheck(g);
        }
      } else if (g.state === 'playing' && pi >= 0) luDrop(g, pi, 'resigned');
      return { ok: true };
    }
    if (a === 'ludoAccept') {
      if (g.state !== 'invite' || pj < 0) globalThis.fail_('This invite is no longer open.', 'LUDO');
      const p = g.pending.splice(pj, 1)[0];
      if (g.players.length >= LU_MAX) { if (lbusy.get(uid) === g.id) lbusy.delete(uid); globalThis.fail_('This game is already full (4 players).', 'LUDO'); }
      g.players.push(p); luNote(g, p.name + ' joined'); luInviteCheck(g);
      return { ok: true };
    }
    if (a === 'ludoStart') {
      if (g.state !== 'invite' || pi !== 0) globalThis.fail_('Only the person who invited can start the game.', 'LUDO');
      if (g.players.length < 2) globalThis.fail_('Wait until at least one person joins.', 'LUDO');
      luStartGame(g); return { ok: true };
    }
    if (g.state !== 'playing' || pi < 0 || g.turn !== pi || g.out[pi]) globalThis.fail_('It is not your turn.', 'LUDO');
    if (a === 'ludoRoll') {
      if (g.roll) globalThis.fail_('Move a token first.', 'LUDO');
      const r = 1 + crypto.randomInt(6); g.last = { by: pi, v: r };
      if (r === 6 && g.sixes === 2) { luPass(g); luNote(g, 'Three sixes in a row - turn lost'); return { ok: true }; }
      g.roll = r; g.sixes = r === 6 ? g.sixes + 1 : 0;
      if (!luMovable(g, pi).length) { luPass(g); luNote(g, 'Rolled ' + r + ' - no move'); }
      else luNote(g, 'Rolled ' + r);
      return { ok: true };
    }
    if (a === 'ludoMove') {
      const t = Number(req.token_i), mv = luMovable(g, pi);
      if (!mv.includes(t)) globalThis.fail_('That token cannot move.', 'LUDO');
      const ci = g.colors[pi], roll = g.roll, from = g.tokens[pi][t];
      const to = from === -1 ? 0 : from + roll; g.tokens[pi][t] = to;
      let extra = roll === 6, text = 'Moved';
      if (to <= 50) {
        const ab = luAbs(ci, to);
        if (!LU_SAFE.has(ab)) {
          g.players.forEach((_, opp) => {
            if (opp === pi || g.out[opp]) return;
            const oc = g.colors[opp];
            g.tokens[opp].forEach((op, k) => { if (op >= 0 && op <= 50 && luAbs(oc, op) === ab) { g.tokens[opp][k] = -1; extra = true; text = 'Captured a token!'; } });
          });
        }
      } else if (to === 56) { extra = true; text = 'Token reached home!'; }
      g.roll = 0;
      if (g.tokens[pi].every(x => x === 56)) { luFinish(g, 'won', pi); luNote(g, g.players[pi].name + ' wins!'); return { ok: true }; }
      if (!extra) luPass(g);
      luNote(g, text); return { ok: true };
    }
  }

  // ---------- Deploy tab (main admin only): publish updated files to GitHub; Render auto-deploys from the branch ----------
  // Needs env vars on Render:  GITHUB_TOKEN (fine-grained token, Contents: read & write on ONE repo), GITHUB_REPO ("owner/name"), optional GITHUB_BRANCH (default main).
  const DEPLOY_ACTIONS = new Set(['deployStatus', 'deployFiles', 'deployUpload', 'deployHistory', 'deployRestore', 'deployProgress']);
  const GH = { repo: String(env.GITHUB_REPO || '').trim(), branch: String(env.GITHUB_BRANCH || 'main').trim(), token: String(env.GITHUB_TOKEN || '').trim() };
  const DEP_EXT = /\.(js|css|html|md|json|gs|txt|svg)$/i;
  const DEP_BACKEND = /^(server\.js|code\.gs|package\.json|google-store\.js|gas-shim\.js)$/i;   // changing these changes the server itself
  const DEP_MAX = 900 * 1024, DEP_TOTAL = 1500 * 1024;
  const depBase = p => String(p).split('/').pop();
  function depPathOk(p) {
    p = String(p || '');
    return p.length > 0 && p.length < 200 && /^[\w.\- \/]+$/.test(p) && !p.startsWith('/') && !p.includes('..') && !p.includes('//')
      && p.split('/').every(s => s && !s.startsWith('.') && s !== 'node_modules') && DEP_EXT.test(p);
  }
  async function gh(method, url, body) {
    const r = await fetch('https://api.github.com/repos/' + GH.repo + url, { method,
      headers: { Authorization: 'Bearer ' + GH.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'attendance-app-deploy', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const why = r.status === 401 ? 'GitHub rejected the token (expired or wrong). Make a new token and update GITHUB_TOKEN on Render.'
        : r.status === 404 ? 'GitHub could not find the repository, branch or file. Check GITHUB_REPO / GITHUB_BRANCH and that the token has access to that repository.'
        : r.status === 403 ? 'GitHub refused (the token needs "Contents: Read and write" permission, or the rate limit was hit).'
        : r.status === 422 ? 'GitHub could not save this change (' + (j.message || 'conflict') + '). Refresh the list and try again.'
        : 'GitHub error ' + r.status + ': ' + (j.message || '');
      globalThis.fail_(why, 'GITHUB');
    }
    return j;
  }
  const ghPath = p => p.split('/').map(encodeURIComponent).join('/');
  const gitBlobSha = text => crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob ' + Buffer.byteLength(text) + '\0'), Buffer.from(text, 'utf8')])).digest('hex');
  function depCheckSyntax(path, text) {
    try {
      if (/\.(js|gs)$/i.test(path)) new vm.Script(text.replace(/^#!.*/, ''), { filename: path });
      else if (/\.json$/i.test(path)) JSON.parse(text);
    } catch (e) { globalThis.fail_('"' + path + '" has an error and was NOT published: ' + e.message, 'SYNTAX'); }
  }
  const depCommits = list => (Array.isArray(list) ? list : []).map(c => ({ sha: c.sha, short: String(c.sha).slice(0, 7), msg: String((c.commit && c.commit.message) || '').split('\n')[0],
    by: c.commit && c.commit.author ? c.commit.author.name : '', at: c.commit && c.commit.author ? c.commit.author.date : '' }));
  // ONE commit for all the files (so Render redeploys once, with a consistent set of files)
  async function depCommit(files, message) {
    const br = encodeURIComponent(GH.branch);
    const ref = await gh('GET', '/git/ref/heads/' + br), head = ref.object.sha;
    const hc = await gh('GET', '/git/commits/' + head);
    const tree = await gh('GET', '/git/trees/' + hc.tree.sha + '?recursive=1');
    const cur = new Map((tree.tree || []).filter(x => x.type === 'blob').map(x => [x.path, x.sha]));
    const changed = files.filter(f => cur.get(f.path) !== gitBlobSha(f.content));
    const skipped = files.filter(f => !changed.includes(f)).map(f => f.path);
    if (!changed.length) return { unchanged: true, skipped };
    const nt = await gh('POST', '/git/trees', { base_tree: hc.tree.sha, tree: changed.map(f => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })) });
    const nc = await gh('POST', '/git/commits', { message, tree: nt.sha, parents: [head] });
    await gh('PATCH', '/git/refs/heads/' + br, { sha: nc.sha });
    return { sha: String(nc.sha).slice(0, 7), url: nc.html_url, changed: changed.map(f => ({ path: f.path, isNew: !cur.has(f.path) })), skipped };
  }
  async function deployRoute(req) {
    const uid = globalThis.checkToken_(req.token);
    if (!uid) globalThis.fail_('Session expired. Please log in again.', 'AUTH');
    if (uid !== 'ADMIN') globalThis.fail_('Only the main admin can use Deploy.', 'PERM');
    const a = req.action, ready = !!(GH.repo && GH.token);
    if (a === 'deployStatus') return { ok: true, configured: ready, repo: GH.repo, branch: GH.branch };
    if (!ready) globalThis.fail_('GitHub is not connected yet. Add GITHUB_TOKEN and GITHUB_REPO on Render first.', 'NOGH');
    const S0 = globalThis.readSettings_().values, acc = globalThis.getAccount_('ADMIN', S0) || {};
    const ctx = { uid: 'ADMIN', username: acc.username || 'admin', name: acc.name || '' };
    if (a === 'deployFiles') {
      const t = await gh('GET', '/git/trees/' + encodeURIComponent(GH.branch) + '?recursive=1');
      const files = (t.tree || []).filter(x => x.type === 'blob' && depPathOk(x.path)).map(x => ({ path: x.path, size: x.size || 0 }));
      const cm = await gh('GET', '/commits?sha=' + encodeURIComponent(GH.branch) + '&per_page=15');
      return { ok: true, files, commits: depCommits(cm) };
    }
    if (a === 'deployProgress') {                 // the same "x/3" checks GitHub shows next to a commit (Render's deploy is one of them)
      const c = await gh('GET', '/commits/' + encodeURIComponent(GH.branch));
      const items = []; let limited = false;
      try {
        const st = await gh('GET', '/commits/' + c.sha + '/status');
        (st.statuses || []).forEach(x => items.push({ name: String(x.context || 'Status'), state: x.state === 'success' ? 'ok' : x.state === 'pending' ? 'wait' : 'bad' }));
      } catch (e) { if (e.code === 'GITHUB') limited = true; else throw e; }
      try {
        const ck = await gh('GET', '/commits/' + c.sha + '/check-runs?per_page=50');
        (ck.check_runs || []).forEach(x => items.push({ name: String(x.name || 'Check'),
          state: x.status !== 'completed' ? 'wait' : (['success', 'neutral', 'skipped'].includes(x.conclusion) ? 'ok' : 'bad') }));
      } catch (e) { if (e.code === 'GITHUB') limited = true; else throw e; }
      const done = items.filter(x => x.state === 'ok').length, bad = items.some(x => x.state === 'bad');
      return { ok: true, sha: c.sha, short: String(c.sha).slice(0, 7), msg: String((c.commit && c.commit.message) || '').split('\n')[0],
        at: c.commit && c.commit.author ? c.commit.author.date : '', total: items.length, done, items, limited,
        state: bad ? 'failure' : (items.length && done === items.length ? 'success' : 'pending') };
    }
    if (a === 'deployHistory') {
      const path = String(req.path || ''); if (!depPathOk(path)) globalThis.fail_('Invalid file.', 'DEPLOY');
      return { ok: true, commits: depCommits(await gh('GET', '/commits?sha=' + encodeURIComponent(GH.branch) + '&path=' + encodeURIComponent(path) + '&per_page=15')) };
    }
    if (a === 'deployUpload') {
      const files = Array.isArray(req.files) ? req.files : [];
      if (!files.length || files.length > 20) globalThis.fail_('Choose between 1 and 20 files.', 'DEPLOY');
      let total = 0; const seen = new Set();
      for (const f of files) {
        if (!f || !depPathOk(f.path) || typeof f.content !== 'string' || !f.content.length) globalThis.fail_('"' + (f && f.path) + '" is not an allowed file (allowed: js, css, html, md, json, gs, txt, svg).', 'DEPLOY');
        if (seen.has(f.path)) globalThis.fail_('"' + f.path + '" was chosen twice.', 'DEPLOY'); seen.add(f.path);
        const n = Buffer.byteLength(f.content); total += n;
        if (n > DEP_MAX || total > DEP_TOTAL) globalThis.fail_('The files are too big for one upload.', 'DEPLOY');
        depCheckSyntax(f.path, f.content);
      }
      if (files.some(f => DEP_BACKEND.test(depBase(f.path))) && req.confirmBackend !== true) globalThis.fail_('Confirm that you are changing the server itself.', 'CONFIRM');
      const msg = String(req.message || '').trim().slice(0, 120) || ('Update ' + files.map(f => depBase(f.path)).join(', ') + ' (from the app)');
      const r = await depCommit(files.map(f => ({ path: f.path, content: f.content })), msg);
      if (!r.unchanged) globalThis.logActivity_('deployUpload', ctx, { path: r.changed.map(x => x.path).join(', ') });
      return Object.assign({ ok: true }, r);
    }
    if (a === 'deployRestore') {
      const path = String(req.path || ''), sha = String(req.sha || '');
      if (!depPathOk(path) || !/^[0-9a-f]{7,40}$/.test(sha)) globalThis.fail_('Invalid request.', 'DEPLOY');
      if (DEP_BACKEND.test(depBase(path)) && req.confirmBackend !== true) globalThis.fail_('Confirm that you are changing the server itself.', 'CONFIRM');
      const old = await gh('GET', '/contents/' + ghPath(path) + '?ref=' + sha);
      if (!old || !old.content) globalThis.fail_('Could not read that version.', 'DEPLOY');
      const text = Buffer.from(old.content, 'base64').toString('utf8');
      const r = await depCommit([{ path, content: text }], 'Restore ' + depBase(path) + ' to ' + sha.slice(0, 7) + ' (from the app)');
      if (!r.unchanged) globalThis.logActivity_('deployRestore', ctx, { path });
      return Object.assign({ ok: true }, r);
    }
  }

  // ---------- Updates tab: the main admin uploads app-update files, every signed-in user can download them ----------
  // The files are stored in the GitHub repository on a SEPARATE branch (default "app-updates"), so uploading never makes Render redeploy.
  // The list (title, version, notes, file name ...) is kept in the sheet's "_App Properties" tab. Uses the same GITHUB_TOKEN / GITHUB_REPO as Deploy.
  const UPD_ACTIONS = new Set(['updList', 'updEdit', 'updDelete', 'updTicket']);
  const UPD_MAX = 40 * 1024 * 1024;                                  // biggest file (40 MB)
  const UPD_BRANCH = String(env.UPDATES_BRANCH || 'app-updates').trim();
  const UPD_KEY = 'APP_UPDATES';
  const updReady = () => !!(GH.repo && GH.token);
  const updRead = () => { try { const a = JSON.parse(globalThis.PropertiesService.getScriptProperties().getProperty(UPD_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
  const updFits = list => JSON.stringify(list).length <= 45000;       // one sheet cell holds 50,000 characters
  const updWrite = list => { if (!updFits(list)) globalThis.fail_('Too many updates are saved. Delete some old ones first.', 'UPD'); globalThis.PropertiesService.getScriptProperties().setProperty(UPD_KEY, JSON.stringify(list)); };
  const updClean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n);
  const updName = n => String(n || 'update').split(/[\\\/]/).pop().replace(/[^\w.\- ()]/g, '_').replace(/^\.+/, '').trim().slice(-100) || 'update';
  const updView = u => ({ id: u.id, title: u.title, version: u.version || '', notes: u.notes || '', name: u.name, size: u.size || 0, at: u.at });
  function updWho(token) {                                            // any valid, active user
    const uid = globalThis.checkToken_(token); if (!uid) globalThis.fail_('Session expired. Please log in again.', 'AUTH');
    const acc = globalThis.getAccount_(uid, globalThis.readSettings_().values);
    if (!acc || !acc.active) globalThis.fail_('This account is disabled. Please contact the admin.', 'DISABLED');
    if (globalThis.payExpired_(acc.payDue)) globalThis.fail_('Payment pending. Please pay to continue using this account.', 'PAYDUE');
    return uid;
  }
  const updAdmin = token => { const uid = updWho(token); if (uid !== 'ADMIN') globalThis.fail_('Only the main admin can change updates.', 'PERM'); return uid; };
  const updTicketSig = (id, exp) => sign('upd:' + id + '|' + exp);
  let updBranchOk = false;
  async function updEnsureBranch() {                                   // create the storage branch from the main branch the first time
    if (updBranchOk) return;
    try { await gh('GET', '/git/ref/heads/' + encodeURIComponent(UPD_BRANCH)); }
    catch (e) {
      if (e.code !== 'GITHUB') throw e;
      const base = await gh('GET', '/git/ref/heads/' + encodeURIComponent(GH.branch));
      await gh('POST', '/git/refs', { ref: 'refs/heads/' + UPD_BRANCH, sha: base.object.sha });
    }
    updBranchOk = true;
  }
  async function updRoute(req) {                                       // runs inside the normal request queue
    const a = req.action;
    if (a === 'updList') { updWho(req.token); return { ok: true, items: updRead().map(updView), canManage: globalThis.checkToken_(req.token) === 'ADMIN', ready: updReady(), max: UPD_MAX }; }
    if (a === 'updTicket') {                                           // short-lived download pass (2 minutes), so the session token never goes in a link
      updWho(req.token);
      const u = updRead().find(x => x.id === String(req.id || '')); if (!u) globalThis.fail_('This update was removed.', 'UPD');
      const exp = Date.now() + 120000;
      return { ok: true, ticket: exp + '.' + updTicketSig(u.id, exp) };
    }
    updAdmin(req.token);
    const list = updRead(), i = list.findIndex(x => x.id === String(req.id || '')), u = list[i];
    if (!u) globalThis.fail_('This update was not found. Refresh the list.', 'UPD');
    if (a === 'updEdit') {
      const title = updClean(req.title, 120); if (!title) globalThis.fail_('Please enter a title.', 'UPD');
      u.title = title; u.version = updClean(req.version, 40); u.notes = updClean(req.notes, 600);
      updWrite(list); return { ok: true, items: list.map(updView) };
    }
    if (a === 'updDelete') {
      if (updReady()) {
        try { await gh('DELETE', '/contents/' + ghPath(u.path), { message: 'Remove update: ' + u.name, sha: u.sha, branch: UPD_BRANCH }); }
        catch (e) { if (!(e.code === 'GITHUB' && /could not find/i.test(e.message))) throw e; }      // already gone on GitHub = fine
      }
      list.splice(i, 1); updWrite(list); return { ok: true, items: list.map(updView) };
    }
  }
  // Upload: the big GitHub transfer runs OUTSIDE the request queue, so chat / attendance never wait for it.
  async function updUpload(token, q, buf) {
    await withWb(() => {
      updAdmin(token);
      if (!updReady()) globalThis.fail_('GitHub is not connected yet. Add GITHUB_TOKEN and GITHUB_REPO on Render first.', 'NOGH');
      if (!buf.length) globalThis.fail_('The file is empty.', 'UPD');
      if (buf.length > UPD_MAX) globalThis.fail_('The file is too big (max ' + (UPD_MAX / 1048576) + ' MB).', 'UPD');
      const probe = updRead(); probe.unshift({ id: '0'.repeat(10), title: updClean(q.title, 120), version: updClean(q.version, 40), notes: updClean(q.notes, 600), name: updName(q.name), size: buf.length, at: new Date().toISOString(), path: 'updates/' + '0'.repeat(10) + '/' + updName(q.name), sha: '0'.repeat(40) });
      if (!updFits(probe)) globalThis.fail_('Too many updates are saved. Delete some old ones first.', 'UPD');
    });
    const name = updName(q.name), title = updClean(q.title, 120) || name, id = crypto.randomBytes(5).toString('hex'), path = 'updates/' + id + '/' + name;
    await updEnsureBranch();
    const put = await gh('PUT', '/contents/' + ghPath(path), { message: 'Add update: ' + title.slice(0, 80), content: buf.toString('base64'), branch: UPD_BRANCH });
    const item = { id, title, version: updClean(q.version, 40), notes: updClean(q.notes, 600), name, size: buf.length, at: new Date().toISOString(), path, sha: put.content.sha };
    try { return await withWb(() => { const list = updRead(); list.unshift(item); updWrite(list); return { ok: true, items: list.map(updView) }; }); }
    catch (e) { try { await gh('DELETE', '/contents/' + ghPath(path), { message: 'Undo failed upload', sha: item.sha, branch: UPD_BRANCH }); } catch (x) {} throw e; }
  }
  // Download: check the pass, then stream the file from GitHub straight to the user (never kept in memory).
  async function updOpen(q) {
    const id = String(q.id || ''), [exp, sig] = String(q.k || '').split('.'), good = updTicketSig(id, exp);
    if (!sig || sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good)) || !(Number(exp) > Date.now()))
      return { code: 403, error: 'This download link expired. Go back to the app and tap Download again.' };
    const u = await withWb(() => updRead().find(x => x.id === id));
    if (!u) return { code: 404, error: 'This update was removed.' };
    if (!updReady()) return { code: 503, error: 'GitHub is not connected on the server.' };
    const r = await fetch('https://api.github.com/repos/' + GH.repo + '/contents/' + ghPath(u.path) + '?ref=' + encodeURIComponent(UPD_BRANCH),
      { headers: { Authorization: 'Bearer ' + GH.token, Accept: 'application/vnd.github.raw+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'attendance-app-deploy' } });
    if (!r.ok || !r.body) return { code: 502, error: 'GitHub could not give this file (error ' + r.status + ').' };
    return { code: 200, u, body: r.body };
  }

  // ---------- Push notifications (Web Push / VAPID): calls, payment + attendance reminders ----------
  // They reach the phone even when the app is closed. Each device's subscription is kept in the sheet's _App Properties tab
  // (key PUSH_<userId>), so a Render restart loses nothing. Needs the "web-push" npm package (see package.json).
  const PUSH_ACTIONS = new Set(['pushKey', 'pushSubscribe', 'pushOff', 'pushTest', 'pushPrefs']);
  let WP = null; try { WP = require('web-push'); } catch (e) { console.warn('Push: the "web-push" package is missing - run npm install. Notifications are off.'); }
  const PUSH_ATT_HOUR = Number(env.PUSH_ATT_HOUR || 12), PUSH_ATT_END = Number(env.PUSH_ATT_END_HOUR || 19);   // remind from 12:00 until 19:00
  const PUSH_ATT_EVERY = Number(env.PUSH_ATT_REPEAT_MIN || 120) * 60000;                                       // ... again every 2 hours while still not marked
  const PUSH_PAY_HOUR = Number(env.PUSH_PAY_HOUR || 10);                                                        // payment reminders go out at 10:00
  const pushProps = () => globalThis.PropertiesService.getScriptProperties();
  let vapid = null;
  function pushVapid(create) {          // keys: env VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY, else made once and saved in the sheet
    if (vapid) return vapid;
    if (!WP) return null;
    let pub = env.VAPID_PUBLIC_KEY || '', priv = env.VAPID_PRIVATE_KEY || '';
    if (!pub || !priv) {
      const P = pushProps(); pub = P.getProperty('VAPID_PUB') || ''; priv = P.getProperty('VAPID_PRIV') || '';
      if (!pub || !priv) {
        if (!create) return null;       // keys are only ever created inside the request queue (never from the call fast-path)
        const k = crypto.createECDH('prime256v1'); k.generateKeys();
        const pad = b => (b.length >= 32 ? b : Buffer.concat([Buffer.alloc(32 - b.length), b]));
        pub = k.getPublicKey().toString('base64url'); priv = pad(k.getPrivateKey()).toString('base64url');
        P.setProperty('VAPID_PUB', pub); P.setProperty('VAPID_PRIV', priv);
      }
    }
    WP.setVapidDetails(env.VAPID_SUBJECT || (publicUrl.startsWith('https://') ? publicUrl : 'mailto:' + (env.SMTP_USER || 'admin@example.com')), pub, priv);
    vapid = { pub, priv }; return vapid;
  }
  const pushBlank = () => ({ s: [], att: true, pay: true });
  const pushRead = uid => { try { const o = JSON.parse(pushProps().getProperty('PUSH_' + uid) || 'null'); return o && Array.isArray(o.s) ? Object.assign(pushBlank(), o) : pushBlank(); } catch (e) { return pushBlank(); } };
  const pushWrite = (uid, o) => pushProps().setProperty('PUSH_' + uid, JSON.stringify(o));
  async function pushToUser(uid, payload, opt) {        // never throws; resolves to the number of phones reached
    try {
      if (!WP || !pushVapid(false)) return 0;
      const rec = pushRead(uid); if (!rec.s.length) return 0;
      const body = JSON.stringify(payload), dead = []; let sent = 0;
      await Promise.all(rec.s.map(async s => {
        try { await WP.sendNotification({ endpoint: s.e, keys: s.k }, body, { TTL: (opt && opt.ttl) || 3600, urgency: (opt && opt.urgency) || 'normal' }); sent++; }
        catch (e) { if (e.statusCode === 404 || e.statusCode === 410) dead.push(s.e); else console.warn('Push failed:', e.statusCode || e.message); }
      }));
      if (dead.length) withWb(() => { const r = pushRead(uid); r.s = r.s.filter(x => !dead.includes(x.e)); pushWrite(uid, r); }).catch(() => {});   // phone uninstalled / revoked
      return sent;
    } catch (e) { console.warn('Push error:', e.message); return 0; }
  }
  async function pushRoute(req) {
    const a = req.action;
    if (!WP) globalThis.fail_('Notifications are not installed on the server yet. Deploy package.json (it adds web-push) so Render runs npm install.', 'PUSH');
    if (a === 'pushKey') return { ok: true, key: pushVapid(true).pub };
    const uid = globalThis.checkToken_(req.token); if (!uid) globalThis.fail_('Session expired. Please log in again.', 'AUTH');
    const acc = globalThis.getAccount_(uid, globalThis.readSettings_().values);
    if (!acc || !acc.active) globalThis.fail_('This account is disabled. Please contact the admin.', 'DISABLED');
    const rec = pushRead(uid), info = () => ({ ok: true, att: rec.att !== false, pay: rec.pay !== false, devices: rec.s.length });
    if (a === 'pushSubscribe') {
      const s = req.sub || {}, k = s.keys || {};
      if (!/^https:\/\//.test(String(s.endpoint || '')) || String(s.endpoint).length > 800 || !k.p256dh || !k.auth) globalThis.fail_('Bad notification registration. Please try again.', 'PUSH');
      pushVapid(true);
      const all = pushProps().getProperties();             // one phone = one account: take this phone away from anybody else
      for (const key of Object.keys(all)) {
        if (!key.startsWith('PUSH_') || key === 'PUSH_' + uid) continue;
        try { const o = JSON.parse(all[key]); if (o.s && o.s.some(x => x.e === s.endpoint)) { o.s = o.s.filter(x => x.e !== s.endpoint); pushProps().setProperty(key, JSON.stringify(o)); } } catch (e) {}
      }
      rec.s = rec.s.filter(x => x.e !== s.endpoint);
      rec.s.push({ e: s.endpoint, k: { p256dh: String(k.p256dh), auth: String(k.auth) }, ua: String(req.ua || '').slice(0, 100), at: Date.now() });
      if (rec.s.length > 6) rec.s = rec.s.slice(-6);
      pushWrite(uid, rec); return info();
    }
    if (a === 'pushOff') { rec.s = rec.s.filter(x => x.e !== String(req.endpoint || '')); pushWrite(uid, rec); return info(); }
    if (a === 'pushPrefs') {
      if (req.att !== undefined) rec.att = !!req.att;
      if (req.pay !== undefined) rec.pay = !!req.pay;
      if (req.att !== undefined || req.pay !== undefined) pushWrite(uid, rec);
      return info();
    }
    if (a === 'pushTest') {
      const n = await pushToUser(uid, { title: '🔔 Notifications are working', body: 'You will get calls and reminders here, even when the app is closed.', tag: 'test', url: './', kind: 'test', ts: Date.now() }, { ttl: 300 });
      return { ok: true, sent: n };
    }
  }
  // ---- reminders: a timer (started at the bottom of this file) calls pushTick every couple of minutes ----
  const tzNow = () => {
    const p = {}; new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date()).forEach(x => { p[x.type] = x.value; });
    return { date: p.year + '-' + p.month + '-' + p.day, y: +p.year, m: +p.month, d: +p.day, h: +p.hour };
  };
  const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
  const licAdd = (iso, n) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); if (!m) return ''; const mo = +m[2] - 1 + n, last = new Date(Date.UTC(+m[1], mo + 1, 0)).getUTCDate(); return new Date(Date.UTC(+m[1], mo, Math.min(+m[3], last))).toISOString().slice(0, 10); };
  const LIC_STEP = { monthly: 1, quarterly: 3, halfyearly: 6, yearly: 12 };
  function licNext(x, today) {          // same rule as the LIC tab in app.js
    const anchor = x.dueDate || x.startDate, step = LIC_STEP[x.freq];
    if (!anchor || (!step && !x.dueDate)) return '';
    let due = anchor;
    if (step) { for (let k = 1; due < today && k < 2400; k++) due = licAdd(anchor, k * step); }
    else if (due < today) return '';
    if (x.endDate && due > x.endDate) return '';
    return due;
  }
  const inr = n => '₹' + Number(n).toLocaleString('en-IN');
  async function pushTick() {
    if (!WP) return;
    const sends = await withWb(() => {
      const P = pushProps(), all = P.getProperties(), out = [];
      const ids = Object.keys(all).filter(k => k.startsWith('PUSH_')).map(k => k.slice(5));
      if (!ids.length) return out;
      pushVapid(true);
      const now = Date.now(), t = tzNow(), S0 = globalThis.readSettings_();
      let st = {}; try { st = JSON.parse(all.PUSHST || '{}'); } catch (e) {}
      const before = JSON.stringify(st);
      const fmt = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
      for (const uid of ids) {
        const rec = pushRead(uid); if (!rec.s.length) continue;
        let acc; try { acc = globalThis.getAccount_(uid, S0.values); } catch (e) { continue; }
        if (!acc || !acc.active) continue;
        // 1) access payment: from 7 days before the due time until 7 days after, once a day at PUSH_PAY_HOUR
        if (rec.pay !== false && acc.payDue && t.h >= PUSH_PAY_HOUR && st['pay:' + uid] !== t.date) {
          const due = globalThis.parseDue_(acc.payDue);
          if (!isNaN(due)) {
            const left = due - now, days = left / 86400000, when = fmt.format(new Date(due));
            if (days <= 7 && days > -7) {
              const hrs = Math.max(1, Math.round(left / 3600000)), d = Math.max(1, Math.floor(days));
              out.push({ uid, opt: { ttl: 6 * 3600 }, payload: left <= 0
                ? { title: '⛔ Payment pending', body: 'Your access ended on ' + when + '. Please pay to continue using the app.', tag: 'pay', url: './', kind: 'pay', ts: now }
                : { title: '⏳ Payment reminder', body: 'Your access expires ' + (left < 86400000 ? 'in about ' + hrs + (hrs === 1 ? ' hour' : ' hours') : 'in ' + d + (d === 1 ? ' day' : ' days')) + ' (' + when + '). Please pay to keep using the app.', tag: 'pay', url: './', kind: 'pay', ts: now } });
              st['pay:' + uid] = t.date;
            }
          }
        }
        // the next two need this person's own data, so they are read the same way a normal request reads it
        try { globalThis.buildCtx_(uid, ''); } catch (e) { continue; }    // disabled / payment-pending accounts get no data reminders
        const perms = globalThis.CTX.perms || {};
        // 2) attendance not marked: from PUSH_ATT_HOUR (12:00), again every PUSH_ATT_REPEAT_MIN until PUSH_ATT_END_HOUR
        if (rec.att !== false && perms.att === 'edit' && t.h >= PUSH_ATT_HOUR && t.h < PUSH_ATT_END && now - (st['att:' + uid] || 0) >= PUSH_ATT_EVERY - 30000
            && Number(globalThis.publicSettings_(S0).year) === t.y) {
          const emps = globalThis.readEmployees_(), att = globalThis.attAll_();
          const miss = emps.filter(e => !(((att[e.id] || {})[t.m] || {})[t.d]));
          if (miss.length) {
            out.push({ uid, opt: { ttl: 3 * 3600 }, payload: { title: '🗓️ Attendance not marked', tag: 'att', url: './?go=attendance', kind: 'att', ts: now,
              body: emps.length === 1 ? 'You have not marked today’s attendance yet.' : 'Not marked today: ' + miss.slice(0, 3).map(e => e.name || 'Employee').join(', ') + (miss.length > 3 ? ' +' + (miss.length - 3) + ' more' : '') } });
            st['att:' + uid] = now;
          }
        }
        // 3) LIC premiums falling due in 7 / 3 / 1 days or today, once a day at PUSH_PAY_HOUR
        if (rec.pay !== false && perms.lic && perms.lic !== 'none' && t.h >= PUSH_PAY_HOUR && st['lic:' + uid] !== t.date) {
          st['lic:' + uid] = t.date;
          const due = globalThis.readLic_().map(x => ({ x, days: dayDiff(t.date, licNext(x, t.date) || '1970-01-01') })).filter(o => o.days >= 0 && o.days < 20000 && [7, 3, 1, 0].includes(o.days)).sort((a, b) => a.days - b.days);
          if (due.length) {
            const word = d => d === 0 ? 'today' : d === 1 ? 'tomorrow' : 'in ' + d + ' days';
            out.push({ uid, opt: { ttl: 6 * 3600 }, payload: { title: '🔔 LIC premium due ' + word(due[0].days), tag: 'lic', url: './?go=lic', kind: 'pay', ts: now,
              body: due.slice(0, 3).map(o => (o.x.name || o.x.policyNo || 'Policy') + (o.x.amount ? ' · ' + inr(o.x.amount) : '') + ' · ' + word(o.days)).join('\n') + (due.length > 3 ? '\n+' + (due.length - 3) + ' more' : '') } });
          }
        }
      }
      for (const k of Object.keys(st)) {                      // forget old bookkeeping
        const v = st[k], uid = k.slice(k.indexOf(':') + 1);
        if (!ids.includes(uid) || (typeof v === 'number' && v < now - 3 * 86400000) || (typeof v === 'string' && v !== t.date)) delete st[k];
      }
      if (JSON.stringify(st) !== before) P.setProperty('PUSHST', JSON.stringify(st));
      return out;
    });
    await Promise.all(sends.map(s => pushToUser(s.uid, s.payload, s.opt)));
  }

  let chain = Promise.resolve();
  function withWb(fn) {                                                // run fn in the request queue with fresh sheet data, save its changes
    const job = async () => {
      if (!wb.loadedAt || Date.now() - wb.loadedAt > REFRESH) await wb.load();
      let out, err;
      try { out = await fn(); } catch (e) { err = e; }
      try { await wb.flush(); } catch (e) { if (!err) err = e; }
      if (err) throw err;
      return out;
    };
    const p = chain.then(job, job); chain = p.catch(() => {}); return p;
  }
  const qdone = new Map();                             // qid|token -> the answer already given
  async function run(body) {
    if (!wb.loadedAt || Date.now() - wb.loadedAt > REFRESH) await wb.load();
    rt.delay = 0; rt.mails = []; rt.cal = [];
    let req, res, qk = '';
    try {
      req = JSON.parse(body);
      qk = req.qid ? String(req.qid).slice(0, 40) + '|' + String(req.token || '') : '';       // an offline entry sent twice (reply got lost) is applied only once
      if (qk && qdone.has(qk)) return qdone.get(qk);
      res = DEPLOY_ACTIONS.has(req.action) ? await deployRoute(req) : UPD_ACTIONS.has(req.action) ? await updRoute(req) : PUSH_ACTIONS.has(req.action) ? await pushRoute(req) : BIO_ACTIONS.has(req.action) ? bioRoute(req) : globalThis.route_(req);
    }
    catch (err) { res = { ok: false, error: err.message || String(err), code: err.code || 'ERR' }; }
    if (req && req.action === 'logout') revoked.add(req.token);
    try { await wb.flush(); } catch (e) { res = { ok: false, error: 'Could not save to the sheet: ' + e.message, code: 'ERR' }; }
    if (qk && res && res.ok) { qdone.set(qk, res); if (qdone.size > 3000) qdone.delete(qdone.keys().next().value); }
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
  const fastCall = body => {                           // call polling never waits behind slow sheet saves
    let r; try { r = JSON.parse(body); } catch (e) { return null; }
    if (!r || !(CALL_ACTIONS.has(r.action) || LUDO_ACTIONS.has(r.action))) return null;
    return Promise.resolve().then(() => LUDO_ACTIONS.has(r.action) ? ludoRoute(r) : callRoute(r)).catch(err => ({ ok: false, error: err.message || String(err), code: err.code || 'ERR' }));
  };
  const errOut = err => ({ ok: false, error: err.message || String(err), code: err.code || 'ERR' });
  return { pushTick, handle: body => fastCall(body) || (chain = chain.then(() => run(body), () => run(body))),
           updMax: UPD_MAX, upload: (token, q, buf) => updUpload(token, q, buf).catch(errOut), updOpen: q => updOpen(q).catch(e => ({ code: 500, error: e.message || 'Error' })),
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
  const cors = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
  return http.createServer((rq, rs) => {
    const send = (code, obj) => { rs.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, cors)); rs.end(JSON.stringify(obj)); };
    if (rq.method === 'OPTIONS') { rs.writeHead(204, cors); return rs.end(); }
    const url = new URL(rq.url, 'http://x');
    if (rq.method === 'GET' && url.pathname === '/updates/download' && app.updOpen) {      // stream an update file to the user
      return app.updOpen(Object.fromEntries(url.searchParams)).then(o => {
        if (o.code !== 200) { rs.writeHead(o.code, { 'Content-Type': 'text/html; charset=utf-8' }); return rs.end('<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><body style="font-family:system-ui;padding:32px;max-width:480px;margin:auto"><h2>⚠️ Download failed</h2><p>' + String(o.error).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) + '</p></body>'); }
        const h = { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="' + o.u.name + '"; filename*=UTF-8\'\'' + encodeURIComponent(o.u.name), 'Cache-Control': 'private, no-store' };
        if (o.u.size) h['Content-Length'] = String(o.u.size);
        rs.writeHead(200, h);
        const src = Readable.fromWeb(o.body); src.on('error', () => rs.destroy()); rs.on('close', () => src.destroy()); src.pipe(rs);
      });
    }
    if (rq.method === 'POST' && url.pathname === '/updates/upload' && app.upload) {        // raw file body, session token in the Authorization header
      const token = String(rq.headers.authorization || '').replace(/^Bearer\s+/i, ''), chunks = []; let n = 0, big = false;
      rq.on('data', c => { n += c.length; if (n > app.updMax) { big = true; chunks.length = 0; } else if (!big) chunks.push(c); });
      rq.on('end', async () => send(200, big ? { ok: false, error: 'The file is too big (max ' + (app.updMax / 1048576) + ' MB).', code: 'UPD' } : await app.upload(token, Object.fromEntries(url.searchParams), Buffer.concat(chunks))));
      return;
    }
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
  const tickMs = Math.max(30, Number(env.PUSH_TICK_SEC || 120)) * 1000;      // payment / attendance reminders
  const tick = () => app.pushTick().catch(e => console.warn('Push tick:', e.message));
  setTimeout(tick, 25000); setInterval(tick, tickMs);
}
