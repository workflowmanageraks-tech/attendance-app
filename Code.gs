/**
 * ATTENDANCE & EXPENSE TRACKER — Backend (Google Apps Script)  —  MULTI-USER version
 * ------------------------------------------------------------
 * Paste this whole file into: Google Sheet > Extensions > Apps Script > Code.gs
 * Then: Deploy > Manage deployments > (pencil) > Version: New version > Deploy
 *       Execute as: Me   |   Who has access: Anyone
 *
 * Sheets used (matched by name, created automatically if missing):
 *   Settings            -> profile, salary, username, hashed password, status codes
 *   Attendance Register -> Month rows x day columns (P / A / W)
 *   Expenses            -> Date | Category | Amount | Note | ID
 *   Categories          -> Category Name | Type (Expense / Income)
 *   Work                -> Date | Name | Product Name | Product Number | Sticker | Description | ID
 *   Password Manager    -> Website URL | User ID | Password | ID | Owner   (each user sees only their own rows)
 *   Employees           -> ID | Name | Designation | Monthly Salary | Salary Basis | Attendance Sheet
 *   Att-xxxx            -> one attendance register per extra employee (same layout as Attendance Register)
 *   Users               -> ID | Username | Password | Role | Name | E-mail | Active | Permissions | Location required | Created | Last login
 *   Login Log           -> every login attempt: time, user, result, latitude / longitude, device, browser, OS, IP
 *   Groups              -> ID | Group name | Member user IDs (comma separated) | Created   (members of one group share ONE set of data)
 *   Chat                -> ID | Time (ms) | From (user ID) | To (user ID) | Message | Sent at   (one-to-one messages between users)
 *   Timetable           -> Type (Category / Day) | Key | Value | Owner   (the dropdown categories + the half-hour time-table of each date)
 *
 * LOGINS: the Username / Password in the Settings sheet is the MAIN ADMIN (id ADMIN). Extra users are added from the website:
 *   Settings > Users & access. Expenses / Work / Categories / Employees / Attendance each carry an Owner column, so every user sees only their own data.
 *
 * PASSWORD RESET BY E-MAIL OTP needs mail permission: in the Apps Script editor choose the function
 * 'authorizeMail' > Run > Allow. Then Deploy > Manage deployments > New version > Deploy.
 */

// ---------- CONFIG ----------
// Optional: if you set a value here, the very first "Create login" screen will ask for it.
// This stops a stranger from creating the login before you do. Leave '' to skip.
const SETUP_CODE = '';

const SHEET_KEYS = {
  ATT: ['attendance register', 'register'],
  SET: ['settings'],
  EXP: ['expenses', 'expense', 'transactions'],
  CAT: ['categories', 'category'],
  WORK: ['work'],
  EMP: ['employees'],
  USERS: ['users'],
  LOG: ['login log'],
  PW: ['password manager'],
  LINK: ['links', 'link manager'],
  GROUPS: ['groups'],
  TT: ['timetable', 'time table'],
  CHAT: ['chat'],
  ACT: ['activity log', 'activity']
};
const SHEET_NAMES = { ATT: 'Attendance Register', SET: 'Settings', EXP: 'Expenses', CAT: 'Categories', WORK: 'Work', EMP: 'Employees', USERS: 'Users', LOG: 'Login Log', PW: 'Password Manager', LINK: 'Links', GROUPS: 'Groups', TT: 'Timetable', CHAT: 'Chat', ACT: 'Activity Log' };
const DEFAULT_CATS = [['Food & Dining', 'Expense'], ['Transport', 'Expense'], ['Bills & Utilities', 'Expense'], ['Shopping', 'Expense'], ['Health', 'Expense'], ['Other', 'Expense'], ['Salary', 'Income']];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const TOKEN_TTL = 6 * 60 * 60;   // 6 hours (max allowed by CacheService)
const MAX_FAILS = 5;             // wrong logins before temporary lock
const LOCK_SECS = 300;           // lock duration (5 minutes)
const OTP_TTL = 600;             // password-reset OTP valid for 10 minutes
const OTP_MAX_TRIES = 5;         // wrong OTP guesses allowed
const OTP_COOLDOWN = 60;         // seconds between OTP e-mails

const SETTING_FIELDS = [
  { key: 'name',        label: 'Employee Name',                              re: /^employee name/i },
  { key: 'designation', label: 'Designation',                                re: /^designation/i },
  { key: 'salary',      label: 'Monthly Salary',                             re: /^monthly salary/i },
  { key: 'year',        label: 'Year',                                       re: /^year$/i },
  { key: 'currency',    label: 'Currency Symbol',                            re: /^currency/i },
  { key: 'basis',       label: 'Salary Days Basis (0 = actual days in month)', re: /^salary days basis/i },
  { key: 'appName',     label: 'App Name',                                   re: /^app name/i },
  { key: 'email',       label: 'Recovery Email',                             re: /^(recovery )?e-?mail/i },
  { key: 'username',    label: 'Username',                                   re: /^username/i },
  { key: 'password',    label: 'Password',            re: /^password/i }
];
const DEFAULT_STATUSES = [
  { code: 'P', label: 'Present',       factor: 1, color: '#c6efce' },
  { code: 'A', label: 'Absent',        factor: 0, color: '#ffc7ce' },
  { code: 'W', label: 'Week Off (Paid)', factor: 1, color: '#ffeb9c' }
];

// ---------- SHEET MENU ----------
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Attendance App')
    .addItem('Check / create sheets', 'setupSheets')
    .addItem('Reset login (forgot password)', 'resetLogin')
    .addItem('Authorize e-mail (run once)', 'authorizeMail')
    .addToUi();
}
function setupSheets() {
  ['SET', 'ATT', 'EMP', 'EXP', 'CAT', 'WORK', 'PW', 'LINK', 'USERS', 'GROUPS', 'TT', 'CHAT', 'LOG', 'ACT'].forEach(function (k) { getSheet_(k); });
  SpreadsheetApp.getUi().alert('All sheets are ready.');
}
// Run this ONCE from the editor so Google asks permission to send the OTP e-mails.
function authorizeMail() {
  var q = MailApp.getRemainingDailyQuota();
  try { SpreadsheetApp.getUi().alert('E-mail is authorized. Remaining mails today: ' + q); } catch (e) {}
}
function resetLogin() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.alert('Reset login?', 'This clears the MAIN ADMIN username and password. The website will ask you to create a new login.', ui.ButtonSet.YES_NO);
  if (r !== ui.Button.YES) return;
  writeSetting_('username', '');
  writeSetting_('password', '');
  bumpVersion_('ADMIN');
  ui.alert('Done. Open the website to create a new login.');
}

// ---------- HTTP ENTRY POINTS ----------
// Opening the web-app link shows the website (the HTML file named "Index").
// Add ?api=1 to the link to get the plain API status instead.
function doGet(e) {
  if (e && e.parameter && e.parameter.api) {
    return json_({ ok: true, app: 'Attendance & Expense Tracker API', time: new Date().toISOString() });
  }
  return HtmlService.createHtmlOutputFromFile('index.html')
    .setTitle('Attendance & Expense Tracker')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Called by the website through google.script.run (no CORS problems).
function apiCall(jsonStr) {
  var res;
  try {
    res = route_(JSON.parse(jsonStr));
  } catch (err) {
    res = { ok: false, error: err.message || String(err), code: err.code || 'ERR' };
  }
  return JSON.stringify(res);
}

function doPost(e) {
  var res;
  try {
    var req = JSON.parse(e.postData.contents);
    res = route_(req);
  } catch (err) {
    res = { ok: false, error: err.message || String(err), code: err.code || 'ERR' };
  }
  return json_(res);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function fail_(msg, code) {
  var e = new Error(msg);
  e.code = code || 'ERR';
  throw e;
}

var WRITE_ACTIONS = {
  setup: 1, setAttendance: 1, saveSettings: 1, saveStatuses: 1, changeCredentials: 1,
  addExpense: 1, updateExpense: 1, deleteExpense: 1,
  addCategory: 1, updateCategory: 1, deleteCategory: 1,
  addWork: 1, updateWork: 1, deleteWork: 1,
  addPw: 1, updatePw: 1, deletePw: 1,
  addLink: 1, updateLink: 1, deleteLink: 1,
  addEmployee: 1, updateEmployee: 1, deleteEmployee: 1, addStatus: 1, deleteStatus: 1,
  saveUser: 1, deleteUser: 1, kickUser: 1, setAvatar: 1, saveGroup: 1, deleteGroup: 1,
  setTimetable: 1, addTtCat: 1, updateTtCat: 1, deleteTtCat: 1, chatSend: 1, calDisconnect: 1
};

// What each action needs. 'att' / 'exp' / 'work' need EDIT access to that section; 'emp' / 'creds' need that right.
var NEED = {
  setAttendance: 'att',
  addExpense: 'exp', updateExpense: 'exp', deleteExpense: 'exp', addCategory: 'exp', updateCategory: 'exp', deleteCategory: 'exp',
  addWork: 'work', updateWork: 'work', deleteWork: 'work',
  addPw: 'pw', updatePw: 'pw', deletePw: 'pw',
  addLink: 'link', updateLink: 'link', deleteLink: 'link',
  addEmployee: 'emp', updateEmployee: 'emp', deleteEmployee: 'emp',
  changeCredentials: 'creds',
  setTimetable: 'tt', addTtCat: 'tt', updateTtCat: 'tt', deleteTtCat: 'tt'
};
// Only admins may do these
var ADMIN_ONLY = { saveSettings: 1, saveStatuses: 1, addStatus: 1, deleteStatus: 1, listUsers: 1, saveUser: 1, deleteUser: 1, kickUser: 1, setAvatar: 1, loginLog: 1, listGroups: 1, saveGroup: 1, deleteGroup: 1, ttCalStatus: 1 };

// Who is making the current request (filled by buildCtx_ on every call; Apps Script runs each call fresh)
//   uid   = the logged-in account         owner = whose DATA is being read / written
//   (owner differs from uid only when an admin uses "View as user")
var CTX = { uid: 'ADMIN', owner: 'ADMIN', role: 'admin', primary: true, perms: null, name: '', username: '', viewing: false, viewName: '', payDue: '', group: null };

function fullPerms_() { return { att: 'edit', exp: 'edit', work: 'edit', pw: 'edit', link: 'edit', tt: 'edit', emp: true, creds: true }; }
function normPerms_(p, role) {
  if (role === 'admin') return fullPerms_();
  p = p || {};
  function lvl(v) { v = String(v || '').toLowerCase(); return (v === 'none' || v === 'view' || v === 'edit') ? v : 'edit'; }
  function bool(v, d) { return (v === undefined || v === null || v === '') ? d : (v === true || v === 'true' || v === 'yes' || v === 1 || v === '1'); }
  return { att: lvl(p.att), exp: lvl(p.exp), work: lvl(p.work), pw: lvl(p.pw), link: lvl(p.link), tt: lvl(p.tt), emp: bool(p.emp, false), creds: bool(p.creds, true) };
}
function need_(sec) {
  var p = CTX.perms || {};
  if (sec === 'emp' || sec === 'creds') { if (!p[sec]) fail_('You do not have permission to do this.', 'PERM'); return; }
  if (p[sec] !== 'edit') fail_('You have view-only access to this section.', 'PERM');
}
function needAdmin_() { if (CTX.role !== 'admin') fail_('Only an admin can do this.', 'PERM'); }
function ownerOf_(v) { var s = String(v === undefined || v === null ? '' : v).trim(); return s || 'ADMIN'; }   // old rows with no owner belong to the main admin

function buildCtx_(uid, asUser) {
  var acc = getAccount_(uid);
  if (!acc || !acc.active) fail_('Session expired. Please log in again.', 'AUTH');
  if (payExpired_(acc.payDue)) fail_('Payment pending. Please pay to continue using this account.', 'PAYDUE');
  // Members of a group all read / write the group's rows (owner = group id), so they always see the same data.
  var g = groupOf_(acc.id);
  CTX = { uid: acc.id, owner: g ? g.id : acc.id, role: acc.role, primary: acc.id === 'ADMIN', perms: acc.perms,
          name: acc.name, username: acc.username, viewing: false, viewName: '', payDue: acc.payDue || '', group: g };
  asUser = String(asUser || '').trim();
  if (asUser && asUser !== acc.id) {
    if (acc.role !== 'admin') fail_('Not allowed.', 'PERM');
    var t = getAccount_(asUser);
    if (!t) fail_('That user was not found.');
    if (acc.id !== 'ADMIN' && t.createdBy !== acc.id) fail_('Not allowed.', 'PERM');      // a sub-admin can only open the users he created
    var tg = groupOf_(t.id);
    CTX.owner = tg ? tg.id : t.id; CTX.group = tg; CTX.perms = fullPerms_(); CTX.viewing = true;
    CTX.viewName = (t.name || t.username || 'User') + (tg ? ' (group “' + tg.name + '”)' : '');
  }
}

function isAdminCtx_() { return CTX.role === 'admin'; }
function route_(req) {
  var a = req.action;

  // ---- public ----
  if (a === 'status') {
    var s = readSettings_().values;
    return { ok: true, needsSetup: !(has_(s.username) && has_(s.password)), needsSetupCode: !!SETUP_CODE };
  }
  if (a === 'login') return login_(req);
  if (a === 'requestReset') return requestReset_(req);
  if (a === 'resetPassword') return resetPassword_(req);

  // ---- everything else needs a valid token (except the very first setup) ----
  if (a !== 'setup') {
    var uid = checkToken_(req.token);
    if (!uid) fail_('Session expired. Please log in again.', 'AUTH');
    buildCtx_(uid, req.asUser);
    touchSeen_(CTX.uid);                       // every request counts as "online" (chat presence)
    if (NEED[a]) need_(NEED[a]);
    if (ADMIN_ONLY[a]) needAdmin_();
  }

  var lock = null;
  if (WRITE_ACTIONS[a]) {
    lock = LockService.getScriptLock();
    lock.waitLock(20000);
  }
  try {
    var out;
    switch (a) {
      case 'setup':             return setup_(req);
      case 'logout':            CacheService.getScriptCache().remove('tok_' + req.token); markOffline_(CTX.uid); return { ok: true };
      case 'getAll':            return { ok: true, data: getAll_() };
      case 'setAttendance':     out = setAttendance_(req); break;
      case 'saveSettings':      out = saveSettings_(req); break;
      case 'saveStatuses':      out = saveStatuses_(req); break;
      case 'addStatus':         out = addStatus_(req); break;
      case 'deleteStatus':      out = deleteStatus_(req); break;
      case 'addEmployee':       out = addEmployee_(req); break;
      case 'updateEmployee':    out = updateEmployee_(req); break;
      case 'deleteEmployee':    out = deleteEmployee_(req); break;
      case 'changeCredentials': out = changeCredentials_(req); break;
      case 'addExpense':        out = addExpense_(req); break;
      case 'updateExpense':     out = updateExpense_(req); break;
      case 'deleteExpense':     out = deleteExpense_(req); break;
      case 'addCategory':       out = addCategory_(req); break;
      case 'updateCategory':    out = updateCategory_(req); break;
      case 'deleteCategory':    out = deleteCategory_(req); break;
      case 'addWork':           out = addWork_(req); break;
      case 'updateWork':        out = updateWork_(req); break;
      case 'deleteWork':        out = deleteWork_(req); break;
      case 'addPw':             out = addPw_(req); break;
      case 'updatePw':          out = updatePw_(req); break;
      case 'deletePw':          out = deletePw_(req); break;
      case 'addLink':           out = addLink_(req); break;
      case 'updateLink':        out = updateLink_(req); break;
      case 'deleteLink':        out = deleteLink_(req); break;
      case 'setTimetable':      out = setTimetable_(req); break;
      case 'calAuthUrl':        return calAuthUrl_();
      case 'calStatus':         return calStatus_();
      case 'calDisconnect':     out = calDisconnect_(); break;
      case 'calSyncAll':        return calSyncAll_();
      case 'ttCalStatus':       return ttCalStatus_();
      case 'addTtCat':          out = addTtCat_(req); break;
      case 'updateTtCat':       out = updateTtCat_(req); break;
      case 'deleteTtCat':       out = deleteTtCat_(req); break;
      case 'listUsers':         return listUsers_();
      case 'saveUser':          out = saveUser_(req); break;
      case 'setAvatar':         out = setAvatar_(req); break;
      case 'deleteUser':        out = deleteUser_(req); break;
      case 'kickUser':          out = kickUser_(req); break;
      case 'listGroups':        return listGroups_();
      case 'saveGroup':         out = saveGroup_(req); break;
      case 'deleteGroup':       out = deleteGroup_(req); break;
      case 'chatUsers':         return chatUsers_();
      case 'chatPing':          return chatPing_();
      case 'chatFetch':         return chatFetch_(req);
      case 'chatSend':          return chatSend_(req);
      case 'loginLog':          return { ok: true, logs: teamRows_(readLog_(Math.min(Number(req.limit) || 200, 500), String(req.uid || ''))) };
      case 'activityLog':       return { ok: true, logs: teamRows_(readActivity_(Math.min(Number(req.limit) || 200, 500), isAdminCtx_() ? String(req.uid || '') : CTX.uid)) };
      default: fail_('Unknown action: ' + a);
    }
    if (out && out.ok !== false) logActivity_(a, CTX, req);     // only log actions that actually succeeded
    return out;
  } finally {
    if (lock) lock.releaseLock();
  }
}

// ---------- AUTH ----------
function getSalt_() {
  var p = PropertiesService.getScriptProperties();
  var s = p.getProperty('SALT');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); p.setProperty('SALT', s); }
  return s;
}
// Session version is kept PER USER, so changing one person's password / disabling them logs out only that person.
function verKey_(uid) { return (!uid || uid === 'ADMIN') ? 'SESSION_VER' : 'SV_' + uid; }
function getVersion_(uid) { return PropertiesService.getScriptProperties().getProperty(verKey_(uid)) || '1'; }
function bumpVersion_(uid) {
  var v = String(Number(getVersion_(uid)) + 1);
  PropertiesService.getScriptProperties().setProperty(verKey_(uid), v);
  return v;
}
function newToken_(uid) {
  var t = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('tok_' + t, getVersion_(uid) + '|' + uid, TOKEN_TTL);
  return t;
}
// returns the user id the token belongs to, or '' if the token is not valid
function checkToken_(t) {
  if (!t) return '';
  var v = CacheService.getScriptCache().get('tok_' + t);
  if (!v) return '';
  var p = String(v).split('|');
  var uid = p.length > 1 ? p[1] : 'ADMIN';            // tokens from the old single-user version belong to the admin
  return p[0] === getVersion_(uid) ? uid : '';
}

