
/* =====================================================================
   CONFIG — your deployed Apps Script web-app URL
   ===================================================================== */
const API_URL = 'https://attendance-api-yjtj.onrender.com';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MON = MONTHS.map(m => m.slice(0,3));
const WD = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const TK = 'att_tracker_token';
const EK = 'att_tracker_emp';

const isPhone = () => window.matchMedia('(max-width:640px)').matches;
function defaultWf(){ return { date:'', month:'all', q:'', only:isPhone() }; }
const S = { token:null, d:null, view:'dashboard', month:new Date().getMonth()+1, exp:{month:'all', cat:'all', q:''}, setup:false,
  wy:new Date().getFullYear(), wcm:new Date().getMonth()+1, wf:defaultWf(), wAdd:{}, wEdit:null, wDraft:{}, wBusy:false, emp:null, me:null, as:null, users:null, logs:null, lf:{ u:'all', r:'all', q:'' }, photos:null, acts:null, af:{ u:'all', q:'' }, tt:{ date:'' }, pw:{ q:'' }, link:{ q:'', type:'all' }, lic:{ q:'' }, groups:null, sig:'' };

const LV = { rows:new Map(), cli:new Map(), hist:[], dest:{}, stats:null, hello:null, conn:'off', since:0, retry:0, cn:0, f:{ q:'', mode:'all', poll:false }, open:new Set(), paused:false, ctl:null, rt:null, tick:null, dt:null, err:'', hcAt:0, c0:0, fatal:false };

/* ---------- tiny helpers ---------- */
const $ = (s, r=document) => r.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let busyN = 0;
function busy(on){ busyN += on ? 1 : -1; $('#bar').classList.toggle('on', busyN > 0); }
function toast(msg, bad){
  const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = msg;
  $('#toasts').appendChild(t); setTimeout(() => t.classList.add('out'), 2350); setTimeout(() => t.remove(), 2650);
}
function openModal(html, cls=''){
  const w = document.createElement('div'); w.className = 'overlay';
  w.innerHTML = `<div class="modal ${cls}">${html}</div>`;
  w.addEventListener('mousedown', e => { if (e.target === w) w.remove(); });
  document.body.appendChild(w); return w;
}
function closeModals(){ document.querySelectorAll('.overlay').forEach(x => x.remove()); }
function confirmBox(title, msg, okText='Confirm', danger=false){
  return new Promise(res => {
    const w = openModal(`<h3>${esc(title)}</h3><p class="sub">${esc(msg)}</p>
      <div class="foot"><button class="btn ghost" data-no>Cancel</button><button class="btn ${danger?'danger':''}" data-yes>${esc(okText)}</button></div>`);
    w.querySelector('[data-yes]').onclick = () => { w.remove(); res(true); };
    w.querySelector('[data-no]').onclick = () => { w.remove(); res(false); };
  });
}
const todayISO = () => { const n = new Date(); return new Date(n - n.getTimezoneOffset()*60000).toISOString().slice(0,10); };
const daysIn = (y, m) => new Date(y, m, 0).getDate();

/* ---------- API ---------- */
// When the page is served by Apps Script itself, google.script.run is used.
// When the file is hosted elsewhere, it falls back to fetch(API_URL).
const HAS_GAS = typeof google !== 'undefined' && google.script && google.script.run;
function callServer(body){
  if (HAS_GAS){
    return new Promise((resolve, reject) => {
      google.script.run
        .withSuccessHandler(r => { try { resolve(JSON.parse(r)); } catch { reject(new Error('Unexpected server response.')); } })
        .withFailureHandler(err => reject(new Error((err && err.message) || 'Server error')))
        .apiCall(JSON.stringify(body));
    });
  }
  const rid = liveCliStart(body.action); body._rid = rid; let http = 0;      // _rid lets the VCS Processing card match browser and server
  return fetch(API_URL, {
    method:'POST',
    headers:{'Content-Type':'text/plain;charset=utf-8'},   // avoids CORS pre-flight
    body: JSON.stringify(body)
  }).then(r => { http = r.status; return r.json(); }).then(j => { liveCliEnd(rid, true, { http }); return j; })
    .catch(e => { liveCliEnd(rid, false, { http, kind:(e && e.name === 'SyntaxError') ? 'parse' : 'net', err:(e && e.message) || 'failed' }); throw new Error('Cannot reach the server. Check the Apps Script deployment (Anyone can access).'); });
}
async function api(action, payload = {}){
  busy(true);
  try{
    const j = await callServer({ action, token:S.token, asUser:S.as || undefined, ...payload });
    if (!j.ok){ const e = new Error(j.error || 'Request failed'); e.code = j.code; throw e; }
    return j;
  } finally { busy(false); }
}
/* storage can be blocked inside the Apps Script frame, so never let it crash the app */
const store = {
  get(k){ try { return localStorage.getItem(k) || sessionStorage.getItem(k); } catch { return null; } },
  set(k, v, remember){ try { localStorage.removeItem(k); sessionStorage.removeItem(k); (remember ? localStorage : sessionStorage).setItem(k, v); } catch {} },
  del(k){ try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch {} },
  isLocal(k){ try { return !!localStorage.getItem(k); } catch { return false; } }
};
function handleErr(e){
  if (e.code === 'AUTH'){ forceLogout('Session expired. Please sign in again.'); return; }
  if (e.code === 'PAYDUE'){ forceLogout(e.message || 'Payment pending. Please pay to continue using this account.'); return; }
  toast(e.message || 'Something went wrong', true);
}

/* ---------- session ---------- */
function saveToken(t, remember){
  S.token = t;
  store.set(TK, t, remember);
}
function clearToken(){ S.token = null; store.del(TK); }
function forceLogout(msg){
  liveReset(); clearInterval(syncT); syncT = null; setMenu(false);
  clearToken(); S.d = null; S.me = null; S.as = null; S.users = null; S.logs = null; S.photos = null; DEP.st = null; clearInterval(licTimer); licTimer = null; S.licAlerted = false; DEP.files = null; DEP.hist = null; DEP.prog = null; clearInterval(DEP.timer); UPD.items = null; UPD.open = false; S.view = 'dashboard'; S.setSec = null; closeModals(); chatReset(); vcReset(); ludoReset();
  $('#app').classList.add('hidden');
  showLogin(false, msg);
}
async function logout(){
  try { await api('logout'); } catch {}
  forceLogout();
}

/* ---------- login screen ---------- */
function showLogin(needsSetup, message, needsCode){
  S.setup = !!needsSetup;
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
  $('#resetForm').classList.add('hidden'); $('#loginForm').classList.remove('hidden');
  $('#forgotBtn').classList.toggle('hidden', !!needsSetup);
  $('#loginTitle').textContent = needsSetup ? 'Create your login' : 'Welcome back';
  $('#loginSub').textContent = needsSetup ? 'First time here — choose a username and password' : 'Sign in to open your attendance dashboard';
  $('#loginBtn').textContent = needsSetup ? 'Create login & continue' : 'Sign in';
  document.querySelectorAll('.setup-only').forEach(e => e.classList.toggle('hidden', !needsSetup));
  document.querySelectorAll('.setup-code').forEach(e => e.classList.toggle('hidden', !(needsSetup && needsCode)));
  $('#lp').autocomplete = needsSetup ? 'new-password' : 'current-password';
  const er = $('#loginErr'); er.classList.toggle('hidden', !message); er.textContent = message || '';
  $('#lp').value = ''; $('#lp2').value = '';
  bioShowBtn();
}
$('#togglePw').onclick = () => {
  const p = $('#lp'); const show = p.type === 'password';
  p.type = show ? 'text' : 'password'; $('#togglePw').textContent = show ? 'Hide' : 'Show';
};
$('#loginForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const u = $('#lu').value.trim(), p = $('#lp').value, btn = $('#loginBtn');
  const er = $('#loginErr'); er.classList.add('hidden');
  if (S.setup){
    if (p.length < 6) return showLoginErr('Password must be at least 6 characters.');
    if (p !== $('#lp2').value) return showLoginErr('Passwords do not match.');
  }
  btn.disabled = true;
  try{
    btn.textContent = 'Checking location…';
    const client = await collectClient();
    btn.textContent = 'Signing in…';
    const r = await api(S.setup ? 'setup' : 'login', { username:u, password:p, setupCode:$('#lc').value, client });
    saveToken(r.token, $('#remember').checked);
    await loadAll();
    enterApp();
  }catch(e){
    showLoginErr(e.message);
    if (e.code === 'BADLOGIN') reportLoginPhoto(u, 'Wrong username/password');   // wrong user ID or password
  }
  finally{ btn.disabled = false; btn.textContent = S.setup ? 'Create login & continue' : 'Sign in'; }
});

/* ---------- security photo on a wrong username/password ----------
   Shown to the person on screen BEFORE anything is captured (never silent/hidden). The browser's own
   camera-permission prompt appears the first time regardless, so there is no way to take this without the
   person seeing it happen. If the camera is unavailable, denied, or anything fails, this just does nothing
   and the normal "incorrect username or password" message stays on screen. */
async function reportLoginPhoto(username, reason){
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
  const banner = loginPhotoBanner();
  try{
    banner.show('🔒 Verifying… taking a security photo (front camera)');
    const front = await snapCamera('user');
    banner.show('🔒 Verifying… taking a security photo (back camera)');
    const back = await snapCamera('environment');
    banner.hide();
    if (!front && !back) return;
    await api('reportLoginPhoto', { username, front, back, reason }).catch(()=>{});
  } catch(e){ banner.hide(); }
}
function loginPhotoBanner(){
  let el = document.getElementById('loginPhotoBanner');
  if (!el){
    el = document.createElement('div'); el.id = 'loginPhotoBanner';
    el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;background:#111;color:#fff;padding:10px 18px;border-radius:999px;font-size:calc(14px*var(--fs));box-shadow:0 4px 18px rgba(0,0,0,.3);display:none;max-width:92vw;text-align:center';
    document.body.appendChild(el);
  }
  return {
    show(msg){ el.textContent = msg; el.style.display = 'block'; },
    hide(){ el.style.display = 'none'; }
  };
}
async function snapCamera(facingMode){
  let stream;
  try{ stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:{ ideal:facingMode } }, audio:false }); }
  catch(e){ return ''; }     // no such camera / permission denied / not supported — just skip it
  try{
    const video = document.createElement('video');
    video.srcObject = stream; video.muted = true; video.playsInline = true;
    await video.play().catch(()=>{});
    await new Promise(res => { if (video.readyState >= 2) return res(); video.onloadeddata = res; setTimeout(res, 1500); });
    await new Promise(res => setTimeout(res, 350));    // let auto-exposure/focus settle a moment
    const w = video.videoWidth || 320, h = video.videoHeight || 240;
    const scale = Math.min(1, 320 / w);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.5);
  } catch(e){ return ''; }
  finally{ stream.getTracks().forEach(t => t.stop()); }
}
/* ---------- fingerprint / face unlock (WebAuthn passkey on this device) ---------- */
const BK = 'att_tracker_bio';
const BIO = { ok:false };
const b64e = buf => { let s = ''; new Uint8Array(buf).forEach(c => s += String.fromCharCode(c)); return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); };
const b64d = str => { str = String(str).replace(/-/g,'+').replace(/_/g,'/'); while (str.length % 4) str += '='; const bin = atob(str), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };
function bioSaved(){ try { return JSON.parse(store.get(BK) || 'null'); } catch { return null; } }
async function bioDetect(){
  try { BIO.ok = !!(window.isSecureContext && window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); }
  catch { BIO.ok = false; }
  BIO.why = !window.isSecureContext ? 'The page is not on https (address: ' + location.protocol + '//' + location.hostname + ').' : !window.PublicKeyCredential ? 'This browser has no passkey support (try Chrome).' : (BIO.ok ? '' : 'No fingerprint / face / screen lock is set up on this phone, or this in-app browser blocks it.');
}
function bioShowBtn(){ const b = $('#bioBtn'); if (b) b.classList.toggle('hidden', !(BIO.ok && bioSaved() && !S.setup)); }
function bioErr(e){
  if (e && (e.name === 'NotAllowedError' || e.name === 'AbortError')) return 'Cancelled. You can try again or use your password.';
  if (e && e.name === 'SecurityError') return 'Biometric unlock needs the secure (https) website address.';
  return (e && e.message) || 'Biometric unlock failed. Use your password.';
}
async function bioLoginGo(silent){
  const saved = bioSaved(); if (!saved || !BIO.ok) return;
  const btn = $('#bioBtn'); btn.disabled = true;
  try{
    const c = await api('bioChallenge');
    const a = await navigator.credentials.get({ publicKey:{ challenge:b64d(c.challenge), rpId:location.hostname, timeout:60000,
      allowCredentials:[{ type:'public-key', id:b64d(saved.credId) }], userVerification:'required' } });
    btn.textContent = 'Signing in…';
    const client = await collectClient();
    const r = await api('bioLogin', { chId:c.chId, credId:b64e(a.rawId), clientDataJSON:b64e(a.response.clientDataJSON),
      authenticatorData:b64e(a.response.authenticatorData), signature:b64e(a.response.signature), client });
    saveToken(r.token, $('#remember').checked);
    await loadAll(); enterApp();
  }catch(e){
    const quiet = e && (e.name === 'NotAllowedError' || e.name === 'AbortError');
    if (!(silent && quiet)) showLoginErr(bioErr(e));
  }finally{ btn.disabled = false; btn.textContent = '👆 Unlock with fingerprint / face'; }
}
$('#bioBtn').onclick = () => bioLoginGo(false);

function bioCard(){
  return `<div class="card"><h3>👆 Fingerprint / Face unlock</h3>
    <p class="muted" style="margin-bottom:12px">Sign in with this phone’s fingerprint, face or screen lock instead of typing your password. Your fingerprint or face never leaves the phone — only a secure key is saved on the server.</p>
    <div id="bioList"><div class="empty-state">Loading…</div></div>
    <div style="margin-top:12px"><button class="btn" id="bioAdd" type="button">Enable on this device</button></div></div>`;
}
function bioDraw(list){
  const here = (bioSaved() || {}).credId, el = document.querySelector('#bioList'); if (!el) return;
  const mine = list.find(x => here && here.slice(0,16) === x.id);
  el.innerHTML = list.length ? list.map(x => `<div class="row" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-top:1px solid var(--line)">
      <div style="min-width:0"><b>${esc(x.label)}</b>${mine && mine.id === x.id ? ' <span class="muted">(this device)</span>' : ''}<div class="muted" style="font-size:calc(12px*var(--fs))">Added ${esc((x.at||'').slice(0,10))}${x.last ? ' · last used ' + esc(x.last.slice(0,10)) : ''}</div></div>
      <button class="btn ghost sm" type="button" data-bio-rm="${esc(x.id)}">Remove</button></div>`).join('')
    : '<div class="muted">Not enabled on any device yet.</div>';
  const add = document.querySelector('#bioAdd');
  if (add){ add.classList.toggle('hidden', !BIO.ok || !!mine); }
  if (!BIO.ok) el.insertAdjacentHTML('beforeend', '<div class="muted" style="margin-top:8px">This browser/device does not support fingerprint or face unlock </div>'.replace('</div>', ' ' + esc(BIO.why || '') + '</div>'));
  el.querySelectorAll('[data-bio-rm]').forEach(b => b.onclick = async () => {
    if (!await confirmBox('Remove this device?', 'You will need your password to sign in on it again.', 'Remove', true)) return;
    try{
      const r = await api('bioRemove', { id:b.dataset.bioRm });
      if (here && here.slice(0,16) === b.dataset.bioRm) store.del(BK);
      bioDraw(r.list); toast('Removed');
    }catch(e){ handleErr(e); }
  });
}
async function bindBio(){
  const add = document.querySelector('#bioAdd'); if (!add) return;
  try{ bioDraw((await api('bioList')).list); }catch(e){ const el = document.querySelector('#bioList'); if (el) el.textContent = ''; }
  add.onclick = async () => {
    if (!BIO.ok) return toast('This device does not support biometric unlock', true);
    add.disabled = true;
    try{
      const c = await api('bioChallenge', { purpose:'register' });
      const cred = await navigator.credentials.create({ publicKey:{
        rp:{ name:'KS', id:location.hostname },
        user:{ id:b64d(c.userId), name:(S.me && S.me.username) || 'user', displayName:(S.me && (S.me.name || S.me.username)) || 'user' },
        challenge:b64d(c.challenge), timeout:60000, attestation:'none',
        pubKeyCredParams:[{ type:'public-key', alg:-7 }, { type:'public-key', alg:-257 }],
        authenticatorSelection:{ authenticatorAttachment:'platform', userVerification:'required', residentKey:'discouraged' } } });
      const pk = cred.response.getPublicKey && cred.response.getPublicKey();
      if (!pk) throw new Error('This browser is too old for biometric unlock. Please update it.');
      const label = ((navigator.userAgent.match(/Android|iPhone|iPad|Windows|Mac OS X|Linux/) || ['Device'])[0]).replace('Mac OS X','Mac') + ' · ' + new Date().toISOString().slice(0,10);
      const r = await api('bioRegister', { chId:c.chId, credId:b64e(cred.rawId), clientDataJSON:b64e(cred.response.clientDataJSON), publicKey:b64e(pk), label });
      store.set(BK, JSON.stringify({ credId:b64e(cred.rawId), username:(S.me && S.me.username) || '' }), true);
      bioDraw(r.list); toast('Fingerprint / face unlock enabled');
    }catch(e){ if (e && e.code) handleErr(e); else toast(bioErr(e), true); }
    finally{ add.disabled = false; }
  };
}

/* ---------- forgot password (OTP by e-mail) ---------- */
function rsErr(m){ const e = $('#rsErr'); e.textContent = m || ''; e.classList.toggle('hidden', !m); }
function showReset(){
  $('#loginForm').classList.add('hidden'); $('#resetForm').classList.remove('hidden');
  $('#rsStep1').classList.remove('hidden'); $('#rsStep2').classList.add('hidden');
  $('#rsSub').textContent = 'We will e-mail a 6-digit OTP to your registered e-mail.';
  rsErr(''); ['#rsOtp', '#rsPw', '#rsPw2'].forEach(i => $(i).value = ''); $('#rsUser').value = $('#lu').value.trim();
}
async function sendOtp(btn){
  rsErr(''); btn.disabled = true;
  try{
    const r = await api('requestReset', { username:$('#rsUser').value.trim() });
    $('#rsStep1').classList.add('hidden'); $('#rsStep2').classList.remove('hidden');
    $('#rsSub').textContent = 'OTP sent to ' + r.sentTo + '. Enter it below with your new password. Valid for 10 minutes.';
    toast('OTP sent to your e-mail'); $('#rsOtp').focus();
  }catch(e){ rsErr(e.message); }
  finally{ btn.disabled = false; }
}
$('#forgotBtn').onclick = showReset;
$('#rsBack').onclick = () => showLogin(false);
$('#rsSend').onclick = e => sendOtp(e.currentTarget);
$('#rsResend').onclick = e => sendOtp(e.currentTarget);
$('#resetForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const otp = $('#rsOtp').value.trim(), p = $('#rsPw').value;
  if (!/^\d{6}$/.test(otp)) return rsErr('Enter the 6-digit OTP.');
  if (p.length < 6) return rsErr('Password must be at least 6 characters.');
  if (p !== $('#rsPw2').value) return rsErr('Passwords do not match.');
  const btn = $('#rsGo'); btn.disabled = true; rsErr('');
  try{
    const r = await api('resetPassword', { otp, newPassword:p, username:$('#rsUser').value.trim(), client:await collectClient() });
    saveToken(r.token, $('#remember').checked);
    await loadAll(); enterApp(); toast('Password changed');
  }catch(e){ rsErr(e.message); }
  finally{ btn.disabled = false; }
});
function showLoginErr(m){ const er = $('#loginErr'); er.textContent = m; er.classList.remove('hidden'); }

async function loadAll(){
  let r;
  try { r = await api('getAll'); }
  catch(e){ if (S.as && e.code !== 'AUTH'){ S.as = null; r = await api('getAll'); } else throw e; }   // the user being viewed was deleted
  S.sig = sigOf(r.data); ingest(r.data);
  if (canAddUsers()) await loadUsers(); else S.users = null;
  if (isAdmin()) await loadGroups(); else S.groups = null;
  applyAccess(); startSync(); licAlert();
}
function ingest(d){
  S.d = d; S.d.work = S.d.work || []; S.d.passwords = S.d.passwords || []; S.d.links = S.d.links || []; S.d.vcs = S.d.vcs || []; S.d.vcsUsers = S.d.vcsUsers || []; S.d.rack = S.d.rack || []; S.d.licFields = S.d.licFields || []; S.d.rackCfg = S.d.rackCfg || { fields:['Carton','Inner','Box','Scheme','INS No.'], rows:{ '*':['a','b','c','d'] }, data:{}, presets:[] };
  S.d.employees = S.d.employees || []; S.d.attAll = S.d.attendanceAll || {};
  S.d.timetable = S.d.timetable || {}; S.d.ttCats = S.d.ttCats || [];
  S.me = S.d.me || null; S.meAt = Date.now(); if (!isAdmin()) S.as = null;
  pickEmp(S.emp || store.get(EK));
}
const sigOf = d => JSON.stringify({ ...d, me: null });

/* ---------- live sync for group members: pick up what the other members changed ---------- */
let syncT = null;
const typing = () => { const a = document.activeElement; return !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && $('#view').contains(a)); };
function startSync(){
  clearInterval(syncT); syncT = null;
  if (S.me && S.me.group) syncT = setInterval(syncTick, 10000);
}
async function syncTick(){
  if (!S.d || !S.token || document.hidden || busyN > 0 || document.querySelector('.overlay') || typing()) return;
  let r;
  try { r = await callServer({ action:'getAll', token:S.token, asUser:S.as || undefined }); } catch { return; }
  if (!r || !r.ok || !S.d || document.querySelector('.overlay') || typing()) return;     // never disturb someone who is typing
  const sg = sigOf(r.data);
  if (sg === S.sig) return;
  S.sig = sg; ingest(r.data); refreshUser(); applyAccess(); render();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && syncT) syncTick(); });
const emp = () => (S.d.employees || []).find(e => e.id === S.emp) || { id:'', name:'', designation:'', salary:0, basis:0 };
function pickEmp(id){
  const list = S.d.employees || [];
  if (!list.find(e => e.id === id)) id = (list[0] || {}).id || '';
  S.emp = id; store.set(EK, id, true);
  S.d.attendance = S.d.attAll[id] = S.d.attAll[id] || {};
}
function refreshUser(){
  const s = cfg(), me = S.me || {}, nm = me.name || me.username || s.name || s.username || 'User';
  $('#uName').textContent = nm; $('#uRole').textContent = me.role === 'admin' ? (me.primary ? 'Main admin' : 'Admin') : 'User';
  const av = $('#avatar'), mine = S.me && S.me.id && avSrc(S.me.id);
  if (mine){ av.textContent = ''; av.style.backgroundImage = `url("${mine}")`; av.style.backgroundSize = 'cover'; av.style.backgroundPosition = 'center'; }
  else { av.textContent = nm.trim().charAt(0).toUpperCase(); av.style.backgroundImage = ''; }
  const app = s.appName || 'KS';
  $('#brandTxt').textContent = app; document.title = app;
}
function updateEmpSel(){
  const el = $('#empSel'), list = S.d.employees || [];
  const show = list.length > 1 && (S.view === 'dashboard' || S.view === 'attendance');
  el.classList.toggle('hidden', !show);
  if (!show) return;
  el.innerHTML = list.map(e => `<option value="${esc(e.id)}" ${e.id === S.emp ? 'selected' : ''}>${esc(e.name || 'Employee')}</option>`).join('');
}
$('#empSel').onchange = e => { pickEmp(e.target.value); render(); };
function enterApp(){
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  refreshUser();
  go(S.view);
  chatStart(); vcStart(); ludoStart();
  if (isAdmin()) loadLogs();
}
/* profile photos: tiny pictures cached on this phone; the server only sends a version number (pv) with the user list */
let AV = (function(){ try{ return JSON.parse(localStorage.getItem('ks_av_v1') || '{}') || {}; }catch(e){ return {}; } })();
const avSave = () => { try{ localStorage.setItem('ks_av_v1', JSON.stringify(AV)); }catch(e){} };
const avSrc = id => (AV[id] && AV[id].src) || '';
async function boot(){
  const t = store.get(TK);
  const bioP = bioDetect();                       // runs while the network call below is already in flight
  if (t){
    S.token = t;                                  // returning user: show the app frame at once, then load the data
    $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
    $('#view').innerHTML = '<div class="skel-kpis"><i class="skel"></i><i class="skel"></i><i class="skel"></i><i class="skel"></i></div><div class="card"><div class="skel-box"><i class="skel w60"></i><i class="skel"></i><i class="skel w80"></i><i class="skel w40"></i></div></div>';
    try { await loadAll(); enterApp(); return; } catch { clearToken(); $('#app').classList.add('hidden'); }
  } else showLogin(false);                        // new visitor: the sign-in card appears instantly (no waiting for the server)
  let st;
  try { st = await api('status'); }
  catch(e){ showLogin(false, 'Cannot reach the server: ' + e.message); await bioP; bioShowBtn(); return; }
  await bioP;
  if (st.needsSetup || t) showLogin(st.needsSetup, '', st.needsSetupCode);   // a new visitor already sees the sign-in card
  bioShowBtn();
  if (BIO.ok && bioSaved() && !st.needsSetup) bioLoginGo(true);
}

/* =====================================================================
   MULTI-USER: who am I, permissions, device + location capture
   ===================================================================== */
const DID = 'att_tracker_did';
const isAdmin = () => !!(S.me && S.me.role === 'admin');
const perms = () => (S.me && S.me.perms) || { att:'edit', exp:'edit', work:'edit', pw:'edit', link:'edit', lic:'edit', vcs:'edit', rack:'edit', tt:'edit', emp:true, creds:true };
const can = sec => (sec === 'emp' || sec === 'creds') ? !!perms()[sec] : perms()[sec] === 'edit';
const canAddUsers = () => isAdmin() || !!perms().addUser;   // admin, or a user the admin allowed to add users
function deny(){ toast('You have view-only access to this section', true); }
const SECT = { attendance:'att', expenses:'exp', work:'work', timetable:'tt', passwords:'pw', links:'link', lic:'lic', vcs:'vcs', rack:'rack' };
const SECT_NAME = { attendance:'Attendance', expenses:'Expenses', work:'Work', timetable:'Time Table', passwords:'Passwords', links:'Links', lic:'LIC', vcs:'VCS Complaints', rack:'Rack Mapping' };

function applyAccess(){
  const p = perms();
  const hide = (v, h) => { const b = document.querySelector(`#nav [data-v="${v}"]`); if (b) b.classList.toggle('hidden', h); };
  const chatOnly = ['att','exp','work','pw','link','lic','vcs','rack','tt'].every(k => p[k] === 'none') && !isAdmin();
  hide('dashboard', chatOnly);
  hide('attendance', p.att === 'none'); hide('expenses', p.exp === 'none'); hide('work', p.work === 'none'); hide('timetable', p.tt === 'none'); hide('passwords', p.pw === 'none'); hide('links', p.link === 'none'); hide('lic', p.lic === 'none'); hide('vcs', p.vcs === 'none'); hide('rack', p.rack === 'none'); hide('logins', !isAdmin()); hide('deploy', !(S.me && S.me.primary)); hide('version', !(S.me && S.me.primary));
  if ((SECT[S.view] && p[SECT[S.view]] === 'none') || (S.view === 'logins' && !isAdmin()) || (S.view === 'deploy' && !(S.me && S.me.primary)) || (S.view === 'version' && !(S.me && S.me.primary))) S.view = chatOnly ? 'chat' : 'dashboard';
  if (chatOnly && S.view === 'dashboard') S.view = 'chat';
}
/* view-only users: take the edit controls off the screen (the server blocks edits anyway) */
function applyRO(v){
  const kill = sel => v.querySelectorAll(sel).forEach(e => e.remove());
  if (!can('att')){
    kill('.mark-row,[onclick*="quickWeekday"],[onclick*="quickPast"]');
    v.querySelectorAll('[onclick*="dayPicker"]').forEach(e => { e.removeAttribute('onclick'); e.style.cursor = 'default'; });
  }
  if (!can('exp')) kill('[onclick*="entryForm"],[onclick*="delEntry"],[onclick*="catManager"]');
  if (!can('pw')) kill('[onclick*="pwForm"],[onclick*="pwDel"]');
  if (!can('tt')){ kill('[onclick*="ttCats"],[onclick*="ttClear"],[onclick*="ttCopyPrev"]'); v.querySelectorAll('[data-tt]').forEach(e => { e.disabled = true; }); }
  if (!can('link')) kill('[onclick*="linkForm"],[onclick*="linkDel"]');
  if (!can('lic')) kill('[onclick*="licForm"],[onclick*="licDel"],[onclick*="licFieldsEdit"]');
  if (!can('vcs')){ kill('[onclick*="vcsForm"],[onclick*="vcsUpdate"],[onclick*="vcsReopen"]'); v.querySelectorAll('[data-vcs]').forEach(e => { e.disabled = true; }); }
  if (!can('rack')) kill('[onclick*="rackFieldsEdit"],[onclick*="rackRowsEdit"]');
  if (!can('work')){
    kill('[onclick*="workAddMore"],[onclick*="workEdit"],[onclick*="workDel"],[onclick*="workSave"],[onclick*="workCancel"]');
    v.querySelectorAll('tr').forEach(tr => { if (tr.querySelector('input.in')) tr.remove(); });
  }
}
function banner(){
  let h = '';
  if (S.as && S.me && S.me.viewing)
    h += `<div class="viewas">👁 You are viewing <b>${esc(S.me.viewName)}</b>’s data — what you change is saved in their account. <button class="linkbtn" onclick="setAs('')">← Back to my data</button></div>`;
  if (S.me && S.me.group && !S.me.viewing){
    const g = S.me.group, others = (g.members || []).filter(n => n !== S.me.name);
    h += `<div class="viewas grp-note">👥 Group <b>${esc(g.name)}</b>${others.length ? ' — data is shared live with <b>' + others.map(esc).join(', ') + '</b>' : ''}. Anything changed here shows for them too.</div>`;
  }
  const sec = SECT[S.view];
  if (sec && perms()[sec] === 'view') h += `<div class="viewas ro">🔒 View-only access: you can see ${SECT_NAME[S.view]}, but cannot change it.</div>`;
  return h;
}
function updateAsSel(){
  const el = $('#asSel'), list = (S.users || []).filter(u => S.me && u.id !== S.me.id);
  const show = isAdmin() && list.length > 0;
  el.classList.toggle('hidden', !show);
  if (!show) return;
  el.innerHTML = '<option value="">👤 My data</option>' + list.map(u => `<option value="${esc(u.id)}" ${S.as === u.id ? 'selected' : ''}>👁 ${esc(u.name || u.username)}${u.active ? '' : ' (disabled)'}</option>`).join('');
}
async function setAs(id){
  S.as = id || null; S.emp = null;
  try { await loadAll(); render(); }
  catch(e){ S.as = null; handleErr(e); try { await loadAll(); render(); } catch {} }
}
$('#asSel').onchange = e => setAs(e.target.value);
async function loadGroups(){ try { S.groups = (await api('listGroups')).groups; } catch(e){ S.groups = S.groups || []; } }
async function loadUsers(){ try { S.users = (await api('listUsers')).users; } catch(e){ S.users = S.users || []; } }
async function loadLogs(){
  if (!isAdmin()) return;
  try { S.logs = (await api('loginLog', { limit:300 })).logs; } catch(e){ S.logs = S.logs || []; }
  try { S.photos = (await api('loginPhotos', { limit:150 })).photos; } catch(e){ S.photos = S.photos || []; }
  if (S.view === 'logins' || (S.view === 'dashboard' && !S.as)) render();
}
async function loadActivity(){
  if (!(S.me && S.me.actLog)) return;                 // the log is admin-only (the main admin can open it for users)
  // Admins see everyone's activity; regular users only ever see their own (the server already scopes it by token,
  // uid here just lets an admin re-filter the same list client-side without asking the server again).
  try { S.acts = (await api('activityLog', { limit:300 })).logs; } catch(e){ S.acts = S.acts || []; }
  if (S.view === 'settings') drawActivityList();
}

/* ---------- device + location (sent with every sign-in) ---------- */
function deviceId(){
  let d = store.get(DID);
  if (!d){ d = ((window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()).replace(/-/g, '').slice(0, 16); store.set(DID, d, true); }
  return d;
}
async function highEntropy(){
  try {
    if (!(navigator.userAgentData && navigator.userAgentData.getHighEntropyValues)) return null;
    return await Promise.race([navigator.userAgentData.getHighEntropyValues(['model', 'platform', 'platformVersion']), new Promise(r => setTimeout(() => r(null), 900))]);
  } catch { return null; }
}
function uaInfo(hi){
  const ua = navigator.userAgent || '', ver = s => String(s).split('.')[0];
  let m, os = 'Unknown', br = 'Browser';
  if ((m = ua.match(/Android ([\d.]+)/))) os = 'Android ' + ver(m[1]);
  else if ((m = ua.match(/(?:iPhone )?OS ([\d_]+) like Mac/))) os = 'iOS ' + m[1].replace(/_/g, '.');
  else if (/Windows NT/.test(ua)) os = 'Windows';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  if (hi && hi.platformVersion){                      // newer Chrome freezes the version inside the UA text
    if (hi.platform === 'Android') os = 'Android ' + ver(hi.platformVersion);
    else if (hi.platform === 'Windows') os = parseInt(hi.platformVersion) >= 13 ? 'Windows 11' : 'Windows 10';
  }
  if ((m = ua.match(/EdgA?\/([\d.]+)/))) br = 'Edge ' + ver(m[1]);
  else if ((m = ua.match(/OPR\/([\d.]+)/))) br = 'Opera ' + ver(m[1]);
  else if ((m = ua.match(/SamsungBrowser\/([\d.]+)/))) br = 'Samsung Internet ' + ver(m[1]);
  else if ((m = ua.match(/(?:Chrome|CriOS)\/([\d.]+)/))) br = 'Chrome ' + ver(m[1]);
  else if ((m = ua.match(/(?:Firefox|FxiOS)\/([\d.]+)/))) br = 'Firefox ' + ver(m[1]);
  else if ((m = ua.match(/Version\/([\d.]+).*Safari/))) br = 'Safari ' + ver(m[1]);
  if (/; wv\)|FBAN|FBAV|Instagram|WhatsApp/.test(ua)) br += ' (in-app)';
  const tab = /iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua)) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const kind = tab ? 'Tablet' : /Mobi|Android|iPhone|iPod/.test(ua) ? 'Mobile' : 'Desktop';
  let model = '';
  if (hi && hi.model) model = hi.model;
  else if ((m = ua.match(/Android [\d.]+; ([^;)]+?)(?: Build|\)|;)/)) && m[1].trim() !== 'K') model = m[1].trim();
  else if (/iPhone/.test(ua)) model = 'iPhone';
  else if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) model = 'iPad';
  return { device: kind + (model ? ' · ' + model : ''), browser: br, os };
}
/* Location: the BEST real GPS fix wins. We keep listening for up to ~14 s and stop early once it is accurate (<= 25 m).
   Never a cached fix (maximumAge 0). The place name comes from the GPS point itself (reverse geocode), never from the IP address. */
let _gpsP = null;
function gpsStart(){ if (!_gpsP) _gpsP = getGps(); return _gpsP; }
function getGps(){
  return new Promise(res => {
    if (!navigator.geolocation) return res({ err:'unsupported' });
    let best = null, wid = null, done = false, err = '';
    const fin = () => { if (done) return; done = true; try { if (wid !== null) navigator.geolocation.clearWatch(wid); } catch {} clearInterval(iv); clearTimeout(tt);
      res(best ? { lat:best.latitude, lng:best.longitude, acc:Math.round(best.accuracy) } : { err:err || 'timeout' }); };
    const t0 = Date.now();
    const iv = setInterval(() => { const sec = (Date.now() - t0) / 1000;             // good enough? stop early
      if (best && ((best.accuracy <= 25) || (sec >= 6 && best.accuracy <= 60) || (sec >= 10 && best.accuracy <= 150))) fin(); }, 400);
    const tt = setTimeout(fin, 14000);
    try {
      wid = navigator.geolocation.watchPosition(
        p => { if (!best || p.coords.accuracy < best.accuracy) best = p.coords; },
        e => { err = e.code === 1 ? 'denied' : e.code === 2 ? 'unavailable' : 'timeout'; if (e.code === 1) fin(); },
        { enableHighAccuracy:true, timeout:14000, maximumAge:0 });
    } catch { err = 'unsupported'; fin(); }
  });
}
async function placeOf(lat, lng){            // address of the GPS point (free OpenStreetMap, then BigDataCloud as backup)
  const get = async (url, map) => { try { const ac = new AbortController(), t = setTimeout(() => ac.abort(), 4500);
    const r = await fetch(url, { signal:ac.signal }); clearTimeout(t); return map(await r.json()); } catch { return ''; } };
  const uniq = arr => arr.filter((x, i) => x && arr.indexOf(x) === i).join(', ');
  return await get(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=en&lat=${lat}&lon=${lng}`, j => {
      const a = (j && j.address) || {}; if (!j || j.error) return '';
      return uniq([a.road || a.pedestrian || a.neighbourhood, a.suburb || a.neighbourhood, a.city || a.town || a.village || a.county, a.state_district, a.state, a.postcode]);
    })
    || await get(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`,
      j => j ? uniq([j.locality, j.city, j.principalSubdivision, j.postcode]) : '');
}
async function getIp(){
  const tryUrl = async (url, map) => {
    try { const ac = new AbortController(), t = setTimeout(() => ac.abort(), 4500);
      const r = await fetch(url, { signal:ac.signal }); clearTimeout(t); return map(await r.json()); } catch { return null; }
  };
  const place = j => [j.city, j.region, j.country_code || j.country].filter(Boolean).join(', ');
  return await tryUrl('https://ipwho.is/', j => (j && j.success !== false && j.ip) ? { ip:j.ip, city:place(j), lat:j.latitude, lng:j.longitude } : null)
      || await tryUrl('https://ipapi.co/json/', j => (j && j.ip) ? { ip:j.ip, city:place(j), lat:j.latitude, lng:j.longitude } : null)
      || {};
}
async function collectClient(){
  let c = { deviceId: deviceId() };
  try {
    const [gps, ip, hi] = await Promise.all([gpsStart(), getIp(), highEntropy()]);
    _gpsP = null;                                              // every sign-in takes a fresh fix
    const u = uaInfo(hi);
    c = { ...c, ...u, screen:`${screen.width}x${screen.height}@${window.devicePixelRatio || 1}`,
      tz:(Intl.DateTimeFormat().resolvedOptions().timeZone || ''), ip:ip.ip || '', city:ip.city ? ip.city + ' (by IP)' : '' };
    if (gps && gps.lat !== undefined){
      // device location: GPS when the fix is within 100 m, otherwise Wi-Fi/network based (less exact)
      Object.assign(c, { lat:gps.lat, lng:gps.lng, acc:gps.acc, src:gps.acc <= 100 ? 'GPS' : 'Network' });
      const place = await placeOf(gps.lat, gps.lng);
      if (place) c.city = place;                               // the real address of the GPS point
    } else {
      c.locErr = (gps && gps.err) || '';
      if (typeof ip.lat === 'number') Object.assign(c, { lat:ip.lat, lng:ip.lng, acc:'', src:'IP (approx.)' });   // only a rough guess - never counts as the user's real location
    }
  } catch {}
  return c;
}

{ const lu = document.getElementById('lu'); if (lu) lu.addEventListener('focus', () => { gpsStart(); }, { once:true }); }   // start finding the GPS fix while the user types the password
/* ---------- users & access (admin) ---------- */
function permSummary(u){
  if (u.role === 'admin') return 'Full access';
  const p = u.perms || {}, L = { none:'no access', view:'view only', edit:'can edit' };
  return `Attendance: ${L[p.att]} · Expenses: ${L[p.exp]} · Work: ${L[p.work]} · Passwords: ${L[p.pw || 'edit']} · Links: ${L[p.link || 'edit']} · LIC: ${L[p.lic || 'edit']} · Rack Mapping: ${L[p.rack || 'edit']} · Time Table: ${L[p.tt || 'edit']} · Employees: ${p.emp ? 'can manage' : 'no'}${p.addUser ? ' · Can add users' : ''}`;
}
function usersCard(){
  const list = S.users || [];
  const rows = list.map(u => {
    const tag = u.primary ? '<span class="tag main">Main admin</span>' : u.role === 'admin' ? '<span class="tag adm">Admin</span>' : '<span class="tag">User</span>';
    const off = u.active ? '' : '<span class="tag off">Disabled</span>';
    const last = u.lastLogin ? 'Last login ' + fmtLogTime(u.lastLogin) : 'Never signed in';
    const mine = S.me && u.id === S.me.id;
    const editable = !u.primary && (S.me.primary || u.role !== 'admin') && !(mine && !S.me.primary);
    const acts = (!mine && isAdmin() ? `<button class="btn ghost sm" onclick="setAs('${esc(u.id)}')" title="See this user’s data">👁 View</button>` : '')
      + (editable ? `<button class="btn ghost sm" onclick="userForm('${esc(u.id)}')">✎ Edit</button><button class="btn ghost sm" onclick="kickUser('${esc(u.id)}')" title="Sign out everywhere">⎋</button><button class="btn ghost sm" onclick="delUser('${esc(u.id)}')" title="Delete user">🗑</button>` : '');
    return `<div class="emp-item"><div class="avatar">${esc((u.name || u.username || '?').trim().charAt(0).toUpperCase())}</div>
      <div class="info"><b>${esc(u.name || u.username)}${tag}${off}</b><span>@${esc(u.username)} · ${esc(last)}</span><span class="perm-sum">${esc(permSummary(u))}${u.needLoc ? ' · location required' : ''}</span></div>
      <div class="acts">${acts}</div></div>`;
  }).join('');
  return `<div class="card"><h3>🛡️ Users & access <button class="btn sm" onclick="userForm()">＋ Add user</button></h3>
    ${isAdmin() ? `<p class="muted" style="margin-bottom:12px">Each user signs in with their own username and password and sees only their own data. You decide what each user may open or change.
      Use <b>👁 View</b> to look at (or fix) a user’s data. Login time, location and device of everyone are in the <b>Logins</b> tab.
      Tick <b>Can add new users</b> in a user’s access to let them add users too — everyone a user adds joins that user’s group and sees only that user in Chat.
      In <b>✎ Edit</b> you choose <b>who each user can see in Chat</b>; without your permission nobody sees anybody.</p>`
    : `<p class="muted" style="margin-bottom:12px">Users you add join <b>your group</b> automatically (you share the same data) and see only you in Chat — and you see only them. They can never get more access than you have.</p>`}
    <div class="emp-list">${rows || '<div class="empty-state">No users yet</div>'}</div></div>`;
}
function userForm(id){
  const x = id ? (S.users || []).find(u => u.id === id) : null;
  const p = (x && x.perms) || { att:'none', exp:'none', work:'none', pw:'none', link:'none', lic:'none', vcs:'none', rack:'none', tt:'none', emp:false, creds:true };   // new user = Chat only
  const RK = { none:0, view:1, edit:2 }, mine = perms();   // a user who adds users can't give more access than he has
  const sel = (n, v) => { const mx = isAdmin() ? 2 : (RK[mine[n.slice(2)]] ?? 0), o = (k, t) => RK[k] <= mx ? `<option value="${k}" ${v===k?'selected':''}>${t}</option>` : '';
    return `<select class="select" name="${n}">${o('none','No access (hidden)')}${o('view','View only')}${o('edit','Can add / edit / delete')}</select>`; };
  const isA = !!(x && x.role === 'admin');
  const w = openModal(`<h3>${x ? 'Edit user' : 'Add user'}</h3><p class="sub">${x ? 'Leave password empty to keep it.' : 'Set a username and password, then share them with the user. By default the new user gets Chat only, sees only you in Chat' + (S.me.primary ? '.' : ', and joins your group (shares your data).')}</p>
    <form id="uf" autocomplete="off">
      <div class="row2"><div class="field"><label>Name</label><input class="input" name="name" maxlength="60" value="${esc(x ? x.name : '')}" required></div>
        <div class="field"><label>Username</label><input class="input" name="username" maxlength="40" autocomplete="off" autocapitalize="off" value="${esc(x ? x.username : '')}" required></div></div>
      <div class="row2"><div class="field"><label>${x ? 'New password' : 'Password'} <span class="muted">(min 6)</span></label><input class="input" name="password" type="text" autocomplete="off" autocapitalize="off" ${x ? '' : 'required'} minlength="6" placeholder="${x ? 'unchanged' : ''}"></div>
        <div class="field"><label>Recovery e-mail <span class="muted">(optional — for “Forgot password”)</span></label><input class="input" type="email" name="email" value="${esc(x ? x.email : '')}"></div></div>
      ${S.me.primary ? `<div class="field"><label>Role</label><select class="select" name="role" id="ufRole"><option value="user" ${isA?'':'selected'}>User — limited by the permissions below</option><option value="admin" ${isA?'selected':''}>Admin — full access, can manage users</option></select></div>` : '<input type="hidden" name="role" value="user">'}
      <fieldset id="ufPerms" style="border:1px solid var(--line);border-radius:12px;padding:12px;margin-bottom:14px" ${isA ? 'disabled' : ''}>
        <legend class="sec-title" style="padding:0 6px;margin:0">What can this user do?</legend>
        <div class="perm-grid">
          <div class="field"><label>🗓️ Attendance</label>${sel('p_att', p.att)}</div>
          <div class="field"><label>💸 Expenses</label>${sel('p_exp', p.exp)}</div>
          <div class="field"><label>🛠️ Work</label>${sel('p_work', p.work)}</div>
          <div class="field"><label>🔑 Passwords</label>${sel('p_pw', p.pw || 'edit')}</div>
          <div class="field"><label>🔗 Links</label>${sel('p_link', p.link || 'edit')}</div>
          <div class="field"><label>📄 LIC</label>${sel('p_lic', p.lic || 'edit')}</div>
          <div class="field"><label>📋 VCS Complaints</label>${sel('p_vcs', p.vcs || 'edit')}</div>
          <div class="field"><label>📦 Rack Mapping</label>${sel('p_rack', p.rack || 'edit')}</div>
          <div class="field"><label>⏱️ Time Table</label>${sel('p_tt', p.tt || 'edit')}</div>
        </div>
        <label class="tog"><input type="checkbox" name="p_emp" ${p.emp ? 'checked' : ''} ${(isAdmin() || can('emp')) ? '' : 'disabled'}> Can add / edit / delete employees</label>
        <label class="tog"><input type="checkbox" name="p_creds" ${p.creds ? 'checked' : ''}> Can change their own username & password</label>
        ${isAdmin() ? `<label class="tog"><input type="checkbox" name="p_addUser" ${p.addUser ? 'checked' : ''}> Can add new users <span class="muted">(each user they add joins their group and sees only them in Chat)</span></label>` : ''}
      </fieldset>
      ${S.me.primary ? seeBox(x) : ''}
      <label class="tog"><input type="checkbox" name="active" ${(!x || x.active) ? 'checked' : ''}> Account active (untick to block sign-in)</label>
      ${isAdmin() ? `<label class="tog"><input type="checkbox" name="needLoc" ${x && x.needLoc ? 'checked' : ''}> Location required to sign in <span class="muted">(blocks login unless the phone gives a real GPS location, accurate to 500 m)</span></label>
      <div class="field"><label>Payment due until <span class="muted">(after this date/time, login is blocked with a payment-reminder message, until you clear or extend it)</span></label>
        <input class="input" type="datetime-local" name="payDue" value="${x && x.payDue ? x.payDue.replace(' ', 'T').slice(0,16) : ''}"></div>` : ''}
      <div class="foot"><button type="button" class="btn ghost" data-x>Cancel</button><button class="btn" type="submit">${x ? 'Save user' : 'Add user'}</button></div></form>`, 'wide');
  w.querySelector('[data-x]').onclick = () => w.remove();
  const roleEl = w.querySelector('#ufRole');
  if (roleEl) roleEl.onchange = () => { w.querySelector('#ufPerms').disabled = roleEl.value === 'admin'; };
  w.querySelector('#uf').onsubmit = async ev => {
    ev.preventDefault(); const f = new FormData(ev.target), btn = ev.submitter; btn.disabled = true;
    try {
      const r = await api('saveUser', { id: x ? x.id : '', name:f.get('name'), username:f.get('username'), password:f.get('password'), email:f.get('email'),
        role:f.get('role') || 'user', active:!!f.get('active'), needLoc:!!f.get('needLoc'), payDue:f.get('payDue') || '',
        ...(S.me.primary ? { see:f.getAll('see') } : {}),
        perms:{ att:f.get('p_att'), exp:f.get('p_exp'), work:f.get('p_work'), pw:f.get('p_pw'), link:f.get('p_link'), lic:f.get('p_lic'), vcs:f.get('p_vcs'), rack:f.get('p_rack'), tt:f.get('p_tt'), emp:!!f.get('p_emp'), creds:!!f.get('p_creds'), addUser:!!f.get('p_addUser') } });
      S.users = r.users; w.remove(); if (!isAdmin()) await loadAll();   // a new user may have created / joined my group
      render(); toast(x ? 'User updated' : 'User added'); chatLoadUsers();
    } catch(e){ btn.disabled = false; handleErr(e); }
  };
}
/* who may this user see / chat / call / play Ludo with?  Only the main admin decides. Nobody sees anybody without this. */
function seeBox(x){
  const others = (S.users || []).filter(u => !x || u.id !== x.id);
  const auto = o => x && ((x.createdBy || 'ADMIN') === o.id || (o.createdBy || 'ADMIN') === x.id);   // adder <-> added always see each other
  const on = o => auto(o) || (x && ((x.see || []).includes(o.id) || (o.see || []).includes(x.id)));
  const boxes = others.map(o => `<label class="tog"><input type="checkbox" name="see" value="${esc(o.id)}" ${on(o) ? 'checked' : ''} ${auto(o) ? 'disabled' : ''}> ${esc(o.name || o.username)}${o.primary ? ' <span class="muted">(main admin)</span>' : ''} <span class="muted">@${esc(o.username)}${auto(o) ? ' · always (added by / added this user)' : ''}</span></label>`).join('');
  return `<fieldset style="border:1px solid var(--line);border-radius:12px;padding:12px;margin-bottom:14px">
    <legend class="sec-title" style="padding:0 6px;margin:0">💬 Who can this user see in Chat?</legend>
    <p class="muted" style="margin:0 0 6px;font-size:calc(12.5px*var(--fs))">Chat, calls, Ludo and group chats show <b>only</b> the people ticked here (plus whoever added this user / was added by them). Nobody sees anybody without your permission. It works both ways.</p>
    ${boxes || '<div class="muted">No other users yet.</div>'}</fieldset>`;
}
async function delUser(id){
  const u = (S.users || []).find(x => x.id === id); if (!u) return;
  if (!await confirmBox('Delete ' + (u.name || u.username) + '?', 'They will not be able to sign in any more. Their data stays in your sheet.', 'Delete', true)) return;
  try { const r = await api('deleteUser', { id }); S.users = r.users; if (S.as === id){ await setAs(''); } else render(); toast('User deleted'); chatLoadUsers(); } catch(e){ handleErr(e); }
}
async function kickUser(id){
  const u = (S.users || []).find(x => x.id === id); if (!u) return;
  if (!await confirmBox('Sign out ' + (u.name || u.username) + '?', 'They will be signed out on all their devices and must log in again.', 'Sign out')) return;
  try { await api('kickUser', { id }); toast('Signed out'); } catch(e){ handleErr(e); }
}

/* ---------- groups (admin): members of a group see the same data ---------- */
function groupsCard(){
  const rows = (S.groups || []).map(g => `<div class="emp-item"><div class="avatar">👥</div>
    <div class="info"><b>${esc(g.name)}<span class="tag adm">${g.members.length} members</span></b><span>${esc((g.memberNames || []).join(' · ') || '—')}</span></div>
    <div class="acts"><button class="btn ghost sm" onclick="groupForm('${esc(g.id)}')">✎ Edit</button><button class="btn ghost sm" onclick="delGroup('${esc(g.id)}')" title="Delete group">🗑</button></div></div>`).join('');
  return `<div class="card"><h3>👥 Groups <button class="btn sm" onclick="groupForm()">＋ Add group</button></h3>
    <p class="muted" style="margin-bottom:12px">Users in the same group see exactly the same data (attendance, expenses, work, passwords, links). When one member changes something, it appears for the others within a few seconds. A group’s data is separate from everyone else’s.</p>
    <div class="emp-list">${rows || '<div class="empty-state">No groups yet</div>'}</div></div>`;
}
function groupForm(id){
  const x = id ? (S.groups || []).find(g => g.id === id) : null;
  const users = (S.users || []).filter(u => !u.primary);
  const inOther = uid => (S.groups || []).find(g => (!x || g.id !== x.id) && g.members.includes(uid));
  const boxes = users.map(u => { const o = inOther(u.id);
    return `<label class="tog"><input type="checkbox" name="m" value="${esc(u.id)}" ${x && x.members.includes(u.id) ? 'checked' : ''} ${o ? 'disabled' : ''}> ${esc(u.name || u.username)} <span class="muted">@${esc(u.username)}${o ? ' · already in “' + esc(o.name) + '”' : ''}</span></label>`; }).join('');
  const adopt = x ? '' : `<div class="field"><label>Start with existing data of <span class="muted">(optional)</span></label>
    <select class="select" name="adoptFrom"><option value="">Nobody — start with empty group data</option>${users.filter(u => !inOther(u.id)).map(u => `<option value="${esc(u.id)}">${esc(u.name || u.username)}</option>`).join('')}</select>
    <p class="muted" style="margin-top:6px;font-size:calc(12.5px*var(--fs))">That person’s current data becomes the group’s data. The other members’ old data stays in the sheet but is hidden while they are in the group.</p></div>`;
  const w = openModal(`<h3>${x ? 'Edit group' : 'Add group'}</h3><p class="sub">Pick the users who should always see the same data.</p>
    <form id="gf" autocomplete="off">
      <div class="field"><label>Group name</label><input class="input" name="name" maxlength="40" value="${esc(x ? x.name : '')}" required></div>
      <div class="field"><label>Members <span class="muted">(at least 2)</span></label>${boxes || '<div class="muted">Add users first (Settings → Users & access).</div>'}</div>
      ${adopt}
      <div class="foot"><button type="button" class="btn ghost" data-x>Cancel</button><button class="btn" type="submit">${x ? 'Save group' : 'Create group'}</button></div></form>`);
  w.querySelector('[data-x]').onclick = () => w.remove();
  w.querySelector('#gf').onsubmit = async ev => {
    ev.preventDefault(); const f = new FormData(ev.target), btn = ev.submitter;
    const members = f.getAll('m'), adoptFrom = f.get('adoptFrom') || '';
    if (members.length < 2) return toast('Select at least 2 users', true);
    if (adoptFrom && !members.includes(adoptFrom)) return toast('“Existing data of” must be one of the selected members', true);
    btn.disabled = true;
    try {
      const r = await api('saveGroup', { id: x ? x.id : '', name: f.get('name'), members, adoptFrom });
      S.groups = r.groups; w.remove(); await loadAll(); render(); toast(x ? 'Group updated' : 'Group created');
    } catch(e){ btn.disabled = false; handleErr(e); }
  };
}
async function delGroup(id){
  const g = (S.groups || []).find(x => x.id === id); if (!g) return;
  if (!await confirmBox('Delete group “' + g.name + '”?', 'Members go back to their own separate data. The group’s shared data stays in your sheet, but nobody will see it.', 'Delete', true)) return;
  try { const r = await api('deleteGroup', { id }); S.groups = r.groups; await loadAll(); render(); toast('Group deleted'); } catch(e){ handleErr(e); }
}

/* ---------- login activity (admin) ---------- */
function fmtLogTime(t){
  const m = String(t).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/); if (!m) return String(t || '');
  let h = +m[4]; const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return `${+m[3]} ${MON[+m[2] - 1]} ${m[1]}, ${h}:${m[5]} ${ap}`;
}
/* yyyy-MM-dd HH:mm:ss (as written by the server) -> ms, treated as local time, for matching a log row to its photo */
function parseLogTS(t){
  const m = String(t || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/); if (!m) return NaN;
  return new Date(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +m[6]).getTime();
}
/* The security photo is saved by a separate request right after the failed attempt, so match it to the
   log row by username + nearest timestamp (within 5 minutes) rather than by a shared ID. */
function photoForLog(l){
  if (!l || l.result === 'Success' || !(S.photos && S.photos.length)) return null;
  const uname = String(l.username || '').toLowerCase(), t = parseLogTS(l.time);
  let best = null, bestDiff = Infinity;
  for (const p of S.photos){
    if (String(p.username || '').toLowerCase() !== uname) continue;
    const pt = parseLogTS(p.time), diff = Math.abs(pt - t);
    if (diff < bestDiff){ bestDiff = diff; best = p; }
  }
  return (best && bestDiff <= 5 * 60000) ? best : null;
}
function logItem(l, compact){
  const good = l.result === 'Success', who = l.name || l.username || '(unknown)';
  const photo = compact ? null : photoForLog(l);
  const loc = (l.lat != null && l.lng != null)
    ? `📍 ${l.lat.toFixed(5)}, ${l.lng.toFixed(5)} <span class="tag">${esc(/^(GPS|Network)/.test(l.src || '') ? l.src + (l.acc != null ? ' ±' + l.acc + ' m' : '') : (l.src || 'approx.'))}</span>${(l.src === 'IP (approx.)' || (l.acc != null && l.acc > 200)) ? ' <span class="tag off">⚠ not exact</span>' : ''} <a href="https://www.google.com/maps?q=${l.lat},${l.lng}" target="_blank" rel="noopener">Open map ↗</a>`
    : '📍 Location not available';
  const dev = [l.device, l.browser, l.os].filter(Boolean).join(' · ');
  return `<div class="log-item ${good ? '' : 'bad'}">
    <div class="l1"><b>${esc(who)} <span class="muted" style="font-weight:500">@${esc(l.username)}</span></b>
      <span><span class="pill ${good ? 'inc' : 'exp'}">${esc(l.result)}</span> <span class="muted">${esc(fmtLogTime(l.time))}</span></span></div>
    <div class="l2">📱 ${esc(dev || 'Unknown device')}${compact ? '' : (l.screen ? ' · ' + esc(l.screen) : '')}</div>
    <div class="l2">${loc}</div>
    ${compact ? '' : `<div class="l2">🏠 ${esc(l.city || '—')}</div>
    <div class="l2">🌐 ${esc(l.ip || '—')}${l.deviceId ? ' · Device ID ' + esc(l.deviceId.slice(-6)) : ''}${l.tz ? ' · ' + esc(l.tz) : ''}${l.reason ? ' · ' + esc(l.reason) : ''}</div>`}
    ${photo ? `<div class="l2" style="display:flex;gap:10px;margin-top:8px;align-items:center">
      📷 ${photoThumb(photo.front, 'Front camera')}${photoThumb(photo.back, 'Back camera')}
    </div>` : ''}
  </div>`;
}
function photoThumb(src, label){
  return src
    ? `<a href="${src}" target="_blank" rel="noopener" title="${esc(label)} — open full size"><img src="${src}" alt="${esc(label)}" style="width:92px;height:70px;object-fit:cover;border-radius:8px;border:1px solid var(--border,#ddd)"></a>`
    : '';
}

/* ---------- Activity log (every save / add / delete a user makes, not just sign-ins) ---------- */
function activityItem(a){
  return `<div class="log-item">
    <div class="l1"><b>${esc(a.name || a.username || '(unknown)')} <span class="muted" style="font-weight:500">@${esc(a.username)}</span></b>
      <span><span class="pill inc">${esc(a.action)}</span> <span class="muted">${esc(fmtLogTime(a.time))}</span></span></div>
    ${a.detail ? `<div class="l2">📝 ${esc(a.detail)}</div>` : ''}
  </div>`;
}
function filteredActivity(){
  const f = S.af, q = f.q.trim().toLowerCase();
  return (S.acts || []).filter(a => (f.u === 'all' || a.uid === f.u)
    && (!q || [a.name, a.username, a.action, a.detail].join(' ').toLowerCase().includes(q)));
}
function drawActivityList(){
  const list = filteredActivity(), el = $('#actList'); if (!el) return;
  el.innerHTML = list.map(a => activityItem(a)).join('') || '<div class="empty-state">No activity yet</div>';
}
async function activityPdf(){
  const list = filteredActivity(); if (!list.length) return toast('No activity to export', true);
  toast('Preparing your PDF file…');
  try {
    await needPdf();
    const u = S.af.u !== 'all' ? ((S.users || []).find(x => x.id === S.af.u) || {}).name || '' : '';
    const P = { doc:new window.jspdf.jsPDF({ orientation:'l', unit:'mm', format:'a4' }) };
    const y = pdfStart(P, 'Activity Log', `${u ? 'User: ' + u + '   |   ' : ''}${list.length} entr${list.length === 1 ? 'y' : 'ies'}   |   Generated ${STAMP()}`, 'l', true);
    pdfTable(P, { startY:y, head:[['Date & time', 'User', 'Username', 'Action', 'Details']],
      body:list.map(a => [fmtLogTime(a.time), a.name || '', a.username || '', a.action || '', a.detail || ''].map(PT)),
      columnStyles:{ 0:{ cellWidth:38 }, 1:{ cellWidth:40 }, 2:{ cellWidth:34 }, 3:{ cellWidth:62 } },
      didParseCell:h => { if (h.section === 'head') h.cell.styles.halign = 'left'; } });
    pdfFooter(P.doc); saveBlob('Activity-Log-' + new Date().toISOString().slice(0, 10) + '.pdf', P.doc.output('blob'));
  } catch(e){ toast(e.message || 'Could not create the PDF', true); }
}
function activityCard(){
  const users = S.users || [];
  const known = new Set(users.map(u => u.id)), extra = [...new Map((S.acts || []).filter(a => a.uid && !known.has(a.uid)).map(a => [a.uid, a.name || a.username])).entries()];
  const uopts = '<option value="all">All users</option>' + users.map(u => `<option value="${esc(u.id)}" ${S.af.u === u.id ? 'selected' : ''}>${esc(u.name || u.username)}</option>`).join('')
    + extra.map(([id, n]) => `<option value="${esc(id)}" ${S.af.u === id ? 'selected' : ''}>${esc(n)} (deleted)</option>`).join('');
  return `<div class="card"><h3>📋 Activity log <span><button class="btn soft sm" onclick="activityPdf()">⬇ PDF</button> <button class="btn ghost sm" onclick="loadActivity()">↻ Refresh</button></span></h3>
    <p class="muted" style="margin-bottom:12px">${isAdmin() ? 'Every save, add or delete each user made — attendance, expenses, work, time table and more.' : 'Every save, add or delete you made.'}</p>
    ${isAdmin() ? `<div class="form-grid"><div class="field"><label>User</label><select class="select" id="afU">${uopts}</select></div>
      <div class="field"><label>Search</label><input class="input" id="afQ" placeholder="action, detail…" value="${esc(S.af.q)}"></div></div>` : ''}
    ${S.me.primary ? `<label class="tog"><input type="checkbox" id="actUsersChk" ${S.me.actUsers ? 'checked' : ''}> Let regular users see <b>their own</b> activity log <span class="muted">(off = only admins can open the log)</span></label>` : ''}
    <div id="actList">${S.acts ? '' : '<div class="empty-state">Loading activity…</div>'}</div></div>`;
}

function recentLoginsCard(){
  const list = (S.logs || []).slice(0, 6);
  return `<div class="card" style="margin-top:16px"><h3>🔐 Recent logins <button class="btn ghost sm" onclick="go('logins')">View all →</button></h3>
    <div class="loglist">${S.logs ? (list.map(l => logItem(l, true)).join('') || '<div class="empty-state">No logins recorded yet</div>') : '<div class="empty-state">Loading…</div>'}</div></div>`;
}
function filteredLogs(){
  const f = S.lf, q = f.q.trim().toLowerCase();
  return (S.logs || []).filter(l => (f.u === 'all' || l.uid === f.u) && (f.r === 'all' || (f.r === 'ok' ? l.result === 'Success' : l.result !== 'Success'))
    && (!q || [l.name, l.username, l.device, l.browser, l.os, l.ip, l.city, l.deviceId].join(' ').toLowerCase().includes(q)));
}
function drawLogList(){
  const list = filteredLogs(), el = $('#logList'); if (!el) return;
  const ok = list.filter(l => l.result === 'Success').length, devs = new Set(list.filter(l => l.deviceId).map(l => l.uid + '|' + l.deviceId)).size;
  $('#logSum').innerHTML = `<span class="chip">Showing ${list.length}</span><span class="chip" style="background:var(--good-soft)">Success ${ok}</span><span class="chip" style="background:var(--bad-soft)">Failed / blocked ${list.length - ok}</span><span class="chip">Devices ${devs}</span>`;
  el.innerHTML = list.map(l => logItem(l)).join('') || '<div class="empty-state">No logins match</div>';
}
function vLogins(){
  const f = S.lf, users = S.users || [];
  const known = new Set(users.map(u => u.id)), extra = [...new Map((S.logs || []).filter(l => l.uid && !known.has(l.uid)).map(l => [l.uid, l.name || l.username])).entries()];
  const uopts = '<option value="all">All users</option>' + users.map(u => `<option value="${esc(u.id)}" ${f.u === u.id ? 'selected' : ''}>${esc(u.name || u.username)}</option>`).join('')
    + extra.map(([id, n]) => `<option value="${esc(id)}" ${f.u === id ? 'selected' : ''}>${esc(n)} (deleted)</option>`).join('');
  return `<div class="card" style="margin-bottom:16px"><h3>🔐 Login activity <button class="btn ghost sm" onclick="loadLogs()">↻ Refresh</button></h3>
    <p class="muted" style="margin-bottom:12px">Every sign-in attempt: who, when, from where (latitude / longitude) and from which device. <b>GPS</b> = the phone’s exact location (the user must allow it); <b>IP</b> = approximate, city-level.</p>
    <div class="form-grid"><div class="field"><label>User</label><select class="select" id="lfU">${uopts}</select></div>
      <div class="field"><label>Result</label><select class="select" id="lfR"><option value="all">All</option><option value="ok" ${f.r==='ok'?'selected':''}>Success only</option><option value="bad" ${f.r==='bad'?'selected':''}>Failed / blocked only</option></select></div>
      <div class="field"><label>Search</label><input class="input" id="lfQ" placeholder="device, city, IP…" value="${esc(f.q)}"></div></div>
    <div class="chips" id="logSum"></div></div>
    <div class="loglist" id="logList">${S.logs ? '' : '<div class="card"><div class="empty-state">Loading login activity…</div></div>'}</div>
    ${photosCard()}`;
}
function bindLogins(){
  if (!$('#lfU')) return;
  $('#lfU').onchange = e => { S.lf.u = e.target.value; drawLogList(); };
  $('#lfR').onchange = e => { S.lf.r = e.target.value; drawLogList(); };
  $('#lfQ').oninput = e => { S.lf.q = e.target.value; drawLogList(); };
  if (S.logs) drawLogList();
}

/* ---------- Security photos (front + back camera, taken only on a wrong username/password) ----------
   Loaded together with the login log itself (see loadLogs) and shown INSIDE each matching "Failed" /
   "Blocked" row via photoForLog() + photoThumb() above. This card only lists photos that could NOT be
   matched to a visible row (e.g. the log row has since scrolled out of the loaded 300, or the clocks
   drifted by more than 5 minutes), so nothing taken gets lost / hidden. */
function unmatchedPhotos(){
  if (!(S.photos && S.photos.length)) return [];
  const shown = new Set();
  (S.logs || []).forEach(l => { const p = photoForLog(l); if (p) shown.add(p); });
  return S.photos.filter(p => !shown.has(p));
}
function photoItem(p){
  return `<div class="log-item bad">
    <div class="l1"><b>@${esc(p.username)}</b><span class="muted">${esc(fmtLogTime(p.time))}</span></div>
    <div class="l2">${esc(p.reason || 'Wrong username/password')}</div>
    <div class="l2" style="display:flex;gap:10px;margin-top:6px">${photoThumb(p.front, 'Front camera') || '<span class="muted" style="font-size:calc(12px*var(--fs))">no front photo</span>'}${photoThumb(p.back, 'Back camera') || '<span class="muted" style="font-size:calc(12px*var(--fs))">no back photo</span>'}</div>
  </div>`;
}
function photosCard(){
  if (!isAdmin() || !S.photos) return '';
  const extra = unmatchedPhotos();
  if (!extra.length) return '';
  return `<div class="card" style="margin-top:16px">
    <h3>📷 Other security photos</h3>
    <p class="muted" style="margin-bottom:12px">Taken on a wrong username/password but not next to a row above (older than what's loaded, or the clocks drifted a bit).</p>
    <div class="loglist">${extra.map(photoItem).join('')}</div>
  </div>`;
}

/* =====================================================================
   VIEW: DEPLOY  (main admin only) — publish updated files to GitHub, Render redeploys by itself
   ===================================================================== */
const DEP = { st:null, files:null, commits:[], hist:null, hpath:'', err:'', prog:null, timer:null, ticks:0 };
const depBase = p => String(p).split('/').pop();
const depBackend = p => /^(server\.js|code\.gs|package\.json|google-store\.js|gas-shim\.js)$/i.test(depBase(p));
const depWhen = t => { const d = new Date(t); return isNaN(d) ? '' : d.toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }); };
async function depLoad(){
  try { DEP.st = await api('deployStatus'); } catch(e){ DEP.st = { configured:false }; DEP.err = e.message; }
  if (DEP.st.configured){
    try { const r = await api('deployFiles'); DEP.files = r.files; DEP.commits = r.commits; DEP.err = ''; }
    catch(e){ DEP.err = e.message; DEP.files = DEP.files || []; }
    await depPoll();
    if (DEP.prog && DEP.prog.state === 'pending' && Date.now() - new Date(DEP.prog.at).getTime() < 15 * 60000) depWatch(true);   // a deploy is still running
  }
  if (S.view === 'deploy') render();
}
/* ---- live progress: the same x/3 checks GitHub shows next to the commit (pending -> 1/3 -> 2/3 -> 3/3 = live) ---- */
async function depPoll(){
  try { const j = await callServer({ action:'deployProgress', token:S.token }); if (j.ok) DEP.prog = j; } catch(e){}
  return DEP.prog;
}
function depDraw(){ const el = document.getElementById('depProg'); if (S.view === 'deploy' && el) el.innerHTML = depProgHtml(); }
function depWatch(resume){
  clearInterval(DEP.timer); DEP.ticks = 0;
  if (!resume) DEP.prog = { state:'pending', total:0, done:0, items:[], at:new Date().toISOString(), msg:'Publishing…', short:'', fresh:true };
  depDraw();
  DEP.timer = setInterval(async () => {
    if (!S.token || ++DEP.ticks > 150){ clearInterval(DEP.timer); return; }     // stop after ~12 minutes
    const before = DEP.prog && DEP.prog.state;
    const p = await depPoll(); depDraw();
    if (p && p.state !== 'pending'){
      clearInterval(DEP.timer);
      if (before !== p.state || DEP.ticks > 1) toast(p.state === 'success' ? '✅ Live! ' + p.done + '/' + p.total + ' checks passed' : '❌ Deploy failed (' + p.done + '/' + p.total + ') — open the Live status card', p.state !== 'success');
    }
  }, 5000);
}
function depProgHtml(){
  const p = DEP.prog; if (!p) return '<div class="muted">Loading status…</div>';
  const age = Date.now() - new Date(p.at || Date.now()).getTime();
  if (!p.total){
    if (p.limited) return `<div class="log-item bad"><div class="l1"><b>Live progress needs 2 more token permissions</b></div>
      <div class="l2">GitHub → Settings → Developer settings → Fine-grained tokens → your token → <b>Edit</b> → Repository permissions: set <b>Commit statuses</b> and <b>Checks</b> to <b>Read-only</b> → Update. (No new token, nothing to change on Render.)</div></div>`;
    return `<div class="log-item"><div class="l1"><b>${age > 5 * 60000 && !p.fresh ? 'No status checks found for the latest commit' : '⏳ Waiting for the deploy to start…'}</b></div>
      <div class="l2">${esc(p.msg || '')}${p.short ? ' · <code>' + esc(p.short) + '</code>' : ''}</div></div>`;
  }
  const col = { ok:'#16a34a', wait:'#f59e0b', bad:'#dc2626' }, ic = { ok:'✔', wait:'⏳', bad:'✖' };
  const head = p.state === 'success' ? `✅ Live — ${p.done}/${p.total}` : p.state === 'failure' ? `❌ Failed — ${p.done}/${p.total}` : `🟡 Going live… ${p.done}/${p.total}`;
  return `<div style="font-weight:800;font-size:calc(18px*var(--fs));margin-bottom:8px">${head}</div>
    <div style="display:flex;gap:4px;margin-bottom:10px">${p.items.map(x => `<div style="flex:1;height:8px;border-radius:4px;background:${col[x.state]}${x.state === 'wait' ? ';opacity:.55' : ''}"></div>`).join('')}</div>
    ${p.items.map(x => `<div class="l2">${ic[x.state]} ${esc(x.name)}</div>`).join('')}
    <div class="muted" style="margin-top:8px;font-size:calc(12.5px*var(--fs))">${esc(p.msg || '')} · <code>${esc(p.short || '')}</code>${p.state === 'pending' ? ' · updates by itself every 5 seconds' : ''}</div>`;
}
function vDeploy(){
  if (!DEP.st) return '<div class="card"><div class="empty-state">Loading…</div></div>';
  if (!DEP.st.configured) return `<div class="card"><h3>🚀 Connect GitHub (one time)</h3>
    <p class="muted" style="margin-bottom:10px">So the app can publish files for you, give it a key to <b>one</b> repository. The key stays on the server (Render) — it is never shown in the app.</p>
    <ol style="margin:0 0 12px 18px;line-height:1.7">
      <li>On GitHub: <b>Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token</b>.</li>
      <li><b>Repository access</b>: “Only select repositories” → pick your website repository.</li>
      <li><b>Permissions → Repository permissions → Contents: Read and write</b>. Generate and copy the token.</li>
      <li>On Render → your service → <b>Environment</b>, add: <code>GITHUB_TOKEN</code> = the token, <code>GITHUB_REPO</code> = <code>your-name/your-repo</code>, and (only if not “main”) <code>GITHUB_BRANCH</code>.</li>
      <li>For the live progress (1/3, 2/3, 3/3) also set <b>Commit statuses</b> and <b>Checks</b> to <b>Read-only</b> in the token’s permissions.</li>
      <li>Save — Render restarts — then open this tab again.</li></ol>
    ${DEP.err ? `<p class="muted">${esc(DEP.err)}</p>` : ''}
    <button class="btn soft sm" onclick="depLoad()">↻ Check again</button></div>`;
  const files = DEP.files || [];
  const fileOpts = files.map(f => `<option value="${esc(f.path)}" ${DEP.hpath === f.path ? 'selected' : ''}>${esc(f.path)}</option>`).join('');
  const commitRow = (c, path) => `<div class="log-item"><div class="l1"><b style="word-break:break-word">${esc(c.msg || '(no message)')}</b>
      <span class="muted">${esc(depWhen(c.at))}</span></div>
      <div class="l2">${esc(c.by || '')} · <code>${esc(c.short)}</code>${path ? ` <button class="btn soft sm" style="margin-left:8px" onclick="depRestore('${esc(path)}','${esc(c.sha)}')">↩ Restore this version</button>` : ''}</div></div>`;
  return `<div class="card" style="margin-bottom:16px"><h3>📡 Live status <button class="btn ghost sm" onclick="depLoad()">↻ Refresh</button></h3>
      <div id="depProg">${depProgHtml()}</div></div>
    <div class="card" style="margin-bottom:16px"><h3>🚀 Publish to GitHub</h3>
      <p class="muted" style="margin-bottom:12px">Repository <b>${esc(DEP.st.repo)}</b> · branch <b>${esc(DEP.st.branch)}</b>. Choose the updated files; they go to GitHub as <b>one commit</b> and Render redeploys by itself (about 1–2 minutes).</p>
      ${DEP.err ? `<div class="log-item bad"><div class="l1"><b>${esc(DEP.err)}</b></div></div>` : ''}
      <div class="field"><label>Updated files <span class="muted">(app.js, style.css, index.html, server.js … you can pick several)</span></label>
        <input class="input" type="file" id="depFiles" multiple></div>
      <div class="actions"><button class="btn" onclick="depReview()">Review &amp; publish →</button></div>
      <p class="muted" style="margin-top:10px;font-size:calc(12.5px*var(--fs))">Safety: a JS/JSON file with a mistake is refused before it reaches GitHub. Changing <code>server.js</code>, <code>package.json</code> or other server files asks for an extra confirmation. <code>Code.gs</code> still has to be pasted into Apps Script by hand.</p></div>
    <div class="card" style="margin-bottom:16px"><h3>🕘 File history &amp; restore</h3>
      <div class="form-grid"><div class="field"><label>File</label><select class="select" id="depHSel"><option value="">Choose a file…</option>${fileOpts}</select></div></div>
      <div id="depHist">${DEP.hist ? (DEP.hist.map(c => commitRow(c, DEP.hpath)).join('') || '<div class="empty-state">No history for this file</div>') : '<div class="muted">Pick a file to see its older versions and bring one back.</div>'}</div></div>
    <div class="card"><h3>📜 Recent changes on GitHub</h3>
      ${(DEP.commits || []).map(c => commitRow(c, '')).join('') || '<div class="empty-state">No commits</div>'}
      <details style="margin-top:12px"><summary class="muted" style="cursor:pointer">Files in the repository (${files.length})</summary>
        <div style="margin-top:8px">${files.map(f => `<div class="l2">📄 ${esc(f.path)} <span class="muted">${(f.size / 1024).toFixed(1)} KB</span></div>`).join('')}</div></details></div>`;
}
function bindDeploy(){
  const sel = document.getElementById('depHSel');
  if (sel) sel.onchange = async e => {
    DEP.hpath = e.target.value; DEP.hist = null;
    if (!DEP.hpath){ render(); return; }
    try { DEP.hist = (await api('deployHistory', { path:DEP.hpath })).commits; } catch(err){ DEP.hist = []; handleErr(err); }
    render();
  };
}
async function depReview(){
  const fl = [...(document.getElementById('depFiles').files || [])];
  if (!fl.length) return toast('Choose the files to publish first', true);
  const bad = fl.find(f => !/\.(js|css|html|md|json|gs|txt|svg)$/i.test(f.name));
  if (bad) return toast(bad.name + ' — only js, css, html, md, json, gs, txt, svg files can be published', true);
  const rows = []; let total = 0;
  for (const f of fl){
    if (f.size > 900 * 1024) return toast(f.name + ' is too big (max 900 KB)', true);
    total += f.size; const text = await f.text();
    if (!text.trim()) return toast(f.name + ' is empty', true);
    const m = (DEP.files || []).filter(x => depBase(x.path).toLowerCase() === f.name.toLowerCase());
    rows.push({ name:f.name, text, size:f.size, matches:m });
  }
  if (total > 1500 * 1024) return toast('The files together are too big for one upload', true);
  const backend = rows.some(r => depBackend(r.name));
  const w = openModal(`<h3>Publish to GitHub</h3>
    <p class="sub">${esc(DEP.st.repo)} · ${esc(DEP.st.branch)} — one commit, then the site redeploys.</p>
    ${rows.map((r, i) => `<div class="log-item"><div class="l1"><b>${esc(r.name)}</b> <span class="muted">${(r.size / 1024).toFixed(1)} KB</span></div>
      <div class="l2">${r.matches.length > 1 ? `Replace: <select class="select" data-i="${i}">${r.matches.map(x => `<option>${esc(x.path)}</option>`).join('')}</select>`
        : r.matches.length ? `Replaces <code>${esc(r.matches[0].path)}</code>` : `<span class="pill exp">NEW</span> not in the repository yet — will be added as <code>${esc(r.name)}</code>`}</div></div>`).join('')}
    ${backend ? '<div class="log-item bad"><div class="l1"><b>⚠ This changes the server itself.</b></div><div class="l2">A mistake here can take the whole site down until you restore the old version (File history). The server restarts and running Ludo games end.</div></div>' : ''}
    <div class="field"><label>Note (optional)</label><input class="input" id="depMsg" maxlength="120" placeholder="What changed?"></div>
    <div class="foot"><button class="btn ghost" data-x>Cancel</button><button class="btn" data-go>${backend ? 'I understand — publish' : 'Publish'}</button></div>`);
  w.querySelector('[data-x]').onclick = () => w.remove();
  w.querySelector('[data-go]').onclick = async ev => {
    const btn = ev.currentTarget; btn.disabled = true;
    const files = rows.map((r, i) => { const s = w.querySelector(`select[data-i="${i}"]`); return { path: s ? s.value : (r.matches[0] ? r.matches[0].path : r.name), content:r.text }; });
    try {
      const r = await api('deployUpload', { files, message:(w.querySelector('#depMsg').value || '').trim(), confirmBackend:backend });
      w.remove();
      if (r.unchanged) toast('Nothing changed — these files are already the same on GitHub');
      else { toast('Published ' + r.changed.length + ' file' + (r.changed.length === 1 ? '' : 's') + ' — watch the Live status card'); document.getElementById('depFiles').value = ''; }
      await depLoad(); if (!r.unchanged) depWatch();
    } catch(e){ btn.disabled = false; handleErr(e); }
  };
}
async function depRestore(path, sha){
  const backend = depBackend(path);
  if (!await confirmBackendOk(path, backend)) return;
  try {
    const r = await api('deployRestore', { path, sha, confirmBackend:backend });
    toast(r.unchanged ? 'That version is already live' : 'Restored — the site will be live in 1–2 minutes');
    DEP.hist = null; DEP.hpath = ''; await depLoad(); if (!r.unchanged) depWatch();
  } catch(e){ handleErr(e); }
}
const confirmBackendOk = (path, backend) => confirmBox('Restore this version of ' + depBase(path) + '?', backend ? 'This is a server file: the server restarts and a wrong version can take the site down.' : 'It is published as a new commit and the site redeploys.', 'Restore', backend);

/* =====================================================================
   VIEW: VERSION — choose repository files, GitHub builds an Android APK, download it here
   ===================================================================== */
const VER = { files:null, sel:new Set(), builds:[], err:'', ready:true, busy:false, starting:false, lastRun:0, timer:null,
  name:'KS', id:'com.ks.app', ver:'1.0', seeded:false };
const VER_SKIP = /^(server\.js|code\.gs|gas-shim\.js|google-store\.js|package(-lock)?\.json|readme\.md)$/i;
const verWebFile = p => /\.(html|js|css|json|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|webmanifest|mp3|wav|mp4)$/i.test(p) && !VER_SKIP.test(p) && !/^(test|docs|\.github)\//i.test(p);
async function verLoad(){
  try {
    const st = await api('deployStatus'); VER.ready = !!st.configured;
    if (VER.ready){
      const r = await api('verFiles'); VER.files = r.files;
      if (!VER.seeded){ VER.files.filter(f => verWebFile(f.path)).forEach(f => VER.sel.add(f.path)); VER.seeded = true; }
      await verRefresh(true); VER.err = '';
    } else VER.files = [];
  } catch(e){ VER.err = e.message; VER.files = VER.files || []; if (e.code === 'AUTH' || e.code === 'PAYDUE') handleErr(e); }
  if (S.view === 'version') render();
  verWatch();
}
async function verRefresh(quiet){
  try { VER.builds = (await api('verList')).builds || []; if (VER.builds[0]) VER.lastRun = Math.max(VER.lastRun, VER.builds[0].id); }
  catch(e){ if (!quiet) VER.err = e.message; else VER.err = e.message; }
}
function verBuildsHtml(){
  const rows = VER.builds.map(b => {
    const run = b.status !== 'completed', ok = b.conclusion === 'success';
    return `<div class="log-item ${!run && !ok ? 'bad' : ''}"><div class="l1"><b style="word-break:break-word">${esc(b.title || ('Build #' + b.no))}</b><span class="muted">${esc(depWhen(b.at))}</span></div>
      <div class="l2">${run ? '⏳ Building… (about 5–8 minutes)' : ok ? '✅ Ready' : '❌ Build failed — open the log to see why'}${b.asset ? ' · ' + updSize(b.asset.size) : ''}</div>
      <div class="actions" style="margin-top:6px">${b.asset ? `<button class="btn sm" data-vdl="${esc(b.asset.id)}">⬇ Download APK</button>` : ''}
        <a class="btn soft sm" href="${esc(b.url)}" target="_blank" rel="noopener">Log ↗</a></div></div>`;
  }).join('');
  return (VER.starting ? '<div class="log-item"><div class="l1"><b>⏳ Starting the build…</b></div></div>' : '') + (rows || (VER.starting ? '' : '<div class="empty-state">No builds yet</div>'));
}
function vVersion(){
  if (!VER.files) return '<div class="card"><div class="empty-state">Loading…</div></div>';
  if (!VER.ready) return `<div class="card"><h3>📱 Connect GitHub first</h3><p class="muted">Open the <b>Deploy</b> tab and connect GitHub (GITHUB_TOKEN + GITHUB_REPO on Render). For this tab the token also needs <b>Actions: Read and write</b>.</p></div>`;
  const rows = VER.files.map(f => `<label class="log-item" data-vp="${esc(f.path.toLowerCase())}" style="display:flex;gap:10px;align-items:center;cursor:pointer;padding:8px 10px">
      <input type="checkbox" data-vf="${esc(f.path)}" ${VER.sel.has(f.path) ? 'checked' : ''}><span style="flex:1;min-width:0;word-break:break-all">📄 ${esc(f.path)}</span><span class="muted">${updSize(f.size)}</span></label>`).join('');
  return `<div class="card" style="margin-bottom:16px"><h3>📱 Make an Android app (.apk)</h3>
      <p class="muted" style="margin-bottom:10px">Tick the files of your website. GitHub combines them into one Android app; when it is ready, download the <b>.apk</b> here and install it on your phone.
      Keep <code>index.html</code> ticked. Server files (server.js, Code.gs …) are not needed inside the app — the app talks to your Render server.</p>
      ${VER.err ? `<div class="log-item bad"><div class="l1"><b>${esc(VER.err)}</b></div></div>` : ''}
      <div class="form-grid">
        <div class="field"><label>App name</label><input class="input" id="verName" maxlength="30" value="${esc(VER.name)}"></div>
        <div class="field"><label>Package id</label><input class="input" id="verId" maxlength="60" value="${esc(VER.id)}" autocapitalize="off"></div>
        <div class="field"><label>Version</label><input class="input" id="verVer" maxlength="12" value="${esc(VER.ver)}"></div></div>
      <div class="actions" style="margin:8px 0"><input class="input" id="verQ" placeholder="Search files…" style="flex:1;min-width:140px">
        <button class="btn soft sm" id="verAll">Select all</button><button class="btn soft sm" id="verNone">Clear</button></div>
      <div id="verList" style="max-height:340px;overflow:auto;border:1px solid var(--line,#e5e7eb);border-radius:10px">${rows || '<div class="empty-state">No files found</div>'}</div>
      <div class="actions" style="margin-top:12px"><span class="muted" id="verCnt"></span><button class="btn" id="verGo" ${VER.busy ? 'disabled' : ''}>🔨 Build APK</button></div></div>
    <div class="card"><h3>📦 Builds <button class="btn ghost sm" id="verRef">↻ Refresh</button></h3><div id="verBuilds">${verBuildsHtml()}</div></div>`;
}
function verCount(){ const c = document.getElementById('verCnt'); if (c) c.textContent = VER.sel.size + ' of ' + (VER.files || []).length + ' files selected'; }
function bindVersion(){
  const $q = id => document.getElementById(id);
  verCount();
  document.querySelectorAll('[data-vf]').forEach(c => c.onchange = () => { c.checked ? VER.sel.add(c.dataset.vf) : VER.sel.delete(c.dataset.vf); verCount(); });
  const setAll = on => document.querySelectorAll('#verList [data-vf]').forEach(c => { if (c.closest('label').style.display === 'none') return; c.checked = on; on ? VER.sel.add(c.dataset.vf) : VER.sel.delete(c.dataset.vf); });
  if ($q('verAll')) $q('verAll').onclick = () => { setAll(true); verCount(); };
  if ($q('verNone')) $q('verNone').onclick = () => { setAll(false); verCount(); };
  if ($q('verQ')) $q('verQ').oninput = e => { const q = e.target.value.trim().toLowerCase(); document.querySelectorAll('#verList [data-vp]').forEach(l => l.style.display = !q || l.dataset.vp.includes(q) ? '' : 'none'); };
  ['verName:name', 'verId:id', 'verVer:ver'].forEach(x => { const [i, k] = x.split(':'); if ($q(i)) $q(i).oninput = e => { VER[k] = e.target.value; }; });
  if ($q('verRef')) $q('verRef').onclick = async () => { await verRefresh(); verDraw(); verWatch(); };
  if ($q('verGo')) $q('verGo').onclick = verBuild;
  const bx = $q('verBuilds'); if (bx) bx.onclick = e => { const b = e.target.closest('[data-vdl]'); if (b) verDownload(b.dataset.vdl); };
}
function verDraw(){ const el = document.getElementById('verBuilds'); if (S.view === 'version' && el) el.innerHTML = verBuildsHtml(); }
async function verBuild(){
  if (VER.busy) return;
  const files = [...VER.sel]; if (!files.length) return toast('Choose the files first', true);
  if (!files.includes('index.html')) return toast('index.html must be ticked — it is the first screen of the app', true);
  VER.busy = true; const btn = document.getElementById('verGo'); if (btn) btn.disabled = true;
  try {
    await api('verBuild', { files, appName:VER.name.trim(), appId:VER.id.trim(), version:VER.ver.trim() });
    toast('Build started — it takes about 5–8 minutes'); VER.starting = true; VER.err = ''; verDraw(); verWatch();
  } catch(e){ handleErr(e); }
  VER.busy = false; if (btn) btn.disabled = false;
}
function verWatch(){
  clearInterval(VER.timer); VER.ticks = 0;
  const need = () => VER.starting || VER.builds.some(b => b.status !== 'completed');
  if (!need()) return;
  VER.timer = setInterval(async () => {
    if (S.view !== 'version' || ++VER.ticks > 120){ clearInterval(VER.timer); return; }
    const before = VER.lastRun; await verRefresh(true);
    if (VER.starting && VER.lastRun > before) VER.starting = false;
    if (VER.starting && VER.ticks > 12) VER.starting = false;
    verDraw();
    if (!need()) clearInterval(VER.timer);
  }, 10000);
}
async function verDownload(asset){
  try {
    const r = await api('verTicket', { asset });
    const a = document.createElement('a'); a.href = API_URL + '/updates/download?id=' + encodeURIComponent(r.id) + '&k=' + encodeURIComponent(r.ticket); a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove(); toast('Download started — open the .apk to install');
  } catch(e){ handleErr(e); }
}

/* =====================================================================
   VIEW: UPDATES — the main admin uploads app files, every signed-in user can download them
   ===================================================================== */
const UPD = { items:null, can:false, ready:true, max:40 * 1024 * 1024, err:'', open:false, busy:false };
const updSize = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
async function updLoad(){
  try { const r = await api('updList'); UPD.items = r.items; UPD.can = !!r.canManage; UPD.ready = r.ready !== false; UPD.max = r.max || UPD.max; UPD.err = ''; }
  catch(e){ UPD.err = e.message; UPD.items = UPD.items || []; if (e.code === 'AUTH' || e.code === 'PAYDUE') handleErr(e); }
  if (S.view === 'updates') render();
}
function updItemHtml(u){
  return `<div class="log-item upd"><div class="l1"><b style="word-break:break-word">${esc(u.title)}</b>${u.version ? `<span class="tag adm">${esc(u.version)}</span>` : ''}
      <span class="muted">${esc(depWhen(u.at))}</span></div>
    ${u.notes ? `<div class="l2" style="white-space:pre-wrap">${esc(u.notes)}</div>` : ''}
    <div class="l2">📄 ${esc(u.name)} · ${updSize(u.size)}</div>
    <div class="actions" style="margin-top:6px"><button class="btn sm" data-dl="${esc(u.id)}">⬇ Download</button>
      ${UPD.can ? `<button class="btn soft sm" data-ed="${esc(u.id)}">✏️ Edit</button><button class="btn danger sm" data-del="${esc(u.id)}">🗑 Delete</button>` : ''}</div></div>`;
}
function vUpdates(){
  if (!UPD.items) return '<div class="card"><div class="empty-state">Loading…</div></div>';
  const box = !UPD.can ? '' : !UPD.ready
    ? `<div class="card" style="margin-bottom:16px"><h3>🔌 Connect GitHub first</h3><p class="muted">Uploads are stored in your GitHub repository. Open the <b>Deploy</b> tab and follow the one-time setup (<code>GITHUB_TOKEN</code> and <code>GITHUB_REPO</code> on Render), then come back here.</p></div>`
    : `<details class="card regbox" id="updBox" style="margin-bottom:16px" ${UPD.open ? 'open' : ''}>
      <summary>＋ Upload a new update</summary>
      <div class="field"><label>File <span class="muted">(any type, up to ${Math.round(UPD.max / 1048576)} MB)</span></label>
        <input class="input upd-file" type="file" id="updFile"></div>
      <div class="form-grid">
        <div class="field"><label>Title</label><input class="input" id="updTitle" maxlength="120" placeholder="e.g. Attendance App – new look"></div>
        <div class="field"><label>Version <span class="muted">(optional)</span></label><input class="input" id="updVer" maxlength="40" placeholder="e.g. v2.4"></div></div>
      <div class="field"><label>What is new? <span class="muted">(optional)</span></label><textarea class="input" id="updNotes" maxlength="600" rows="3" placeholder="Short note for the users"></textarea></div>
      <div class="actions"><button class="btn" id="updGo">⬆ Upload</button></div>
      <div id="updProg"></div></details>`;
  const items = UPD.items;
  return box + (UPD.err ? `<div class="log-item bad" style="margin-bottom:12px"><div class="l1"><b>${esc(UPD.err)}</b></div></div>` : '') +
    `<div class="card"><h3>⬇️ Available updates <button class="btn ghost sm" onclick="updLoad()">↻ Refresh</button></h3>
      <p class="muted" style="margin-bottom:12px">Download the file and install it to update the application.</p>
      <div class="loglist">${items.map(updItemHtml).join('') || '<div class="empty-state">No updates have been uploaded yet</div>'}</div></div>`;
}
function bindUpdates(){
  const v = $('#view');
  v.querySelectorAll('[data-dl]').forEach(b => b.onclick = () => updDownload(b.dataset.dl));
  v.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => updEdit(b.dataset.ed));
  v.querySelectorAll('[data-del]').forEach(b => b.onclick = () => updDelete(b.dataset.del));
  const up = $('#updGo'); if (up) up.onclick = updSubmit;
  const f = $('#updFile'); if (f) f.onchange = () => { const t = $('#updTitle'); if (f.files[0] && t && !t.value.trim()) t.value = f.files[0].name.replace(/\.[^.]+$/, ''); };
  const box = $('#updBox'); if (box) box.ontoggle = () => { UPD.open = box.open; };
}
async function updDownload(id){
  try {
    const r = await api('updTicket', { id });                 // a 2-minute pass, so your login is never put in the link
    const a = document.createElement('a'); a.href = API_URL + '/updates/download?id=' + encodeURIComponent(id) + '&k=' + encodeURIComponent(r.ticket); a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    toast('Download started');
  } catch(e){ handleErr(e); if (e.code === 'UPD') updLoad(); }
}
async function updSubmit(){
  if (UPD.busy) return;
  const f = ($('#updFile').files || [])[0];
  if (!f) return toast('Choose a file first', true);
  if (!f.size) return toast('This file is empty', true);
  if (f.size > UPD.max) return toast('This file is too big (max ' + Math.round(UPD.max / 1048576) + ' MB)', true);
  const q = new URLSearchParams({ name:f.name, title:($('#updTitle').value || '').trim(), version:($('#updVer').value || '').trim(), notes:($('#updNotes').value || '').trim() });
  const btn = $('#updGo'), prog = $('#updProg'); btn.disabled = true; UPD.busy = true;
  const bar = pct => { prog.innerHTML = `<div class="upbar"><i style="width:${pct}%"></i></div><div class="muted" style="font-size:calc(12.5px*var(--fs))">${pct < 100 ? 'Uploading… ' + pct + '%' : 'Saving to GitHub… please wait'}</div>`; };
  bar(0); busy(true);
  try {
    const r = await new Promise((resolve, reject) => {
      const x = new XMLHttpRequest(); x.open('POST', API_URL + '/updates/upload?' + q.toString());
      x.setRequestHeader('Authorization', 'Bearer ' + S.token); x.setRequestHeader('Content-Type', 'application/octet-stream');
      x.upload.onprogress = e => { if (e.lengthComputable && document.body.contains(prog)) bar(Math.min(100, Math.round(e.loaded * 100 / e.total))); };
      x.onload = () => { try { resolve(JSON.parse(x.responseText)); } catch { reject(new Error('Unexpected server response.')); } };
      x.onerror = x.ontimeout = () => reject(new Error('Upload failed — check your internet connection and try again.'));
      x.send(f);
    });
    if (!r.ok){ const e = new Error(r.error || 'Upload failed'); e.code = r.code; throw e; }
    UPD.items = r.items; UPD.open = false; toast('✅ Update uploaded — everyone can download it now');
    if (S.view === 'updates') render();
  } catch(e){ if (document.body.contains(btn)){ btn.disabled = false; prog.innerHTML = ''; } handleErr(e); }
  finally { UPD.busy = false; busy(false); }
}
function updEdit(id){
  const u = (UPD.items || []).find(x => x.id === id); if (!u) return;
  const w = openModal(`<h3>Edit update</h3><p class="sub">${esc(u.name)} · ${updSize(u.size)} — to change the file itself, delete this update and upload the new file.</p>
    <div class="field"><label>Title</label><input class="input" id="ueT" maxlength="120" value="${esc(u.title)}"></div>
    <div class="field"><label>Version</label><input class="input" id="ueV" maxlength="40" value="${esc(u.version)}"></div>
    <div class="field"><label>What is new?</label><textarea class="input" id="ueN" maxlength="600" rows="4">${esc(u.notes)}</textarea></div>
    <div class="foot"><button class="btn ghost" data-x>Cancel</button><button class="btn" data-ok>Save</button></div>`);
  w.querySelector('[data-x]').onclick = () => w.remove();
  w.querySelector('[data-ok]').onclick = async ev => {
    const btn = ev.currentTarget, title = w.querySelector('#ueT').value.trim();
    if (!title) return toast('Please enter a title', true);
    btn.disabled = true;
    try { const r = await api('updEdit', { id, title, version:w.querySelector('#ueV').value.trim(), notes:w.querySelector('#ueN').value.trim() }); UPD.items = r.items; w.remove(); toast('Saved'); render(); }
    catch(e){ btn.disabled = false; handleErr(e); }
  };
}
async function updDelete(id){
  const u = (UPD.items || []).find(x => x.id === id); if (!u) return;
  if (!await confirmBox('Delete this update?', '“' + u.title + '” (' + u.name + ') is removed for everyone and cannot be brought back.', 'Delete', true)) return;
  try { const r = await api('updDelete', { id }); UPD.items = r.items; toast('Deleted'); render(); }
  catch(e){ handleErr(e); if (e.code === 'UPD') updLoad(); }
}

/* ---------- navigation ---------- */
const TITLES = {
  dashboard:['Dashboard','Your attendance and salary at a glance'],
  attendance:['Attendance','Mark and review attendance day by day'],
  expenses:['Expenses','Track income and spending'],
  work:['Work','Daily work record — whole year'],
  timetable:['Time Table','Plan your day in 30-minute slots'],
  chat:['Chat','Message other users — see who is online'],
  passwords:['Password Manager','Save website logins and copy them in one tap'],
  links:['Links','Save movie, web series and anime links and copy them in one tap'],
  lic:['LIC','Customer policies — amount, dates and how long each one runs'],
  vcs:['VCS Complaint Manage','Log complaints, assign them to a user and track Open / Pending / Closed'],
  rack:['Rack Mapping','Left 1–11 · Right 1–15 · Front 1–3, rows A–D — Carton, Inner, Box, Scheme, INS No. in every row (customizable)'],
  logins:['Login activity','Who signed in, when, from where and from which device'],
  deploy:['Deploy','Publish updated files to GitHub — the site goes live by itself'],
  updates:['Updates','Download the latest application files'],
  version:['Version','Pick files from GitHub and build an Android app (.apk) to install on your phone'],
  settings:['Settings','Profile, security, appearance and preferences']
};

/* =====================================================================
   APPEARANCE & LAYOUT  (Settings > Appearance & layout)
   Colours, dark mode, text size, spacing, sidebar side/style, menu order,
   dashboard blocks … saved on THIS device (localStorage), applied at once.
   ===================================================================== */
const TH_KEY = 'ks_theme_v1';
const TH_MODES = {
  light:{ bg:'#f3f5fa', card:'#ffffff', ink:'#1e293b', muted:'#64748b', line:'#e5e9f2', line2:'#e2e8f0', soft:'#f8fafc', soft2:'#f1f5f9', inputline:'#d5dbe8', label:'#475569',
          side:'#0f172a', 'chat-bg':'#efeae2', 'chat-me':'#d9fdd3', good:'#15803d', 'good-soft':'#dcfce7', bad:'#dc2626', 'bad-soft':'#fee2e2', warn:'#b45309', 'warn-soft':'#fef3c7',
          shadow:'0 1px 2px rgba(15,23,42,.05),0 8px 24px rgba(15,23,42,.06)' },
  dark: { bg:'#0b1020', card:'#151b2e', ink:'#e5e7eb', muted:'#94a3b8', line:'#263049', line2:'#2b3552', soft:'#1b2339', soft2:'#222b45', inputline:'#34405f', label:'#cbd5e1',
          side:'#070b17', 'chat-bg':'#0e1522', 'chat-me':'#1f4d3a', good:'#4ade80', 'good-soft':'#12301f', bad:'#f87171', 'bad-soft':'#3b1717', warn:'#fbbf24', 'warn-soft':'#3a2a0b',
          shadow:'0 1px 2px rgba(0,0,0,.4),0 8px 24px rgba(0,0,0,.35)' }
};
const TH_PRESETS = [
  { id:'indigo',  n:'Indigo',  b:'#4f46e5', b2:'#7c3aed', s:'' },
  { id:'ocean',   n:'Ocean',   b:'#0284c7', b2:'#2563eb', s:'#0b2236' },
  { id:'teal',    n:'Teal',    b:'#0d9488', b2:'#0891b2', s:'#0a2527' },
  { id:'emerald', n:'Emerald', b:'#059669', b2:'#16a34a', s:'#0b2a22' },
  { id:'rose',    n:'Rose',    b:'#e11d48', b2:'#f43f5e', s:'#2a0f18' },
  { id:'sunset',  n:'Sunset',  b:'#ea580c', b2:'#dc2626', s:'#2a1408' },
  { id:'gold',    n:'Gold',    b:'#d97706', b2:'#f59e0b', s:'#2b1d08' },
  { id:'violet',  n:'Violet',  b:'#7c3aed', b2:'#c026d3', s:'#1e1033' },
  { id:'slate',   n:'Slate',   b:'#334155', b2:'#64748b', s:'#0f172a' },
  { id:'mono',    n:'Black',   b:'#111827', b2:'#374151', s:'#000000' }
];
const TH_FONTS = {
  sans:'', serif:'Georgia,"Noto Serif Devanagari","Times New Roman",serif',
  round:'ui-rounded,"SF Pro Rounded",Nunito,"Segoe UI",system-ui,"Noto Sans Devanagari",sans-serif',
  mono:'ui-monospace,"SF Mono",Consolas,Menlo,monospace'
};
const TH_ENUM = {
  mode:['light','dark','auto'], sbPos:['left','right'], nav:['full','icons'], maxw:['0','1400','1200','1000','800'], cols:['auto','1','2','3'],
  card:['shadow','border','flat'], bg:['solid','soft'], ctl:['s','m','l'], density:['compact','normal','comfy'], font:['sans','serif','round','mono'],
  kpi:['130','170','220'], motion:['on','off']
};
const TH_NUM = { fs:[80,140], radius:[0,30], gap:[6,30], pad:[8,34], sbw:[180,340] };
const TH_DEF = {
  mode:'light', brand:'#4f46e5', brand2:'#7c3aed', side:'', cust:{ light:{}, dark:{} },
  fs:100, radius:16, gap:16, pad:20, sbw:240, maxw:'0', cols:'auto', card:'shadow', bg:'solid', ctl:'m', density:'normal', font:'sans', kpi:'170', motion:'on', sbPos:'left', nav:'full',
  dash:{ hello:1, today:1, kpi:1, chart:1, table:1 }, menu:{ order:[], hide:[], label:{}, icon:{} }
};
const TH_T0 = {}; Object.keys(TITLES).forEach(k => { TH_T0[k] = TITLES[k][0]; });

const thRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const thHex = a => '#' + a.map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
const thMix = (a, b, t) => { const x = thRgb(a), y = thRgb(b); return thHex(x.map((v, i) => v + (y[i] - v) * t)); };      // t = share of b
const thLum = h => { const [r, g, b] = thRgb(h).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * r + .7152 * g + .0722 * b; };

function thNorm(j){
  const o = JSON.parse(JSON.stringify(TH_DEF)); if (!j || typeof j !== 'object') return o;
  const hex = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null;
  ['brand', 'brand2', 'side'].forEach(k => { const c = hex(j[k]); if (c) o[k] = c; });
  Object.keys(TH_ENUM).forEach(k => { if (j[k] !== undefined && TH_ENUM[k].includes(String(j[k]))) o[k] = String(j[k]); });
  Object.keys(TH_NUM).forEach(k => { const n = +j[k]; if (j[k] !== undefined && isFinite(n)) o[k] = Math.min(TH_NUM[k][1], Math.max(TH_NUM[k][0], Math.round(n))); });
  ['light', 'dark'].forEach(m => ['bg', 'card', 'ink'].forEach(k => { const c = hex(j.cust && j.cust[m] && j.cust[m][k]); if (c) o.cust[m][k] = c; }));
  if (j.dash && typeof j.dash === 'object') Object.keys(o.dash).forEach(k => { if (j.dash[k] !== undefined) o.dash[k] = j.dash[k] ? 1 : 0; });
  if (j.menu && typeof j.menu === 'object'){
    const ok = v => typeof v === 'string' && /^[a-z]{2,20}$/.test(v);
    if (Array.isArray(j.menu.order)) o.menu.order = j.menu.order.filter(ok).slice(0, 30);
    if (Array.isArray(j.menu.hide)) o.menu.hide = j.menu.hide.filter(ok).slice(0, 30);
    ['label', 'icon'].forEach(k => { const m = j.menu[k]; if (m && typeof m === 'object') Object.keys(m).forEach(v => { if (ok(v) && typeof m[v] === 'string') o.menu[k][v] = m[v].slice(0, k === 'icon' ? 4 : 24); }); });
  }
  return o;
}
let T = (() => { try { return thNorm(JSON.parse(store.get(TH_KEY) || 'null')); } catch(e){ return thNorm(null); } })();
const thSave = () => store.set(TH_KEY, JSON.stringify(T), true);
const thDark = () => T.mode === 'dark' || (T.mode === 'auto' && !!window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);

function thVars(dark){
  const M = Object.assign({}, TH_MODES[dark ? 'dark' : 'light']), cu = T.cust[dark ? 'dark' : 'light'] || {};
  if (cu.card || cu.ink){
    const card = cu.card || M.card, ink = cu.ink || M.ink;
    Object.assign(M, { card, ink, soft:thMix(card, ink, .04), soft2:thMix(card, ink, .08), line:thMix(card, ink, .12), line2:thMix(card, ink, .16), inputline:thMix(card, ink, .24), muted:thMix(ink, card, .42), label:thMix(ink, card, .25) });
  }
  if (cu.bg) M.bg = cu.bg;
  const side = T.side || M.side, sDark = thLum(side) < .4;
  const V = Object.assign({}, M, {
    side, 'side-hover':thMix(side, sDark ? '#ffffff' : '#000000', .12), 'side-ink':sDark ? '#cbd5e1' : '#334155', 'side-hi':sDark ? '#ffffff' : '#0f172a', 'side-mut':sDark ? '#94a3b8' : '#64748b',
    brand:T.brand, 'brand-2':T.brand2, 'brand-soft':thMix(M.card, T.brand, dark ? .22 : .10), 'brand-ink':dark ? thMix(T.brand, '#ffffff', .4) : T.brand,
    'on-brand':thLum(T.brand) > .38 ? '#111827' : '#ffffff',
    'login-a':thMix(M.bg, T.brand, dark ? .28 : .3), 'login-b':thMix(M.bg, T.brand2, dark ? .22 : .28),
    radius:T.radius + 'px', 'rad-s':Math.round(T.radius * .7) + 'px', fs:String(T.fs / 100), pad:T.pad + 'px', gap:T.gap + 'px', sbw:T.sbw + 'px',
    maxw:T.maxw === '0' ? 'none' : T.maxw + 'px', kpimin:T.kpi + 'px',
    'btn-py':({ s:'7px', m:'10px', l:'13px' })[T.ctl], 'btn-px':({ s:'12px', m:'16px', l:'20px' })[T.ctl], 'in-py':({ s:'8px', m:'11px', l:'14px' })[T.ctl],
    cellp:({ compact:'6px 10px', normal:'10px 12px', comfy:'15px 14px' })[T.density]
  });
  return V;
}
const TH_ORIG = new WeakMap();
function thOrig(b){
  if (!TH_ORIG.has(b)){ const ic = b.querySelector('.ico'); TH_ORIG.set(b, { l:ic ? (ic.nextSibling && ic.nextSibling.nodeValue || '').trim() : '', i:ic ? ic.textContent : '' }); }
  return TH_ORIG.get(b);
}
function thMenu(){
  const nav = document.getElementById('nav'); if (!nav) return;
  [...nav.children].forEach(thOrig);
  const all = [...nav.children].map(b => b.dataset.v), final = T.menu.order.filter(v => all.includes(v));
  all.forEach((v, i) => { if (!final.includes(v)){ const k = i ? final.indexOf(all[i - 1]) : -1; final.splice(k + 1, 0, v); } });   // new tabs stay next to their neighbour
  final.forEach(v => nav.appendChild(nav.querySelector(`[data-v="${v}"]`)));
  [...nav.children].forEach(b => {
    const v = b.dataset.v, ic = b.querySelector('.ico'); if (!ic) return;
    const o = thOrig(b), lab = (T.menu.label[v] || '').trim() || o.l;
    if (ic.nextSibling && ic.nextSibling.nodeType === 3) ic.nextSibling.nodeValue = lab;
    ic.textContent = T.menu.icon[v] || o.i;
    b.classList.toggle('th-off', v !== 'settings' && T.menu.hide.includes(v));
    if (TITLES[v]) TITLES[v][0] = (T.menu.label[v] || '').trim() || TH_T0[v];
  });
  const pt = document.getElementById('pageTitle'); if (pt && TITLES[S.view]) pt.textContent = TITLES[S.view][0];
}
function thApply(){
  const root = document.documentElement, bd = document.body, dark = thDark(), V = thVars(dark);
  Object.keys(V).forEach(k => root.style.setProperty('--' + k, V[k]));
  if (TH_FONTS[T.font]) root.style.setProperty('--font', TH_FONTS[T.font]); else root.style.removeProperty('--font');
  root.dataset.mode = dark ? 'dark' : 'light';
  bd.dataset.sb = T.sbPos; bd.dataset.nav = T.nav; bd.dataset.cols = T.cols; bd.dataset.card = T.card; bd.dataset.bg = T.bg; bd.dataset.motion = T.motion;
  Object.keys(T.dash).forEach(k => bd.classList.toggle('th-no-' + k, !T.dash[k]));
  const mt = document.querySelector('meta[name="theme-color"]'); if (mt) mt.setAttribute('content', T.brand);
  const tg = document.getElementById('menuToggle'); if (tg) tg.textContent = T.sbPos === 'right' ? '‹' : '›';
  thMenu();
}
thApply();
/* ---------- sidebar: neat section labels (Overview / Workspace / Tools / System) ---------- */
const NAV_GRP = { dashboard:'Overview', attendance:'Overview', expenses:'Overview', work:'Overview', timetable:'Overview',
  chat:'Workspace', vcs:'Workspace', rack:'Workspace', passwords:'Workspace', links:'Workspace', lic:'Workspace',
  logins:'Tools', deploy:'Tools', updates:'Tools', version:'Tools', settings:'System' };
function navGroups(){
  const nav = document.getElementById('nav'); if (!nav) return;
  let prev = '';
  [...nav.children].forEach(b => {
    const off = b.classList.contains('hidden') || b.classList.contains('th-off');
    let start = false, gl = '';
    if (!off){
      const g = NAV_GRP[b.dataset.v] || prev || 'Overview';
      start = g !== prev; gl = start ? g : ''; prev = g;
    }
    if (b.classList.contains('grp-start') !== start) b.classList.toggle('grp-start', start);
    if ((b.dataset.gl || '') !== gl){ if (gl) b.dataset.gl = gl; else delete b.dataset.gl; }
  });
}
(function navGroupsInit(){
  const nav = document.getElementById('nav'); if (!nav) return;
  let t = 0; const run = () => { cancelAnimationFrame(t); t = requestAnimationFrame(navGroups); };
  new MutationObserver(run).observe(nav, { childList:true, subtree:true, attributes:true, attributeFilter:['class'] });
  navGroups();
})();
if (window.matchMedia) { try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (T.mode === 'auto') thApply(); }); } catch(e){} }

/* ---------- the Settings card ---------- */
function thColor(id){
  const dark = thDark(), M = thVars(dark);
  return ({ brand:T.brand, brand2:T.brand2, side:M.side, bg:M.bg, card:M.card, ink:M.ink })[id];
}
function thMenuRows(){
  const nav = document.getElementById('nav');
  return [...nav.children].filter(b => !b.classList.contains('hidden')).map(b => {
    const v = b.dataset.v, off = v !== 'settings' && T.menu.hide.includes(v);
    return `<div class="th-mi ${off ? 'off' : ''}">
      <button type="button" class="btn ghost sm" data-mv="${esc(v)}" data-d="-1" title="Move up">↑</button>
      <button type="button" class="btn ghost sm" data-mv="${esc(v)}" data-d="1" title="Move down">↓</button>
      <input class="input ic" data-mi="${esc(v)}" maxlength="4" value="${esc(T.menu.icon[v] || thOrig(b).i || '')}" aria-label="Icon">
      <input class="input" data-ml="${esc(v)}" maxlength="24" value="${esc(T.menu.label[v] || thOrig(b).l || '')}" aria-label="Name">
      <label class="eye" title="${v === 'settings' ? 'Settings always stays visible' : 'Show / hide'}"><input type="checkbox" data-mh="${esc(v)}" ${off ? '' : 'checked'} ${v === 'settings' ? 'disabled' : ''}></label></div>`;
  }).join('');
}
/* ---------- my profile photo (shown in Chat) ---------- */
function photoCard(){
  const me = S.me || {}, id = me.id || '', src = id ? avSrc(id) : '', nm = (me.name || me.username || 'U').trim();
  return `<div class="card" id="phCard"><h3>🖼 Profile photo</h3>
    <p class="muted" style="margin-bottom:12px">This picture is shown next to your name in Chat, to the people who can see you.</p>
    <div class="ph-row"><div class="ch-av ph-big" style="background:${chColor(id || 'x')}">${src ? `<img class="ch-img" alt="" src="${esc(src)}">` : ''}${esc(nm.charAt(0).toUpperCase())}</div>
      <div class="ph-btns"><label class="btn" for="phFile">📷 ${src ? 'Change photo' : 'Choose photo'}</label><input type="file" id="phFile" accept="image/*" hidden onchange="photoPick(this)">${src ? '<button class="btn ghost" type="button" onclick="photoRemove()">Remove</button>' : ''}<button class="btn ghost" type="button" onclick="photoPrivacy()">🔒 Who can see it</button></div></div></div>`;
}
async function photoPick(inp){
  const f = inp.files && inp.files[0]; inp.value = ''; if (!f) return;
  if (!/^image\//.test(f.type)) return toast('Please choose a picture', true);
  let img;
  try{
    const url = URL.createObjectURL(f);
    img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('read')); i.src = url; });
    URL.revokeObjectURL(url);
  }catch(e){ return toast('Could not read this picture. Try a JPG or PNG photo.', true); }
  photoCropOpen(img);
}
/* crop screen: drag the picture, zoom with the slider or pinch; the round window shows exactly what the profile picture will contain */
function photoCropOpen(img){
  const V = 280, nw = img.naturalWidth, nh = img.naturalHeight, m = Math.min(nw, nh);
  const C = { z:1, cx:nw / 2, cy:nh / 2 };
  const w = openModal(`<h3>Adjust profile photo</h3><p class="sub">Drag to move, use the slider to zoom. The circle is what people will see.</p>
    <div class="crop-box" style="width:${V}px;height:${V}px"><canvas id="cpCv" width="${V * 2}" height="${V * 2}" style="width:${V}px;height:${V}px"></canvas><div class="crop-ring"></div></div>
    <input type="range" id="cpZ" min="1" max="4" step="0.01" value="1" class="crop-z" aria-label="Zoom">
    <div class="actions" style="margin-top:14px"><button class="btn ghost" type="button" id="cpNo">Cancel</button><button class="btn" type="button" id="cpOk">Save photo</button></div>`);
  const cv = w.querySelector('#cpCv'), cx2 = cv.getContext('2d');
  const rect = () => {
    const s = m / C.z;
    C.cx = Math.max(s / 2, Math.min(nw - s / 2, C.cx)); C.cy = Math.max(s / 2, Math.min(nh - s / 2, C.cy));
    return { s, sx:C.cx - s / 2, sy:C.cy - s / 2 };
  };
  const draw = () => { const r = rect(); cx2.clearRect(0, 0, cv.width, cv.height); cx2.drawImage(img, r.sx, r.sy, r.s, r.s, 0, 0, cv.width, cv.height); };
  draw();
  const pts = new Map(); let pinch = 0;
  cv.style.touchAction = 'none';
  cv.onpointerdown = e => { cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x:e.clientX, y:e.clientY }); pinch = 0; };
  cv.onpointermove = e => {
    const p = pts.get(e.pointerId); if (!p) return;
    if (pts.size === 2){                                               // two fingers: pinch to zoom
      pts.set(e.pointerId, { x:e.clientX, y:e.clientY });
      const [a1, b1] = [...pts.values()], d = Math.hypot(a1.x - b1.x, a1.y - b1.y);
      if (pinch) { C.z = Math.max(1, Math.min(4, C.z * d / pinch)); w.querySelector('#cpZ').value = C.z; }
      pinch = d; draw(); return;
    }
    const s = rect().s; C.cx -= (e.clientX - p.x) * s / V; C.cy -= (e.clientY - p.y) * s / V;
    pts.set(e.pointerId, { x:e.clientX, y:e.clientY }); draw();
  };
  const up = e => { pts.delete(e.pointerId); pinch = 0; };
  cv.onpointerup = up; cv.onpointercancel = up;
  cv.addEventListener('wheel', e => { e.preventDefault(); C.z = Math.max(1, Math.min(4, C.z * (e.deltaY < 0 ? 1.08 : 0.93))); w.querySelector('#cpZ').value = C.z; draw(); }, { passive:false });
  w.querySelector('#cpZ').oninput = e => { C.z = Number(e.target.value); draw(); };
  w.querySelector('#cpNo').onclick = () => w.remove();
  w.querySelector('#cpOk').onclick = async () => {
    const r = rect();
    const enc = (steps, max) => {
      for (const [px, q] of steps){
        const side = Math.min(px, Math.round(r.s)), c = document.createElement('canvas'); c.width = c.height = side;
        c.getContext('2d').drawImage(img, r.sx, r.sy, r.s, r.s, 0, 0, side, side);
        const out = c.toDataURL('image/jpeg', q); if (out.length <= max) return out;
      }
      return '';
    };
    const thumb = enc([[128, .72], [112, .65], [96, .6], [96, .45], [80, .4]], 7500);      // small copy for the chat list
    const full = enc([[512, .82], [512, .7], [440, .72], [380, .7], [320, .65], [256, .6]], 46000);   // big copy for the profile view
    if (!thumb) return toast('Could not shrink this picture enough. Try another one.', true);
    const btn = w.querySelector('#cpOk'); btn.disabled = true; btn.textContent = 'Saving…';
    try{
      const res = await api('setMyPhoto', { photo:thumb, full });
      AV[S.me.id] = { v:res.pv, src:thumb }; avSave();
      w.remove(); refreshUser(); render(); toast('Profile photo saved');
    }catch(e){ btn.disabled = false; btn.textContent = 'Save photo'; handleErr(e); }
  };
}
async function photoRemove(){
  if (!await confirmBox('Remove your profile photo?', 'Chat will show your first letter again.', 'Remove', true)) return;
  try{ await api('setMyPhoto', { photo:'' }); delete AV[S.me.id]; avSave(); refreshUser(); render(); toast('Photo removed'); }catch(e){ handleErr(e); }
}
function themeCard(){
  const seg = (k, opts) => `<div class="seg" data-k="${k}">${opts.map(([v, l]) => `<button type="button" data-val="${v}" class="${String(T[k]) === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const rng = (k, label, unit) => `<div class="th-row"><div class="th-lbl"><span>${label}</span><b id="thv_${k}">${T[k]}${unit}</b></div><input type="range" data-k="${k}" min="${TH_NUM[k][0]}" max="${TH_NUM[k][1]}" step="1" value="${T[k]}"></div>`;
  const blk = (label, inner, note) => `<div class="th-row"><div class="th-lbl"><span>${label}</span></div>${inner}${note ? `<div class="th-note" style="margin:6px 0 0">${note}</div>` : ''}</div>`;
  const col = (id, label) => `<label class="th-col"><input type="color" data-c="${id}" value="${thColor(id)}"><span>${label}</span></label>`;
  const dash = [['hello', 'Greeting'], ['today', 'Today quick-mark'], ['kpi', 'Number cards'], ['chart', 'Charts'], ['table', 'Tables']];
  const pres = TH_PRESETS.map(p => `<button type="button" class="th-pre ${T.brand === p.b && T.brand2 === p.b2 ? 'on' : ''}" data-pre="${p.id}" style="background:linear-gradient(135deg,${p.b},${p.b2})">${p.n}</button>`).join('');
  return `<div class="card" id="thCard" style="grid-column:1/-1"><h3>🎨 Appearance & layout <button type="button" class="btn ghost sm" data-act="reset">↺ Reset all</button></h3>
  <p class="th-note">Colours, text size, spacing, menu and layout — changes apply instantly and are saved on this device.</p>

  <details class="regbox th-grp" open><summary>🌗 Theme & colours</summary>
    ${blk('Mode', seg('mode', [['light', '☀️ Light'], ['dark', '🌙 Dark'], ['auto', '📱 Auto (phone)']]))}
    <div class="th-lbl"><span>Colour theme</span></div><div class="th-pres">${pres}</div>
    <div class="th-lbl"><span>Custom colours</span><button type="button" class="linkbtn" data-act="resetcol">Reset colours</button></div>
    <div class="th-cols">${col('brand', 'Main')}${col('brand2', 'Second')}${col('side', 'Menu bar')}${col('bg', 'Page')}${col('card', 'Cards')}${col('ink', 'Text')}</div>
    <div class="th-note">Page / Cards / Text are remembered separately for Light and Dark.</div>
    <div class="th-two">
      ${blk('Page background', seg('bg', [['solid', 'Plain'], ['soft', 'Soft glow']]))}
      ${blk('Card style', seg('card', [['shadow', 'Shadow'], ['border', 'Outline'], ['flat', 'Flat']]))}
    </div>
  </details>

  <details class="regbox th-grp"><summary>🔤 Size & spacing</summary>
    <div class="th-two">
      ${rng('fs', 'Text size', '%')}${rng('radius', 'Rounded corners', 'px')}${rng('pad', 'Card padding', 'px')}${rng('gap', 'Space between cards', 'px')}
    </div>
    <div class="th-two">
      ${blk('Font style', seg('font', [['sans', 'Default'], ['serif', 'Serif'], ['round', 'Rounded'], ['mono', 'Mono']]))}
      ${blk('Buttons & fields', seg('ctl', [['s', 'Small'], ['m', 'Normal'], ['l', 'Large']]))}
      ${blk('Table rows', seg('density', [['compact', 'Compact'], ['normal', 'Normal'], ['comfy', 'Roomy']]))}
      ${blk('Number cards', seg('kpi', [['130', 'Small'], ['170', 'Normal'], ['220', 'Large']]))}
    </div>
  </details>

  <details class="regbox th-grp"><summary>🧩 Layout</summary>
    <div class="th-two">
      ${blk('Menu position', seg('sbPos', [['left', '⬅ Left'], ['right', 'Right ➡']]))}
      ${blk('Menu style (computer)', seg('nav', [['full', 'Icons + names'], ['icons', 'Icons only']]))}
      ${rng('sbw', 'Menu width (computer)', 'px')}
      ${blk('Page width (computer)', seg('maxw', [['0', 'Full'], ['1400', '1400'], ['1200', '1200'], ['1000', '1000'], ['800', '800']]))}
      ${blk('Settings / card columns (computer)', seg('cols', [['auto', 'Auto'], ['1', '1'], ['2', '2'], ['3', '3']]))}
      ${blk('Animations', seg('motion', [['on', 'On'], ['off', 'Off']]))}
    </div>
    <div class="th-lbl"><span>Dashboard — show</span></div>
    <div class="chips" style="gap:4px 16px;margin-bottom:6px">${dash.map(([k, l]) => `<label class="tog"><input type="checkbox" data-dash="${k}" ${T.dash[k] ? 'checked' : ''}> ${l}</label>`).join('')}</div>
  </details>

  <details class="regbox th-grp"><summary>📋 Menu items — order, name, icon, show / hide</summary>
    <p class="th-note">↑ ↓ moves an item. Change the icon or name, or untick to hide it from the menu.</p>
    <div class="th-menu" id="thMenuList">${thMenuRows()}</div>
    <div class="th-actions"><button type="button" class="btn ghost sm" data-act="resetmenu">↺ Reset menu</button></div>
  </details>

  <details class="regbox th-grp"><summary>💾 Backup & share</summary>
    <p class="th-note">Copy your design as text and paste it on another phone or computer.</p>
    <div class="th-actions"><button type="button" class="btn soft sm" data-act="export">⬆ Export design</button><button type="button" class="btn soft sm" data-act="import">⬇ Import design</button></div>
  </details></div>`;
}
function thRerenderMenuList(){ const l = document.getElementById('thMenuList'); if (l) l.innerHTML = thMenuRows(); }
function thMove(v, d){
  const nav = document.getElementById('nav'), all = [...nav.children].map(b => b.dataset.v);
  const vis = all.filter(x => !nav.querySelector(`[data-v="${x}"]`).classList.contains('hidden')), i = vis.indexOf(v), j = i + d;
  if (i < 0 || j < 0 || j >= vis.length) return;
  const a = all.indexOf(vis[i]), b = all.indexOf(vis[j]); [all[a], all[b]] = [all[b], all[a]];
  T.menu.order = all; thSave(); thMenu(); thRerenderMenuList();
}
function bindTheme(){
  const c = document.getElementById('thCard'); if (!c) return;
  const done = (redraw) => { thSave(); thApply(); if (redraw) { c.querySelectorAll('.th-pre').forEach(b => { const p = TH_PRESETS.find(x => x.id === b.dataset.pre); b.classList.toggle('on', T.brand === p.b && T.brand2 === p.b2); }); } };
  const syncColors = () => c.querySelectorAll('input[data-c]').forEach(i => { i.value = thColor(i.dataset.c); });
  c.addEventListener('click', e => {
    const t = e.target.closest('button'); if (!t) return;
    const sg = t.closest('.seg');
    if (sg && t.dataset.val !== undefined){
      T[sg.dataset.k] = t.dataset.val; sg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === t));
      done(); if (sg.dataset.k === 'mode') syncColors(); return;
    }
    if (t.dataset.pre){ const p = TH_PRESETS.find(x => x.id === t.dataset.pre); T.brand = p.b; T.brand2 = p.b2; T.side = p.s; done(true); syncColors(); return; }
    if (t.dataset.mv){ thMove(t.dataset.mv, +t.dataset.d); return; }
    const a = t.dataset.act; if (!a) return;
    if (a === 'resetcol'){ T.brand = TH_DEF.brand; T.brand2 = TH_DEF.brand2; T.side = ''; T.cust = { light:{}, dark:{} }; done(true); syncColors(); toast('Colours reset'); }
    else if (a === 'resetmenu'){ T.menu = JSON.parse(JSON.stringify(TH_DEF.menu)); thSave(); thApply(); thRerenderMenuList(); toast('Menu reset'); }
    else if (a === 'reset'){ confirmBox('Reset appearance?', 'All colours, sizes, layout and menu changes on this device go back to the original design.', 'Reset', true).then(ok => { if (ok){ T = thNorm(null); thSave(); thApply(); render(); toast('Original design restored'); } }); }
    else if (a === 'export'){
      const w = openModal(`<h3>Export design</h3><p class="sub">Copy this text. On another device open Settings › Appearance › Import.</p><textarea class="input th-code" readonly>${esc(JSON.stringify(T))}</textarea>
        <div class="foot"><button class="btn ghost" data-x>Close</button><button class="btn" data-cp>Copy</button></div>`, 'wide');
      const ta = w.querySelector('textarea'); ta.onfocus = () => ta.select();
      w.querySelector('[data-x]').onclick = () => w.remove();
      w.querySelector('[data-cp]').onclick = async () => { try { await navigator.clipboard.writeText(ta.value); toast('Copied'); } catch(e){ ta.select(); document.execCommand('copy'); toast('Copied'); } };
    } else if (a === 'import'){
      const w = openModal(`<h3>Import design</h3><p class="sub">Paste the design text you exported earlier.</p><textarea class="input th-code" placeholder='{"mode":"dark",…}'></textarea>
        <div class="foot"><button class="btn ghost" data-x>Cancel</button><button class="btn" data-ok>Apply</button></div>`, 'wide');
      w.querySelector('[data-x]').onclick = () => w.remove();
      w.querySelector('[data-ok]').onclick = () => {
        try { const j = JSON.parse(w.querySelector('textarea').value); if (!j || typeof j !== 'object') throw 0; T = thNorm(j); thSave(); thApply(); w.remove(); render(); toast('Design applied'); }
        catch(err){ toast('That is not a valid design text', true); }
      };
    }
  });
  c.addEventListener('input', e => {
    const t = e.target;
    if (t.matches('input[type=range][data-k]')){ T[t.dataset.k] = +t.value; const u = { fs:'%' }[t.dataset.k] || 'px', l = document.getElementById('thv_' + t.dataset.k); if (l) l.textContent = t.value + u; thApply(); thSave(); }
    else if (t.matches('input[data-c]')){
      const id = t.dataset.c, v = t.value.toLowerCase();
      if (id === 'brand') T.brand = v; else if (id === 'brand2') T.brand2 = v; else if (id === 'side') T.side = v;
      else T.cust[thDark() ? 'dark' : 'light'][id] = v;
      thApply(); thSave(); c.querySelectorAll('.th-pre').forEach(b => b.classList.remove('on'));
    }
  });
  c.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.dash){ T.dash[t.dataset.dash] = t.checked ? 1 : 0; thSave(); thApply(); }
    else if (t.dataset.mh){ const v = t.dataset.mh; T.menu.hide = T.menu.hide.filter(x => x !== v); if (!t.checked) T.menu.hide.push(v); thSave(); thApply(); t.closest('.th-mi').classList.toggle('off', !t.checked); }
    else if (t.dataset.ml){ const v = t.dataset.ml, b = document.querySelector(`#nav [data-v="${v}"]`); T.menu.label[v] = t.value.trim() === (b && thOrig(b).l) ? '' : t.value.trim().slice(0, 24); if (!T.menu.label[v]) delete T.menu.label[v]; thSave(); thApply(); }
    else if (t.dataset.mi){ const v = t.dataset.mi, b = document.querySelector(`#nav [data-v="${v}"]`); T.menu.icon[v] = t.value.trim() === (b && thOrig(b).i) ? '' : t.value.trim().slice(0, 4); if (!T.menu.icon[v]) delete T.menu.icon[v]; thSave(); thApply(); }
  });
}
function setMenu(on){ document.body.classList.toggle('menu-open', !!on); const t = $('#menuToggle'); if (t) t.setAttribute('aria-expanded', on ? 'true' : 'false'); }
$('#menuToggle').onclick = () => setMenu(true);
$('#scrim').onclick = () => setMenu(false);
document.addEventListener('keydown', e => { if (e.key === 'Escape') setMenu(false); });
(function swipeMenu(){                       // swipe right from the left edge opens, swipe left closes
  let x0 = null, y0 = 0;
  document.addEventListener('touchstart', e => { const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; }, { passive:true });
  document.addEventListener('touchend', e => {
    if (x0 === null) return;
    const t = e.changedTouches[0], dx = t.clientX - x0, dy = Math.abs(t.clientY - y0), open = document.body.classList.contains('menu-open');
    if (window.innerWidth <= 860 && dy < 50){
      const R = document.body.dataset.sb === 'right', edge = R ? x0 > window.innerWidth - 24 : x0 < 24, toward = R ? -dx : dx;
      if (!open && edge && toward > 60 && !$('#app').classList.contains('hidden')) setMenu(true);
      else if (open && toward < -60) setMenu(false);
    }
    x0 = null;
  }, { passive:true });
})();
function go(v){
  setMenu(false);
  if (v === 'chat' && S.view !== 'chat') S.chat.with = null;
  if (v !== 'chat') document.body.classList.remove('chat-conv');
  if (v === 'settings') S.setSec = null;
  S.view = v; applyAccess(); v = S.view; document.body.dataset.view = v;
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.v === v));
  $('#pageTitle').textContent = TITLES[v][0];
  $('#pageSub').textContent = TITLES[v][1];
  render(); window.scrollTo(0,0);
  if (v === 'logins') loadLogs();
  if (v === 'deploy') depLoad();
  if (v === 'updates') updLoad();
  if (v === 'version') verLoad();
}
$('#nav').addEventListener('click', e => { const b = e.target.closest('button'); if (b) go(b.dataset.v); });
$('#logoutBtn').onclick = $('#logoutBtn2').onclick = $('#logoutBtn3').onclick = logout;
$('#refreshBtn').onclick = async () => { try { await loadAll(); render(); toast('Data refreshed'); if (isAdmin()) loadLogs(); if (S.view === 'updates') updLoad(); } catch(e){ handleErr(e); } };
/* ---------- payment / access countdown (Dashboard) ---------- */
let payTimer = null;
const payOff = () => (S.me && S.me.serverNow) ? S.me.serverNow - (S.meAt || Date.now()) : 0;   // server clock minus this device's clock
function payCountdownHtml(){
  if (!S.me || !S.me.payDueMs) return '';
  return `<div id="payCd" class="card" style="margin-bottom:16px;display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;border-left:5px solid var(--good,#16a34a)">
    <div style="font-size:calc(26px*var(--fs))">⏳</div>
    <div style="flex:1;min-width:200px"><div style="font-weight:700">Your access expires on <span id="payCdDate"></span></div>
      <div class="muted" style="font-size:calc(13px*var(--fs))">Please make the payment before then to keep using this account.</div></div>
    <div id="payCdTxt" style="font-weight:800;font-size:calc(20px*var(--fs));font-variant-numeric:tabular-nums"></div></div>`;
}
function tickPay(){
  const box = document.getElementById('payCd');
  if (!box || !S.me || !S.me.payDueMs){ clearInterval(payTimer); payTimer = null; return; }
  const left = S.me.payDueMs - (Date.now() + payOff());
  const dt = new Date(S.me.payDueMs);
  document.getElementById('payCdDate').textContent = dt.toLocaleString('en-IN', { day:'numeric', month:'short', year:'numeric', hour:'numeric', minute:'2-digit' });
  if (left <= 0){
    clearInterval(payTimer); payTimer = null;
    box.style.borderLeftColor = 'var(--bad,#dc2626)';
    document.getElementById('payCdTxt').textContent = 'Expired';
    loadAll().then(render).catch(handleErr);          // server now answers "Payment pending" -> signs the user out
    return;
  }
  const s = Math.floor(left / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
  const p2 = n => String(n).padStart(2, '0');
  document.getElementById('payCdTxt').textContent = (d ? d + 'd ' : '') + p2(h) + 'h ' + p2(m) + 'm ' + p2(sec) + 's';
  box.style.borderLeftColor = d >= 7 ? 'var(--good,#16a34a)' : d >= 1 ? '#f59e0b' : 'var(--bad,#dc2626)';
}
function startPay(){
  clearInterval(payTimer); payTimer = null;
  if (!document.getElementById('payCd')) return;
  tickPay(); payTimer = setInterval(tickPay, 1000);
}
function render(){
  if (!S.d) return;
  const v = $('#view');
  updateEmpSel(); updateAsSel();
  let html = ({dashboard:vDashboard, attendance:vAttendance, expenses:vExpenses, work:vWork, timetable:vTimetable, chat:vChat, passwords:vPasswords, links:vLinks, lic:vLic, vcs:vVcs, rack:vRack, logins:vLogins, deploy:vDeploy, updates:vUpdates, version:vVersion, settings:vSettings})[S.view]();
  if (S.view === 'dashboard' && isAdmin() && !S.as) html += recentLoginsCard();
  v.innerHTML = banner() + (S.view === 'dashboard' ? payCountdownHtml() : '') + html;
  applyRO(v);
  startPay(); startLic();
  const after = ({settings:() => { bindSettings(); bindBio(); bindTheme(); bindDrive(); bindTrash(); }, logins:bindLogins, chat:bindChat, deploy:bindDeploy, updates:bindUpdates, version:bindVersion})[S.view]; if (after) after();
  liveSync();                                   // VCS Processing: connect while its card is open, disconnect otherwise
}

/* ---------- calculations ---------- */
const cfg = () => S.d.settings;
const smap = () => Object.fromEntries(S.d.statuses.map(s => [s.code, s]));
function fm(n){ return (cfg().currency || '₹') + Number(n||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2}); }
/* Per-day salary. If "Round daily salary" is ON: decimal part above .5 -> next whole number (580.64 -> 581),
   .5 or below -> dropped (580.50 -> 580, 580.30 -> 580). OFF = exact value. */
const ROUND_KEY = 'ks_round_daily';
const roundDaily = () => { try { return localStorage.getItem(ROUND_KEY) === '1'; } catch(e){ return false; } };
function dayRate(salary, basis){
  const r = salary / basis;
  if (!roundDaily()) return r;
  const fl = Math.floor(r + 1e-9), frac = r - fl;
  return frac > 0.5 + 1e-9 ? fl + 1 : fl;
}
function monthStats(m){
  const y = +cfg().year, dim = daysIn(y, m), att = S.d.attendance[m] || {}, sm = smap();
  const counts = {}; let paid = 0, marked = 0;
  for (let d = 1; d <= dim; d++){
    const c = att[d]; if (!c) continue;
    marked++; counts[c] = (counts[c]||0) + 1; paid += sm[c] ? sm[c].factor : 0;
  }
  const e = emp(), basis = +e.basis > 0 ? +e.basis : dim;
  const earned = paid * dayRate(+e.salary || 0, basis);
  return { dim, counts, paid, marked, earned, P:counts.P||0, A:counts.A||0, W:counts.W||0 };
}
function yearStats(){
  const t = { P:0, A:0, W:0, paid:0, marked:0, earned:0, counts:{} };
  for (let m = 1; m <= 12; m++){
    const s = monthStats(m);
    t.P += s.P; t.A += s.A; t.W += s.W; t.paid += s.paid; t.marked += s.marked; t.earned += s.earned;
    for (const k in s.counts) t.counts[k] = (t.counts[k]||0) + s.counts[k];
  }
  return t;
}
const catType = name => (S.d.categories.find(c => c.name === name) || {}).type || 'Expense';
const badge = code => { const s = smap()[code]; return s ? `<span class="badge" style="background:${esc(s.color)}">${esc(code)}</span>` : ''; };

/* ---------- attendance writes ---------- */
async function setAtt(entries){ if (!can('att')) return deny();
  const who = S.emp, prev = JSON.parse(JSON.stringify(S.d.attendance));
  entries.forEach(e => {
    if (!S.d.attendance[e.month]) S.d.attendance[e.month] = {};
    if (e.code) S.d.attendance[e.month][e.day] = e.code; else delete S.d.attendance[e.month][e.day];
  });
  render();
  try { await api('setAttendance', { entries, emp:who }); toast('Attendance saved'); }
  catch(e){ S.d.attAll[who] = prev; if (S.emp === who) S.d.attendance = prev; render(); handleErr(e); }
}
function dayPicker(m, d){ if (!can('att')) return deny();
  const y = +cfg().year, dt = new Date(y, m-1, d), cur = (S.d.attendance[m]||{})[d] || '';
  const w = openModal(`<h3>${d} ${MONTHS[m-1]} ${y}</h3><p class="sub">${WD[dt.getDay()]}day${cur ? ' · currently ' + esc((smap()[cur]||{}).label || cur) : ' · not marked'}</p>
    <div class="pick">${S.d.statuses.map(s => `<button data-c="${esc(s.code)}">${badge(s.code)}<span>${esc(s.label)}</span></button>`).join('')}
      ${cur ? `<button data-c="">✕ <span class="muted">Clear this day</span></button>` : ''}</div>
    <div class="foot"><button class="btn ghost" data-x>Close</button></div>`);
  w.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { w.remove(); setAtt([{month:m, day:d, code:b.dataset.c}]); });
  w.querySelector('[data-x]').onclick = () => w.remove();
}
function markToday(code){ if (!can('att')) return deny();
  const n = new Date(); setAtt([{ month:n.getMonth()+1, day:n.getDate(), code }]);
}

/* =====================================================================
   VIEW: DASHBOARD
   ===================================================================== */
function vDashboard(){
  const s = cfg(), y = yearStats(), sm = smap(), now = new Date();
  const inYear = now.getFullYear() === +s.year, m = now.getMonth()+1, d = now.getDate();
  const cur = inYear ? ((S.d.attendance[m]||{})[d] || '') : '';
  const pct = (y.P + y.A) ? (y.P / (y.P + y.A) * 100).toFixed(1) + '%' : '—';
  const mark = inYear ? `<div class="card today">
      <div><div class="small">Today${(S.d.employees||[]).length > 1 ? ' · ' + esc(emp().name) : ''}</div><div class="big">${WD[now.getDay()]}, ${d} ${MONTHS[m-1]} ${s.year}</div>
        <div class="small">${cur ? 'Marked as ' + esc((sm[cur]||{}).label || cur) : 'Not marked yet — tap below'}</div></div>
      <div class="mark-row">${S.d.statuses.map(x => `<button class="mark ${cur===x.code?'on':''}" onclick="markToday('${esc(x.code)}')">${esc(x.code)} · ${esc(x.label.replace(/\s*\(.*\)/,''))}</button>`).join('')}
        ${cur ? `<button class="mark" onclick="markToday('')">Clear</button>` : ''}</div></div>`
    : `<div class="card" style="margin-bottom:16px">Settings year is ${esc(s.year)}, so the “today” quick-mark is hidden. Use the Attendance tab to mark days.</div>`;

  const rows = MONTHS.map((nm, i) => { const x = monthStats(i+1);
    return `<tr class="${inYear && i+1===m ? 'cur' : ''}"><td><b><span class="mfull">${nm}</span><span class="msh">${nm.slice(0,3)}</span></b></td><td class="n">${x.P}</td><td class="n">${x.A}</td><td class="n">${x.W}</td><td class="n hide-m">${x.paid}</td><td class="n">${fm(x.earned)}</td></tr>`; }).join('');

  const maxE = Math.max(1, ...MONTHS.map((_, i) => monthStats(i+1).earned));
  const bars = MONTHS.map((_, i) => { const e = monthStats(i+1).earned;
    return `<div class="b" title="${MONTHS[i]}: ${esc(fm(e))}"><div class="col ${e?'':'zero'}" style="height:${Math.max(2, e/maxE*100)}%"></div><div class="m">${MON[i]}</div></div>`; }).join('');

  let acc = 0; const total = y.marked || 1;
  const segs = S.d.statuses.filter(x => y.counts[x.code]).map(x => { const a = acc, b = acc + y.counts[x.code]/total*100; acc = b; return `${x.color} ${a}% ${b}%`; });
  const donut = y.marked ? `conic-gradient(${segs.join(',')})` : '#e5e9f2';
  const legend = S.d.statuses.map(x => `<div><span class="dot" style="background:${esc(x.color)}"></span>${esc(x.code)} – ${esc(x.label)}<b style="margin-left:auto">${y.counts[x.code]||0}</b></div>`).join('');

  const attHtml = `${mark}
  <div class="dsec" style="margin-top:6px"><span>🗓️ Attendance</span><button class="btn soft sm" onclick="go('attendance')">Open</button></div>
  <div class="grid kpis">
    <div class="card kpi p"><div class="lbl">Total Present</div><div class="val">${y.P}</div><div class="hint">days</div></div>
    <div class="card kpi a"><div class="lbl">Total Absent</div><div class="val">${y.A}</div><div class="hint">days</div></div>
    <div class="card kpi w"><div class="lbl">Total Week Off</div><div class="val">${y.W}</div><div class="hint">paid</div></div>
    <div class="card kpi s"><div class="lbl">Salary Earned So Far</div><div class="val" style="font-size:calc(22px*var(--fs))">${esc(fm(y.earned))}</div><div class="hint">of ${esc(fm((+emp().salary||0)*12))} per year</div></div>
    <div class="card kpi m"><div class="lbl">Present %</div><div class="val">${pct}</div><div class="hint">Present vs Absent</div></div>
    <div class="card kpi s"><div class="lbl">Days Marked</div><div class="val">${y.marked}</div><div class="hint">${y.paid} paid days</div></div>
  </div>
  <div class="grid two">
    <div class="card"><h3>Monthly breakdown <span class="muted" style="font-weight:500;font-size:calc(12.5px*var(--fs))">${esc(s.year)}</span></h3>
      <div class="tbl-wrap"><table class="mon"><thead><tr><th>Month</th><th class="n">Present</th><th class="n">Absent</th><th class="n">Week Off</th><th class="n hide-m">Paid Days</th><th class="n">Salary Earned</th></tr></thead>
      <tbody>${rows}<tr class="tot"><td>TOTAL</td><td class="n">${y.P}</td><td class="n">${y.A}</td><td class="n">${y.W}</td><td class="n hide-m">${y.paid}</td><td class="n">${fm(y.earned)}</td></tr></tbody></table></div></div>
    <div class="grid" style="align-content:start">
      <div class="card"><h3>Status summary</h3><div class="donut-box"><div class="donut" style="background:${donut}" data-c="${y.marked}"></div><div class="legend" style="min-width:170px">${legend}</div></div></div>
      <div class="card"><h3>Salary earned by month</h3><div class="bars">${bars}</div></div>
    </div>
  </div>`;
  const P = perms(), body = (P.att === 'none' ? '' : attHtml) + dashExtra();
  return dashHello() + (body || `<div class="card"><div class="empty-state">No sections are enabled for your account. Please contact the admin.</div></div>`);
}
function dashHello(){
  const me = S.me || {}, now = new Date(), hr = now.getHours();
  const name = me.viewing ? (me.viewName || 'User') : (me.name || me.username || cfg().name || cfg().username || 'User');
  const lead = me.viewing ? 'Dashboard of' : (hr < 12 ? 'Good morning,' : hr < 17 ? 'Good afternoon,' : 'Good evening,');
  return `<div class="hello"><div class="hi"><span class="hw">${lead}</span> <b>${esc(name)}</b>${me.viewing ? '' : ' 👋'}</div><div class="muted">${WD[now.getDay()]}, ${esc(fmtDateNice(todayISO()))}</div></div>`;
}

function dashExtra(){
  const s = cfg(), y = +s.year, now = new Date(), yp = y + '-';
  const curM = now.getFullYear() === y ? now.getMonth() : -1;
  const cmp = v => v >= 100000 ? (v/100000).toFixed(1) + 'L' : v >= 1000 ? (v/1000).toFixed(1) + 'k' : String(Math.round(v));
  const bars = (vals, lab, cls) => { const mx = Math.max(1, ...vals);
    return `<div class="bars ${cls||''}">${vals.map((v, i) => `<div class="b" title="${MONTHS[i]}: ${esc(lab(v))}"><div class="m">${v ? esc(cmp(v)) : ''}</div><div class="col ${v?'':'zero'}" style="height:${Math.max(2, v/mx*80)}%"></div><div class="m">${MON[i]}</div></div>`).join('')}</div>`; };
  const hb = (arr, total, lab, cls) => arr.map(([n, v]) => `<div class="hbar"><div class="row"><span>${esc(n)}</span><b>${esc(lab(v))} <span class="muted" style="font-weight:500">· ${(v/total*100).toFixed(0)}%</span></b></div><div class="track"><div class="fill ${cls||''}" style="width:${v/total*100}%"></div></div></div>`).join('');

  /* ---- expenses ---- */
  const ex = S.d.expenses.filter(x => x.date.startsWith(yp));
  let inc = 0, exp = 0; const mExp = Array(12).fill(0), byCat = {};
  ex.forEach(x => { const mi = +x.date.slice(5, 7) - 1;
    if (catType(x.category) === 'Income') inc += x.amount; else { exp += x.amount; mExp[mi] += x.amount; byCat[x.category] = (byCat[x.category]||0) + x.amount; } });
  const topCats = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const recentEx = [...ex].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  const exRows = recentEx.map(x => { const t = catType(x.category);
    return `<tr><td data-l="Date">${esc(fmtDateNice(x.date))}</td><td data-l="Category"><span class="pill ${t==='Income'?'inc':'exp'}">${esc(x.category)}</span></td><td data-l="Note" style="white-space:normal">${esc(x.note)}</td><td data-l="Amount" class="n ${t==='Income'?'amt-inc':'amt-exp'}">${t==='Income'?'+':'−'}${esc(fm(x.amount))}</td></tr>`; }).join('');
  const expHtml = `<div class="dsec"><span>💸 Expenses <span class="muted" style="font-weight:500;font-size:calc(13px*var(--fs))">${y}</span></span><button class="btn soft sm" onclick="go('expenses')">Open</button></div>
  <div class="grid kpis">
    <div class="card kpi p"><div class="lbl">Income</div><div class="val" style="font-size:calc(22px*var(--fs))">${esc(fm(inc))}</div></div>
    <div class="card kpi a"><div class="lbl">Expenses</div><div class="val" style="font-size:calc(22px*var(--fs))">${esc(fm(exp))}</div></div>
    <div class="card kpi s"><div class="lbl">Balance</div><div class="val" style="font-size:calc(22px*var(--fs));color:${inc-exp<0?'var(--bad)':'var(--good)'}">${esc(fm(inc-exp))}</div></div>
    <div class="card kpi m"><div class="lbl">This month spent</div><div class="val" style="font-size:calc(22px*var(--fs))">${esc(fm(curM >= 0 ? mExp[curM] : 0))}</div><div class="hint">${ex.length} entries this year</div></div>
  </div>
  <div class="grid two-eq" style="margin-bottom:16px">
    <div class="card"><h3>Spending by month</h3>${bars(mExp, v => fm(v), 'red')}</div>
    <div class="card"><h3>Top spending categories</h3>${topCats.length ? hb(topCats, exp, fm) : '<div class="empty-state">No expenses recorded yet</div>'}</div>
  </div>
  <div class="card"><h3>Recent transactions</h3>${recentEx.length ? `<div class="tbl-wrap"><table class="stk"><thead><tr><th>Date</th><th>Category</th><th>Note</th><th class="n">Amount</th></tr></thead><tbody>${exRows}</tbody></table></div>` : '<div class="empty-state">Nothing here yet</div>'}</div>`;

  /* ---- work ---- */
  const wk = S.d.work.filter(x => x.date.startsWith(yp));
  const mW = Array(12).fill(0), days = new Set(), prod = {};
  wk.forEach(x => { mW[+x.date.slice(5, 7) - 1]++; days.add(x.date); const k = (x.product || '').trim(); if (k) prod[k] = (prod[k]||0) + 1; });
  const topProd = Object.entries(prod).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const recentW = [...wk].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
  const wRows = recentW.map(x => `<tr><td data-l="Date">${esc(fmtDateNice(x.date))}</td><td data-l="Name">${esc(x.name)}</td><td data-l="Product">${esc(x.product)}</td><td data-l="Product no.">${esc(x.number)}</td><td data-l="Sticker">${esc(x.sticker)}</td><td data-l="Description" style="white-space:normal;min-width:160px">${esc(x.desc)}</td></tr>`).join('');
  const workHtml = `<div class="dsec"><span>🛠️ Work <span class="muted" style="font-weight:500;font-size:calc(13px*var(--fs))">${y}</span></span><button class="btn soft sm" onclick="go('work')">Open</button></div>
  <div class="grid kpis">
    <div class="card kpi s"><div class="lbl">Work entries</div><div class="val">${wk.length}</div><div class="hint">this year</div></div>
    <div class="card kpi p"><div class="lbl">Days with work</div><div class="val">${days.size}</div><div class="hint">of the year</div></div>
    <div class="card kpi m"><div class="lbl">This month</div><div class="val">${curM >= 0 ? mW[curM] : 0}</div><div class="hint">entries</div></div>
    <div class="card kpi w"><div class="lbl">Products</div><div class="val">${Object.keys(prod).length}</div><div class="hint">different names</div></div>
  </div>
  <div class="grid two-eq" style="margin-bottom:16px">
    <div class="card"><h3>Work entries by month</h3>${bars(mW, v => v + ' entries', 'teal')}</div>
    <div class="card"><h3>Top products</h3>${topProd.length ? hb(topProd, wk.length, v => v + ' entries', 'blue') : '<div class="empty-state">No work recorded yet</div>'}</div>
  </div>
  <div class="card" style="margin-bottom:10px"><h3>Recent work</h3>${recentW.length ? `<div class="tbl-wrap"><table class="stk"><thead><tr><th>Date</th><th>Name</th><th>Product</th><th>Product no.</th><th>Sticker</th><th>Description</th></tr></thead><tbody>${wRows}</tbody></table></div>` : '<div class="empty-state">Nothing here yet</div>'}</div>`;

  const P = perms();
  return (P.exp === 'none' ? '' : expHtml) + (P.work === 'none' ? '' : workHtml);
}

/* =====================================================================
   VIEW: ATTENDANCE
   ===================================================================== */
function vAttendance(){
  const y = +cfg().year, m = S.month, st = monthStats(m), att = S.d.attendance[m] || {}, sm = smap();
  const first = new Date(y, m-1, 1).getDay(), now = new Date();
  let cells = WD.map(w => `<div class="wd">${w}</div>`).join('') + '<div class="day empty"></div>'.repeat(first);
  for (let d = 1; d <= st.dim; d++){
    const c = att[d], col = c && sm[c] ? sm[c].color : '#fff';
    const isT = now.getFullYear() === y && now.getMonth()+1 === m && now.getDate() === d;
    cells += `<button class="day ${isT?'today-ring':''}" style="background:${esc(col)}" onclick="dayPicker(${m},${d})"><span class="dn">${d}</span><span class="dc">${esc(c||'')}</span></button>`;
  }
  const chips = S.d.statuses.map(x => `<span class="chip" style="background:${esc(x.color)}">${esc(x.code)} · ${esc(x.label)}: ${st.counts[x.code]||0}</span>`).join('')
    + `<span class="chip">Paid days: ${st.paid}</span><span class="chip">Salary: ${esc(fm(st.earned))}</span>`;

  const regHead = '<th class="lbl">Month</th>' + Array.from({length:31}, (_, i) => `<th>${i+1}</th>`).join('') + '<th class="s">P</th><th class="s">A</th><th class="s">W</th><th class="s">Paid</th><th class="s">Salary</th>';
  const regRows = MONTHS.map((nm, i) => {
    const mm = i+1, x = monthStats(mm), a = S.d.attendance[mm] || {}; let tds = '';
    for (let d = 1; d <= 31; d++){
      if (d > x.dim) { tds += '<td class="x"></td>'; continue; }
      const c = a[d]; tds += `<td class="c" style="background:${c && sm[c] ? esc(sm[c].color) : 'transparent'}" onclick="dayPicker(${mm},${d})">${esc(c||'')}</td>`;
    }
    return `<tr><td class="lbl">${nm}</td>${tds}<td class="s">${x.P}</td><td class="s">${x.A}</td><td class="s">${x.W}</td><td class="s">${x.paid}</td><td class="s">${fm(x.earned)}</td></tr>`;
  }).join('');
  const fillOpts = S.d.statuses.map(x => `<option value="${esc(x.code)}">${esc(x.code)} – ${esc(x.label)}</option>`).join('');

  return `<div class="card" style="margin-bottom:16px">
    <div class="cal-head">
      <button class="btn ghost sm" onclick="chMonth(-1)">‹</button>
      <select class="select" style="width:auto" onchange="S.month=+this.value;render()">${MONTHS.map((n, i) => `<option value="${i+1}" ${i+1===m?'selected':''}>${n} ${y}</option>`).join('')}</select>
      <button class="btn ghost sm" onclick="chMonth(1)">›</button>
      <button class="btn soft sm" onclick="S.month=new Date().getMonth()+1;render()">This month</button>
      <span style="flex:1"></span>
      <button class="btn soft sm" onclick="doExport('att','xlsx')">⬇ Excel</button><button class="btn soft sm" onclick="doExport('att','pdf')">⬇ PDF</button>
    </div>
    <div class="chips" style="margin-bottom:16px">${chips}</div>
    <div class="cal">${cells}</div>
    <p class="muted" style="margin-top:12px;font-size:calc(13px*var(--fs))">Tap a date to mark Present / Absent / Week Off. Changes are saved to your Google Sheet instantly.</p>
  </div>
  <div class="card" style="margin-bottom:16px"><h3>Quick actions for ${MONTHS[m-1]}</h3>
    <div class="actions">
      <select class="select" id="qaWd" style="width:auto">${WD.map((w, i) => `<option value="${i}">Every ${w}</option>`).join('')}</select>
      <select class="select" id="qaWdCode" style="width:auto">${fillOpts}</select>
      <button class="btn soft sm" onclick="quickWeekday()">Apply to unmarked days</button>
    </div>
    <div class="actions" style="margin-top:12px">
      <select class="select" id="qaPast" style="width:auto">${fillOpts}</select>
      <button class="btn soft sm" onclick="quickPast()">Fill all unmarked days up to today</button>
    </div></div>
  <div class="card"><details class="regbox" ${window.matchMedia('(max-width:640px)').matches ? '' : 'open'}><summary>Full year register — ${y} · ${esc(emp().name || 'Employee')}</summary>
    <div class="tbl-wrap"><table class="reg"><thead><tr>${regHead}</tr></thead><tbody>${regRows}</tbody></table></div></details></div>`;
}
function chMonth(n){ S.month = Math.min(12, Math.max(1, S.month + n)); render(); }
async function quickWeekday(){ if (!can('att')) return deny();
  const wd = +$('#qaWd').value, code = $('#qaWdCode').value, m = S.month, y = +cfg().year, att = S.d.attendance[m] || {}, e = [];
  for (let d = 1; d <= daysIn(y, m); d++) if (new Date(y, m-1, d).getDay() === wd && !att[d]) e.push({ month:m, day:d, code });
  if (!e.length) return toast('No unmarked ' + WD[wd] + 's this month');
  setAtt(e);
}
async function quickPast(){ if (!can('att')) return deny();
  const code = $('#qaPast').value, m = S.month, y = +cfg().year, att = S.d.attendance[m] || {}, now = new Date(), e = [];
  let last = daysIn(y, m);
  if (now.getFullYear() === y && now.getMonth()+1 === m) last = now.getDate();
  else if (new Date(y, m-1, 1) > now) return toast('This month has not started yet', true);
  for (let d = 1; d <= last; d++) if (!att[d]) e.push({ month:m, day:d, code });
  if (!e.length) return toast('Nothing to fill');
  if (await confirmBox('Fill unmarked days?', `${e.length} unmarked day(s) in ${MONTHS[m-1]} will be set to ${code}.`, 'Fill')) setAtt(e);
}

/* =====================================================================
   VIEW: EXPENSES
   ===================================================================== */
function filteredExpenses(){
  const f = S.exp, q = f.q.trim().toLowerCase();
  return S.d.expenses.filter(x =>
    (f.month === 'all' || +x.date.slice(5,7) === +f.month) &&
    (f.cat === 'all' || x.category === f.cat) &&
    (!q || (x.note + ' ' + x.category).toLowerCase().includes(q))
  ).sort((a, b) => b.date.localeCompare(a.date));
}
function vExpenses(){
  const list = filteredExpenses();
  let inc = 0, exp = 0; const byCat = {};
  list.forEach(x => { if (catType(x.category) === 'Income') inc += x.amount; else { exp += x.amount; byCat[x.category] = (byCat[x.category]||0) + x.amount; } });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const catHtml = cats.length ? cats.map(([n, v]) => `<div class="hbar"><div class="row"><span>${esc(n)}</span><b>${esc(fm(v))} <span class="muted" style="font-weight:500">· ${(v/exp*100).toFixed(0)}%</span></b></div><div class="track"><div class="fill" style="width:${v/exp*100}%"></div></div></div>`).join('')
    : '<div class="empty-state">No expenses in this view</div>';
  const rows = list.map(x => { const t = catType(x.category);
    return `<tr><td data-l="Date">${esc(fmtDateNice(x.date))}</td><td data-l="Category"><span class="pill ${t==='Income'?'inc':'exp'}">${esc(x.category)}</span></td><td data-l="Note" style="white-space:normal;min-width:140px">${esc(x.note)}</td>
      <td data-l="Amount" class="n ${t==='Income'?'amt-inc':'amt-exp'}">${t==='Income'?'+':'−'}${esc(fm(x.amount))}</td>
      <td class="n nowrap"><button class="btn ghost sm" onclick="entryForm('${esc(x.id)}')">Edit</button> <button class="btn ghost sm" onclick="delEntry('${esc(x.id)}')">🗑</button></td></tr>`; }).join('');
  const monthOpts = '<option value="all">All months</option>' + MONTHS.map((n, i) => `<option value="${i+1}" ${S.exp.month==i+1?'selected':''}>${n}</option>`).join('');
  const catOpts = '<option value="all">All categories</option>' + S.d.categories.map(c => `<option ${S.exp.cat===c.name?'selected':''}>${esc(c.name)}</option>`).join('');
  return `<div class="grid kpis">
    <div class="card kpi p"><div class="lbl">Income</div><div class="val" style="font-size:calc(22px*var(--fs))">${esc(fm(inc))}</div></div>
    <div class="card kpi a"><div class="lbl">Expenses</div><div class="val" style="font-size:calc(22px*var(--fs))">${esc(fm(exp))}</div></div>
    <div class="card kpi s"><div class="lbl">Balance</div><div class="val" style="font-size:calc(22px*var(--fs));color:${inc-exp<0?'var(--bad)':'var(--good)'}">${esc(fm(inc-exp))}</div></div>
    <div class="card kpi m"><div class="lbl">Entries</div><div class="val">${list.length}</div></div></div>
  <div class="card" style="margin-bottom:16px"><div class="actions">
      <select class="select" style="width:auto" onchange="S.exp.month=this.value;render()">${monthOpts}</select>
      <select class="select" style="width:auto" onchange="S.exp.cat=this.value;render()">${catOpts}</select>
      <input class="input" style="width:200px" placeholder="Search note…" value="${esc(S.exp.q)}" oninput="S.exp.q=this.value;clearTimeout(window._qt);window._qt=setTimeout(()=>{render();const i=document.querySelector('input[placeholder^=Search]');i.focus();i.setSelectionRange(99,99)},250)">
      <span style="flex:1"></span>
      <button class="btn soft" onclick="doExport('exp','xlsx')">⬇ Ledger Excel</button><button class="btn soft" onclick="doExport('exp','pdf')">⬇ Ledger PDF</button>
      <button class="btn soft" onclick="catManager()">⚙ Categories</button>
      <button class="btn" onclick="entryForm()">＋ Add entry</button></div></div>
  <div class="grid two">
    <div class="card"><h3>Transactions</h3>${list.length ? `<div class="tbl-wrap"><table class="stk"><thead><tr><th>Date</th><th>Category</th><th>Note</th><th class="n">Amount</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty-state">No entries yet. Tap “Add entry” to start.</div>'}</div>
    <div class="card" style="align-self:start"><h3>Where the money went</h3>${catHtml}</div>
  </div>`;
}
function fmtDateNice(iso){ const [y, m, d] = iso.split('-').map(Number); return isNaN(m) ? iso : `${d} ${MON[m-1]} ${y}`; }

function entryForm(id){ if (!can('exp')) return deny();
  const x = id ? S.d.expenses.find(e => e.id === id) : null;
  if (!S.d.categories.length) return toast('Add a category first (⚙ Categories)', true);
  const opt = t => S.d.categories.filter(c => c.type === t).map(c => `<option ${x && x.category===c.name ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const w = openModal(`<h3>${x ? 'Edit entry' : 'Add entry'}</h3><p class="sub">Income categories add to your balance, expense categories subtract.</p>
    <form id="ef"><div class="row2"><div class="field"><label>Date</label><input class="input" type="date" name="date" value="${esc(x ? x.date : todayISO())}" required></div>
      <div class="field"><label>Amount (${esc(cfg().currency)})</label><input class="input" type="number" name="amount" min="0.01" step="0.01" value="${x ? x.amount : ''}" required inputmode="decimal"></div></div>
      <div class="field"><label>Category</label><select class="select" name="category"><optgroup label="Expense">${opt('Expense')}</optgroup><optgroup label="Income">${opt('Income')}</optgroup></select></div>
      <div class="field"><label>Note</label><input class="input" name="note" maxlength="300" placeholder="Optional" value="${esc(x ? x.note : '')}"></div>
      <div class="foot"><button type="button" class="btn ghost" data-x>Cancel</button><button class="btn" type="submit">Save</button></div></form>`);
  w.querySelector('[data-x]').onclick = () => w.remove();
  w.querySelector('#ef').onsubmit = async ev => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target)); const btn = ev.submitter; btn.disabled = true;
    try{
      if (x){ const r = await api('updateExpense', { id:x.id, ...f }); Object.assign(x, r.expense); }
      else { const r = await api('addExpense', f); S.d.expenses.push(r.expense); }
      w.remove(); render(); toast('Saved');
    }catch(e){ btn.disabled = false; handleErr(e); }
  };
}
async function delEntry(id){ if (!can('exp')) return deny();
  const x = S.d.expenses.find(e => e.id === id);
  if (!await confirmBox('Delete this entry?', `${x.category} · ${fm(x.amount)} on ${fmtDateNice(x.date)} will be removed from your sheet.`, 'Delete', true)) return;
  try { await api('deleteExpense', { id }); S.d.expenses = S.d.expenses.filter(e => e.id !== id); render(); toast('Deleted'); } catch(e){ handleErr(e); }
}

/* ---- category manager ---- */
function catManager(){ if (!can('exp')) return deny();
  const w = openModal('', 'wide'); drawCats(w);
}
function drawCats(w){
  const used = n => S.d.expenses.filter(e => e.category === n).length;
  const rows = S.d.categories.map((c, i) => `<div class="cat-row"><input class="input" id="cn${i}" value="${esc(c.name)}" maxlength="40">
    <select class="select" id="ct${i}"><option ${c.type==='Expense'?'selected':''}>Expense</option><option ${c.type==='Income'?'selected':''}>Income</option></select>
    <div class="acts"><button class="btn soft sm" data-save="${i}">Save</button><button class="btn ghost sm" data-del="${i}" title="${used(c.name)} entries">🗑 ${used(c.name) || ''}</button></div></div>`).join('');
  w.querySelector('.modal').innerHTML = `<h3>Manage categories</h3><p class="sub">Rename, change type, delete or add. Renaming also updates existing entries.</p>
    ${rows || '<div class="empty-state">No categories yet</div>'}
    <div class="sec-title" style="margin-top:18px">Add new category</div>
    <div class="cat-row"><input class="input" id="ncName" placeholder="e.g. Groceries" maxlength="40"><select class="select" id="ncType"><option>Expense</option><option>Income</option></select><div class="acts"><button class="btn sm" id="ncAdd">＋ Add</button></div></div>
    <div class="foot"><button class="btn ghost" data-x>Done</button></div>`;
  const m = w.querySelector('.modal');
  m.querySelector('[data-x]').onclick = () => { w.remove(); render(); };
  m.querySelector('#ncAdd').onclick = async () => {
    try { const r = await api('addCategory', { name:$('#ncName').value, type:$('#ncType').value }); S.d.categories = r.categories; drawCats(w); toast('Category added'); } catch(e){ handleErr(e); }
  };
  m.querySelectorAll('[data-save]').forEach(b => b.onclick = async () => {
    const i = +b.dataset.save, old = S.d.categories[i].name;
    try {
      const r = await api('updateCategory', { oldName:old, name:$('#cn'+i).value, type:$('#ct'+i).value });
      const nn = $('#cn'+i).value.trim();
      if (nn !== old) S.d.expenses.forEach(e => { if (e.category === old) e.category = nn; });
      S.d.categories = r.categories; drawCats(w); toast('Category updated');
    } catch(e){ handleErr(e); }
  });
  m.querySelectorAll('[data-del]').forEach(b => b.onclick = () => delCategory(+b.dataset.del, w));
}
async function delCategory(i, w){
  const c = S.d.categories[i], n = S.d.expenses.filter(e => e.category === c.name).length;
  let reassign;
  if (n){
    const others = S.d.categories.filter(x => x.name !== c.name);
    const r = await new Promise(res => {
      const w2 = openModal(`<h3>Delete “${esc(c.name)}”?</h3><p class="sub">${n} entr${n>1?'ies use':'y uses'} this category. Where should they go?</p>
        <div class="field"><select class="select" id="rs"><option value="">Uncategorized (leave blank)</option>${others.map(o => `<option>${esc(o.name)}</option>`).join('')}</select></div>
        <div class="foot"><button class="btn ghost" data-no>Cancel</button><button class="btn danger" data-yes>Delete category</button></div>`);
      w2.querySelector('[data-yes]').onclick = () => { const v = w2.querySelector('#rs').value; w2.remove(); res({ v }); };
      w2.querySelector('[data-no]').onclick = () => { w2.remove(); res(null); };
    });
    if (!r) return; reassign = r.v;
  } else if (!await confirmBox('Delete category?', `“${c.name}” will be removed.`, 'Delete', true)) return;
  try {
    const r = await api('deleteCategory', { name:c.name, reassignTo:reassign });
    if (reassign !== undefined) S.d.expenses.forEach(e => { if (e.category === c.name) e.category = reassign; });
    S.d.categories = r.categories; drawCats(w); toast('Category deleted');
  } catch(e){ handleErr(e); }
}


/* =====================================================================
   VIEW: WORK  (daily work record — whole year, with filters)
   ===================================================================== */
const WF = ['name', 'product', 'number', 'sticker', 'desc'];
const pad2 = n => String(n).padStart(2, '0');
const wMatch = (e, q) => [e.name, e.product, e.number, e.sticker, e.desc].join(' ').toLowerCase().includes(q);

function wCalendar(byDate){
  const y = S.wy, m = S.wcm, dim = daysIn(y, m), first = new Date(y, m-1, 1).getDay(), tIso = todayISO();
  let c = WD.map(w => `<div class="wdl">${w.slice(0,2)}</div>`).join('') + '<div class="mcd blank"></div>'.repeat(first);
  for (let d = 1; d <= dim; d++){
    const iso = `${y}-${pad2(m)}-${pad2(d)}`;
    c += `<button class="mcd ${S.wf.date===iso?'sel':''} ${iso===tIso?'now':''}" onclick="wPick('${iso}')" title="${(byDate[iso]||[]).length} entries">${d}${byDate[iso] ? '<i></i>' : ''}</button>`;
  }
  return `<div class="mini-head"><button class="btn ghost sm" onclick="wCalNav(-1)">‹</button><span>${MONTHS[m-1]} ${y}</span><button class="btn ghost sm" onclick="wCalNav(1)">›</button></div>
    <div class="mc">${c}</div>
    <p class="muted" style="font-size:calc(12px*var(--fs));margin-top:8px">Tap a date to add or see its entries. Green dot = work recorded. Tap again to clear.</p>`;
}
function wCalNav(n){ S.wcm += n; if (S.wcm > 12){ S.wcm = 1; S.wy++; } if (S.wcm < 1){ S.wcm = 12; S.wy--; } render(); }
function wPick(iso){
  if (S.wf.date === iso) S.wf.date = '';
  else { S.wf.date = iso; S.wf.month = 'all'; S.wy = +iso.slice(0, 4); S.wcm = +iso.slice(5, 7); }
  render(); const t = document.getElementById('wTable'); if (t) t.scrollIntoView({ behavior:'smooth', block:'start' });
}
function wClear(){ S.wf = defaultWf(); render(); }
function wToday(){ const t = todayISO(); if (S.wf.date !== t) wPick(t); else { const e = document.getElementById('wTable'); if (e) e.scrollIntoView({ behavior:'smooth' }); } }
function wSearch(v){
  S.wf.q = v; clearTimeout(window._wt);
  window._wt = setTimeout(() => { render(); const i = $('#wq'); if (i){ i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250);
}

function vWork(){
  const y = S.wy, f = S.wf, q = f.q.trim().toLowerCase(), tIso = todayISO();
  const yearList = S.d.work.filter(x => x.date.startsWith(y + '-'));
  const byDate = {}, perMonth = Array(13).fill(0);
  yearList.forEach(x => { (byDate[x.date] = byDate[x.date] || []).push(x); perMonth[+x.date.slice(5, 7)]++; });
  const daysWith = Object.keys(byDate).length, hideEmpty = !!(q || f.only);

  const inp = (key, fld, ph, val) =>
    `<input class="in" data-k="${esc(key)}" data-f="${fld}" placeholder="${ph}" value="${esc(val)}" maxlength="${fld === 'desc' ? 500 : 100}" oninput="wDraft(this)" onkeydown="if(event.key==='Enter'){event.preventDefault();workSave('${esc(key)}')}">`;
  const dv = (key, e, fld) => { const d = S.wDraft[key]; return d && d[fld] !== undefined ? d[fld] : (e ? e[fld] : ''); };
  const inputCells = (key, e) => `<td data-l="Name">${inp(key,'name','Name',dv(key,e,'name'))}</td>
    <td data-l="Product name">${inp(key,'product','Product name',dv(key,e,'product'))}</td>
    <td data-l="Product no.">${inp(key,'number','Product no.',dv(key,e,'number'))}</td>
    <td data-l="Sticker">${inp(key,'sticker','Sticker',dv(key,e,'sticker'))}</td>
    <td class="ds" data-l="Description">${inp(key,'desc','Description',dv(key,e,'desc'))}</td>`;
  const SHOWL = { name:'Name', product:'Product name', number:'Product no.', sticker:'Sticker' };
  const showCells = e => ['name','product','number','sticker'].map(k => e[k] ? `<td data-l="${SHOWL[k]}">${esc(e[k])}</td>` : `<td class="emptyc"><span class="dim">—</span></td>`).join('')
    + (e.desc ? `<td class="ds" data-l="Description">${esc(e.desc)}</td>` : `<td class="emptyc"><span class="dim">—</span></td>`);

  let rows = '';
  for (let m = 1; m <= 12; m++){
    if (f.month !== 'all' && +f.month !== m) continue;
    const dim = daysIn(y, m); let mr = '';
    for (let d = 1; d <= dim; d++){
      const iso = `${y}-${pad2(m)}-${pad2(d)}`;
      if (f.date && f.date !== iso) continue;
      const dt = new Date(y, m-1, d), all = byDate[iso] || [], es = q ? all.filter(e => wMatch(e, q)) : all;
      if (hideEmpty && !es.length && !S.wAdd[iso]) continue;
      const cls = (iso === tIso ? 'tdy ' : '') + (dt.getDay() === 0 ? 'sun ' : '') + (es.length ? 'has' : '');
      const dateLabel = `${d} ${MON[m-1]}<span class="wds">${WD[dt.getDay()]}</span>`;
      const lines = [];
      es.forEach(e => {
        if (S.wEdit === e.id){
          const key = 'e:' + e.id;
          lines.push({ edit:true, key, e, body: inputCells(key, e), act:
            `<button class="btn sm" onclick="workSave('${esc(key)}')">Update</button> <button class="btn ghost sm" onclick="workCancel('${esc(key)}')">Cancel</button>` });
        } else {
          lines.push({ body: showCells(e), act:
            `<button class="btn ghost sm" onclick="workEdit('${esc(e.id)}')">✎ Edit</button> <button class="btn ghost sm" onclick="workDel('${esc(e.id)}')">🗑 Delete</button>` });
        }
      });
      if (!all.length || S.wAdd[iso]){
        const key = 'n:' + iso;
        lines.push({ body: inputCells(key, null), act:
          `<button class="btn sm" onclick="workSave('${esc(key)}')">Save</button>` + (all.length ? ` <button class="btn ghost sm" onclick="workCancel('${esc(key)}')">Cancel</button>` : '') });
      }
      lines.forEach((ln, i) => {
        let dc;
        if (i === 0){
          if (ln.edit) dc = `<td class="d" style="min-width:150px"><input class="in" type="date" data-k="${esc(ln.key)}" data-f="date" value="${esc(dv(ln.key, ln.e, 'date'))}" oninput="wDraft(this)" style="min-width:135px"></td>`;
          else dc = `<td class="d">${dateLabel}${all.length && !S.wAdd[iso] ? `<button class="plus" title="Add another entry for this date" onclick="workAddMore('${iso}')">+</button>` : ''}</td>`;
        } else dc = `<td class="d sub-d">↳</td>`;
        mr += `<tr class="${cls}">${dc}${ln.body}<td class="ac">${ln.act}</td></tr>`;
      });
    }
    if (mr) rows += `<tr class="mh"><td colspan="7">${MONTHS[m-1]} ${y} <span style="font-weight:500;color:var(--muted);font-size:calc(12.5px*var(--fs))">· ${perMonth[m]} entries</span></td></tr>` + mr;
  }

  const yrs = []; for (let i = new Date().getFullYear() - 3; i <= new Date().getFullYear() + 1; i++) yrs.push(i);
  if (!yrs.includes(y)) yrs.push(y); yrs.sort((a, b) => a - b);
  const mchips = `<button class="chip mchip ${f.month==='all'?'on':''}" onclick="S.wf.month='all';S.wf.date='';render()">All year<b>${yearList.length}</b></button>`
    + MON.map((n, i) => `<button class="chip mchip ${+f.month===i+1?'on':''}" onclick="S.wf.month=${i+1};S.wf.date='';S.wcm=${i+1};render()">${n}<b>${perMonth[i+1]}</b></button>`).join('');
  const filtered = f.date || f.q || (f.only && !isPhone()) || f.month !== 'all';

  return `<div class="card" style="margin-bottom:16px"><div class="wfilter">
    <div>${wCalendar(byDate)}</div>
    <div>
      <div class="actions" style="margin-bottom:12px">
        <select class="select" style="width:auto" onchange="S.wy=+this.value;S.wf.date='';render()">${yrs.map(v => `<option ${v===y?'selected':''}>${v}</option>`).join('')}</select>
        <input class="input" id="wq" style="width:210px" placeholder="Search name, product, no.…" value="${esc(f.q)}" oninput="wSearch(this.value)">
        <label class="check" style="margin:0"><input type="checkbox" ${f.only?'checked':''} onchange="S.wf.only=this.checked;render()"> Only days with entries</label>
        <button class="btn sm" onclick="wToday()">＋ Add entry for today</button>
      </div>
      <div class="sec-title" style="margin-bottom:8px">Month</div>
      <div class="chips" style="margin-bottom:14px">${mchips}</div>
      <div class="chips">
        <span class="chip" style="background:var(--good-soft)">Entries in ${y}: ${yearList.length}</span>
        <span class="chip">Days with work: ${daysWith}</span>
        ${f.date ? `<span class="chip" style="background:var(--brand-soft);color:var(--brand)">📅 ${esc(fmtDateNice(f.date))}</span>` : ''}
        ${filtered ? `<button class="chip mchip" onclick="wClear()">✕ Clear filters</button>` : ''}
      </div>
      <div class="actions" style="margin-top:14px"><button class="btn soft sm" onclick="doExport('work','xlsx')">⬇ Excel</button><button class="btn soft sm" onclick="doExport('work','pdf')">⬇ PDF</button></div>
    </div></div></div>
  <div class="card" id="wTable"><h3>Work record — ${y}${f.date ? ' · ' + esc(fmtDateNice(f.date)) : ''}</h3>
    ${rows ? `<div class="tbl-wrap"><table class="wk"><thead><tr><th class="d">Date</th><th>Name</th><th>Product name</th><th>Product no.</th><th>Sticker</th><th>Description</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>`
           : '<div class="empty-state">No entries match these filters.</div>'}
    <p class="muted" style="margin-top:12px;font-size:calc(13px*var(--fs))">Type in the boxes of a date and press <b>Save</b> (or Enter). Use <b>＋</b> next to a date for more than one entry. Use <b>Edit</b> / <b>Delete</b> to fix mistakes. Saved to the “Work” tab of your Google Sheet.</p>
  </div>`;
}
function wDraft(el){ const k = el.dataset.k; (S.wDraft[k] = S.wDraft[k] || {})[el.dataset.f] = el.value; }
function workAddMore(iso){ if (!can('work')) return deny(); S.wAdd[iso] = true; render(); }
function workEdit(id){ if (!can('work')) return deny(); S.wEdit = id; render(); }
function workCancel(key){
  delete S.wDraft[key];
  if (key[0] === 'e') S.wEdit = null; else delete S.wAdd[key.slice(2)];
  render();
}
async function workSave(key){ if (!can('work')) return deny();
  if (S.wBusy) return;
  const isNew = key[0] === 'n', ref = key.slice(2), v = {};
  document.querySelectorAll(`[data-k="${key}"]`).forEach(el => v[el.dataset.f] = el.value);
  if (!WF.some(f => (v[f] || '').trim())) return toast('Write something in at least one box', true);
  S.wBusy = true;
  try{
    if (isNew){ const r = await api('addWork', { ...v, date: ref }); S.d.work.push(r.work); delete S.wAdd[ref]; }
    else {
      const x = S.d.work.find(e => e.id === ref);
      const r = await api('updateWork', { ...v, id: ref, date: v.date || x.date }); Object.assign(x, r.work); S.wEdit = null;
    }
    delete S.wDraft[key]; render(); toast('Saved');
  }catch(e){ handleErr(e); }
  finally{ S.wBusy = false; }
}
async function workDel(id){ if (!can('work')) return deny();
  const x = S.d.work.find(e => e.id === id); if (!x) return;
  const what = [x.name, x.product].filter(Boolean).join(' · ') || 'This entry';
  if (!await confirmBox('Delete this work entry?', `${what} on ${fmtDateNice(x.date)} will be removed from your sheet.`, 'Delete', true)) return;
  try { await api('deleteWork', { id }); S.d.work = S.d.work.filter(e => e.id !== id); render(); toast('Deleted'); } catch(e){ handleErr(e); }
}

/* =====================================================================
   VIEW: PASSWORDS  (website URL + user id + password, one-tap copy)
   ===================================================================== */
const pwHref = u => {
  u = String(u || '').trim(); if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (/^[a-z][a-z0-9+.\-]*:\/\//i.test(u) || /^(javascript|data|vbscript|file):/i.test(u)) return '';   // never link odd schemes
  return 'https://' + u;
};
function filteredPw(){
  const q = S.pw.q.trim().toLowerCase();
  return [...(S.d.passwords || [])]
    .filter(x => !q || (x.url + ' ' + x.user).toLowerCase().includes(q))
    .sort((a, b) => (a.url || '').toLowerCase().localeCompare((b.url || '').toLowerCase()));
}
function vPasswords(){
  const list = filteredPw(), total = (S.d.passwords || []).length;
  const cp = (id, f, label) => `<button class="btn ghost sm" onclick="pwCopy('${esc(id)}','${f}')" title="Copy ${label}">📋</button>`;
  const rows = list.map(x => {
    const href = pwHref(x.url);
    return `<tr>
      <td data-l="Website" style="white-space:normal;word-break:break-all;min-width:150px">${x.url ? (href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(x.url)}</a>` : esc(x.url)) + ' ' + cp(x.id, 'url', 'website URL') : '<span class="dim">—</span>'}</td>
      <td data-l="User ID" style="white-space:normal;word-break:break-all">${x.user ? esc(x.user) + ' ' + cp(x.id, 'user', 'user ID') : '<span class="dim">—</span>'}</td>
      <td data-l="Password">${x.pass ? `<span data-pw="${esc(x.id)}" style="font-family:ui-monospace,Menlo,Consolas,monospace;word-break:break-all">••••••••</span> <button class="btn ghost sm" onclick="pwToggle('${esc(x.id)}')" title="Show / hide">👁</button> ${cp(x.id, 'pass', 'password')}` : '<span class="dim">—</span>'}</td>
      <td class="n nowrap"><button class="btn soft sm" onclick="pwCopy('${esc(x.id)}','all')" title="Copy website + user ID + password">📋 Copy all</button>
        <button class="btn ghost sm" onclick="pwForm('${esc(x.id)}')">Edit</button> <button class="btn ghost sm" onclick="pwDel('${esc(x.id)}')">🗑</button></td></tr>`;
  }).join('');
  return `<div class="card" style="margin-bottom:16px"><div class="actions">
      <input class="input" id="pwq" style="width:240px" placeholder="Search website or user ID…" value="${esc(S.pw.q)}" oninput="pwSearch(this.value)">
      <span style="flex:1"></span>
      <button class="btn soft" onclick="pwExport('xlsx')">⬇ Excel</button><button class="btn soft" onclick="pwExport('pdf')">⬇ PDF</button>
      <button class="btn" onclick="pwForm()">＋ Add login</button></div></div>
    <div class="card"><h3>Saved logins <span class="muted" style="font-weight:500;font-size:calc(12.5px*var(--fs))">· ${list.length}${list.length !== total ? ' of ' + total : ''}</span></h3>
      ${list.length ? `<div class="tbl-wrap"><table class="stk"><thead><tr><th>Website URL</th><th>User ID</th><th>Password</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
        : `<div class="empty-state">${total ? 'No logins match your search.' : 'No logins saved yet. Tap “Add login” to start.'}</div>`}
      <p class="muted" style="margin-top:12px;font-size:calc(13px*var(--fs))">📋 next to a field copies just that field. <b>Copy all</b> copies website, user ID and password together. Saved in the “Password Manager” tab of your Google Sheet.</p>
    </div>`;
}
function pwSearch(v){
  S.pw.q = v; clearTimeout(window._pwt);
  window._pwt = setTimeout(() => { render(); const i = $('#pwq'); if (i){ i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250);
}
function legacyCopy(t){
  const a = document.createElement('textarea'); a.value = t; a.setAttribute('readonly', '');
  a.style.cssText = 'position:fixed;top:0;left:0;opacity:0'; document.body.appendChild(a);
  a.select(); a.setSelectionRange(0, t.length);
  let ok = false; try { ok = document.execCommand('copy'); } catch {}
  a.remove(); return ok;
}
async function copyText(t){
  try { if (navigator.clipboard && window.isSecureContext){ await navigator.clipboard.writeText(t); return true; } } catch {}
  return legacyCopy(t);       // fallback: works inside the Apps Script frame / older browsers
}
async function pwCopy(id, f){
  const x = (S.d.passwords || []).find(e => e.id === id); if (!x) return;
  const L = { url:'Website URL', user:'User ID', pass:'Password', all:'Website, user ID and password' };
  const txt = f === 'all'
    ? [x.url && 'Website: ' + x.url, x.user && 'User ID: ' + x.user, x.pass && 'Password: ' + x.pass].filter(Boolean).join('\n')
    : x[f];
  if (!txt) return toast('Nothing to copy', true);
  (await copyText(txt)) ? toast(L[f] + ' copied') : toast('Could not copy — please copy it manually', true);
}
function pwToggle(id){
  const el = document.querySelector(`[data-pw="${id}"]`), x = (S.d.passwords || []).find(e => e.id === id); if (!el || !x) return;
  const on = el.dataset.on === '1'; el.dataset.on = on ? '0' : '1'; el.textContent = on ? '••••••••' : x.pass;
}
function pwForm(id){ if (!can('pw')) return deny();
  const x = id ? S.d.passwords.find(e => e.id === id) : null;
  const w = openModal(`<h3>${x ? 'Edit login' : 'Add login'}</h3><p class="sub">Website URL, user ID and password — saved in your Google Sheet.</p>
    <form id="pwf" autocomplete="off">
      <div class="field"><label>Website URL</label><input class="input" name="url" maxlength="500" placeholder="https://example.com" autocapitalize="off" autocomplete="off" value="${esc(x ? x.url : '')}"></div>
      <div class="row2"><div class="field"><label>User ID</label><input class="input" name="user" maxlength="200" autocapitalize="off" autocomplete="off" value="${esc(x ? x.user : '')}"></div>
        <div class="field"><label>Password</label><input class="input" id="pwIn" type="password" name="pass" maxlength="200" autocapitalize="off" autocomplete="new-password" value="${esc(x ? x.pass : '')}"></div></div>
      <label class="tog"><input type="checkbox" id="pwShow"> Show password</label>
      <div class="foot"><button type="button" class="btn ghost" data-x>Cancel</button><button class="btn" type="submit">${x ? 'Save' : 'Add'}</button></div></form>`);
  w.querySelector('[data-x]').onclick = () => w.remove();
  w.querySelector('#pwShow').onchange = e => { w.querySelector('#pwIn').type = e.target.checked ? 'text' : 'password'; };
  w.querySelector('#pwf').onsubmit = async ev => {
    ev.preventDefault(); const f = Object.fromEntries(new FormData(ev.target)); const btn = ev.submitter; btn.disabled = true;
    try{
      if (x){ const r = await api('updatePw', { id:x.id, ...f }); Object.assign(x, r.pw); }
      else { const r = await api('addPw', f); S.d.passwords.push(r.pw); }
      w.remove(); render(); toast('Saved');
    }catch(e){ btn.disabled = false; handleErr(e); }
  };
}
async function pwDel(id){ if (!can('pw')) return deny();
  const x = S.d.passwords.find(e => e.id === id); if (!x) return;
  if (!await confirmBox('Delete this login?', `${x.url || x.user || 'This entry'} will be removed from your sheet.`, 'Delete', true)) return;
  try { await api('deletePw', { id }); S.d.passwords = S.d.passwords.filter(e => e.id !== id); render(); toast('Deleted'); } catch(e){ handleErr(e); }
}
async function pwExport(fmt){
  if (!(S.d.passwords || []).length) return toast('No logins to export', true);
  if (!await confirmBox('Export passwords?', 'The file will contain your passwords as plain text. Keep it safe and delete it when you no longer need it.', 'Export')) return;
  doExport('pw', fmt);
}

/* =====================================================================
   VIEW: LINKS  (movie / web series / anime links)
   ===================================================================== */
const LINK_TYPES = ['Movie','Web Series','Anime'];
const LINK_ICON = { 'Movie':'🎬', 'Web Series':'📺', 'Anime':'🍥' };
function filteredLinks(){
  const q = (S.link.q || '').trim().toLowerCase(), t = S.link.type;
  return [...(S.d.links || [])]
    .filter(x => (t === 'all' || x.type === t) && (!q || (x.name + ' ' + x.link).toLowerCase().includes(q)))
    .sort((a, b) => (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase()));
}
function vLinks(){
  const list = filteredLinks(), total = (S.d.links || []).length;
  const rows = list.map(x => {
    const href = pwHref(x.link);
    return `<tr>
      <td data-l="Name" style="white-space:normal;word-break:break-word;min-width:140px"><b>${esc(x.name) || '<span class="dim">—</span>'}</b></td>
      <td data-l="Type"><span class="tag">${LINK_ICON[x.type] || ''} ${esc(x.type)}</span></td>
      <td data-l="Link" style="white-space:normal;word-break:break-all;min-width:160px">${x.link ? (href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(x.link)}</a>` : esc(x.link)) + ` <button class="btn ghost sm" onclick="linkCopy('${esc(x.id)}','link')" title="Copy link">📋</button>` : '<span class="dim">—</span>'}</td>
      <td class="n nowrap"><button class="btn soft sm" onclick="linkCopy('${esc(x.id)}','all')" title="Copy name + type + link">📋 Copy all</button>
        <button class="btn ghost sm" onclick="linkForm('${esc(x.id)}')">Edit</button> <button class="btn ghost sm" onclick="linkDel('${esc(x.id)}')">🗑</button></td></tr>`;
  }).join('');
  const opts = ['all', ...LINK_TYPES].map(t => `<option value="${t}" ${S.link.type === t ? 'selected' : ''}>${t === 'all' ? 'All types' : t}</option>`).join('');
  return `<div class="card" style="margin-bottom:16px"><div class="actions">
      <input class="input" id="lnq" style="width:220px" placeholder="Search name or link…" value="${esc(S.link.q)}" oninput="linkSearch(this.value)">
      <select class="select" style="width:auto" onchange="S.link.type=this.value;render()">${opts}</select>
      <span style="flex:1"></span>
      <button class="btn" onclick="linkForm()">＋ Add link</button></div></div>
    <div class="card"><h3>Saved links <span class="muted" style="font-weight:500;font-size:calc(12.5px*var(--fs))">· ${list.length}${list.length !== total ? ' of ' + total : ''}</span></h3>
      ${list.length ? `<div class="tbl-wrap"><table class="stk"><thead><tr><th>Name</th><th>Type</th><th>Link</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
        : `<div class="empty-state">${total ? 'No links match your search.' : 'No links saved yet. Tap “Add link” to start.'}</div>`}
      <p class="muted" style="margin-top:12px;font-size:calc(13px*var(--fs))">📋 next to a link copies just the link. <b>Copy all</b> copies name, type and link together. Saved in the “Links” tab of your Google Sheet.</p>
    </div>`;
}
function linkSearch(v){
  S.link.q = v; clearTimeout(window._lnt);
  window._lnt = setTimeout(() => { render(); const i = $('#lnq'); if (i){ i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250);
}
async function linkCopy(id, f){
  const x = (S.d.links || []).find(e => e.id === id); if (!x) return;
  const txt = f === 'all'
    ? [x.name && 'Name: ' + x.name, x.type && 'Type: ' + x.type, x.link && 'Link: ' + x.link].filter(Boolean).join('\n')
    : x.link;
  if (!txt) return toast('Nothing to copy', true);
  (await copyText(txt)) ? toast(f === 'all' ? 'Name, type and link copied' : 'Link copied') : toast('Could not copy — please copy it manually', true);
}
function linkForm(id){ if (!can('link')) return deny();
  const x = id ? S.d.links.find(e => e.id === id) : null;
  const w = openModal(`<h3>${x ? 'Edit link' : 'Add link'}</h3><p class="sub">Movie, web series or anime — name, type and link.</p>
    <form id="lnf" autocomplete="off">
      <div class="field"><label>Name</label><input class="input" name="name" maxlength="300" placeholder="e.g. Naruto" autocomplete="off" value="${esc(x ? x.name : '')}"></div>
      <div class="field"><label>Type</label><select class="select" name="type">${LINK_TYPES.map(t => `<option value="${t}" ${(x ? x.type : 'Movie') === t ? 'selected' : ''}>${LINK_ICON[t]} ${t}</option>`).join('')}</select></div>
      <div class="field"><label>Link</label><input class="input" name="link" maxlength="1000" placeholder="https://…" autocapitalize="off" autocomplete="off" value="${esc(x ? x.link : '')}"></div>
      <div class="foot"><button type="button" class="btn ghost" data-x>Cancel</button><button class="btn" type="submit">${x ? 'Save' : 'Add'}</button></div></form>`);
  w.querySelector('[data-x]').onclick = () => w.remove();
  w.querySelector('#lnf').onsubmit = async ev => {
    ev.preventDefault(); const f = Object.fromEntries(new FormData(ev.target)); const btn = ev.submitter; btn.disabled = true;
    try{
      if (x){ const r = await api('updateLink', { id:x.id, ...f }); Object.assign(x, r.link); }
      else { const r = await api('addLink', f); S.d.links.push(r.link); }
      w.remove(); render(); toast('Saved');
    }catch(e){ btn.disabled = false; handleErr(e); }
  };
}
async function linkDel(id){ if (!can('link')) return deny();
  const x = S.d.links.find(e => e.id === id); if (!x) return;
  if (!await confirmBox('Delete this link?', `${x.name || x.link || 'This entry'} will be removed from your sheet.`, 'Delete', true)) return;
  try { await api('deleteLink', { id }); S.d.links = S.d.links.filter(e => e.id !== id); render(); toast('Deleted'); } catch(e){ handleErr(e); }
}

/* =====================================================================
   VIEW: VCS COMPLAINT MANAGE  (log a complaint -> assign it to a user -> status Open / Pending / Closed)
   ===================================================================== */
const VCS_ST = ['Open', 'Pending', 'Closed'];
const VCS_ICON = { Open:'🔴', Pending:'🟡', Closed:'🟢' };
function vcsState(){ return S.vcs = S.vcs || { f:'all', draft:{} }; }
function vVcs(){
  const V = vcsState(), all = S.d.vcs || [], users = S.d.vcsUsers || [], ro = !can('vcs');
  const act = all.filter(x => x.status !== 'Closed'), done = all.filter(x => x.status === 'Closed');
  const meta = x => `Logged by <b>${esc(x.byName || '—')}</b> · ${esc(x.at)}${x.toName ? ' · Forwarded to <b>' + esc(x.toName) + '</b>' : ' · Not assigned yet'}${x.updAt && x.updAt !== x.at ? ' · Updated ' + esc(x.updAt) + (x.updBy ? ' by ' + esc(x.updBy) : '') : ''}`;
  const head = x => `<div style="display:flex;gap:8px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap">
        <b style="word-break:break-word;white-space:normal">${esc(x.title)}</b><span class="tag">${VCS_ICON[x.status] || ''} ${esc(x.status)}</span></div>
      ${x.details ? `<div style="margin-top:6px;white-space:pre-wrap;word-break:break-word">${esc(x.details)}</div>` : ''}
      ${x.log ? `<div style="margin-top:8px;padding:8px 10px;border-radius:10px;background:var(--line2);white-space:pre-wrap;word-break:break-word;font-size:calc(13px*var(--fs))"><b>📝 Updates</b>\n${esc(x.log)}</div>` : ''}
      <div class="muted" style="margin-top:6px;font-size:calc(12.5px*var(--fs))">${meta(x)}</div>`;
  const doneCards = done.map(x => `<div class="card" style="margin-bottom:12px">${head(x)}
      <div class="actions" style="margin-top:12px"><button class="btn soft sm" onclick="vcsReopen('${esc(x.id)}')">↻ Reopen</button></div></div>`).join('');
  const cards = act.map(x => {
    const d = V.draft[x.id] || {}, st = d.st || x.status, to = d.to !== undefined ? d.to : x.toId;
    const known = users.some(u => u.id === to);
    const toOpts = `<option value="">— Not assigned —</option>` + (to && !known ? `<option value="${esc(to)}" selected>${esc(x.toName || to)}</option>` : '')
      + users.map(u => `<option value="${esc(u.id)}" ${u.id === to ? 'selected' : ''}>${esc(u.name)}</option>`).join('');
    const stOpts = VCS_ST.map(s => `<option value="${s}" ${s === st ? 'selected' : ''}>${VCS_ICON[s]} ${s}</option>`).join('');
    return `<div class="card" style="margin-bottom:12px">${head(x)}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-top:12px">
        <div class="field" style="margin:0"><label>Assign to (forward to user)</label><select class="select" data-vcs="to" data-id="${esc(x.id)}" onchange="vcsDraft('${esc(x.id)}','to',this.value)">${toOpts}</select></div>
        <div class="field" style="margin:0"><label>Status</label><select class="select" data-vcs="st" data-id="${esc(x.id)}" onchange="vcsDraft('${esc(x.id)}','st',this.value)">${stOpts}</select></div>
      </div>
      <div class="field" style="margin:12px 0 0"><label>What is the update? <span class="muted">(optional — saved with the complaint)</span></label><textarea class="input" rows="2" maxlength="1000" data-vcs="note" data-id="${esc(x.id)}" placeholder="Write the update / progress here" oninput="vcsDraft('${esc(x.id)}','note',this.value)">${esc(d.note || '')}</textarea></div>
      <div class="actions" style="margin-top:12px"><button class="btn sm" onclick="vcsUpdate('${esc(x.id)}')">✔ Update</button></div>
    </div>`;
  }).join('');
  return `<div class="card" style="margin-bottom:16px"><div class="actions">
      <span class="muted">🔴 Open ${all.filter(x => x.status === 'Open').length} · 🟡 Pending ${all.filter(x => x.status === 'Pending').length} · 🟢 Closed ${done.length}</span>
      <span style="flex:1"></span>
      <button class="btn" onclick="vcsForm()">＋ Log complaint</button></div></div>
    <details class="card" style="margin-bottom:16px" ${V.openPrev ? 'open' : ''} ontoggle="vcsState().openPrev=this.open">
      <summary style="cursor:pointer;font-weight:700">🗂️ Previous complaints (Closed) · ${done.length}</summary>
      <div style="margin-top:12px">${done.length ? doneCards : '<div class="empty-state">No closed complaints yet.</div>'}</div></details>
    <h3 style="margin:0 0 10px">Open &amp; Pending · ${act.length}</h3>
    ${act.length ? cards : `<div class="card"><div class="empty-state">${all.length ? 'No open or pending complaints.' : 'No complaints yet. Tap “Log complaint” to add one.'}</div></div>`}
    <p class="muted" style="font-size:calc(13px*var(--fs))">You see the complaints you logged and the ones forwarded to you${isAdmin() ? ' (as admin you see all of them)' : ''}. Change “Assign to” and “Status”, then tap <b>Update</b>. Closed complaints move to “Previous complaints” and can be reopened.${ro ? ' 🔒 You have view-only access.' : ''}</p>`;
}
async function vcsReopen(id){ if (!can('vcs')) return deny();
  const x = (S.d.vcs || []).find(e => e.id === id); if (!x) return;
  try { const r = await api('updateVcs', { id, toId:x.toId, status:'Open' }); Object.assign(x, r.vcs); render(); toast('Complaint reopened'); }
  catch(e){ handleErr(e); }
}
function vcsDraft(id, k, v){ const V = vcsState(); (V.draft[id] = V.draft[id] || {})[k] = v; }
function vcsForm(){ if (!can('vcs')) return deny();
  const w = openModal(`<h3>Log complaint</h3><p class="sub">Write the complaint. After saving, assign it to a user and set its status from the list.</p>
    <form id="vcf" autocomplete="off">
      <div class="field"><label>Complaint</label><input class="input" name="title" maxlength="300" placeholder="e.g. Customer name / short summary" required></div>
      <div class="field"><label>Details <span class="muted">(optional)</span></label><textarea class="input" name="details" rows="4" maxlength="3000" placeholder="Full details of the complaint"></textarea></div>
      <div class="foot"><button type="button" class="btn ghost" data-x>Cancel</button><button class="btn" type="submit">Log complaint</button></div></form>`);
  w.querySelector('[data-x]').onclick = () => w.remove();
  w.querySelector('#vcf').onsubmit = async ev => {
    ev.preventDefault(); const f = Object.fromEntries(new FormData(ev.target)); const btn = ev.submitter; btn.disabled = true;
    try{ const r = await api('addVcs', f); S.d.vcs.unshift(r.vcs); w.remove(); render(); toast('Complaint logged'); }
    catch(e){ btn.disabled = false; handleErr(e); }
  };
}
async function vcsUpdate(id){ if (!can('vcs')) return deny();
  const x = (S.d.vcs || []).find(e => e.id === id); if (!x) return;
  const q = k => document.querySelector(`[data-vcs="${k}"][data-id="${id}"]`);
  const d = vcsState().draft[id] || {};
  const to = q('to') ? q('to').value : (d.to !== undefined ? d.to : x.toId), st = q('st') ? q('st').value : (d.st || x.status), note = q('note') ? q('note').value : (d.note || '');
  try { const r = await api('updateVcs', { id, toId:to, status:st, note }); Object.assign(x, r.vcs); delete vcsState().draft[id]; render(); toast('Complaint updated'); }
  catch(e){ handleErr(e); }
}

/* =====================================================================
   VIEW: RACK MAPPING  (racks Left 1–11, Right 1–15, Front 1–3 — every rack has the same customisable fields: Carton, Inner, Box, Scheme, INS No. …)
   Each field is a box you can type in and save. Fields can be renamed, added and removed with “Customize fields”.
   ===================================================================== */
/* Three sides: Left 1-11, Right 1-15, Front 1-3.  To change the numbers edit `nums` (e.g. [1,2,3,4,5,6,7,8,11]).
   Each rack is saved under the key  base + number  (Left 1-11, Right 21-35, Front 41-43), so the server's 1-100 range is enough and old Left data stays. */
const RACK_SIDES = [
  { name:'Left',  base:0,  nums:[1,2,3,4,5,6,7,8,9,10,11] },
  { name:'Right', base:20, nums:[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15] },
  { name:'Front', base:40, nums:[1,2,3] }
];
const RACK_LIST = RACK_SIDES.reduce((a, sd) => a.concat(sd.nums.map(k => sd.base + k)), []);
function rackInfo(key){ key = +key; const sd = RACK_SIDES.find(x => key > x.base && key <= x.base + 99 && x.nums.includes(key - x.base)) || RACK_SIDES[0]; return { side:sd.name, num:key - sd.base }; }
const rackName = key => { const i = rackInfo(key); return i.side + ' ' + i.num; };
const RACK_DEF_ROWS = ['a','b','c','d'], RACK_DEF_FIELDS = ['Carton','Inner','Box','Scheme','INS No.'];
function rackState(){ return S.rackUi = S.rackUi || { q:'', show:'all' }; }
function rackCfg(){ const c = S.d.rackCfg || {}; return { fields:(c.fields && c.fields.length) ? c.fields : RACK_DEF_FIELDS, rows:c.rows || { '*':RACK_DEF_ROWS }, data:c.data || {} }; }
function rackRowsOf(n){ const c = rackCfg(); return c.rows[String(n)] || c.rows['*'] || RACK_DEF_ROWS; }
/* saved shape: { rowName: { field: value } } — older saves were flat { field: value }, treated as the first row */
function rackVals(n){
  const o = rackCfg().data[String(n)] || {};
  if (Object.keys(o).some(k => typeof o[k] !== 'object')) return { [rackRowsOf(n)[0]]:o };
  return o;
}
function rackFilled(n){ const v = rackVals(n); return Object.keys(v).some(r => Object.keys(v[r] || {}).some(f => String(v[r][f] || '').trim() !== '')); }
function rackHay(n, v){          // only what you typed (+ rack number and row names) — so a search never matches every rack
  const I = rackInfo(n), nn = I.num;
  return (nn + ' ' + I.side + ' ' + Object.keys(v).map(r => { const o = v[r] || {}, vals = Object.keys(o).map(f => o[f]).filter(x => String(x || '').trim() !== ''); return vals.length ? r + ' ' + nn + r + ' ' + vals.join(' ') : ''; }).join(' ')).toLowerCase();
}
function rackSummaryHtml(n, fields){
  const v = rackVals(n), rows = [...rackRowsOf(n), ...Object.keys(v).filter(r => !rackRowsOf(n).includes(r))];
  const parts = rows.map(r => { const o = v[r] || {}, bits = fields.filter(f => String(o[f] || '').trim() !== '').map(f => `<span class="rk-bit"><i>${esc(f)}</i> ${esc(o[f])}</span>`).join('');
    return bits ? `<div class="rk-sumrow"><b>${esc(rackName(n))} · ${esc(String(r).toUpperCase())}</b>${bits}</div>` : ''; }).join('');
  return parts || '<div class="rk-empty">Nothing filled yet</div>';
}
function vRack(){
  const R = rackState(), cfg = rackCfg(), ro = !can('rack'), q = (R.q || '').trim().toLowerCase();
  let filled = 0; RACK_LIST.forEach(n => { if (rackFilled(n)) filled++; });
  const stats = `<div class="rk-stats"><div><b>${RACK_LIST.length}</b><span>Racks (Left, Right, Front)</span></div><div><b>${filled}</b><span>Racks filled</span></div><div><b>${cfg.fields.length}</b><span>Fields per row</span></div></div>`;
  const bar = `<div class="card" style="margin-bottom:16px"><div class="actions">
      <input class="input" id="rkq" style="flex:1;min-width:200px" placeholder="🔍 Search anything you filled — item, INS no., scheme, 12b …" value="${esc(R.q)}" oninput="rackSearch(this.value)">
      <button class="btn soft" onclick="rackCalc()">🧮 Calculator</button>
      ${ro ? '' : `<button class="btn ghost" onclick="rackFieldsEdit()">✏️ Customize fields</button><button class="btn ghost" onclick="rackRowsEdit()">☰ Customize rows</button>`}</div></div>`;
  let body;
  if (q){
    const hits = []; RACK_LIST.forEach(n => { if (rackHay(n, rackVals(n)).includes(q)) hits.push(n); });
    hits.sort((a, b) => (String(rackInfo(b).num) === q) - (String(rackInfo(a).num) === q) || a - b);
    body = `<div class="card"><h3>Search results <span class="muted" style="font-weight:500;font-size:calc(12.5px*var(--fs))">· ${hits.length} rack${hits.length === 1 ? '' : 's'}</span></h3>
      ${hits.length ? hits.map(n => `<div class="rk-hit" onclick="rackOpen(${n})" role="button" tabindex="0"><div class="rk-hit-h"><span class="rk-loc" style="margin:0">${esc(rackName(n))}</span><span class="muted">Open ›</span></div>${rackSummaryHtml(n, cfg.fields)}</div>`).join('') : '<div class="empty-state">Nothing found in any rack.</div>'}</div>`;
  } else {
    const sideHtml = sd => `<div class="rk-side"><h4>${esc(sd.name)} <span class="muted">· ${sd.nums.length} racks</span></h4><div class="rk-cal">${sd.nums.map(k => { const n = sd.base + k;
      return `<button type="button" class="rk-day ${rackFilled(n) ? 'has' : ''}" onclick="rackOpen(${n})" aria-label="${esc(rackName(n))}">${k}</button>`; }).join('')}</div></div>`;
    body = `<div class="card"><h3 style="margin:0 0 10px">Racks <span class="muted" style="font-weight:500;font-size:calc(12.5px*var(--fs))">· tap a number to open it and fill rows A, B, C, D</span></h3>
      ${RACK_SIDES.map(sideHtml).join('')}</div>`;
  }
  return stats + bar + body + `<p class="muted" style="margin-top:12px;font-size:calc(13px*var(--fs))">📦 Coloured numbers already have something saved. Saved in the “Rack Config” tab of your Google Sheet.</p>`;
}
function rackSearch(v){
  rackState().q = v; clearTimeout(window._rkt);
  window._rkt = setTimeout(() => { render(); const i = $('#rkq'); if (i){ i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250);
}
/* ---- one rack: popup with rows A, B, C, D (each with all fields) and a Save button ---- */
function rackOpen(n){
  n = +n; const fields = rackCfg().fields, ro = !can('rack'), v = rackVals(n), rows = rackRowsOf(n);
  const extra = Object.keys(v).filter(r => !rows.includes(r) && Object.keys(v[r] || {}).length);
  const secs = [...rows, ...extra].map(r => `<div class="rk-row" data-row="${esc(r)}"><div class="rk-row-h"><span class="rk-loc" style="margin:0">${esc(rackName(n))} · ${esc(String(r).toUpperCase())}</span><span class="muted" style="font-size:calc(12px*var(--fs))">Row ${esc(String(r).toUpperCase())}</span></div>
      <div class="rk-fields">${fields.map((f, i) => `<label class="rk-fld"><span>${esc(f)}</span><input class="input" data-f="${i}" maxlength="200" value="${esc(((v[r] || {})[f]) || '')}" ${ro ? 'disabled' : ''} autocomplete="off"></label>`).join('')}</div></div>`).join('');
  const w = openModal(`<h3>${esc(rackName(n))}</h3><p class="sub">What is kept in each row of this rack.</p>${secs}
    <div class="foot"><button type="button" class="btn ghost" data-x>${ro ? 'Close' : 'Cancel'}</button>${ro ? '' : '<button class="btn" type="button" data-save>Save</button>'}</div>`);
  w.querySelector('[data-x]').onclick = () => w.remove();
  const sv = w.querySelector('[data-save]'); if (!sv) return;
  sv.onclick = async () => {
    const values = {};
    w.querySelectorAll('.rk-row').forEach(sec => { const r = sec.dataset.row; values[r] = {}; sec.querySelectorAll('[data-f]').forEach(i => { values[r][fields[+i.dataset.f]] = i.value.trim(); }); });
    sv.disabled = true;
    try{
      const r = await api('saveRackData', { rack:String(n), values });
      S.d.rackCfg = S.d.rackCfg || {}; S.d.rackCfg.data = S.d.rackCfg.data || {};
      if (r.values && Object.keys(r.values).length) S.d.rackCfg.data[String(n)] = r.values; else delete S.d.rackCfg.data[String(n)];
      w.remove(); render(); toast('Saved ' + rackName(n));
    }catch(e){ sv.disabled = false; handleErr(e); }
  };
}
/* ---- packing calculator ----
   Units are listed from the LARGEST to the SMALLEST:  1 Carton = 9 Inner · 1 Inner = 12 Small Box · 1 Small Box = 7 Piece.
   Fill only the links you know. Enter a quantity in any unit and every answer that can be worked out is shown.
   INS list: save the packing of each INS number once (kept in the Google Sheet), then pick it from the dropdown to fill the links automatically. */
const RACK_CALC_K = 'ks_rack_calc_v3';
function rackCalcLoad(){
  let st = { units:[{ n:'Carton', p:'' }, { n:'Inner', p:'' }, { n:'Small Box', p:'' }, { n:'Piece', p:'' }], q:'', u:3, sel:'' };
  try{
    const s = JSON.parse(localStorage.getItem(RACK_CALC_K) || 'null');
    if (s && Array.isArray(s.units) && s.units.length >= 2) st = { units:s.units.map(x => ({ n:String(x.n || ''), p:String(x.p === undefined ? '' : x.p) })), q:String(s.q || ''), u:+s.u || 0, sel:String(s.sel || '') };
  }catch(e){}
  if (!(st.u >= 0 && st.u < st.units.length)) st.u = st.units.length - 1;
  return st;
}
function rackPresets(){
  const l = ((S.d.rackCfg && S.d.rackCfg.presets) || []).map(x => ({ name:String(x.name || ''), vals:Array.isArray(x.vals) ? x.vals.map(String) : [] }));
  return l.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric:true, sensitivity:'base' }));
}
function rackCalc(){
  const st = rackCalcLoad();
  const w = openModal(`<div id="rcBody"></div>`);
  const $$ = s => w.querySelector(s);
  const nf = n => Number(n).toLocaleString('en-IN');
  const nm = i => (st.units[i].n || '').trim() || ('Unit ' + (i + 1));
  const per = i => { const v = Math.floor(Number(st.units[i].p)); return v >= 1 ? v : 0; };         // how many of unit i in 1 of unit i-1
  const prod = (a, b) => { let r = 1; for (let i = a + 1; i <= b; i++){ const p = per(i); if (!p) return 0; r *= p; } return r; };   // how many of unit b in 1 of unit a (a is larger); 0 = not known
  const save = () => { try{ localStorage.setItem(RACK_CALC_K, JSON.stringify(st)); }catch(e){} };
  const row = (k, v, cls) => `<div class="rk-calc-row ${cls || ''}"><span>${k}</span><b>${v}</b></div>`;
  const chainHtml = (vals, attr) => st.units.map((u, i) => i === 0 ? '' : `<div class="rk-chain"><span class="rk-chain-l">1 ${esc(nm(i - 1))}</span><span class="rk-chain-eq">=</span><input class="input" ${attr}="${i}" type="number" inputmode="numeric" min="1" step="1" value="${esc(vals[i] || '')}" placeholder="—" aria-label="${esc(nm(i))} in 1 ${esc(nm(i - 1))}"><span class="rk-chain-r">${esc(nm(i))}</span></div>`).join('');
  const curVals = () => st.units.map(u => u.p);                       // index i = how many unit i in 1 unit i-1 (index 0 unused)
  const applyPreset = p => { st.units.forEach((u, i) => { u.p = i === 0 ? '' : String((p.vals[i - 1]) || ''); }); st.sel = p.name; };

  const run = () => {
    save(); const out = $$('#rcOut'); if (!out) return;
    const q = Math.floor(Number(st.q)), k = st.u, U = st.units.length;
    if (!(q >= 1)){ out.innerHTML = '<div class="empty-state">Enter a quantity to see the answer.</div>'; return; }
    let blocks = '', totals = '', sum = [], hidden = [];
    for (let j = 0; j < k; j++){                       // bigger units: how many are needed + space left in the last one
      const pr = prod(j, k); if (!pr){ hidden.push(nm(j)); continue; }
      const need = Math.ceil(q / pr), spare = need * pr - q, full = Math.floor(q / pr), loose = q - full * pr;
      let big = ''; for (let m = j + 1; m < k; m++){ const pm = prod(m, k); if (pm && spare >= pm){ big = ` (= ${nf(Math.floor(spare / pm))} ${esc(nm(m))}${spare % pm ? ' + ' + nf(spare % pm) + ' ' + esc(nm(k)) : ''})`; break; } }
      sum.push(`<b>${nf(need)} ${esc(nm(j))}</b>`);
      blocks += `<div class="rk-calc-blk">${row(`${esc(nm(j))} needed`, nf(need), 'main')}
        <div class="rk-calc-sep">${full ? nf(full) + ' full ' + esc(nm(j)) : 'No full ' + esc(nm(j))}${loose ? ' + ' + nf(loose) + ' ' + esc(nm(k)) + ' in the last one' : ''}</div>
        ${row(`Space left in last ${esc(nm(j))}`, nf(spare) + ' ' + esc(nm(k)) + ' more can fit' + big, spare ? '' : 'dim')}</div>`;
    }
    for (let j = k + 1; j < U; j++){                  // smaller units: exact conversion
      const pr = prod(k, j); if (!pr){ hidden.push(nm(j)); continue; }
      totals += row(`Total ${esc(nm(j))}`, nf(q * pr));
    }
    let html = '';
    if (sum.length) html += `<div class="rk-calc-sum">${nf(q)} ${esc(nm(k))} fits in ${sum.join(' · ')}</div>`;
    html += blocks;
    if (totals) html += `<div class="rk-calc-blk">${totals}</div>`;
    if (!blocks && !totals) html = '<div class="empty-state">Fill at least the link that connects this unit to another one (for example 1 Inner = 12 Small Box) to see an answer.</div>';
    else if (hidden.length) html += `<div class="rk-calc-sep">Fill the missing links to also see: ${hidden.map(esc).join(', ')}.</div>`;
    out.innerHTML = `<div class="rk-calc">${html}</div>`;
  };

  const drawMain = () => {
    const pl = rackPresets(); if (st.sel && !pl.some(p => p.name === st.sel)) st.sel = '';
    $$('#rcBody').innerHTML = `<h3>🧮 Packing calculator</h3><p class="sub">Fill only the links you know — you do not need all of them.</p>
      <div class="actions" style="justify-content:space-between;flex-wrap:nowrap;margin-top:4px"><div class="sec-title" style="margin:0">How it is packed</div><button type="button" class="btn soft sm" data-ins title="Add / edit / delete INS entries">⚙ INS list</button></div>
      <select class="select" id="rcSel" style="margin:8px 0 12px" aria-label="Select INS"><option value="">${pl.length ? '— Select INS number —' : '— No INS saved yet (tap ⚙ INS list) —'}</option>${pl.map(p => `<option value="${esc(p.name)}" ${p.name === st.sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      <div class="rk-chains">${chainHtml(curVals(), 'data-p')}</div>
      <div class="sec-title" style="margin-top:16px">How much do you have?</div>
      <div class="actions" style="flex-wrap:nowrap"><input class="input" id="rcQ" type="number" inputmode="numeric" min="0" step="1" placeholder="Quantity" value="${esc(st.q)}">
        <select class="select" id="rcU" style="width:auto">${st.units.map((u, i) => `<option value="${i}" ${i === st.u ? 'selected' : ''}>${esc(nm(i))}</option>`).join('')}</select></div>
      <div id="rcOut" style="margin-top:14px"></div>
      <div class="foot"><button type="button" class="btn ghost" data-edit>✏️ Edit units</button><button type="button" class="btn ghost" data-x>Close</button></div>`;
    $$('#rcBody').oninput = e => {
      if (e.target.dataset.p !== undefined){ st.units[+e.target.dataset.p].p = e.target.value; st.sel = ''; const s = $$('#rcSel'); if (s) s.value = ''; }
      else if (e.target.id === 'rcQ') st.q = e.target.value;
      run();
    };
    $$('#rcU').onchange = e => { st.u = +e.target.value; run(); };
    $$('#rcSel').onchange = e => { const p = pl.find(x => x.name === e.target.value); if (p) applyPreset(p); else st.sel = ''; save(); drawMain(); };
    $$('[data-x]').onclick = () => w.remove();
    $$('[data-edit]').onclick = drawEdit;
    $$('[data-ins]').onclick = () => { if (!can('rack')) return deny(); drawList(); };
    run();
  };

  /* ---- INS list: add / edit / delete ---- */
  const savePresets = async list => { const r = await api('saveRackPresets', { presets:list }); S.d.rackCfg = r.cfg; };
  const drawList = () => {
    const pl = rackPresets();
    $$('#rcBody').innerHTML = `<h3>⚙ INS list</h3><p class="sub">Save the packing of each INS number once. Then just pick it in the calculator and the links fill by themselves.</p>
      <div class="actions" style="flex-wrap:nowrap"><input class="input" id="rcFind" placeholder="🔍 Find INS" autocomplete="off"><button class="btn soft" type="button" data-add>＋ Add INS</button></div>
      <div id="rcPL" style="margin-top:8px">${pl.length ? pl.map((p, i) => `<div class="rk-catrow" data-nm="${esc(p.name.toLowerCase())}"><b style="min-width:70px">${esc(p.name)}</b><span class="muted" style="flex:1;font-size:calc(12.5px*var(--fs))">${st.units.slice(1).map((u, j) => esc(p.vals[j] || '—')).join(' · ')}</span>
        <button class="btn ghost sm" type="button" data-ed="${i}">Edit</button><button class="btn ghost sm" type="button" data-dl="${i}" aria-label="Delete">🗑</button></div>`).join('') : '<div class="empty-state">No INS saved yet. Tap “＋ Add INS”.</div>'}</div>
      <div class="foot"><button type="button" class="btn ghost" data-back>← Back</button></div>`;
    $$('#rcFind').oninput = e => { const q = e.target.value.trim().toLowerCase(); w.querySelectorAll('#rcPL [data-nm]').forEach(r => r.classList.toggle('hidden', !!q && !r.dataset.nm.includes(q))); };
    $$('[data-back]').onclick = drawMain;
    $$('[data-add]').onclick = () => drawForm(null);
    $$('#rcPL').onclick = async e => {
      const ed = e.target.closest('[data-ed]'), dl = e.target.closest('[data-dl]');
      if (ed) drawForm(pl[+ed.dataset.ed]);
      else if (dl){
        const p = pl[+dl.dataset.dl];
        if (!await confirmBox('Delete this INS?', `“${p.name}” will be removed from the list.`, 'Delete', true)) return;
        try{ await savePresets(pl.filter(x => x !== p)); if (st.sel === p.name) st.sel = ''; save(); drawList(); toast('Deleted'); }catch(err){ handleErr(err); }
      }
    };
  };
  const drawForm = p => {
    const vals = [''].concat(st.units.slice(1).map((u, j) => p ? String(p.vals[j] || '') : u.p));   // new entry starts from what is on the calculator now
    $$('#rcBody').innerHTML = `<h3>${p ? 'Edit INS' : 'Add INS'}</h3><p class="sub">Name it (for example INS 17) and fill how it is packed. Leave unknown links empty.</p>
      <div class="field"><label>INS name / number</label><input class="input" id="rcName" maxlength="60" placeholder="e.g. INS 17" autocapitalize="characters" value="${esc(p ? p.name : '')}" autocomplete="off"></div>
      <div class="rk-chains">${chainHtml(vals, 'data-v')}</div>
      <div class="foot"><button type="button" class="btn ghost" data-back>Cancel</button><button type="button" class="btn" data-save>Save</button></div>`;
    $$('[data-back]').onclick = drawList;
    $$('[data-save]').onclick = async ev => {
      const name = $$('#rcName').value.trim(); if (!name) return toast('Enter the INS name', true);
      const all = rackPresets();
      if (all.some(x => x !== p && x.name.toLowerCase() === name.toLowerCase())) return toast('That INS already exists — edit it instead', true);
      const nv = st.units.slice(1).map((u, j) => { const el = w.querySelector(`[data-v="${j + 1}"]`); return el ? el.value.trim() : ''; });
      const item = { name, vals:nv };
      const list = p ? all.map(x => x === p ? item : x) : [...all, item];
      const b = ev.currentTarget; b.disabled = true;
      try{ await savePresets(list); if (p && st.sel === p.name){ applyPreset(item); } save(); drawList(); toast('Saved ' + name); }
      catch(err){ b.disabled = false; handleErr(err); }
    };
  };

  const drawEdit = () => {
    const rows = () => st.units.map((u, i) => `<div class="actions" style="margin-bottom:8px;flex-wrap:nowrap"><span class="muted" style="min-width:18px">${i + 1}</span><input class="input" data-n="${i}" maxlength="24" value="${esc(u.n)}" placeholder="Unit name" autocomplete="off">
        <button class="btn ghost sm" type="button" data-up="${i}" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>↑</button><button class="btn ghost sm" type="button" data-del="${i}" aria-label="Remove unit">✕</button></div>`).join('');
    $$('#rcBody').innerHTML = `<h3>Edit units</h3><p class="sub">List the units from the <b>largest to the smallest</b> (Carton, Inner, Small Box, Piece). Rename, add, remove or move them with ↑. A new unit is added at the bottom (smallest). Saved INS entries follow the unit order, so change the order only if you re-check them.</p>
      <div id="rcUnits">${rows()}</div>
      <div class="actions" style="margin:10px 0 4px"><button class="btn soft sm" type="button" data-add>＋ Add unit</button><button class="btn ghost sm" type="button" data-reset>↺ Reset names</button></div>
      <div class="foot"><button type="button" class="btn" data-done>Done</button></div>`;
    const box = $$('#rcUnits'), redraw = () => { box.innerHTML = rows(); save(); };
    box.oninput = e => { if (e.target.dataset.n !== undefined) st.units[+e.target.dataset.n].n = e.target.value; save(); };
    box.onclick = e => {
      const d = e.target.closest('[data-del]'), u = e.target.closest('[data-up]');
      if (d){ if (st.units.length <= 2) return toast('Keep at least two units', true); st.units.splice(+d.dataset.del, 1); if (st.u >= st.units.length) st.u = st.units.length - 1; st.units[0].p = ''; st.sel = ''; redraw(); }
      else if (u && +u.dataset.up > 0){ const i = +u.dataset.up; [st.units[i - 1], st.units[i]] = [st.units[i], st.units[i - 1]]; st.units[0].p = ''; st.sel = ''; redraw(); }
    };
    $$('[data-add]').onclick = () => { if (st.units.length >= 8) return toast('Up to 8 units', true); st.units.push({ n:'', p:'' }); redraw(); const ins = box.querySelectorAll('input'); ins[ins.length - 1].focus(); };
    $$('[data-reset]').onclick = () => { ['Carton', 'Inner', 'Small Box', 'Piece'].forEach((n, i) => { if (st.units[i]) st.units[i].n = n; }); redraw(); };
    $$('[data-done]').onclick = () => { st.units.forEach((u, i) => { if (!u.n.trim()) u.n = 'Unit ' + (i + 1); }); drawMain(); };
  };
  drawMain();
}
/* ---- customise the rows (a, b, c, d …) ---- */
function rackRowsEdit(){ if (!can('rack')) return deny();
  let rows = [...rackRowsOf(1)];
  const w = openModal(`<h3>Customize rows</h3><p class="sub">Rows of every rack (up to 12). Each row gets its own Carton, Inner, Box, Scheme, INS No. boxes. If you rename or remove a row, what you typed in the old row name stays saved but is hidden unless the same row name is added back.</p>
    <div id="rkRows"></div>
    <div class="actions" style="margin:10px 0 4px"><button class="btn soft sm" type="button" data-add>＋ Add row</button><button class="btn ghost sm" type="button" data-reset>↺ Reset to a, b, c, d</button></div>
    <div class="foot"><button type="button" class="btn ghost" data-x>Cancel</button><button class="btn" type="button" data-save>Save rows</button></div>`);
  const draw = () => { w.querySelector('#rkRows').innerHTML = rows.map((r, i) => `<div class="actions" style="margin-bottom:8px;flex-wrap:nowrap"><input class="input" data-i="${i}" maxlength="12" value="${esc(r)}" placeholder="row name" autocapitalize="off" autocomplete="off"><button class="btn ghost sm" type="button" data-del="${i}" aria-label="Remove row">✕</button></div>`).join(''); };
  draw();
  const box = w.querySelector('#rkRows');
  box.oninput = e => { if (e.target.dataset.i !== undefined) rows[+e.target.dataset.i] = e.target.value; };
  box.onclick = e => { const b = e.target.closest('[data-del]'); if (b){ if (rows.length <= 1) return toast('Keep at least one row', true); rows.splice(+b.dataset.del, 1); draw(); } };
  w.querySelector('[data-add]').onclick = () => { if (rows.length >= 12) return toast('Up to 12 rows only', true); rows.push(''); draw(); const ins = box.querySelectorAll('input'); ins[ins.length - 1].focus(); };
  w.querySelector('[data-reset]').onclick = () => { rows = [...RACK_DEF_ROWS]; draw(); };
  w.querySelector('[data-x]').onclick = () => w.remove();
  w.querySelector('[data-save]').onclick = async ev => {
    const clean = rows.map(r => r.trim()).filter(Boolean); if (!clean.length) return toast('Keep at least one row', true);
    const b = ev.currentTarget; b.disabled = true;
    try{ const r = await api('saveRackRows', { rows:clean, all:true }); S.d.rackCfg = r.cfg; w.remove(); render(); toast('Rows saved'); }
    catch(e){ b.disabled = false; handleErr(e); }
  };
}
/* ---- customise the fields (rename / add / remove) ---- */
function rackFieldsEdit(){ if (!can('rack')) return deny();
  let list = rackCfg().fields.map(f => ({ o:f, n:f }));
  const w = openModal(`<h3>Customize fields</h3><p class="sub">Rename, add or remove the boxes shown on every rack (Left, Right and Front). Renaming keeps what you already typed. Removing a field deletes its saved values.</p>
    <div id="rkF"></div>
    <div class="actions" style="flex-wrap:nowrap;margin:10px 0 4px"><input class="input" id="rkNew" maxlength="40" placeholder="New field name (e.g. Pouch)" autocomplete="off"><button class="btn soft" type="button" data-add>＋ Add</button></div>
    <div class="actions" style="margin:6px 0 0"><button class="btn ghost sm" type="button" data-reset>↺ Reset to default</button></div>
    <div class="foot"><button type="button" class="btn ghost" data-x>Cancel</button><button class="btn" type="button" data-save>Save fields</button></div>`);
  const draw = () => { w.querySelector('#rkF').innerHTML = list.map((x, i) => `<div class="actions" style="margin-bottom:8px;flex-wrap:nowrap"><input class="input" data-i="${i}" maxlength="40" value="${esc(x.n)}" autocomplete="off"><button class="btn ghost sm" type="button" data-up="${i}" aria-label="Move up">↑</button><button class="btn ghost sm" type="button" data-del="${i}" aria-label="Remove field">✕</button></div>`).join(''); };
  draw();
  const box = w.querySelector('#rkF');
  box.oninput = e => { if (e.target.dataset.i !== undefined) list[+e.target.dataset.i].n = e.target.value; };
  box.onclick = e => {
    const d = e.target.closest('[data-del]'), u = e.target.closest('[data-up]');
    if (d){ if (list.length <= 1) return toast('Keep at least one field', true); list.splice(+d.dataset.del, 1); draw(); }
    else if (u && +u.dataset.up > 0){ const i = +u.dataset.up; [list[i - 1], list[i]] = [list[i], list[i - 1]]; draw(); }
  };
  const add = () => {
    const inp = w.querySelector('#rkNew'), v = inp.value.trim(); if (!v) return;
    if (list.some(x => x.n.trim().toLowerCase() === v.toLowerCase())) return toast('That field already exists', true);
    if (list.length >= 30) return toast('Up to 30 fields', true);
    list.push({ o:'', n:v }); inp.value = ''; draw(); inp.focus();
  };
  w.querySelector('[data-add]').onclick = add;
  w.querySelector('#rkNew').onkeydown = e => { if (e.key === 'Enter'){ e.preventDefault(); add(); } };
  w.querySelector('[data-reset]').onclick = () => { const cur = rackCfg().fields; list = RACK_DEF_FIELDS.map(f => ({ o:cur.includes(f) ? f : '', n:f })); draw(); };
  w.querySelector('[data-x]').onclick = () => w.remove();
  w.querySelector('[data-save]').onclick = async ev => {
    const pending = w.querySelector('#rkNew').value.trim(); if (pending && !list.some(x => x.n.trim().toLowerCase() === pending.toLowerCase())) list.push({ o:'', n:pending });
    const clean = list.map(x => ({ o:x.o, n:x.n.trim() })).filter(x => x.n); if (!clean.length) return toast('Keep at least one field', true);
    const b = ev.currentTarget; b.disabled = true;
    try{ const r = await api('saveRackFields', { fields:clean }); S.d.rackCfg = r.cfg; w.remove(); render(); toast('Fields saved'); }
    catch(e){ b.disabled = false; handleErr(e); }
  };
}

/* =====================================================================
   VIEW: LIC  (customer policies — name, policy no., amount, start/end date, live countdown to end date)
   ===================================================================== */
function licAmt(n){ return n ? '₹' + Number(n).toLocaleString('en-IN') : '<span class="dim">—</span>'; }
const LIC_FREQ = { '':'One-time', monthly:'Monthly', quarterly:'Quarterly', halfyearly:'Half-Yearly', yearly:'Yearly' };
const LIC_FREQ_MONTHS = { monthly:1, quarterly:3, halfyearly:6, yearly:12 };
/* how many premiums fall in ONE year, per premium mode (a one-time policy has no yearly repeat) */
const LIC_PER_YEAR = { monthly:12, quarterly:4, halfyearly:2, yearly:1 };
const licYearly = x => { const n = LIC_PER_YEAR[x.freq], a = Number(x.amount) || 0; return n && a ? Math.round(a * n * 100) / 100 : 0; };
const licYearlyTxt = x => { const y = licYearly(x); return y ? '₹' + y.toLocaleString('en-IN') : (!x.freq && Number(x.amount) ? 'One-time' : '—'); };
const licIso = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const licToday = () => licIso(new Date());                      // local date (not UTC), so it flips at midnight India time
/* iso + n months, keeping the day-of-month (31 Jan + 1 month = 28/29 Feb, not 3 Mar) */
function licAddMonths(iso, n){
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); if (!m) return '';
  const mo = +m[2] - 1 + n, last = new Date(+m[1], mo + 1, 0).getDate();
  return licIso(new Date(+m[1], mo, Math.min(+m[3], last)));
}
/* whole calendar days from iso a to iso b */
function licDayDiff(a, b){
  const A = a.split('-').map(Number), B = b.split('-').map(Number);
  return Math.round((Date.UTC(B[0], B[1] - 1, B[2]) - Date.UTC(A[0], A[1] - 1, A[2])) / 86400000);
}
/* "1 year 2 months 5 days" between two iso dates (from <= to) */
function licSpan(from, to){
  const f = from.split('-').map(Number), t = to.split('-').map(Number);
  let mo = (t[0] - f[0]) * 12 + (t[1] - f[1]); if (licAddMonths(from, mo) > to) mo--;
  const d = licDayDiff(licAddMonths(from, mo), to), y = Math.floor(mo / 12), m = mo % 12, out = [];
  if (y) out.push(y + (y === 1 ? ' year' : ' years'));
  if (m) out.push(m + (m === 1 ? ' month' : ' months'));
  if (d || !out.length) out.push(d + (d === 1 ? ' day' : ' days'));
  return out.join(' ');
}
/* The next premium-due date. The user enters ONE due date (x.dueDate - or, if empty, the starting date) and it repeats
   by itself: every 1 / 3 / 6 / 12 months for Monthly / Quarterly / Half-Yearly / Yearly. Always today or later.
   One-time policies only have a due date if one was typed in. */
function licNextRenewal(x){
  const anchor = x.dueDate || x.startDate, step = LIC_FREQ_MONTHS[x.freq];
  if (!anchor || (!step && !x.dueDate)) return '';
  const today = licToday();
  let due = anchor;
  if (step){ for (let k = 1; due < today && k < 2400; k++) due = licAddMonths(anchor, k * step); }   // from the anchor each time: no day drift
  else if (due < today) return '';
  if (x.endDate && due > x.endDate) return '';     // policy term is already over — nothing left to renew
  return due;
}
/* "how long to pay" for the next renewal: days when it is close, otherwise years / months / days */
function licRenewInfo(x){
  const due = licNextRenewal(x);
  if (!due) return { text:'—', cls:'', due:'', days:-1 };
  const days = licDayDiff(licToday(), due);
  const text = days === 0 ? '⚠ Due today' : days === 1 ? 'Due tomorrow' : days <= 30 ? days + ' days left' : licSpan(licToday(), due) + ' left';
  return { text, cls: days <= 7 ? 'bad' : days <= 30 ? 'warn' : 'good', due, days };
}
/* one reminder toast per sign-in when a premium falls due within the next 7 days */
function licAlert(){
  if (S.licAlerted) return; S.licAlerted = true;
  const n = (S.d && S.d.lic || []).filter(x => { const r = licRenewInfo(x); return r.due && r.days <= 7; }).length;
  if (n) toast(`🔔 ${n} LIC premium${n > 1 ? 's' : ''} due within 7 days — see the LIC tab`);
}
function licDateFmt(iso){
  if (!iso) return '<span class="dim">—</span>';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso); if (!m) return esc(iso);
  return `${+m[3]} ${MON[+m[2] - 1]} ${m[1]}`;
}
/* live countdown to End Date (treated as 23:59:59 that day), ticking down to the second */
function licCountdown(endIso){
  if (!endIso) return { text:'—', cls:'' };
  const end = new Date(endIso + 'T23:59:59');
  const left = end.getTime() - Date.now();
  if (isNaN(end.getTime())) return { text:'—', cls:'' };
  if (left <= 0){
    const ago = Math.floor(-left / 86400000);
    return { text:'⏹ Expired' + (ago ? ' · ' + ago + 'd ago' : ''), cls:'bad', status:'Expired' };
  }
  const s = Math.floor(left / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
  const p2 = n => String(n).padStart(2, '0');
  const text = (d ? d + 'd ' : '') + p2(h) + 'h ' + p2(m) + 'm ' + p2(sec) + 's';
  if (d <= 7) return { text, cls:'bad', status:'Expiring soon' };
  if (d <= 30) return { text, cls:'warn', status:'Expiring soon' };
  return { text, cls:'good', status:'Active' };
}
function licStatusTag(endIso){
  const c = licCountdown(endIso);
  if (!c.status) return '';
  const cls = c.status === 'Expired' ? 'off' : c.status === 'Expiring soon' ? 'main' : 'adm';
  return `<span class="tag ${cls}">${c.status}</span>`;
}
/* the extra fields you added yourself, as small "label: value" lines */
function licMore(x){
  const ex = x.extra || {};
  return (S.d.licFields || []).filter(n => ex[n]).map(n => `<div><span class="muted">${esc(n)}:</span> ${esc(ex[n])}</div>`).join('');
}
function filteredLic(){
  const q = (S.lic.q || '').trim().toLowerCase();
  return [...(S.d.lic || [])]
    .filter(x => !q || [x.name, x.policyNo, x.policyName, x.nominee, x.phone, ...Object.values(x.extra || {})].join(' ').toLowerCase().includes(q))
    .sort((a, b) => (a.endDate || '9999').localeCompare(b.endDate || '9999'));     // soonest-ending first
}
function vLic(){
  const all = S.d.lic || [], list = filteredLic(), total = all.length;
  const now = Date.now();
  let maturing = 0, matured = 0, totalAmt = 0, renew7 = 0, renew30 = 0, yearAmt = 0, yearN = 0;
  all.forEach(x => {
    totalAmt += Number(x.amount) || 0;
    if (licYearly(x) && (!x.endDate || x.endDate >= licToday())){ yearAmt += licYearly(x); yearN++; }      // running policies only
    if (x.endDate){
      const end = new Date(x.endDate + 'T23:59:59').getTime();
      if (end <= now) matured++; else if (end - now <= 30 * 86400000) maturing++;
    }
    const rn = licRenewInfo(x);
    if (rn.due){ if (rn.days <= 7) renew7++; if (rn.days <= 30) renew30++; }
  });
  const remind = all.map(x => ({ x, rn: licRenewInfo(x) })).filter(o => o.rn.due && o.rn.days <= 30).sort((a, b) => a.rn.days - b.rn.days);
  const rows = list.map(x => { const c = licCountdown(x.endDate), rn = licRenewInfo(x); return `<tr>
      <td data-l="Customer Name" style="white-space:normal;word-break:break-word;min-width:150px"><b>${esc(x.name) || '<span class="dim">—</span>'}</b>${licStatusTag(x.endDate)}</td>
      <td data-l="Policy Number" style="white-space:normal;word-break:break-all">${esc(x.policyNo) || '<span class="dim">—</span>'}</td>
      <td data-l="Policy Name" style="white-space:normal;word-break:break-word;min-width:120px">${esc(x.policyName) || '<span class="dim">—</span>'}</td>
      <td data-l="Premium Amount" class="n">${licAmt(x.amount)}</td>
      <td data-l="Total Policy Amount" class="n">${licAmt(x.totalAmount)}</td>
      <td data-l="Nominee" style="white-space:normal;word-break:break-word">${esc(x.nominee) || '<span class="dim">—</span>'}</td>
      <td data-l="Customer Mobile" style="white-space:nowrap">${x.phone ? `<a href="tel:${esc(x.phone)}">${esc(x.phone)}</a>` : '<span class="dim">—</span>'}</td>
      <td data-l="Premium Mode"><span class="tag">${esc(LIC_FREQ[x.freq] || 'One-time')}</span></td>
      <td data-l="Pay per Year" class="n">${licYearly(x) ? `<b>${esc(licYearlyTxt(x))}</b><br><span class="muted" style="font-size:calc(11.5px*var(--fs))">${LIC_PER_YEAR[x.freq]} × ${esc(licAmt(x.amount))}</span>` : esc(licYearlyTxt(x))}</td>
      <td data-l="Starting Date">${licDateFmt(x.startDate)}</td>
      <td data-l="Ending Date">${licDateFmt(x.endDate)}</td>
      <td data-l="Next Renewal">${rn.due ? `${licDateFmt(rn.due)}<br><span class="lic-rn ${rn.cls}" data-lic-id="${esc(x.id)}" style="font-weight:700;white-space:nowrap">${esc(rn.text)}</span>` : '<span class="dim">—</span>'}</td>
      <td data-l="Time Left"><span class="lic-cd ${c.cls}" data-end="${esc(x.endDate || '')}" style="font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap">${esc(c.text)}</span></td>
      ${licMore(x) ? `<td data-l="More details" style="white-space:normal;min-width:140px;font-size:calc(12.5px*var(--fs))">${licMore(x)}</td>` : ''}
      <td class="n nowrap"><button class="btn soft sm" onclick="licCopy('${esc(x.id)}')" title="Copy all of this customer's data">📋 Copy</button>
        <button class="btn ghost sm" onclick="licForm('${esc(x.id)}')">Edit</button> <button class="btn ghost sm" onclick="licDel('${esc(x.id)}')">🗑</button></td></tr>`;
  }).join('');
  const remindCard = remind.length ? `<div class="card lic-remind" style="margin-bottom:16px"><h3>🔔 Renewal reminders <span class="muted" style="font-weight:500;font-size:calc(12.5px*var(--fs))">· due within 30 days</span></h3>
      ${remind.map(({ x, rn }) => `<div class="lic-ri"><div class="lic-ri-main"><b>${esc(x.name || x.policyNo || 'Policy')}</b>${x.name && x.policyNo ? ` <span class="muted">· ${esc(x.policyNo)}</span>` : ''}
        <div class="muted" style="font-size:calc(12.5px*var(--fs))">${esc(LIC_FREQ[x.freq] || 'One-time')} premium${x.amount ? ' · ₹' + Number(x.amount).toLocaleString('en-IN') : ''} · ${licDateFmt(rn.due)}</div></div>
        <span class="lic-rn lic-pill ${rn.cls}" data-lic-id="${esc(x.id)}">${esc(rn.text)}</span></div>`).join('')}</div>` : '';
  return `${remindCard}<div class="grid kpis" style="margin-bottom:16px">
      <div class="card kpi s"><div class="lbl">Total Policies</div><div class="val">${total}</div><div class="hint">customers</div></div>
      <div class="card kpi p"><div class="lbl">Total Amount</div><div class="val" style="font-size:calc(20px*var(--fs))">${esc(licAmt(totalAmt))}</div></div>
      <div class="card kpi p"><div class="lbl">To pay in 1 year</div><div class="val" style="font-size:calc(20px*var(--fs))">${esc(licAmt(yearAmt))}</div><div class="hint">${yearN} running polic${yearN === 1 ? 'y' : 'ies'} · monthly ×12, quarterly ×4, half-yearly ×2, yearly ×1</div></div>
      <div class="card kpi m"><div class="lbl">Renewal due ≤ 7 days</div><div class="val">${renew7}</div><div class="hint">pay soon</div></div>
      <div class="card kpi w"><div class="lbl">Renewal due ≤ 30 days</div><div class="val">${renew30}</div><div class="hint">upcoming</div></div>
      <div class="card kpi w"><div class="lbl">Maturing ≤ 30 days</div><div class="val">${maturing}</div></div>
      <div class="card kpi a"><div class="lbl">Matured / Expired</div><div class="val">${matured}</div></div>
    </div>
    <div class="card" style="margin-bottom:16px"><div class="actions">
      <input class="input" id="licq" style="width:220px" placeholder="Search name, policy, nominee, mobile…" value="${esc(S.lic.q)}" oninput="licSearch(this.value)">
      <span style="flex:1"></span>
      <button class="btn soft" onclick="licExport('xlsx')">⬇ Excel</button><button class="btn soft" onclick="licExport('pdf')">⬇ PDF</button>
      <button class="btn ghost" onclick="licFieldsEdit()" title="Add or rename your own extra details for every policy">⚙ Extra fields</button>
      <button class="btn" onclick="licForm()">＋ Add policy</button></div></div>
    <div class="card"><h3>LIC policies <span class="muted" style="font-weight:500;font-size:calc(12.5px*var(--fs))">· ${list.length}${list.length !== total ? ' of ' + total : ''}</span></h3>
      ${list.length ? `<div class="tbl-wrap"><table class="stk"><thead><tr><th>Customer Name</th><th>Policy Number</th><th>Policy Name</th><th>Premium Amount</th><th>Total Policy Amount</th><th>Nominee</th><th>Mobile</th><th>Premium Mode</th><th>Pay per Year</th><th>Starting Date</th><th>Ending Date</th><th>Next Renewal</th><th>Time Left</th>${(S.d.licFields || []).length ? '<th>More details</th>' : ''}<th></th></tr></thead><tbody>${rows}</tbody></table></div>`
        : `<div class="empty-state">${total ? 'No policies match your search.' : 'No LIC policies yet. Tap “Add policy” to start.'}</div>`}
      <p class="muted" style="margin-top:12px;font-size:calc(13px*var(--fs))">📋 <b>Copy</b> copies that customer's full data in one tap. <b>Next Renewal</b> comes from the <b>Renewal / Premium Due Date</b> you enter once — it then repeats by itself every month / quarter / half-year / year (per Premium Mode) and counts down the days, months or years left; <b>Time Left</b> counts down live to the policy's ending date. Saved in the “LIC Policies” tab of your Google Sheet — ⬇ Excel / ⬇ PDF export everything.</p>
    </div>`;
}
function licSearch(v){
  S.lic.q = v; clearTimeout(window._lict);
  window._lict = setTimeout(() => { render(); const i = $('#licq'); if (i){ i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250);
}
async function licCopy(id){
  const x = (S.d.lic || []).find(e => e.id === id); if (!x) return;
  const c = licCountdown(x.endDate), rn = licRenewInfo(x);
  const txt = [
    x.name && 'Customer Name: ' + x.name,
    x.policyNo && 'Policy Number: ' + x.policyNo,
    x.policyName && 'Policy Name: ' + x.policyName,
    x.amount ? 'Premium Amount: ₹' + Number(x.amount).toLocaleString('en-IN') : '',
    x.totalAmount ? 'Total Policy Amount: ₹' + Number(x.totalAmount).toLocaleString('en-IN') : '',
    x.nominee && 'Nominee: ' + x.nominee,
    x.phone && 'Customer Mobile: ' + x.phone,
    ...(S.d.licFields || []).filter(n => (x.extra || {})[n]).map(n => n + ': ' + x.extra[n]),
    'Premium Mode: ' + (LIC_FREQ[x.freq] || 'One-time'),
    licYearly(x) ? 'Pay per Year: ₹' + licYearly(x).toLocaleString('en-IN') + ' (' + LIC_PER_YEAR[x.freq] + ' × ₹' + Number(x.amount).toLocaleString('en-IN') + ')' : '',
    x.startDate && 'Starting Date: ' + x.startDate,
    x.endDate && 'Ending Date: ' + x.endDate,
    x.dueDate && 'Premium Due Date: ' + x.dueDate + (x.freq ? ' (repeats ' + LIC_FREQ[x.freq] + ')' : ''),
    rn.due && 'Next Renewal: ' + rn.due + ' (' + rn.text + ')',
    c.status && 'Status: ' + c.status + (c.status !== 'Expired' ? ' (' + c.text + ' left)' : '')
  ].filter(Boolean).join('\n');
  if (!txt) return toast('Nothing to copy', true);
  (await copyText(txt)) ? toast('Customer data copied') : toast('Could not copy — please copy it manually', true);
}
function licForm(id){ if (!can('lic')) return deny();
  const x = id ? S.d.lic.find(e => e.id === id) : null;
  const freqOpts = Object.keys(LIC_FREQ).map(k => `<option value="${k}" ${(x ? x.freq : '') === k ? 'selected' : ''}>${LIC_FREQ[k]}</option>`).join('');
  const w = openModal(`<h3>${x ? 'Edit policy' : 'Add policy'}</h3><p class="sub">Customer, policy name, premium and total policy amount, nominee, mobile number, premium mode, dates and the renewal (premium due) date.</p>
    <form id="licf" autocomplete="off">
      <div class="row2"><div class="field"><label>Customer Name</label><input class="input" name="name" maxlength="200" autocomplete="off" value="${esc(x ? x.name : '')}"></div>
        <div class="field"><label>Policy Number</label><input class="input" name="policyNo" maxlength="80" autocomplete="off" value="${esc(x ? x.policyNo : '')}"></div></div>
      <div class="row2"><div class="field"><label>Policy Name</label><input class="input" name="policyName" maxlength="200" autocomplete="off" placeholder="e.g. Jeevan Anand" value="${esc(x ? x.policyName : '')}"></div>
        <div class="field"><label>Total Policy Amount</label><input class="input" name="totalAmount" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Total sum of the policy" value="${x && x.totalAmount ? x.totalAmount : ''}"></div></div>
      <div class="row2"><div class="field"><label>Nominee</label><input class="input" name="nominee" maxlength="200" autocomplete="off" value="${esc(x ? x.nominee : '')}"></div>
        <div class="field"><label>Customer Mobile No.</label><input class="input" name="phone" type="tel" inputmode="tel" maxlength="30" autocomplete="off" value="${esc(x ? x.phone : '')}"></div></div>
      <div class="row2"><div class="field"><label>Premium Amount</label><input class="input" name="amount" type="number" min="0" step="0.01" inputmode="decimal" value="${x && x.amount ? x.amount : ''}"></div>
        <div class="field"><label>Premium paid</label><select class="select" name="freq">${freqOpts}</select></div></div>
      <div class="row2">
        <div class="field"><label>Starting Date</label><input class="input" type="date" name="startDate" value="${esc(x ? x.startDate : '')}"></div>
        <div class="field"><label>Ending Date</label><input class="input" type="date" name="endDate" value="${esc(x ? x.endDate : '')}"></div>
      </div>
      <div class="field"><label>Renewal / Premium Due Date</label><input class="input" type="date" name="dueDate" value="${esc(x ? x.dueDate : '')}"></div>
      ${(S.d.licFields || []).length ? `<div class="field" style="margin-top:4px"><label style="font-weight:800">📎 More details</label></div><div class="row2">${S.d.licFields.map((n, i) => `<div class="field"><label class="lf-l"><span>${esc(n)}</span><span class="lf-b"><button type="button" class="lf-btn" data-fren="${i}" title="Edit this option's name" aria-label="Edit option name">✎</button><button type="button" class="lf-btn" data-frem="${i}" title="Remove this option" aria-label="Remove option">🗑</button></span></label><input class="input" data-ex="${esc(n)}" maxlength="300" autocomplete="off" value="${esc(x && x.extra ? (x.extra[n] || '') : '')}"></div>`).join('')}</div>` : ''}
      <div class="actions" style="margin:0 0 8px"><button type="button" class="btn ghost sm" data-fadd>＋ Add new option</button> <button type="button" class="btn ghost sm" data-fields>⚙ Manage / reorder</button></div>
      <div id="licPrev" class="lic-prev"></div>
      <p class="muted" style="font-size:calc(12.5px*var(--fs));margin-top:-2px">Enter the due date once. For Monthly / Quarterly / Half-Yearly / Yearly it then repeats by itself and shows how many days / months / years are left. If left empty, the starting date is used.</p>
      <div class="foot"><button type="button" class="btn ghost" data-x>Cancel</button><button class="btn" type="submit">${x ? 'Save' : 'Add'}</button></div></form>`);
  w.querySelector('[data-x]').onclick = () => w.remove();
  w.querySelector('[data-fields]').onclick = () => {          // keep what is already typed, open the fields editor, then come back
    const fm = w.querySelector('#licf'), vals = Object.fromEntries(new FormData(fm)), ex = {};
    fm.querySelectorAll('[data-ex]').forEach(i => { ex[i.dataset.ex] = i.value; });
    S.licDraft = { id:x ? x.id : '', vals, ex }; w.remove(); licFieldsEdit(x ? x.id : '');
  };
  const keepDraft = () => { const fm = w.querySelector('#licf'), vals = Object.fromEntries(new FormData(fm)), ex = {}; fm.querySelectorAll('[data-ex]').forEach(i => { ex[i.dataset.ex] = i.value; }); S.licDraft = { id:x ? x.id : '', vals, ex }; };
  w.querySelector('[data-fadd]').onclick = () => { keepDraft(); w.remove(); licFieldQuick('add', -1, x ? x.id : ''); };
  w.querySelectorAll('[data-fren]').forEach(b => b.onclick = () => { keepDraft(); w.remove(); licFieldQuick('ren', +b.dataset.fren, x ? x.id : ''); });
  w.querySelectorAll('[data-frem]').forEach(b => b.onclick = () => { keepDraft(); w.remove(); licFieldQuick('rem', +b.dataset.frem, x ? x.id : ''); });
  const dr = S.licDraft && S.licDraft.id === (x ? x.id : '') ? S.licDraft : null; S.licDraft = null;
  if (dr){
    const fm = w.querySelector('#licf');
    Object.keys(dr.vals).forEach(k => { if (fm.elements[k] && !fm.elements[k].length) fm.elements[k].value = dr.vals[k]; });
    fm.querySelectorAll('[data-ex]').forEach(i => { if (dr.ex[i.dataset.ex] !== undefined) i.value = dr.ex[i.dataset.ex]; });
  }
  const prev = () => {                       // live "next due" line under the form
    const f = Object.fromEntries(new FormData(w.querySelector('#licf'))), rn = licRenewInfo(f), el = w.querySelector('#licPrev'), yr = licYearly(f);
    el.innerHTML = (yr ? `<div style="margin-bottom:4px">💰 To pay in 1 year: <b>₹${yr.toLocaleString('en-IN')}</b> <span class="muted">(${LIC_PER_YEAR[f.freq]} × ₹${Number(f.amount).toLocaleString('en-IN')})</span></div>` : '') + (rn.due ? `Next due: <b>${licDateFmt(rn.due)}</b> · <span class="${rn.cls}" style="font-weight:700">${esc(rn.text)}</span>${LIC_FREQ_MONTHS[f.freq] ? ` <span class="muted">(repeats every ${LIC_FREQ_MONTHS[f.freq]} month${LIC_FREQ_MONTHS[f.freq] > 1 ? 's' : ''})</span>` : ''}` : '');
  };
  w.querySelector('#licf').addEventListener('input', prev); w.querySelector('#licf').addEventListener('change', prev); prev();
  w.querySelector('#licf').onsubmit = async ev => {
    ev.preventDefault(); const f = Object.fromEntries(new FormData(ev.target)); const btn = ev.submitter; btn.disabled = true;
    f.extra = {}; ev.target.querySelectorAll('[data-ex]').forEach(i => { if (i.value.trim()) f.extra[i.dataset.ex] = i.value.trim(); });
    try{
      if (x){ const r = await api('updateLic', { id:x.id, ...f }); Object.assign(x, r.lic); }
      else { const r = await api('addLic', f); S.d.lic.push(r.lic); }
      w.remove(); render(); toast('Saved');
    }catch(e){ btn.disabled = false; handleErr(e); }
  };
}
/* quick add / rename / remove of ONE option straight from the policy form; the half-filled form comes back afterwards */
async function licFieldQuick(mode, idx, reopenId){
  if (!can('lic')) return deny();
  const cur = (S.d.licFields || []).slice(), back = () => licForm(reopenId || undefined);
  const save = async list => {
    try{
      const r = await api('saveLicFields', { fields:list });
      S.d.licFields = r.fields || [];
      const m = {}; list.forEach(f => { if (f.o) m[f.o] = f.n; });
      const carry = ex => { const nx = {}; Object.keys(m).forEach(o => { if (ex[o] !== undefined) nx[m[o]] = ex[o]; }); return nx; };
      (S.d.lic || []).forEach(p => { p.extra = carry(p.extra || {}); });
      if (S.licDraft) S.licDraft.ex = carry(S.licDraft.ex || {});
      render(); toast('Saved');
    }catch(e){ handleErr(e); }
    back();
  };
  const same = n => cur.map(o => ({ o, n:o }));
  if (mode === 'rem'){
    if (!await confirmBox('Remove “' + cur[idx] + '”?', 'This option and what is saved in it will be deleted from every policy.', 'Remove', true)) return back();
    return save(same().filter((_, i) => i !== idx));
  }
  const w = openModal(`<h3>${mode === 'add' ? '＋ New option' : '✎ Edit option name'}</h3><p class="sub">${mode === 'add' ? 'It appears in every policy (e.g. Address, Agent Code, Bank).' : 'Renaming keeps everything already typed.'}</p>
    <div class="field"><input class="input" id="lqN" maxlength="40" autocomplete="off" placeholder="e.g. Address" value="${esc(mode === 'ren' ? cur[idx] : '')}"></div>
    <div class="foot"><button type="button" class="btn ghost" data-x>Cancel</button><button type="button" class="btn" data-ok>Save</button></div>`);
  const inp = w.querySelector('#lqN'); inp.focus();
  w.querySelector('[data-x]').onclick = () => { w.remove(); back(); };
  const go = () => {
    const v = inp.value.trim(); if (!v) return;
    if (cur.some((n, i) => n.toLowerCase() === v.toLowerCase() && !(mode === 'ren' && i === idx))) return toast('That option already exists', true);
    if (mode === 'add' && cur.length >= 20) return toast('Up to 20 extra options', true);
    w.remove();
    save(mode === 'add' ? same().concat([{ o:'', n:v }]) : same().map((f, i) => i === idx ? { o:f.o, n:v } : f));
  };
  w.querySelector('[data-ok]').onclick = go; inp.onkeydown = e => { if (e.key === 'Enter'){ e.preventDefault(); go(); } };
}
/* add / rename / remove your own extra details (shown in every policy's form, copy text and exports) */
function licFieldsEdit(reopenId){ if (!can('lic')) return deny();
  let list = (S.d.licFields || []).map(f => ({ o:f, n:f }));
  const w = openModal(`<h3>⚙ Extra policy fields</h3><p class="sub">Add your own details for every policy (e.g. Agent Code, Address, Aadhaar last 4, Bank). Renaming keeps what you already typed; removing a field deletes its saved values.</p>
    <div id="lfF"></div>
    <div class="actions" style="flex-wrap:nowrap;margin:10px 0 4px"><input class="input" id="lfNew" maxlength="40" placeholder="New field name (e.g. Address)" autocomplete="off"><button class="btn soft" type="button" data-add>＋ Add</button></div>
    <div class="foot"><button type="button" class="btn ghost" data-x>Cancel</button><button class="btn" type="button" data-save>Save fields</button></div>`);
  const draw = () => { w.querySelector('#lfF').innerHTML = list.length ? list.map((x, i) => `<div class="actions" style="margin-bottom:8px;flex-wrap:nowrap"><input class="input" data-i="${i}" maxlength="40" value="${esc(x.n)}" autocomplete="off"><button class="btn ghost sm" type="button" data-up="${i}" aria-label="Move up">↑</button><button class="btn ghost sm" type="button" data-del="${i}" aria-label="Remove">🗑</button></div>`).join('') : '<div class="muted" style="margin-bottom:8px">No extra fields yet. Type a name below and tap Add.</div>'; };
  draw();
  const box = w.querySelector('#lfF');
  box.oninput = e => { if (e.target.dataset.i !== undefined) list[+e.target.dataset.i].n = e.target.value; };
  box.onclick = e => {
    const d = e.target.closest('[data-del]'), u = e.target.closest('[data-up]');
    if (d){ list.splice(+d.dataset.del, 1); draw(); }
    else if (u && +u.dataset.up > 0){ const i = +u.dataset.up; [list[i - 1], list[i]] = [list[i], list[i - 1]]; draw(); }
  };
  const add = () => {
    const inp = w.querySelector('#lfNew'), v = inp.value.trim(); if (!v) return;
    if (list.some(x => x.n.trim().toLowerCase() === v.toLowerCase())) return toast('That field already exists', true);
    if (list.length >= 20) return toast('Up to 20 extra fields', true);
    list.push({ o:'', n:v }); inp.value = ''; draw(); inp.focus();
  };
  w.querySelector('[data-add]').onclick = add;
  w.querySelector('#lfNew').onkeydown = e => { if (e.key === 'Enter'){ e.preventDefault(); add(); } };
  const back = () => { if (reopenId !== undefined && reopenId !== null) licForm(reopenId || undefined); };
  w.querySelector('[data-x]').onclick = () => { w.remove(); back(); };
  w.querySelector('[data-save]').onclick = async ev => {
    const pending = w.querySelector('#lfNew').value.trim(); if (pending && !list.some(x => x.n.trim().toLowerCase() === pending.toLowerCase())) list.push({ o:'', n:pending });
    const clean = list.map(x => ({ o:x.o, n:x.n.trim() })).filter(x => x.n);
    const b = ev.currentTarget; b.disabled = true;
    try{
      const r = await api('saveLicFields', { fields:clean });
      S.d.licFields = r.fields || [];
      const m = {}; clean.forEach(x => { if (x.o) m[x.o] = x.n; });         // keep the typed values in the page after a rename / delete
      (S.d.lic || []).forEach(p => { const ex = p.extra || {}, nx = {}; Object.keys(m).forEach(o => { if (ex[o] !== undefined) nx[m[o]] = ex[o]; }); p.extra = nx; });
      w.remove(); render(); toast('Fields saved'); back();
    }catch(e){ b.disabled = false; handleErr(e); }
  };
}
async function licDel(id){ if (!can('lic')) return deny();
  const x = S.d.lic.find(e => e.id === id); if (!x) return;
  if (!await confirmBox('Delete this policy?', `${x.name || x.policyNo || 'This entry'} will be removed from your sheet.`, 'Delete', true)) return;
  try { await api('deleteLic', { id }); S.d.lic = S.d.lic.filter(e => e.id !== id); render(); toast('Deleted'); } catch(e){ handleErr(e); }
}
async function licExport(fmt){
  if (!(S.d.lic || []).length) return toast('No policies to export', true);
  doExport('lic', fmt);
}
/* live tick: updates every "Time Left" + "Next Renewal" cell in place, once a second, without re-rendering the page */
let licTimer = null;
function licTick(){
  document.querySelectorAll('.lic-cd').forEach(el => {
    const c = licCountdown(el.dataset.end || '');
    el.textContent = c.text; el.className = 'lic-cd ' + (c.cls || '');
  });
  document.querySelectorAll('.lic-rn').forEach(el => {
    const x = (S.d.lic || []).find(e => e.id === el.dataset.licId); if (!x) return;
    const rn = licRenewInfo(x);
    el.textContent = rn.text; el.className = 'lic-rn ' + (rn.cls || '');
  });
}
function startLic(){
  clearInterval(licTimer); licTimer = null;
  if (!document.querySelector('.lic-cd, .lic-rn')) return;
  licTick(); licTimer = setInterval(licTick, 1000);
}

/* =====================================================================
   VIEW: TIME TABLE  (30-minute slots, 5 AM → 1 AM, a category dropdown for every slot)
   ===================================================================== */
const TT_SLOTS = (() => { const a = []; for (let i = 0; i < 40; i++){ const mn = 300 + i * 30; a.push(pad2(Math.floor(mn / 60) % 24) + ':' + pad2(mn % 60)); } return a; })();
const TT_COLORS = ['#c7d2fe','#bbf7d0','#fde68a','#fecaca','#bae6fd','#e9d5ff','#fbcfe8','#fed7aa','#a7f3d0','#ddd6fe','#fef08a','#cbd5e1'];
const ttColor = name => { const i = (S.d.ttCats || []).indexOf(name); return i < 0 ? '' : TT_COLORS[i % TT_COLORS.length]; };
const ttAp = h => h >= 12 ? 'PM' : 'AM';
const ttHm = (h, m) => `${h % 12 || 12}:${pad2(m)}`;
function ttRange(k){
  const h = +k.slice(0, 2), m = +k.slice(3), e = h * 60 + m + 30, h2 = Math.floor(e / 60) % 24, m2 = e % 60;
  return ttAp(h) === ttAp(h2) ? `${ttHm(h, m)} – ${ttHm(h2, m2)} ${ttAp(h2)}` : `${ttHm(h, m)} ${ttAp(h)} – ${ttHm(h2, m2)} ${ttAp(h2)}`;
}
const ttDate = () => S.tt.date || todayISO();
const isoOf = d => new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
function vTimetable(){
  const date = ttDate(), day = S.d.timetable[date] || {}, cats = S.d.ttCats || [];
  const dt = new Date(date + 'T00:00:00'), isT = date === todayISO();
  const counts = {}; let filled = 0;
  TT_SLOTS.forEach(k => { const c = day[k]; if (c){ filled++; counts[c] = (counts[c] || 0) + 1; } });
  const hrs = n => (n / 2) + ' h';
  const chips = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([n, c]) => `<span class="chip" style="background:${esc(ttColor(n) || '#f1f5f9')}">${esc(n)} · ${hrs(c)}</span>`).join('');
  const opts = cur => '<option value="">— Select —</option>' + (cur && !cats.includes(cur) ? `<option selected>${esc(cur)}</option>` : '')
    + cats.map(c => `<option ${c === cur ? 'selected' : ''}>${esc(c)}</option>`).join('') + '<option value="__new">＋ Add new category…</option>';
  let rows = '';
  TT_SLOTS.forEach(k => {
    if (k === '00:00') rows += '<tr class="tt-mid"><td colspan="2">🌙 After midnight</td></tr>';
    const cur = day[k] || '', col = cur ? ttColor(cur) : '';
    rows += `<tr><td class="tt-t">${ttRange(k)}</td><td><select class="select tt-sel" data-tt="${k}" ${col ? `style="background:${col}"` : ''} onchange="ttPick('${k}',this)">${opts(cur)}</select></td></tr>`;
  });
  return `<div class="card" style="margin-bottom:16px">
    <div class="cal-head">
      <button class="btn ghost sm" onclick="ttNav(-1)">‹</button>
      <input class="input" type="date" style="width:auto" value="${esc(date)}" onchange="ttSetDate(this.value)">
      <button class="btn ghost sm" onclick="ttNav(1)">›</button>
      <button class="btn soft sm" onclick="ttSetDate('')">Today</button>
      <span style="flex:1"></span>
      <button class="btn soft sm" onclick="ttCopyPrev()">⧉ Copy previous day</button>
      <button class="btn soft sm" onclick="ttClear()">🗑 Clear day</button>
      <button class="btn sm" onclick="ttCats()">⚙ Categories</button>
    </div>
    <div class="sec-title" style="margin:0 0 8px">${WD[dt.getDay()]}, ${esc(fmtDateNice(date))}${isT ? ' · Today' : ''}</div>
    <div class="chips"><span class="chip" style="background:var(--good-soft)">Planned ${hrs(filled)} of 20 h</span>${chips}</div>
  </div>
  <div class="card"><h3>Time table <span class="muted" style="font-weight:500;font-size:calc(12.5px*var(--fs))">5:00 AM – 1:00 AM · 30-minute slots</span></h3>
    ${cats.length ? '' : '<div class="viewas">💡 No categories yet — choose “＋ Add new category…” in any dropdown, or tap ⚙ Categories to add them.</div>'}
    <div class="tbl-wrap"><table class="tt"><thead><tr><th>Time</th><th>Category</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="muted" style="margin-top:12px;font-size:calc(13px*var(--fs))">Pick a category for each slot — it saves instantly to the “Timetable” tab of your Google Sheet. Need a new one? Choose <b>＋ Add new category…</b> in the dropdown.</p>
  </div>`;
}
function ttSetDate(v){ S.tt.date = v || ''; render(); }
function ttNav(n){ const d = new Date(ttDate() + 'T00:00:00'); d.setDate(d.getDate() + n); S.tt.date = isoOf(d); render(); }
async function ttPick(k, el){
  if (!can('tt')){ render(); return deny(); }
  const date = ttDate(); let v = el.value;
  if (v === '__new'){
    render();                                   // put the dropdown back while the "new category" box is open
    const name = await ttAskCat(); if (!name) return;
    v = name;
  }
  const day = S.d.timetable[date] = S.d.timetable[date] || {}, prev = day[k];
  if (v) day[k] = v; else delete day[k];
  render();
  try { await api('setTimetable', { date, slots:{ [k]: v } }); toast('Saved'); }
  catch(e){ if (prev) day[k] = prev; else delete day[k]; render(); handleErr(e); }
}
function ttAskCat(){
  return new Promise(res => {
    const w = openModal(`<h3>New category</h3><p class="sub">It will show up in the dropdown of every time slot.</p>
      <form id="ttnf" autocomplete="off"><div class="field"><label>Category name</label><input class="input" name="name" maxlength="40" placeholder="e.g. Study, Gym, Office work" required></div>
      <div class="foot"><button type="button" class="btn ghost" data-x>Cancel</button><button class="btn" type="submit">Add & select</button></div></form>`);
    const inp = w.querySelector('input'); setTimeout(() => inp.focus(), 50);
    w.querySelector('[data-x]').onclick = () => { w.remove(); res(null); };
    w.querySelector('#ttnf').onsubmit = async ev => {
      ev.preventDefault(); const name = inp.value.trim().replace(/\s+/g, ' '), btn = ev.submitter; if (!name) return;
      const have = (S.d.ttCats || []).find(c => c.toLowerCase() === name.toLowerCase());
      if (have){ w.remove(); return res(have); }
      btn.disabled = true;
      try { const r = await api('addTtCat', { name }); S.d.ttCats = r.categories; w.remove(); res(r.name); }
      catch(e){ btn.disabled = false; handleErr(e); }
    };
  });
}
function ttCats(){ if (!can('tt')) return deny(); const w = openModal('', 'wide'); drawTtCats(w); }
function drawTtCats(w){
  const cats = S.d.ttCats || [], m = w.querySelector('.modal');
  const used = n => Object.values(S.d.timetable).reduce((t, d) => t + Object.values(d).filter(c => c === n).length, 0);
  const rows = cats.map((c, i) => `<div class="tt-cat-row"><span class="dot" style="background:${esc(ttColor(c))};width:16px;height:16px;flex:none"></span><input class="input" id="tc${i}" value="${esc(c)}" maxlength="40">
    <button class="btn soft sm" data-save="${i}">Save</button><button class="btn ghost sm" data-del="${i}" title="${used(c)} slots use it">🗑${used(c) ? ' ' + used(c) : ''}</button></div>`).join('');
  m.innerHTML = `<h3>Time table categories</h3><p class="sub">These appear in the dropdown of every time slot. Renaming also updates the slots already filled.</p>
    ${rows || '<div class="empty-state">No categories yet — add your first one below.</div>'}
    <div class="sec-title" style="margin-top:18px">Add new category</div>
    <div class="tt-cat-row"><input class="input" id="tcNew" placeholder="e.g. Study, Gym, Office work" maxlength="40"><button class="btn sm" id="tcAdd">＋ Add</button></div>
    <div class="foot"><button class="btn ghost" data-x>Done</button></div>`;
  const sync = r => { S.d.ttCats = r.categories; S.d.timetable = r.timetable || {}; drawTtCats(w); };
  m.querySelector('[data-x]').onclick = () => { w.remove(); render(); };
  const add = async () => {
    try { const r = await api('addTtCat', { name:m.querySelector('#tcNew').value }); sync(r); toast('Category added'); const n = w.querySelector('#tcNew'); if (n) n.focus(); } catch(e){ handleErr(e); }
  };
  m.querySelector('#tcAdd').onclick = add;
  m.querySelector('#tcNew').onkeydown = e => { if (e.key === 'Enter'){ e.preventDefault(); add(); } };
  m.querySelectorAll('[data-save]').forEach(b => b.onclick = async () => {
    const i = +b.dataset.save;
    try { sync(await api('updateTtCat', { oldName:cats[i], name:m.querySelector('#tc' + i).value })); toast('Category updated'); } catch(e){ handleErr(e); }
  });
  m.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    const i = +b.dataset.del, n = used(cats[i]);
    if (!await confirmBox('Delete “' + cats[i] + '”?', n ? `${n} filled slot(s) that use it will become empty.` : 'This category will be removed.', 'Delete', true)) return;
    try { sync(await api('deleteTtCat', { name:cats[i] })); toast('Category deleted'); } catch(e){ handleErr(e); }
  });
}
async function ttClear(){ if (!can('tt')) return deny();
  const date = ttDate(), n = Object.keys(S.d.timetable[date] || {}).length;
  if (!n) return toast('This day is already empty');
  if (!await confirmBox('Clear this day?', `${n} filled slot(s) of ${fmtDateNice(date)} will be emptied.`, 'Clear', true)) return;
  try { await api('setTimetable', { date, slots:{}, replace:true }); delete S.d.timetable[date]; render(); toast('Day cleared'); } catch(e){ handleErr(e); }
}
async function ttCopyPrev(){ if (!can('tt')) return deny();
  const date = ttDate(), d = new Date(date + 'T00:00:00'); d.setDate(d.getDate() - 1);
  const prev = isoOf(d), src = S.d.timetable[prev] || {}, cur = S.d.timetable[date] || {};
  if (!Object.keys(src).length) return toast('Previous day (' + fmtDateNice(prev) + ') has no entries', true);
  if (Object.keys(cur).length && !await confirmBox('Replace this day?', `Today’s ${Object.keys(cur).length} filled slot(s) will be replaced with ${fmtDateNice(prev)}’s plan.`, 'Replace')) return;
  try { await api('setTimetable', { date, slots:src, replace:true }); S.d.timetable[date] = { ...src }; render(); toast('Copied from ' + fmtDateNice(prev)); } catch(e){ handleErr(e); }
}



/* =====================================================================
   VIEW: SETTINGS
   ===================================================================== */
function exportCard(){
  const P = perms(), items = [];
  if (P.att !== 'none') items.push(['att', '🗓️ Attendance', 'Year summary + day-wise register — how many days Present / Absent / Week off', 'Attendance']);
  if (P.exp !== 'none') items.push(['exp', '💸 Expenses — Ledger', 'Income (in), Expense (out) and running balance, with category & month summary', 'Ledger']);
  if (P.work !== 'none') items.push(['work', '🛠️ Work record', 'All daily work entries with month & product summary', 'Work']);
  if (!items.length) return '';
  if (items.length > 1) items.push(['all', '📚 All data', items.map(x => x[3]).join(' + ') + ' in a single file', '']);
  const note = P.att !== 'none' ? ` Attendance export is for the selected employee (<b>${esc(emp().name || '—')}</b>).` : '';
  return `<div class="card"><h3>📦 Data & export</h3>
    <p class="muted" style="margin-bottom:14px">Your data lives in your Google Sheet.${note}</p>
    <div class="exgrid">
      ${items.map(([k, t, s2]) =>
        `<div class="exitem"><div><span class="t">${t}</span><span class="s">${s2}</span></div><div class="actions"><button class="btn soft sm" onclick="doExport('${k}','xlsx')">⬇ Excel</button><button class="btn soft sm" onclick="doExport('${k}','pdf')">⬇ PDF</button></div></div>`).join('')}
    </div>
  </div>`;
}
function vSettingsBase(){
  const s = cfg(), emps = S.d.employees || [];
  const empRows = emps.map(e => `<div class="emp-item ${e.id===S.emp?'cur':''}">
      <div class="avatar">${esc((e.name||'?').trim().charAt(0).toUpperCase())}</div>
      <div class="info"><b>${esc(e.name || 'Unnamed')}</b><span>${esc(e.designation || 'Employee')} · ${esc(fm(e.salary))}/month</span></div>
      <div class="acts"><button class="btn ghost sm" onclick="empForm('${esc(e.id)}')">✎ Edit</button><button class="btn ghost sm" onclick="delEmp('${esc(e.id)}')">🗑</button></div></div>`).join('');
  return `<div class="grid two-eq">
  <div class="card"><h3>👥 Employees <button class="btn sm" onclick="empForm()">＋ Add employee</button></h3>
    <p class="muted" style="margin-bottom:12px">Each employee has their own attendance and salary. Use the dropdown at the top of Dashboard / Attendance to switch.</p>
    <div class="emp-list">${empRows || '<div class="empty-state">No employees</div>'}</div>
  </div>

  <div class="card"><h3>⚙️ General</h3>
    <form id="fGeneral">
      <div class="form-grid">
        <div class="field"><label>App name <span class="muted">(shown in sidebar)</span></label><input class="input" name="appName" maxlength="30" value="${esc(s.appName || 'KS')}"></div>
        <div class="field"><label>Year</label><input class="input" type="number" name="year" min="2000" max="2100" value="${esc(s.year)}" required inputmode="numeric"></div>
        <div class="field"><label>Currency symbol</label><input class="input" name="currency" maxlength="4" value="${esc(s.currency)}"></div>
        <div class="field"><label>Recovery e-mail <span class="muted">(OTP goes here)</span></label><input class="input" type="email" name="email" value="${esc(s.email)}" placeholder="you@gmail.com" autocomplete="email"></div>
        <div class="field"><label>Round daily salary <span class="muted">(e.g. 580.64 → 581; .50 or less stays 580)</span></label><select class="select" id="roundSel"><option value="0" ${roundDaily() ? '' : 'selected'}>Off – exact value</option><option value="1" ${roundDaily() ? 'selected' : ''}>On – round up above .5</option></select></div>
      </div>
      <button class="btn" type="submit">Save</button>
    </form></div>

  <div class="card"><h3>🔐 Login & security</h3>
    <p class="muted" style="margin-bottom:14px">Signed in as <b>${esc(s.username)}</b>. Leave a field empty to keep it unchanged. Forgot the password? Use <b>Forgot password?</b> on the sign-in screen — an OTP is e-mailed to ${esc(isAdmin() ? (s.email || 'the sheet owner’s e-mail') : 'your recovery e-mail (ask the admin to add one)')}.</p>
    <form id="fSec">
      <div class="field"><label>New username</label><input class="input" name="newUsername" autocomplete="off" placeholder="${esc(s.username)}"></div>
      <div class="form-grid">
        <div class="field"><label>New password</label><input class="input" type="password" name="newPassword" autocomplete="new-password" minlength="6"></div>
        <div class="field"><label>Confirm new password</label><input class="input" type="password" name="confirm" autocomplete="new-password"></div>
      </div>
      <div class="field"><label>Current password <span class="muted">(required)</span></label><input class="input" type="password" name="currentPassword" autocomplete="current-password" required></div>
      <button class="btn" type="submit">Update login</button>
    </form></div>

  <div class="card"><h3>🏷️ Attendance status codes</h3>
    <p class="muted" style="margin-bottom:14px">Paid factor: 1 = full day, 0.5 = half day, 0 = unpaid. Salary is calculated from this. P, A, W are core codes (cannot be deleted).</p>
    <form id="fStat">
      <div class="status-row sec-title" style="margin:0 0 6px"><span>Code</span><span>Label</span><span>Paid</span><span>Colour</span><span></span></div>
      ${S.d.statuses.map((x, i) => `<div class="status-row"><b>${badge(x.code)}</b>
        <input class="input" name="l${i}" value="${esc(x.label)}"><input class="input" type="number" min="0" max="1" step="0.25" name="f${i}" value="${esc(x.factor)}" inputmode="decimal">
        <input type="color" name="c${i}" value="${/^#[0-9a-f]{6}$/i.test(x.color) ? esc(x.color) : '#e2e8f0'}" style="width:48px;height:38px;border:1px solid var(--line);border-radius:9px;background:#fff">
        ${['P','A','W'].includes(x.code) ? '<span></span>' : `<button type="button" class="btn ghost sm" onclick="delStatus('${esc(x.code)}')" title="Delete">🗑</button>`}</div>`).join('')}
      <button class="btn" type="submit">Save status codes</button>
    </form>
    <div class="sec-title" style="margin-top:20px">Add new status code</div>
    <form id="fNewStat">
      <div class="status-row"><input class="input" name="code" maxlength="3" placeholder="HD" style="text-transform:uppercase" required>
        <input class="input" name="label" placeholder="Label e.g. Half Day" required><input class="input" type="number" min="0" max="1" step="0.25" name="factor" value="1" inputmode="decimal">
        <input type="color" name="color" value="#bfdbfe" style="width:48px;height:38px;border:1px solid var(--line);border-radius:9px;background:#fff"><span></span></div>
      <button class="btn soft" type="submit">＋ Add status code</button>
    </form></div>

  <div class="card"><h3>💸 Expense categories</h3>
    <p class="muted" style="margin-bottom:14px">${S.d.categories.length} categories. Rename, change Income / Expense type, delete or add new ones.</p>
    <button class="btn soft" onclick="catManager()">⚙ Manage categories</button></div>

  ${exportCard()}</div>`;
}
function vSettings(){
  const dom = document.createElement('div'); dom.innerHTML = vSettingsBase();
  const grid = dom.firstElementChild;
  const drop = word => [...grid.children].forEach(c => { const t = c.querySelector('h3'); if (t && t.textContent.includes(word)) c.remove(); });
  if (!can('emp')) drop('Employees');
  if (!isAdmin()){ drop('General'); drop('Attendance status codes'); }
  if (!can('creds')) drop('Login & security');
  if (!can('exp')) drop('Expense categories');
  if (canAddUsers()) grid.insertAdjacentHTML('afterbegin', usersCard() + (isAdmin() ? groupsCard() : ''));
  grid.insertAdjacentHTML('afterbegin', themeCard());
  grid.insertAdjacentHTML('afterbegin', photoCard());
  grid.insertAdjacentHTML('beforeend', bioCard());
  if (S.me && S.me.primary) grid.insertAdjacentHTML('beforeend', liveCard());
  if (S.me && S.me.primary) grid.insertAdjacentHTML('beforeend', driveCard());
  if (S.me && S.me.primary) grid.insertAdjacentHTML('beforeend', trashCard());
  if (S.me && S.me.actLog) grid.insertAdjacentHTML('beforeend', activityCard());
  return settingsHub(grid);
}

/* ---------- Settings hub: one tile per card, tap a tile to open it ---------- */
const SET_MATCH = [['photo','Profile photo'],['theme','Appearance'],['users','Users & access'],['groups','Groups'],['emps','Employees'],['general','General'],['security','Login & security'],['bio','Fingerprint'],['status','Attendance status codes'],['cats','Expense categories'],['export','Data & export'],['vcsproc','VCS Processing'],['drive','Google Drive'],['activity','Activity log'],['trash','Trash']];
const SET_DEF = {
  photo:['🖼','Profile photo','Your picture shown in Chat'],
  security:['🔐','Login & security','Change username and password'],
  bio:['👆','Fingerprint / Face','Unlock the app with biometrics'],
  theme:['🎨','Appearance & layout','Colours, fonts, menu, dashboard look'],
  general:['⚙️','General','App name, year, currency, e-mail, rounding'],
  emps:['👥','Employees','Add, edit or remove employees'],
  users:['🛡️','Users & access','Logins and what each user can see'],
  groups:['💬','Groups','Chat groups and their members'],
  status:['🏷️','Attendance codes','Status codes, paid factor and colours'],
  cats:['💸','Expense categories','Income / expense categories'],
  export:['📦','Data & export','Download Excel or PDF reports'],
  vcsproc:['📡','VCS Processing','Live: every request, Render & Google services'],
  drive:['☁️','Google Drive','Where chat photos & videos are stored'],
  activity:['📋','Activity log','Who did what, and when'],
  trash:['🗑️','Trash','Deleted chat messages, photos & videos']
};
const SET_GROUPS = [
  ['Account & security', ['photo','security','bio']],
  ['Customize', ['theme','general']],
  ['People & access', ['emps','users','groups']],
  ['Attendance & expenses', ['status','cats']],
  ['Data & system', ['vcsproc','export','drive','activity','trash']]
];
function setHint(k){
  try {
    if (k === 'emps') return (S.d.employees || []).length + ' employees';
    if (k === 'users' && S.users) return S.users.length + ' users';
    if (k === 'cats') return (S.d.categories || []).length + ' categories';
    if (k === 'status') return (S.d.statuses || []).length + ' codes';
  } catch(e){}
  return '';
}
function setOpen(k){ S.setSec = k; render(); window.scrollTo(0, 0); }
function setBack(){ S.setSec = null; render(); window.scrollTo(0, 0); }
function settingsHub(grid){
  const found = {}, def = {};
  [...grid.children].forEach((c, i) => {
    const t = ((c.querySelector('h3') || {}).textContent || '').trim();
    const m = SET_MATCH.find(x => t.includes(x[1]));
    const k = m && !found[m[0]] ? m[0] : 'x' + i;
    found[k] = c; c.dataset.sec = k;
    def[k] = SET_DEF[k] || [t.split(' ')[0] || '•', t.replace(/^\S+\s*/, '') || 'More', ''];
  });
  const open = found[S.setSec] ? S.setSec : null;
  S.setSec = open;
  [...grid.children].forEach(c => { c.style.gridColumn = ''; if (c.dataset.sec !== open) c.classList.add('hidden'); });
  const tile = k => { const d = def[k], h = setHint(k);
    return `<button type="button" class="set-tile" data-q="${esc((d[1] + ' ' + d[2]).toLowerCase())}" onclick="setOpen('${k}')"><span class="set-ic">${d[0]}</span><span class="set-tx"><b>${esc(d[1])}</b><small>${esc(d[2])}</small>${h ? `<em>${esc(h)}</em>` : ''}</span><span class="set-go">›</span></button>`; };
  const used = new Set();
  const sec = (g, ks, gi) => `<section class="set-grp" data-g="${gi}"><div class="set-gt"><span>${esc(g)}</span><i>${ks.length}</i></div><div class="set-tiles">${ks.map(tile).join('')}</div></section>`;
  let hub = SET_GROUPS.map(([g, keys], gi) => {
    const ks = keys.filter(k => found[k]); ks.forEach(k => used.add(k));
    return ks.length ? sec(g, ks, gi) : '';
  }).join('');
  const rest = Object.keys(found).filter(k => !used.has(k));
  if (rest.length) hub += sec('More', rest, 9);
  const search = `<div class="set-search"><span aria-hidden="true">🔍</span><input id="setQ" type="search" class="input" placeholder="Search settings…" autocomplete="off" oninput="setFilter(this.value)"></div>`;
  const bar = open ? `<div class="set-bar"><button type="button" class="btn ghost sm" onclick="setBack()">← Settings</button><span class="set-bic">${def[open][0]}</span><div class="set-bt"><b>${esc(def[open][1])}</b>${def[open][2] ? `<small>${esc(def[open][2])}</small>` : ''}</div></div>` : '';
  return `<div class="set-root">${open ? bar : `<div class="set-hub">${search}${hub}<div class="empty-state hidden" id="setNone">No setting matches your search</div></div>`}<div class="set-detail">${grid.innerHTML}</div></div>`;
}
function setFilter(q){
  q = (q || '').trim().toLowerCase(); let any = false;
  document.querySelectorAll('.set-hub .set-grp').forEach(g => {
    let n = 0;
    g.querySelectorAll('.set-tile').forEach(t => { const ok = !q || t.dataset.q.includes(q); t.classList.toggle('hidden', !ok); if (ok) n++; });
    g.classList.toggle('hidden', !n); if (n) any = true;
  });
  const none = document.getElementById('setNone'); if (none) none.classList.toggle('hidden', any);
}
function applySettings(r){
  if (r.settings) S.d.settings = { ...S.d.settings, ...r.settings };
  if (r.employees){
    S.d.employees = r.employees;
    Object.keys(S.d.attAll).forEach(k => { if (!r.employees.find(e => e.id === k)) delete S.d.attAll[k]; });
    pickEmp(S.emp);
  }
  refreshUser();
}
function empForm(id){ if (!can('emp')) return deny();
  const x = id ? S.d.employees.find(e => e.id === id) : null;
  const w = openModal(`<h3>${x ? 'Edit employee' : 'Add employee'}</h3><p class="sub">${x ? 'Change details — attendance stays as it is.' : 'A new attendance register is created for this employee.'}</p>
    <form id="empf">
      <div class="field"><label>Employee name</label><input class="input" name="name" value="${esc(x ? x.name : '')}" maxlength="60" required></div>
      <div class="field"><label>Designation</label><input class="input" name="designation" value="${esc(x ? x.designation : '')}" maxlength="60"></div>
      <div class="row2"><div class="field"><label>Monthly salary</label><input class="input" type="number" name="salary" min="0" step="0.01" value="${x ? esc(x.salary) : ''}" required inputmode="decimal"></div>
        <div class="field"><label>Days basis <span class="muted">(0 = actual)</span></label><input class="input" type="number" name="basis" min="0" max="31" value="${x ? esc(x.basis) : 0}" inputmode="numeric"></div></div>
      <div class="foot"><button type="button" class="btn ghost" data-x>Cancel</button><button class="btn" type="submit">${x ? 'Save' : 'Add employee'}</button></div></form>`);
  w.querySelector('[data-x]').onclick = () => w.remove();
  w.querySelector('#empf').onsubmit = async ev => {
    ev.preventDefault(); const f = Object.fromEntries(new FormData(ev.target)); const btn = ev.submitter; btn.disabled = true;
    try{
      const r = await api(x ? 'updateEmployee' : 'addEmployee', x ? { id:x.id, ...f } : f);
      if (!x){ S.d.attAll[r.id] = {}; }
      applySettings(r); w.remove(); render(); toast(x ? 'Employee updated' : 'Employee added');
    }catch(e){ btn.disabled = false; handleErr(e); }
  };
}
async function delEmp(id){ if (!can('emp')) return deny();
  const x = S.d.employees.find(e => e.id === id); if (!x) return;
  if ((S.d.employees || []).length < 2) return toast('At least one employee must remain', true);
  if (!await confirmBox('Delete ' + (x.name || 'employee') + '?', 'Their attendance register will be permanently removed from your sheet.', 'Delete', true)) return;
  try { const r = await api('deleteEmployee', { id }); applySettings(r); render(); toast('Employee deleted'); } catch(e){ handleErr(e); }
}
async function delStatus(code){
  if (!await confirmBox('Delete status “' + code + '”?', 'This only works if no day is marked with it.', 'Delete', true)) return;
  try { const r = await api('deleteStatus', { code }); S.d.statuses = r.statuses; render(); toast('Status deleted'); } catch(e){ handleErr(e); }
}
function bindSettings(){
  const $ = s => document.querySelector(s) || {};          // cards can be hidden by permissions
  const rs = document.getElementById('roundSel');
  if (rs) rs.onchange = () => {
    try { localStorage.setItem(ROUND_KEY, rs.value); } catch(e){}
    toast(rs.value === '1' ? 'Daily salary rounding ON' : 'Daily salary rounding OFF');
  };
  $('#fGeneral').onsubmit = async ev => {
    ev.preventDefault(); const btn = ev.submitter; btn.disabled = true;
    try{
      const r = await api('saveSettings', Object.fromEntries(new FormData(ev.target)));
      applySettings(r); toast('Saved'); render();
    }catch(e){ handleErr(e); } finally { btn.disabled = false; }
  };
  $('#fSec').onsubmit = async ev => {
    ev.preventDefault(); const f = Object.fromEntries(new FormData(ev.target));
    if (!f.newUsername.trim() && !f.newPassword) return toast('Enter a new username or password', true);
    if (f.newPassword && f.newPassword !== f.confirm) return toast('New passwords do not match', true);
    try{
      const r = await api('changeCredentials', f);
      if (r.token) saveToken(r.token, store.isLocal(TK));
      S.d.settings.username = r.username; if (S.me) S.me.username = r.username; toast('Login updated'); render();
    }catch(e){ handleErr(e); }
  };
  $('#fStat').onsubmit = async ev => {
    ev.preventDefault(); const f = Object.fromEntries(new FormData(ev.target));
    const statuses = S.d.statuses.map((x, i) => ({ code:x.code, label:f['l'+i], factor:f['f'+i], color:f['c'+i] }));
    try { const r = await api('saveStatuses', { statuses }); S.d.statuses = r.statuses; toast('Status codes saved'); render(); } catch(e){ handleErr(e); }
  };
  $('#fNewStat').onsubmit = async ev => {
    ev.preventDefault(); const f = Object.fromEntries(new FormData(ev.target)); const btn = ev.submitter; btn.disabled = true;
    try { const r = await api('addStatus', f); S.d.statuses = r.statuses; toast('Status code added'); render(); } catch(e){ handleErr(e); } finally { btn.disabled = false; }
  };
  const afU = document.getElementById('afU'), afQ = document.getElementById('afQ');
  if (afU) afU.onchange = e => { S.af.u = e.target.value; drawActivityList(); };
  if (afQ) afQ.oninput = e => { S.af.q = e.target.value; drawActivityList(); };
  const aU = document.getElementById('actUsersChk');
  if (aU) aU.onchange = async e => {
    const on = e.target.checked; e.target.disabled = true;
    try { await api('setActivityAccess', { on }); S.me.actUsers = on; toast(on ? 'Users can now see their own activity' : 'Activity log is now admin-only'); }
    catch(err){ e.target.checked = !on; handleErr(err); } finally { e.target.disabled = false; }
  };
  if (S.me && S.me.actLog){ if (S.acts) drawActivityList(); else loadActivity(); }
}
function download(name, rows){
  const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type:'text/csv' })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* =====================================================================
   EXPORT ENGINE  (Excel via ExcelJS, PDF via jsPDF + AutoTable)
   ===================================================================== */
const LIBS = {
  excel:  'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js',
  jspdf:  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  atable: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js'
};
const _libP = {};
function loadScript(url){
  return _libP[url] || (_libP[url] = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = url; s.onload = res;
    s.onerror = () => { delete _libP[url]; rej(new Error('Could not load the export library. Check your internet connection and try again.')); };
    document.head.appendChild(s);
  }));
}
async function needExcel(){ if (!window.ExcelJS) await loadScript(LIBS.excel); }
async function needPdf(){
  if (!(window.jspdf && window.jspdf.jsPDF)) await loadScript(LIBS.jspdf);
  if (!(window.jspdf.jsPDF.API && window.jspdf.jsPDF.API.autoTable)) await loadScript(LIBS.atable);
}
function saveBlob(name, blob){
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const STAMP = () => new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
const dayName = iso => { const [y, m, d] = iso.split('-').map(Number); return isNaN(d) ? '' : WD[new Date(y, m-1, d).getDay()]; };
const monLabel = k => { const m = +k.slice(5, 7); return m >= 1 && m <= 12 ? `${MONTHS[m-1]} ${k.slice(0, 4)}` : k; };
const hexArgb = c => /^#[0-9a-f]{6}$/i.test(c || '') ? 'FF' + c.slice(1).toUpperCase() : 'FFE2E8F0';
const rgbOf = c => { const h = hexArgb(c).slice(2); return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)]; };
const isDark = c => { const [r, g, b] = rgbOf(c); return (r*299 + g*587 + b*114) / 1000 < 140; };

/* ---------- data preparation (shared by Excel + PDF) ---------- */
function exPrep(){
  const s = cfg(), e = emp(), y = +s.year, sts = S.d.statuses, sm = smap();
  const months = MONTHS.map((nm, i) => { const m = i + 1, st = monthStats(m), a = S.d.attendance[m] || {};
    return { m, nm, st, cells: Array.from({ length:31 }, (_, k) => k < st.dim ? (a[k+1] || '') : null) }; });
  const yt = yearStats(), totalDays = months.reduce((t, x) => t + x.st.dim, 0);
  const log = [];
  months.forEach(mo => mo.cells.forEach((c, k) => { if (c) log.push({ date:`${y}-${pad2(mo.m)}-${pad2(k+1)}`, code:c, label:(sm[c] || {}).label || '' }); }));
  const led = S.d.expenses.map((x, i) => ({ ...x, i, type:catType(x.category), amt:+x.amount || 0 }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.i - b.i);
  let bal = 0, inc = 0, exp = 0;
  led.forEach(r => { if (r.type === 'Income'){ r.cr = r.amt; r.dr = 0; inc += r.amt; bal += r.amt; } else { r.cr = 0; r.dr = r.amt; exp += r.amt; bal -= r.amt; } r.bal = bal; });
  const cat = {};
  led.forEach(r => { const k = r.type + '|' + r.category; const o = cat[k] = cat[k] || { type:r.type, category:r.category, n:0, total:0 }; o.n++; o.total += r.amt; });
  const catList = Object.values(cat).sort((a, b) => (a.type === b.type ? 0 : a.type === 'Income' ? -1 : 1) || b.total - a.total);
  const mon = {};
  led.forEach(r => { const k = r.date.slice(0, 7); const o = mon[k] = mon[k] || { k, inc:0, exp:0 }; o.inc += r.cr; o.exp += r.dr; });
  let cum = 0;
  const monList = Object.values(mon).sort((a, b) => a.k.localeCompare(b.k)).map(r => { cum += r.inc - r.exp; return { ...r, net:r.inc - r.exp, cum }; });
  const work = [...S.d.work].sort((a, b) => a.date.localeCompare(b.date));
  const wMon = {}, wProd = {}, wDays = new Set();
  work.forEach(x => { const k = x.date.slice(0, 7); const o = wMon[k] = wMon[k] || { k, n:0, days:new Set() }; o.n++; o.days.add(x.date); wDays.add(x.date);
    const p = (x.product || '').trim(); if (p) wProd[p] = (wProd[p] || 0) + 1; });
  const wMonList = Object.values(wMon).sort((a, b) => a.k.localeCompare(b.k)).map(o => ({ k:o.k, n:o.n, days:o.days.size }));
  const wProdList = Object.entries(wProd).sort((a, b) => b[1] - a[1]);
  const pw = [...(S.d.passwords || [])].sort((a, b) => (a.url || '').toLowerCase().localeCompare((b.url || '').toLowerCase()));
  const lic = [...(S.d.lic || [])].sort((a, b) => (a.endDate || '9999').localeCompare(b.endDate || '9999'));
  return { s, e, y, sts, sm, months, yt, totalDays, log, led, inc, exp, bal, catList, monList, work, wMonList, wProdList, wDays:wDays.size, pw, lic };
}

/* ---------- EXCEL helpers ---------- */
const X = { brand:'FF4F46E5', dark:'FF1E293B', soft:'FFEEF0FF', zebra:'FFF8FAFC', line:'FFD5DBE8', good:'FF16A34A', bad:'FFDC2626', mute:'FF64748B' };
const xLine = { style:'thin', color:{ argb:X.line } };
const xBorder = { top:xLine, left:xLine, bottom:xLine, right:xLine };
const xFill = argb => ({ type:'pattern', pattern:'solid', fgColor:{ argb } });
const CURX = () => (cfg().currency || '₹').replace(/"/g, '');
const XM  = () => `"${CURX()}"#,##0.00;[Red]-"${CURX()}"#,##0.00`;
const XM0 = () => `"${CURX()}"#,##0.00;[Red]-"${CURX()}"#,##0.00;"–"`;
const xDate = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? new Date(Date.UTC(+m[1], +m[2]-1, +m[3])) : (iso || ''); };
function xSheet(wb, name, cols, widths, title, sub, freezeRow, freezeCol){
  const ws = wb.addWorksheet(name, { views:[{ showGridLines:false, ...(freezeRow ? { state:'frozen', ySplit:freezeRow, xSplit:freezeCol || 0 } : {}) }] });
  widths.forEach((w, i) => ws.getColumn(i + 1).width = w);
  ws.pageSetup = { orientation:'landscape', paperSize:9, fitToPage:true, fitToWidth:1, fitToHeight:0 };
  ws.mergeCells(1, 1, 1, cols); const t = ws.getCell(1, 1);
  t.value = title; t.font = { bold:true, size:16, color:{ argb:'FFFFFFFF' } }; t.fill = xFill(X.brand); t.alignment = { vertical:'middle', indent:1 }; ws.getRow(1).height = 32;
  ws.mergeCells(2, 1, 2, cols); const u = ws.getCell(2, 1);
  u.value = sub; u.font = { size:10, color:{ argb:X.mute } }; u.alignment = { vertical:'middle', indent:1, wrapText:true }; ws.getRow(2).height = 22;
  return ws;
}
function xHead(ws, r, labels){
  const row = ws.getRow(r); row.height = 26;
  labels.forEach((l, i) => { const c = row.getCell(i + 1); c.value = l; c.font = { bold:true, color:{ argb:'FFFFFFFF' } }; c.fill = xFill(X.dark);
    c.alignment = { horizontal:'center', vertical:'middle', wrapText:true }; c.border = xBorder; });
}
function xCell(c, v, o = {}){
  c.value = v; c.border = xBorder;
  if (o.fmt) c.numFmt = o.fmt;
  c.alignment = { vertical:'middle', horizontal:o.h, wrapText:!!o.wrap, indent:o.h === 'left' ? 1 : 0 };
  const f = { size:10.5 }; if (o.bold) f.bold = true; if (o.color) f.color = { argb:o.color }; c.font = f;
  if (o.fill) c.fill = xFill(o.fill);
}
function xTitleRow(ws, r, cols, text){
  ws.mergeCells(r, 1, r, cols); const c = ws.getCell(r, 1); c.value = text;
  c.font = { bold:true, size:12, color:{ argb:X.brand } }; c.alignment = { vertical:'middle' }; ws.getRow(r).height = 24;
}
const who = d => `Employee: ${d.e.name || d.s.username || '-'}${d.e.designation ? '  |  ' + d.e.designation : ''}`;

/* ---------- EXCEL: attendance ---------- */
function xlAttSummary(wb, d){
  const n = d.sts.length, cols = 4 + n;
  const ws = xSheet(wb, 'Attendance Summary', cols, [16, ...d.sts.map(() => 15), 14, 12, 20],
    `KS — Attendance Report ${d.y}`, `${who(d)}  |  Monthly salary: ${CURX()} ${Number(d.e.salary || 0).toLocaleString('en-IN')}  |  Generated ${STAMP()}`);
  ws.mergeCells(4, 1, 4, cols); const g = ws.getCell(4, 1);
  g.value = 'Year at a glance:   ' + [...d.sts.map(x => `${x.label}: ${d.yt.counts[x.code] || 0} days`), `Not marked: ${d.totalDays - d.yt.marked} days`].join('   •   ');
  g.font = { bold:true, size:11, color:{ argb:X.dark } }; g.fill = xFill(X.soft); g.alignment = { vertical:'middle', wrapText:true, indent:1 }; ws.getRow(4).height = 38;
  const hr = 6; xHead(ws, hr, ['Month', ...d.sts.map(x => `${x.label} (${x.code})`), 'Days marked', 'Paid days', 'Salary earned']);
  d.months.forEach((mo, i) => {
    const row = ws.getRow(hr + 1 + i), z = i % 2 ? X.zebra : null;
    xCell(row.getCell(1), mo.nm, { h:'left', bold:true, fill:z });
    d.sts.forEach((x, k) => xCell(row.getCell(2 + k), mo.st.counts[x.code] || 0, { h:'center', fill:z }));
    xCell(row.getCell(2 + n), mo.st.marked, { h:'center', fill:z });
    xCell(row.getCell(3 + n), mo.st.paid, { h:'center', fill:z, fmt:'0.##' });
    xCell(row.getCell(4 + n), mo.st.earned, { h:'right', fill:z, fmt:XM() });
  });
  const tr = hr + 13, row = ws.getRow(tr), totals = [...d.sts.map(x => d.yt.counts[x.code] || 0), d.yt.marked, d.yt.paid, d.yt.earned];
  xCell(row.getCell(1), 'Total', { h:'left', bold:true, fill:X.soft });
  totals.forEach((v, k) => { const col = k + 2, L = ws.getColumn(col).letter;
    xCell(row.getCell(col), { formula:`SUM(${L}${hr + 1}:${L}${hr + 12})`, result:v }, { h:col === cols ? 'right' : 'center', bold:true, fill:X.soft, fmt:col === cols ? XM() : (col === cols - 1 ? '0.##' : undefined) }); });
  row.height = 24;
}
function xlAttRegister(wb, d){
  const n = d.sts.length, cols = 1 + 31 + n + 1;
  const ws = xSheet(wb, 'Attendance Register', cols, [14, ...Array(31).fill(4.4), ...d.sts.map(() => 6), 10],
    `KS — Attendance Register ${d.y}`, `${who(d)}  |  Generated ${STAMP()}`, 4, 1);
  xHead(ws, 4, ['Month', ...Array.from({ length:31 }, (_, i) => i + 1), ...d.sts.map(x => x.code), 'Paid']);
  d.months.forEach((mo, i) => {
    const row = ws.getRow(5 + i);
    xCell(row.getCell(1), mo.nm, { h:'left', bold:true });
    mo.cells.forEach((v, k) => { const c = row.getCell(2 + k);
      if (v === null) xCell(c, null, { fill:'FFF1F5F9' });
      else { const s = d.sm[v]; xCell(c, v, { h:'center', bold:true, fill:s ? hexArgb(s.color) : null, color:s ? (isDark(s.color) ? 'FFFFFFFF' : 'FF0F172A') : null }); } });
    d.sts.forEach((x, k) => xCell(row.getCell(33 + k), mo.st.counts[x.code] || 0, { h:'center', bold:true, fill:X.soft }));
    xCell(row.getCell(33 + n), mo.st.paid, { h:'center', bold:true, fill:X.soft, fmt:'0.##' });
    row.height = 22;
  });
  ws.mergeCells(18, 1, 18, cols); const lg = ws.getCell(18, 1);
  lg.value = 'Legend:   ' + d.sts.map(x => `${x.code} = ${x.label}`).join('     '); lg.font = { size:10, color:{ argb:X.mute } }; lg.alignment = { indent:1 };
}
function xlAttLog(wb, d){
  const ws = xSheet(wb, 'Attendance Log', 4, [16, 10, 10, 22], `KS — Day-wise Attendance ${d.y}`, `${who(d)}  |  ${d.log.length} days marked  |  Generated ${STAMP()}`, 4);
  xHead(ws, 4, ['Date', 'Day', 'Status', 'Meaning']);
  d.log.forEach((x, i) => { const row = ws.getRow(5 + i), z = i % 2 ? X.zebra : null, s = d.sm[x.code];
    xCell(row.getCell(1), xDate(x.date), { h:'left', fill:z, fmt:'dd-mmm-yyyy' });
    xCell(row.getCell(2), dayName(x.date), { h:'center', fill:z });
    xCell(row.getCell(3), x.code, { h:'center', bold:true, fill:s ? hexArgb(s.color) : z, color:s && isDark(s.color) ? 'FFFFFFFF' : 'FF0F172A' });
    xCell(row.getCell(4), x.label, { h:'left', fill:z }); });
  if (d.log.length) ws.autoFilter = { from:'A4', to:`D${4 + d.log.length}` };
}

/* ---------- EXCEL: ledger ---------- */
function xlLedger(wb, d){
  const ws = xSheet(wb, 'Expense Ledger', 6, [14, 24, 42, 18, 18, 18], 'KS — Ledger: Income & Expenses',
    `All records  |  ${d.led.length} entries  |  Generated ${STAMP()}`, 7);
  const n = d.led.length, t = 9 + n;
  [[1, 2, 'TOTAL INCOME (IN)', `D${t}`, d.inc, X.good], [3, 4, 'TOTAL EXPENSES (OUT)', `E${t}`, d.exp, X.bad], [5, 6, 'BALANCE LEFT', `F${t}`, d.bal, X.brand]].forEach(([c1, c2, lab, ref, val, col]) => {
    ws.mergeCells(4, c1, 4, c2); ws.mergeCells(5, c1, 5, c2);
    const a = ws.getCell(4, c1); a.value = lab; a.font = { bold:true, size:9, color:{ argb:X.mute } }; a.fill = xFill(X.soft); a.alignment = { horizontal:'center', vertical:'middle' };
    const b = ws.getCell(5, c1); b.value = { formula:ref, result:val }; b.numFmt = XM(); b.font = { bold:true, size:16, color:{ argb:col } }; b.fill = xFill(X.soft); b.alignment = { horizontal:'center', vertical:'middle' };
  });
  ws.getRow(4).height = 20; ws.getRow(5).height = 34;
  xHead(ws, 7, ['Date', 'Category', 'Note', 'Income (In)', 'Expense (Out)', 'Balance']);
  const op = ws.getRow(8);
  ['', 'Opening Balance', '', 0, 0, 0].forEach((v, i) => xCell(op.getCell(i + 1), v, { h:i >= 3 ? 'right' : 'left', bold:true, fill:X.soft, fmt:i === 5 ? XM() : XM0() }));
  d.led.forEach((x, i) => { const r = 9 + i, row = ws.getRow(r), z = i % 2 ? X.zebra : null;
    xCell(row.getCell(1), xDate(x.date), { h:'left', fill:z, fmt:'dd-mmm-yyyy' });
    xCell(row.getCell(2), x.category, { h:'left', fill:z });
    xCell(row.getCell(3), x.note, { h:'left', fill:z, wrap:true });
    xCell(row.getCell(4), x.cr, { h:'right', fill:z, fmt:XM0(), color:X.good });
    xCell(row.getCell(5), x.dr, { h:'right', fill:z, fmt:XM0(), color:X.bad });
    xCell(row.getCell(6), { formula:`F${r - 1}+D${r}-E${r}`, result:x.bal }, { h:'right', fill:z, fmt:XM(), bold:true }); });
  const tot = ws.getRow(t); tot.height = 26;
  xCell(tot.getCell(1), '', { fill:X.soft }); xCell(tot.getCell(2), 'Total / Closing Balance', { h:'left', bold:true, fill:X.soft }); xCell(tot.getCell(3), '', { fill:X.soft });
  xCell(tot.getCell(4), { formula:`SUM(D8:D${t - 1})`, result:d.inc }, { h:'right', bold:true, fill:X.soft, fmt:XM() });
  xCell(tot.getCell(5), { formula:`SUM(E8:E${t - 1})`, result:d.exp }, { h:'right', bold:true, fill:X.soft, fmt:XM() });
  xCell(tot.getCell(6), { formula:`D${t}-E${t}`, result:d.bal }, { h:'right', bold:true, fill:X.soft, fmt:XM() });
}
function xlLedgerSummary(wb, d){
  const ws = xSheet(wb, 'Ledger Summary', 5, [22, 26, 18, 18, 20], 'KS — Ledger Summary', `Income vs expenses  |  Generated ${STAMP()}`);
  let r = 4; xTitleRow(ws, r++, 5, 'By category');
  xHead(ws, r++, ['Type', 'Category', 'Entries', 'Total']);
  if (!d.catList.length) { xCell(ws.getRow(r).getCell(1), 'No entries yet', { h:'left' }); r++; }
  d.catList.forEach((x, i) => { const row = ws.getRow(r++), z = i % 2 ? X.zebra : null;
    xCell(row.getCell(1), x.type === 'Income' ? 'Income (In)' : 'Expense (Out)', { h:'left', fill:z, color:x.type === 'Income' ? X.good : X.bad, bold:true });
    xCell(row.getCell(2), x.category, { h:'left', fill:z }); xCell(row.getCell(3), x.n, { h:'center', fill:z }); xCell(row.getCell(4), x.total, { h:'right', fill:z, fmt:XM() }); });
  r += 2; xTitleRow(ws, r++, 5, 'By month');
  xHead(ws, r++, ['Month', 'Income (In)', 'Expense (Out)', 'Net', 'Closing balance']);
  d.monList.forEach((x, i) => { const row = ws.getRow(r++), z = i % 2 ? X.zebra : null;
    xCell(row.getCell(1), monLabel(x.k), { h:'left', bold:true, fill:z }); xCell(row.getCell(2), x.inc, { h:'right', fill:z, fmt:XM0(), color:X.good });
    xCell(row.getCell(3), x.exp, { h:'right', fill:z, fmt:XM0(), color:X.bad }); xCell(row.getCell(4), x.net, { h:'right', fill:z, fmt:XM() });
    xCell(row.getCell(5), x.cum, { h:'right', fill:z, fmt:XM(), bold:true }); });
}

/* ---------- EXCEL: work ---------- */
function xlWork(wb, d){
  const ws = xSheet(wb, 'Work Record', 7, [14, 9, 22, 26, 18, 14, 48], 'KS — Daily Work Record', `${d.work.length} entries  |  Generated ${STAMP()}`, 4);
  xHead(ws, 4, ['Date', 'Day', 'Name', 'Product Name', 'Product No.', 'Sticker', 'Description']);
  d.work.forEach((x, i) => { const row = ws.getRow(5 + i), z = i % 2 ? X.zebra : null;
    xCell(row.getCell(1), xDate(x.date), { h:'left', fill:z, fmt:'dd-mmm-yyyy' }); xCell(row.getCell(2), dayName(x.date), { h:'center', fill:z });
    xCell(row.getCell(3), x.name, { h:'left', fill:z }); xCell(row.getCell(4), x.product, { h:'left', fill:z });
    xCell(row.getCell(5), x.number, { h:'left', fill:z }); xCell(row.getCell(6), x.sticker, { h:'left', fill:z }); xCell(row.getCell(7), x.desc, { h:'left', fill:z, wrap:true }); });
  if (d.work.length) ws.autoFilter = { from:'A4', to:`G${4 + d.work.length}` };
}
function xlWorkSummary(wb, d){
  const ws = xSheet(wb, 'Work Summary', 3, [26, 16, 18], 'KS — Work Summary', `${d.work.length} entries on ${d.wDays} days  |  Generated ${STAMP()}`);
  let r = 4; xTitleRow(ws, r++, 3, 'By month'); xHead(ws, r++, ['Month', 'Entries', 'Days with work']);
  d.wMonList.forEach((x, i) => { const row = ws.getRow(r++), z = i % 2 ? X.zebra : null;
    xCell(row.getCell(1), monLabel(x.k), { h:'left', bold:true, fill:z }); xCell(row.getCell(2), x.n, { h:'center', fill:z }); xCell(row.getCell(3), x.days, { h:'center', fill:z }); });
  r += 2; xTitleRow(ws, r++, 3, 'By product'); xHead(ws, r++, ['Product', 'Entries', '']);
  d.wProdList.forEach(([p, n], i) => { const row = ws.getRow(r++), z = i % 2 ? X.zebra : null;
    xCell(row.getCell(1), p, { h:'left', fill:z }); xCell(row.getCell(2), n, { h:'center', fill:z }); xCell(row.getCell(3), '', { fill:z }); });
}

/* ---------- PDF helpers ---------- */
const PT = v => String(v ?? '').replace(/[^\x00-\xFF]/g, '?');
const PM = n => { const c = cfg().currency || '₹'; return (c === '₹' ? 'Rs.' : PT(c)) + ' ' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits:2, maximumFractionDigits:2 }); };
function pdfBand(P){
  const doc = P.doc, w = doc.internal.pageSize.getWidth();
  doc.setFillColor(79, 70, 229); doc.rect(0, 0, w, 20, 'F'); doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text(PT(P.title), 10, 11.5);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.text(PT(P.sub), 10, 16.5);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text('KS', w - 10, 12, { align:'right' });
  doc.setTextColor(0, 0, 0);
}
function pdfStart(P, title, sub, orient, first){ if (!first) P.doc.addPage('a4', orient); P.title = title; P.sub = sub; pdfBand(P); return 28; }
function pdfNeed(P, y, h){ const doc = P.doc; if (y + h > doc.internal.pageSize.getHeight() - 16){ doc.addPage(); pdfBand(P); return 28; } return y; }
function pdfHeading(P, y, text){ y = pdfNeed(P, y, 24); P.doc.setFont('helvetica', 'bold'); P.doc.setFontSize(11); P.doc.setTextColor(79, 70, 229); P.doc.text(PT(text), 10, y + 4); P.doc.setTextColor(0, 0, 0); return y + 7; }
function pdfBoxes(P, y, items){
  const doc = P.doc, w = doc.internal.pageSize.getWidth() - 20, gap = 4, bw = (w - gap * (items.length - 1)) / items.length;
  items.forEach((it, i) => { const x = 10 + i * (bw + gap);
    doc.setFillColor(238, 240, 255); doc.setDrawColor(213, 219, 232); doc.roundedRect(x, y, bw, 18, 2, 2, 'FD');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(100, 116, 139); doc.text(PT(it.label).toUpperCase(), x + 4, y + 6);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...(it.color || [15, 23, 42])); doc.text(PT(it.value), x + 4, y + 14); });
  doc.setTextColor(0, 0, 0); return y + 24;
}
function pdfTable(P, o){
  P.doc.autoTable({ margin:{ top:26, left:10, right:10, bottom:14 }, showFoot:'lastPage',
    styles:{ font:'helvetica', fontSize:8.5, cellPadding:2, lineColor:[213, 219, 232], lineWidth:.15, valign:'middle', textColor:[15, 23, 42] },
    headStyles:{ fillColor:[30, 41, 59], textColor:255, halign:'center', fontStyle:'bold' },
    footStyles:{ fillColor:[238, 240, 255], textColor:[30, 41, 59], fontStyle:'bold' },
    alternateRowStyles:{ fillColor:[248, 250, 252] }, didDrawPage:() => pdfBand(P), ...o });
  return P.doc.lastAutoTable.finalY;
}
function pdfFooter(doc){
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++){ doc.setPage(i); const w = doc.internal.pageSize.getWidth(), h = doc.internal.pageSize.getHeight();
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(120, 130, 145);
    doc.text(`KS  |  Generated ${STAMP()}`, 10, h - 6); doc.text(`Page ${i} of ${n}`, w - 10, h - 6, { align:'right' }); }
}

/* ---------- PDF sections ---------- */
function pdfAtt(P, d, first){
  const n = d.sts.length;
  let y = pdfStart(P, `Attendance Report ${d.y}`, `${who(d)}   |   Generated ${STAMP()}`, 'l', first);
  y = pdfBoxes(P, y, [...d.sts.slice(0, 4).map(x => ({ label:`${x.label} days`, value:String(d.yt.counts[x.code] || 0) })),
    { label:'Not marked', value:String(d.totalDays - d.yt.marked) }, { label:'Salary earned', value:PM(d.yt.earned), color:[79, 70, 229] }]);
  pdfTable(P, { startY:y,
    head:[['Month', ...d.sts.map(x => `${x.label} (${x.code})`), 'Days marked', 'Paid days', 'Salary earned']],
    body:d.months.map(mo => [mo.nm, ...d.sts.map(x => mo.st.counts[x.code] || 0), mo.st.marked, mo.st.paid, PM(mo.st.earned)]),
    foot:[['Total', ...d.sts.map(x => d.yt.counts[x.code] || 0), d.yt.marked, d.yt.paid, PM(d.yt.earned)]],
    columnStyles:{ 0:{ fontStyle:'bold', halign:'left' }, [n + 3]:{ halign:'right' } },
    didParseCell:h => { if (h.section !== 'head' && h.column.index > 0 && h.column.index < n + 3) h.cell.styles.halign = 'center'; } });

  y = pdfStart(P, `Attendance Register ${d.y}`, `${who(d)}   |   Day-wise status for every month`, 'l', false);
  const dayW = Math.min(7.1, (277 - 20 - 11 - n * 8) / 31);
  const cs = { 0:{ cellWidth:20, fontStyle:'bold', halign:'left' } };
  for (let k = 1; k <= 31; k++) cs[k] = { cellWidth:dayW, halign:'center' };
  d.sts.forEach((_, k) => cs[32 + k] = { cellWidth:8, halign:'center', fontStyle:'bold' }); cs[32 + n] = { cellWidth:11, halign:'center', fontStyle:'bold' };
  const end = pdfTable(P, { startY:y,
    head:[['Month', ...Array.from({ length:31 }, (_, i) => String(i + 1)), ...d.sts.map(x => x.code), 'Paid']],
    body:d.months.map(mo => [mo.nm, ...mo.cells.map(c => c === null ? '' : c), ...d.sts.map(x => mo.st.counts[x.code] || 0), mo.st.paid]),
    styles:{ fontSize:6.8, cellPadding:1.2 }, columnStyles:cs,
    didParseCell:h => { if (h.section === 'body' && h.column.index >= 1 && h.column.index <= 31){
      const v = d.months[h.row.index].cells[h.column.index - 1];
      if (v === null) h.cell.styles.fillColor = [241, 245, 249];
      else if (d.sm[v]){ h.cell.styles.fillColor = rgbOf(d.sm[v].color); h.cell.styles.textColor = isDark(d.sm[v].color) ? [255, 255, 255] : [15, 23, 42]; h.cell.styles.fontStyle = 'bold'; } } } });
  let lx = 10; const ly = end + 8; P.doc.setFontSize(8); P.doc.setFont('helvetica', 'normal');
  d.sts.forEach(x => { P.doc.setFillColor(...rgbOf(x.color)); P.doc.setDrawColor(150, 160, 175); P.doc.rect(lx, ly - 3.2, 4.5, 4.5, 'FD'); P.doc.setTextColor(15, 23, 42);
    const t = `${x.code} = ${x.label}`; P.doc.text(PT(t), lx + 6.5, ly + .4); lx += 12 + P.doc.getTextWidth(PT(t)); });
}
function pdfLedger(P, d, first){
  let y = pdfStart(P, 'Ledger: Income & Expenses', `All records   |   ${d.led.length} entries   |   Generated ${STAMP()}`, 'p', first);
  y = pdfBoxes(P, y, [{ label:'Total income (in)', value:PM(d.inc), color:[22, 163, 74] }, { label:'Total expenses (out)', value:PM(d.exp), color:[220, 38, 38] }, { label:'Balance left', value:PM(d.bal), color:[79, 70, 229] }]);
  y = pdfTable(P, { startY:y,
    head:[['Date', 'Category', 'Note', 'Income (In)', 'Expense (Out)', 'Balance']],
    body:[['', 'Opening Balance', '', '-', '-', PM(0)], ...d.led.map(x => [fmtDateNice(x.date), x.category, x.note, x.cr ? PM(x.cr) : '-', x.dr ? PM(x.dr) : '-', PM(x.bal)])].map(r => r.map(PT)),
    foot:[['', 'Total / Closing', '', PM(d.inc), PM(d.exp), PM(d.bal)]],
    styles:{ fontSize:8 }, columnStyles:{ 0:{ cellWidth:24 }, 1:{ cellWidth:30 }, 3:{ halign:'right', cellWidth:28 }, 4:{ halign:'right', cellWidth:28 }, 5:{ halign:'right', cellWidth:28, fontStyle:'bold' } },
    didParseCell:h => { if (h.section === 'body' && h.row.index > 0){ if (h.column.index === 3) h.cell.styles.textColor = [22, 163, 74]; if (h.column.index === 4) h.cell.styles.textColor = [220, 38, 38]; } if (h.section !== 'head' && [3, 4, 5].includes(h.column.index)) h.cell.styles.halign = 'right'; } });
  y = pdfHeading(P, y + 8, 'Summary by category');
  y = pdfTable(P, { startY:y, head:[['Type', 'Category', 'Entries', 'Total']],
    body:d.catList.map(x => [x.type === 'Income' ? 'Income (In)' : 'Expense (Out)', x.category, x.n, PM(x.total)].map(PT)),
    columnStyles:{ 2:{ halign:'center' }, 3:{ halign:'right' } }, didParseCell:h => { if (h.section === 'body' && h.column.index === 0) h.cell.styles.textColor = d.catList[h.row.index].type === 'Income' ? [22, 163, 74] : [220, 38, 38]; } });
  y = pdfHeading(P, y + 8, 'Summary by month');
  pdfTable(P, { startY:y, head:[['Month', 'Income (In)', 'Expense (Out)', 'Net', 'Closing balance']],
    body:d.monList.map(x => [monLabel(x.k), PM(x.inc), PM(x.exp), PM(x.net), PM(x.cum)]),
    columnStyles:{ 1:{ halign:'right' }, 2:{ halign:'right' }, 3:{ halign:'right' }, 4:{ halign:'right', fontStyle:'bold' } } });
}
function pdfWork(P, d, first){
  let y = pdfStart(P, 'Daily Work Record', `${d.work.length} entries   |   Generated ${STAMP()}`, 'l', first);
  y = pdfBoxes(P, y, [{ label:'Total entries', value:String(d.work.length) }, { label:'Days with work', value:String(d.wDays) }, { label:'Different products', value:String(d.wProdList.length) }]);
  pdfTable(P, { startY:y, head:[['Date', 'Day', 'Name', 'Product Name', 'Product No.', 'Sticker', 'Description']],
    body:d.work.map(x => [fmtDateNice(x.date), dayName(x.date), x.name, x.product, x.number, x.sticker, x.desc].map(PT)),
    styles:{ fontSize:8 }, columnStyles:{ 0:{ cellWidth:25 }, 1:{ cellWidth:12, halign:'center' }, 2:{ cellWidth:34 }, 3:{ cellWidth:40 }, 4:{ cellWidth:28 }, 5:{ cellWidth:22 } } });
}

/* ---------- EXCEL + PDF: passwords ---------- */
function xlPasswords(wb, d){
  const ws = xSheet(wb, 'Passwords', 4, [6, 46, 34, 32], 'KS — Password Manager', `${d.pw.length} logins  |  Generated ${STAMP()}  |  Keep this file safe`, 4);
  xHead(ws, 4, ['#', 'Website URL', 'User ID', 'Password']);
  d.pw.forEach((x, i) => { const row = ws.getRow(5 + i), z = i % 2 ? X.zebra : null, href = pwHref(x.url);
    xCell(row.getCell(1), i + 1, { h:'center', fill:z });
    xCell(row.getCell(2), x.url, { h:'left', fill:z });
    if (href && x.url){ const c = row.getCell(2); c.value = { text:x.url, hyperlink:href }; c.font = { size:10.5, color:{ argb:'FF2563EB' }, underline:true }; }
    xCell(row.getCell(3), x.user, { h:'left', fill:z, fmt:'@' });
    xCell(row.getCell(4), x.pass, { h:'left', fill:z, fmt:'@' }); });
  if (d.pw.length) ws.autoFilter = { from:'A4', to:`D${4 + d.pw.length}` };
}
function pdfPasswords(P, d, first){
  const y = pdfStart(P, 'Password Manager', `${d.pw.length} logins   |   Generated ${STAMP()}   |   Keep this file safe`, 'l', first);
  pdfTable(P, { startY:y, head:[['#', 'Website URL', 'User ID', 'Password']],
    body:d.pw.map((x, i) => [i + 1, x.url, x.user, x.pass].map(PT)),
    styles:{ fontSize:9 }, columnStyles:{ 0:{ cellWidth:12, halign:'center' }, 1:{ cellWidth:95 }, 2:{ cellWidth:80 }, 3:{ cellWidth:80 } } });
}
function licStatusPlain(endDate){ return licCountdown(endDate).status || '—'; }
function xlLic(wb, d){
  const fx = S.d.licFields || [], cols = 14 + fx.length;
  const ws = xSheet(wb, 'LIC Policies', cols, [5, 24, 18, 22, 14, 16, 22, 16, 12, 12, 12, 14, 12, 16, ...fx.map(() => 20)], 'KS — LIC Policies', `${d.lic.length} policies  |  Generated ${STAMP()}`, 4);
  xHead(ws, 4, ['#', 'Customer Name', 'Policy Number', 'Policy Name', 'Premium Amount', 'Total Policy Amount', 'Nominee', 'Customer Mobile', 'Premium Mode', 'Starting Date', 'Ending Date', 'Next Renewal', 'Status', 'Pay per Year', ...fx]);
  d.lic.forEach((x, i) => { const row = ws.getRow(5 + i), z = i % 2 ? X.zebra : null, rn = licRenewInfo(x);
    xCell(row.getCell(1), i + 1, { h:'center', fill:z });
    xCell(row.getCell(2), x.name, { h:'left', fill:z });
    xCell(row.getCell(3), x.policyNo, { h:'left', fill:z, fmt:'@' });
    xCell(row.getCell(4), x.policyName || '', { h:'left', fill:z });
    xCell(row.getCell(5), x.amount, { h:'right', fill:z, fmt:XM() });
    xCell(row.getCell(6), x.totalAmount, { h:'right', fill:z, fmt:XM() });
    xCell(row.getCell(7), x.nominee || '', { h:'left', fill:z });
    xCell(row.getCell(8), x.phone || '', { h:'left', fill:z, fmt:'@' });
    xCell(row.getCell(9), LIC_FREQ[x.freq] || 'One-time', { h:'left', fill:z });
    xCell(row.getCell(10), xDate(x.startDate), { h:'left', fill:z, fmt:x.startDate ? 'dd-mmm-yyyy' : '@' });
    xCell(row.getCell(11), xDate(x.endDate), { h:'left', fill:z, fmt:x.endDate ? 'dd-mmm-yyyy' : '@' });
    xCell(row.getCell(12), rn.due ? xDate(rn.due) : '—', { h:'left', fill:z, fmt:rn.due ? 'dd-mmm-yyyy' : '@' });
    const st = licStatusPlain(x.endDate);
    xCell(row.getCell(13), st, { h:'center', fill:z, bold:true, color:st === 'Expired' ? X.bad : st === 'Expiring soon' ? 'FFB45309' : X.good });
    xCell(row.getCell(14), licYearly(x) || (x.freq ? '' : 'One-time'), { h:'right', fill:z, fmt:XM() });
    fx.forEach((n, k) => xCell(row.getCell(15 + k), (x.extra || {})[n] || '', { h:'left', fill:z })); });
  const endCol = (n => { let t = ''; while (n > 0){ const m = (n - 1) % 26; t = String.fromCharCode(65 + m) + t; n = Math.floor((n - 1) / 26); } return t; })(14 + fx.length);
  if (d.lic.length) ws.autoFilter = { from:'A4', to:`${endCol}${4 + d.lic.length}` };
}
function pdfLic(P, d, first){
  const fx = S.d.licFields || [];
  const y = pdfStart(P, 'LIC Policies', `${d.lic.length} policies   |   Generated ${STAMP()}`, 'l', first);
  pdfTable(P, { startY:y, head:[['#', 'Customer Name', 'Policy No.', 'Policy Name', 'Premium', 'Total Policy Amt', 'Nominee', 'Mobile', 'Mode', 'Per Year', 'Start', 'End', 'Next Renewal', 'Status', ...(fx.length ? ['More details'] : [])]],
    body:d.lic.map((x, i) => { const rn = licRenewInfo(x); return [i + 1, x.name, x.policyNo, x.policyName || '—', x.amount ? PM(x.amount) : '—', x.totalAmount ? PM(x.totalAmount) : '—', x.nominee || '—', x.phone || '—', LIC_FREQ[x.freq] || 'One-time', licYearly(x) ? PM(licYearly(x)) : '—', x.startDate || '—', x.endDate || '—', rn.due || '—', licStatusPlain(x.endDate), ...(fx.length ? [fx.filter(n => (x.extra || {})[n]).map(n => n + ': ' + x.extra[n]).join('; ') || '—'] : [])].map(PT); }),
    styles:{ fontSize:6.5, cellPadding:1.4 }, columnStyles:{ 0:{ halign:'center', cellWidth:7 }, 4:{ halign:'right' }, 5:{ halign:'right' }, 9:{ halign:'right' }, 13:{ halign:'center' } } });
}

/* ---------- entry point ---------- */
async function doExport(kind, fmt){
  if (S.exBusy) return; S.exBusy = true;
  toast('Preparing your ' + (fmt === 'pdf' ? 'PDF' : 'Excel') + ' file…');
  try{
    const d = exPrep(), names = { att:`KS-attendance-${(d.e.name || 'employee').replace(/[^\w\u0900-\u097F-]+/g,'_')}-${d.y}`, exp:'KS-expense-ledger', work:'KS-work-record', pw:'KS-passwords', lic:'KS-lic-policies', all:'KS-all-data' };
    const PP = perms(), inc = { att:(kind === 'att' || kind === 'all') && PP.att !== 'none', exp:(kind === 'exp' || kind === 'all') && PP.exp !== 'none', work:(kind === 'work' || kind === 'all') && PP.work !== 'none' };
    if (!inc.att && !inc.exp && !inc.work && kind !== 'pw' && kind !== 'lic'){ toast('Nothing to export for your account', true); return; }
    if (fmt === 'pdf'){
      await needPdf();
      const P = { doc:new window.jspdf.jsPDF({ orientation:(inc.att ? 'l' : inc.exp ? 'p' : 'l'), unit:'mm', format:'a4' }) };
      let first = true;
      if (inc.att){ pdfAtt(P, d, first); first = false; }
      if (inc.exp){ pdfLedger(P, d, first); first = false; }
      if (inc.work){ pdfWork(P, d, first); first = false; }
      if (kind === 'pw'){ pdfPasswords(P, d, first); first = false; }
      if (kind === 'lic'){ pdfLic(P, d, first); first = false; }
      pdfFooter(P.doc); saveBlob(names[kind] + '.pdf', P.doc.output('blob'));
    } else {
      await needExcel();
      const wb = new window.ExcelJS.Workbook(); wb.creator = 'KS'; wb.created = new Date();
      if (inc.att){ xlAttSummary(wb, d); xlAttRegister(wb, d); xlAttLog(wb, d); }
      if (inc.exp){ xlLedger(wb, d); xlLedgerSummary(wb, d); }
      if (inc.work){ xlWork(wb, d); xlWorkSummary(wb, d); }
      if (kind === 'pw') xlPasswords(wb, d);
      if (kind === 'lic') xlLic(wb, d);
      const buf = await wb.xlsx.writeBuffer();
      saveBlob(names[kind] + '.xlsx', new Blob([buf], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    }
    toast('Download ready ✔');
  }catch(e){ console.error(e); toast((e && e.message) || 'Export failed', true); }
  finally{ S.exBusy = false; }
}


/* ---------- add the "Passwords" tab to the menu (copies the look of the Work tab) ---------- */
(function addPasswordsTab(){
  const nav = $('#nav'), src = nav && nav.querySelector('[data-v="work"]');
  if (!src || nav.querySelector('[data-v="passwords"]')) return;
  const b = src.cloneNode(true);
  b.dataset.v = 'passwords'; b.classList.remove('active', 'hidden');
  const ic = b.querySelector('svg, img, i');
  if (ic){ const sp = document.createElement('span'); sp.textContent = '🔑'; ic.replaceWith(sp); }
  const tn = []; const tw = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
  while (tw.nextNode()) if (tw.currentNode.nodeValue.trim()) tn.push(tw.currentNode);
  if (ic){ if (tn.length) tn[tn.length - 1].nodeValue = 'Passwords'; else b.append(' Passwords'); }
  else if (tn.length >= 2){ tn[0].nodeValue = '🔑'; tn[tn.length - 1].nodeValue = 'Passwords'; }
  else if (tn.length === 1) tn[0].nodeValue = '🔑 Passwords';
  else b.textContent = '🔑 Passwords';
  (nav.querySelector('[data-v="timetable"]') || src).after(b);
})();

/* ---------- add the "Links" tab to the menu (right after Passwords) ---------- */
(function addLinksTab(){
  const nav = $('#nav'), src = nav && nav.querySelector('[data-v="passwords"]');
  if (!src || nav.querySelector('[data-v="links"]')) return;
  const b = src.cloneNode(true);
  b.dataset.v = 'links'; b.classList.remove('active', 'hidden');
  const tw = document.createTreeWalker(b, NodeFilter.SHOW_TEXT), tn = [];
  while (tw.nextNode()) if (tw.currentNode.nodeValue.trim()) tn.push(tw.currentNode);
  tn.forEach(n => { n.nodeValue = n.nodeValue.replace('🔑', '🔗').replace('Passwords', 'Links'); });
  src.after(b);
})();

/* ---------- add the "LIC" tab to the menu, right above Settings ---------- */
(function addLicTab(){
  const nav = $('#nav'), src = nav && nav.querySelector('[data-v="updates"]');
  if (!src || nav.querySelector('[data-v="lic"]')) return;
  const b = src.cloneNode(true);
  b.dataset.v = 'lic'; b.classList.remove('active', 'hidden');
  const ic = b.querySelector('svg, img, i');
  if (ic){ const sp = document.createElement('span'); sp.textContent = '📄'; ic.replaceWith(sp); }
  const tn = []; const tw = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
  while (tw.nextNode()) if (tw.currentNode.nodeValue.trim()) tn.push(tw.currentNode);
  if (ic){ if (tn.length) tn[tn.length - 1].nodeValue = 'LIC'; else b.append(' LIC'); }
  else if (tn.length >= 2){ tn[0].nodeValue = '📄'; tn[tn.length - 1].nodeValue = 'LIC'; }
  else if (tn.length === 1) tn[0].nodeValue = '📄 LIC';
  else b.textContent = '📄 LIC';
  src.after(b);     // right after "Updates" = right above "Settings"
})();

thApply();        // the Passwords / Links / LIC tabs now exist: put them in the saved order / names
boot();

/* =====================================================================
   VIEW: CHAT  (WhatsApp-style messaging: user list -> tap -> conversation, online / offline + last seen)
   ===================================================================== */
const chatFresh = () => ({ users:[], groups:[], loaded:false, with:null, msgs:{}, peerRead:{}, peerSeen:{}, drafts:{}, unread:0, q:'', n:0, fetching:false, loadingUsers:false, err:'', sig:'', histLoaded:{}, sel:new Set(), ov:{}, tr:{}, trFail:{}, trBusy:{}, mu:{}, mBusy:{}, gs:{}, rp:{}, ed:{}, eb:{}, defer:false, trv:0, lang:(function(){ try{ return localStorage.getItem('ks_chat_lang_v1') || ''; }catch(e){ return ''; } })() });
S.chat = chatFresh();
let chatTimer = null;
function chatReset(){ clearInterval(chatTimer); chatTimer = null; clearInterval(chatLiveT); chatLiveT = null; S.chat = chatFresh(); AV = {}; try{ localStorage.removeItem('ks_av_v1'); }catch(e){} document.body.classList.remove('chat-conv'); chatBadge(); }
/* Keep the open chat exactly as tall as the VISIBLE screen: when the phone keyboard opens the screen no longer gets cut / pushed up. */
(function chatKeyboardFit(){
  const vv = window.visualViewport, root = document.documentElement;
  const fit = () => {
    const h = vv ? vv.height : window.innerHeight, t = vv ? vv.offsetTop : 0;
    root.style.setProperty('--vvh', Math.round(h) + 'px'); root.style.setProperty('--vvt', Math.round(t) + 'px');
    document.body.classList.toggle('kb-open', !!vv && window.innerHeight - vv.height > 120);
    if (document.body.classList.contains('chat-conv')){
      if (window.scrollY) window.scrollTo(0, 0);                       // the browser sometimes scrolls the page itself when the keyboard opens
      const box = $('#chMsgs'); if (box && document.activeElement && document.activeElement.id === 'chInput') box.scrollTop = box.scrollHeight;
    }
  };
  if (vv){ vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); }
  window.addEventListener('resize', fit); window.addEventListener('orientationchange', () => setTimeout(fit, 250));
  document.addEventListener('focusin', e => { if (e.target && e.target.id === 'chInput') setTimeout(fit, 120); });
  document.addEventListener('focusout', e => { if (e.target && e.target.id === 'chInput') setTimeout(fit, 200); });
  fit();
})();
function chatStart(){
  clearInterval(chatTimer);
  chatLoadUsers();                                    // also tells the server "I am online"
  chatTimer = setInterval(chatTick, 4000);
  clearInterval(chatLiveT); chatLiveT = setInterval(chatLivePoll, 1500);      // fast lane: new messages + ticks of the open chat
}
/* silent request (no top progress bar) — used for polling and sending */
async function chatApi(action, payload = {}){
  const j = await callServer({ action, token:S.token, ...payload });
  if (!j.ok){ const e = new Error(j.error || 'Request failed'); e.code = j.code; throw e; }
  return j;
}
function chatErr(e){ if (e && (e.code === 'AUTH' || e.code === 'PAYDUE')) handleErr(e); }
const chatPeer = id => S.chat.users.find(u => u.id === id) || S.chat.groups.find(g => g.id === id);
function chatBadge(){
  const b = $('#chatBadge'); if (!b) return;
  const n = S.chat.unread || 0;
  b.textContent = n > 99 ? '99+' : n; b.classList.toggle('hidden', n < 1);
}
function chatSumUnread(){ S.chat.unread = S.chat.users.concat(S.chat.groups).reduce((a, u) => a + (u.unread || 0), 0); chatBadge(); }

/* "5 min ago" style text (the server sends how long ago, so a wrong phone clock does not matter) */
function chatAgo(u){
  if (u.ago === null || u.ago === undefined) return null;
  const ms = u.ago + (Date.now() - (u.at || Date.now())), m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' hr' + (m % 60 ? ' ' + (m % 60) + ' min' : '') + ' ago';
  const d = Math.floor(h / 24);
  return d + (d === 1 ? ' day ago' : ' days ago');
}
function chatStatus(u){
  if (u.isGroup) return { cls:'grp', txt:(u.members || []).map(m => m.name).join(', ') || 'Group' };
  if (u.online) return { cls:'on', txt:'Online' };
  const a = chatAgo(u);
  return { cls:'off', txt: a ? 'Offline · last seen ' + a : 'Offline' };
}
const CH_COL = ['#6366f1','#0ea5e9','#10b981','#f59e0b','#ec4899','#8b5cf6','#14b8a6','#ef4444','#64748b','#84cc16'];
const chColor = id => CH_COL[[...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % CH_COL.length];
const chInit = u => u.isGroup ? '👥' : (avSrc(u.id) ? `<img class="ch-img" alt="" src="${esc(avSrc(u.id))}">` : '') + esc((u.name || u.username || '?').trim().charAt(0).toUpperCase());
async function chatSyncAv(users, me, mePv){
  const list = users.map(u => ({ id:u.id, pv:u.pv || 0 })); if (me) list.push({ id:me, pv:mePv || 0 });
  let changed = false; const need = [];
  list.forEach(o => {
    if (!o.pv){ if (AV[o.id]){ delete AV[o.id]; changed = true; } }
    else if (!AV[o.id] || AV[o.id].v !== o.pv) need.push(o.id);
  });
  if (need.length){
    try{
      const r = await chatApi('chatPhotos', { ids:need });
      need.forEach(id => { const p = r.photos && r.photos[id]; if (p && p.src){ AV[id] = { v:p.pv, src:p.src }; changed = true; } });
    }catch(e){ chatErr(e); }
  }
  if (changed){ avSave(); if (S.view === 'chat'){ chatRenderList(); if (S.chat.with) chatRefreshHeadAv(); } refreshUser(); }
}
/* ---------- profile screen (tap the name / picture at the top of a chat) ---------- */
function chatProfile(){
  const u = chatPeer(S.chat.with); if (!u) return;
  if (u.isGroup) return groupChatForm(u.id);
  if ($('#pfView')) return;
  profileUnlock(u.id, u.name || u.username || '?', src => chatProfileShow(u, src));      // password first, then the card opens
}
function chatProfileShow(u, full){
  closeProfile();
  const st = chatStatus(u), nm = u.name || u.username || '?', pic = full || avSrc(u.id);
  const w = document.createElement('div'); w.className = 'pf-ov'; w.id = 'pfView';
  w.innerHTML = `<div class="pf-bar"><button type="button" class="pf-back" data-x aria-label="Back">←</button></div>
    <div class="pf-scroll">
      <div class="pf-pic" id="pfPic" style="background:${chColor(u.id)}">${pic ? `<img id="pfImg" alt="" src="${esc(pic)}">` : `<span>${esc(nm.trim().charAt(0).toUpperCase())}</span>`}</div>
      <div class="pf-name">${esc(nm)}</div>
      <div class="ch-stat ${st.cls}" style="text-align:center">${esc(st.txt)}</div>
      <div class="pf-acts">
        <button type="button" data-a="msg"><b>💬</b><span>Message</span></button>
        <button type="button" data-a="audio"><b>📞</b><span>Call</span></button>
        <button type="button" data-a="video"><b>🎥</b><span>Video</span></button>
      </div>
      <div class="pf-card"><div class="pf-k">Username</div><div class="pf-v">${esc(u.username || '')}</div></div>
    </div>`;
  document.body.appendChild(w);
  w.onclick = e => {
    if (e.target.closest('[data-x]')) return closeProfile();
    const b = e.target.closest('[data-a]');
    if (b){ const f = b.dataset.a; closeProfile(); if (f === 'audio') vcDial('audio'); else if (f === 'video') vcDial('video'); return; }
    if (e.target.closest('#pfPic') && pic) photoViewer(nm, pic);
  };
}
function closeProfile(){ const o = $('#pfView'); if (o) o.remove(); closePhotoViewer(); }
function closePhotoViewer(){ const o = $('#pvView'); if (o) o.remove(); }
/* a profile only opens after the person types THEIR OWN password; the server checks it and only then sends the sharp picture */
function profileUnlock(id, nm, done){
  const w = openModal(`<h3>🔒 Enter your password</h3><p class="sub">To open ${esc(nm)}’s profile, enter the password of your own account.</p>
    <div class="field"><label>Your password</label><input class="input" id="pwUnlock" type="password" autocomplete="off" autocapitalize="off" maxlength="200"></div>
    <div id="pwUnlockErr" style="color:#dc2626;font-size:calc(13px*var(--fs));min-height:18px;margin-top:6px"></div>
    <div class="actions" style="margin-top:10px"><button class="btn ghost" type="button" id="pwUnlockNo">Cancel</button><button class="btn" type="button" id="pwUnlockOk">Open profile</button></div>`);
  w.classList.add('pw-over');
  const inp = w.querySelector('#pwUnlock'), err = w.querySelector('#pwUnlockErr'), ok = w.querySelector('#pwUnlockOk');
  setTimeout(() => inp.focus(), 50);
  const go = async () => {
    const pw = inp.value; if (!pw){ err.textContent = 'Please enter your password.'; return; }
    ok.disabled = true; ok.textContent = 'Checking…'; err.textContent = '';
    try{
      const r = await chatApi('chatPhotoFull', { id, password:pw });
      w.remove(); done(r.src || avSrc(id));
    }catch(e){
      ok.disabled = false; ok.textContent = 'Open profile'; inp.value = ''; inp.focus();
      if (e && (e.code === 'AUTH' || e.code === 'PAYDUE')) { w.remove(); handleErr(e); }
      else err.textContent = (e && e.message) || 'Could not check the password.';
    }
  };
  ok.onclick = go; inp.onkeydown = e => { if (e.key === 'Enter') go(); };
  w.querySelector('#pwUnlockNo').onclick = () => w.remove();
}
function photoViewer(nm, src){
  closePhotoViewer(); if (!src) return;
  const w = document.createElement('div'); w.className = 'pv-ov'; w.id = 'pvView';
  w.innerHTML = `<div class="pv-bar"><button type="button" class="pf-back" aria-label="Close">←</button><span>${esc(nm)}</span></div><img alt="" src="${esc(src)}">`;
  w.onclick = closePhotoViewer;
  document.body.appendChild(w);
}
document.addEventListener('keydown', e => { if (e.key === 'Escape'){ if ($('#pvView')) closePhotoViewer(); else if ($('#pfView')) closeProfile(); } });

/* ---------- chat themes (each user picks their own; saved on this phone) ---------- */
const CH_THEMES = [['', 'Default', ['#efeae2', '#d9fdd3', '#ffffff']], ['dark', 'Dark', ['#0b141a', '#005c4b', '#202c33']], ['midnight', 'Midnight', ['#0a0f24', '#4f46e5', '#1a2145']],
  ['ocean', 'Ocean', ['#d7eefc', '#8fd3ff', '#ffffff']], ['forest', 'Forest', ['#e3f1e0', '#b7e4a8', '#ffffff']], ['sunset', 'Sunset', ['#ffe5d4', '#ffb88a', '#fffaf6']],
  ['rose', 'Rose', ['#fde4ee', '#f9a8c9', '#ffffff']], ['neon', 'Neon', ['#0d0221', '#8b2bff', '#1b0b3a']], ['gold', 'Royal gold', ['#1c1710', '#b8892b', '#2a2218']],
  ['leather', 'Black leather', ['#16130f', '#6b5326', '#2c2822']], ['glass', 'Gold glass', ['linear-gradient(135deg,#ecdcb9,#cfae76)', 'rgba(255,255,255,.35)', 'rgba(255,255,255,.7)']],
  ['ios', 'iPhone light', ['#ffffff', '#0a84ff', '#e9e9eb']], ['iosdark', 'iPhone dark', ['#000000', '#0a84ff', '#26262a']],
  ['aurora', 'Aurora glass', ['linear-gradient(135deg,#7c3aed,#0ea5e9 60%,#ec4899)', '#a78bfa', 'rgba(255,255,255,.35)']], ['sky', 'Sky glass', ['linear-gradient(135deg,#bfe0ff,#7cc0ff)', '#4aa8ff', 'rgba(255,255,255,.75)']],
  ['mocha', 'Mocha', ['#2b211b', '#8a5a3b', '#3a2d25']], ['amoled', 'AMOLED black', ['#000000', '#14532d', '#141414']],
  ['lavender', 'Lavender', ['#ede7fb', '#c9b6f5', '#ffffff']], ['mint', 'Mint', ['#dff5ec', '#a7e8cd', '#ffffff']], ['crimson', 'Crimson night', ['#1a0b0e', '#9f1239', '#2b1217']]];
const chThemeKey = () => 'ks_chat_theme_' + ((S.me && S.me.id) || 'x');
function chThemeGet(){ try{ return localStorage.getItem(chThemeKey()) || ''; }catch(e){ return ''; } }
function chatThemeApply(){
  const root = $('#chatRoot'); if (!root) return;
  const t = chThemeGet();
  if (t && CH_THEMES.some(x => x[0] === t)) root.setAttribute('data-cth', t); else root.removeAttribute('data-cth');
  chatCustApply(root, t);
}
/* ---------- chat theme: your own changes (accent colour, bubble style, roundness, wallpaper, blur, text) ---------- */
const chCustKey = () => 'ks_chat_thc_' + ((S.me && S.me.id) || 'x'), chWpKey = () => 'ks_chat_wp_' + ((S.me && S.me.id) || 'x');
function chCustGet(){ try{ return JSON.parse(localStorage.getItem(chCustKey()) || '{}') || {}; }catch(e){ return {}; } }
function chCustSet(o){ try{ localStorage.setItem(chCustKey(), JSON.stringify(o)); }catch(e){} }
function chWpImg(){ try{ return localStorage.getItem(chWpKey()) || ''; }catch(e){ return ''; } }
const CH_DEF = { leather:{ bs:'outline', rad:16, wp:'leather', acc:'#d6a24b' }, glass:{ bs:'outline', rad:16, wp:'marble', acc:'#c9962f' },
  ios:{ rad:18, acc:'#0a84ff' }, iosdark:{ rad:18, acc:'#0a84ff' }, aurora:{ rad:18, wp:'aurora', gl:1, acc:'#a78bfa' }, sky:{ rad:18, wp:'sky', gl:1, acc:'#2a8cf0' } };
const CH_LEATHER_SVG = encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='a'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' seed='7'/><feColorMatrix values='0 0 0 0 .85 0 0 0 0 .7 0 0 0 0 .45 0 0 0 .20 0'/></filter><filter id='b'><feTurbulence type='fractalNoise' baseFrequency='.012' numOctaves='3' seed='3'/><feColorMatrix values='0 0 0 0 .9 0 0 0 0 .75 0 0 0 0 .5 0 0 0 .16 0'/></filter><rect width='100%' height='100%' filter='url(%23a)'/><rect width='100%' height='100%' filter='url(%23b)'/></svg>");
const CH_WP = {
  marble:'linear-gradient(118deg,rgba(255,250,235,.6) 0,rgba(255,250,235,0) 26%,rgba(150,105,45,.16) 44%,rgba(255,250,235,0) 60%,rgba(150,105,45,.12) 82%,rgba(255,250,235,.4) 100%) 0 0/100% 100% no-repeat,linear-gradient(140deg,#ecdcb9,#d3b57f 52%,#e6d3a8)',
  aurora:'radial-gradient(circle at 14% 10%,rgba(168,85,247,.8),transparent 46%) 0 0/100% 100% no-repeat,radial-gradient(circle at 90% 32%,rgba(34,211,238,.62),transparent 46%) 0 0/100% 100% no-repeat,radial-gradient(circle at 38% 94%,rgba(236,72,153,.55),transparent 52%) 0 0/100% 100% no-repeat,linear-gradient(160deg,#1a1240,#0b1b3a)',
  sky:'radial-gradient(circle at 80% 8%,rgba(255,255,255,.85),transparent 40%) 0 0/100% 100% no-repeat,radial-gradient(circle at 10% 85%,rgba(120,190,255,.8),transparent 55%) 0 0/100% 100% no-repeat,linear-gradient(170deg,#cfe8ff,#8cc6ff 60%,#b9dcff)',
  sunset:'radial-gradient(circle at 85% 12%,rgba(255,214,102,.85),transparent 42%) 0 0/100% 100% no-repeat,radial-gradient(circle at 12% 88%,rgba(244,63,94,.6),transparent 52%) 0 0/100% 100% no-repeat,linear-gradient(165deg,#ff9a62,#ff5f8f 60%,#7c3aed)',
  wood:'repeating-linear-gradient(92deg,rgba(50,25,8,.14) 0 3px,rgba(0,0,0,0) 3px 12px) 0 0/100% 100%,linear-gradient(180deg,#a1703f,#7d5129 60%,#935f33)',
  leather:'radial-gradient(ellipse at 50% 25%,rgba(255,255,255,.06),rgba(0,0,0,.5) 90%) 0 0/100% 100% no-repeat,url("data:image/svg+xml;utf8,' + CH_LEATHER_SVG + '") 0 0/240px 240px repeat,#17140f'
};
function chWpCss(wp, dim){
  const dm = dim > 0 ? `linear-gradient(rgba(0,0,0,${dim / 100}),rgba(0,0,0,${dim / 100})) 0 0/100% 100% no-repeat,` : '';
  if (wp === 'photo'){ const img = chWpImg(); return img ? dm + `url("${img}") center/cover no-repeat,#000` : ''; }
  return CH_WP[wp] ? dm + CH_WP[wp] : '';
}
function chatCustApply(root, t){
  const C = chCustGet(), D = CH_DEF[t] || {};
  const set = (k, v) => { if (v === undefined || v === null || v === '') root.style.removeProperty(k); else root.style.setProperty(k, v); };
  const at = (n, v) => { if (v === undefined || v === null || v === '') root.removeAttribute(n); else root.setAttribute(n, v); };
  set('--ac', C.acc); at('data-cac', C.acc ? '1' : '');
  set('--cx', C.tx); at('data-ctx', C.tx ? '1' : '');
  const rad = C.rad !== undefined ? C.rad : D.rad;
  set('--crad', rad !== undefined ? rad + 'px' : ''); at('data-crad', rad !== undefined ? '1' : '');
  set('--cblur', (C.blur !== undefined ? C.blur : 14) + 'px');
  set('--cfs', C.fs ? String(C.fs / 100) : ''); at('data-cfs', C.fs ? '1' : '');
  at('data-cbs', C.bs || D.bs || '');
  at('data-cgl', (C.gl === 'on' || (C.gl !== 'off' && D.gl)) ? '1' : '');            // iPhone-style glass on any theme
  const val = chWpCss(C.wp || D.wp || '', C.dim || 0);
  set('--cwp', val); at('data-wp', val ? '1' : '');
}
function chatThemeCustom(){
  const t = chThemeGet(), D = CH_DEF[t] || {}, C = chCustGet();
  const seg = (k, opts) => `<div class="seg" data-ck="${k}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" class="${(C[k] || '') === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const rng = (k, label, min, max, def, unit) => `<div class="th-row"><div class="th-lbl"><span>${label}</span><b id="chc_${k}">${C[k] !== undefined ? C[k] : def}${unit}</b></div><input type="range" data-cr="${k}" data-u="${unit}" min="${min}" max="${max}" step="1" value="${C[k] !== undefined ? C[k] : def}"></div>`;
  const w = openModal(`<h3>✨ Customise chat theme</h3><p class="sub">Changes show at once and are saved on this phone. Only you see them.</p>
    <div class="th-row"><div class="th-lbl"><span>Colours</span></div><div class="th-cols">
      <label class="th-col"><input type="color" data-cc="acc" value="${C.acc || D.acc || '#22c55e'}"><span>Accent / gold</span></label>
      <label class="th-col"><input type="color" data-cc="tx" value="${C.tx || (t === 'glass' ? '#3d2a10' : (t && t !== '' ? '#f3e3c3' : '#0f172a'))}"><span>Message text</span></label></div></div>
    <div class="th-row"><div class="th-lbl"><span>🍏 iPhone glass effect</span></div>${seg('gl', [['', 'Theme'], ['on', 'On'], ['off', 'Off']])}<div class="th-note" style="margin:6px 0 0">Frosted, see-through bars and bubbles. Looks best with a wallpaper.</div></div>
    <div class="th-row"><div class="th-lbl"><span>My message style</span></div>${seg('bs', [['', 'Theme'], ['outline', 'Outline'], ['filled', 'Filled']])}</div>
    <div class="th-row"><div class="th-lbl"><span>Wallpaper</span></div>${seg('wp', [['', 'Theme'], ['aurora', 'Aurora'], ['sky', 'Sky'], ['sunset', 'Sunset'], ['marble', 'Marble'], ['wood', 'Wood'], ['leather', 'Leather'], ['none', 'Plain'], ['photo', '📷 My photo']])}<input type="file" id="chWpFile" accept="image/*" hidden></div>
    ${rng('rad', 'Bubble roundness', 4, 28, D.rad !== undefined ? D.rad : 12, 'px')}
    ${rng('blur', 'Glass blur', 0, 24, 14, 'px')}
    ${rng('dim', 'Darken wallpaper', 0, 70, 0, '%')}
    ${rng('fs', 'Message text size', 85, 130, 100, '%')}
    <div class="actions" style="margin-top:10px"><button class="btn ghost" type="button" id="chcReset">↺ Reset</button><button class="btn" type="button" id="chcDone">Done</button></div>`);
  w.classList.add('pw-over');
  const save = () => { chCustSet(C); chatThemeApply(); };
  w.querySelector('#chcDone').onclick = () => w.remove();
  w.querySelector('#chcReset').onclick = () => { Object.keys(C).forEach(k => delete C[k]); try{ localStorage.removeItem(chWpKey()); }catch(e){} save(); w.remove(); chatThemeCustom(); };
  w.addEventListener('input', e => {
    const r = e.target.closest('[data-cr]'), c = e.target.closest('[data-cc]');
    if (r){ C[r.dataset.cr] = +r.value; const b = w.querySelector('#chc_' + r.dataset.cr); if (b) b.textContent = r.value + r.dataset.u; save(); }
    else if (c){ C[c.dataset.cc] = c.value; save(); }
  });
  w.addEventListener('click', e => {
    const b = e.target.closest('.seg button'); if (!b) return;
    const sg = b.closest('.seg'), k = sg.dataset.ck, v = b.dataset.v;
    if (k === 'wp' && v === 'photo'){ w.querySelector('#chWpFile').click(); return; }
    if (v === '') delete C[k]; else C[k] = v;
    sg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); save();
  });
  w.querySelector('#chWpFile').onchange = async e => {
    const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
    try{
      const url = URL.createObjectURL(f);
      const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('read')); i.src = url; });
      URL.revokeObjectURL(url);
      const s = Math.min(1, 1000 / Math.max(img.naturalWidth, img.naturalHeight)), cv = document.createElement('canvas');
      cv.width = Math.round(img.naturalWidth * s); cv.height = Math.round(img.naturalHeight * s);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      localStorage.setItem(chWpKey(), cv.toDataURL('image/jpeg', .65));
      C.wp = 'photo'; save();
      w.querySelectorAll('[data-ck="wp"] button').forEach(x => x.classList.toggle('on', x.dataset.v === 'photo'));
    }catch(x){ toast('Could not use this picture. Try another one.', true); }
  };
}
function chatThemeMenu(){
  const cur = chThemeGet();
  const w = openModal(`<h3>🎨 Chat theme</h3><p class="sub">Choose how your chats look. Only you see this.</p>
    <div class="cth-grid">${CH_THEMES.map(([k, n, c]) => `<button type="button" class="cth-it ${k === cur ? 'on' : ''}" data-t="${k}">
      <span class="cth-pv" style="background:${c[0]}"><i style="background:${c[2]}"></i><i class="me" style="background:${c[1]}"></i></span><span class="cth-n">${esc(n)}</span></button>`).join('')}</div>
    <div class="actions" style="margin-top:14px"><button class="btn ghost" type="button" id="cthClose">Close</button><button class="btn" type="button" id="cthCust">✨ Customise</button></div>`);
  w.classList.add('pw-over');
  w.querySelector('#cthClose').onclick = () => w.remove();
  w.querySelector('#cthCust').onclick = () => { w.remove(); chatThemeCustom(); };
  w.querySelector('.cth-grid').onclick = e => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    try{ localStorage.setItem(chThemeKey(), b.dataset.t); }catch(x){}
    chatThemeApply();
    w.querySelectorAll('.cth-it').forEach(x => x.classList.toggle('on', x === b));
  };
}
function chatRefreshHeadAv(){
  const u = chatPeer(S.chat.with), el = $('#chHAv'); if (!u || !el) return;
  const dot = el.querySelector('.dot'); el.innerHTML = chInit(u); if (dot) el.appendChild(dot); chatHeader();
}
function chClock(t){ return new Date(t).toLocaleTimeString('en-IN', { hour:'numeric', minute:'2-digit' }); }
function chDayLabel(t){
  const d = new Date(t), n = new Date(), y = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1);
  const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, n)) return 'Today'; if (same(d, y)) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
}
function chListTime(t){
  if (!t) return '';
  return chDayLabel(t) === 'Today' ? chClock(t) : chDayLabel(t) === 'Yesterday' ? 'Yesterday' : new Date(t).toLocaleDateString('en-IN', { day:'numeric', month:'short' });
}

function vChat(){
  return `<div class="chat ${S.chat.with ? 'in-conv' : ''}" id="chatRoot">
    <div class="card ch-side">
      <div class="ch-top"><h3>💬 Chats <button class="btn sm" style="float:right" onclick="groupChatForm()">＋ New group</button></h3><input class="input" id="chSearch" placeholder="Search user…" autocomplete="off" value="${esc(S.chat.q)}"></div>
      <div class="ch-list" id="chList"></div>
    </div>
    <div class="card ch-pane" id="chPane"></div>
  </div>`;
}
function bindChat(){
  document.body.classList.toggle('chat-conv', !!S.chat.with);
  $('#chSearch').oninput = e => { S.chat.q = e.target.value; chatRenderList(); };
  chatRenderList(); chatRenderPane();
  chatLoadUsers();                                     // always refresh: a user may have been added / removed since last time
  if (S.chat.with) chatFetchConv(true);
}
function chatRenderList(){
  const el = $('#chList'); if (!el) return;
  const q = S.chat.q.trim().toLowerCase();
  const list = S.chat.groups.concat(S.chat.users).filter(u => !q || ((u.name || '') + ' ' + (u.username || '')).toLowerCase().includes(q))
    .sort((a, b) => (b.lastTime - a.lastTime) || (b.online - a.online) || String(a.name).localeCompare(String(b.name)));
  if (S.chat.err && !S.chat.loaded){
    el.innerHTML = `<div class="empty-state"><b style="color:#b91c1c">Could not load users</b><div style="margin:6px 0 12px;word-break:break-word">${esc(S.chat.err)}</div><button class="btn sm" onclick="S.chat.err='';chatRenderList();chatLoadUsers()">↻ Try again</button></div>`; return;
  }
  if (!S.chat.loaded){ el.innerHTML = '<div class="empty-state">Loading users…</div>'; return; }
  if (!list.length){ el.innerHTML = `<div class="empty-state">${S.chat.users.length ? 'No user found' : 'No users to chat with yet. The main admin decides who you can see.'}</div>`; return; }
  el.innerHTML = list.map(u => {
    const st = chatStatus(u);
    const prev = u.lastText ? `<div class="ch-prev">${u.lastMine ? 'You: ' : (u.lastFrom ? esc(u.lastFrom) + ': ' : '')}${esc(u.lastText)}</div>` : '';
    return `<div class="ch-row ${S.chat.with === u.id ? 'sel' : ''}" onclick="chatOpen('${esc(u.id)}')">
      <div class="ch-av" style="background:${chColor(u.id)}">${chInit(u)}${u.isGroup ? '' : `<span class="dot ${st.cls}"></span>`}</div>
      <div class="ch-info">
        <div class="ch-name"><span class="nm">${esc(u.name || u.username)}</span>${u.isGroup ? '' : `<span class="dot ${st.cls}"></span>`}<span class="tm">${esc(chListTime(u.lastTime))}</span></div>
        <div class="ch-stat ${st.cls}">${esc(st.txt)}</div>${prev}
      </div>${u.unread ? `<span class="ch-unread">${u.unread > 99 ? '99+' : u.unread}</span>` : ''}</div>`;
  }).join('');
}
function chatRenderPane(){
  const pane = $('#chPane'); if (!pane) return;
  const u = chatPeer(S.chat.with);
  if (!S.chat.with || !u){
    pane.innerHTML = '<div class="ch-empty"><div><div class="big">💬</div><b>Select a user to start chatting</b><div style="margin-top:4px">Your messages will appear here.</div></div></div>';
    $('#chatRoot').classList.remove('in-conv'); return;
  }
  $('#chatRoot').classList.add('in-conv'); chatThemeApply();
  pane.innerHTML = `<div class="ch-head">
      <button class="ch-back" onclick="chatBack()" aria-label="Back">←</button>
      <div class="ch-av pf-hit" id="chHAv" onclick="chatProfile()" style="background:${chColor(u.id)}">${chInit(u)}<span class="dot"></span></div>
      <div class="ch-info pf-hit" onclick="chatProfile()"><div class="ch-name"><span class="nm">${esc(u.name || u.username)}</span><span class="dot" id="chHDot"></span></div><div class="ch-stat" id="chHStat"></div></div>
      <div class="ch-calls"><button class="ch-cbtn" id="chMore" onclick="chatMoreMenu(event)" aria-label="More options" aria-haspopup="true">⋮</button></div>
    </div>
    <div class="ch-sel" id="chSel" style="display:none"></div>
    <div class="ch-msgs" id="chMsgs"></div>
    <div class="ch-ctx" id="chCtx" style="display:none"></div>
    <div class="ch-comp"><button class="ch-att" type="button" onclick="document.getElementById('chFile').click()" aria-label="Send photo or video">📎</button><input type="file" id="chFile" accept="image/*,video/*" multiple hidden onchange="chatAttach(this)"><textarea id="chInput" rows="1" placeholder="Type a message" maxlength="2000"></textarea>
      <button class="ch-send" id="chSend" onclick="chatSend()" aria-label="Send">➤</button></div>`;
  const ta = $('#chInput');
  ta.value = S.chat.drafts[u.id] || '';
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; };
  ta.oninput = () => { S.chat.drafts[u.id] = ta.value; grow(); };
  ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer:fine)').matches){ e.preventDefault(); chatSend(); } };
  if (S.chat.ed[u.id]){ S.chat.ed[u.id] = null; S.chat.drafts[u.id] = S.chat.eb[u.id] || ''; ta.value = S.chat.drafts[u.id]; }     // an unfinished edit is dropped when the chat is reopened
  grow(); chatHeader(); chatLangBtn(); chatSelBar(); chatBindMsgs(); S.chat.sig = ''; chatRenderMsgs(true); chatCtxBar();
}
function chatHeader(){
  const u = chatPeer(S.chat.with); if (!u) return;
  const st = chatStatus(u), t = $('#chHStat'); if (!t) return;
  t.className = 'ch-stat ' + st.cls; t.textContent = st.txt;
  if (u.isGroup){ $('#chHDot').style.display = 'none'; $('#chHAv .dot').style.display = 'none'; return; }
  $('#chHDot').className = 'dot ' + st.cls; $('#chHAv .dot').className = 'dot ' + st.cls;
}
function chatRenderMsgs(toBottom){
  const box = $('#chMsgs'); if (!box) return;
  const id = S.chat.with, arr = S.chat.msgs[id] || [], pr = S.chat.peerRead[id] || 0, ps = S.chat.peerSeen[id] || 0;
  const sig = arr.map(m => m.id + (m.state || '') + (m.mine ? (m.t <= pr ? 'r' : m.t <= ps ? 'd' : '') : '')).join(',') + '|' + S.chat.histLoaded[id] + '|' + S.chat.lang + '|' + S.chat.trv;
  if (sig === S.chat.sig && !toBottom) return;
  if (!toBottom && [...box.querySelectorAll('video')].some(v => !v.paused && !v.ended)){ S.chat.defer = true; return; }   // never rebuild the chat under a playing video
  S.chat.sig = sig;
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 90, keepTop = box.scrollTop;
  if (!arr.length){
    box.innerHTML = `<div class="ch-load">${S.chat.histLoaded[id] ? 'No messages yet — say hi 👋' : 'Loading messages…'}</div>`;
    return;
  }
  let html = '', day = '';
  arr.forEach(m => {
    const dl = chDayLabel(m.t);
    if (dl !== day){ day = dl; html += `<div class="ch-day">${esc(dl)}</div>`; }
    let meta = (m.edited ? 'edited · ' : '') + esc(chClock(m.t));
    if (m.mine){
      if (m.state === 'pending') meta = 'Sending…';
      else if (m.state === 'failed') meta = 'Not sent · tap to retry';
      else { const rdn = m.t <= pr, dlv = rdn || m.t <= ps;     // ✓ sent · ✓✓ grey = delivered (they were online) · ✓✓ blue = seen
        meta += ` <span class="tick ${rdn ? 'read' : dlv ? 'dlv' : ''}">${dlv ? '✓✓' : '✓'}</span>`; }
    }
    const v = chatView(m), sl = S.chat.sel.has(m.id);
    const tg = v.busy ? '<div class="tg">🌐 Translating…</div>' : v.fail ? '<div class="tg bad">🌐 Could not translate · tap to retry</div>' : v.lang ? `<div class="tg">🌐 ${esc(CH_LANGS[v.lang].short)} · tap for options</div>` : '';
    html += `<div class="ch-b ${m.mine ? 'me' : 'them'} ${m.state || ''} ${sl ? 'picked' : ''}" data-mid="${esc(m.id)}" ${m.state === 'failed' ? `onclick="chatRetry('${esc(m.id)}')"` : ''}>${!m.mine && m.from ? `<div class="mf" style="color:${chColor(m.from)}">${esc(m.from)}</div>` : ''}${chRqHtml(m)}${chMediaHtml(m)}${v.text ? `<div class="tx">${esc(v.text)}</div>` : ''}${v.text ? tg : ''}<div class="mt">${meta}</div></div>`;
  });
  box.innerHTML = html;
  if (toBottom || near) box.scrollTop = box.scrollHeight; else box.scrollTop = keepTop;
  chatNeedTr(); chatNeedMedia();
}
function chatMerge(id, list){
  const a = S.chat.msgs[id] || (S.chat.msgs[id] = []); let changed = false;
  list.forEach(m => {
    const i = a.findIndex(x => x.id === m.id);
    if (i >= 0){ if (a[i].state || a[i].t !== m.t || a[i].text !== m.text || a[i].from !== m.from || a[i].edited !== m.edited){
      if (a[i].text !== m.text){ [S.chat.tr, S.chat.trFail].forEach(o => Object.keys(o).forEach(k => { if (k.endsWith('|' + m.id)) delete o[k]; })); }
      a[i] = m; changed = true; } }
    else { a.push(m); changed = true; }
  });
  if (changed){ a.sort((x, y) => x.t - y.t); S.chat.trv++; }
  return changed;
}
const chatAfter = id => (S.chat.msgs[id] || []).reduce((mx, m) => m.state ? mx : Math.max(mx, m.t), 0);

async function chatLoadUsers(){
  if (S.chat.loadingUsers || !S.token) return;
  S.chat.loadingUsers = true;
  try{
    const r = await chatApi('chatUsers'), at = Date.now();
    const incoming = r.unread > S.chat.unread && (S.view !== 'chat' || document.hidden) && S.chat.loaded;
    S.chat.users = r.users.map(u => ({ ...u, at }));
    S.chat.groups = (r.groups || []).map(g => ({ ...g, at }));
    S.chat.users.concat(S.chat.groups).forEach(u => { if (S.view === 'chat' && S.chat.with === u.id) u.unread = 0; });   // the open chat is being read
    if (S.chat.with && !chatPeer(S.chat.with)){ S.chat.with = null; document.body.classList.remove('chat-conv'); if (S.view === 'chat') chatRenderPane(); }   // group deleted / permission removed
    S.chat.loaded = true; chatSumUnread();
    chatSyncAv(S.chat.users, r.me, r.mePv);
    if (incoming){ toast('💬 New message'); chatAlert(); }
    S.chat.err = '';
    if (S.view === 'chat'){ chatRenderList(); chatHeader(); }
  }catch(e){ chatErr(e); S.chat.err = (e && e.message) || 'Request failed'; if (S.view === 'chat') chatRenderList(); }
  finally{ S.chat.loadingUsers = false; }
}
async function chatPingNow(){
  try{
    const r = await chatApi('chatPing');
    if (r.unread > S.chat.unread && (S.view !== 'chat' || document.hidden)){ toast('💬 New message'); chatAlert(); }
    S.chat.unread = r.unread; chatBadge();
  }catch(e){ chatErr(e); }
}
function chatApplyConv(id, r, first){
  const c = S.chat;
  const known = new Set((c.msgs[id] || []).map(m => m.id));
  const fresh = (r.messages || []).some(m => !m.mine && !m.state && !known.has(m.id));      // really new (not already shown by the other lane)
  let ch = chatMerge(id, r.messages || []);
  if (r.edited && r.edited.length && chatMerge(id, r.edited)) ch = true;      // somebody edited a message: show the new text
  if (r.gone && r.gone.length){                                  // somebody deleted these: they vanish from this chat too, no trace
    const before = (c.msgs[id] || []).length;
    c.msgs[id] = (c.msgs[id] || []).filter(m => !r.gone.includes(m.id));
    r.gone.forEach(x => c.sel.delete(x));
    if (c.msgs[id].length !== before){ ch = true; c.trv++; chatSelBar(); chatLoadUsers(); }
  }
  if (r.now) c.gs[id] = Math.max(c.gs[id] || 0, r.now);
  if (first !== true && c.histLoaded[id] && fresh) chatAlert();   // a new message in the chat I have open
  if (!c.histLoaded[id]){ c.histLoaded[id] = true; ch = true; }
  if ((r.peerRead || 0) > (c.peerRead[id] || 0)){ c.peerRead[id] = r.peerRead; ch = true; }
  if ((r.peerSeen || 0) > (c.peerSeen[id] || 0)){ c.peerSeen[id] = r.peerSeen; ch = true; }
  const u = chatPeer(id);
  if (u && u.isGroup && r.group){ u.name = r.group.name; u.members = r.group.members; }
  if (u && r.presence){ u.online = r.presence.online; u.ago = r.presence.ago; u.at = Date.now(); }
  if (u && (r.messages || []).some(m => !m.mine)){
    u.unread = 0; chatSumUnread();
    const last = r.messages[r.messages.length - 1]; u.lastText = chPrev(last.text); u.lastTime = last.t; u.lastMine = last.mine;
    chatRenderList();
  }
  chatHeader();
  if (ch || first) chatRenderMsgs(!!first);
}
async function chatFetchConv(first){
  const c = S.chat, id = c.with;
  if (!id || c.fetching) return;
  c.fetching = true;
  try{
    const r = await chatApi('chatFetch', { with:id, after:chatAfter(id), gs:c.gs[id] || 0 });
    if (c.with !== id) return;                                  // the user opened another chat meanwhile
    chatApplyConv(id, r, first);
  }catch(e){ chatErr(e); }
  finally{ c.fetching = false; }
}
/* Fast lane (every 1.5 s while a chat is open): shows new messages at once, tells the server "I am looking at this chat" (-> blue tick on the
   sender's phone within a second or two) and brings the sender's ✓ / ✓✓ / blue ✓✓ up to date. It skips the slow sheet queue on the server. */
let chatLiveT = null, chatLiveBusy = false;
async function chatLivePoll(){
  const c = S.chat, id = c.with;
  if (chatLiveBusy || !id || !S.token || !S.d || document.hidden || S.view !== 'chat' || !c.histLoaded[id]) return;
  const u = chatPeer(id); if (!u || u.isGroup) return;
  chatLiveBusy = true;
  try{
    const r = await chatApi('chatLive', { with:id, after:chatAfter(id), read:1, gs:c.gs[id] || 0 });
    if (r.skip || c.with !== id || document.hidden) return;
    chatApplyConv(id, r, false);
    if ((r.messages || []).some(m => !m.mine)) chatFetchConv();       // the slow lane only saves the "read" mark for good
  }catch(e){ if (e && e.code === 'AUTH') chatErr(e); }
  finally{ chatLiveBusy = false; }
}
function chatOpen(id){
  const c = S.chat; if (!chatPeer(id)) return;
  c.sel.clear(); c.with = id; const u = chatPeer(id); if (u){ u.unread = 0; chatSumUnread(); }
  document.body.classList.add('chat-conv');
  chatRenderList(); chatRenderPane(); chatFetchConv(true);
  if (!window.matchMedia('(max-width:860px)').matches){ const t = $('#chInput'); if (t) t.focus(); }
}
/* ---------- group chat: create / edit / leave / delete ---------- */
function groupChatForm(id){
  const g = id ? S.chat.groups.find(x => x.id === id) : null;
  if (id && !g) return;
  const mineOwner = !g || g.mineOwner;
  const have = g ? g.members.map(m => m.id) : [];
  const pool = S.chat.users.slice();                                   // only users I am allowed to see
  const extra = g ? g.members.filter(m => m.id !== S.me.id && !pool.some(p => p.id === m.id)) : [];   // members I can no longer see stay in the group
  const boxes = pool.map(u => `<label class="tog"><input type="checkbox" name="gm" value="${esc(u.id)}" ${have.includes(u.id) ? 'checked' : ''} ${mineOwner ? '' : 'disabled'}> ${esc(u.name || u.username)} <span class="muted">@${esc(u.username)}</span></label>`).join('')
    + extra.map(m => `<label class="tog"><input type="checkbox" name="gm" value="${esc(m.id)}" checked ${mineOwner ? '' : 'disabled'}> ${esc(m.name)}</label>`).join('');
  const w = openModal(`<h3>${g ? (mineOwner ? 'Edit group' : esc(g.name)) : 'New group chat'}</h3>
    <p class="sub">${mineOwner ? 'Pick at least 2 people. Everybody in the group can chat, and you can start a Ludo game for all of them (🎲).' : 'Members of this group:'}</p>
    <form id="gcf" autocomplete="off">
      <div class="field"><label>Group name</label><input class="input" name="name" maxlength="40" value="${esc(g ? g.name : '')}" ${mineOwner ? 'required' : 'disabled'}></div>
      <div class="field"><label>Members</label>${boxes || '<div class="muted">You can’t see any other users yet — the main admin decides who you can chat with.</div>'}</div>
      <div class="foot">
        ${g ? `<button type="button" class="btn ghost" data-leave>${mineOwner ? '🗑 Delete group' : 'Leave group'}</button>` : ''}
        <button type="button" class="btn ghost" data-x>Close</button>${mineOwner ? `<button class="btn" type="submit">${g ? 'Save' : 'Create group'}</button>` : ''}</div></form>`);
  w.querySelector('[data-x]').onclick = () => w.remove();
  const lv = w.querySelector('[data-leave]');
  if (lv) lv.onclick = async () => {
    if (!await confirmBox(mineOwner ? 'Delete this group?' : 'Leave this group?', mineOwner ? 'The group is removed for everybody.' : 'You will not get its messages any more.', mineOwner ? 'Delete' : 'Leave', true)) return;
    try { await chatApi(mineOwner ? 'chatGroupDelete' : 'chatGroupLeave', { id:g.id }); w.remove(); if (S.chat.with === g.id){ S.chat.with = null; } await chatLoadUsers(); chatRenderList(); chatRenderPane(); document.body.classList.remove('chat-conv'); }
    catch(e){ chatErr(e); toast(e.message, true); }
  };
  w.querySelector('#gcf').onsubmit = async ev => {
    ev.preventDefault(); const f = new FormData(ev.target), btn = ev.submitter; btn.disabled = true;
    try {
      const r = await chatApi('chatGroupSave', { id:g ? g.id : '', name:f.get('name'), members:f.getAll('gm') });
      const at = Date.now(); S.chat.users = r.users.map(u => ({ ...u, at })); S.chat.groups = (r.groups || []).map(x => ({ ...x, at }));
      w.remove(); chatRenderList();
      if (!g){ const ng = S.chat.groups.find(x => x.name === String(f.get('name')).trim() && x.mineOwner); if (ng) chatOpen(ng.id); }
      else if (S.chat.with === g.id) chatRenderPane();
      toast(g ? 'Group updated' : 'Group created');
    } catch(e){ btn.disabled = false; chatErr(e); toast(e.message, true); }
  };
}

/* ---------- chat translation (English / Hindi / Indonesian), select & copy ---------- */
const CH_LANGS = { en:{ name:'English', short:'EN' }, hi:{ name:'हिन्दी (Hindi)', short:'HI' }, id:{ name:'Bahasa Indonesia', short:'ID' } };
const chatMsg = id => (S.chat.msgs[S.chat.with] || []).find(m => m.id === id);
function chatLangOf(m){
  const o = S.chat.ov[m.id];
  const l = o !== undefined ? o : (m.mine ? '' : S.chat.lang);
  return l === 'orig' ? '' : (l || '');
}
function chatView(m){
  const l = chatLangOf(m); if (!l || m.state) return { text:chTxt(m) };
  const k = l + '|' + m.id;
  if (S.chat.tr[k] != null) return { text:S.chat.tr[k], lang:l };
  if (S.chat.trFail[k]) return { text:chTxt(m), fail:true, lang:l };
  return { text:chTxt(m), busy:true, lang:l };
}
function chatNeedTr(){
  const c = S.chat, id = c.with; if (!id) return;
  const arr = (c.msgs[id] || []).slice(-30), by = {};
  arr.forEach(m => {
    const l = chatLangOf(m); if (!l || m.state || !String(chTxt(m)).trim()) return;
    const k = l + '|' + m.id; if (c.tr[k] != null || c.trFail[k] || c.trBusy[k]) return;
    (by[l] = by[l] || []).push({ id:m.id, text:chTxt(m) });
  });
  Object.keys(by).forEach(l => chatTrRun(by[l], l, id));
}
async function chatTrRun(items, lang, convId){
  const c = S.chat;
  for (let i = 0; i < items.length; i += 25){
    const part = items.slice(i, i + 25);
    part.forEach(x => c.trBusy[lang + '|' + x.id] = 1);
    try{
      const r = await chatApi('chatTranslate', { to:lang, texts:part.map(x => x.text) });
      part.forEach((x, j) => { const t = r.translations && r.translations[j]; if (typeof t === 'string') c.tr[lang + '|' + x.id] = t; else c.trFail[lang + '|' + x.id] = 1; });
    }catch(e){ chatErr(e); part.forEach(x => c.trFail[lang + '|' + x.id] = 1); }
    part.forEach(x => delete c.trBusy[lang + '|' + x.id]);
    c.trTry = c.trTry || {};
    const again = part.filter(x => c.trFail[lang + '|' + x.id] && (c.trTry[lang + '|' + x.id] || 0) < 2);   // busy server: try again quietly (after 12 s, then 40 s)
    if (again.length){
      const n = Math.max.apply(null, again.map(x => c.trTry[lang + '|' + x.id] || 0));
      again.forEach(x => { c.trTry[lang + '|' + x.id] = (c.trTry[lang + '|' + x.id] || 0) + 1; });
      setTimeout(() => { again.forEach(x => delete c.trFail[lang + '|' + x.id]); if (S.view === 'chat') chatNeedTr(); }, n ? 40000 : 12000);
    }
    c.trv++;
    if (S.view === 'chat' && c.with === convId) chatRenderMsgs();
  }
}
function chatLangBtn(){
  const b = $('#chMore'); if (!b) return;
  b.innerHTML = S.chat.lang ? `⋮<span class="ch-lg">${CH_LANGS[S.chat.lang].short}</span>` : '⋮';      // shows which language is on
}
/* ⋮ menu in the chat header: Translate, Ludo, voice call, video call (or group info) */
function chatMoreMenu(ev){
  if (ev) ev.stopPropagation();
  const old = $('#chMenu'); if (old){ old.remove(); return; }
  const u = chatPeer(S.chat.with), head = $('.ch-head'); if (!u || !head) return;
  const m = document.createElement('div'); m.id = 'chMenu'; m.className = 'ch-menu'; m.setAttribute('role', 'menu');
  const item = (ic, label, fn, sub) => `<button type="button" role="menuitem" data-fn="${fn}"><span class="ic">${ic}</span><span>${label}${sub ? `<small>${sub}</small>` : ''}</span></button>`;
  m.innerHTML = item('🌐', 'Translate chat', 'tr', S.chat.lang ? 'On · ' + esc(CH_LANGS[S.chat.lang].name) : 'Off')
    + item('🎨', 'Chat theme', 'theme', chThemeGet() ? esc((CH_THEMES.find(x => x[0] === chThemeGet()) || [0, ''])[1]) : 'Default')
    + item('🎲', 'Play Ludo', 'ludo')
    + (u.isGroup ? item('ℹ️', 'Group info', 'grp') : item('📞', 'Voice call', 'audio') + item('🎥', 'Video call', 'video'));
  head.appendChild(m);
  const close = () => { m.remove(); document.removeEventListener('click', close, true); };
  m.onclick = e => {
    const b = e.target.closest('[data-fn]'); if (!b) return;
    const f = b.dataset.fn; close();
    if (f === 'tr') chatLangMenu(); else if (f === 'theme') chatThemeMenu(); else if (f === 'ludo') ludoDial(); else if (f === 'audio') vcDial('audio'); else if (f === 'video') vcDial('video'); else if (f === 'grp') groupChatForm(u.id);
  };
  setTimeout(() => document.addEventListener('click', close, true), 0);
}
function chatLangMenu(){
  const cur = S.chat.lang;
  const w = openModal(`<h3>🌐 Translate chat</h3><p class=\"sub\">Messages you receive are shown in the language you pick. Tap any message to translate just that one.</p>
    <div class=\"ch-opts\">
      <button class=\"btn ${!cur ? '' : 'ghost'}\" data-l=\"\">${!cur ? '✓ ' : ''}Off — show original</button>
      ${Object.keys(CH_LANGS).map(k => `<button class=\"btn ${cur === k ? '' : 'ghost'}\" data-l=\"${k}\">${cur === k ? '✓ ' : ''}${esc(CH_LANGS[k].name)}</button>`).join('')}
    </div><div class=\"foot\"><button class=\"btn ghost\" data-x>Close</button></div>`);
  w.querySelector('[data-x]').onclick = () => w.remove();
  w.querySelectorAll('[data-l]').forEach(b => b.onclick = () => {
    S.chat.lang = b.dataset.l; S.chat.ov = {}; S.chat.trFail = {};
    try{ localStorage.setItem('ks_chat_lang_v1', S.chat.lang); }catch(e){}
    w.remove(); S.chat.trv++; chatLangBtn(); chatRenderMsgs();
    toast(S.chat.lang ? 'Translating to ' + CH_LANGS[S.chat.lang].name : 'Translation off');
  });
}
function chatMsgMenu(id){
  const m = chatMsg(id); if (!m) return;
  const v = chatView(m), cur = chatLangOf(m);
  const w = openModal(`<h3>Message</h3><p class=\"sub\" style=\"white-space:pre-wrap;max-height:120px;overflow:auto\">${esc(v.text)}</p>
    <div class=\"ch-opts\">
      ${Object.keys(CH_LANGS).map(k => `<button class=\"btn ${cur === k ? '' : 'ghost'}\" data-l=\"${k}\">🌐 ${cur === k ? '✓ ' : ''}${esc(CH_LANGS[k].name)}</button>`).join('')}
      <button class=\"btn ghost\" data-l=\"orig\">↩ Show original</button>
      ${v.text ? '<button class=\"btn ghost\" data-copy>📋 Copy</button>' : ''}
      ${chMediaUrl(m) ? `<a class=\"btn ghost\" href=\"${esc(chMediaUrl(m, true))}\" download>⬇ Download</a>` : ''}
      ${!m.state ? '<button class="btn ghost" data-reply>↩ Reply</button>' : ''}
      ${m.mine && !m.state && !chMedia(m) ? '<button class="btn ghost" data-edit>✏️ Edit</button>' : ''}
      <button class=\"btn ghost\" data-pick>☑ Select</button>
      ${chatCanDel(m) ? '<button class="btn ghost" data-del>🗑 Delete</button>' : ''}
    </div><div class=\"foot\"><button class=\"btn ghost\" data-x>Close</button></div>`);
  w.querySelector('[data-x]').onclick = () => w.remove();
  const cb = w.querySelector('[data-copy]'); if (cb) cb.onclick = () => { w.remove(); chatCopyText(v.text); };
  w.querySelector('[data-pick]').onclick = () => { w.remove(); chatTogglePick(id); };
  const rpb = w.querySelector('[data-reply]'); if (rpb) rpb.onclick = () => { w.remove(); chatReplyTo(id); };
  const edb = w.querySelector('[data-edit]'); if (edb) edb.onclick = () => { w.remove(); chatEditStart(id); };
  const dlb = w.querySelector('[data-del]'); if (dlb) dlb.onclick = () => { w.remove(); chatDeleteIds([id]); };
  w.querySelectorAll('[data-l]').forEach(b => b.onclick = () => {
    const l = b.dataset.l; S.chat.ov[id] = l; delete S.chat.trFail[l + '|' + id];
    w.remove(); S.chat.trv++; chatRenderMsgs();
  });
}
/* ---------- reply (quote) and edit ---------- */
function chRqHtml(m){
  const q = m && m.reply; if (!q) return '';
  return `<div class="rq" data-rq="${esc(q.i)}"><b>${esc(q.mine ? 'You' : (q.n || ''))}</b><span>${esc(q.t || '')}</span></div>`;
}
function chatCtxBar(){
  const el = $('#chCtx'); if (!el) return;
  const c = S.chat, id = c.with, rp = c.rp[id], ed = c.ed[id];
  if (!rp && !ed){ el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = 'flex';
  el.innerHTML = (ed ? '<div class="cx-b"><b>✏️ Edit message</b><span>Change the text, then tap send</span></div>'
    : `<div class="cx-b"><b>↩ ${esc(rp.mine ? 'You' : (rp.n || ''))}</b><span>${esc(rp.t || '')}</span></div>`)
    + '<button class="ch-sbtn" type="button" onclick="chatCtxCancel()" aria-label="Cancel">✕</button>';
}
function chatCtxCancel(){
  const c = S.chat, id = c.with;
  if (c.ed[id]){ const ta = $('#chInput'); c.drafts[id] = c.eb[id] || ''; if (ta){ ta.value = c.drafts[id]; ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; } }
  c.ed[id] = null; c.rp[id] = null; chatCtxBar();
}
function chatReplyTo(id){
  const c = S.chat, m = chatMsg(id); if (!m || m.state) return;
  if (c.ed[c.with]) chatCtxCancel();
  const u = chatPeer(c.with);
  c.rp[c.with] = { id, mine:!!m.mine, n:m.mine ? 'You' : (m.from || (u && (u.name || u.username)) || ''), t:chPrev(m.text).replace(/\s+/g, ' ').slice(0, 100) };
  chatCtxBar(); const ta = $('#chInput'); if (ta) ta.focus();
}
function chatEditStart(id){
  const c = S.chat, m = chatMsg(id); if (!m || !m.mine || m.state || chMedia(m)) return;
  const ta = $('#chInput'); if (!ta) return;
  if (!c.ed[c.with]) c.eb[c.with] = ta.value;                    // the half-typed message comes back after the edit
  c.rp[c.with] = null; c.ed[c.with] = id;
  ta.value = m.text; c.drafts[c.with] = m.text; ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; ta.focus();
  chatCtxBar();
}
async function chatEditDo(to, text){
  const c = S.chat, id = c.ed[to], m = (c.msgs[to] || []).find(x => x.id === id);
  const fin = () => { c.ed[to] = null; const back = c.eb[to] || ''; c.drafts[to] = back; const ta = $('#chInput'); if (ta && c.with === to){ ta.value = back; ta.style.height = 'auto'; } chatCtxBar(); };
  if (!m || text === m.text){ fin(); return; }
  try{
    const r = await chatApi('chatEdit', { with:to, id, text });
    Object.assign(m, r.message);
    [c.tr, c.trFail].forEach(o => Object.keys(o).forEach(k => { if (k.endsWith('|' + id)) delete o[k]; }));
    fin(); c.trv++; chatRenderMsgs(); chatLoadUsers(); toast('Message edited');
  }catch(e){ chatErr(e); toast((e && e.message) || 'Could not edit', true); }
}
function chatJump(id){
  const el = document.querySelector('#chMsgs .ch-b[data-mid="' + String(id).replace(/"/g, '') + '"]');
  if (!el) return toast('The original message is not available', true);
  el.scrollIntoView({ block:'center', behavior:'smooth' }); el.classList.add('hl'); setTimeout(() => el.classList.remove('hl'), 1400);
}
/* ---------- delete messages / photos / videos (they vanish for everybody; the main admin keeps them in Settings → Trash) ---------- */
const chatCanDel = m => !!m && !m.state && (m.mine || !!(S.me && S.me.primary));
function chatSelDelOk(){
  const c = S.chat, arr = c.msgs[c.with] || [];
  return c.sel.size > 0 && [...c.sel].every(i => chatCanDel(arr.find(m => m.id === i)));
}
function chatSelDel(){ chatDeleteIds([...S.chat.sel]); }
async function chatDeleteIds(ids){
  const c = S.chat, conv = c.with; if (!conv) return;
  const arr = c.msgs[conv] || [], list = ids.map(i => arr.find(m => m.id === i)).filter(Boolean);
  const real = list.filter(m => !m.state), local = list.filter(m => m.state === 'failed');     // a message that never reached the server is just dropped here
  const n = real.length + local.length; if (!n) return;
  const adm = !!(S.me && S.me.primary);
  if (!await confirmBox('Delete ' + (n > 1 ? n + ' messages' : 'this message') + '?', adm ? 'It disappears from this chat for everyone and is saved in Settings → Trash.' : 'It will be removed from this chat for everyone. This cannot be undone.', 'Delete', true)) return;
  try{
    let gone = local.map(m => m.id);
    if (real.length){ const r = await chatApi('chatDelete', { with:conv, ids:real.map(m => m.id) }); gone = gone.concat(r.gone || []); }
    c.msgs[conv] = (c.msgs[conv] || []).filter(m => !gone.includes(m.id));
    gone.forEach(i => c.sel.delete(i));
    c.trv++; chatSelBar(); chatRenderMsgs(); chatLoadUsers();
    toast(n > 1 ? 'Messages deleted' : 'Message deleted');
  }catch(e){ chatErr(e); toast((e && e.message) || 'Could not delete', true); }
}
async function chatCopyText(t){
  try{ await navigator.clipboard.writeText(t); }
  catch(e){ const x = document.createElement('textarea'); x.value = t; x.style.cssText = 'position:fixed;opacity:0;left:-999px'; document.body.appendChild(x); x.select(); try{ document.execCommand('copy'); }catch(_){} x.remove(); }
  toast('Copied');
}
function chatTogglePick(id){
  const s = S.chat.sel; if (s.has(id)) s.delete(id); else s.add(id);
  S.chat.trv++; chatSelBar(); chatRenderMsgs();
}
function chatSelBar(){
  const b = $('#chSel'); if (!b) return;
  const n = S.chat.sel.size; b.style.display = n ? 'flex' : 'none';
  if (n) b.innerHTML = `<button class=\"ch-sbtn\" onclick=\"chatSelClear()\" aria-label=\"Cancel\">✕</button><b>${n} selected</b><span style=\"flex:1\"></span><button class=\"ch-sbtn\" onclick=\"chatSelAll()\">☑ All</button><button class=\"ch-sbtn\" onclick=\"chatSelTr()\">🌐</button><button class=\"ch-sbtn\" onclick=\"chatSelCopy()\">📋 Copy</button>${chatSelDelOk() ? '<button class="ch-sbtn" onclick="chatSelDel()">🗑 Delete</button>' : ''}`;
}
function chatSelClear(){ S.chat.sel.clear(); S.chat.trv++; chatSelBar(); chatRenderMsgs(); }
function chatSelAll(){ (S.chat.msgs[S.chat.with] || []).forEach(m => { if (!m.state) S.chat.sel.add(m.id); }); S.chat.trv++; chatSelBar(); chatRenderMsgs(); }
function chatSelCopy(){
  const u = chatPeer(S.chat.with), arr = (S.chat.msgs[S.chat.with] || []).filter(m => S.chat.sel.has(m.id));
  if (!arr.length) return;
  const tx = m => chatView(m).text || (chMedia(m) ? (chMedia(m).k === 'vid' ? '[Video]' : '[Photo]') : '');
  const t = arr.length === 1 ? tx(arr[0]) : arr.map(m => (m.mine ? 'Me' : (m.from || (u && (u.name || u.username)) || '')) + ': ' + tx(m)).join('\n');
  chatCopyText(t); chatSelClear();
}
function chatSelTr(){
  if (!S.chat.sel.size) return;
  const w = openModal(`<h3>🌐 Translate ${S.chat.sel.size} message${S.chat.sel.size > 1 ? 's' : ''}</h3>
    <div class=\"ch-opts\">${Object.keys(CH_LANGS).map(k => `<button class=\"btn ghost\" data-l=\"${k}\">${esc(CH_LANGS[k].name)}</button>`).join('')}<button class=\"btn ghost\" data-l=\"orig\">↩ Show original</button></div>
    <div class=\"foot\"><button class=\"btn ghost\" data-x>Close</button></div>`);
  w.querySelector('[data-x]').onclick = () => w.remove();
  w.querySelectorAll('[data-l]').forEach(b => b.onclick = () => {
    const l = b.dataset.l; S.chat.sel.forEach(id => { S.chat.ov[id] = l; delete S.chat.trFail[l + '|' + id]; });
    w.remove(); S.chat.sel.clear(); S.chat.trv++; chatSelBar(); chatRenderMsgs();
  });
}
/* tap a message = options; long-press = select (then tap more to add / remove) */
function chatBindMsgs(){
  const box = $('#chMsgs'); if (!box) return;
  let tm = null, long = false, x0 = 0, y0 = 0;
  const bub = e => e.target.closest && e.target.closest('.ch-b[data-mid]');
  const stop = () => { clearTimeout(tm); tm = null; };
  box.addEventListener('pointerdown', e => {
    const b = bub(e); if (!b || b.classList.contains('failed')) return;
    if (e.target.closest('video')) return;
    long = false; x0 = e.clientX; y0 = e.clientY; stop();
    tm = setTimeout(() => { long = true; tm = null; if (navigator.vibrate) try{ navigator.vibrate(15); }catch(_){}; chatTogglePick(b.dataset.mid); }, 450);
  });
  box.addEventListener('pointermove', e => { if (tm && (Math.abs(e.clientX - x0) > 8 || Math.abs(e.clientY - y0) > 8)) stop(); });
  ['pointerup', 'pointercancel', 'pointerleave', 'scroll'].forEach(ev => box.addEventListener(ev, stop, true));
  box.addEventListener('contextmenu', e => { if (bub(e)) e.preventDefault(); });
  ['pause', 'ended'].forEach(ev => box.addEventListener(ev, () => { if (S.chat.defer){ S.chat.defer = false; chatRenderMsgs(); } }, true));
  box.addEventListener('click', e => {
    const b = bub(e); if (!b || b.classList.contains('failed')) return;
    if (long){ long = false; return; }
    const id = b.dataset.mid, m = chatMsg(id); if (!m) return;
    const rqe = e.target.closest('.rq'); if (rqe && !S.chat.sel.size) return chatJump(rqe.dataset.rq);
    if (e.target.closest('video')) return;
    const er = e.target.closest('.ph.err'); if (er){ const o = chMedia(m); if (o){ delete S.chat.mu[o.i]; S.chat.trv++; chatRenderMsgs(); } return; }
    if (e.target.closest('.ch-mimg') && !S.chat.sel.size) return chMediaView(id);
    if (S.chat.sel.size) return chatTogglePick(id);
    const v = chatView(m);
    if (v.fail){ delete S.chat.trFail[v.lang + '|' + id]; S.chat.trv++; chatRenderMsgs(); return; }
    chatMsgMenu(id);
  });
}

/* ---------- chat photos & videos (saved to the main admin's Google Drive) ---------- */
const CH_MEDIA_MAX = 40 * 1048576;
function chMedia(m){
  const t = m && m.text; if (typeof t !== 'string' || t.indexOf('ksmedia:') !== 0) return null;
  try{ const o = JSON.parse(t.slice(8)); return o && typeof o === 'object' ? o : null; }catch(e){ return null; }
}
const chTxt = m => { const o = chMedia(m); return o ? String(o.c || '') : m.text; };
const chPrev = t => { const o = chMedia({ text:t }); return o ? ((o.k === 'vid' ? '🎥 Video' : '📷 Photo') + (o.c ? ' · ' + o.c : '')).slice(0, 80) : String(t).slice(0, 80); };
function chMediaUrl(m, dl){
  const o = chMedia(m), u = o && o.i && S.chat.mu[o.i]; if (!u) return '';
  return dl ? u + '&dl=1&n=' + encodeURIComponent(o.n || (o.k === 'vid' ? 'video' : 'photo')) : u;
}
function chMediaHtml(m){
  const o = chMedia(m); if (!o) return '';
  const vid = o.k === 'vid', ic = vid ? '🎥' : '📷';
  if (!o.i) return `<div class=\"mm ph\">${ic} ${esc(o.n || '')}<br><b>${m.state === 'failed' ? '⚠️ Not sent' : '⏫ ' + (m.up != null ? m.up + '%' : 'Uploading…')}</b></div>`;
  const u = S.chat.mu[o.i];
  if (u === undefined) return `<div class=\"mm ph\">${ic} Loading…</div>`;
  if (u === null) return `<div class=\"mm ph err\">⚠️ Could not load · tap to retry</div>`;
  return vid ? `<video class=\"mm ch-mvid\" src=\"${esc(u)}\" controls preload=\"metadata\" playsinline></video>`
    : `<img class=\"mm ch-mimg\" src=\"${esc(u)}\" alt=\"\" loading=\"lazy\" onerror=\"chMediaErr('${esc(o.i)}')\">`;
}
function chMediaErr(i){ if (S.chat.mu[i] === null) return; S.chat.mu[i] = null; S.chat.trv++; chatRenderMsgs(); }
async function chatNeedMedia(){
  const c = S.chat, id = c.with; if (!id) return;
  const ids = [];
  (c.msgs[id] || []).slice(-80).forEach(m => { const o = chMedia(m); if (o && o.i && c.mu[o.i] === undefined && !c.mBusy[o.i]) ids.push(o.i); });
  if (!ids.length) return;
  ids.forEach(i => c.mBusy[i] = 1);
  try{
    const r = await chatApi('chatMediaTicket', { ids });
    ids.forEach(i => { const t = r.tickets && r.tickets[i]; c.mu[i] = t ? API_URL + '/chat/media?' + new URLSearchParams({ id:i, u:t.u, e:t.e, k:t.k }).toString() : null; });
  }catch(e){ chatErr(e); ids.forEach(i => c.mu[i] = null); }
  ids.forEach(i => delete c.mBusy[i]);
  c.trv++; if (S.view === 'chat' && c.with === id) chatRenderMsgs();
}
function chMediaView(id){
  const m = chatMsg(id), url = chMediaUrl(m); if (!url) return;
  const w = document.createElement('div'); w.className = 'ch-view';
  w.innerHTML = `<div class=\"cv-bar\"><button class=\"ch-sbtn\" data-x type=\"button\">✕</button><a class=\"ch-sbtn\" href=\"${esc(chMediaUrl(m, true))}\" download>⬇ Save</a></div><img src=\"${esc(url)}\" alt=\"\">`;
  w.onclick = e => { if (e.target === w || e.target.closest('[data-x]')) w.remove(); };
  document.body.appendChild(w);
}
function chImgShrink(f){          // phone photos are 3-8 MB: shrink to ~1600 px JPEG before sending (saves data and Drive space)
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(f), img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight)), cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(img.naturalWidth * k)); cv.height = Math.max(1, Math.round(img.naturalHeight * k));
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
      cv.toBlob(b => b ? resolve(b) : reject(new Error('Could not prepare this photo.')), 'image/jpeg', 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This photo format is not supported. Try a JPG or PNG.')); };
    img.src = url;
  });
}
async function chatAttach(inp){
  const to = S.chat.with, files = [...(inp.files || [])].slice(0, 5); inp.value = '';
  if (!to || !files.length) return;
  const ta = $('#chInput'); let cap = ta ? ta.value.trim() : '';
  if (cap && ta){ ta.value = ''; S.chat.drafts[to] = ''; ta.style.height = 'auto'; }        // what you typed becomes the caption of the first file
  for (const f of files){ await chatUpload(to, f, cap); cap = ''; }
}
async function chatUpload(to, f, cap, again){
  const c = S.chat, vid = /^video\//.test(f.type), img = /^image\//.test(f.type);
  if (!vid && !img) return toast('Only photos and videos can be sent', true);
  if (vid && f.size > CH_MEDIA_MAX) return toast('This video is too big (max ' + Math.round(CH_MEDIA_MAX / 1048576) + ' MB). Trim it and try again.', true);
  let m = again;
  if (!m){
    const cid = (window.crypto && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : String(Math.random()).slice(2) + Date.now()).slice(0, 14);
    m = { id:cid, t:Date.now(), mine:true, text:'ksmedia:' + JSON.stringify({ k:vid ? 'vid' : 'img', n:f.name || (vid ? 'video' : 'photo'), c:cap }), state:'pending', up:0, _file:f };
    (c.msgs[to] = c.msgs[to] || []).push(m); c.histLoaded[to] = true;
  } else { m.state = 'pending'; m.up = 0; }
  chatRenderMsgs(true);
  try{
    let blob = f, mime = f.type || (vid ? 'video/mp4' : 'image/jpeg'), name = f.name || (vid ? 'video.mp4' : 'photo.jpg');
    if (img && f.type !== 'image/gif'){ blob = await chImgShrink(f); mime = 'image/jpeg'; name = name.replace(/\.\w+$/, '') + '.jpg'; }
    const q = new URLSearchParams({ to, cid:m.id, name, mime, c:(chMedia(m) || {}).c || '' });
    const r = await new Promise((resolve, reject) => {
      const x = new XMLHttpRequest(); x.open('POST', API_URL + '/chat/media/upload?' + q.toString());
      x.setRequestHeader('Authorization', 'Bearer ' + S.token); x.setRequestHeader('Content-Type', 'application/octet-stream');
      x.upload.onprogress = e => {
        if (!e.lengthComputable) return;
        m.up = Math.min(100, Math.round(e.loaded * 100 / e.total));
        const b = document.querySelector('.ch-b[data-mid=\"' + m.id + '\"] .ph b'); if (b) b.textContent = m.up < 100 ? '⏫ ' + m.up + '%' : '☁️ Saving to Drive…';
      };
      x.onload = () => { try{ resolve(JSON.parse(x.responseText)); }catch{ reject(new Error('Unexpected server response.')); } };
      x.onerror = x.ontimeout = () => reject(new Error('Upload failed — check your internet connection.'));
      x.send(blob);
    });
    if (!r.ok){ const e = new Error(r.error || 'Upload failed'); e.code = r.code; throw e; }
    const arr = c.msgs[to] || [], i = arr.findIndex(x => x.id === m.id);
    if (i >= 0) arr[i] = r.message; else arr.push(r.message);
    arr.sort((x, y) => x.t - y.t);
    const u = chatPeer(to); if (u){ u.lastText = chPrev(r.message.text); u.lastTime = r.message.t; u.lastMine = true; }
  }catch(e){ m.state = 'failed'; chatErr(e); toast(e.message || 'Upload failed', true); }
  if (c.with === to) chatRenderMsgs(true);
  chatRenderList();
}

/* ---------- who can see my profile photo ---------- */
async function photoPrivacy(){
  let cur; try{ cur = await api('getPhotoPrivacy'); }catch(e){ return handleErr(e); }
  if (!S.chat.loaded) await chatLoadUsers();
  const peers = (S.chat.users || []).filter(u => !u.isGroup), sel = new Set(cur.ids || []);
  const opts = [['all', 'Everyone I can chat with'], ['none', 'Nobody'], ['only', 'Only the people I choose'], ['except', 'Everyone except the people I choose']];
  const w = openModal(`<h3>🔒 Who can see my profile photo</h3><p class=\"sub\">The main admin can always see it. Everyone else follows this choice; people who can’t see it just see your first letter.</p>
    <div class=\"ch-opts\" id=\"ppModes\">${opts.map(([v, l]) => `<label class=\"tog\"><input type=\"radio\" name=\"ppm\" value=\"${v}\" ${cur.mode === v ? 'checked' : ''}> ${l}</label>`).join('')}</div>
    <div id=\"ppList\" style=\"max-height:240px;overflow:auto;margin:6px 0\">${peers.length ? peers.map(u => `<label class=\"tog\"><input type=\"checkbox\" value=\"${esc(u.id)}\" ${sel.has(u.id) ? 'checked' : ''}> ${esc(u.name || u.username)}</label>`).join('') : '<div class=\"muted\">No chat contacts yet.</div>'}</div>
    <div class=\"foot\"><button class=\"btn ghost\" type=\"button\" data-x>Cancel</button><button class=\"btn\" type=\"button\" data-ok>Save</button></div>`);
  const mode = () => (w.querySelector('input[name=ppm]:checked') || {}).value || 'all';
  const sync = () => { w.querySelector('#ppList').style.display = (mode() === 'only' || mode() === 'except') ? '' : 'none'; };
  w.querySelectorAll('input[name=ppm]').forEach(r => r.onchange = sync); sync();
  w.querySelector('[data-x]').onclick = () => w.remove();
  w.querySelector('[data-ok]').onclick = async () => {
    const ids = [...w.querySelectorAll('#ppList input:checked')].map(x => x.value);
    try{ const r = await api('setPhotoPrivacy', { mode:mode(), ids }); w.remove(); toast(r.mode === 'all' ? 'Your photo is visible to everyone' : r.mode === 'none' ? 'Your photo is hidden from everyone' : 'Photo privacy saved'); }
    catch(e){ handleErr(e); }
  };
}

/* ---------- Settings: connect Google Drive for chat media (main admin) ---------- */
/* ---------- Trash (main admin only): chat messages / photos / videos that users deleted ---------- */
S.trash = { items:null, total:0, mu:{}, q:'', busy:false, err:'' };
function trashCard(){
  return `<div class="card" id="trCard"><h3>🗑️ Trash <span><button class="btn ghost sm" type="button" onclick="trashLoad()">↻ Refresh</button></span></h3>
    <p class="muted" style="margin-bottom:12px">Every chat message, photo or video a user deletes disappears from the chat for everyone (nobody sees a “deleted” note) and is kept here with the date, time and the name of the person who deleted it. Only you can see this.</p>
    <input class="input" id="trQ" placeholder="Search name or text…" style="margin-bottom:12px" value="${esc(S.trash.q)}">
    <div id="trList"><div class="empty-state">Loading…</div></div></div>`;
}
function bindTrash(){
  if (!(S.me && S.me.primary) || S.setSec !== 'trash') return;
  const q = document.querySelector('#trQ'); if (q) q.oninput = e => { S.trash.q = e.target.value; trashDraw(); };
  trashLoad();
}
async function trashLoad(){
  const T = S.trash; if (T.busy) return; T.busy = true;
  try{
    const r = await api('trashList'); T.items = r.items || []; T.total = r.total || 0; T.err = ''; T.mu = {};
    trashDraw();
    const ids = []; T.items.forEach(x => { const o = chMedia({ text:x.text }); if (o && o.i && !ids.includes(o.i)) ids.push(o.i); });
    for (let i = 0; i < ids.length; i += 40){
      const part = ids.slice(i, i + 40);
      try{
        const t = await api('trashMediaTicket', { ids:part });
        part.forEach(id => { const k = t.tickets && t.tickets[id]; T.mu[id] = k ? API_URL + '/chat/media?' + new URLSearchParams({ id, u:k.u, e:k.e, k:k.k }).toString() : null; });
      }catch(e){ part.forEach(id => T.mu[id] = null); }
      trashDraw();
    }
  }catch(e){ T.err = (e && e.message) || 'Could not load the Trash'; trashDraw(); if (e && (e.code === 'AUTH' || e.code === 'PAYDUE')) handleErr(e); }
  finally{ T.busy = false; }
}
const trWhen = ms => ms ? new Date(ms).toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:true }) : '';
function trashItem(x){
  const o = chMedia({ text:x.text }); let body;
  if (o){
    const ic = o.k === 'vid' ? '🎥' : '📷', u = S.trash.mu[o.i];
    const med = u === undefined ? `<div class="tr-ph">${ic} Loading…</div>` : u === null ? `<div class="tr-ph">⚠️ ${ic} Could not load</div>`
      : o.k === 'vid' ? `<video class="tr-media" src="${esc(u)}" controls preload="metadata" playsinline></video>`
      : `<img class="tr-media" src="${esc(u)}" alt="" loading="lazy" onclick="trashView('${esc(o.i)}')">`;
    body = med + (o.c ? `<div class="tr-tx">${esc(o.c)}</div>` : '');
  } else body = `<div class="tr-tx">${esc(x.text)}</div>`;
  return `<div class="tr-item"><div class="tr-top"><b>${esc(x.by || 'User')}</b><span>deleted ${esc(trWhen(x.at))}</span></div>
    <div class="tr-meta">${esc(x.from)} → ${esc(x.to)} · sent ${esc(trWhen(x.sentMs) || x.sent)}</div>${body}</div>`;
}
function trashDraw(){
  const el = document.querySelector('#trList'); if (!el) return;
  const T = S.trash;
  if (T.err){ el.innerHTML = `<div class="empty-state"><b style="color:#b91c1c">${esc(T.err)}</b></div>`; return; }
  if (!T.items){ el.innerHTML = '<div class="empty-state">Loading…</div>'; return; }
  const q = (T.q || '').trim().toLowerCase();
  const list = T.items.filter(x => { if (!q) return true; const o = chMedia({ text:x.text }); return [x.by, x.from, x.to, o ? (o.c || o.n || '') : x.text].join(' ').toLowerCase().includes(q); });
  if (!list.length){ el.innerHTML = `<div class="empty-state">${T.items.length ? 'Nothing matches your search.' : 'The Trash is empty.'}</div>`; return; }
  el.innerHTML = list.map(trashItem).join('') + (T.total > T.items.length ? `<div class="muted" style="text-align:center;margin-top:8px">Showing the latest ${T.items.length} of ${T.total}. Older ones are in the “Trash Bin” sheet.</div>` : '');
}
function trashView(i){
  const u = S.trash.mu[i]; if (!u) return;
  const w = document.createElement('div'); w.className = 'ch-view';
  w.innerHTML = `<div class="cv-bar"><button class="ch-sbtn" data-x type="button">✕</button><a class="ch-sbtn" href="${esc(u + '&dl=1&n=photo')}" download>⬇ Save</a></div><img src="${esc(u)}" alt="">`;
  w.onclick = e => { if (e.target === w || e.target.closest('[data-x]')) w.remove(); };
  document.body.appendChild(w);
}
function driveCard(){
  return `<div class=\"card\" id=\"drvCard\"><h3>☁️ Chat photos & videos → Google Drive</h3>
    <p class=\"muted\" style=\"margin-bottom:12px\">Every photo and video sent in Chat is saved in a folder called <b>KS Chat Media</b> in the Google Drive you connect here. Only the main admin can connect it.</p>
    <div id=\"drvBody\"><div class=\"empty-state\">Loading…</div></div></div>`;
}
async function bindDrive(){
  const el = document.querySelector('#drvBody'); if (!el) return;
  const draw = r => {
    el.innerHTML = !r.configured ? '<div class=\"muted\">Google sign-in is not set up on the server yet (CAL_CLIENT_ID / CAL_CLIENT_SECRET / PUBLIC_URL), and it also needs the Drive scope — see the instructions.</div>'
      : r.connected ? `<div style=\"margin-bottom:10px\">✅ Connected${r.email ? ' as <b>' + esc(r.email) + '</b>' : ''}</div><button class=\"btn ghost\" type=\"button\" id=\"drvOff\">Disconnect</button>`
      : `<div style=\"margin-bottom:10px\" class=\"muted\">Not connected — photos and videos can’t be sent until you connect.</div><button class=\"btn\" type=\"button\" id=\"drvOn\">Connect Google Drive</button> <button class=\"btn ghost\" type=\"button\" id=\"drvRef\">I connected — refresh</button>`;
    const on = el.querySelector('#drvOn'), off = el.querySelector('#drvOff'), ref = el.querySelector('#drvRef');
    if (on) on.onclick = async () => { try{ const u = await api('driveAuthUrl'); window.open(u.url, '_blank'); }catch(e){ handleErr(e); } };
    if (ref) ref.onclick = async () => { try{ draw(await api('driveStatus')); }catch(e){ handleErr(e); } };
    if (off) off.onclick = async () => { if (!await confirmBox('Disconnect Google Drive?', 'New photos and videos can’t be sent until you connect again. Files already in Drive stay there, but chats won’t be able to show them.', 'Disconnect', true)) return; try{ await api('driveDisconnect'); draw(await api('driveStatus')); }catch(e){ handleErr(e); } };
  };
  try{ draw(await api('driveStatus')); }catch(e){ el.textContent = ''; }
}
function chatBack(){
  S.chat.sel.clear(); S.chat.with = null; document.body.classList.remove('chat-conv');
  chatRenderList(); chatRenderPane(); chatLoadUsers();
}
async function chatSend(){
  const c = S.chat, to = c.with, ta = $('#chInput'); if (!to || !ta) return;
  const text = ta.value.trim(); if (!text) return;
  if (c.ed[to]) return chatEditDo(to, text);
  ta.value = ''; c.drafts[to] = ''; ta.style.height = 'auto'; ta.focus();
  const cid = (window.crypto && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : String(Math.random()).slice(2) + Date.now()).slice(0, 14);
  const rq = c.rp[to];
  const m = { id:cid, t:Date.now(), mine:true, text, state:'pending', ...(rq ? { reply:{ i:rq.id, n:rq.n, t:rq.t, mine:rq.mine } } : {}) };
  c.rp[to] = null; chatCtxBar();
  (c.msgs[to] = c.msgs[to] || []).push(m); c.histLoaded[to] = true;
  chatRenderMsgs(true);
  await chatDeliver(to, m);
}
async function chatDeliver(to, m){
  const c = S.chat;
  try{
    const r = await chatApi('chatSend', { to, cid:m.id, text:m.text, reply:m.reply ? m.reply.i : undefined });
    const arr = c.msgs[to] || [], i = arr.findIndex(x => x.id === m.id);
    if (i >= 0) arr[i] = r.message; else arr.push(r.message);
    arr.sort((x, y) => x.t - y.t);
    const u = chatPeer(to); if (u){ u.lastText = chPrev(m.text); u.lastTime = r.message.t; u.lastMine = true; }
  }catch(e){ m.state = 'failed'; chatErr(e); if (!e.code || e.code === 'ERR') toast(e.message || 'Message not sent', true); }
  if (c.with === to) chatRenderMsgs(true);
  chatRenderList();
}
function chatRetry(id){
  const to = S.chat.with, m = (S.chat.msgs[to] || []).find(x => x.id === id);
  if (!m || m.state !== 'failed') return;
  m.state = 'pending'; chatRenderMsgs();
  if (m._file) chatUpload(to, m._file, '', m); else chatDeliver(to, m);
}
function chatTick(){
  const c = S.chat;
  if (!S.token || !S.d || document.hidden) return;                 // a hidden tab stops pinging, so the person shows as offline
  c.n++;
  if (c.n % 2 === 0 && !(S.view === 'chat' && c.with)) chatApi('chatLive', {}).catch(() => {});    // tiny "I am online" signal = delivered tick for the sender
  if (S.view === 'chat'){
    if (c.with) chatFetchConv();
    if (c.n % 3 === 0 || !c.loaded) chatLoadUsers();
    else { chatHeader(); }
  } else if (c.n % 5 === 0) chatPingNow();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.token && S.d){ chatLoadUsers(); if (S.view === 'chat' && S.chat.with) chatFetchConv(); } });

/* ---------- add the "Passwords" tab to the menu (copies the look of the Work tab) ---------- */
(function addPasswordsTab(){
  const nav = $('#nav'), src = nav && nav.querySelector('[data-v="work"]');
  if (!src || nav.querySelector('[data-v="passwords"]')) return;
  const b = src.cloneNode(true);
  b.dataset.v = 'passwords'; b.classList.remove('active', 'hidden');
  const ic = b.querySelector('svg, img, i');
  if (ic){ const sp = document.createElement('span'); sp.textContent = '🔑'; ic.replaceWith(sp); }
  const tn = []; const tw = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
  while (tw.nextNode()) if (tw.currentNode.nodeValue.trim()) tn.push(tw.currentNode);
  if (ic){ if (tn.length) tn[tn.length - 1].nodeValue = 'Passwords'; else b.append(' Passwords'); }
  else if (tn.length >= 2){ tn[0].nodeValue = '🔑'; tn[tn.length - 1].nodeValue = 'Passwords'; }
  else if (tn.length === 1) tn[0].nodeValue = '🔑 Passwords';
  else b.textContent = '🔑 Passwords';
  (nav.querySelector('[data-v="timetable"]') || src).after(b);
})();

/* ---------- add the "Links" tab to the menu (right after Passwords) ---------- */
(function addLinksTab(){
  const nav = $('#nav'), src = nav && nav.querySelector('[data-v="passwords"]');
  if (!src || nav.querySelector('[data-v="links"]')) return;
  const b = src.cloneNode(true);
  b.dataset.v = 'links'; b.classList.remove('active', 'hidden');
  const tw = document.createTreeWalker(b, NodeFilter.SHOW_TEXT), tn = [];
  while (tw.nextNode()) if (tw.currentNode.nodeValue.trim()) tn.push(tw.currentNode);
  tn.forEach(n => { n.nodeValue = n.nodeValue.replace('🔑', '🔗').replace('Passwords', 'Links'); });
  src.after(b);
})();

thApply();        // the Passwords / Links / LIC tabs now exist: put them in the saved order / names
boot();

/* =====================================================================
   VOICE / VIDEO CALLS  (WebRTC — the audio/video goes phone-to-phone; the server only passes the offer/answer)
   ===================================================================== */

/* =====================================================================
   ALERTS: message = notification + one tone + 2 vibrations ; call = ringing + continuous vibration
   ===================================================================== */
const ksVib = p => { try { navigator.vibrate && navigator.vibrate(p); } catch {} };
async function ksNotify(title, body, tag, extra){
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const o = Object.assign({ body, tag, renotify:true, silent:false, icon:'icon-192.png' }, extra || {});
    const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
    if (reg && reg.showNotification) await reg.showNotification(title, o); else new Notification(title, o);
  } catch {}
}
function chatAlert(){
  vcBeep(988, .18); setTimeout(() => vcBeep(1319, .28), 190);   // one short notification tone
  ksVib([250, 150, 250]);                                        // two vibrations
  if (document.hidden) ksNotify('💬 New message', 'You have a new message', 'ks-msg', { vibrate:[250, 150, 250] });
}
/* ask once (on the first tap) so notifications can show; also lets the browser play sounds */
(function(){
  try { if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {}); } catch {}
  const ask = () => {
    document.removeEventListener('pointerdown', ask, true);
    try { if ('Notification' in window && Notification.permission === 'default' && S.token) Notification.requestPermission(); } catch {}
  };
  document.addEventListener('pointerdown', ask, true);
})();
const VC = { timer:null, polling:false, busy:false, cid:null, pc:null, local:null, role:'', kind:'audio', peer:null, incoming:null,
  started:0, tick:null, ring:null, ice:null, muted:false, camOff:false, ending:false, lost:null, answered:false };
let vcActx = null;
function vcUnlock(){ try { vcActx = vcActx || new (window.AudioContext || window.webkitAudioContext)(); if (vcActx.state === 'suspended') vcActx.resume(); } catch {} }
['pointerdown', 'touchend', 'keydown'].forEach(ev => document.addEventListener(ev, vcUnlock, { passive:true }));
function vcBeep(freq, dur){
  if (!vcActx) return;
  try {
    const o = vcActx.createOscillator(), g = vcActx.createGain(), t = vcActx.currentTime;
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(vcActx.destination); o.start(t); o.stop(t + dur + 0.05);
  } catch {}
}
function vcRingStart(incoming){
  vcRingStop();
  const once = () => {
    if (incoming){ vcBeep(880, .3); setTimeout(() => vcBeep(660, .3), 380); setTimeout(() => vcBeep(880, .3), 800); setTimeout(() => vcBeep(660, .3), 1180); ksVib([1900]); }   // rings and buzzes non-stop
    else vcBeep(440, .7);
  };
  once(); VC.ring = setInterval(once, incoming ? 2000 : 3200);
}
function vcRingStop(){ clearInterval(VC.ring); VC.ring = null; try { navigator.vibrate && navigator.vibrate(0); } catch {} }

/* ---------- full-screen call screen ---------- */
function vcRoot(){
  let el = document.getElementById('vcUI'); if (el) return el;
  el = document.createElement('div'); el.id = 'vcUI'; el.className = 'vc hidden';
  el.innerHTML = `<video id="vcRemote" class="vc-remote" autoplay playsinline></video>
    <video id="vcLocal" class="vc-lsrc" autoplay playsinline muted></video><canvas id="vcLocalCv" class="vc-local hidden" width="208" height="296"></canvas>
    <div class="vc-top"><div class="vc-av" id="vcAv"></div><div class="vc-name" id="vcName"></div><div class="vc-stat" id="vcStat"></div></div>
    <button class="vc-minbtn" id="vcMin" type="button" aria-label="Back to chat" onclick="vcMini(true)">←</button>
    <div class="vc-bar" id="vcBar"></div>`;
  document.body.appendChild(el);
  let dr = null;                                              // small window: drag it anywhere, tap it to open the call full screen again
  el.addEventListener('pointerdown', e => {
    if (!el.classList.contains('vc-mini')){ vcPoke(); return; }   // full screen: any touch shows the buttons again
    dr = { x:e.clientX, y:e.clientY, l:el.offsetLeft, t:el.offsetTop, moved:false };
    try { el.setPointerCapture(e.pointerId); } catch {}
  });
  el.addEventListener('pointermove', e => {
    if (!dr) return;
    const dx = e.clientX - dr.x, dy = e.clientY - dr.y;
    if (!dr.moved && Math.abs(dx) + Math.abs(dy) < 8) return;
    dr.moved = true;
    const l = Math.max(0, Math.min(window.innerWidth - el.offsetWidth, dr.l + dx)), t = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, dr.t + dy));
    el.style.left = l + 'px'; el.style.top = t + 'px'; el.style.right = 'auto'; el.style.bottom = 'auto';
  });
  const dend = () => { if (!dr) return; const was = dr; dr = null; if (!was.moved) vcMini(false); };
  el.addEventListener('pointerup', dend); el.addEventListener('pointercancel', () => { dr = null; });
  return el;
}
function vcOpen(name, id, stat){
  const el = vcRoot(); el.classList.remove('hidden', 'vc-live', 'vc-mini', 'vc-hide'); el.classList.toggle('vc-audio', VC.kind !== 'video');
  clearTimeout(vcHideT); el.style.left = el.style.top = el.style.right = el.style.bottom = '';
  document.getElementById('vcName').textContent = name || '';
  const av = document.getElementById('vcAv'); av.textContent = (name || '?').trim().charAt(0).toUpperCase(); av.style.background = chColor(id || name);
  vcStat(stat || '');
  document.body.classList.add('vc-open');
}
const vcStat = t => { const e = document.getElementById('vcStat'); if (e) e.textContent = t; };
function vcBar(mode){
  const b = (cls, ico, label, fn) => `<button class="vc-btn ${cls}" onclick="${fn}" aria-label="${label}"><span>${ico}</span><small>${label}</small></button>`;
  let h = '';
  if (mode === 'incoming') h = b('red', '✖', 'Decline', 'vcDecline()') + b('green', '📞', 'Accept', 'vcAccept()');
  else {
    h = b('dark' + (VC.muted ? ' on' : ''), VC.muted ? '🔇' : '🎤', VC.muted ? 'Unmute' : 'Mute', 'vcMute()');
    if (VC.kind === 'video') h += b('dark' + (VC.camOff ? ' on' : ''), VC.camOff ? '🚫' : '📷', VC.camOff ? 'Camera on' : 'Camera off', 'vcCam()');
    h += b('red', '✖', 'End', 'vcHangup()');
  }
  document.getElementById('vcBar').innerHTML = h;
}
function vcClose(){
  const el = document.getElementById('vcUI');
  clearTimeout(vcHideT);
  if (el){ el.classList.add('hidden'); el.classList.remove('vc-mini', 'vc-hide'); el.style.left = el.style.top = el.style.right = el.style.bottom = ''; }
  document.body.classList.remove('vc-open');
}
/* Video call: the buttons (mute / camera / end / back) hide 5 s after the call starts; touch the screen and they come back. */
let vcHideT = null;
function vcPoke(){
  const el = document.getElementById('vcUI'); if (!el) return;
  el.classList.remove('vc-hide'); clearTimeout(vcHideT);
  if (VC.kind === 'video' && VC.started && !el.classList.contains('vc-mini') && !el.classList.contains('hidden'))
    vcHideT = setTimeout(() => { el.classList.add('vc-hide'); }, 5000);
}
/* Back button: shrink the call to a small window so you can chat while the call goes on; tap the window to make it big again. */
function vcMini(on){
  const el = document.getElementById('vcUI'); if (!el || el.classList.contains('hidden')) return;
  el.classList.toggle('vc-mini', !!on);
  el.style.left = el.style.top = el.style.right = el.style.bottom = '';
  document.body.classList.toggle('vc-open', !on);
  if (on){
    clearTimeout(vcHideT); el.classList.remove('vc-hide');
    const id = VC.peer && VC.peer.id;                                  // show the chat with the person you are talking to
    if (id && !(S.view === 'chat' && S.chat.with === id)){
      try { if (S.view !== 'chat') go('chat'); if (chatPeer(id)) chatOpen(id); } catch {}
    }
  } else vcPoke();
}

/* ---------- WebRTC plumbing ---------- */
async function vcIce(){
  if (VC.ice) return VC.ice;
  try { VC.ice = (await chatApi('callConfig')).iceServers; } catch { VC.ice = [{ urls:'stun:stun.l.google.com:19302' }]; }
  return VC.ice;
}
async function vcMedia(kind){
  const audio = { echoCancellation:true, noiseSuppression:true };
  if (kind !== 'video') VC.local = await navigator.mediaDevices.getUserMedia({ audio, video:false });
  else {
    /* Some phones switch their camera into a low-quality mode (wrong, bluish colours) when a small 640x480 picture is forced.
       So ask for a normal HD picture first and only fall back to simpler requests if the phone refuses. */
    const tries = [{ facingMode:'user', width:{ ideal:1280 }, height:{ ideal:720 }, frameRate:{ ideal:30, max:30 } }, { facingMode:'user' }, true];
    let err = null;
    for (const v of tries){
      try{ VC.local = await navigator.mediaDevices.getUserMedia({ audio, video:v }); err = null; break; }
      catch(e){ err = e; if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError' || e.name === 'NotReadableError')) break; }
    }
    if (!VC.local) throw err || new Error('Could not start the camera.');
    const vt = VC.local.getVideoTracks()[0];                     // switch the camera's own automatic colour balance / exposure / focus on
    if (vt && vt.getCapabilities){
      try{
        const cap = vt.getCapabilities() || {}, adv = {};
        if (cap.whiteBalanceMode && cap.whiteBalanceMode.includes('continuous')) adv.whiteBalanceMode = 'continuous';
        if (cap.exposureMode && cap.exposureMode.includes('continuous')) adv.exposureMode = 'continuous';
        if (cap.focusMode && cap.focusMode.includes('continuous')) adv.focusMode = 'continuous';
        if (Object.keys(adv).length) await vt.applyConstraints({ advanced:[adv] });
      }catch(e){}
    }
  }
  const lv = document.getElementById('vcLocal'), cv = document.getElementById('vcLocalCv');
  if (kind === 'video'){ lv.srcObject = VC.local; lv.play && lv.play().catch(() => {}); cv.classList.remove('hidden'); vcLocalDraw(); }
  else cv.classList.add('hidden');
}
/* My own small picture is painted on a canvas (not shown as a <video>): on some Android phones a mirrored, rounded <video> is drawn with red and blue swapped
   (faces look blue). A canvas always shows the true colours. Double-tap the small picture to swap red/blue by hand if a phone still shows the wrong colours. */
const vcSwap = () => { try { return localStorage.getItem('ks_vc_swap') === '1'; } catch (e) { return false; } };
function vcLocalDraw(){
  const lv = document.getElementById('vcLocal'), cv = document.getElementById('vcLocalCv'); if (!lv || !cv) return;
  cancelAnimationFrame(VC.lraf);
  const ctx = cv.getContext('2d', { willReadFrequently:true }); let last = 0;
  if (!cv._dbl){ cv._dbl = 1; cv.addEventListener('dblclick', () => { try { localStorage.setItem('ks_vc_swap', vcSwap() ? '0' : '1'); } catch (e) {} toast(vcSwap() ? 'Colour fix ON (red/blue swapped)' : 'Colour fix OFF'); }); }
  const step = ts => {
    VC.lraf = requestAnimationFrame(step);
    if (ts - last < 33 || document.hidden || lv.readyState < 2 || !lv.videoWidth) return;
    last = ts;
    const cw = cv.width, ch = cv.height, vw = lv.videoWidth, vh = lv.videoHeight, s = Math.max(cw / vw, ch / vh), sw = cw / s, sh = ch / s;
    ctx.save(); ctx.translate(cw, 0); ctx.scale(-1, 1); ctx.drawImage(lv, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, cw, ch); ctx.restore();
    if (vcSwap()){ const im = ctx.getImageData(0, 0, cw, ch), d = im.data; for (let i = 0; i < d.length; i += 4){ const r = d[i]; d[i] = d[i + 2]; d[i + 2] = r; } ctx.putImageData(im, 0, 0); }
  };
  VC.lraf = requestAnimationFrame(step);
}
function vcMakePc(){
  const pc = new RTCPeerConnection({ iceServers: VC.ice }), remote = new MediaStream(), rv = document.getElementById('vcRemote');
  rv.srcObject = remote;
  pc.ontrack = e => { remote.addTrack(e.track); rv.play && rv.play().catch(() => {}); };
  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    if (s === 'connected'){ clearTimeout(VC.lost); vcConnected(); }
    else if (s === 'failed') vcEnd('Call failed — check the internet', true);
    else if (s === 'disconnected'){ clearTimeout(VC.lost); VC.lost = setTimeout(() => { if (VC.pc && VC.pc.connectionState !== 'connected') vcEnd('Connection lost', true); }, 10000); }
  };
  VC.local.getTracks().forEach(t => pc.addTrack(t, VC.local));
  return pc;
}
/* wait (max 3 s) until the phone has found its network addresses, so the offer/answer carries them all */
function vcGathered(pc){
  return new Promise(res => {
    if (pc.iceGatheringState === 'complete') return res();
    const done = () => { pc.removeEventListener('icegatheringstatechange', chk); clearTimeout(t); res(); };
    const chk = () => { if (pc.iceGatheringState === 'complete') done(); };
    const t = setTimeout(done, 3000);
    pc.addEventListener('icegatheringstatechange', chk);
  });
}
const vcDesc = pc => ({ type:pc.localDescription.type, sdp:pc.localDescription.sdp });
function vcConnected(){
  if (VC.started) return;
  VC.started = Date.now(); vcRingStop(); vcBar('call');
  document.getElementById('vcUI').classList.add('vc-live'); vcPoke();
  const upd = () => { const s = Math.floor((Date.now() - VC.started) / 1000); vcStat(String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0')); };
  upd(); VC.tick = setInterval(upd, 1000);
}
function vcErrText(e){
  if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) return 'Please allow microphone' + (VC.kind === 'video' ? ' and camera' : '') + ' access for this site.';
  if (e && (e.name === 'NotFoundError' || e.name === 'OverconstrainedError')) return 'No microphone' + (VC.kind === 'video' ? ' / camera' : '') + ' found on this device.';
  if (e && e.name === 'NotReadableError') return 'The microphone or camera is being used by another app.';
  return (e && e.message) || 'Could not start the call.';
}
function vcCleanup(){
  vcRingStop(); clearInterval(VC.tick); clearTimeout(VC.lost); cancelAnimationFrame(VC.lraf);
  try { VC.pc && VC.pc.close(); } catch {}
  try { VC.local && VC.local.getTracks().forEach(t => t.stop()); } catch {}
  ['vcRemote', 'vcLocal'].forEach(id => { const v = document.getElementById(id); if (v){ v.srcObject = null; } });
  const lcv = document.getElementById('vcLocalCv'); if (lcv) lcv.classList.add('hidden');
  Object.assign(VC, { busy:false, cid:null, pc:null, local:null, role:'', peer:null, incoming:null, started:0, tick:null, muted:false, camOff:false, ending:false, answered:false });
  vcClose();
}
async function vcFail(e){
  const msg = vcErrText(e), cid = VC.cid;
  if (cid){ try { await chatApi('callEnd', { cid, reason:'failed' }); } catch {} }
  vcCleanup(); toast(msg, true); chatErr(e);
}
async function vcEnd(msg, notify){
  if (VC.ending) return; VC.ending = true;
  const cid = VC.cid || (VC.incoming && VC.incoming.id), dur = VC.started ? Math.round((Date.now() - VC.started) / 1000) : 0;
  if (notify && cid){ try { await chatApi('callEnd', { cid, reason: /fail|lost/i.test(msg || '') ? 'failed' : '' }); } catch {} }
  vcCleanup();
  toast(msg || (dur ? 'Call ended · ' + Math.floor(dur / 60) + ':' + String(dur % 60).padStart(2, '0') : 'Call ended'), !!msg && /fail|lost/i.test(msg));
}

/* ---------- caller ---------- */
async function vcDial(kind){
  const u = chatPeer(S.chat.with); if (!u) return;
  if (VC.busy || VC.cid || VC.incoming) return toast('You are already in a call', true);
  if (!(window.isSecureContext && navigator.mediaDevices && window.RTCPeerConnection)) return toast('Calls need the https address and an up-to-date browser', true);
  vcUnlock();
  VC.busy = true; VC.role = 'caller'; VC.kind = kind; VC.peer = { id:u.id, name:u.name || u.username }; VC.ending = false;
  vcOpen(VC.peer.name, u.id, 'Starting…'); vcBar('call');
  try {
    await vcMedia(kind); await vcIce();
    VC.pc = vcMakePc();
    await VC.pc.setLocalDescription(await VC.pc.createOffer());
    await vcGathered(VC.pc);
    const r = await chatApi('callStart', { to:u.id, kind, offer:vcDesc(VC.pc) });
    VC.cid = r.id; vcStat('Calling…'); vcRingStart(false); vcTick();
  } catch (e) { vcFail(e); }
}

/* ---------- receiver ---------- */
function vcShowIncoming(inc){
  VC.incoming = inc; VC.kind = inc.kind; VC.peer = { id:inc.from, name:inc.fromName };
  vcOpen(inc.fromName, inc.from, 'Incoming ' + (inc.kind === 'video' ? 'video' : 'voice') + ' call…'); vcBar('incoming'); vcRingStart(true);
  if (document.hidden) ksNotify('📞 Incoming ' + (inc.kind === 'video' ? 'video' : 'voice') + ' call', (inc.fromName || 'Someone') + ' is calling you', 'ks-call', { requireInteraction:true, vibrate:[1000, 300, 1000, 300, 1000, 300, 1000] });
}
async function vcAccept(){
  const inc = VC.incoming; if (!inc || VC.busy) return;
  vcUnlock(); vcRingStop(); VC.busy = true; VC.role = 'callee'; VC.ending = false;
  vcStat('Connecting…'); vcBar('call');
  try {
    await vcMedia(inc.kind); await vcIce();
    VC.pc = vcMakePc();
    await VC.pc.setRemoteDescription(inc.offer);
    await VC.pc.setLocalDescription(await VC.pc.createAnswer());
    await vcGathered(VC.pc);
    await chatApi('callAnswer', { cid:inc.id, answer:vcDesc(VC.pc) });
    VC.cid = inc.id; VC.incoming = null; VC.answered = true;
  } catch (e) { VC.cid = inc.id; vcFail(e); }
}
function vcDecline(){ vcEnd('Call declined', true); }
function vcHangup(){ vcEnd('', true); }
function vcMute(){ VC.muted = !VC.muted; VC.local && VC.local.getAudioTracks().forEach(t => t.enabled = !VC.muted); vcBar('call'); }
function vcCam(){ VC.camOff = !VC.camOff; VC.local && VC.local.getVideoTracks().forEach(t => t.enabled = !VC.camOff); vcBar('call'); }

/* ---------- polling (idle: look for incoming calls ; in a call: follow its state) ---------- */
async function vcTick(){
  if (!S.token || !S.d || VC.polling || VC.ending) return;
  if (document.hidden && !VC.cid && !VC.incoming) return;
  VC.polling = true;
  try {
    if (VC.cid){
      const { call } = await chatApi('callPoll', { cid:VC.cid });
      if (!VC.cid) return;
      if (call.state === 'ended'){
        const why = { declined:'Call declined', cancelled:'Call cancelled', missed:'No answer', lost:'Connection lost', failed:'Call failed', gone:'Call ended' }[call.reason];
        return vcEnd(call.byMe ? '' : (why || ''), false);
      }
      if (call.state === 'active' && call.answer && VC.role === 'caller' && !VC.answered && VC.pc){
        VC.answered = true; vcRingStop(); vcStat('Connecting…');
        await VC.pc.setRemoteDescription(call.answer);
      }
    } else if (!VC.busy){
      const r = await chatApi('callPoll', {});
      if (r.incoming && !VC.incoming) vcShowIncoming(r.incoming);
      else if (!r.incoming && VC.incoming){ VC.ending = true; vcCleanup(); toast('Missed call'); }
    }
  } catch (e) { chatErr(e); }
  finally { VC.polling = false; }
}
function vcStart(){ clearInterval(VC.timer); VC.timer = setInterval(vcTick, 1500); }
function vcReset(){ clearInterval(VC.timer); VC.timer = null; if (VC.cid || VC.incoming || VC.busy) { VC.ending = false; vcEnd('', true); } else vcCleanup(); }
document.addEventListener('visibilitychange', () => { if (!document.hidden) vcTick(); });

/* =====================================================================
   LUDO  (2 to 4 players, online — the server rolls the dice and checks every move)
   ===================================================================== */
const LU = { gid:null, g:null, inc:null, busy:false, timer:null, polling:false, sig:'', idleAt:0, built:false };
const LU_COL = ['#e53935', '#43a047', '#fdd835', '#1e88e5'];
const LU_PATH = [[1,6],[2,6],[3,6],[4,6],[5,6],[6,5],[6,4],[6,3],[6,2],[6,1],[6,0],[7,0],[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[9,6],[10,6],[11,6],[12,6],[13,6],[14,6],[14,7],[14,8],[13,8],[12,8],[11,8],[10,8],[9,8],[8,9],[8,10],[8,11],[8,12],[8,13],[8,14],[7,14],[6,14],[6,13],[6,12],[6,11],[6,10],[6,9],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8],[0,7],[0,6]];
const LU_SAFE = [0, 8, 13, 21, 26, 34, 39, 47];
const LU_YARD = [[0,0],[9,0],[9,9],[0,9]];
function luXY(ci, pos, ti){
  if (pos < 0){ const o = LU_YARD[ci]; return [o[0] + 2 + (ti % 2) * 2, o[1] + 2 + (ti >> 1) * 2]; }
  if (pos <= 50){ const c = LU_PATH[(13 * ci + pos) % 52]; return [c[0] + .5, c[1] + .5]; }
  if (pos <= 55){ const k = pos - 51; return [[1 + k + .5, 7.5], [7.5, 1 + k + .5], [13 - k + .5, 7.5], [7.5, 13 - k + .5]][ci]; }
  const b = [[6.3, 7.5], [7.5, 6.3], [8.7, 7.5], [7.5, 8.7]][ci];
  return ci % 2 ? [b[0] - .45 + ti * .3, b[1]] : [b[0], b[1] - .45 + ti * .3];
}
(function luCss(){
  if (document.getElementById('ludoCss')) return;
  const st = document.createElement('style'); st.id = 'ludoCss';
  st.textContent = `
.lu{position:fixed;inset:0;z-index:9998;background:#0f172a;color:#fff;display:flex;flex-direction:column;align-items:center;padding:calc(10px + env(safe-area-inset-top)) 12px calc(12px + env(safe-area-inset-bottom));overflow:auto}
.lu-top{width:100%;max-width:460px;display:flex;align-items:center;justify-content:space-between;gap:10px;font-weight:800;font-size:calc(18px*var(--fs))}
.lu-top button{background:rgba(255,255,255,.12);color:#fff;border:0;border-radius:10px;padding:8px 12px;font-weight:700;font-size:calc(14px*var(--fs))}
.lu-pl{width:100%;max-width:460px;display:flex;gap:8px;margin:10px 0}
.lu-p{flex:1;display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:12px;background:rgba(255,255,255,.08);border:2px solid transparent;min-width:0;font-weight:700;font-size:calc(14px*var(--fs))}
.lu-p.on{border-color:#fff;background:rgba(255,255,255,.18)}
.lu-p i{width:14px;height:14px;border-radius:50%;flex:none;border:2px solid #fff}
.lu-p span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lu svg{width:100%;max-width:460px;aspect-ratio:1;background:#fff;border-radius:12px;touch-action:manipulation}
.lt{transition:transform .35s ease}
.lt circle.b{stroke:#fff;stroke-width:.1}
.lt.go circle.r{fill:none;stroke:#fff;stroke-width:.12;animation:luP 0.8s infinite}
.lt.go{cursor:pointer}
@keyframes luP{0%,100%{opacity:1;r:.5}50%{opacity:.25;r:.62}}
.lu-msg{margin:12px 0 6px;font-size:calc(15px*var(--fs));font-weight:600;text-align:center;min-height:22px}
.lu-dice{display:flex;align-items:center;gap:16px;justify-content:center}
.lu-die{font-size:calc(64px*var(--fs));line-height:1;width:76px;height:76px;display:grid;place-items:center;background:#fff;color:#0f172a;border-radius:16px}
.lu-die.sh{animation:luS .45s}
@keyframes luS{0%{transform:rotate(0)}25%{transform:rotate(-25deg)}50%{transform:rotate(22deg)}75%{transform:rotate(-12deg)}100%{transform:rotate(0)}}
.lu-roll{background:#22c55e;color:#fff;border:0;border-radius:14px;padding:16px 26px;font-size:calc(18px*var(--fs));font-weight:800}
.lu-roll:disabled{opacity:.4}
.lu-card{margin:auto;text-align:center;display:flex;flex-direction:column;gap:14px;align-items:center;padding:20px}
.lu-card .big{font-size:calc(56px*var(--fs))}.lu-card h2{margin:0;font-size:calc(22px*var(--fs))}.lu-card p{margin:0;opacity:.8}
.lu-card .row{display:flex;gap:12px}
.lu-card button{border:0;border-radius:12px;padding:13px 22px;font-weight:800;font-size:calc(16px*var(--fs));color:#fff;background:#22c55e}
.lu-card button.x{background:#ef4444}.lu-card button.g{background:rgba(255,255,255,.18)}`;
  document.head.appendChild(st);
})();
function luEl(){
  let el = document.getElementById('ludo');
  if (!el){ el = document.createElement('div'); el.id = 'ludo'; el.className = 'lu'; document.body.appendChild(el); }
  return el;
}
function luClose(){ const el = document.getElementById('ludo'); if (el) el.remove(); LU.gid = null; LU.g = null; LU.inc = null; LU.built = false; LU.sig = ''; LU.busy = false; }
function luCard(icon, title, sub, btns){
  const el = luEl(); LU.built = false;
  el.innerHTML = `<div class="lu-card"><div class="big">${icon}</div><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}<div class="row">${btns}</div></div>`;
}
async function ludoDial(){
  const u = chatPeer(S.chat.with); if (!u) return;
  if (LU.busy || LU.gid || LU.inc) return toast('You are already in a Ludo game', true);
  LU.busy = true;
  try{
    const r = await chatApi('ludoInvite', u.isGroup ? { group:u.id } : { to:u.id });
    LU.gid = r.id; LU.sig = '';
    luCard('🎲', u.isGroup ? 'Invite sent to the group' : 'Inviting ' + (u.name || u.username) + '…', u.isGroup ? 'Waiting for ' + r.invited + ' member' + (r.invited === 1 ? '' : 's') + ' to join (they need the app open)' : 'Waiting for them to accept (they need the app open)', '<button class="x" onclick="ludoLeave()">Cancel</button>');
  }catch(e){ LU.busy = false; chatErr(e); toast(e.message, true); }
}
/* lobby: shown to everybody who accepted while the game waits for the others */
function luLobby(g){
  const names = g.players.map((p, i) => (i === g.me ? 'You' : p.name) + (i === 0 ? ' (host)' : '')).join(' · ');
  const wait = g.pend.length ? 'Waiting for: ' + g.pend.join(', ') : '';
  const btns = g.host ? `<button class="x" onclick="ludoLeave()">Cancel</button>${g.players.length >= 2 ? '<button onclick="ludoStartNow()">▶ Start now</button>' : ''}` : '<button class="x" onclick="ludoLeave()">Leave</button>';
  luCard('🎲', (g.group ? g.group + ' · ' : '') + 'Ludo lobby (' + g.players.length + '/4)', names + (wait ? '\n' + wait : '') + (g.host ? '' : '\nThe host will start the game'), btns);
  const p = document.querySelector('#ludo .lu-card p'); if (p) p.style.whiteSpace = 'pre-line';
}
async function ludoStartNow(){
  try{ await chatApi('ludoStart', { gid:LU.gid }); }catch(e){ chatErr(e); toast(e.message, true); }
  ludoTick(true);
}
async function ludoAccept(){
  const inc = LU.inc; if (!inc) return;
  try{ await chatApi('ludoAccept', { gid:inc.id }); LU.gid = inc.id; LU.inc = null; LU.busy = true; LU.sig = ''; ludoTick(true); }
  catch(e){ luClose(); chatErr(e); toast(e.message, true); }
}
async function ludoLeave(){
  const g = LU.g, gid = LU.gid || (LU.inc && LU.inc.id);
  if (g && g.state === 'playing' && !confirm('Leave the game? You will lose.')) return;
  if (gid){ try{ await chatApi('ludoLeave', { gid }); }catch(e){} }
  luClose();
}
async function ludoRoll(){
  const b = document.getElementById('luRoll'); if (b) b.disabled = true;
  const d = document.getElementById('luDie'); if (d) d.classList.add('sh');
  try{ await chatApi('ludoRoll', { gid:LU.gid }); }catch(e){ chatErr(e); toast(e.message, true); }
  ludoTick(true);
}
async function ludoMove(t){
  const g = LU.g; if (!g || g.state !== 'playing' || g.turn !== g.me || !g.movable.includes(t)) return;
  g.movable = [];                                    // block double taps
  try{ await chatApi('ludoMove', { gid:LU.gid, token_i:t }); }catch(e){ chatErr(e); toast(e.message, true); }
  ludoTick(true);
}
function luBuild(){
  const el = luEl(), g = LU.g;
  let b = '';
  [0,1,2,3].forEach(ci => { const o = LU_YARD[ci];
    b += `<rect x="${o[0]}" y="${o[1]}" width="6" height="6" fill="${LU_COL[ci]}"/><rect x="${o[0] + 1}" y="${o[1] + 1}" width="4" height="4" rx=".5" fill="#fff"/>`;
    for (let t = 0; t < 4; t++){ const p = luXY(ci, -1, t); b += `<circle cx="${p[0]}" cy="${p[1]}" r=".42" fill="${LU_COL[ci]}" opacity=".25"/>`; } });
  LU_PATH.forEach((c, i) => {
    const si = [0, 13, 26, 39].indexOf(i);
    b += `<rect x="${c[0]}" y="${c[1]}" width="1" height="1" fill="${si >= 0 ? LU_COL[si] : '#fff'}" stroke="#94a3b8" stroke-width=".05"/>`;
    if (LU_SAFE.includes(i) && si < 0) b += `<text x="${c[0] + .5}" y="${c[1] + .72}" font-size=".7" text-anchor="middle" fill="#64748b">★</text>`;
  });
  [0,1,2,3].forEach(ci => { for (let k = 0; k < 5; k++){ const p = luXY(ci, 51 + k, 0);
    b += `<rect x="${p[0] - .5}" y="${p[1] - .5}" width="1" height="1" fill="${LU_COL[ci]}" stroke="#94a3b8" stroke-width=".05"/>`; } });
  b += `<polygon points="6,6 6,9 7.5,7.5" fill="${LU_COL[0]}"/><polygon points="6,6 9,6 7.5,7.5" fill="${LU_COL[1]}"/><polygon points="9,6 9,9 7.5,7.5" fill="${LU_COL[2]}"/><polygon points="6,9 9,9 7.5,7.5" fill="${LU_COL[3]}"/>`;
  let tk = '';
  for (let pi = 0; pi < g.players.length; pi++) for (let t = 0; t < 4; t++){
    const col = LU_COL[g.colors[pi]];
    tk += `<g class="lt" id="lt${pi}_${t}" onclick="ludoMove(${t})" style="transform:translate(0px,0px)"><circle class="r" r=".5" fill="none"/><circle class="b" r=".36" fill="${col}"/><circle r=".14" fill="#fff" opacity=".7"/></g>`;
  }
  el.innerHTML = `<div class="lu-top"><span>🎲 Ludo</span><button onclick="ludoLeave()">Leave</button></div>
    <div class="lu-pl" id="luPl"></div>
    <svg viewBox="0 0 15 15">${b}${tk}</svg>
    <div class="lu-msg" id="luMsg"></div>
    <div class="lu-dice"><div class="lu-die" id="luDie">🎲</div><button class="lu-roll" id="luRoll" onclick="ludoRoll()">Roll</button></div>`;
  LU.built = true;
}
function luRender(){
  const g = LU.g; if (!g) return;
  if (!LU.built) luBuild();
  const mine = g.me, myTurn = g.state === 'playing' && g.turn === mine;
  // tokens (small offset when several share a square)
  const seen = {};
  for (let pi = 0; pi < g.players.length; pi++) for (let t = 0; t < 4; t++){
    const pos = g.tokens[pi][t], ci = g.colors[pi], xy = luXY(ci, pos, t), k = xy[0].toFixed(2) + ',' + xy[1].toFixed(2);
    const n = pos >= 0 && pos < 56 ? (seen[k] = (seen[k] || 0) + 1) - 1 : 0;
    const el = document.getElementById('lt' + pi + '_' + t); if (!el) continue;
    el.style.display = g.out && g.out[pi] ? 'none' : '';
    el.style.transform = `translate(${xy[0] + n * .16}px,${xy[1] - n * .16}px)`;
    el.classList.toggle('go', pi === mine && myTurn && g.movable.includes(t));
  }
  $('#luPl').innerHTML = g.players.map((p, i) => `<div class="lu-p ${g.state === 'playing' && g.turn === i ? 'on' : ''}" style="${g.out && g.out[i] ? 'opacity:.35' : ''}"><i style="background:${LU_COL[g.colors[i]]}"></i><span>${esc(i === mine ? 'You' : p.name)}</span></div>`).join('');
  const die = $('#luDie'), v = g.last && g.last.v;
  die.textContent = v ? '⚀⚁⚂⚃⚄⚅'[v - 1] : '🎲'; die.classList.remove('sh');
  const rb = $('#luRoll'); rb.style.display = myTurn && !g.roll ? '' : 'none'; rb.disabled = false;
  let msg = g.msg || '';
  if (myTurn) msg = g.roll ? 'You rolled ' + g.roll + ' — tap a glowing token' : (msg ? msg + ' · ' : '') + 'Your turn — roll the dice';
  else if (g.state === 'playing') msg = (msg ? msg + ' · ' : '') + esc0(g.players[g.turn].name) + ' is playing…';
  $('#luMsg').textContent = msg;
}
const esc0 = v => String(v ?? '');
function luOver(g){
  const won = g.winner === g.me, name = (g.players[g.winner] || {}).name || 'Opponent';
  const why = { won:'', resigned: won ? 'Everybody else left the game.' : '', left: won ? 'The others went offline.' : '' }[g.reason] || '';
  luRender();
  const el = luEl(), card = document.createElement('div'); card.className = 'lu-card'; card.style.cssText = 'position:absolute;inset:0;background:rgba(15,23,42,.92);justify-content:center';
  card.innerHTML = `<div class="big">${won ? '🏆' : '😔'}</div><h2>${won ? 'You won!' : esc(name) + ' won'}</h2>${why ? `<p>${esc(why)}</p>` : ''}<div class="row"><button onclick="luClose()">Close</button></div>`;
  el.appendChild(card);
}
async function ludoTick(force){
  if (!S.token || !S.d || LU.polling) return;
  const inGame = !!LU.gid;
  if (!inGame && !force){
    if (LU.busy || document.hidden || Date.now() - LU.idleAt < 2000) return;
    LU.idleAt = Date.now();
  }
  LU.polling = true;
  try{
    if (inGame){
      const { game } = await chatApi('ludoPoll', { gid:LU.gid }); if (!LU.gid) return;
      LU.g = game;
      if (game.state === 'over' && !game.players.length){ luClose(); return toast('Game ended'); }
      if (game.state === 'invite'){
        const sig = 'lobby' + game.ev + '|' + game.players.length + '|' + game.pend.join(',');
        if (sig !== LU.sig){ LU.sig = sig; luLobby(game); }
        return;
      }
      if (game.out && game.me >= 0 && game.out[game.me] && game.state === 'playing'){ luClose(); return; }
      if (game.state === 'over'){
        const sig = 'over' + game.ev + game.reason; if (sig === LU.sig) return; LU.sig = sig;
        if (game.reason === 'declined' || game.reason === 'noanswer' || game.reason === 'cancelled'){
          const t = game.reason === 'declined' ? 'Invite declined' : game.reason === 'noanswer' ? 'No answer' : 'Invite cancelled';
          luCard('🎲', t, '', '<button onclick="luClose()">OK</button>'); LU.gid = null; return;
        }
        return luOver(game);
      }
      const sig = game.state + game.ev + '|' + game.turn + '|' + game.roll + '|' + JSON.stringify(game.tokens) + game.me + '|' + (game.out || []).join();
      if (sig !== LU.sig){ LU.sig = sig; luRender(); }
    } else {
      const r = await chatApi('ludoPoll', {});
      if (r.incoming && !LU.inc){
        LU.inc = r.incoming;
        luCard('🎲', r.incoming.fromName + ' invited you to Ludo', r.incoming.group ? 'Group “' + r.incoming.group + '” · up to 4 players' : 'Play online together', '<button class="x" onclick="ludoLeave()">Decline</button><button onclick="ludoAccept()">Accept</button>');
      } else if (!r.incoming && LU.inc){ luClose(); toast('Ludo invite expired'); }
    }
  }catch(e){ chatErr(e); }
  finally{ LU.polling = false; }
}
function ludoStart(){ clearInterval(LU.timer); LU.timer = setInterval(() => ludoTick(false), 1000); }
function ludoReset(){ clearInterval(LU.timer); LU.timer = null; const gid = LU.gid || (LU.inc && LU.inc.id); if (gid) chatApi('ludoLeave', { gid }).catch(() => {}); luClose(); }

/* =====================================================================
   VCS PROCESSING — live activity monitor (Settings, main admin only)
   Shows every request: Browser -> Render server -> Google Sheets / Calendar / Drive / ...
   Server events come from GET /live/stream (kept open only while this card is open).
   The browser records its own side of each request, so "never reached Render" is visible too.
   ===================================================================== */
const LV_DEST = { sheets:['📊','Google Sheets'], cache:['⚡','Server memory'], oauth:['🔑','Google login'], calendar:['📅','Google Calendar'], drive:['☁️','Google Drive'],
  translate:['🌐','Translate'], github:['🐙','GitHub'], mail:['✉️','E-mail'], turn:['📞','Call relay'], other:['🔗','Other'] };
const LV_NODES = ['sheets','calendar','drive','oauth','translate','github','mail','turn'];
const LV_POLL = new Set(['chatLive','callPoll','ludoPoll','callConfig','chatPing','chatFetch','getAll','status']);
const LV_ACT = { login:'Sign in', logout:'Sign out', getAll:'Load / refresh all data', setAttendance:'Mark attendance', addExpense:'Add expense', updateExpense:'Edit expense', deleteExpense:'Delete expense',
  addWork:'Add work entry', updateWork:'Edit work entry', deleteWork:'Delete work entry', addVcs:'Add VCS complaint', updateVcs:'Update VCS complaint', addRack:'Add rack item', updateRack:'Edit rack item',
  deleteRack:'Delete rack item', saveRackData:'Save rack data', setTimetable:'Time table change', chatSend:'Send chat message', chatLive:'Chat live tick', chatFetch:'Load chat', chatPing:'Online ping',
  callPoll:'Call check', ludoPoll:'Ludo check', chatTranslate:'Translate chat message', saveSettings:'Save settings', saveUser:'Save user', deleteUser:'Delete user', addEmployee:'Add employee',
  updateEmployee:'Edit employee', deleteEmployee:'Delete employee', changeCredentials:'Change login', calSyncAll:'Sync Google Calendar', listUsers:'List users', activityLog:'Activity log',
  deployUpload:'Deploy: publish files', deployProgress:'Deploy: check progress', updList:'Updates list', bioLogin:'Fingerprint sign in', status:'Server check' };
const lvAct = a => LV_ACT[a] || a;
const lvTime = t => new Date(t).toLocaleTimeString('en-GB');
const lvDur = ms => ms == null ? '' : ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + ' s';
const lvAgo = s => s < 90 ? Math.round(s) + ' s' : s < 5400 ? Math.round(s / 60) + ' min' : (s / 3600).toFixed(1) + ' h';

/* ----- browser side of each request (called from callServer) ----- */
function liveCliStart(action){
  const rid = Math.random().toString(36).slice(2, 9) + (++LV.cn).toString(36);
  LV.cli.set(rid, { rid, a:String(action || '?'), t0:Date.now(), p0:performance.now(), st:'wait', poll:LV_POLL.has(action) });
  if (LV.cli.size > 160) LV.cli.delete(LV.cli.keys().next().value);
  liveSoon(); return rid;
}
function liveCliEnd(rid, ok, info){
  const c = LV.cli.get(rid); if (!c) return;
  c.ms = Math.round(performance.now() - c.p0); c.st = ok ? 'ok' : 'err'; Object.assign(c, info || {}); liveSoon();
}

/* ----- stream from the server ----- */
const liveWanted = () => !!(S.token && S.d && S.view === 'settings' && S.setSec === 'vcsproc' && S.me && S.me.primary);
function liveSync(){
  if (!liveWanted()) return liveStop();
  liveMount();
  if (!LV.ctl && !LV.rt) liveConnect();
  if (!LV.tick) LV.tick = setInterval(liveDraw, 1000);
}
function liveStop(){
  if (LV.ctl) LV.ctl.abort();
  LV.ctl = null; clearTimeout(LV.rt); LV.rt = null; clearInterval(LV.tick); LV.tick = null; LV.conn = 'off';
}
function liveReset(){ liveStop(); LV.rows.clear(); LV.cli.clear(); LV.hist = []; LV.dest = {}; LV.stats = null; LV.hello = null; LV.since = 0; LV.open.clear(); }
async function liveConnect(){
  if (LV.ctl) return;
  const ctl = new AbortController(); LV.ctl = ctl; LV.conn = 'connecting'; LV.c0 = Date.now(); liveDraw();
  try {
    const r = await fetch(API_URL + '/live/stream?since=' + LV.since, { headers:{ Authorization:'Bearer ' + S.token }, signal:ctl.signal, cache:'no-store' });
    if (!r.ok) { LV.fatal = r.status === 403 || r.status === 401; throw new Error(r.status === 403 ? 'Only the main admin can watch this.' : 'Server answered HTTP ' + r.status); }
    LV.conn = 'live'; LV.retry = 0; LV.err = ''; liveDraw();
    const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { done, value } = await rd.read(); if (done) break;
      buf += dec.decode(value, { stream:true }); let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        chunk.split('\n').forEach(l => { if (l.startsWith('data: ')) { let o = null; try { o = JSON.parse(l.slice(6)); } catch {} if (o) liveEvent(o); } });
      }
      liveSoon();
    }
    throw new Error('Connection closed by the server');
  } catch (e) {
    if (ctl.signal.aborted) return;
    LV.conn = 'retry'; LV.err = (e && e.message === 'Failed to fetch') ? 'Cannot reach the Render server (offline, asleep or restarting)' : (e && e.message) || 'Disconnected';
  } finally { if (LV.ctl === ctl) LV.ctl = null; }
  liveDraw();
  if (liveWanted() && !LV.fatal) { LV.rt = setTimeout(() => { LV.rt = null; if (liveWanted()) liveConnect(); }, Math.min(1000 * 2 ** Math.min(LV.retry++, 3), 8000)); }
}
function liveRow(rid, a){
  let r = LV.rows.get(rid);
  if (!r) { r = { rid, a:a || '?', t:Date.now(), state:'run', steps:[], f:[], u:'', poll:LV_POLL.has(a) }; LV.rows.set(rid, r);
    if (LV.rows.size > 450) LV.rows.delete(LV.rows.keys().next().value); }
  return r;
}
function liveEvent(ev){
  if (ev.k === 'hello') {
    if (ev.n < LV.since) { LV.rows.clear(); LV.since = 0; LV.hist = []; throw new Error('Server was restarted – reloading the feed'); }
    LV.hello = ev; LV.stats = ev.stats; LV.hcAt = Date.now();
    (ev.events || []).forEach(liveEvent);
    (ev.open || []).forEach(o => { const r = liveRow(o.rid, o.a); r.t = o.t; });
    return;
  }
  if (ev.n) LV.since = Math.max(LV.since, ev.n);
  if (ev.k === 'stats') { LV.stats = ev; return; }
  if (ev.k === 'req') { const r = liveRow(ev.rid, ev.a); Object.assign(r, { t:ev.t, u:ev.u, f:ev.f || [], poll:!!ev.poll, http:!!ev.http, sz:ev.sz, state:'run' }); return; }
  if (ev.k === 'go') { const r = liveRow(ev.rid); r.q = ev.q; r.go = ev.t; return; }
  if (ev.k === 'step') {
    LV.hist.push({ d:ev.d, t:ev.t, ok:ev.ok });
    if (LV.hist.length > 600) LV.hist.splice(0, LV.hist.length - 600);
    const d = LV.dest[ev.d] || (LV.dest[ev.d] = {}); d.t = ev.t; d.ok = ev.ok; d.ms = ev.ms; d.err = ev.ok ? d.err : (ev.x || 'HTTP ' + ev.s); d.s = ev.s;
    if (ev.rid) liveRow(ev.rid).steps.push(ev);
    else LV.rows.set('x' + ev.n, { rid:'x' + ev.n, a:'(no request) ' + (LV_DEST[ev.d] || LV_DEST.other)[1], t:ev.t, state:ev.ok ? 'ok' : 'err', steps:[ev], f:[], u:'', ms:ev.ms, poll:ev.ok, err:ev.ok ? '' : ev.x, sysrow:true });
    return;
  }
  if (ev.k === 'end') { const r = liveRow(ev.rid); Object.assign(r, { state:ev.ok ? 'ok' : 'err', ms:ev.ms, q:ev.q, u:ev.u || r.u, code:ev.code, err:ev.err }); return; }
  if (ev.k === 'sys') { LV.rows.set('s' + ev.n, { rid:'s' + ev.n, a:ev.text, t:ev.t, state:ev.lv === 'warn' ? 'warn' : 'sys', steps:[], f:[], u:'', sysrow:true }); }
}

/* ----- plain-words explanation of what went wrong / what is slow ----- */
function liveDiag(r){
  const c = r.cli, out = [], bad = r.steps.filter(s => !s.ok), slow = r.steps.slice().sort((a, b) => b.ms - a.ms)[0];
  const nm = d => (LV_DEST[d] || LV_DEST.other)[1];
  if (c && c.st === 'err' && r.cliOnly) {
    if (c.http >= 500 || c.kind === 'parse') out.push(['bad', 'Render answered with an error page (HTTP ' + (c.http || '5xx') + '). The server is restarting, deploying or crashed – wait 30–60 s and try again.']);
    else out.push(['bad', 'This request never reached the Render server. The free Render instance may be asleep (the first request after idle takes 30–60 s), or this device is offline / blocked by CORS.']);
  }
  if (r.cliOnly && r.state === 'run') { const w = (Date.now() - r.t) / 1000; if (w > 6) out.push(['warn', 'Still waiting for Render after ' + Math.round(w) + ' s – the server may be waking up from sleep.']); }
  if (r.state === 'run' && !r.cliOnly) {
    const w = (Date.now() - r.t) / 1000;
    if (!r.go) out.push(['warn', 'Waiting in the queue (' + Math.round(w) + ' s). Requests that write to the sheet run one by one.']);
    else if (w > 6) out.push(['warn', 'Running for ' + Math.round(w) + ' s' + (r.steps.length ? ', last step: ' + r.steps[r.steps.length - 1].l : ', no outgoing call yet') + '.']);
  }
  if (r.state === 'err' && !r.cliOnly) {
    if (r.code === 'AUTH') out.push(['bad', 'Login token expired or invalid – the user has to sign in again.']);
    else if (r.code === 'PERM') out.push(['bad', 'This user is not allowed to do this.']);
    else if (r.code === 'PAYDUE' || r.code === 'DISABLED') out.push(['bad', 'Account blocked (' + (r.code === 'PAYDUE' ? 'payment pending' : 'disabled') + ').']);
    else if (r.code === 'CRASH') out.push(['bad', 'The server crashed while handling this request: ' + (r.err || '') ]);
    if (bad.length) bad.forEach(s => out.push(['bad', nm(s.d) + ' failed: ' + (s.x || 'HTTP ' + s.s) + (s.d === 'sheets' && /429|quota|rate/i.test(s.x || '') ? ' – Google Sheets limit reached (too many requests per minute). Wait a minute.' : '')
      + (s.d === 'drive' && /401|connect|login/i.test(s.x || '') ? ' – reconnect Google Drive in Settings.' : '') ]));
    else if (!out.length) out.push(['bad', 'The app refused this request: ' + (r.err || 'unknown reason') + (r.code && r.code !== 'ERR' ? ' (' + r.code + ')' : '')]);
  }
  if (c && c.st === 'ok' && r.ms != null && c.ms - r.ms > 2500) out.push(['warn', 'About ' + lvDur(c.ms - r.ms) + ' was lost between the browser and Render (slow network or Render waking up).']);
  if (r.ms > 3000 && r.state !== 'run') {
    if ((r.q || 0) > 1000) out.push(['warn', 'Slow: waited ' + lvDur(r.q) + ' in the queue behind other requests.']);
    else if (slow && slow.ms > 1500) out.push(['warn', 'Slow: ' + nm(slow.d) + ' took ' + lvDur(slow.ms) + ' (' + slow.l + ').']);
  }
  return out;
}

/* ----- drawing ----- */
function liveSoon(){ if (LV.dt || !liveWanted()) return; LV.dt = setTimeout(() => { LV.dt = null; liveDraw(); }, 250); }
function liveMount(){
  const q = $('#lvQ'); if (!q) return;
  q.value = LV.f.q; $('#lvF').value = LV.f.mode; $('#lvPoll').checked = LV.f.poll; $('#lvPause').textContent = LV.paused ? '▶ Resume' : '⏸ Pause';
  q.oninput = () => { LV.f.q = q.value.trim().toLowerCase(); liveDraw(true); };
  $('#lvF').onchange = e => { LV.f.mode = e.target.value; liveDraw(true); };
  $('#lvPoll').onchange = e => { LV.f.poll = e.target.checked; liveDraw(true); };
  $('#lvPause').onclick = () => { LV.paused = !LV.paused; $('#lvPause').textContent = LV.paused ? '▶ Resume' : '⏸ Pause'; liveDraw(true); };
  $('#lvClear').onclick = () => { LV.rows.clear(); LV.cli.clear(); LV.hist = []; LV.open.clear(); liveDraw(true); };
  $('#lvCopy').onclick = liveCopy;
  $('#lvList').onclick = e => { const el = e.target.closest('[data-rid]'); if (!el) return; const k = el.dataset.rid; LV.open.has(k) ? LV.open.delete(k) : LV.open.add(k); liveDraw(true); };
  liveDraw(true);
}
function liveAll(){
  const out = [];
  LV.rows.forEach(r => { r.cli = LV.cli.get(r.rid); out.push(r); });
  LV.cli.forEach(c => {
    if (LV.rows.has(c.rid)) return;
    if (c.st === 'ok' && LV.hello && c.t0 < LV.hcAt - 2000) return;           // old and fine: server replay window already moved on
    out.push({ rid:c.rid, a:c.a, t:c.t0, cliOnly:true, cli:c, poll:c.poll, state:c.st === 'wait' ? 'run' : c.st, ms:c.ms, err:c.err, steps:[], f:[], u:'' });
  });
  return out.sort((a, b) => b.t - a.t);
}
function liveShow(r){
  if (r.poll && r.state !== 'err' && !LV.f.poll) return false;
  const m = LV.f.mode;
  if (m === 'err' && !(r.state === 'err' || r.state === 'warn')) return false;
  if (m === 'slow' && !((r.cli ? r.cli.ms : r.ms) > 2000)) return false;
  if (m === 'run' && r.state !== 'run') return false;
  if (LV.f.q) { const hay = (r.a + ' ' + lvAct(r.a) + ' ' + r.u + ' ' + (r.err || '') + ' ' + r.f.join(' ') + ' ' + r.steps.map(s => s.l + ' ' + s.d).join(' ')).toLowerCase(); if (!hay.includes(LV.f.q)) return false; }
  return true;
}
function liveChips(r){
  const g = {}; r.steps.forEach(s => { const k = s.d; (g[k] = g[k] || { n:0, ms:0, bad:0 }); g[k].n++; g[k].ms += s.ms; if (!s.ok) g[k].bad++; });
  const ks = Object.keys(g);
  return ks.slice(0, 6).map(k => `<span class="lv-ch ${g[k].bad ? 'bad' : ''}">${(LV_DEST[k] || LV_DEST.other)[0]} ${esc((LV_DEST[k] || LV_DEST.other)[1])}${g[k].n > 1 ? ' ×' + g[k].n : ''} <b>${lvDur(g[k].ms)}</b></span>`).join('<i>›</i>') + (ks.length > 6 ? ' +' + (ks.length - 6) : '');
}
function liveRowHtml(r){
  const open = LV.open.has(r.rid), tot = r.cli && r.cli.ms != null ? r.cli.ms : r.ms;
  const icon = { run:'⏳', ok:'✅', err:'❌', warn:'⚠️', sys:'ℹ️' }[r.state] || '•';
  const live = r.state === 'run' ? ' ' + lvDur(Date.now() - r.t) : (tot != null ? ' ' + lvDur(tot) : '');
  const diag = liveDiag(r);
  let h = `<div class="lv-r ${r.state}${open ? ' open' : ''}" data-rid="${esc(r.rid)}">
    <div class="lv-h"><span class="lv-t">${lvTime(r.t)}</span><span class="lv-i">${icon}</span>
      <span class="lv-m"><b>${esc(r.sysrow ? r.a : lvAct(r.a))}</b>${r.u ? ` <em>${esc(r.u)}</em>` : ''}${!r.sysrow && lvAct(r.a) !== r.a ? ` <code>${esc(r.a)}</code>` : ''}${r.cliOnly && !r.sysrow ? ' <small class="lv-tag">browser only</small>' : ''}</span>
      <span class="lv-d">${esc(live)}</span></div>`;
  if (!r.sysrow) h += `<div class="lv-path"><span class="lv-ch">🌐 Browser</span><i>›</i><span class="lv-ch ${r.cliOnly && r.state === 'run' ? 'wait' : ''}">🖥 Render</span>${r.steps.length ? '<i>›</i>' + liveChips(r) : ''}${r.state === 'err' && r.err ? `<span class="lv-er">${esc(r.err)}</span>` : ''}</div>`;
  if (r.sysrow && r.err) h += `<div class="lv-path"><span class="lv-er">${esc(r.err)}</span></div>`;
  if (diag.length && !open) h += `<div class="lv-dg ${diag[0][0]}">${esc(diag[0][1])}</div>`;
  if (open) {
    const L = [];
    if (r.cli) L.push(['🌐', 'Browser sent the request', lvTime(r.cli.t0), '']);
    if (!r.cliOnly) L.push(['🖥', 'Render received it' + (r.f.length ? ' (fields: ' + r.f.join(', ') + ')' : ''), lvTime(r.t), '']);
    if (r.q > 30) L.push(['⏳', 'Waited in queue for other requests', '', lvDur(r.q)]);
    r.steps.forEach(s => L.push([(LV_DEST[s.d] || LV_DEST.other)[0], (LV_DEST[s.d] || LV_DEST.other)[1] + ' — ' + s.l + (s.bg ? ' (background)' : '') + (s.x ? ' · ' + s.x : ''), s.s ? 'HTTP ' + s.s : '', lvDur(s.ms), !s.ok]));
    if (r.state === 'ok' || r.state === 'err') L.push([r.state === 'ok' ? '✅' : '❌', r.state === 'ok' ? 'Render sent the answer' : 'Failed' + (r.code ? ' (' + r.code + ')' : '') + (r.err ? ': ' + r.err : ''), '', lvDur(r.ms), r.state === 'err']);
    if (r.cli && r.cli.st !== 'wait') L.push(['🌐', r.cli.st === 'ok' ? 'Browser got the answer' : 'Browser: request failed' + (r.cli.http ? ' (HTTP ' + r.cli.http + ')' : ''), '', lvDur(r.cli.ms), r.cli.st === 'err']);
    h += '<div class="lv-tl">' + L.map(x => `<div class="${x[4] ? 'bad' : ''}"><span>${x[0]}</span><p>${esc(x[1])}</p><small>${esc(x[2])}</small><b>${esc(x[3])}</b></div>`).join('') + '</div>';
    diag.forEach(d => { h += `<div class="lv-dg ${d[0]}">${esc(d[1])}</div>`; });
  }
  return h + '</div>';
}
function liveDraw(force){
  if (!liveWanted()) return;
  if (LV.paused && force !== true) { const p = $('#lvConn'); if (p) p.textContent = '⏸ Paused'; return; }
  const now = Date.now(), st = LV.stats || {}, hello = LV.hello || {};
  const pill = $('#lvConn'); if (pill) {
    const m = { live:['🟢 Live', 'good'], connecting:['🟡 Connecting… ' + Math.round((now - (LV.c0 || now)) / 1000) + ' s (Render may be waking up)', 'warn'], retry:['🔴 ' + (LV.err || 'Disconnected') + ' – retrying', 'bad'], off:['⚪ Off', ''] }[LV.conn] || ['', ''];
    pill.className = 'lv-pill ' + m[1]; pill.textContent = LV.paused ? '⏸ Paused' : m[0];
  }
  const pipe = $('#lvPipe'); if (pipe) {
    const cutoff = now - 300000, cnt = {}, bad = {}; LV.hist.forEach(h => { if (h.t > cutoff) { cnt[h.d] = (cnt[h.d] || 0) + 1; if (!h.ok) bad[h.d] = (bad[h.d] || 0) + 1; } });
    const cf = {}; (hello.integrations || []).forEach(i => { cf[i.id] = i; });
    const node = k => {
      const d = LV.dest[k], c = cf[k], off = c && !c.on, name = c ? c.name : LV_DEST[k][1];
      const cls = off ? 'off' : !d ? 'idle' : (now - d.t < 1500 ? 'flash ' : '') + (d.ok ? 'ok' : 'bad');
      const sub = off ? 'not set up' : !d ? 'no activity' : (d.ok ? lvDur(d.ms) + ' · ' + lvAgo((now - d.t) / 1000) + ' ago' : 'FAILED ' + lvAgo((now - d.t) / 1000) + ' ago');
      return `<div class="lv-n ${cls}" title="${esc(d && !d.ok ? d.err : name)}"><i>${LV_DEST[k][0]}</i><b>${esc(name.replace(/ \(.*/, ''))}</b><small>${esc(sub)}</small>${cnt[k] ? `<em>${cnt[k]}${bad[k] ? ' · ' + bad[k] + ' failed' : ''} /5min</em>` : ''}</div>`;
    };
    const pend = [...LV.cli.values()].filter(c => c.st === 'wait').length, rt = [...LV.cli.values()].filter(c => c.st === 'ok' && !c.poll).slice(-5), avg = rt.length ? rt.reduce((a, c) => a + c.ms, 0) / rt.length : 0;
    const srvOk = LV.conn === 'live';
    pipe.innerHTML = `<div class="lv-flow"><div class="lv-n ${navigator.onLine ? 'ok' : 'bad'}"><i>🌐</i><b>This browser</b><small>${navigator.onLine ? 'online' : 'OFFLINE'}${pend ? ' · ' + pend + ' waiting' : ''}</small>${avg ? `<em>avg round trip ${lvDur(avg)}</em>` : ''}</div>
      <span class="lv-ar">➜</span>
      <div class="lv-n ${srvOk ? 'ok' : LV.conn === 'connecting' ? 'idle' : 'bad'}"><i>🖥</i><b>Render server</b><small>${srvOk ? 'up ' + lvAgo(st.up || 0) : LV.conn === 'connecting' ? 'connecting…' : 'not reachable'}</small>${st.lag != null ? `<em>lag ${st.lag} ms · ${st.mem || 0} MB</em>` : ''}</div>
      <span class="lv-ar">➜</span></div><div class="lv-grid">${LV_NODES.map(node).join('')}</div>`;
  }
  const stats = $('#lvStats'); if (stats) {
    const chip = (a, b, cls) => `<div class="lv-s ${cls || ''}"><small>${a}</small><b>${b}</b></div>`;
    stats.innerHTML = LV.stats ? chip('Running', st.running || 0) + chip('In queue', st.queued || 0, st.queued > 2 ? 'warn' : '') + chip('Requests / min', st.rpm || 0) + chip('Errors / min', st.epm || 0, st.epm ? 'bad' : '')
      + chip('Avg time', lvDur(st.avg || 0), st.avg > 2500 ? 'warn' : '') + chip('Server up', lvAgo(st.up || 0), (st.up || 0) < 120 ? 'warn' : '') + chip('Memory', (st.mem || 0) + ' MB') + chip('Watching', (st.subs || 1) + ' screen') : '';
  }
  const list = $('#lvList'); if (!list) return;
  const all = liveAll(), rows = all.filter(liveShow).slice(0, 120), hid = all.filter(r => r.poll && r.state !== 'err').length;
  list.innerHTML = (rows.length ? rows.map(liveRowHtml).join('') : `<div class="empty-state">${LV.conn === 'live' ? 'Waiting for activity… do something in the app (add an entry, send a chat message) and it appears here.' : 'Connecting to the server…'}</div>`)
    + (!LV.f.poll && hid ? `<div class="lv-foot">${hid} background checks hidden (chat ticks, call / game polling). Tick “Show background polling” to see them.</div>` : '');
}
function liveCopy(){
  const rows = liveAll().filter(liveShow).slice(0, 60).map(r => lvTime(r.t) + ' | ' + (r.u || '-') + ' | ' + r.a + ' | ' + r.state.toUpperCase() + ' | ' + lvDur(r.cli && r.cli.ms != null ? r.cli.ms : r.ms)
    + (r.steps.length ? ' | ' + r.steps.map(s => s.d + ':' + (s.ok ? 'ok ' : 'FAIL ') + s.ms + 'ms').join(' > ') : '') + (r.err ? ' | ' + r.err : ''));
  const txt = 'VCS Processing report (' + new Date().toLocaleString() + ')\n' + rows.join('\n');
  (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast('Report copied'), () => toast('Could not copy', true));
}
function liveCard(){
  return `<div class="card" id="lvCard"><h3>📡 VCS Processing <span class="lv-pill" id="lvConn"></span></h3>
    <p class="muted" style="margin-bottom:12px">Live view of everything the website does: <b>Browser → Render server → Google Sheets / Calendar / Drive …</b>. Tap a row to see every step, timing and the reason for a failure. Only the main admin sees this. Passwords, tokens and message text are never shown. While this page is open the Render server stays awake.</p>
    <div id="lvPipe"></div><div id="lvStats" class="lv-stats"></div>
    <div class="lv-tools"><input class="input" id="lvQ" placeholder="Search user, action, error…" autocomplete="off">
      <select class="select" id="lvF"><option value="all">Everything</option><option value="err">Only failures</option><option value="slow">Only slow (&gt; 2 s)</option><option value="run">Running now</option></select>
      <label class="check"><input type="checkbox" id="lvPoll"> Show background polling</label>
      <button type="button" class="btn ghost sm" id="lvPause">⏸ Pause</button><button type="button" class="btn ghost sm" id="lvClear">🧹 Clear</button><button type="button" class="btn ghost sm" id="lvCopy">📋 Copy report</button></div>
    <div id="lvList" class="lv-list"></div></div>`;
}
