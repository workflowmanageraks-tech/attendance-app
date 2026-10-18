
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
  wy:new Date().getFullYear(), wcm:new Date().getMonth()+1, wf:defaultWf(), wAdd:{}, wEdit:null, wDraft:{}, wBusy:false, emp:null, me:null, as:null, users:null, logs:null, lf:{ u:'all', r:'all', q:'' }, tt:{ date:'' }, pw:{ q:'' }, link:{ q:'', type:'all' }, groups:null, sig:'' };

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
function callServer(body){
  if (HAS_GAS){
    return new Promise((resolve, reject) => {
      google.script.run
        .withSuccessHandler(r => { try { resolve(JSON.parse(r)); } catch { reject(new Error('Unexpected server response.')); } })
        .withFailureHandler(err => reject(new Error((err && err.message) || 'Server error')))
        .apiCall(JSON.stringify(body));
    });
  }
  return fetch(API_URL, {
    method:'POST',
    headers:{'Content-Type':'text/plain;charset=utf-8'},   // avoids CORS pre-flight
    body: JSON.stringify(body)
  }).then(r => r.json()).catch(() => { throw new Error('Cannot reach the server. Check the Apps Script deployment (Anyone can access).'); });
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
  clearInterval(syncT); syncT = null; setMenu(false);
  clearToken(); S.d = null; S.me = null; S.as = null; S.users = null; S.logs = null; S.view = 'dashboard'; closeModals(); chatReset();
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
  }catch(e){ showLoginErr(e.message); }
  finally{ btn.disabled = false; btn.textContent = S.setup ? 'Create login & continue' : 'Sign in'; }
});
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
  if (isAdmin()){ await loadUsers(); await loadGroups(); } else { S.users = null; S.groups = null; }
  applyAccess(); startSync();
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
  chatStart();
  if (isAdmin()) loadLogs();
}
async function boot(){
  const t = store.get(TK);
  let st;
  try { st = await api('status'); }
  catch(e){ showLogin(false, 'Cannot reach the server: ' + e.message); return; }
  if (t && !st.needsSetup){
    S.token = t;
    try { await loadAll(); enterApp(); return; } catch { clearToken(); }
  }
  showLogin(st.needsSetup, '', st.needsSetupCode);
}

/* =====================================================================
   MULTI-USER: who am I, permissions, device + location capture
   ===================================================================== */
const DID = 'att_tracker_did';
const isAdmin = () => !!(S.me && S.me.role === 'admin');
const perms = () => (S.me && S.me.perms) || { att:'edit', exp:'edit', work:'edit', pw:'edit', link:'edit', tt:'edit', emp:true, creds:true };
const can = sec => (sec === 'emp' || sec === 'creds') ? !!perms()[sec] : perms()[sec] === 'edit';
function deny(){ toast('You have view-only access to this section', true); }
const SECT = { attendance:'att', expenses:'exp', work:'work', timetable:'tt', passwords:'pw', links:'link' };
const SECT_NAME = { attendance:'Attendance', expenses:'Expenses', work:'Work', timetable:'Time Table', passwords:'Passwords', links:'Links' };