// Passwords are stored as PLAIN TEXT in the sheet (Settings sheet for the main admin, Users sheet for everyone else),
// so you can read / change them straight from the sheet.
function has_(v) { return v !== '' && v !== null && v !== undefined && String(v).trim() !== ''; }
function passMatch_(stored, given) {
  given = String(given === undefined || given === null ? '' : given);
  if (typeof stored === 'number') {
    // Sheet turned the password into a number (e.g. 00000000 -> 0): accept digits that equal that number
    return /^\d+$/.test(given) && Number(given) === stored;
  }
  return String(stored).trim() === given;
}
// "Payment due until" -> milliseconds (script time zone). Accepts what the website writes ("2026-11-17T10:30"),
// what a sheet Date becomes ("2026-11-17 10:30:00") and a typed "17/11/2026 10:30". Returns NaN if unreadable.
function parseDue_(v) {
  var s = String(v === undefined || v === null ? '' : v).trim();
  if (!s) return NaN;
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
  return new Date(s).getTime();
}
function payExpired_(v) {
  var t = parseDue_(v);
  return !isNaN(t) && t < Date.now();
}
function nowStr_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'); }
function tsStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  return String(v === undefined || v === null ? '' : v);
}

// ---------- ACCOUNTS ----------
// Main admin  = the Username / Password in the Settings sheet (id 'ADMIN')  -> your existing login keeps working.
// Everyone else = rows of the Users sheet.
function getAccount_(id, s) {
  if (id === 'ADMIN') {
    var v = s || {};
    return { id: 'ADMIN', username: String(v.username || ''), password: v.password, name: String(v.name || v.username || ''),
             email: String(v.email || ''), role: 'admin', active: true, perms: fullPerms_(), needLoc: false, payDue: '', row: 0, created: '', lastLogin: '', createdBy: '',
             avatar: String(PropertiesService.getScriptProperties().getProperty('AVATAR_ADMIN') || '') };
  }
  return readUsers_().filter(function (x) { return x.id === id; })[0] || null;
}
function readUsers_() {
  var sh = getSheet_('USERS'), last = sh.getLastRow(), out = [];
  if (last < 2) return out;
  if (sh.getMaxColumns() < 14) sh.insertColumnsAfter(sh.getMaxColumns(), 14 - sh.getMaxColumns());
  sh.getRange(2, 1, last - 1, 14).getValues().forEach(function (r, i) {
    var id = String(r[0]).trim(), un = String(r[1]).trim();
    if (!id || !un) return;
    var role = /^admin/i.test(String(r[3])) ? 'admin' : 'user';
    var pj = {};
    try { pj = JSON.parse(String(r[7] || '{}')); } catch (e) {}
    out.push({ id: id, username: un, password: r[2], role: role, name: String(r[4] || ''), email: String(r[5] || '').trim(),
      active: !/^(no|false|0)$/i.test(String(r[6]).trim()), perms: normPerms_(pj, role),
      needLoc: /^(yes|true|1)$/i.test(String(r[8]).trim()), created: tsStr_(r[9]), lastLogin: tsStr_(r[10]),
      payDue: tsStr_(r[11]), avatar: String(r[12] || '').trim(), createdBy: String(r[13] || '').trim(), row: i + 2 });
  });
  return out;
}
// ---------- TEAMS (who created whom) ----------
// Users made by a sub-admin carry that sub-admin's id in "Created By". Users made by the main admin, and every user that
// existed before this feature, have it empty (they keep the old behaviour).
//   * a sub-admin only sees / manages the users HE created
//   * a user made by a sub-admin sees only that sub-admin in Chat / calls / games (nobody else)
function chatSee_(a, b) {
  if (!a || !b || a.id === b.id) return false;
  return a.createdBy === b.id || b.createdBy === a.id || (!a.createdBy && !b.createdBy);
}
function chatCanSee_(aId, bId) {
  var s = readSettings_().values;
  return chatSee_(getAccount_(aId, s), getAccount_(bId, s));
}
function teamMap_() {
  var m = {};
  readUsers_().forEach(function (u) { if (u.createdBy === CTX.uid) m[u.id] = 1; });
  return m;
}
function needTeam_(u) { if (!CTX.primary && (!u || u.createdBy !== CTX.uid)) fail_('You can only manage the users you created.', 'PERM'); }
function teamRows_(rows) {                       // keep only my own rows + my team's (main admin keeps all)
  if (CTX.primary) return rows;
  var m = teamMap_(); m[CTX.uid] = 1;
  return rows.filter(function (r) { return m[r.uid]; });
}
function chatOnlyPerms_() { return { att: 'none', exp: 'none', work: 'none', pw: 'none', link: 'none', tt: 'none', emp: false, creds: true }; }

function findByUsername_(uname, s) {
  uname = String(uname || '').trim().toLowerCase();
  if (!uname) return null;
  if (has_(s.username) && String(s.username).trim().toLowerCase() === uname) return getAccount_('ADMIN', s);
  return readUsers_().filter(function (u) { return u.username.toLowerCase() === uname; })[0] || null;
}
function setPassword_(acc, pw) {
  if (acc.id === 'ADMIN') { writeSetting_('password', pw); return; }
  var c = getSheet_('USERS').getRange(acc.row, 3); c.setNumberFormat('@'); c.setValue(pw);
}
function setUsername_(acc, nu) {
  if (acc.id === 'ADMIN') { writeSetting_('username', nu); return; }
  var c = getSheet_('USERS').getRange(acc.row, 2); c.setNumberFormat('@'); c.setValue(nu);
}
function meOf_(values) {
  var main = CTX.primary;
  return { id: CTX.uid, role: CTX.role, primary: main,
    username: main ? String(values.username || '') : CTX.username,
    name: main ? String(values.name || values.username || '') : (CTX.name || CTX.username),
    perms: CTX.viewing ? fullPerms_() : CTX.perms,
    viewing: CTX.viewing, viewId: CTX.owner, viewName: CTX.viewName, group: CTX.group ? groupInfo_(CTX.group) : null,
    payDueMs: (function () { var t = parseDue_(CTX.payDue); return isNaN(t) ? 0 : t; })(), serverNow: Date.now() };
}

// ---------- LOGIN ----------
function login_(req) {
  var cache = CacheService.getScriptCache();
  var uname = String(req.username || '').trim().toLowerCase();
  var fkey = 'fails_' + Utilities.base64EncodeWebSafe(uname).slice(0, 60);
  var info = cleanInfo_(req.client);
  var s = readSettings_().values;
  if (!has_(s.username) || !has_(s.password)) fail_('No login has been created yet.', 'NOSETUP');
  var fails = Number(cache.get(fkey) || 0);
  if (fails >= MAX_FAILS) {
    logLogin_(null, uname, 'Blocked', 'Too many wrong attempts', info);
    fail_('Too many wrong attempts. Please try again in 5 minutes.', 'LOCKED');
  }
  var acc = findByUsername_(uname, s);
  if (!(acc && passMatch_(acc.password, req.password))) {
    cache.put(fkey, String(fails + 1), LOCK_SECS);
    logLogin_(acc, uname, 'Failed', acc ? 'Wrong password' : 'Unknown username', info);
    Utilities.sleep(700);
    fail_('Incorrect username or password.', 'BADLOGIN');
  }
  if (!acc.active) {
    logLogin_(acc, uname, 'Blocked', 'Account disabled', info);
    fail_('This account is disabled. Please contact the admin.', 'DISABLED');
  }
  if (acc.needLoc && info.lat === '') {
    logLogin_(acc, uname, 'Blocked', 'Location not shared', info);
    fail_('Your admin requires location to sign in. Allow location access for this site and try again.', 'LOCREQ');
  }
  if (payExpired_(acc.payDue)) {
    logLogin_(acc, uname, 'Blocked', 'Payment pending', info);
    fail_('Payment pending. Please pay to continue using this account.', 'PAYDUE');
  }
  cache.remove(fkey);
  if (acc.row) { var c = getSheet_('USERS').getRange(acc.row, 11); c.setNumberFormat('@'); c.setValue(nowStr_()); }
  logLogin_(acc, uname, 'Success', '', info);
  return { ok: true, token: newToken_(acc.id) };
}

