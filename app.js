
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

/* ---------- tiny helpers ---------- */
const $ = (s, r=document) => r.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let busyN = 0;
function busy(on){ busyN += on ? 1 : -1; $('#bar').classList.toggle('on', busyN > 0); }
function toast(msg, bad){
  const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = msg;
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), 2600);
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
function callServer(body, timeoutMs){
  if (HAS_GAS){
    return new Promise((resolve, reject) => {
      google.script.run
        .withSuccessHandler(r => { try { resolve(JSON.parse(r)); } catch { reject(new Error('Unexpected server response.')); } })
        .withFailureHandler(err => reject(new Error((err && err.message) || 'Server error')))
        .apiCall(JSON.stringify(body));
    });
  }
  const ctl = (timeoutMs && typeof AbortController !== 'undefined') ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : 0;
  return fetch(API_URL, {
    method:'POST',
    headers:{'Content-Type':'text/plain;charset=utf-8'},   // avoids CORS pre-flight
    body: JSON.stringify(body),
    signal: ctl ? ctl.signal : undefined
  }).then(r => r.json())
    .catch(() => { const e = new Error('Cannot reach the server. Check your internet connection.'); e.offline = true; throw e; })   // no network / server asleep / timed out
    .finally(() => clearTimeout(timer));
}
async function api(action, payload = {}){
  busy(true);
  try{
    const body = { action, token:S.token, asUser:S.as || undefined, ...payload };
    const canWait = OQ_OK.has(action) && S.me && !HAS_GAS;            // add / edit / delete entries can wait for the network
    if (canWait){
      body.qid = oqId();                                              // lets the server ignore a repeat if the first reply was lost
      if (!navigator.onLine || oqMine().length) return oqEnqueue(action, body, navigator.onLine);   // older offline entries must go first
    }
    let j;
    try { j = await callServer(body, canWait ? 45000 : 0); }
    catch(e){ if (canWait && e.offline) return oqEnqueue(action, body, false); throw e; }
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
  idb.del('cache'); S.offlineMode = false;            // the saved copy of the data belongs to the person who just left
  clearInterval(syncT); syncT = null; setMenu(false);
  clearToken(); S.d = null; S.me = null; S.as = null; S.users = null; S.logs = null; S.photos = null; DEP.st = null; clearInterval(licTimer); licTimer = null; S.licAlerted = false; DEP.files = null; DEP.hist = null; DEP.prog = null; clearInterval(DEP.timer); UPD.items = null; UPD.open = false; S.view = 'dashboard'; closeModals(); chatReset(); vcReset(); ludoReset();
  $('#app').classList.add('hidden');
  showLogin(false, msg);
}
async function logout(){
  try { await pushOffHere(); } catch {}               // this phone stops getting this person's notifications
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
    el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;background:#111;color:#fff;padding:10px 18px;border-radius:999px;font-size:14px;box-shadow:0 4px 18px rgba(0,0,0,.3);display:none;max-width:92vw;text-align:center';
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
      <div style="min-width:0"><b>${esc(x.label)}</b>${mine && mine.id === x.id ? ' <span class="muted">(this device)</span>' : ''}<div class="muted" style="font-size:12px">Added ${esc((x.at||'').slice(0,10))}${x.last ? ' · last used ' + esc(x.last.slice(0,10)) : ''}</div></div>
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
  if (S.me && navigator.onLine && oqMine().length) await oqFlush(true);   // never show server data that is missing the entries still waiting on this phone
  try { r = await api('getAll'); }
  catch(e){ if (S.as && e.code !== 'AUTH'){ S.as = null; r = await api('getAll'); } else throw e; }   // the user being viewed was deleted
  S.sig = sigOf(r.data); ingest(r.data); cacheSave();
  if (canAddUsers()) await loadUsers(); else S.users = null;
  if (isAdmin()) await loadGroups(); else S.groups = null;
  applyAccess(); startSync(); licAlert();
}
function ingest(d){
  S.d = d; S.d.work = S.d.work || []; S.d.passwords = S.d.passwords || []; S.d.links = S.d.links || [];
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
  if (!S.d || !S.token || document.hidden || busyN > 0 || document.querySelector('.overlay') || typing() || S.offlineMode || oqMine().length) return;
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
  $('#avatar').textContent = nm.trim().charAt(0).toUpperCase();
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
  vcTick();                                           // opened from a "calling you" notification: look for the call right now
  oqFlush(); pushSync();
  if (isAdmin() && !S.offlineMode) loadLogs();
  openFromUrl(location.href);                         // a tapped notification can ask for a screen: ?go=attendance
  try { if (location.search) history.replaceState(null, '', location.pathname + location.hash); } catch {}
}
let booted = false;
async function boot(){
  if (booted) return; booted = true;
  await bioDetect();
  await oqLoad();
  const t = store.get(TK);
  let st;
  try { st = await api('status'); }
  catch(e){
    if (e.offline && t && await bootOffline(t)) return;       // no network: open with the last saved data
    showLogin(false, 'Cannot reach the server: ' + e.message); return;
  }
  if (t && !st.needsSetup){
    S.token = t;
    try { await loadAll(); enterApp(); return; } catch(e) { if (e.offline && await bootOffline(t)) return; clearToken(); }
  }
  showLogin(st.needsSetup, '', st.needsSetupCode);
  if (BIO.ok && bioSaved() && !st.needsSetup) bioLoginGo(true);
}

/* =====================================================================
   MULTI-USER: who am I, permissions, device + location capture
   ===================================================================== */
const DID = 'att_tracker_did';
const isAdmin = () => !!(S.me && S.me.role === 'admin');
const perms = () => (S.me && S.me.perms) || { att:'edit', exp:'edit', work:'edit', pw:'edit', link:'edit', lic:'edit', tt:'edit', emp:true, creds:true };
const can = sec => (sec === 'emp' || sec === 'creds') ? !!perms()[sec] : perms()[sec] === 'edit';
const canAddUsers = () => isAdmin() || !!perms().addUser;   // admin, or a user the admin allowed to add users
function deny(){ toast('You have view-only access to this section', true); }
const SECT = { attendance:'att', expenses:'exp', work:'work', timetable:'tt', passwords:'pw', links:'link', lic:'lic' };
const SECT_NAME = { attendance:'Attendance', expenses:'Expenses', work:'Work', timetable:'Time Table', passwords:'Passwords', links:'Links', lic:'LIC' };

function applyAccess(){
  const p = perms();
  const hide = (v, h) => { const b = document.querySelector(`#nav [data-v="${v}"]`); if (b) b.classList.toggle('hidden', h); };
  const chatOnly = ['att','exp','work','pw','link','lic','tt'].every(k => p[k] === 'none') && !isAdmin();
  hide('dashboard', chatOnly);
  hide('attendance', p.att === 'none'); hide('expenses', p.exp === 'none'); hide('work', p.work === 'none'); hide('timetable', p.tt === 'none'); hide('passwords', p.pw === 'none'); hide('links', p.link === 'none'); hide('lic', p.lic === 'none'); hide('logins', !isAdmin()); hide('deploy', !(S.me && S.me.primary));
  if ((SECT[S.view] && p[SECT[S.view]] === 'none') || (S.view === 'logins' && !isAdmin()) || (S.view === 'deploy' && !(S.me && S.me.primary))) S.view = chatOnly ? 'chat' : 'dashboard';
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
  if (!can('lic')) kill('[onclick*="licForm"],[onclick*="licDel"]');
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
  return `Attendance: ${L[p.att]} · Expenses: ${L[p.exp]} · Work: ${L[p.work]} · Passwords: ${L[p.pw || 'edit']} · Links: ${L[p.link || 'edit']} · LIC: ${L[p.lic || 'edit']} · Time Table: ${L[p.tt || 'edit']} · Employees: ${p.emp ? 'can manage' : 'no'}${p.addUser ? ' · Can add users' : ''}`;
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
  const p = (x && x.perms) || { att:'none', exp:'none', work:'none', pw:'none', link:'none', lic:'none', tt:'none', emp:false, creds:true };   // new user = Chat only
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
        perms:{ att:f.get('p_att'), exp:f.get('p_exp'), work:f.get('p_work'), pw:f.get('p_pw'), link:f.get('p_link'), lic:f.get('p_lic'), tt:f.get('p_tt'), emp:!!f.get('p_emp'), creds:!!f.get('p_creds'), addUser:!!f.get('p_addUser') } });
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
    <p class="muted" style="margin:0 0 6px;font-size:12.5px">Chat, calls, Ludo and group chats show <b>only</b> the people ticked here (plus whoever added this user / was added by them). Nobody sees anybody without your permission. It works both ways.</p>
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
    <p class="muted" style="margin-top:6px;font-size:12.5px">That person’s current data becomes the group’s data. The other members’ old data stays in the sheet but is hidden while they are in the group.</p></div>`;
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
    <div class="l2" style="display:flex;gap:10px;margin-top:6px">${photoThumb(p.front, 'Front camera') || '<span class="muted" style="font-size:12px">no front photo</span>'}${photoThumb(p.back, 'Back camera') || '<span class="muted" style="font-size:12px">no back photo</span>'}</div>
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
  return `<div style="font-weight:800;font-size:18px;margin-bottom:8px">${head}</div>
    <div style="display:flex;gap:4px;margin-bottom:10px">${p.items.map(x => `<div style="flex:1;height:8px;border-radius:4px;background:${col[x.state]}${x.state === 'wait' ? ';opacity:.55' : ''}"></div>`).join('')}</div>
    ${p.items.map(x => `<div class="l2">${ic[x.state]} ${esc(x.name)}</div>`).join('')}
    <div class="muted" style="margin-top:8px;font-size:12.5px">${esc(p.msg || '')} · <code>${esc(p.short || '')}</code>${p.state === 'pending' ? ' · updates by itself every 5 seconds' : ''}</div>`;
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
      <p class="muted" style="margin-top:10px;font-size:12.5px">Safety: a JS/JSON file with a mistake is refused before it reaches GitHub. Changing <code>server.js</code>, <code>package.json</code> or other server files asks for an extra confirmation. <code>Code.gs</code> still has to be pasted into Apps Script by hand.</p></div>
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
  const bar = pct => { prog.innerHTML = `<div class="upbar"><i style="width:${pct}%"></i></div><div class="muted" style="font-size:12.5px">${pct < 100 ? 'Uploading… ' + pct + '%' : 'Saving to GitHub… please wait'}</div>`; };
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
  logins:['Login activity','Who signed in, when, from where and from which device'],
  deploy:['Deploy','Publish updated files to GitHub — the site goes live by itself'],
  updates:['Updates','Download the latest application files'],
  settings:['Settings','Profile, security and preferences']
};
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
      if (!open && x0 < 24 && dx > 60 && !$('#app').classList.contains('hidden')) setMenu(true);
      else if (open && dx < -60) setMenu(false);
    }
    x0 = null;
  }, { passive:true });
})();
function go(v){
  setMenu(false);
  if (v === 'chat' && S.view !== 'chat') S.chat.with = null;
  if (v !== 'chat') document.body.classList.remove('chat-conv');
  S.view = v; applyAccess(); v = S.view;
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.v === v));
  $('#pageTitle').textContent = TITLES[v][0];
  $('#pageSub').textContent = TITLES[v][1];
  render(); window.scrollTo(0,0);
  if (v === 'logins') loadLogs();
  if (v === 'deploy') depLoad();
  if (v === 'updates') updLoad();
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
    <div style="font-size:26px">⏳</div>
    <div style="flex:1;min-width:200px"><div style="font-weight:700">Your access expires on <span id="payCdDate"></span></div>
      <div class="muted" style="font-size:13px">Please make the payment before then to keep using this account.</div></div>
    <div id="payCdTxt" style="font-weight:800;font-size:20px;font-variant-numeric:tabular-nums"></div></div>`;
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
  let html = ({dashboard:vDashboard, attendance:vAttendance, expenses:vExpenses, work:vWork, timetable:vTimetable, chat:vChat, passwords:vPasswords, links:vLinks, lic:vLic, logins:vLogins, deploy:vDeploy, updates:vUpdates, settings:vSettings})[S.view]();
  if (S.view === 'dashboard' && isAdmin() && !S.as) html += recentLoginsCard();
  v.innerHTML = banner() + (S.view === 'dashboard' ? payCountdownHtml() : '') + html;
  applyRO(v);
  startPay(); startLic();
  const after = ({settings:() => { bindSettings(); bindBio(); bindPush(); bindDrive(); }, logins:bindLogins, chat:bindChat, deploy:bindDeploy, updates:bindUpdates})[S.view]; if (after) after();
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
    <div class="card kpi s"><div class="lbl">Salary Earned So Far</div><div class="val" style="font-size:22px">${esc(fm(y.earned))}</div><div class="hint">of ${esc(fm((+emp().salary||0)*12))} per year</div></div>
    <div class="card kpi m"><div class="lbl">Present %</div><div class="val">${pct}</div><div class="hint">Present vs Absent</div></div>
    <div class="card kpi s"><div class="lbl">Days Marked</div><div class="val">${y.marked}</div><div class="hint">${y.paid} paid days</div></div>
  </div>
  <div class="grid two">
    <div class="card"><h3>Monthly breakdown <span class="muted" style="font-weight:500;font-size:12.5px">${esc(s.year)}</span></h3>
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
  const expHtml = `<div class="dsec"><span>💸 Expenses <span class="muted" style="font-weight:500;font-size:13px">${y}</span></span><button class="btn soft sm" onclick="go('expenses')">Open</button></div>
  <div class="grid kpis">
    <div class="card kpi p"><div class="lbl">Income</div><div class="val" style="font-size:22px">${esc(fm(inc))}</div></div>
    <div class="card kpi a"><div class="lbl">Expenses</div><div class="val" style="font-size:22px">${esc(fm(exp))}</div></div>
    <div class="card kpi s"><div class="lbl">Balance</div><div class="val" style="font-size:22px;color:${inc-exp<0?'var(--bad)':'var(--good)'}">${esc(fm(inc-exp))}</div></div>
    <div class="card kpi m"><div class="lbl">This month spent</div><div class="val" style="font-size:22px">${esc(fm(curM >= 0 ? mExp[curM] : 0))}</div><div class="hint">${ex.length} entries this year</div></div>
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
  const workHtml = `<div class="dsec"><span>🛠️ Work <span class="muted" style="font-weight:500;font-size:13px">${y}</span></span><button class="btn soft sm" onclick="go('work')">Open</button></div>
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
    <p class="muted" style="margin-top:12px;font-size:13px">Tap a date to mark Present / Absent / Week Off. Changes are saved to your Google Sheet instantly.</p>
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
    <div class="card kpi p"><div class="lbl">Income</div><div class="val" style="font-size:22px">${esc(fm(inc))}</div></div>
    <div class="card kpi a"><div class="lbl">Expenses</div><div class="val" style="font-size:22px">${esc(fm(exp))}</div></div>
    <div class="card kpi s"><div class="lbl">Balance</div><div class="val" style="font-size:22px;color:${inc-exp<0?'var(--bad)':'var(--good)'}">${esc(fm(inc-exp))}</div></div>
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
    <p class="muted" style="font-size:12px;margin-top:8px">Tap a date to add or see its entries. Green dot = work recorded. Tap again to clear.</p>`;
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
    if (mr) rows += `<tr class="mh"><td colspan="7">${MONTHS[m-1]} ${y} <span style="font-weight:500;color:var(--muted);font-size:12.5px">· ${perMonth[m]} entries</span></td></tr>` + mr;
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
    <p class="muted" style="margin-top:12px;font-size:13px">Type in the boxes of a date and press <b>Save</b> (or Enter). Use <b>＋</b> next to a date for more than one entry. Use <b>Edit</b> / <b>Delete</b> to fix mistakes. Saved to the “Work” tab of your Google Sheet.</p>
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
    <div class="card"><h3>Saved logins <span class="muted" style="font-weight:500;font-size:12.5px">· ${list.length}${list.length !== total ? ' of ' + total : ''}</span></h3>
      ${list.length ? `<div class="tbl-wrap"><table class="stk"><thead><tr><th>Website URL</th><th>User ID</th><th>Password</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
        : `<div class="empty-state">${total ? 'No logins match your search.' : 'No logins saved yet. Tap “Add login” to start.'}</div>`}
      <p class="muted" style="margin-top:12px;font-size:13px">📋 next to a field copies just that field. <b>Copy all</b> copies website, user ID and password together. Saved in the “Password Manager” tab of your Google Sheet.</p>
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
    <div class="card"><h3>Saved links <span class="muted" style="font-weight:500;font-size:12.5px">· ${list.length}${list.length !== total ? ' of ' + total : ''}</span></h3>
      ${list.length ? `<div class="tbl-wrap"><table class="stk"><thead><tr><th>Name</th><th>Type</th><th>Link</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
        : `<div class="empty-state">${total ? 'No links match your search.' : 'No links saved yet. Tap “Add link” to start.'}</div>`}
      <p class="muted" style="margin-top:12px;font-size:13px">📋 next to a link copies just the link. <b>Copy all</b> copies name, type and link together. Saved in the “Links” tab of your Google Sheet.</p>
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
   VIEW: LIC  (customer policies — name, policy no., amount, start/end date, live countdown to end date)
   ===================================================================== */
function licAmt(n){ return n ? '₹' + Number(n).toLocaleString('en-IN') : '<span class="dim">—</span>'; }
const LIC_FREQ = { '':'One-time', monthly:'Monthly', quarterly:'Quarterly', halfyearly:'Half-Yearly', yearly:'Yearly' };
const LIC_FREQ_MONTHS = { monthly:1, quarterly:3, halfyearly:6, yearly:12 };
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
function filteredLic(){
  const q = (S.lic.q || '').trim().toLowerCase();
  return [...(S.d.lic || [])]
    .filter(x => !q || (x.name + ' ' + x.policyNo).toLowerCase().includes(q))
    .sort((a, b) => (a.endDate || '9999').localeCompare(b.endDate || '9999'));     // soonest-ending first
}
function vLic(){
  const all = S.d.lic || [], list = filteredLic(), total = all.length;
  const now = Date.now();
  let maturing = 0, matured = 0, totalAmt = 0, renew7 = 0, renew30 = 0;
  all.forEach(x => {
    totalAmt += Number(x.amount) || 0;
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
      <td data-l="Amount" class="n">${licAmt(x.amount)}</td>
      <td data-l="Premium Mode"><span class="tag">${esc(LIC_FREQ[x.freq] || 'One-time')}</span></td>
      <td data-l="Starting Date">${licDateFmt(x.startDate)}</td>
      <td data-l="Ending Date">${licDateFmt(x.endDate)}</td>
      <td data-l="Next Renewal">${rn.due ? `${licDateFmt(rn.due)}<br><span class="lic-rn ${rn.cls}" data-lic-id="${esc(x.id)}" style="font-weight:700;white-space:nowrap">${esc(rn.text)}</span>` : '<span class="dim">—</span>'}</td>
      <td data-l="Time Left"><span class="lic-cd ${c.cls}" data-end="${esc(x.endDate || '')}" style="font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap">${esc(c.text)}</span></td>
      <td class="n nowrap"><button class="btn soft sm" onclick="licCopy('${esc(x.id)}')" title="Copy all of this customer's data">📋 Copy</button>
        <button class="btn ghost sm" onclick="licForm('${esc(x.id)}')">Edit</button> <button class="btn ghost sm" onclick="licDel('${esc(x.id)}')">🗑</button></td></tr>`;
  }).join('');
  const remindCard = remind.length ? `<div class="card lic-remind" style="margin-bottom:16px"><h3>🔔 Renewal reminders <span class="muted" style="font-weight:500;font-size:12.5px">· due within 30 days</span></h3>
      ${remind.map(({ x, rn }) => `<div class="lic-ri"><div class="lic-ri-main"><b>${esc(x.name || x.policyNo || 'Policy')}</b>${x.name && x.policyNo ? ` <span class="muted">· ${esc(x.policyNo)}</span>` : ''}
        <div class="muted" style="font-size:12.5px">${esc(LIC_FREQ[x.freq] || 'One-time')} premium${x.amount ? ' · ₹' + Number(x.amount).toLocaleString('en-IN') : ''} · ${licDateFmt(rn.due)}</div></div>
        <span class="lic-rn lic-pill ${rn.cls}" data-lic-id="${esc(x.id)}">${esc(rn.text)}</span></div>`).join('')}</div>` : '';
  return `${remindCard}<div class="grid kpis" style="margin-bottom:16px">
      <div class="card kpi s"><div class="lbl">Total Policies</div><div class="val">${total}</div><div class="hint">customers</div></div>
      <div class="card kpi p"><div class="lbl">Total Amount</div><div class="val" style="font-size:20px">${esc(licAmt(totalAmt))}</div></div>
      <div class="card kpi m"><div class="lbl">Renewal due ≤ 7 days</div><div class="val">${renew7}</div><div class="hint">pay soon</div></div>
      <div class="card kpi w"><div class="lbl">Renewal due ≤ 30 days</div><div class="val">${renew30}</div><div class="hint">upcoming</div></div>
      <div class="card kpi w"><div class="lbl">Maturing ≤ 30 days</div><div class="val">${maturing}</div></div>
      <div class="card kpi a"><div class="lbl">Matured / Expired</div><div class="val">${matured}</div></div>
    </div>
    <div class="card" style="margin-bottom:16px"><div class="actions">
      <input class="input" id="licq" style="width:220px" placeholder="Search customer name or policy no.…" value="${esc(S.lic.q)}" oninput="licSearch(this.value)">
      <span style="flex:1"></span>
      <button class="btn soft" onclick="licExport('xlsx')">⬇ Excel</button><button class="btn soft" onclick="licExport('pdf')">⬇ PDF</button>
      <button class="btn" onclick="licForm()">＋ Add policy</button></div></div>
    <div class="card"><h3>LIC policies <span class="muted" style="font-weight:500;font-size:12.5px">· ${list.length}${list.length !== total ? ' of ' + total : ''}</span></h3>
      ${list.length ? `<div class="tbl-wrap"><table class="stk"><thead><tr><th>Customer Name</th><th>Policy Number</th><th>Amount</th><th>Premium Mode</th><th>Starting Date</th><th>Ending Date</th><th>Next Renewal</th><th>Time Left</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
        : `<div class="empty-state">${total ? 'No policies match your search.' : 'No LIC policies yet. Tap “Add policy” to start.'}</div>`}
      <p class="muted" style="margin-top:12px;font-size:13px">📋 <b>Copy</b> copies that customer's full data in one tap. <b>Next Renewal</b> comes from the <b>Renewal / Premium Due Date</b> you enter once — it then repeats by itself every month / quarter / half-year / year (per Premium Mode) and counts down the days, months or years left; <b>Time Left</b> counts down live to the policy's ending date. Saved in the “LIC Policies” tab of your Google Sheet — ⬇ Excel / ⬇ PDF export everything.</p>
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
    x.amount ? 'Amount: ₹' + Number(x.amount).toLocaleString('en-IN') : '',
    'Premium Mode: ' + (LIC_FREQ[x.freq] || 'One-time'),
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
  const w = openModal(`<h3>${x ? 'Edit policy' : 'Add policy'}</h3><p class="sub">Customer name, policy number, amount, premium mode, the starting / ending date and the renewal (premium due) date.</p>
    <form id="licf" autocomplete="off">
      <div class="row2"><div class="field"><label>Customer Name</label><input class="input" name="name" maxlength="200" autocomplete="off" value="${esc(x ? x.name : '')}"></div>
        <div class="field"><label>Policy Number</label><input class="input" name="policyNo" maxlength="80" autocomplete="off" value="${esc(x ? x.policyNo : '')}"></div></div>
      <div class="row2"><div class="field"><label>Amount</label><input class="input" name="amount" type="number" min="0" step="0.01" inputmode="decimal" value="${x && x.amount ? x.amount : ''}"></div>
        <div class="field"><label>Premium paid</label><select class="select" name="freq">${freqOpts}</select></div></div>
      <div class="row2">
        <div class="field"><label>Starting Date</label><input class="input" type="date" name="startDate" value="${esc(x ? x.startDate : '')}"></div>
        <div class="field"><label>Ending Date</label><input class="input" type="date" name="endDate" value="${esc(x ? x.endDate : '')}"></div>
      </div>
      <div class="field"><label>Renewal / Premium Due Date</label><input class="input" type="date" name="dueDate" value="${esc(x ? x.dueDate : '')}"></div>
      <div id="licPrev" class="lic-prev"></div>
      <p class="muted" style="font-size:12.5px;margin-top:-2px">Enter the due date once. For Monthly / Quarterly / Half-Yearly / Yearly it then repeats by itself and shows how many days / months / years are left. If left empty, the starting date is used.</p>
      <div class="foot"><button type="button" class="btn ghost" data-x>Cancel</button><button class="btn" type="submit">${x ? 'Save' : 'Add'}</button></div></form>`);
  w.querySelector('[data-x]').onclick = () => w.remove();
  const prev = () => {                       // live "next due" line under the form
    const f = Object.fromEntries(new FormData(w.querySelector('#licf'))), rn = licRenewInfo(f), el = w.querySelector('#licPrev');
    el.innerHTML = rn.due ? `Next due: <b>${licDateFmt(rn.due)}</b> · <span class="${rn.cls}" style="font-weight:700">${esc(rn.text)}</span>${LIC_FREQ_MONTHS[f.freq] ? ` <span class="muted">(repeats every ${LIC_FREQ_MONTHS[f.freq]} month${LIC_FREQ_MONTHS[f.freq] > 1 ? 's' : ''})</span>` : ''}` : '';
  };
  w.querySelector('#licf').addEventListener('input', prev); w.querySelector('#licf').addEventListener('change', prev); prev();
  w.querySelector('#licf').onsubmit = async ev => {
    ev.preventDefault(); const f = Object.fromEntries(new FormData(ev.target)); const btn = ev.submitter; btn.disabled = true;
    try{
      if (x){ const r = await api('updateLic', { id:x.id, ...f }); Object.assign(x, r.lic); }
      else { const r = await api('addLic', f); S.d.lic.push(r.lic); }
      w.remove(); render(); toast('Saved');
    }catch(e){ btn.disabled = false; handleErr(e); }
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
  <div class="card"><h3>Time table <span class="muted" style="font-weight:500;font-size:12.5px">5:00 AM – 1:00 AM · 30-minute slots</span></h3>
    ${cats.length ? '' : '<div class="viewas">💡 No categories yet — choose “＋ Add new category…” in any dropdown, or tap ⚙ Categories to add them.</div>'}
    <div class="tbl-wrap"><table class="tt"><thead><tr><th>Time</th><th>Category</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="muted" style="margin-top:12px;font-size:13px">Pick a category for each slot — it saves instantly to the “Timetable” tab of your Google Sheet. Need a new one? Choose <b>＋ Add new category…</b> in the dropdown.</p>
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
  grid.insertAdjacentHTML('beforeend', pushCard());
  if (S.me && S.me.primary && !HAS_GAS) grid.insertAdjacentHTML('beforeend', driveCard());
  grid.insertAdjacentHTML('beforeend', bioCard());
  if (S.me && S.me.actLog) grid.insertAdjacentHTML('beforeend', activityCard());
  return dom.innerHTML;
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
  const ws = xSheet(wb, 'LIC Policies', 9, [24, 18, 14, 12, 12, 12, 16, 16, 12], 'KS — LIC Policies', `${d.lic.length} policies  |  Generated ${STAMP()}`, 4);
  xHead(ws, 4, ['#', 'Customer Name', 'Policy Number', 'Amount', 'Premium Mode', 'Starting Date', 'Ending Date', 'Next Renewal', 'Status']);
  d.lic.forEach((x, i) => { const row = ws.getRow(5 + i), z = i % 2 ? X.zebra : null, rn = licRenewInfo(x);
    xCell(row.getCell(1), i + 1, { h:'center', fill:z });
    xCell(row.getCell(2), x.name, { h:'left', fill:z });
    xCell(row.getCell(3), x.policyNo, { h:'left', fill:z, fmt:'@' });
    xCell(row.getCell(4), x.amount, { h:'right', fill:z, fmt:XM() });
    xCell(row.getCell(5), LIC_FREQ[x.freq] || 'One-time', { h:'left', fill:z });
    xCell(row.getCell(6), xDate(x.startDate), { h:'left', fill:z, fmt:x.startDate ? 'dd-mmm-yyyy' : '@' });
    xCell(row.getCell(7), xDate(x.endDate), { h:'left', fill:z, fmt:x.endDate ? 'dd-mmm-yyyy' : '@' });
    xCell(row.getCell(8), rn.due ? xDate(rn.due) : '—', { h:'left', fill:z, fmt:rn.due ? 'dd-mmm-yyyy' : '@' });
    const st = licStatusPlain(x.endDate);
    xCell(row.getCell(9), st, { h:'center', fill:z, bold:true, color:st === 'Expired' ? X.bad : st === 'Expiring soon' ? 'FFB45309' : X.good }); });
  if (d.lic.length) ws.autoFilter = { from:'A4', to:`I${4 + d.lic.length}` };
}
function pdfLic(P, d, first){
  const y = pdfStart(P, 'LIC Policies', `${d.lic.length} policies   |   Generated ${STAMP()}`, 'l', first);
  pdfTable(P, { startY:y, head:[['#', 'Customer Name', 'Policy No.', 'Amount', 'Mode', 'Starting Date', 'Ending Date', 'Next Renewal', 'Status']],
    body:d.lic.map((x, i) => { const rn = licRenewInfo(x); return [i + 1, x.name, x.policyNo, x.amount ? PM(x.amount) : '—', LIC_FREQ[x.freq] || 'One-time', x.startDate || '—', x.endDate || '—', rn.due || '—', licStatusPlain(x.endDate)].map(PT); }),
    styles:{ fontSize:8.5 }, columnStyles:{ 0:{ cellWidth:9, halign:'center' }, 1:{ cellWidth:55 }, 2:{ cellWidth:42 }, 3:{ cellWidth:34, halign:'right' }, 4:{ cellWidth:30 }, 5:{ cellWidth:34 }, 6:{ cellWidth:34 }, 7:{ cellWidth:34 }, 8:{ cellWidth:32, halign:'center' } } });
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

/* =====================================================================
   OFFLINE MODE  +  PUSH NOTIFICATIONS
   - No network: new / edited / deleted entries are kept on the phone (IndexedDB) and sent, in order, when the network is back.
   - The last data is kept on the phone too, so the app still opens with no network.
   - sw.js shows push notifications (calls, payment reminders, attendance reminder) even when the app is closed.
   ===================================================================== */
const idb = {
  db:null,
  open(){
    if (!this.db) this.db = new Promise((ok, no) => {
      if (!window.indexedDB) return no(new Error('no storage'));
      const q = indexedDB.open('ks_offline', 1);
      q.onupgradeneeded = () => q.result.createObjectStore('kv');
      q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error);
    });
    return this.db;
  },
  async get(k){ try { const db = await this.open(); return await new Promise(ok => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => ok(q.result); q.onerror = () => ok(undefined); }); } catch { return undefined; } },
  async set(k, v){ try { const db = await this.open(); await new Promise(ok => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = t.onerror = t.onabort = () => ok(); }); } catch {} },
  async del(k){ try { const db = await this.open(); await new Promise(ok => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); t.oncomplete = t.onerror = t.onabort = () => ok(); }); } catch {} }
};