function applyAccess(){
  const p = perms();
  const hide = (v, h) => { const b = document.querySelector(`#nav [data-v="${v}"]`); if (b) b.classList.toggle('hidden', h); };
  hide('attendance', p.att === 'none'); hide('expenses', p.exp === 'none'); hide('work', p.work === 'none'); hide('timetable', p.tt === 'none'); hide('passwords', p.pw === 'none'); hide('links', p.link === 'none'); hide('logins', !isAdmin());
  if ((SECT[S.view] && p[SECT[S.view]] === 'none') || (S.view === 'logins' && !isAdmin())) S.view = 'dashboard';
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
  if (S.view === 'logins' || (S.view === 'dashboard' && !S.as)) render();
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
function getGps(){
  return new Promise(res => {
    if (!navigator.geolocation) return res(null);
    let done = false; const fin = v => { if (!done){ done = true; res(v); } };
    setTimeout(() => fin(null), 10000);
    try {
      navigator.geolocation.getCurrentPosition(
        p => fin({ lat:p.coords.latitude, lng:p.coords.longitude, acc:Math.round(p.coords.accuracy), src:'GPS' }),
        () => fin(null), { enableHighAccuracy:true, timeout:8000, maximumAge:60000 });
    } catch { fin(null); }
  });
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
    const [gps, ip, hi] = await Promise.all([getGps(), getIp(), highEntropy()]);
    const u = uaInfo(hi);
    c = { ...c, ...u, screen:`${screen.width}x${screen.height}@${window.devicePixelRatio || 1}`,
      tz:(Intl.DateTimeFormat().resolvedOptions().timeZone || ''), ip:ip.ip || '', city:ip.city || '' };
    if (gps) Object.assign(c, gps);
    else if (typeof ip.lat === 'number') Object.assign(c, { lat:ip.lat, lng:ip.lng, acc:'', src:'IP (approx.)' });
  } catch {}
  return c;
}