// Client details are only trusted as information to display; they never grant anything.
function cleanInfo_(c) {
  c = c || {};
  function str(v, n) { return String(v === undefined || v === null ? '' : v).replace(/[\r\n\t]+/g, ' ').slice(0, n); }
  function num(v, lo, hi, dp) {
    if (v === '' || v === null || v === undefined) return '';
    var n = Number(v);
    if (isNaN(n) || n < lo || n > hi) return '';
    var m = Math.pow(10, dp); return Math.round(n * m) / m;
  }
  return { lat: num(c.lat, -90, 90, 6), lng: num(c.lng, -180, 180, 6), acc: num(c.acc, 0, 10000000, 0), src: str(c.src, 24),
    device: str(c.device, 90), browser: str(c.browser, 60), os: str(c.os, 60), screen: str(c.screen, 30), tz: str(c.tz, 50),
    ip: str(c.ip, 45), city: str(c.city, 90), deviceId: str(c.deviceId, 40) };
}
function logLogin_(acc, uname, result, reason, i) {
  try {
    var sh = getSheet_('LOG');
    var link = (i.lat !== '' && i.lng !== '') ? 'https://www.google.com/maps?q=' + i.lat + ',' + i.lng : '';
    sh.appendRow([nowStr_(), acc ? acc.id : '', acc ? acc.username : uname, acc ? acc.name : '', result, reason,
      i.lat, i.lng, i.acc, i.src, link, i.device, i.browser, i.os, i.screen, i.tz, i.ip, i.city, i.deviceId]);
    if (sh.getLastRow() > 5000) sh.deleteRows(2, 1000);       // keep the log from growing forever
  } catch (e) {}
}
function readLog_(limit, uid) {
  var sh = getSheet_('LOG'), last = sh.getLastRow(), out = [];
  if (last < 2) return out;
  var n = Math.min(last - 1, 1500);
  var vals = sh.getRange(last - n + 1, 1, n, 19).getValues();
  function nn(v) { return (v === '' || v === null) ? null : Number(v); }
  for (var i = vals.length - 1; i >= 0 && out.length < limit; i--) {
    var r = vals[i];
    if (uid && String(r[1]) !== uid) continue;
    out.push({ time: tsStr_(r[0]), uid: String(r[1]), username: String(r[2]), name: String(r[3]), result: String(r[4]), reason: String(r[5]),
      lat: nn(r[6]), lng: nn(r[7]), acc: nn(r[8]), src: String(r[9]), device: String(r[11]), browser: String(r[12]), os: String(r[13]),
      screen: String(r[14]), tz: String(r[15]), ip: String(r[16]), city: String(r[17]), deviceId: String(r[18]) });
  }
  return out;
}

// ---------- ACTIVITY LOG (what each user did: every save / add / delete, not just sign-ins) ----------
// Human-readable label + a short detail builder for each action the app can log.
var ACTIVITY_LABEL_ = {
  setAttendance: 'Updated attendance', saveSettings: 'Changed settings', saveStatuses: 'Changed status codes',
  addStatus: 'Added a status code', deleteStatus: 'Deleted a status code',
  addEmployee: 'Added an employee', updateEmployee: 'Updated an employee', deleteEmployee: 'Deleted an employee',
  changeCredentials: 'Changed login password', addExpense: 'Added an expense', updateExpense: 'Updated an expense', deleteExpense: 'Deleted an expense',
  addCategory: 'Added a category', updateCategory: 'Updated a category', deleteCategory: 'Deleted a category',
  addWork: 'Added a work entry', updateWork: 'Updated a work entry', deleteWork: 'Deleted a work entry',
  addPw: 'Added a saved password', updatePw: 'Updated a saved password', deletePw: 'Deleted a saved password',
  addLink: 'Added a link', updateLink: 'Updated a link', deleteLink: 'Deleted a link',
  setTimetable: 'Edited Time Table', addTtCat: 'Added a Time Table category', updateTtCat: 'Renamed a Time Table category', deleteTtCat: 'Deleted a Time Table category',
  saveUser: 'Added/edited a user', deleteUser: 'Deleted a user', kickUser: 'Signed a user out everywhere',
  saveGroup: 'Added/edited a group', deleteGroup: 'Deleted a group',
  calConnect: 'Connected Google Calendar', calDisconnect: 'Disconnected Google Calendar'
};
function activityDetail_(a, req) {
  try {
    if (a === 'setAttendance') return (req.entries || []).length + ' day(s)';
    if (a === 'setTimetable') return req.date ? req.date : '';
    if (a === 'addExpense' || a === 'updateExpense') return [req.category, req.amount].filter(has_).join(' · ');
    if (a === 'addWork' || a === 'updateWork') return req.productName || req.product || '';
    if (a === 'addEmployee' || a === 'updateEmployee') return req.name || '';
    if (a === 'saveUser') return req.username || req.name || '';
    if (a === 'deleteUser' || a === 'deleteEmployee' || a === 'kickUser') return String(req.id || req.uid || '');
    if (a === 'addPw' || a === 'updatePw') return req.site || req.url || '';
    if (a === 'addLink' || a === 'updateLink') return req.name || '';
    if (a === 'saveGroup') return req.name || '';
  } catch (e) {}
  return '';
}
// Call this AFTER a write action succeeds. ctx is the CTX object (who's doing it); req is the raw request.
function logActivity_(a, ctx, req) {
  try {
    var label = ACTIVITY_LABEL_[a]; if (!label) return;        // only actions we recognise get logged
    var sh = getSheet_('ACT');
    sh.appendRow([nowStr_(), ctx.uid, ctx.username || '', ctx.name || '', label, activityDetail_(a, req || {})]);
    if (sh.getLastRow() > 8000) sh.deleteRows(2, 2000);          // keep the log from growing forever
  } catch (e) {}
}
function readActivity_(limit, uid) {
  var sh = getSheet_('ACT'), last = sh.getLastRow(), out = [];
  if (last < 2) return out;
  var n = Math.min(last - 1, 3000);
  var vals = sh.getRange(last - n + 1, 1, n, 6).getValues();
  for (var i = vals.length - 1; i >= 0 && out.length < limit; i--) {
    var r = vals[i];
    if (uid && String(r[1]) !== uid) continue;
    out.push({ time: tsStr_(r[0]), uid: String(r[1]), username: String(r[2]), name: String(r[3]), action: String(r[4]), detail: String(r[5]) });
  }
  return out;
}

// ---------- PASSWORD RESET (OTP sent to e-mail) ----------
function recoveryEmail_() {
  var e = String(readSettings_().values.email || '').trim();
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return e;
  try { return Session.getEffectiveUser().getEmail() || ''; } catch (x) { return ''; }   // falls back to the sheet owner's mail
}
function maskEmail_(e) {
  var p = String(e).split('@'), n = p[0];
  return (n.length <= 2 ? n.charAt(0) + '*' : n.charAt(0) + new Array(Math.min(n.length - 2, 6) + 1).join('*') + n.charAt(n.length - 1)) + '@' + p[1];
}
function hashOtp_(otp) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, getSalt_() + ':otp:' + otp, Utilities.Charset.UTF_8));
}
// username is optional: empty = the main admin (same as before)
function resetTarget_(req, s) {
  var uname = String(req.username || '').trim();
  var acc = uname ? findByUsername_(uname, s) : getAccount_('ADMIN', s);
  if (!acc) fail_('User not found.');
  if (!acc.active) fail_('This account is disabled. Please contact the admin.');
  return acc;
}
function requestReset_(req) {
  var s = readSettings_().values;
  if (!has_(s.username) || !has_(s.password)) fail_('No login has been created yet.', 'NOSETUP');
  var acc = resetTarget_(req, s), k = acc.id;
  var cache = CacheService.getScriptCache();
  if (cache.get('otp_cd_' + k)) fail_('OTP was just sent. Please wait a minute before asking again.', 'COOLDOWN');
  var to = acc.id === 'ADMIN' ? recoveryEmail_() : (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(acc.email) ? acc.email : '');
  if (!to) fail_(acc.id === 'ADMIN' ? 'No recovery e-mail found. Type your e-mail in Settings sheet, row "Recovery Email".'
                                    : 'No e-mail is saved for this user. Please ask the admin to reset your password.');
  var d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + ':' + Date.now(), Utilities.Charset.UTF_8);
  var otp = String(((d[0] & 255) * 65536 + (d[1] & 255) * 256 + (d[2] & 255)) % 900000 + 100000);
  try {
    MailApp.sendEmail({
      to: to,
      subject: 'Your password reset OTP: ' + otp,
      name: String(s.appName || 'Attendance App'),
      body: 'Your one-time password (OTP) to reset your login is:\n\n    ' + otp + '\n\nIt is valid for 10 minutes. If you did not ask for this, ignore this e-mail.'
    });
  } catch (err) {
    fail_('Could not send the e-mail. Open Apps Script, run "authorizeMail" once, then redeploy. (' + (err.message || err) + ')');
  }
  cache.put('otp_' + k, hashOtp_(otp), OTP_TTL);
  cache.remove('otp_tries_' + k);
  cache.put('otp_cd_' + k, '1', OTP_COOLDOWN);
  return { ok: true, sentTo: maskEmail_(to) };
}
function resetPassword_(req) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var s = readSettings_().values;
    var acc = resetTarget_(req, s), k = acc.id;
    var cache = CacheService.getScriptCache();
    var np = String(req.newPassword || '');
    if (np.length < 6) fail_('Password must be at least 6 characters.');
    var stored = cache.get('otp_' + k);
    if (!stored) fail_('OTP expired or not requested. Please request a new OTP.', 'OTPEXP');
    var tries = Number(cache.get('otp_tries_' + k) || 0);
    if (tries >= OTP_MAX_TRIES) { cache.remove('otp_' + k); fail_('Too many wrong OTP attempts. Request a new OTP.', 'OTPEXP'); }
    if (hashOtp_(String(req.otp || '').trim()) !== stored) {
      cache.put('otp_tries_' + k, String(tries + 1), OTP_TTL);
      Utilities.sleep(500);
      fail_('Incorrect OTP.', 'BADOTP');
    }
    setPassword_(acc, np);
    cache.remove('otp_' + k); cache.remove('otp_tries_' + k);
    cache.remove('fails_' + Utilities.base64EncodeWebSafe(String(acc.username).toLowerCase()).slice(0, 60));
    bumpVersion_(k);                 // logs this user out of every other device
    logLogin_(acc, acc.username, 'Success', 'Password reset by OTP', cleanInfo_(req.client));
    return { ok: true, token: newToken_(k) };
  } finally { lock.releaseLock(); }
}

function setup_(req) {
  var s = readSettings_().values;
  if (has_(s.username) && has_(s.password)) fail_('Login already exists.');
  if (SETUP_CODE && String(req.setupCode || '') !== SETUP_CODE) fail_('Wrong setup code.');
  var u = String(req.username || '').trim();
  var p = String(req.password || '');
  if (u.length < 3) fail_('Username must be at least 3 characters.');
  if (p.length < 6) fail_('Password must be at least 6 characters.');
  writeSetting_('username', u);
  writeSetting_('password', p);
  logLogin_({ id: 'ADMIN', username: u, name: u }, u, 'Success', 'First-time setup', cleanInfo_(req.client));
  return { ok: true, token: newToken_('ADMIN') };
}

// Changes the login of the person who is signed in (never of the user an admin is "viewing")
function changeCredentials_(req) {
  var s = readSettings_().values;
  var acc = getAccount_(CTX.uid, s);
  if (!acc) fail_('Account not found.');
  if (!passMatch_(acc.password, req.currentPassword)) fail_('Current password is incorrect.');
  var out = { ok: true };
  var nu = String(req.newUsername || '').trim();
  var np = String(req.newPassword || '');
  if (nu) {
    if (!/^\S{3,40}$/.test(nu)) fail_('Username must be 3 to 40 characters, without spaces.');
    var clash = findByUsername_(nu, s);
    if (clash && clash.id !== acc.id) fail_('That username is already taken.');
    setUsername_(acc, nu);
  }
  if (np) {
    if (np.length < 6) fail_('Password must be at least 6 characters.');
    setPassword_(acc, np);
    bumpVersion_(acc.id);            // logs out every other device of this user
    out.token = newToken_(acc.id);
  }
  out.username = nu || acc.username;
  return out;
}