/* ---------- offline queue ---------- */
const OQ = { list:[], busy:false, snap:null };
const OQ_ADD = { addExpense:'expense', addWork:'work', addLink:'link', addLic:'lic' };                 // action -> key of the saved item in the reply
const OQ_UPD = { updateExpense:['addExpense','expense'], updateWork:['addWork','work'], updateLink:['addLink','link'], updateLic:['addLic','lic'] };
const OQ_DEL = { deleteExpense:1, deleteWork:1, deleteLink:1, deleteLic:1 };
const OQ_OK = new Set(['setAttendance', 'setTimetable', ...Object.keys(OQ_ADD), ...Object.keys(OQ_UPD), ...Object.keys(OQ_DEL)]);   // saved passwords are deliberately NOT kept on the phone
const oqId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const oqMine = () => OQ.list.filter(x => S.me && x.uid === S.me.id);
const oqSave = () => idb.set('queue', OQ.list);
async function oqLoad(){ const q = await idb.get('queue'); OQ.list = Array.isArray(q) ? q : []; oqPill(); }
function oqPill(){
  let el = document.getElementById('oqPill');
  const n = oqMine().length, off = !navigator.onLine;
  if (!n && !off){ if (el) el.remove(); return; }
  if (!el){ el = document.createElement('div'); el.id = 'oqPill'; el.onclick = () => { oqFlush(); }; document.body.appendChild(el); }
  el.className = 'oq-pill' + (off ? ' off' : '');
  el.textContent = off ? '📴 Offline' + (n ? ' · ' + n + ' waiting to sync' : '')
    : OQ.busy ? '⏳ Syncing ' + n + '…' : '☁️ ' + n + ' waiting to sync · tap to retry';
}
function oqEnqueue(action, body, online){
  const me = S.me.id, id = body.id !== undefined ? String(body.id) : '';
  const rec = b => { const r = { ...b }; ['action', 'token', 'asUser', 'qid'].forEach(k => delete r[k]); if ('amount' in r) r.amount = Number(r.amount) || 0; return r; };
  const clean = { ...body }; delete clean.token;
  let out;
  if ((OQ_UPD[action] || OQ_DEL[action]) && id.startsWith('tmp_')){            // changing something that was added offline and is not on the server yet
    const e = OQ.list.find(x => x.tmp === id && x.uid === me);
    if (!e) throw new Error('This entry is still being saved. Please try again in a moment.');
    if (OQ_DEL[action]){ OQ.list = OQ.list.filter(x => x !== e); out = { ok:true, queued:true }; }
    else { Object.assign(e.body, rec(body)); delete e.body.id; out = { ok:true, queued:true, [OQ_UPD[action][1]]:{ ...rec(e.body), id } }; }
  } else {
    const e = { id:body.qid, uid:me, body:clean, t:Date.now() };
    if (OQ_ADD[action]){ e.tmp = 'tmp_' + oqId(); out = { ok:true, queued:true, [OQ_ADD[action]]:{ ...rec(body), id:e.tmp } }; }
    else if (OQ_UPD[action]) out = { ok:true, queued:true, [OQ_UPD[action][1]]:rec(body) };
    else out = { ok:true, queued:true };
    OQ.list.push(e);
  }
  oqSave(); oqPill();
  clearTimeout(OQ.snap); OQ.snap = setTimeout(() => cacheSave(), 900);          // after the screen code has applied the change, keep the copy
  if (online) setTimeout(oqFlush, 50); else toast('📴 No network — saved on this phone, it will sync by itself');
  return out;
}
async function oqFlush(fromLoad){
  if (OQ.busy || !S.token || !S.me || !navigator.onLine || !oqMine().length) return;
  OQ.busy = true; oqPill();
  let done = 0, authErr = null; const bad = [];
  try{
    for (;;){
      const e = oqMine()[0]; if (!e) break;
      let j;
      try { j = await callServer({ ...e.body, token:S.token, qid:e.id }, 45000); }
      catch(err){ break; }                                                      // still no network: keep everything, try again later
      if (!j.ok && (j.code === 'AUTH' || j.code === 'PAYDUE')){ authErr = Object.assign(new Error(j.error || 'Please sign in again.'), { code:j.code }); break; }
      if (!j.ok) bad.push(j.error || 'The server refused it');
      OQ.list = OQ.list.filter(x => x !== e); await oqSave(); done++; oqPill();
    }
  } finally { OQ.busy = false; oqPill(); }
  if (authErr) return handleErr(authErr);                                       // the entries stay on the phone until you sign in again
  if (done && !fromLoad){ try { await loadAll(); render(); } catch(e){ if (!e.offline) handleErr(e); } }
  if (done) toast('✅ ' + done + (done === 1 ? ' offline entry' : ' offline entries') + ' synced');
  if (bad.length) toast('⚠ ' + bad.length + ' offline ' + (bad.length === 1 ? 'entry' : 'entries') + ' could not be saved: ' + bad[0], true);
}

