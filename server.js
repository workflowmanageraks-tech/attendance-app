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

  let chain = Promise.resolve();
  async function run(body) {
    if (!wb.loadedAt || Date.now() - wb.loadedAt > REFRESH) await wb.load();
    rt.delay = 0; rt.mails = []; rt.cal = [];
    let req, res;
    try { req = JSON.parse(body); res = globalThis.route_(req); }
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
  return { handle: body => (chain = chain.then(() => run(body), () => run(body))),
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