// ---------- USER MANAGEMENT (admins) ----------
function pubUser_(u, last) {
  return { id: u.id, username: u.username, name: u.name, email: u.email, role: u.role, active: u.active, perms: u.perms,
    needLoc: u.needLoc, primary: u.id === 'ADMIN', created: u.created || '', lastLogin: last[u.id] || u.lastLogin || '', payDue: u.payDue || '', avatar: u.avatar || '' };
}
function listUsers_() {
  var s = readSettings_().values, last = {};
  readLog_(1500, '').forEach(function (l) { if (l.result === 'Success' && !last[l.uid]) last[l.uid] = l.time; });   // newest first
  var list;
  if (CTX.primary) list = [pubUser_(getAccount_('ADMIN', s), last)].concat(readUsers_().map(function (u) { return pubUser_(u, last); }));
  else list = readUsers_().filter(function (u) { return u.createdBy === CTX.uid; }).map(function (u) { return pubUser_(u, last); });
  return { ok: true, users: list };
}
function saveUser_(req) {
  var s = readSettings_().values;
  var users = readUsers_();
  var id = String(req.id || '').trim(), cur = null;
  if (id) {
    if (id === 'ADMIN') fail_('The main admin is managed from "Login & security".');
    cur = users.filter(function (u) { return u.id === id; })[0];
    if (!cur) fail_('User not found. Please refresh.');
    if (cur.role === 'admin' && !CTX.primary) fail_('Only the main admin can change another admin.', 'PERM');
    needTeam_(cur);
  }
  var username = String(req.username || '').trim();
  if (!/^\S{3,40}$/.test(username)) fail_('Username must be 3 to 40 characters, without spaces.');
  var clash = findByUsername_(username, s);
  if (clash && (!cur || clash.id !== cur.id)) fail_('That username is already taken.');
  var role = String(req.role || (cur ? cur.role : 'user')).toLowerCase() === 'admin' ? 'admin' : 'user';
  if (role === 'admin' && !CTX.primary) fail_('Only the main admin can make someone an admin.', 'PERM');
  var pw = String(req.password || '');
  if (!cur && pw.length < 6) fail_('Set a password of at least 6 characters.');
  if (pw && pw.length < 6) fail_('Password must be at least 6 characters.');
  var name = String(req.name || '').trim().slice(0, 60) || username;
  var email = String(req.email || '').trim();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail_('Enter a valid e-mail address (or leave it empty).');
  var active = !(req.active === false || req.active === 'false');
  var needLoc = req.needLoc === true || req.needLoc === 'true';
  var payDue = String(req.payDue || '').trim();   // e.g. "2026-11-17T10:30" from a datetime-local input, or '' to clear
  var permStr = JSON.stringify(normPerms_(!cur && !req.perms ? chatOnlyPerms_() : req.perms, role));   // new user = Chat only unless you tick more
  var avatar = String(req.avatar === undefined || req.avatar === null ? (cur ? cur.avatar : '') : req.avatar).trim();
  if (avatar && !/^[a-z]{2,12}$/.test(avatar)) avatar = '';
  var sh = getSheet_('USERS');
  ensureAvatarCol_(sh);
  if (cur) {
    // columns 2..9 = Username .. Location required.  (Created = col 10 and Last Login = col 11 are left untouched)
    var rng = sh.getRange(cur.row, 2, 1, 8);
    rng.setNumberFormat('@');
    rng.setValues([[username, pw || cur.password, role, name, email, active ? 'Yes' : 'No', permStr, needLoc ? 'Yes' : 'No']]);
    // "Payment due until" lives in column 12 (L)
    var pc = sh.getRange(cur.row, 12);
    pc.setNumberFormat('@');
    pc.setValue(payDue);
    var ac = sh.getRange(cur.row, 13); ac.setNumberFormat('@'); ac.setValue(avatar);
    if (pw || !active) bumpVersion_(cur.id);          // new password / disabled -> signs that user out everywhere
  } else {
    if (users.length >= 100) fail_('User limit (100) reached.');
    var nid = 'U' + Utilities.getUuid().replace(/-/g, '').slice(0, 6);
    var r2 = sh.getRange(sh.getLastRow() + 1, 1, 1, 14);
    r2.setNumberFormat('@');
    r2.setValues([[nid, username, pw, role, name, email, active ? 'Yes' : 'No', permStr, needLoc ? 'Yes' : 'No', nowStr_(), '', payDue, avatar, CTX.primary ? '' : CTX.uid]]);
  }
  return listUsers_();
}
// Column 13 (M) of the Users sheet holds each user's dashboard icon (a short key such as "boy" or "girl").
function ensureAvatarCol_(sh) {
  if (sh.getMaxColumns() < 14) sh.insertColumnsAfter(sh.getMaxColumns(), 14 - sh.getMaxColumns());
  if (!String(sh.getRange(1, 13).getValue() || '').trim()) sh.getRange(1, 13).setValue('Avatar (icon)');
  if (!String(sh.getRange(1, 14).getValue() || '').trim()) sh.getRange(1, 14).setValue('Created By (user ID)');
}
function setAvatar_(req) {
  var id = String(req.id || '').trim(), av = String(req.avatar || '').trim();
  if (av && !/^[a-z]{2,12}$/.test(av)) fail_('Invalid icon.');
  if (id === 'ADMIN') {
    if (!CTX.primary) fail_('Only the main admin can change the main admin\'s icon.', 'PERM');
    PropertiesService.getScriptProperties().setProperty('AVATAR_ADMIN', av);
    return listUsers_();
  }
  var u = readUsers_().filter(function (x) { return x.id === id; })[0];
  if (!u) fail_('User not found. Please refresh.');
  if (u.role === 'admin' && !CTX.primary && u.id !== CTX.uid) fail_('Only the main admin can change another admin.', 'PERM');
  if (u.id !== CTX.uid) needTeam_(u);
  var sh = getSheet_('USERS');
  ensureAvatarCol_(sh);
  var c = sh.getRange(u.row, 13); c.setNumberFormat('@'); c.setValue(av);
  return listUsers_();
}
function deleteUser_(req) {
  var id = String(req.id || '').trim();
  if (id === 'ADMIN') fail_('The main admin cannot be deleted.');
  if (id === CTX.uid) fail_('You cannot delete your own account.');
  var u = readUsers_().filter(function (x) { return x.id === id; })[0];
  if (!u) fail_('User not found. Please refresh.');
  if (u.role === 'admin' && !CTX.primary) fail_('Only the main admin can delete another admin.', 'PERM');
  needTeam_(u);
  getSheet_('USERS').deleteRow(u.row);          // their data rows stay in the sheets (tagged with the old id)
  readGroups_().forEach(function (g) {          // take the deleted user out of any group
    if (g.members.indexOf(id) >= 0) getSheet_('GROUPS').getRange(g.row, 3).setValue(g.members.filter(function (m) { return m !== id; }).join(','));
  });
  return listUsers_();
}
function kickUser_(req) {
  var id = String(req.id || '').trim();
  if (id === 'ADMIN') fail_('Use "Update login" to sign out the main admin everywhere.');
  var u = readUsers_().filter(function (x) { return x.id === id; })[0];
  if (!u) fail_('User not found. Please refresh.');
  if (u.role === 'admin' && !CTX.primary) fail_('Only the main admin can sign out another admin.', 'PERM');
  needTeam_(u);
  bumpVersion_(id);
  return { ok: true };
}

// ---------- GROUPS (admins) ----------
// A group = 2 or more users who share ONE set of data (attendance, expenses, work, passwords, links, categories, employees).
// Their rows are tagged with the GROUP id instead of the user id, so whatever one member changes the others see too.
function readGroups_() {
  var sh = getSheet_('GROUPS'), last = sh.getLastRow(), out = [];
  if (last < 2) return out;
  sh.getRange(2, 1, last - 1, 4).getValues().forEach(function (r, i) {
    var id = String(r[0]).trim();
    if (!id) return;
    out.push({ id: id, name: String(r[1] || ''), created: tsStr_(r[3]), row: i + 2,
      members: String(r[2] || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean) });
  });
  return out;
}
function groupOf_(uid) {
  if (!uid || uid === 'ADMIN') return null;
  return readGroups_().filter(function (g) { return g.members.indexOf(uid) >= 0; })[0] || null;
}
function memberNames_(g, users) {
  return g.members.map(function (id) {
    var u = users.filter(function (x) { return x.id === id; })[0];
    return u ? (u.name || u.username) : '';
  }).filter(Boolean);
}
function groupInfo_(g) { return { id: g.id, name: g.name, members: memberNames_(g, readUsers_()) }; }
function groupInTeam_(g) {
  if (CTX.primary) return true;
  var m = teamMap_(); return g.members.every(function (x) { return m[x]; });
}
function listGroups_() {
  var users = readUsers_();
  return { ok: true, groups: readGroups_().filter(groupInTeam_).map(function (g) {
    return { id: g.id, name: g.name, members: g.members, memberNames: memberNames_(g, users), created: g.created };
  }) };
}
// moves every row owned by `fromId` to the group, so the group starts with that person's existing data
function adoptData_(fromId, toOwner) {
  [['EMP', 7], ['EXP', 6], ['WORK', 8], ['PW', 5], ['LINK', 5], ['CAT', 3], ['TT', 4]].forEach(function (p) {
    var sh = ownedSheet_(p[0], p[1]), last = sh.getLastRow();
    if (last < 2) return;
    var rng = sh.getRange(2, p[1], last - 1, 1), changed = false;
    var vals = rng.getValues().map(function (r) {
      if (String(r[0]).trim() === fromId) { changed = true; return [toOwner]; }
      return r;
    });
    if (changed) rng.setValues(vals);
  });
}
function saveGroup_(req) {
  var groups = readGroups_(), users = readUsers_();
  var id = String(req.id || '').trim(), cur = null;
  if (id) {
    cur = groups.filter(function (g) { return g.id === id; })[0];
    if (!cur) fail_('Group not found. Please refresh.');
    if (!groupInTeam_(cur)) fail_('You can only manage groups of the users you created.', 'PERM');
  }
  var name = String(req.name || '').trim().slice(0, 40);
  if (!name) fail_('Group name is required.');
  if (groups.some(function (g) { return (!cur || g.id !== cur.id) && g.name.toLowerCase() === name.toLowerCase(); })) fail_('A group with that name already exists.');
  var ids = [];
  (Array.isArray(req.members) ? req.members : []).forEach(function (m) { m = String(m).trim(); if (m && ids.indexOf(m) < 0) ids.push(m); });
  if (ids.length < 2) fail_('Select at least 2 users for a group.');
  if (!CTX.primary) { var tm = teamMap_(); ids.forEach(function (m) { if (!tm[m]) fail_('You can only group the users you created.', 'PERM'); }); }
  ids.forEach(function (m) {
    var u = users.filter(function (x) { return x.id === m; })[0];
    if (!u) fail_('One of the selected users was not found. Please refresh.');
    groups.forEach(function (g) {
      if ((!cur || g.id !== cur.id) && g.members.indexOf(m) >= 0) fail_((u.name || u.username) + ' is already in the group “' + g.name + '”.');
    });
  });
  var sh = getSheet_('GROUPS');
  if (cur) {
    var rng = sh.getRange(cur.row, 2, 1, 2);
    rng.setNumberFormat('@');
    rng.setValues([[name, ids.join(',')]]);
  } else {
    var adopt = String(req.adoptFrom || '').trim();
    if (adopt && ids.indexOf(adopt) < 0) fail_('Choose the data owner from the selected members.');
    var gid = 'GR' + Utilities.getUuid().replace(/-/g, '').slice(0, 6);
    var r2 = sh.getRange(sh.getLastRow() + 1, 1, 1, 4);
    r2.setNumberFormat('@');
    r2.setValues([[gid, name, ids.join(','), nowStr_()]]);
    if (adopt) adoptData_(adopt, gid);
  }
  return listGroups_();
}
function deleteGroup_(req) {
  var id = String(req.id || '').trim();
  var g = readGroups_().filter(function (x) { return x.id === id; })[0];
  if (!g) fail_('Group not found. Please refresh.');
  if (!groupInTeam_(g)) fail_('You can only manage groups of the users you created.', 'PERM');
  getSheet_('GROUPS').deleteRow(g.row);          // the group's data rows stay in the sheets (tagged with the group id)
  return listGroups_();
}

// ---------- SHEETS ----------
function getSheet_(k) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  var keys = SHEET_KEYS[k];
  for (var i = 0; i < keys.length; i++) {
    for (var j = 0; j < sheets.length; j++) {
      if (sheets[j].getName().toLowerCase().indexOf(keys[i]) !== -1) return sheets[j];
    }
  }
  return createSheet_(k);
}

// Makes sure the sheet has its "Owner" column (older sheets get it added automatically)
function ownedSheet_(k, col) {
  var sh = getSheet_(k);
  if (sh.getMaxColumns() < col) sh.insertColumnsAfter(sh.getMaxColumns(), col - sh.getMaxColumns());
  if (sh.getLastColumn() < col) { var c = sh.getRange(1, col); c.setValue('Owner'); c.setFontWeight('bold'); }
  return sh;
}