/* ---------- last data kept for opening with no network ---------- */
function cacheSave(){
  if (!S.d || !S.me || S.me.viewing || S.as) return;                            // never keep "view as user" data under the admin
  idb.set('cache', { uid:S.me.id, at:Date.now(), data:{ ...S.d, passwords:[] } });   // saved passwords are not kept on the phone
}
const tokUid = t => { try { return atob(String(t).split('.')[0].replace(/-/g, '+').replace(/_/g, '/')).split('|')[0]; } catch { return ''; } };
async function bootOffline(t){
  const c = await idb.get('cache');
  if (!c || !c.data || !c.data.me || c.uid !== tokUid(t)) return false;
  S.token = t; S.offlineMode = true; S.sig = '';
  c.data.me.serverNow = Date.now();
  ingest(c.data); applyAccess(); enterApp();
  toast('📴 No network — showing your last saved data');
  return true;
}
async function onBackOnline(){
  oqPill();
  if (!S.token || !S.d) return;
  await oqFlush();
  if (S.offlineMode){
    try { await loadAll(); S.offlineMode = false; render(); toast('✅ Back online'); if (isAdmin()) loadLogs(); }
    catch(e){ if (!e.offline) handleErr(e); }
  }
}
window.addEventListener('online', onBackOnline);
window.addEventListener('offline', oqPill);
setInterval(() => { if (!navigator.onLine) return; if (S.offlineMode) onBackOnline(); else if (oqMine().length) oqFlush(); }, 20000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.token && S.d){ vcTick(); if (S.offlineMode) onBackOnline(); else oqFlush(); } });