/* ---------- users & access (admin) ---------- */
function permSummary(u){
  if (u.role === 'admin') return 'Full access';
  const p = u.perms || {}, L = { none:'no access', view:'view only', edit:'can edit' };
  return `Attendance: ${L[p.att]} · Expenses: ${L[p.exp]} · Work: ${L[p.work]} · Passwords: ${L[p.pw || 'edit']} · Links: ${L[p.link || 'edit']} · Time Table: ${L[p.tt || 'edit']} · Employees: ${p.emp ? 'can manage' : 'no'}`;
}
function usersCard(){
  const list = S.users || [];
  const rows = list.map(u => {
    const tag = u.primary ? '<span class="tag main">Main admin</span>' : u.role === 'admin' ? '<span class="tag adm">Admin</span>' : '<span class="tag">User</span>';
    const off = u.active ? '' : '<span class="tag off">Disabled</span>';
    const last = u.lastLogin ? 'Last login ' + fmtLogTime(u.lastLogin) : 'Never signed in';
    const mine = S.me && u.id === S.me.id;
    const editable = !u.primary && (S.me.primary || u.role !== 'admin') && !(mine && !S.me.primary);
    const acts = (!mine ? `<button class="btn ghost sm" onclick="setAs('${esc(u.id)}')" title="See this user’s data">👁 View</button>` : '')
      + (editable ? `<button class="btn ghost sm" onclick="userForm('${esc(u.id)}')">✎ Edit</button><button class="btn ghost sm" onclick="kickUser('${esc(u.id)}')" title="Sign out everywhere">⎋</button><button class="btn ghost sm" onclick="delUser('${esc(u.id)}')" title="Delete user">🗑</button>` : '');
    return `<div class="emp-item"><div class="avatar">${esc((u.name || u.username || '?').trim().charAt(0).toUpperCase())}</div>
      <div class="info"><b>${esc(u.name || u.username)}${tag}${off}</b><span>@${esc(u.username)} · ${esc(last)}</span><span class="perm-sum">${esc(permSummary(u))}${u.needLoc ? ' · location required' : ''}</span></div>
      <div class="acts">${acts}</div></div>`;
  }).join('');
  return `<div class="card"><h3>🛡️ Users & access <button class="btn sm" onclick="userForm()">＋ Add user</button></h3>
    <p class="muted" style="margin-bottom:12px">Each user signs in with their own username and password and sees only their own data. You decide what each user may open or change.
      Use <b>👁 View</b> to look at (or fix) a user’s data. Login time, location and device of everyone are in the <b>Logins</b> tab.</p>
    <div class="emp-list">${rows || '<div class="empty-state">No users yet</div>'}</div></div>`;
}
function userForm(id){
  const x = id ? (S.users || []).find(u => u.id === id) : null;
  const p = (x && x.perms) || { att:'edit', exp:'edit', work:'edit', pw:'edit', emp:false, creds:true };
  const sel = (n, v) => `<select class="select" name="${n}"><option value="none" ${v==='none'?'selected':''}>No access (hidden)</option><option value="view" ${v==='view'?'selected':''}>View only</option><option value="edit" ${v==='edit'?'selected':''}>Can add / edit / delete</option></select>`;
  const isA = !!(x && x.role === 'admin');
  const w = openModal(`<h3>${x ? 'Edit user' : 'Add user'}</h3><p class="sub">${x ? 'Leave password empty to keep it.' : 'Set a username and password, then share them with the user.'}</p>
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
          <div class="field"><label>⏱️ Time Table</label>${sel('p_tt', p.tt || 'edit')}</div>
        </div>
        <label class="tog"><input type="checkbox" name="p_emp" ${p.emp ? 'checked' : ''}> Can add / edit / delete employees</label>
        <label class="tog"><input type="checkbox" name="p_creds" ${p.creds ? 'checked' : ''}> Can change their own username & password</label>
      </fieldset>
      <label class="tog"><input type="checkbox" name="active" ${(!x || x.active) ? 'checked' : ''}> Account active (untick to block sign-in)</label>
      <label class="tog"><input type="checkbox" name="needLoc" ${x && x.needLoc ? 'checked' : ''}> Location required to sign in <span class="muted">(blocks login if no location can be found)</span></label>
      <div class="field"><label>Payment due until <span class="muted">(after this date/time, login is blocked with a payment-reminder message, until you clear or extend it)</span></label>
        <input class="input" type="datetime-local" name="payDue" value="${x && x.payDue ? x.payDue.replace(' ', 'T').slice(0,16) : ''}"></div>
      <div class="foot"><button type="button" class="btn ghost" data-x>Cancel</button><button class="btn" type="submit">${x ? 'Save user' : 'Add user'}</button></div></form>`, 'wide');
  w.querySelector('[data-x]').onclick = () => w.remove();
  const roleEl = w.querySelector('#ufRole');
  if (roleEl) roleEl.onchange = () => { w.querySelector('#ufPerms').disabled = roleEl.value === 'admin'; };
  w.querySelector('#uf').onsubmit = async ev => {
    ev.preventDefault(); const f = new FormData(ev.target), btn = ev.submitter; btn.disabled = true;
    try {
      const r = await api('saveUser', { id: x ? x.id : '', name:f.get('name'), username:f.get('username'), password:f.get('password'), email:f.get('email'),
        role:f.get('role') || 'user', active:!!f.get('active'), needLoc:!!f.get('needLoc'), payDue:f.get('payDue') || '',
        perms:{ att:f.get('p_att'), exp:f.get('p_exp'), work:f.get('p_work'), pw:f.get('p_pw'), link:f.get('p_link'), tt:f.get('p_tt'), emp:!!f.get('p_emp'), creds:!!f.get('p_creds') } });
      S.users = r.users; w.remove(); render(); toast(x ? 'User updated' : 'User added');
    } catch(e){ btn.disabled = false; handleErr(e); }
  };
}
async function delUser(id){
  const u = (S.users || []).find(x => x.id === id); if (!u) return;
  if (!await confirmBox('Delete ' + (u.name || u.username) + '?', 'They will not be able to sign in any more. Their data stays in your sheet.', 'Delete', true)) return;
  try { const r = await api('deleteUser', { id }); S.users = r.users; if (S.as === id){ await setAs(''); } else render(); toast('User deleted'); } catch(e){ handleErr(e); }
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
function logItem(l, compact){
  const good = l.result === 'Success', who = l.name || l.username || '(unknown)';
  const loc = (l.lat != null && l.lng != null)
    ? `📍 ${l.lat.toFixed(5)}, ${l.lng.toFixed(5)} <span class="tag">${esc(l.src === 'GPS' ? 'GPS' + (l.acc != null ? ' ±' + l.acc + ' m' : '') : (l.src || 'approx.'))}</span> <a href="https://www.google.com/maps?q=${l.lat},${l.lng}" target="_blank" rel="noopener">Open map ↗</a>`
    : '📍 Location not available';
  const dev = [l.device, l.browser, l.os].filter(Boolean).join(' · ');
  return `<div class="log-item ${good ? '' : 'bad'}">
    <div class="l1"><b>${esc(who)} <span class="muted" style="font-weight:500">@${esc(l.username)}</span></b>
      <span><span class="pill ${good ? 'inc' : 'exp'}">${esc(l.result)}</span> <span class="muted">${esc(fmtLogTime(l.time))}</span></span></div>
    <div class="l2">📱 ${esc(dev || 'Unknown device')}${compact ? '' : (l.screen ? ' · ' + esc(l.screen) : '')}</div>
    <div class="l2">${loc}</div>
    ${compact ? '' : `<div class="l2">🌐 ${esc([l.ip, l.city].filter(Boolean).join(' · ') || '—')}${l.deviceId ? ' · Device ID ' + esc(l.deviceId.slice(-6)) : ''}${l.tz ? ' · ' + esc(l.tz) : ''}${l.reason ? ' · ' + esc(l.reason) : ''}</div>`}
  </div>`;
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
    <div class="loglist" id="logList">${S.logs ? '' : '<div class="card"><div class="empty-state">Loading login activity…</div></div>'}</div>`;
}
function bindLogins(){
  if (!$('#lfU')) return;
  $('#lfU').onchange = e => { S.lf.u = e.target.value; drawLogList(); };
  $('#lfR').onchange = e => { S.lf.r = e.target.value; drawLogList(); };
  $('#lfQ').oninput = e => { S.lf.q = e.target.value; drawLogList(); };
  if (S.logs) drawLogList();
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
  logins:['Login activity','Who signed in, when, from where and from which device'],
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
}
$('#nav').addEventListener('click', e => { const b = e.target.closest('button'); if (b) go(b.dataset.v); });
$('#logoutBtn').onclick = $('#logoutBtn2').onclick = $('#logoutBtn3').onclick = logout;
$('#refreshBtn').onclick = async () => { try { await loadAll(); render(); toast('Data refreshed'); if (isAdmin()) loadLogs(); } catch(e){ handleErr(e); } };
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
  let html = ({dashboard:vDashboard, attendance:vAttendance, expenses:vExpenses, work:vWork, timetable:vTimetable, chat:vChat, passwords:vPasswords, links:vLinks, logins:vLogins, settings:vSettings})[S.view]();
  if (S.view === 'dashboard' && isAdmin() && !S.as) html += recentLoginsCard();
  v.innerHTML = banner() + (S.view === 'dashboard' ? payCountdownHtml() : '') + html;
  applyRO(v);
  startPay();
  const after = ({settings:bindSettings, logins:bindLogins, chat:bindChat})[S.view]; if (after) after();
}

/* ---------- calculations ---------- */
const cfg = () => S.d.settings;
const smap = () => Object.fromEntries(S.d.statuses.map(s => [s.code, s]));
function fm(n){ return (cfg().currency || '₹') + Number(n||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function monthStats(m){
  const y = +cfg().year, dim = daysIn(y, m), att = S.d.attendance[m] || {}, sm = smap();
  const counts = {}; let paid = 0, marked = 0;
  for (let d = 1; d <= dim; d++){
    const c = att[d]; if (!c) continue;
    marked++; counts[c] = (counts[c]||0) + 1; paid += sm[c] ? sm[c].factor : 0;
  }
  const e = emp(), basis = +e.basis > 0 ? +e.basis : dim;
  const earned = paid * (+e.salary || 0) / basis;
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
  if (isAdmin()) grid.insertAdjacentHTML('afterbegin', usersCard() + groupsCard());
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
  return { s, e, y, sts, sm, months, yt, totalDays, log, led, inc, exp, bal, catList, monList, work, wMonList, wProdList, wDays:wDays.size, pw };
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

/* ---------- entry point ---------- */
async function doExport(kind, fmt){
  if (S.exBusy) return; S.exBusy = true;
  toast('Preparing your ' + (fmt === 'pdf' ? 'PDF' : 'Excel') + ' file…');
  try{
    const d = exPrep(), names = { att:`KS-attendance-${(d.e.name || 'employee').replace(/[^\w\u0900-\u097F-]+/g,'_')}-${d.y}`, exp:'KS-expense-ledger', work:'KS-work-record', pw:'KS-passwords', all:'KS-all-data' };
    const PP = perms(), inc = { att:(kind === 'att' || kind === 'all') && PP.att !== 'none', exp:(kind === 'exp' || kind === 'all') && PP.exp !== 'none', work:(kind === 'work' || kind === 'all') && PP.work !== 'none' };
    if (!inc.att && !inc.exp && !inc.work && kind !== 'pw'){ toast('Nothing to export for your account', true); return; }
    if (fmt === 'pdf'){
      await needPdf();
      const P = { doc:new window.jspdf.jsPDF({ orientation:(inc.att ? 'l' : inc.exp ? 'p' : 'l'), unit:'mm', format:'a4' }) };
      let first = true;
      if (inc.att){ pdfAtt(P, d, first); first = false; }
      if (inc.exp){ pdfLedger(P, d, first); first = false; }
      if (inc.work){ pdfWork(P, d, first); first = false; }
      if (kind === 'pw'){ pdfPasswords(P, d, first); first = false; }
      pdfFooter(P.doc); saveBlob(names[kind] + '.pdf', P.doc.output('blob'));
    } else {
      await needExcel();
      const wb = new window.ExcelJS.Workbook(); wb.creator = 'KS'; wb.created = new Date();
      if (inc.att){ xlAttSummary(wb, d); xlAttRegister(wb, d); xlAttLog(wb, d); }
      if (inc.exp){ xlLedger(wb, d); xlLedgerSummary(wb, d); }
      if (inc.work){ xlWork(wb, d); xlWorkSummary(wb, d); }
      if (kind === 'pw') xlPasswords(wb, d);
      const buf = await wb.xlsx.writeBuffer();
      saveBlob(names[kind] + '.xlsx', new Blob([buf], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    }
    toast('Download ready ✔');
  }catch(e){ console.error(e); toast((e && e.message) || 'Export failed', true); }
  finally{ S.exBusy = false; }
}


/* =====================================================================
   VIEW: CHAT  (WhatsApp-style messaging: user list -> tap -> conversation, online / offline + last seen)
   ===================================================================== */
const chatFresh = () => ({ users:[], loaded:false, with:null, msgs:{}, peerRead:{}, drafts:{}, unread:0, q:'', n:0, fetching:false, loadingUsers:false, sig:'', histLoaded:{} });
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
const chatPeer = id => S.chat.users.find(u => u.id === id);
function chatBadge(){
  const b = $('#chatBadge'); if (!b) return;
  const n = S.chat.unread || 0;
  b.textContent = n > 99 ? '99+' : n; b.classList.toggle('hidden', n < 1);
}
function chatSumUnread(){ S.chat.unread = S.chat.users.reduce((a, u) => a + (u.unread || 0), 0); chatBadge(); }

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
  if (u.online) return { cls:'on', txt:'Online' };
  const a = chatAgo(u);
  return { cls:'off', txt: a ? 'Offline · last seen ' + a : 'Offline' };
}
const CH_COL = ['#6366f1','#0ea5e9','#10b981','#f59e0b','#ec4899','#8b5cf6','#14b8a6','#ef4444','#64748b','#84cc16'];
const chColor = id => CH_COL[[...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % CH_COL.length];
const chInit = u => esc((u.name || u.username || '?').trim().charAt(0).toUpperCase());
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
      <div class="ch-top"><h3>💬 Chats</h3><input class="input" id="chSearch" placeholder="Search user…" autocomplete="off" value="${esc(S.chat.q)}"></div>
      <div class="ch-list" id="chList"></div>
    </div>
    <div class="card ch-pane" id="chPane"></div>
  </div>`;
}
function bindChat(){
  document.body.classList.toggle('chat-conv', !!S.chat.with);
  $('#chSearch').oninput = e => { S.chat.q = e.target.value; chatRenderList(); };
  chatRenderList(); chatRenderPane();
  if (!S.chat.loaded) chatLoadUsers();
  if (S.chat.with) chatFetchConv(true);
}
function chatRenderList(){
  const el = $('#chList'); if (!el) return;
  const q = S.chat.q.trim().toLowerCase();
  const list = S.chat.users.filter(u => !q || (u.name + ' ' + u.username).toLowerCase().includes(q))
    .sort((a, b) => (b.lastTime - a.lastTime) || (b.online - a.online) || String(a.name).localeCompare(String(b.name)));
  if (!S.chat.loaded){ el.innerHTML = '<div class="empty-state">Loading users…</div>'; return; }
  if (!list.length){ el.innerHTML = `<div class="empty-state">${S.chat.users.length ? 'No user found' : 'No other users yet'}</div>`; return; }
  el.innerHTML = list.map(u => {
    const st = chatStatus(u);
    const prev = u.lastText ? `<div class="ch-prev">${u.lastMine ? 'You: ' : ''}${esc(u.lastText)}</div>` : '';
    return `<div class="ch-row ${S.chat.with === u.id ? 'sel' : ''}" onclick="chatOpen('${esc(u.id)}')">
      <div class="ch-av" style="background:${chColor(u.id)}">${chInit(u)}<span class="dot ${st.cls}"></span></div>
      <div class="ch-info">
        <div class="ch-name"><span class="nm">${esc(u.name || u.username)}</span><span class="dot ${st.cls}"></span><span class="tm">${esc(chListTime(u.lastTime))}</span></div>
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
    </div>
    <div class="ch-msgs" id="chMsgs"></div>
    <div class="ch-comp"><textarea id="chInput" rows="1" placeholder="Type a message" maxlength="2000"></textarea>
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
    html += `<div class="ch-b ${m.mine ? 'me' : 'them'} ${m.state || ''}" ${m.state === 'failed' ? `onclick="chatRetry('${esc(m.id)}')"` : ''}><div class="tx">${esc(m.text)}</div><div class="mt">${meta}</div></div>`;
  });
  box.innerHTML = html;
  if (toBottom || near) box.scrollTop = box.scrollHeight;
}
function chatMerge(id, list){
  const a = S.chat.msgs[id] || (S.chat.msgs[id] = []); let changed = false;
  list.forEach(m => {
    const i = a.findIndex(x => x.id === m.id);
    if (i >= 0){ if (a[i].state || a[i].t !== m.t || a[i].text !== m.text){ a[i] = m; changed = true; } }
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
    S.chat.users.forEach(u => { if (S.view === 'chat' && S.chat.with === u.id) u.unread = 0; });   // the open chat is being read
    S.chat.loaded = true; chatSumUnread();
    if (incoming) toast('💬 New message');
    if (S.view === 'chat'){ chatRenderList(); chatHeader(); }
  }catch(e){ chatErr(e); }
  finally{ S.chat.loadingUsers = false; }
}
async function chatPingNow(){
  try{
    const r = await chatApi('chatPing');
    if (r.unread > S.chat.unread && S.view !== 'chat') toast('💬 New message');
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
    if (u && r.presence){ u.online = r.presence.online; u.ago = r.presence.ago; u.at = Date.now(); }
    if (u && r.messages.some(m => !m.mine)){
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

boot();