function createSheet_(k) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.insertSheet(SHEET_NAMES[k]);
  var r;
  if (k === 'SET') {
    r = [['Setting', 'Value'],
      ['Employee Name', ''], ['Designation', ''], ['Monthly Salary', 0],
      ['Year', new Date().getFullYear()], ['Currency Symbol', '₹'],
      ['Salary Days Basis (0 = actual days in month)', 0],
      ['Username', ''], ['Password', ''], ['', ''],
      ['Status Codes (dropdown options)', '']];
    sh.getRange(1, 1, r.length, 2).setValues(r);
    var t = [['Code', 'Label', 'Paid Factor (1 = full, 0.5 = half, 0 = unpaid)', 'Color']];
    DEFAULT_STATUSES.forEach(function (x) { t.push([x.code, x.label, x.factor, x.color]); });
    sh.getRange(r.length + 1, 1, t.length, 4).setValues(t);
  } else if (k === 'ATT') {
    fillAttSheet_(sh);
  } else if (k === 'EMP') {
    sh.getRange(1, 1, 1, 7).setValues([['ID', 'Name', 'Designation', 'Monthly Salary', 'Salary Days Basis (0 = actual days)', 'Attendance Sheet', 'Owner']]);
    sh.getRange('A:C').setNumberFormat('@');
    sh.getRange('F:F').setNumberFormat('@');
  } else if (k === 'EXP') {
    sh.getRange(1, 1, 1, 6).setValues([['Date', 'Category', 'Amount', 'Note', 'ID', 'Owner']]);
    sh.getRange('A:A').setNumberFormat('@');
  } else if (k === 'WORK') {
    sh.getRange(1, 1, 1, 8).setValues([['Date', 'Name', 'Product Name', 'Product Number', 'Sticker', 'Description', 'ID', 'Owner']]);
    sh.getRange('A:H').setNumberFormat('@');
    sh.setFrozenRows(1);
  } else if (k === 'PW') {
    sh.getRange(1, 1, 1, 5).setValues([['Website URL', 'User ID', 'Password', 'ID', 'Owner']]);
    sh.getRange('A:E').setNumberFormat('@');
    sh.setFrozenRows(1);
  } else if (k === 'LINK') {
    sh.getRange(1, 1, 1, 5).setValues([['Name', 'Type', 'Link', 'ID', 'Owner']]);
    sh.getRange('A:E').setNumberFormat('@');
    sh.setFrozenRows(1);
  } else if (k === 'CAT') {
    var c = [['Category Name', 'Type', 'Owner']].concat(DEFAULT_CATS.map(function (x) { return [x[0], x[1], 'ADMIN']; }));
    sh.getRange(1, 1, c.length, 3).setValues(c);
  } else if (k === 'TT') {
    sh.getRange(1, 1, 1, 4).setValues([['Type (Category / Day)', 'Key (category name / date)', 'Value (time slots as JSON)', 'Owner']]);
    sh.getRange('A:D').setNumberFormat('@');
    sh.setFrozenRows(1);
  } else if (k === 'CHAT') {
    sh.getRange(1, 1, 1, 6).setValues([['ID', 'Time (ms)', 'From (user ID)', 'To (user ID)', 'Message', 'Sent at']]);
    sh.getRange('A:A').setNumberFormat('@'); sh.getRange('C:F').setNumberFormat('@'); sh.getRange('B:B').setNumberFormat('0');
    sh.setFrozenRows(1);
  } else if (k === 'USERS') {
    sh.getRange(1, 1, 1, 14).setValues([['ID', 'Username', 'Password', 'Role (admin / user)', 'Display Name', 'Recovery E-mail', 'Active (Yes / No)',
      'Permissions (JSON)', 'Location required (Yes / No)', 'Created', 'Last Login', 'Payment due until', 'Avatar (icon)', 'Created By (user ID)']]);
    sh.getRange('A:N').setNumberFormat('@');
    sh.setFrozenRows(1);
  } else if (k === 'GROUPS') {
    sh.getRange(1, 1, 1, 4).setValues([['ID', 'Group name', 'Member user IDs (comma separated)', 'Created']]);
    sh.getRange('A:D').setNumberFormat('@');
    sh.setFrozenRows(1);
  } else if (k === 'LOG') {
    sh.getRange(1, 1, 1, 19).setValues([['Time', 'User ID', 'Username', 'Name', 'Result', 'Reason', 'Latitude', 'Longitude', 'Accuracy (m)',
      'Location source', 'Map link', 'Device', 'Browser', 'OS', 'Screen', 'Timezone', 'IP address', 'Place (from IP)', 'Device ID']]);
    sh.getRange('A:S').setNumberFormat('@');
    sh.setFrozenRows(1);
  } else if (k === 'ACT') {
    sh.getRange(1, 1, 1, 6).setValues([['Time', 'User ID', 'Username', 'Name', 'Action', 'Details']]);
    sh.getRange('A:F').setNumberFormat('@');
    sh.setFrozenRows(1);
  }
  sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold');
  return sh;
}

function fillAttSheet_(sh) {
  var hdr = ['Month'];
  for (var d = 1; d <= 31; d++) hdr.push(d);
  hdr = hdr.concat(['Days', 'Present', 'Absent', 'Week Off']);
  sh.getRange(1, 1, 1, hdr.length).setValues([hdr]);
  var y = new Date().getFullYear();
  try { var yy = Number(readSettings_().values.year); if (yy > 1900) y = yy; } catch (e) {}
  for (var m = 0; m < 12; m++) {
    var row = m + 2;
    sh.getRange(row, 1).setValue(MONTHS[m]);
    sh.getRange(row, 33).setValue(new Date(y, m + 1, 0).getDate());
    sh.getRange(row, 34).setFormula('=COUNTIF(B' + row + ':AF' + row + ',"P")');
    sh.getRange(row, 35).setFormula('=COUNTIF(B' + row + ':AF' + row + ',"A")');
    sh.getRange(row, 36).setFormula('=COUNTIF(B' + row + ':AF' + row + ',"W")');
  }
  sh.getRange(1, 1, 1, hdr.length).setFontWeight('bold');
}

// ---------- SETTINGS ----------
function readSettings_() {
  var sh = getSheet_('SET');
  var data = sh.getDataRange().getValues();
  var values = {}, rows = {}, statusHeader = -1, i, f;
  for (i = 0; i < data.length; i++) {
    var label = String(data[i][0]).trim();
    if (label.toLowerCase() === 'code') { statusHeader = i; break; }
    if (!label) continue;
    for (var j = 0; j < SETTING_FIELDS.length; j++) {
      f = SETTING_FIELDS[j];
      if (!(f.key in rows) && f.re.test(label)) { rows[f.key] = i + 1; values[f.key] = data[i][1]; }
    }
  }
  var statuses = [];
  if (statusHeader >= 0) {
    for (i = statusHeader + 1; i < data.length; i++) {
      var code = String(data[i][0]).trim();
      if (!code) break;
      var fac = Number(data[i][2]);
      statuses.push({ code: code.toUpperCase(), label: String(data[i][1]), factor: isNaN(fac) ? 0 : fac,
        color: String(data[i][3] || '#e2e8f0'), row: i + 1 });
    }
  }
  if (!statuses.length) statuses = DEFAULT_STATUSES.map(function (x) { return { code: x.code, label: x.label, factor: x.factor, color: x.color }; });
  return { sh: sh, values: values, rows: rows, statuses: statuses };
}

function writeSetting_(key, value) {
  var s = readSettings_();
  var sh = s.sh;
  var f = SETTING_FIELDS.filter(function (x) { return x.key === key; })[0];
  var isText = (key === 'name' || key === 'designation' || key === 'username' || key === 'password' || key === 'currency' || key === 'appName' || key === 'email');
  if (s.rows[key]) {
    var cell = sh.getRange(s.rows[key], 2);
    if (isText) cell.setNumberFormat('@');
    cell.setValue(value);
    return;
  }
  var data = sh.getDataRange().getValues();
  var at = -1;
  for (var i = 0; i < data.length; i++) {
    var l = String(data[i][0]).trim();
    if (/^status codes/i.test(l) || l.toLowerCase() === 'code') { at = i + 1; break; }
  }
  if (at === -1) { sh.appendRow([f.label, value]); return; }
  sh.insertRowBefore(at);
  var c2 = sh.getRange(at, 2);
  if (isText) c2.setNumberFormat('@');
  sh.getRange(at, 1, 1, 2).setValues([[f.label, value]]);
}

function publicSettings_(s) {
  var v = s.values;
  var y = Number(v.year);
  return {
    name: String(v.name || ''),
    designation: String(v.designation || ''),
    salary: Number(v.salary) || 0,
    year: y > 1900 ? y : new Date().getFullYear(),
    currency: String(v.currency || '₹'),
    basis: Number(v.basis) || 0,
    appName: String(v.appName || '').trim(),
    email: String(v.email || '').trim(),
    username: String(v.username || '')
  };
}

// What the signed-in person is allowed to see of the global settings
function settingsView_(s) {
  var out = publicSettings_(s || readSettings_());
  if (!CTX.primary) { out.username = CTX.username; out.name = CTX.name; }
  if (CTX.role !== 'admin') { out.email = ''; out.designation = ''; out.salary = 0; out.basis = 0; }
  return out;
}

function saveSettings_(req) {
  var yr = Number(req.year);
  if (!(yr >= 2000 && yr <= 2100)) fail_('Enter a valid year.');
  var email = String(req.email || '').trim();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail_('Enter a valid e-mail address.');
  writeSetting_('year', yr);
  writeSetting_('currency', String(req.currency || '₹').trim() || '₹');
  writeSetting_('appName', String(req.appName || '').trim().slice(0, 30));
  writeSetting_('email', email);
  return { ok: true, settings: settingsView_() };
}

// ---------- EMPLOYEES ----------
function seedEmployee_(sh) {
  if (CTX.owner === 'ADMIN') {
    var v = readSettings_().values;
    var sal = Number(v.salary), b = Number(v.basis);
    sh.appendRow(['E1', String(v.name || ''), String(v.designation || ''), isNaN(sal) ? 0 : sal, isNaN(b) ? 0 : b, getSheet_('ATT').getName(), 'ADMIN']);
    return;
  }
  // a new user gets one employee (themselves) with its own attendance register
  var u = getAccount_(CTX.owner) || (CTX.group ? { name: CTX.group.name, username: '' } : { name: '', username: '' });
  var id = 'E' + Utilities.getUuid().replace(/-/g, '').slice(0, 5), nm = 'Att-' + id;
  fillAttSheet_(SpreadsheetApp.getActiveSpreadsheet().insertSheet(nm));
  sh.appendRow([id, u.name || u.username, '', 0, 0, nm, CTX.owner]);
}
function readEmployees_(all) {
  var sh = ownedSheet_('EMP', 7);
  var last = sh.getLastRow();
  var out = [];
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, 7).getValues().forEach(function (r, i) {
      var id = String(r[0]).trim();
      if (!id) return;
      if (!all && ownerOf_(r[6]) !== CTX.owner) return;          // only this person's employees (all = every user's, used internally)
      var sal = Number(r[3]), b = Number(r[4]);
      out.push({ id: id, name: String(r[1]), designation: String(r[2]), salary: isNaN(sal) ? 0 : sal,
        basis: isNaN(b) ? 0 : b, sheet: String(r[5]).trim(), row: i + 2 });
    });
  }
  if (!out.length && !all) { seedEmployee_(sh); return readEmployees_(); }   // first run for this person
  return out;
}
function cleanEmps_(list) {
  return list.map(function (e) { return { id: e.id, name: e.name, designation: e.designation, salary: e.salary, basis: e.basis }; });
}
function validEmp_(req) {
  var name = String(req.name || '').trim().slice(0, 60);
  if (!name) fail_('Employee name is required.');
  var sal = Number(req.salary), b = Number(req.basis || 0);
  if (isNaN(sal) || sal < 0) fail_('Monthly salary must be 0 or more.');
  if (isNaN(b) || b < 0 || b > 31) fail_('Salary days basis must be between 0 and 31.');
  return { name: name, designation: String(req.designation || '').trim().slice(0, 60), salary: sal, basis: b };
}
function empSheet_(emp) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = emp.sheet ? ss.getSheetByName(emp.sheet) : null;
  if (sh) return sh;
  var name = emp.sheet || ('Att-' + emp.id);
  sh = ss.insertSheet(name);
  fillAttSheet_(sh);
  return sh;
}
function findEmp_(id) {
  var e = readEmployees_().filter(function (x) { return x.id === String(id || ''); })[0];
  if (!e) fail_('Employee not found. Please refresh.');
  return e;
}
// Settings sheet always mirrors the FIRST employee (keeps the sheet and old data consistent)
function syncPrimary_() {
  if (CTX.owner !== 'ADMIN') return;               // only the main admin's first employee mirrors into Settings
  var p = readEmployees_()[0];
  if (!p) return;
  writeSetting_('name', p.name); writeSetting_('designation', p.designation);
  writeSetting_('salary', p.salary); writeSetting_('basis', p.basis);
}
function empReply_() {
  return { ok: true, employees: cleanEmps_(readEmployees_()), settings: settingsView_() };
}
function addEmployee_(req) {
  var x = validEmp_(req);
  var list = readEmployees_();
  if (list.length >= 50) fail_('Employee limit (50) reached.');
  var id = 'E' + Utilities.getUuid().replace(/-/g, '').slice(0, 5);
  var sheetName = 'Att-' + id;
  var sh = SpreadsheetApp.getActiveSpreadsheet().insertSheet(sheetName);
  fillAttSheet_(sh);
  ownedSheet_('EMP', 7).appendRow([id, x.name, x.designation, x.salary, x.basis, sheetName, CTX.owner]);
  var r = empReply_(); r.id = id;
  return r;
}
function updateEmployee_(req) {
  var x = validEmp_(req), e = findEmp_(req.id);
  ownedSheet_('EMP', 7).getRange(e.row, 2, 1, 4).setValues([[x.name, x.designation, x.salary, x.basis]]);
  syncPrimary_();
  return empReply_();
}
function deleteEmployee_(req) {
  var list = readEmployees_();
  if (list.length < 2) fail_('At least one employee must remain.');
  var e = findEmp_(req.id);
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(e.sheet);
  if (sh) {
    if (/^Att-/.test(e.sheet)) SpreadsheetApp.getActiveSpreadsheet().deleteSheet(sh);
    else {                                           // the original register: just clear the day cells
      var a = attendanceMap_(sh), cols = Object.keys(a.dayCol).map(function (k) { return a.dayCol[k]; });
      var c1 = Math.min.apply(null, cols), c2 = Math.max.apply(null, cols);
      Object.keys(a.rows).forEach(function (m) { sh.getRange(a.rows[m], c1, 1, c2 - c1 + 1).clearContent(); });
    }
  }
  ownedSheet_('EMP', 7).deleteRow(e.row);
  syncPrimary_();
  return empReply_();
}