/* ---------- push notifications ---------- */
const PUSH = { reg:null };
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => !!(navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches));
const pushSupported = () => !HAS_GAS && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;
function pushWhy(){
  if (HAS_GAS) return 'Notifications need the website version of the app.';
  if (isIOS() && !isStandalone()) return 'On iPhone / iPad: tap Share → “Add to Home Screen”, then open the app from the Home Screen icon and come back here.';
  if (!window.isSecureContext) return 'Notifications need the secure (https) website address.';
  return 'This browser does not support notifications. Use Chrome on Android, or Safari on iPhone with the app added to the Home Screen.';
}
const u8 = x => { x = String(x).replace(/-/g, '+').replace(/_/g, '/'); while (x.length % 4) x += '='; const b = atob(x), a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; };
async function swRegister(){
  if (HAS_GAS || !('serviceWorker' in navigator) || !window.isSecureContext) return;
  try { PUSH.reg = await navigator.serviceWorker.register('sw.js'); navigator.serviceWorker.addEventListener('message', swMsg); } catch(e){}
}
function swMsg(e){
  const m = e.data || {};
  if (m.type === 'push' && (m.kind === 'call' || m.kind === 'missed')) vcTick();
  if (m.type === 'push' && m.kind === 'msg' && !document.hidden) chatLoadUsers();
  if (m.type === 'nav'){ openFromUrl(m.url); vcTick(); }
}
function openFromUrl(u){
  let v = ''; try { v = new URL(u || location.href, location.href).searchParams.get('go') || ''; } catch {}
  if (!v || !TITLES[v] || !S.d) return false;
  go(v); return true;
}
function swCloseNotes(tag){
  try { if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistration().then(r => r && r.getNotifications && r.getNotifications({ tag }).then(l => l.forEach(n => n.close()))).catch(() => {}); } catch {}
}
async function pushSub(){
  try { const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((_, no) => setTimeout(() => no(new Error('sw')), 8000))]); return await reg.pushManager.getSubscription(); }
  catch { return null; }
}
async function pushSync(){                    // keep this phone attached to whoever is signed in now
  if (!pushSupported() || Notification.permission !== 'granted' || S.offlineMode) return;
  try { const sub = await pushSub(); if (sub) await chatApi('pushSubscribe', { sub:sub.toJSON(), ua:navigator.userAgent.slice(0, 100) }); } catch(e){}
}
async function pushOffHere(){                 // on sign-out: this phone stops getting this person's notifications
  if (!pushSupported() || !S.token) return;
  const sub = await pushSub(); if (sub) await chatApi('pushOff', { endpoint:sub.endpoint });
}
async function pushEnable(){
  if (!pushSupported()) return toast(pushWhy(), true);
  try{
    const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (perm !== 'granted') return toast('Notifications are blocked. Allow them for this site in your browser / phone settings.', true);
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((_, no) => setTimeout(() => no(new Error('The app is still setting itself up. Close and reopen it, then try again.')), 8000))]);
    const want = u8((await chatApi('pushKey')).key);
    let sub = await reg.pushManager.getSubscription();
    if (sub){                                  // made with another server key (keys were changed): start again
      const have = sub.options && sub.options.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
      if (have && (have.length !== want.length || have.some((x, i) => x !== want[i]))){ await sub.unsubscribe(); sub = null; }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:want });
    await chatApi('pushSubscribe', { sub:sub.toJSON(), ua:navigator.userAgent.slice(0, 100) });
    toast('🔔 Notifications are on for this phone');
  }catch(e){ toast(e.message || 'Could not turn on notifications', true); }
  pushDraw();
}
function pushCard(){
  return `<div class="card" id="pushCard"><h3>🔔 Notifications</h3>
    <p class="muted" style="margin-bottom:12px">Incoming calls, payment reminders and the 12 o’clock attendance reminder — delivered to this phone even when the app is closed.</p>
    <div id="pushBody"><div class="empty-state">Loading…</div></div></div>`;
}
async function pushDraw(){
  const el = document.querySelector('#pushBody'); if (!el) return;
  if (!pushSupported()){ el.innerHTML = `<div class="muted">${esc(pushWhy())}</div>`; return; }
  if (Notification.permission === 'denied'){ el.innerHTML = '<div class="muted">Notifications are blocked for this site. Open your browser / phone settings, allow notifications for this site, then come back here.</div>'; return; }
  const sub = Notification.permission === 'granted' ? await pushSub() : null;
  if (!sub){ el.innerHTML = '<button class="btn" id="pushOn" type="button">Turn on notifications</button>'; document.querySelector('#pushOn').onclick = pushEnable; return; }
  let pr = { att:true, pay:true, devices:1 }; try { pr = await chatApi('pushPrefs'); } catch {}
  if (!document.querySelector('#pushBody')) return;
  el.innerHTML = `<div style="margin-bottom:10px">✅ <b>On for this phone</b>${pr.devices > 1 ? ` <span class="muted">(${pr.devices} devices)</span>` : ''}</div>
    <label class="check" style="display:flex;gap:8px;align-items:center;margin:8px 0"><input type="checkbox" id="pfAtt" ${pr.att !== false ? 'checked' : ''}> Attendance reminder at 12:00 PM (only if not marked)</label>
    <label class="check" style="display:flex;gap:8px;align-items:center;margin:8px 0"><input type="checkbox" id="pfPay" ${pr.pay !== false ? 'checked' : ''}> Payment reminders (access due date and LIC premiums)</label>
    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost sm" id="pushTest" type="button">Send a test</button><button class="btn ghost sm" id="pushOff" type="button">Turn off on this phone</button></div>`;
  const pref = async o => { try { await chatApi('pushPrefs', o); toast('Saved'); } catch(e){ toast(e.message, true); pushDraw(); } };
  document.querySelector('#pfAtt').onchange = ev => pref({ att:ev.target.checked });
  document.querySelector('#pfPay').onchange = ev => pref({ pay:ev.target.checked });
  document.querySelector('#pushTest').onclick = async () => {
    try { const r = await chatApi('pushTest'); toast(r.sent ? 'Test sent — it should appear in a moment' : 'No phone was reached. Turn notifications off and on again.', !r.sent); } catch(e){ toast(e.message, true); }
  };
  document.querySelector('#pushOff').onclick = async () => {
    try { await chatApi('pushOff', { endpoint:sub.endpoint }); await sub.unsubscribe(); toast('Notifications are off for this phone'); } catch(e){ toast(e.message, true); }
    pushDraw();
  };
}
const bindPush = () => pushDraw();
swRegister();

/* =====================================================================
   CHAT: ＋ menu  ->  photos / videos (saved in the admin's Google Drive) and live location
   A message only carries a small marker:  [[KSMEDIA:{"k":"img|vid","id":"<Drive file id>",...}]]  or  [[KSLOC:lat,lng]]
   ===================================================================== */
const MEDIA_MAX_MB = 25;
const chPrev = t => { t = String(t || ''); return t.startsWith('[[KSLOC:') ? '📍 Location' : t.startsWith('[[KSMEDIA:') ? (/"k":"vid"/.test(t) ? '🎥 Video' : '📷 Photo') : t; };
const MEDIA = { pass:'', exp:0, loading:false };
function mediaPassGet(){
  if (MEDIA.pass && MEDIA.exp > Date.now() + 60000) return MEDIA.pass;
  if (!MEDIA.loading && S.token){
    MEDIA.loading = true;
    chatApi('mediaPass').then(r => { MEDIA.pass = r.pass; MEDIA.exp = r.exp; }).catch(() => {}).finally(() => { MEDIA.loading = false; if (MEDIA.pass && S.view === 'chat'){ S.chat.sig = ''; chatRenderMsgs(); } });
  }
  return MEDIA.exp > Date.now() ? MEDIA.pass : '';
}
function chBody(t){
  t = String(t || '');
  let m = t.match(/^\[\[KSLOC:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\]\]$/);
  if (m) return `<a class="ch-loc" href="https://www.google.com/maps?q=${m[1]},${m[2]}" target="_blank" rel="noopener"><span class="pin">📍</span><b>Location</b><small>Tap to open in Google Maps</small></a>`;
  m = t.match(/^\[\[KSMEDIA:(\{.*\})\]\]$/);
  if (m){
    try{
      const o = JSON.parse(m[1]); if (!/^[\w-]{10,90}$/.test(String(o.id))) throw 0;
      const p = mediaPassGet(); if (!p) return '<div class="ch-med ph">⏳ Loading…</div>';
      const src = API_URL + '/chat/media?id=' + encodeURIComponent(o.id) + '&p=' + encodeURIComponent(p);
      return o.k === 'vid' ? `<video class="ch-med" controls playsinline preload="metadata" src="${esc(src)}"></video>`
                           : `<img class="ch-med" loading="lazy" alt="Photo" src="${esc(src)}" onclick="mediaView(this.src)">`;
    }catch(e){}
  }
  return esc(t);
}
function mediaView(src){
  const d = document.createElement('div'); d.className = 'ch-view';
  d.innerHTML = `<img src="${esc(src)}" alt=""><button type="button" aria-label="Close">✕</button><a href="${esc(src)}" target="_blank" rel="noopener">Open ↗</a>`;
  d.onclick = e => { if (e.target.tagName !== 'IMG') d.remove(); };
  document.body.appendChild(d);
}
function chatPlus(ev){ if (ev) ev.stopPropagation(); const m = $('#chMenu'); if (m) m.classList.toggle('hidden'); }
document.addEventListener('click', e => { const m = $('#chMenu'); if (m && !m.classList.contains('hidden') && !e.target.closest('#chMenu')) m.classList.add('hidden'); });
function chatPick(kind){
  const m = $('#chMenu'); if (m) m.classList.add('hidden');
  if (HAS_GAS) return toast('Photo / video sharing works only on the main website.', true);
  const i = $('#chFile' + ({ gal:'Gal', cam:'Cam', rec:'Rec' })[kind]); if (i) i.click();
}
function chatFilePicked(inp){
  const f = inp.files && inp.files[0], to = S.chat.with; inp.value = '';
  if (f && to) chatUploadMedia(f, to);
}
function chatUpBar(pct, label){
  let el = $('#chUp');
  if (pct === null){ if (el) el.remove(); return; }
  if (!el){ el = document.createElement('div'); el.id = 'chUp'; el.className = 'ch-up'; const c = document.querySelector('.ch-comp'); if (c && c.parentNode) c.parentNode.insertBefore(el, c); else return; }
  el.innerHTML = `<div class="upbar"><i style="width:${pct}%"></i></div><span>${esc(label)}</span>`;
}
async function mediaPrep(file){
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  try{
    const bmp = await createImageBitmap(file), sc = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * sc); cv.height = Math.round(bmp.height * sc);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', .82));
    if (blob && blob.size < file.size) return new File([blob], (file.name || 'photo').replace(/\.\w+$/, '') + '.jpg', { type:'image/jpeg' });
  }catch(e){}
  return file;
}
async function chatSendText(to, text){
  const c = S.chat, cid = (window.crypto && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : String(Math.random()).slice(2) + Date.now()).slice(0, 14);
  const m = { id:cid, t:Date.now(), mine:true, text, state:'pending' };
  (c.msgs[to] = c.msgs[to] || []).push(m); c.histLoaded[to] = true;
  if (c.with === to) chatRenderMsgs(true);
  await chatDeliver(to, m);
}
async function chatUploadMedia(file, to){
  if (!/^(image|video)\//.test(file.type)) return toast('Please choose a photo or a video.', true);
  if (!navigator.onLine) return toast('No internet — try again when you are online.', true);
  const lim = MEDIA_MAX_MB * 1048576;
  if (file.type.startsWith('video/') && file.size > lim) return toast('This video is too big (max ' + MEDIA_MAX_MB + ' MB). Record a shorter one.', true);
  chatUpBar(0, 'Preparing…');
  try{
    const f = await mediaPrep(file); if (f.size > lim) throw new Error('This file is too big (max ' + MEDIA_MAX_MB + ' MB).');
    const q = new URLSearchParams({ name:f.name || 'file', mime:f.type, to });
    const r = await new Promise((resolve, reject) => {
      const x = new XMLHttpRequest(); x.open('POST', API_URL + '/chat/media?' + q.toString());
      x.setRequestHeader('Authorization', 'Bearer ' + S.token); x.setRequestHeader('Content-Type', 'application/octet-stream');
      x.upload.onprogress = e => { if (e.lengthComputable) chatUpBar(Math.min(99, Math.round(e.loaded * 100 / e.total)), 'Uploading… ' + Math.round(e.loaded * 100 / e.total) + '%'); };
      x.onload = () => { try { resolve(JSON.parse(x.responseText)); } catch { reject(new Error('Unexpected server response.')); } };
      x.onerror = x.ontimeout = () => reject(new Error('Upload failed — check your internet connection and try again.'));
      x.send(f);
    });
    if (!r.ok){ const e = new Error(r.error || 'Upload failed'); e.code = r.code; throw e; }
    chatUpBar(100, 'Sending…');
    await chatSendText(to, '[[KSMEDIA:' + JSON.stringify({ k:r.k, id:r.id, n:r.n, m:r.m, s:r.s }) + ']]');
  }catch(e){ chatErr(e); toast(e.message || 'Upload failed', true); }
  finally { chatUpBar(null); }
}
function chatLoc(){
  const m = $('#chMenu'); if (m) m.classList.add('hidden');
  const to = S.chat.with, u = chatPeer(to); if (!to || !u) return;
  if (!navigator.geolocation) return toast('This phone / browser cannot share location.', true);
  if (!confirm('Send your current location to ' + (u.name || u.username) + '?')) return;
  toast('Getting your location…');
  navigator.geolocation.getCurrentPosition(
    p => chatSendText(to, '[[KSLOC:' + p.coords.latitude.toFixed(6) + ',' + p.coords.longitude.toFixed(6) + ']]'),
    err => toast(err && err.code === 1 ? 'Location is blocked. Allow it for this site in your phone settings.' : 'Could not get your location. Turn on GPS and try again.', true),
    { enableHighAccuracy:true, timeout:20000, maximumAge:15000 });
}

/* ---- Settings card (main admin): connect the Google Drive where chat media is saved ---- */
function driveCard(){
  return `<div class="card" id="drvCard"><h3>☁️ Google Drive (Chat photos & videos)</h3>
    <p class="muted" style="margin-bottom:12px">Every photo / video sent in Chat is saved in the folder <b>KS Chat Media</b> in the Google Drive you connect here (max ${MEDIA_MAX_MB} MB each).</p>
    <div id="drvBody"><div class="empty-state">Loading…</div></div></div>`;
}
async function drvDraw(){
  const el = $('#drvBody'); if (!el) return;
  try{
    const r = await chatApi('driveStatus');
    el.innerHTML = r.connected
      ? `<div style="margin-bottom:10px">✅ <b>Connected</b>${r.email ? ' · ' + esc(r.email) : ''}</div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost sm" id="drvOn" type="button">Reconnect</button><button class="btn ghost sm" id="drvOff" type="button">Disconnect</button></div>`
      : (r.ready ? `<div class="muted" style="margin-bottom:10px">Not connected yet — chat photos / videos will not send until you connect.</div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="drvOn" type="button">Connect Google Drive</button><button class="btn ghost sm" id="drvChk" type="button">I connected — check</button></div>`
                 : '<div class="muted">Google sign-in is not set up on the server yet (CAL_CLIENT_ID, CAL_CLIENT_SECRET, PUBLIC_URL on Render).</div>');
    const on = $('#drvOn'), off = $('#drvOff'), chk = $('#drvChk');
    if (on) on.onclick = async () => { try { const j = await chatApi('driveConnect'); window.open(j.url, '_blank'); toast('Finish in the Google page, then come back and tap “check”.'); } catch(e){ toast(e.message, true); } };
    if (chk) chk.onclick = drvDraw;
    if (off) off.onclick = async () => { if (!confirm('Disconnect Google Drive? New photos / videos cannot be sent until you connect again. Files already in Drive stay there.')) return; try { await chatApi('driveOff'); toast('Google Drive disconnected'); } catch(e){ toast(e.message, true); } drvDraw(); };
  }catch(e){ el.innerHTML = `<div class="muted">${esc(e.message || 'Could not load')}</div>`; }
}
const bindDrive = () => { drvDraw(); };
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.view === 'settings') drvDraw(); });