function saveStatuses_(req) {
  var s = readSettings_();
  var list = req.statuses || [];
  list.forEach(function (n) {
    var cur = s.statuses.filter(function (x) { return x.code === String(n.code).toUpperCase(); })[0];
    if (!cur || !cur.row) return;
    var fac = Number(n.factor);
    if (isNaN(fac) || fac < 0 || fac > 1) fail_('Paid factor must be between 0 and 1.');
    var color = /^#[0-9a-fA-F]{6}$/.test(String(n.color)) ? String(n.color) : cur.color;
    s.sh.getRange(cur.row, 2, 1, 3).setValues([[String(n.label || cur.label), fac, color]]);
  });
  return { ok: true, statuses: readSettings_().statuses.map(stripRow_) };
}
function addStatus_(req) {
  var s = readSettings_();
  var code = String(req.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{1,3}$/.test(code)) fail_('Code must be 1 to 3 letters or digits (for example H, HD, 1).');
  if (s.statuses.some(function (x) { return x.code === code; })) fail_('That code already exists.');
  var label = String(req.label || '').trim();
  if (!label) fail_('Label is required.');
  var fac = Number(req.factor);
  if (isNaN(fac) || fac < 0 || fac > 1) fail_('Paid factor must be between 0 and 1.');
  var color = /^#[0-9a-fA-F]{6}$/.test(String(req.color)) ? String(req.color) : '#e2e8f0';
  var withRow = s.statuses.filter(function (x) { return x.row; });
  if (withRow.length) {
    var at = withRow[withRow.length - 1].row;
    s.sh.insertRowAfter(at);
    s.sh.getRange(at + 1, 1).setNumberFormat('@');
    s.sh.getRange(at + 1, 1, 1, 4).setValues([[code, label, fac, color]]);
  } else {                                           // table missing: rebuild it with the defaults + the new one
    var t = [['Code', 'Label', 'Paid Factor (1 = full, 0.5 = half, 0 = unpaid)', 'Color']];
    DEFAULT_STATUSES.forEach(function (x) { t.push([x.code, x.label, x.factor, x.color]); });
    t.push([code, label, fac, color]);
    s.sh.getRange(s.sh.getLastRow() + 2, 1, t.length, 4).setValues(t);
  }
  return { ok: true, statuses: readSettings_().statuses.map(stripRow_) };
}
function deleteStatus_(req) {
  var s = readSettings_();
  var code = String(req.code || '').trim().toUpperCase();
  if (code === 'P' || code === 'A' || code === 'W') fail_('P, A and W are core codes and cannot be deleted. You can rename them or change their colour.');
  var cur = s.statuses.filter(function (x) { return x.code === code; })[0];
  if (!cur || !cur.row) fail_('Status code not found.');
  var used = 0;
  readEmployees_(true).forEach(function (e) {
    var att = readAttendance_(empSheet_(e));
    Object.keys(att).forEach(function (m) { Object.keys(att[m]).forEach(function (d) { if (att[m][d] === code) used++; }); });
  });
  if (used) fail_(used + ' day(s) are marked "' + code + '". Clear or change those days first.');
  s.sh.deleteRow(cur.row);
  return { ok: true, statuses: readSettings_().statuses.map(stripRow_) };
}
function stripRow_(x) { return { code: x.code, label: x.label, factor: x.factor, color: x.color }; }

// ---------- ATTENDANCE ----------
function attendanceMap_(sh) {
  sh = sh || getSheet_('ATT');
  var data = sh.getDataRange().getValues();
  var hdr = -1, i;
  for (i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim().toLowerCase() === 'month') { hdr = i; break; }
  }
  if (hdr < 0) fail_('Attendance Register: header row with "Month" in column A was not found.');
  var dayCol = {};
  for (var c = 1; c < data[hdr].length; c++) {
    var n = Number(data[hdr][c]);
    if (data[hdr][c] !== '' && n >= 1 && n <= 31 && !dayCol[n]) dayCol[n] = c + 1;
  }
  var rows = {};
  for (i = hdr + 1; i < data.length; i++) {
    var nm = String(data[i][0]).trim().toLowerCase();
    for (var m = 0; m < 12; m++) if (MONTHS[m].toLowerCase() === nm && !rows[m + 1]) rows[m + 1] = i + 1;
  }
  return { sh: sh, data: data, dayCol: dayCol, rows: rows };
}

function readAttendance_(sh) {
  var a = attendanceMap_(sh);
  var out = {};
  for (var m = 1; m <= 12; m++) {
    if (!a.rows[m]) continue;
    var rowArr = a.data[a.rows[m] - 1];
    for (var d = 1; d <= 31; d++) {
      if (!a.dayCol[d]) continue;
      var v = String(rowArr[a.dayCol[d] - 1]).trim().toUpperCase();
      if (v) { if (!out[m]) out[m] = {}; out[m][d] = v; }
    }
  }
  return out;
}

function setAttendance_(req) {
  var emps = readEmployees_();
  var emp = emps.filter(function (x) { return x.id === String(req.emp || ''); })[0] || emps[0];
  var a = attendanceMap_(empSheet_(emp));
  var s = readSettings_();
  var year = publicSettings_(s).year;
  var valid = {};
  s.statuses.forEach(function (x) { valid[x.code] = 1; });
  var entries = req.entries || [];
  if (entries.length > 400) fail_('Too many changes in one request.');
  entries.forEach(function (e) {
    var m = Number(e.month), d = Number(e.day), code = String(e.code || '').toUpperCase();
    if (!(m >= 1 && m <= 12)) fail_('Invalid month.');
    var dim = new Date(year, m, 0).getDate();
    if (!(d >= 1 && d <= dim)) fail_('Invalid day for ' + MONTHS[m - 1] + '.');
    if (code && !valid[code]) fail_('Unknown status code: ' + code);
    if (!a.rows[m] || !a.dayCol[d]) fail_('Cell not found in Attendance Register.');
    a.sh.getRange(a.rows[m], a.dayCol[d]).setValue(code);
  });
  return { ok: true };
}

// ---------- CATEGORIES ----------
function readCategories_() {
  var sh = ownedSheet_('CAT', 3);
  var last = sh.getLastRow();
  var out = [];
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, 3).getValues().forEach(function (r, i) {
      var name = String(r[0]).trim();
      if (!name || ownerOf_(r[2]) !== CTX.owner) return;
      out.push({ name: name, type: /^inc/i.test(String(r[1])) ? 'Income' : 'Expense', row: i + 2 });
    });
  }
  if (!out.length && CTX.owner !== 'ADMIN') {                    // new user: start with the standard categories (once)
    var props = PropertiesService.getScriptProperties(), k = 'CATSEED_' + CTX.owner;
    if (!props.getProperty(k)) {
      props.setProperty(k, '1');
      var rows = DEFAULT_CATS.map(function (c) { return [c[0], c[1], CTX.owner]; });
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, 3).setValues(rows);
      return readCategories_();
    }
  }
  return out;
}
function cleanCats_(list) { return list.map(function (c) { return { name: c.name, type: c.type }; }); }
function normType_(t) { return /^inc/i.test(String(t || '')) ? 'Income' : 'Expense'; }

function addCategory_(req) {
  var name = String(req.name || '').trim();
  if (!name) fail_('Category name is required.');
  var cats = readCategories_();
  if (cats.some(function (c) { return c.name.toLowerCase() === name.toLowerCase(); })) fail_('That category already exists.');
  ownedSheet_('CAT', 3).appendRow([name, normType_(req.type), CTX.owner]);
  return { ok: true, categories: cleanCats_(readCategories_()) };
}

function updateCategory_(req) {
  var cats = readCategories_();
  var old = String(req.oldName || '');
  var cur = cats.filter(function (c) { return c.name === old; })[0];
  if (!cur) fail_('Category not found.');
  var name = String(req.name || '').trim();
  if (!name) fail_('Category name is required.');
  if (cats.some(function (c) { return c !== cur && c.name.toLowerCase() === name.toLowerCase(); })) fail_('Another category already has that name.');
  ownedSheet_('CAT', 3).getRange(cur.row, 1, 1, 2).setValues([[name, normType_(req.type)]]);
  if (name !== old) renameInExpenses_(old, name);
  return { ok: true, categories: cleanCats_(readCategories_()) };
}

function deleteCategory_(req) {
  var cats = readCategories_();
  var old = String(req.name || '');
  var cur = cats.filter(function (c) { return c.name === old; })[0];
  if (!cur) fail_('Category not found.');
  ownedSheet_('CAT', 3).deleteRow(cur.row);
  if (req.reassignTo !== undefined && req.reassignTo !== null) renameInExpenses_(old, String(req.reassignTo));
  return { ok: true, categories: cleanCats_(readCategories_()) };
}

function renameInExpenses_(from, to) {
  var sh = ownedSheet_('EXP', 6);
  var last = sh.getLastRow();
  if (last < 2) return;
  var all = sh.getRange(2, 2, last - 1, 5).getValues();           // columns B..F  (F = owner)
  var changed = false;
  var col = all.map(function (r) {
    if (String(r[0]) === from && ownerOf_(r[4]) === CTX.owner) { changed = true; return [to]; }
    return [r[0]];
  });
  if (changed) sh.getRange(2, 2, last - 1, 1).setValues(col);
}
// ---------- EXPENSES ----------
function fmtDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  var d = new Date(s);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return s;
}

function readExpenses_() {
  var sh = ownedSheet_('EXP', 6);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, 6).getValues();
  var out = [], dirty = false;
  vals.forEach(function (r) {
    if (r[0] === '' && r[1] === '' && r[2] === '') return;
    var id = String(r[4] || '').trim();
    if (!id) { id = Utilities.getUuid().slice(0, 8); r[4] = id; dirty = true; }
    if (ownerOf_(r[5]) !== CTX.owner) return;
    out.push({ id: id, date: fmtDate_(r[0]), category: String(r[1]), amount: Number(r[2]) || 0, note: String(r[3] || '') });
  });
  if (dirty) sh.getRange(2, 5, vals.length, 1).setValues(vals.map(function (r) { return [r[4]]; }));
  return out;
}
function validExpense_(req) {
  var date = String(req.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail_('Enter a valid date.');
  var amt = Number(req.amount);
  if (isNaN(amt) || amt <= 0) fail_('Amount must be greater than 0.');
  var cat = String(req.category || '').trim();
  if (!cat) fail_('Select a category.');
  return { date: date, amount: amt, category: cat, note: String(req.note || '').trim().slice(0, 300) };
}

function addExpense_(req) {
  var x = validExpense_(req);
  var sh = ownedSheet_('EXP', 6);
  var row = sh.getLastRow() + 1;
  var id = Utilities.getUuid().slice(0, 8);
  sh.getRange(row, 1).setNumberFormat('@');
  sh.getRange(row, 1, 1, 6).setValues([[x.date, x.category, x.amount, x.note, id, CTX.owner]]);
  return { ok: true, expense: { id: id, date: x.date, category: x.category, amount: x.amount, note: x.note } };
}

function findExpenseRow_(sh, id) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var v = sh.getRange(2, 5, last - 1, 2).getValues();            // ID, Owner
  for (var i = 0; i < v.length; i++) if (String(v[i][0]) === String(id) && ownerOf_(v[i][1]) === CTX.owner) return i + 2;
  return -1;
}
function updateExpense_(req) {
  var x = validExpense_(req);
  var sh = ownedSheet_('EXP', 6);
  var row = findExpenseRow_(sh, req.id);
  if (row < 0) fail_('Entry not found. Please refresh.');
  sh.getRange(row, 1).setNumberFormat('@');
  sh.getRange(row, 1, 1, 4).setValues([[x.date, x.category, x.amount, x.note]]);
  return { ok: true, expense: { id: String(req.id), date: x.date, category: x.category, amount: x.amount, note: x.note } };
}

function deleteExpense_(req) {
  var sh = ownedSheet_('EXP', 6);
  var row = findExpenseRow_(sh, req.id);
  if (row < 0) fail_('Entry not found. Please refresh.');
  sh.deleteRow(row);
  return { ok: true };
}