boot();

/* =====================================================================
   VIEW: CHAT  (WhatsApp-style messaging: user list -> tap -> conversation, online / offline + last seen)
   ===================================================================== */
const chatFresh = () => ({ users:[], groups:[], loaded:false, with:null, msgs:{}, peerRead:{}, drafts:{}, unread:0, q:'', n:0, fetching:false, loadingUsers:false, err:'', sig:'', histLoaded:{} });
S.chat = chatFresh();
let chatTimer = null;
function chatReset(){ clearInterval(chatTimer); chatTimer = null; S.chat = chatFresh(); document.body.classList.remove('chat-conv'); chatBadge(); }
function chatStart(){
  clearInterval(chatTimer);
  chatLoadUsers();                                    // also tells the server "I am online"
  chatTimer = setInterval(chatTick, 4000);
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
const chInit = u => u.isGroup ? '👥' : esc((u.name || u.username || '?').trim().charAt(0).toUpperCase());
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
    const prev = u.lastText ? `<div class="ch-prev">${u.lastMine ? 'You: ' : (u.lastFrom ? esc(u.lastFrom) + ': ' : '')}${esc(chPrev(u.lastText))}</div>` : '';
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
  $('#chatRoot').classList.add('in-conv');
  pane.innerHTML = `<div class="ch-head">
      <button class="ch-back" onclick="chatBack()" aria-label="Back">←</button>
      <div class="ch-av" id="chHAv" style="background:${chColor(u.id)}">${chInit(u)}<span class="dot"></span></div>
      <div class="ch-info"><div class="ch-name"><span class="nm">${esc(u.name || u.username)}</span><span class="dot" id="chHDot"></span></div><div class="ch-stat" id="chHStat"></div></div>
      <div class="ch-calls"><button class="ch-cbtn" onclick="ludoDial()" aria-label="Play Ludo">🎲</button>${u.isGroup ? `<button class="ch-cbtn" onclick="groupChatForm('${esc(u.id)}')" aria-label="Group info">ℹ️</button>` : `<button class="ch-cbtn" onclick="vcDial('audio')" aria-label="Voice call">📞</button><button class="ch-cbtn" onclick="vcDial('video')" aria-label="Video call">🎥</button>`}</div>
    </div>
    <div class="ch-msgs" id="chMsgs"></div>
    <div class="ch-menu hidden" id="chMenu">
      <button type="button" onclick="chatPick('gal')"><span>🖼️</span>Photo / Video</button>
      <button type="button" onclick="chatPick('cam')"><span>📷</span>Camera</button>
      <button type="button" onclick="chatPick('rec')"><span>🎥</span>Record video</button>
      <button type="button" onclick="chatLoc()"><span>📍</span>Location</button>
    </div>
    <input type="file" id="chFileGal" class="hidden" accept="image/*,video/*" onchange="chatFilePicked(this)">
    <input type="file" id="chFileCam" class="hidden" accept="image/*" capture="environment" onchange="chatFilePicked(this)">
    <input type="file" id="chFileRec" class="hidden" accept="video/*" capture="environment" onchange="chatFilePicked(this)">
    <div class="ch-comp"><button class="ch-plus" id="chPlus" type="button" onclick="chatPlus(event)" aria-label="Attach">＋</button><textarea id="chInput" rows="1" placeholder="Type a message" maxlength="2000"></textarea>
      <button class="ch-send" id="chSend" onclick="chatSend()" aria-label="Send">➤</button></div>`;
  const ta = $('#chInput');
  ta.value = S.chat.drafts[u.id] || '';
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; };
  ta.oninput = () => { S.chat.drafts[u.id] = ta.value; grow(); };
  ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer:fine)').matches){ e.preventDefault(); chatSend(); } };
  grow(); chatHeader(); S.chat.sig = ''; chatRenderMsgs(true);
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
  const id = S.chat.with, arr = S.chat.msgs[id] || [], pr = S.chat.peerRead[id] || 0;
  const sig = arr.map(m => m.id + (m.state || '') + (m.mine && m.t <= pr ? 'r' : '')).join(',') + '|' + S.chat.histLoaded[id];
  if (sig === S.chat.sig && !toBottom) return;
  S.chat.sig = sig;
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 90;
  if (!arr.length){
    box.innerHTML = `<div class="ch-load">${S.chat.histLoaded[id] ? 'No messages yet — say hi 👋' : 'Loading messages…'}</div>`;
    return;
  }
  let html = '', day = '';
  arr.forEach(m => {
    const dl = chDayLabel(m.t);
    if (dl !== day){ day = dl; html += `<div class="ch-day">${esc(dl)}</div>`; }
    let meta = esc(chClock(m.t));
    if (m.mine){
      if (m.state === 'pending') meta = 'Sending…';
      else if (m.state === 'failed') meta = 'Not sent · tap to retry';
      else meta += ` <span class="tick ${m.t <= pr ? 'read' : ''}">${m.t <= pr ? '✓✓' : '✓'}</span>`;
    }
    html += `<div class="ch-b ${m.mine ? 'me' : 'them'} ${m.state || ''}" ${m.state === 'failed' ? `onclick="chatRetry('${esc(m.id)}')"` : ''}>${!m.mine && m.from ? `<div class="mf" style="color:${chColor(m.from)}">${esc(m.from)}</div>` : ''}<div class="tx">${chBody(m.text)}</div><div class="mt">${meta}</div></div>`;
  });
  box.innerHTML = html;
  if (toBottom || near) box.scrollTop = box.scrollHeight;
}
function chatMerge(id, list){
  const a = S.chat.msgs[id] || (S.chat.msgs[id] = []); let changed = false;
  list.forEach(m => {
    const i = a.findIndex(x => x.id === m.id);
    if (i >= 0){ if (a[i].state || a[i].t !== m.t || a[i].text !== m.text || a[i].from !== m.from){ a[i] = m; changed = true; } }
    else { a.push(m); changed = true; }
  });
  if (changed) a.sort((x, y) => x.t - y.t);
  return changed;
}
const chatAfter = id => (S.chat.msgs[id] || []).reduce((mx, m) => m.state ? mx : Math.max(mx, m.t), 0);