// ---------- WORK (daily work record) ----------
function readWork_() {
  var sh = ownedSheet_('WORK', 8);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, 8).getValues();
  var out = [], dirty = false;
  vals.forEach(function (r) {
    if (r[0] === '' && r[1] === '' && r[2] === '' && r[3] === '' && r[4] === '' && r[5] === '') return;
    var id = String(r[6] || '').trim();
    if (!id) { id = Utilities.getUuid().slice(0, 8); r[6] = id; dirty = true; }
    if (ownerOf_(r[7]) !== CTX.owner) return;
    out.push({ id: id, date: fmtDate_(r[0]), name: String(r[1]), product: String(r[2]),
      number: String(r[3]), sticker: String(r[4]), desc: String(r[5]) });
  });
  if (dirty) sh.getRange(2, 7, vals.length, 1).setValues(vals.map(function (r) { return [r[6]]; }));
  return out;
}
function validWork_(req) {
  var date = String(req.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail_('Enter a valid date.');
  var w = {
    date: date,
    name: String(req.name || '').trim().slice(0, 100),
    product: String(req.product || '').trim().slice(0, 100),
    number: String(req.number || '').trim().slice(0, 60),
    sticker: String(req.sticker || '').trim().slice(0, 60),
    desc: String(req.desc || '').trim().slice(0, 500)
  };
  if (!(w.name || w.product || w.number || w.sticker || w.desc)) fail_('Fill in at least one field.');
  return w;
}

function findWorkRow_(sh, id) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var v = sh.getRange(2, 7, last - 1, 2).getValues();            // ID, Owner
  for (var i = 0; i < v.length; i++) if (String(v[i][0]) === String(id) && ownerOf_(v[i][1]) === CTX.owner) return i + 2;
  return -1;
}
function addWork_(req) {
  var w = validWork_(req);
  var sh = ownedSheet_('WORK', 8);
  var row = sh.getLastRow() + 1;
  var id = Utilities.getUuid().slice(0, 8);
  var rng = sh.getRange(row, 1, 1, 8);
  rng.setNumberFormat('@');
  rng.setValues([[w.date, w.name, w.product, w.number, w.sticker, w.desc, id, CTX.owner]]);
  w.id = id;
  return { ok: true, work: w };
}

function updateWork_(req) {
  var w = validWork_(req);
  var sh = ownedSheet_('WORK', 8);
  var row = findWorkRow_(sh, req.id);
  if (row < 0) fail_('Entry not found. Please refresh.');
  var rng = sh.getRange(row, 1, 1, 6);
  rng.setNumberFormat('@');
  rng.setValues([[w.date, w.name, w.product, w.number, w.sticker, w.desc]]);
  w.id = String(req.id);
  return { ok: true, work: w };
}

function deleteWork_(req) {
  var sh = ownedSheet_('WORK', 8);
  var row = findWorkRow_(sh, req.id);
  if (row < 0) fail_('Entry not found. Please refresh.');
  sh.deleteRow(row);
  return { ok: true };
}

// ---------- PASSWORD MANAGER ----------
// Sheet "Password Manager": Website URL | User ID | Password | ID | Owner   (every user only sees / changes their own rows)
function readPw_() {
  var sh = ownedSheet_('PW', 5);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, 5).getValues();
  var out = [], dirty = false;
  vals.forEach(function (r) {
    if (r[0] === '' && r[1] === '' && r[2] === '') return;
    var id = String(r[3] || '').trim();
    if (!id) { id = Utilities.getUuid().slice(0, 8); r[3] = id; dirty = true; }
    if (ownerOf_(r[4]) !== CTX.owner) return;
    out.push({ id: id, url: String(r[0]), user: String(r[1]), pass: String(r[2]) });
  });
  if (dirty) sh.getRange(2, 4, vals.length, 1).setValues(vals.map(function (r) { return [r[3]]; }));
  return out;
}
function validPw_(req) {
  var p = {
    url: String(req.url || '').trim().slice(0, 500),
    user: String(req.user || '').trim().slice(0, 200),
    pass: String(req.pass === undefined || req.pass === null ? '' : req.pass).slice(0, 200)
  };
  if (!(p.url || p.user || p.pass)) fail_('Fill in at least one field.');
  return p;
}
function findPwRow_(sh, id) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var v = sh.getRange(2, 4, last - 1, 2).getValues();            // ID, Owner
  for (var i = 0; i < v.length; i++) if (String(v[i][0]) === String(id) && ownerOf_(v[i][1]) === CTX.owner) return i + 2;
  return -1;
}
function addPw_(req) {
  var p = validPw_(req);
  var sh = ownedSheet_('PW', 5);
  var row = sh.getLastRow() + 1;
  var id = Utilities.getUuid().slice(0, 8);
  var rng = sh.getRange(row, 1, 1, 5);
  rng.setNumberFormat('@');
  rng.setValues([[p.url, p.user, p.pass, id, CTX.owner]]);
  p.id = id;
  return { ok: true, pw: p };
}
function updatePw_(req) {
  var p = validPw_(req);
  var sh = ownedSheet_('PW', 5);
  var row = findPwRow_(sh, req.id);
  if (row < 0) fail_('Entry not found. Please refresh.');
  var rng = sh.getRange(row, 1, 1, 3);
  rng.setNumberFormat('@');
  rng.setValues([[p.url, p.user, p.pass]]);
  p.id = String(req.id);
  return { ok: true, pw: p };
}
function deletePw_(req) {
  var sh = ownedSheet_('PW', 5);
  var row = findPwRow_(sh, req.id);
  if (row < 0) fail_('Entry not found. Please refresh.');
  sh.deleteRow(row);
  return { ok: true };
}

// Links: Movie / Web Series / Anime bookmarks (every user only sees / changes their own rows)
var LINK_TYPES = { Movie: 1, 'Web Series': 1, Anime: 1 };
function readLink_() {
  var sh = ownedSheet_('LINK', 5);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, 5).getValues();
  var out = [], dirty = false;
  vals.forEach(function (r) {
    if (r[0] === '' && r[1] === '' && r[2] === '') return;
    var id = String(r[3] || '').trim();
    if (!id) { id = Utilities.getUuid().slice(0, 8); r[3] = id; dirty = true; }
    if (ownerOf_(r[4]) !== CTX.owner) return;
    out.push({ id: id, name: String(r[0]), type: String(r[1]), link: String(r[2]) });
  });
  if (dirty) sh.getRange(2, 4, vals.length, 1).setValues(vals.map(function (r) { return [r[3]]; }));
  return out;
}
function validLink_(req) {
  var type = String(req.type || '').trim();
  if (!LINK_TYPES[type]) type = 'Movie';
  var p = {
    name: String(req.name || '').trim().slice(0, 300),
    type: type,
    link: String(req.link || '').trim().slice(0, 1000)
  };
  if (!(p.name || p.link)) fail_('Fill in at least one field.');
  return p;
}
function findLinkRow_(sh, id) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var v = sh.getRange(2, 4, last - 1, 2).getValues();            // ID, Owner
  for (var i = 0; i < v.length; i++) if (String(v[i][0]) === String(id) && ownerOf_(v[i][1]) === CTX.owner) return i + 2;
  return -1;
}
function addLink_(req) {
  var p = validLink_(req);
  var sh = ownedSheet_('LINK', 5);
  var row = sh.getLastRow() + 1;
  var id = Utilities.getUuid().slice(0, 8);
  var rng = sh.getRange(row, 1, 1, 5);
  rng.setNumberFormat('@');
  rng.setValues([[p.name, p.type, p.link, id, CTX.owner]]);
  p.id = id;
  return { ok: true, link: p };
}
function updateLink_(req) {
  var p = validLink_(req);
  var sh = ownedSheet_('LINK', 5);
  var row = findLinkRow_(sh, req.id);
  if (row < 0) fail_('Entry not found. Please refresh.');
  var rng = sh.getRange(row, 1, 1, 3);
  rng.setNumberFormat('@');
  rng.setValues([[p.name, p.type, p.link]]);
  p.id = String(req.id);
  return { ok: true, link: p };
}
function deleteLink_(req) {
  var sh = ownedSheet_('LINK', 5);
  var row = findLinkRow_(sh, req.id);
  if (row < 0) fail_('Entry not found. Please refresh.');
  sh.deleteRow(row);
  return { ok: true };
}

// ---------- TIME TABLE ----------
// Sheet "Timetable": Type | Key | Value | Owner
//   Type "Category" -> Key = category name (these fill the dropdown of every slot)
//   Type "Day"      -> Key = date (yyyy-mm-dd), Value = JSON like {"05:00":"Study","05:30":"Gym"}  (slot start time -> category)
// 40 half-hour slots: 05:00 ... 23:30, then 00:00 and 00:30 (the last slot ends at 1 AM).
function ttSlots_() {
  var out = [];
  for (var i = 0; i < 40; i++) {
    var mn = 300 + i * 30, h = Math.floor(mn / 60) % 24, m = mn % 60;
    out.push((h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m);
  }
  return out;
}
function readTT_() {
  var sh = ownedSheet_('TT', 4), last = sh.getLastRow(), cats = [], days = {};
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, 4).getValues().forEach(function (r, i) {
      if (ownerOf_(r[3]) !== CTX.owner) return;
      var type = String(r[0]).trim().toLowerCase(), key = String(r[1] instanceof Date ? fmtDate_(r[1]) : r[1]).trim();
      if (!key) return;
      if (type === 'category') cats.push({ name: key, row: i + 2 });
      else if (type === 'day') {
        var o = {};
        try { o = JSON.parse(String(r[2] || '{}')) || {}; } catch (e) { o = {}; }
        days[key] = { row: i + 2, slots: o };
      }
    });
  }
  return { cats: cats, days: days };
}
function ttDaysOut_(t) {
  var o = {};
  Object.keys(t.days).forEach(function (d) { if (Object.keys(t.days[d].slots).length) o[d] = t.days[d].slots; });
  return o;
}
function ttReply_() {
  var t = readTT_();
  return { ok: true, categories: t.cats.map(function (c) { return c.name; }), timetable: ttDaysOut_(t) };
}
function ttCatName_(v) {
  var n = String(v === undefined || v === null ? '' : v).trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!n) fail_('Category name is required.');
  return n;
}
// writes one date's slots (an existing row is overwritten, a new date gets a new row)
function ttWriteDay_(t, date, day) {
  var sh = ownedSheet_('TT', 4), json = JSON.stringify(day), cur = t.days[date];
  if (cur) { var c = sh.getRange(cur.row, 3); c.setNumberFormat('@'); c.setValue(json); return; }
  if (!Object.keys(day).length) return;
  var r = sh.getRange(sh.getLastRow() + 1, 1, 1, 4);
  r.setNumberFormat('@');
  r.setValues([['Day', date, json, CTX.owner]]);
}
function addTtCat_(req) {
  var name = ttCatName_(req.name), t = readTT_();
  if (t.cats.some(function (c) { return c.name.toLowerCase() === name.toLowerCase(); })) fail_('That category already exists.');
  if (t.cats.length >= 100) fail_('Category limit (100) reached.');
  var sh = ownedSheet_('TT', 4), r = sh.getRange(sh.getLastRow() + 1, 1, 1, 4);
  r.setNumberFormat('@');
  r.setValues([['Category', name, '', CTX.owner]]);
  var out = ttReply_(); out.name = name;
  return out;
}
function updateTtCat_(req) {
  var t = readTT_(), old = String(req.oldName || ''), name = ttCatName_(req.name);
  var cur = t.cats.filter(function (c) { return c.name === old; })[0];
  if (!cur) fail_('Category not found.');
  if (t.cats.some(function (c) { return c !== cur && c.name.toLowerCase() === name.toLowerCase(); })) fail_('Another category already has that name.');
  var cell = ownedSheet_('TT', 4).getRange(cur.row, 2);
  cell.setNumberFormat('@');
  cell.setValue(name);
  if (name !== old) {                                   // renaming also updates the slots already filled
    Object.keys(t.days).forEach(function (d) {
      var s = t.days[d].slots, hit = false;
      Object.keys(s).forEach(function (k) { if (s[k] === old) { s[k] = name; hit = true; } });
      if (hit) ttWriteDay_(t, d, s);
    });
  }
  return ttReply_();
}
function deleteTtCat_(req) {
  var t = readTT_(), old = String(req.name || '');
  var cur = t.cats.filter(function (c) { return c.name === old; })[0];
  if (!cur) fail_('Category not found.');
  Object.keys(t.days).forEach(function (d) {            // slots that used it become empty (rows are updated BEFORE the category row is removed)
    var s = t.days[d].slots, hit = false;
    Object.keys(s).forEach(function (k) { if (s[k] === old) { delete s[k]; hit = true; } });
    if (hit) ttWriteDay_(t, d, s);
  });
  ownedSheet_('TT', 4).deleteRow(cur.row);
  return ttReply_();
}
// req: { date, slots: { "05:00": "Study", "05:30": "" }, replace: true|false }   ("" empties a slot)
function setTimetable_(req) {
  var date = String(req.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail_('Enter a valid date.');
  var valid = {}, cats = {};
  ttSlots_().forEach(function (k) { valid[k] = 1; });
  var t = readTT_();
  t.cats.forEach(function (c) { cats[c.name] = 1; });
  var patch = (req.slots && typeof req.slots === 'object') ? req.slots : {};
  var replace = req.replace === true || req.replace === 'true';
  var before = JSON.parse(JSON.stringify(t.days[date] ? t.days[date].slots : {}));
  var day = replace ? {} : JSON.parse(JSON.stringify(before));
  Object.keys(patch).forEach(function (k) {
    if (!valid[k]) fail_('Invalid time slot: ' + k);
    var c = String(patch[k] === undefined || patch[k] === null ? '' : patch[k]).trim();
    if (!c) { delete day[k]; return; }
    if (!cats[c]) fail_('Category "' + c + '" does not exist. Add it first.');
    day[k] = c;
  });
  ttWriteDay_(t, date, day);
  calQueueDay_(date, before, day);          // Google Calendar (only if this user connected one)
  return { ok: true, slots: day };
}

// ---------- CHAT (one-to-one messages + online / last-seen) ----------
// Sheet "Chat": ID | Time (ms) | From | To | Message | Sent at.   Presence ("online") = the person made any request in the last ~70 seconds.
// The website pings the server every ~20 s while it is open, so a closed / hidden tab turns "offline" quickly.
var CHAT_ONLINE_MS = 70000;
var CHAT_MAX_LEN = 2000;
var CHAT_SCAN = 2500;                    // newest rows looked at on every call

function touchSeen_(uid) {
  try {
    var now = Date.now(), cache = CacheService.getScriptCache();
    cache.put('seen_' + uid, String(now), 21600);
    if (!cache.get('seenp_' + uid)) {                      // persist at most every 2 minutes (survives the 6 h cache limit)
      PropertiesService.getScriptProperties().setProperty('LS_' + uid, String(now));
      cache.put('seenp_' + uid, '1', 120);
    }
  } catch (e) {}
}
function markOffline_(uid) {
  try {
    var t = Date.now() - CHAT_ONLINE_MS - 1000;            // shows offline right away, "last seen" ~ now
    CacheService.getScriptCache().put('seen_' + uid, String(t), 21600);
    PropertiesService.getScriptProperties().setProperty('LS_' + uid, String(t));
    CacheService.getScriptCache().remove('seenp_' + uid);
  } catch (e) {}
}
function seenMap_(ids) {
  var out = {}, cache = CacheService.getScriptCache(), props = PropertiesService.getScriptProperties().getProperties();
  var keys = ids.map(function (i) { return 'seen_' + i; }), got = ids.length ? cache.getAll(keys) : {};
  ids.forEach(function (i) {
    var a = Number(got['seen_' + i] || 0), b = Number(props['LS_' + i] || 0);
    out[i] = Math.max(a, b);
  });
  return out;
}
function presence_(ms, now) {
  return { online: !!ms && (now - ms) <= CHAT_ONLINE_MS, ago: ms ? Math.max(0, now - ms) : null };
}
function readPtr_(uid) {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('CR_' + uid) || '{}') || {}; } catch (e) { return {}; }
}
function chatRows_() {
  var sh = getSheet_('CHAT'), last = sh.getLastRow();
  if (last < 2) return [];
  var n = Math.min(last - 1, CHAT_SCAN);
  return sh.getRange(last - n + 1, 1, n, 5).getValues().map(function (r) {
    return { id: String(r[0]), t: Number(r[1]) || 0, from: String(r[2]), to: String(r[3]), text: String(r[4]) };
  });
}
function chatPeers_() {
  var s = readSettings_().values;
  var list = [getAccount_('ADMIN', s)].concat(readUsers_()), me = getAccount_(CTX.uid, s);
  return list.filter(function (a) { return a.id !== CTX.uid && a.active && has_(a.username) && chatSee_(me, a); });
}
function chatUsers_() {
  var now = Date.now(), peers = chatPeers_(), ids = peers.map(function (a) { return a.id; });
  var seen = seenMap_(ids), ptr = readPtr_(CTX.uid), info = {}, total = 0;
  chatRows_().forEach(function (r) {                    // oldest -> newest
    var peer = r.from === CTX.uid ? r.to : (r.to === CTX.uid ? r.from : '');
    if (!peer) return;
    var o = info[peer] || (info[peer] = { unread: 0, last: null });
    if (r.to === CTX.uid && r.t > (ptr[peer] || 0)) o.unread++;
    o.last = r;
  });
  var users = peers.map(function (a) {
    var ms = seen[a.id] || 0;
    if (!ms && a.lastLogin) { var t = parseDue_(a.lastLogin); if (!isNaN(t)) ms = t; }     // never pinged yet -> last login
    var p = presence_(ms, now), o = info[a.id] || { unread: 0, last: null };
    total += o.unread;
    return { id: a.id, name: a.name || a.username, username: a.username, role: a.role, online: p.online, ago: p.ago,
      unread: o.unread, lastText: o.last ? o.last.text.slice(0, 80) : '', lastTime: o.last ? o.last.t : 0, lastMine: o.last ? o.last.from === CTX.uid : false };
  });
  return { ok: true, users: users, unread: total, now: now, me: CTX.uid };
}
function chatPing_() {
  var ptr = readPtr_(CTX.uid), total = 0;
  chatRows_().forEach(function (r) { if (r.to === CTX.uid && r.t > (ptr[r.from] || 0)) total++; });
  return { ok: true, unread: total, now: Date.now() };
}
function chatPeerOk_(id) {
  id = String(id || '').trim();
  if (!id || id === CTX.uid) fail_('Choose a user to chat with.');
  var acc = getAccount_(id, readSettings_().values);
  if (!acc || !acc.active || !has_(acc.username)) fail_('That user was not found.');
  if (!chatSee_(getAccount_(CTX.uid, readSettings_().values), acc)) fail_('That user was not found.');
  return acc;
}
function chatMsgOut_(r) { return { id: r.id, t: r.t, mine: r.from === CTX.uid, text: r.text }; }
// req: { with: userId, after: lastTimeSeen }  -> new messages of this conversation + whether the other person has read mine
function chatFetch_(req) {
  var w = chatPeerOk_(req.with).id, after = Number(req.after) || 0, now = Date.now();
  var rows = chatRows_().filter(function (r) { return (r.from === CTX.uid && r.to === w) || (r.from === w && r.to === CTX.uid); });
  var out = rows.filter(function (r) { return r.t > after; });
  if (!after && out.length > 300) out = out.slice(-300);
  var latestIn = 0;
  rows.forEach(function (r) { if (r.from === w && r.t > latestIn) latestIn = r.t; });
  var ptr = readPtr_(CTX.uid);
  if (latestIn > (ptr[w] || 0)) { ptr[w] = latestIn; PropertiesService.getScriptProperties().setProperty('CR_' + CTX.uid, JSON.stringify(ptr)); }
  var peerRead = Number(readPtr_(w)[CTX.uid] || 0);
  var ms = seenMap_([w])[w] || 0;
  var pr = ms ? presence_(ms, now) : null;
  return { ok: true, messages: out.map(chatMsgOut_), peerRead: peerRead, peerSeen: ms, now: now, presence: pr };
}
function chatSend_(req) {
  var peer = chatPeerOk_(req.to);
  var text = String(req.text === undefined || req.text === null ? '' : req.text).replace(/\r\n?/g, '\n').trim();
  if (!text) fail_('Type a message first.');
  if (text.length > CHAT_MAX_LEN) text = text.slice(0, CHAT_MAX_LEN);
  var cid = String(req.cid || '');
  var id = /^[A-Za-z0-9]{8,24}$/.test(cid) ? cid : Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  var tail = chatRows_().slice(-300), dup = null;
  tail.forEach(function (r) { if (r.id === id && r.from === CTX.uid) dup = r; });
  if (dup) return { ok: true, message: chatMsgOut_(dup) };          // the same message sent twice (network retry) is stored once
  var sh = getSheet_('CHAT'), row = sh.getLastRow() + 1, t = Date.now();
  var last = tail.length ? tail[tail.length - 1].t : 0;
  if (t <= last) t = last + 1;                                       // keep times strictly increasing
  var rng = sh.getRange(row, 1, 1, 6);
  rng.setNumberFormat('@');
  sh.getRange(row, 2).setNumberFormat('0');
  rng.setValues([[id, t, CTX.uid, peer.id, text, nowStr_()]]);
  if (sh.getLastRow() > 20000) sh.deleteRows(2, 2000);              // keep the sheet from growing forever
  return { ok: true, message: { id: id, t: t, mine: true, text: text } };
}

// ---------- BUNDLE ----------
function attAll_() {
  var out = {};
  readEmployees_().forEach(function (e) { out[e.id] = readAttendance_(empSheet_(e)); });
  return out;
}
function getAll_() {
  var s = readSettings_(), p = CTX.perms;
  var T = p.tt === 'none' ? { cats: [], days: {} } : readTT_();
  return {
    me: meOf_(s.values),
    settings: settingsView_(s),
    statuses: s.statuses.map(stripRow_),
    employees: cleanEmps_(readEmployees_()),
    attendanceAll: p.att === 'none' ? {} : attAll_(),
    expenses: p.exp === 'none' ? [] : readExpenses_(),
    categories: p.exp === 'none' ? [] : cleanCats_(readCategories_()),
    work: p.work === 'none' ? [] : readWork_(),
    passwords: p.pw === 'none' ? [] : readPw_(),
    links: p.link === 'none' ? [] : readLink_(),
    ttCats: T.cats.map(function (c) { return c.name; }),
    timetable: ttDaysOut_(T)
  };
}


// =====================================================================
// GOOGLE CALENDAR SYNC  (one-way: Time Table -> the user's OWN Google Calendar)
// ---------------------------------------------------------------------
// * Every user connects THEIR OWN Google account (Settings > Google Calendar). Events go to that
//   account's primary calendar only - never to the admin's, unless the admin connected theirs.
// * The refresh token is stored ENCRYPTED (key = TOKEN_SECRET) by server.js; this file only keeps
//   a small "meta" record (e-mail + time) so the Settings screen can show the status.
// * The real Calendar calls are made by server.js after the request is saved (see CAL_RT_.cal).
// * Needs the Node/Render server (server.js). Under plain Apps Script these calls are skipped.
// =====================================================================
function calTarget_() { return CTX.viewing ? CTX.owner : CTX.uid; }   // admin "view as" edits go to that user's calendar
function calMeta_(uid) {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('CAL_META_' + uid) || 'null'); } catch (e) { return null; }
}
function calPush_(uid, date, slot, cat) {
  if (typeof CAL_RT_ === 'undefined' || !CAL_RT_.cal) return;
  CAL_RT_.cal.push({ uid: uid, date: date, slot: slot, cat: cat || '' });
}
function calQueueDay_(date, before, after) {
  var uid = calTarget_();
  if (!calMeta_(uid)) return;                                        // this user has not connected a calendar
  var keys = {};
  Object.keys(before).forEach(function (k) { keys[k] = 1; });
  Object.keys(after).forEach(function (k) { keys[k] = 1; });
  Object.keys(keys).forEach(function (k) {
    if ((before[k] || '') !== (after[k] || '')) calPush_(uid, date, k, after[k] || '');
  });
}
function calAuthUrl_() {
  if (typeof CAL_CFG_ === 'undefined' || !CAL_CFG_.ready) fail_('Calendar sync is not set up on the server yet (CAL_CLIENT_ID / CAL_CLIENT_SECRET / PUBLIC_URL).');
  var url = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=' + encodeURIComponent(CAL_CFG_.clientId) +
    '&redirect_uri=' + encodeURIComponent(CAL_CFG_.redirect) + '&response_type=code&access_type=offline&prompt=consent&include_granted_scopes=true' +
    '&scope=' + encodeURIComponent('https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email') +
    '&state=' + encodeURIComponent(calState_(CTX.uid));
  return { ok: true, url: url };
}
function calStatus_() {
  var m = calMeta_(CTX.uid);
  return { ok: true, configured: typeof CAL_CFG_ !== 'undefined' && !!CAL_CFG_.ready, connected: !!m, email: m ? m.email : '', at: m ? m.at : 0 };
}
function calDisconnect_() {
  var p = PropertiesService.getScriptProperties();
  p.setProperty('CAL_META_' + CTX.uid, '');
  p.setProperty('CAL_TOK_' + CTX.uid, '');
  return { ok: true };
}
// Push all filled slots of the next 60 days (use right after connecting, for entries made before)
function calSyncAll_() {
  var uid = calTarget_();
  if (!calMeta_(uid)) fail_('Connect Google Calendar first.');
  var tz = Session.getScriptTimeZone();
  var from = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var to = Utilities.formatDate(new Date(Date.now() + 60 * 86400000), tz, 'yyyy-MM-dd');
  var t = readTT_(), n = 0;
  Object.keys(t.days).sort().forEach(function (d) {
    if (d < from || d > to) return;
    var s = t.days[d].slots;
    Object.keys(s).forEach(function (k) { if (n < 800) { calPush_(uid, d, k, s[k]); n++; } });
  });
  return { ok: true, queued: n };
}
// Admin overview: who has connected a calendar (no event content is ever read)
function ttCalStatus_() {
  var list = [getAccount_('ADMIN', readSettings_().values)].concat(readUsers_());
  if (!CTX.primary) { var tm = teamMap_(); tm[CTX.uid] = 1; list = list.filter(function (a) { return tm[a.id]; }); }
  return { ok: true, users: list.filter(function (a) { return a.active; }).map(function (a) {
    var m = calMeta_(a.id);
    return { id: a.id, name: a.name || a.username, connected: !!m, email: m ? m.email : '', at: m ? m.at : 0 };
  }) };
}