async function chatLoadUsers(){
  if (S.chat.loadingUsers || !S.token) return;
  S.chat.loadingUsers = true;
  try{
    const r = await chatApi('chatUsers'), at = Date.now();
    const incoming = r.unread > S.chat.unread && S.view !== 'chat' && S.chat.loaded;
    S.chat.users = r.users.map(u => ({ ...u, at }));
    S.chat.groups = (r.groups || []).map(g => ({ ...g, at }));
    S.chat.users.concat(S.chat.groups).forEach(u => { if (S.view === 'chat' && S.chat.with === u.id) u.unread = 0; });   // the open chat is being read
    if (S.chat.with && !chatPeer(S.chat.with)){ S.chat.with = null; document.body.classList.remove('chat-conv'); if (S.view === 'chat') chatRenderPane(); }   // group deleted / permission removed
    S.chat.loaded = true; chatSumUnread();
    if (incoming){ toast('💬 New message'); chatBuzz(); }
    S.chat.err = '';
    if (S.view === 'chat'){ chatRenderList(); chatHeader(); }
  }catch(e){ chatErr(e); S.chat.err = (e && e.message) || 'Request failed'; if (S.view === 'chat') chatRenderList(); }
  finally{ S.chat.loadingUsers = false; }
}
async function chatPingNow(){
  try{
    const r = await chatApi('chatPing');
    if (r.unread > S.chat.unread && S.view !== 'chat'){ toast('💬 New message'); chatBuzz(); }
    S.chat.unread = r.unread; chatBadge();
  }catch(e){ chatErr(e); }
}
async function chatFetchConv(first){
  const c = S.chat, id = c.with;
  if (!id || c.fetching) return;
  c.fetching = true;
  try{
    const r = await chatApi('chatFetch', { with:id, after:chatAfter(id) });
    if (c.with !== id) return;                                  // the user opened another chat meanwhile
    let ch = chatMerge(id, r.messages);
    if (!c.histLoaded[id]){ c.histLoaded[id] = true; ch = true; }
    if (r.peerRead !== c.peerRead[id]){ c.peerRead[id] = r.peerRead; ch = true; }
    const u = chatPeer(id);
    if (u && u.isGroup && r.group){ u.name = r.group.name; u.members = r.group.members; }
    if (u && r.presence){ u.online = r.presence.online; u.ago = r.presence.ago; u.at = Date.now(); }
    if (u && r.messages.some(m => !m.mine)){
      if (!first && ch) chatBuzz();                              // a message arrived in the chat that is open right now
      u.unread = 0; chatSumUnread();
      const last = r.messages[r.messages.length - 1]; u.lastText = last.text.slice(0, 80); u.lastTime = last.t; u.lastMine = last.mine;
      chatRenderList();
    }
    chatHeader();
    if (ch || first) chatRenderMsgs(!!first);
  }catch(e){ chatErr(e); }
  finally{ c.fetching = false; }
}
function chatOpen(id){
  const c = S.chat; if (!chatPeer(id)) return;
  c.with = id; const u = chatPeer(id); if (u){ u.unread = 0; chatSumUnread(); }
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
function chatBack(){
  S.chat.with = null; document.body.classList.remove('chat-conv');
  chatRenderList(); chatRenderPane(); chatLoadUsers();
}
async function chatSend(){
  const c = S.chat, to = c.with, ta = $('#chInput'); if (!to || !ta) return;
  const text = ta.value.trim(); if (!text) return;
  ta.value = ''; c.drafts[to] = ''; ta.style.height = 'auto'; ta.focus();
  const cid = (window.crypto && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : String(Math.random()).slice(2) + Date.now()).slice(0, 14);
  const m = { id:cid, t:Date.now(), mine:true, text, state:'pending' };
  (c.msgs[to] = c.msgs[to] || []).push(m); c.histLoaded[to] = true;
  chatRenderMsgs(true);
  await chatDeliver(to, m);
}
async function chatDeliver(to, m){
  const c = S.chat;
  try{
    const r = await chatApi('chatSend', { to, cid:m.id, text:m.text });
    const arr = c.msgs[to] || [], i = arr.findIndex(x => x.id === m.id);
    if (i >= 0) arr[i] = r.message; else arr.push(r.message);
    arr.sort((x, y) => x.t - y.t);
    const u = chatPeer(to); if (u){ u.lastText = m.text.slice(0, 80); u.lastTime = r.message.t; u.lastMine = true; }
  }catch(e){ m.state = 'failed'; chatErr(e); if (!e.code || e.code === 'ERR') toast(e.message || 'Message not sent', true); }
  if (c.with === to) chatRenderMsgs(true);
  chatRenderList();
}
function chatRetry(id){
  const to = S.chat.with, m = (S.chat.msgs[to] || []).find(x => x.id === id);
  if (!m || m.state !== 'failed') return;
  m.state = 'pending'; chatRenderMsgs(); chatDeliver(to, m);
}
function chatTick(){
  const c = S.chat;
  if (!S.token || !S.d || document.hidden) return;                 // a hidden tab stops pinging, so the person shows as offline
  c.n++;
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


/* =====================================================================
   VOICE / VIDEO CALLS  (WebRTC — the audio/video goes phone-to-phone; the server only passes the offer/answer)
   ===================================================================== */
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
/* new chat message: 2 short buzzes + 2 soft beeps */
function chatBuzz(){
  try { vcBeep(990, .12); setTimeout(() => vcBeep(1320, .16), 170); } catch {}
  try { navigator.vibrate && navigator.vibrate([220, 110, 220]); } catch {}
}
function vcRingStart(incoming){
  vcRingStop();
  const once = () => {
    if (incoming){ vcBeep(880, .3); setTimeout(() => vcBeep(660, .3), 380); try { navigator.vibrate && navigator.vibrate([900, 400, 900]); } catch {} }
    else vcBeep(440, .7);
  };
  once(); VC.ring = setInterval(once, incoming ? 2200 : 3200);
}
function vcRingStop(){ clearInterval(VC.ring); VC.ring = null; try { navigator.vibrate && navigator.vibrate(0); } catch {} }

/* ---------- full-screen call screen ---------- */
function vcRoot(){
  let el = document.getElementById('vcUI'); if (el) return el;
  el = document.createElement('div'); el.id = 'vcUI'; el.className = 'vc hidden';
  el.innerHTML = `<video id="vcRemote" class="vc-remote" autoplay playsinline></video>
    <video id="vcLocal" class="vc-local hidden" autoplay playsinline muted></video>
    <div class="vc-top"><div class="vc-av" id="vcAv"></div><div class="vc-name" id="vcName"></div><div class="vc-stat" id="vcStat"></div></div>
    <div class="vc-bar" id="vcBar"></div>`;
  document.body.appendChild(el); return el;
}
function vcOpen(name, id, stat){
  const el = vcRoot(); el.classList.remove('hidden', 'vc-live'); el.classList.toggle('vc-audio', VC.kind !== 'video');
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
  const el = document.getElementById('vcUI'); if (el) el.classList.add('hidden');
  document.body.classList.remove('vc-open');
}

/* ---------- WebRTC plumbing ---------- */
async function vcIce(){
  if (VC.ice) return VC.ice;
  try { VC.ice = (await chatApi('callConfig')).iceServers; } catch { VC.ice = [{ urls:'stun:stun.l.google.com:19302' }]; }
  return VC.ice;
}
async function vcMedia(kind){
  const video = kind === 'video' ? { facingMode:'user', width:{ ideal:640 }, height:{ ideal:480 } } : false;
  VC.local = await navigator.mediaDevices.getUserMedia({ audio:{ echoCancellation:true, noiseSuppression:true }, video });
  const lv = document.getElementById('vcLocal');
  if (kind === 'video'){ lv.srcObject = VC.local; lv.classList.remove('hidden'); lv.play && lv.play().catch(() => {}); }
  else lv.classList.add('hidden');
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
  document.getElementById('vcUI').classList.add('vc-live');
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
  swCloseNotes('call');
  vcRingStop(); clearInterval(VC.tick); clearTimeout(VC.lost);
  try { VC.pc && VC.pc.close(); } catch {}
  try { VC.local && VC.local.getTracks().forEach(t => t.stop()); } catch {}
  ['vcRemote', 'vcLocal'].forEach(id => { const v = document.getElementById(id); if (v){ v.srcObject = null; } });
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
  swCloseNotes('call');
  VC.incoming = inc; VC.kind = inc.kind; VC.peer = { id:inc.from, name:inc.fromName };
  vcOpen(inc.fromName, inc.from, 'Incoming ' + (inc.kind === 'video' ? 'video' : 'voice') + ' call…'); vcBar('incoming'); vcRingStart(true);
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
.lu-top{width:100%;max-width:460px;display:flex;align-items:center;justify-content:space-between;gap:10px;font-weight:800;font-size:18px}
.lu-top button{background:rgba(255,255,255,.12);color:#fff;border:0;border-radius:10px;padding:8px 12px;font-weight:700;font-size:14px}
.lu-pl{width:100%;max-width:460px;display:flex;gap:8px;margin:10px 0}
.lu-p{flex:1;display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:12px;background:rgba(255,255,255,.08);border:2px solid transparent;min-width:0;font-weight:700;font-size:14px}
.lu-p.on{border-color:#fff;background:rgba(255,255,255,.18)}
.lu-p i{width:14px;height:14px;border-radius:50%;flex:none;border:2px solid #fff}
.lu-p span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lu svg{width:100%;max-width:460px;aspect-ratio:1;background:#fff;border-radius:12px;touch-action:manipulation}
.lt{transition:transform .35s ease}
.lt circle.b{stroke:#fff;stroke-width:.1}
.lt.go circle.r{fill:none;stroke:#fff;stroke-width:.12;animation:luP 0.8s infinite}
.lt.go{cursor:pointer}
@keyframes luP{0%,100%{opacity:1;r:.5}50%{opacity:.25;r:.62}}
.lu-msg{margin:12px 0 6px;font-size:15px;font-weight:600;text-align:center;min-height:22px}
.lu-dice{display:flex;align-items:center;gap:16px;justify-content:center}
.lu-die{font-size:64px;line-height:1;width:76px;height:76px;display:grid;place-items:center;background:#fff;color:#0f172a;border-radius:16px}
.lu-die.sh{animation:luS .45s}
@keyframes luS{0%{transform:rotate(0)}25%{transform:rotate(-25deg)}50%{transform:rotate(22deg)}75%{transform:rotate(-12deg)}100%{transform:rotate(0)}}
.lu-roll{background:#22c55e;color:#fff;border:0;border-radius:14px;padding:16px 26px;font-size:18px;font-weight:800}
.lu-roll:disabled{opacity:.4}
.lu-card{margin:auto;text-align:center;display:flex;flex-direction:column;gap:14px;align-items:center;padding:20px}
.lu-card .big{font-size:56px}.lu-card h2{margin:0;font-size:22px}.lu-card p{margin:0;opacity:.8}
.lu-card .row{display:flex;gap:12px}
.lu-card button{border:0;border-radius:12px;padding:13px 22px;font-weight:800;font-size:16px;color:#fff;background:#22c55e}
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
