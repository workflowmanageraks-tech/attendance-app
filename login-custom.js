/* AKS_VCS · Login page designer
   Settings › Login page (admin): change every picture, text, font size, colour and the "Ask your admin" line of the sign-in screen.
   The design is stored on the server (so every phone sees it before signing in) and cached on the phone for an instant first paint. */
(function(){
  'use strict';
  var $ = function(s, r){ return (r || document).querySelector(s); };
  var $$ = function(s, r){ return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function(t){ return String(t == null ? '' : t).replace(/[&<>"']/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]; }); };
  var LS_C = 'ks_lc_v1', LS_I = 'ks_lci_v1';
  var DEF_CHIPS = ['🗓️ Attendance', '💬 Chat & calls', '📋 VCS complaints', '🔒 Secure login'];
  var HEX = /^#[0-9a-f]{6}$/i;

  /* ---------- every text / element that can be customised ----------
     id, label, sel (inside #login), d = default text, px = default size, dc = default colour,
     tx:0 = no text box, st:0 = no colour/size, dyn = text is rewritten by the app, tn = text node only, attr = attribute, grad = gradient text, hs = what "Hide" hides */
  var E = [
    { g:'hero', id:'hh', l:'Big heading (left side)',      sel:'.lg-hero h2',           d:'Welcome Back',                       px:34, dc:'#ffffff' },
    { g:'hero', id:'hs', l:'Line under the heading',       sel:'.lg-hero p',            d:'Enter the workspace of AKS_VCS',     px:15, dc:'#9fb0cc' },
    { g:'hero', id:'hw', l:'Big name under the picture',   sel:'.lg-word',              d:'AKS_VCS',                            px:40, dc:'#818cf8', grad:1 },
    { g:'hero', id:'ch', l:'Feature chips (text size & colour)', sel:'.lg-chips li',    d:'', tx:0,                             px:12.5, dc:'#cfe0ff', hs:'.lg-chips' },
    { g:'card', id:'bn', l:'Brand name on the card',       sel:'.lg-brand span',        d:'AKS_VCS',                            px:26, dc:'#ffffff' },
    { g:'card', id:'tt', l:'Card title',                   sel:'#loginTitle',           d:'Sign in to your account',  dyn:1,    px:22, dc:'#ffffff' },
    { g:'card', id:'st', l:'Card sub-title',               sel:'#loginSub',             d:'Enter your username and password', dyn:1, px:14, dc:'#93a4c0' },
    { g:'card', id:'iu', l:'Username box – hint text',     sel:'#lu',                   d:'Email or Username', attr:'placeholder', st:0 },
    { g:'card', id:'ip', l:'Password box – hint text',     sel:'#lp',                   d:'Password',          attr:'placeholder', st:0 },
    { g:'card', id:'ix', l:'Typing text in the boxes',     sel:'.login-card .input',    d:'', tx:0,                             px:15, dc:'#ffffff', nohide:1 },
    { g:'card', id:'sh', l:'Show / Hide password button',  sel:'#togglePw',             d:'', tx:0,                             px:13, dc:'#7dd3fc', nohide:1 },
    { g:'card', id:'rm', l:'“Remember me” text',           sel:'.linkrow .check',       d:'Remember me', tn:'l',                px:13, dc:'#c3d0e8' },
    { g:'card', id:'fp', l:'“Forgot password?” link',      sel:'#forgotBtn',            d:'Forgot password?',                   px:13, dc:'#38bdf8' },
    { g:'card', id:'lb', l:'Sign-in button',               sel:'#loginBtn',             d:'Sign in', dyn:1,                     px:15, dc:'#ffffff', nohide:1 },
    { g:'card', id:'bi', l:'Fingerprint button',           sel:'#bioBtn',               d:'👆 Unlock with fingerprint / face',  px:15, dc:'#cfe0ff', nohide:1 },
    { g:'card', id:'fo', l:'“Don’t have an account?” line', sel:'.lg-foot',             d:'Don’t have an account?', tn:'r',    px:13.5, dc:'#c3d0e8' },
    { g:'card', id:'fl', l:'“Ask your admin” (link part)', sel:'.lg-foot b',            d:'Ask your admin',                     px:13.5, dc:'#38bdf8' },
    { g:'card', id:'nt', l:'Security note at the bottom',  sel:'.note',                 d:'🔒 For security, your sign-in time, location and device are recorded for the admin.', px:11.5, dc:'#7f90ad' }
  ];
  var COLS = [
    ['heroA', 'Left side – colour 1', '#12234a'], ['heroB', 'Left side – colour 2', '#0a1020'],
    ['sideBg', 'Right side background', '#111b2e'], ['cardBg', 'Card background', '#1d2940'], ['cardBr', 'Card border', '#2c3b57'],
    ['inBg', 'Input box background', '#0a101e'], ['inBr', 'Input box border', '#2a3a58'], ['ico', 'Little icons in boxes', '#8fa3c4'],
    ['btnA', 'Button – colour 1', '#1d6fd8'], ['btnB', 'Button – colour 2', '#1fa6b5'], ['btnTx', 'Button text', '#ffffff'],
    ['link', 'Link colour (all links)', '#38bdf8']
  ];
  var FONTS = [['', 'Default'], ['serif', 'Serif'], ['round', 'Rounded'], ['mono', 'Typewriter']];
  var FONT_CSS = { serif:'Georgia,"Noto Serif Devanagari","Times New Roman",serif', round:'ui-rounded,"SF Pro Rounded",Nunito,"Segoe UI",system-ui,"Noto Sans Devanagari",sans-serif', mono:'ui-monospace,"SF Mono",Consolas,Menlo,monospace' };

  /* ---------- config clean-up (everything read from the server / phone passes through here) ---------- */
  function num(v, lo, hi){ v = +v; return isFinite(v) && v >= lo && v <= hi ? Math.round(v * 10) / 10 : null; }
  function norm(j){
    var o = { el:{}, col:{}, n:{}, im:{}, font:'', chips:null };
    if (!j || typeof j !== 'object') return o;
    E.forEach(function(e){
      var v = j.el && j.el[e.id]; if (!v || typeof v !== 'object') return;
      var r = {};
      if (typeof v.t === 'string' && v.t.trim()) r.t = v.t.slice(0, 120);
      if (typeof v.c === 'string' && HEX.test(v.c)) r.c = v.c.toLowerCase();
      var s = e.px ? num(v.s, 6, 120) : null; if (s) r.s = s;
      if (v.b === 1 || v.b === 2) r.b = v.b;
      if (v.h) r.h = 1;
      if (Object.keys(r).length) o.el[e.id] = r;
    });
    COLS.forEach(function(c){ var v = j.col && j.col[c[0]]; if (typeof v === 'string' && HEX.test(v)) o.col[c[0]] = v.toLowerCase(); });
    var rad = j.n && num(j.n.rad, 0, 48), cw = j.n && num(j.n.cw, 300, 640);
    if (rad !== null && rad !== undefined) o.n.rad = rad; if (cw) o.n.cw = cw;
    var im = j.im || {};
    var hw = num(im.hw, 60, 560), lw = num(im.lw, 20, 140);
    if (hw) o.im.hw = hw; if (lw) o.im.lw = lw; if (im.hh) o.im.hh = 1; if (im.lh) o.im.lh = 1;
    if (typeof j.font === 'string' && FONT_CSS[j.font]) o.font = j.font;
    if (Array.isArray(j.chips)){ o.chips = j.chips.map(function(x){ return String(x).trim().slice(0, 40); }).filter(Boolean).slice(0, 10); }
    return o;
  }
  function clone(o){ return JSON.parse(JSON.stringify(o)); }

  /* ---------- state ---------- */
  var CFG = norm(null), IM = { v:'', hero:'', logo:'' };
  try { CFG = norm(JSON.parse(localStorage.getItem(LS_C) || 'null')); } catch (e) {}
  try { var li = JSON.parse(localStorage.getItem(LS_I) || 'null'); if (li && typeof li === 'object') IM = { v:String(li.v || ''), hero:String(li.hero || ''), logo:String(li.logo || '') }; } catch (e) {}
  var D = null, PI = {}, prevMode = 'desk', prevT = 0, styleReal = null, stylePrev = null;
  var okImg = function(s){ return /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+\/=]+$/.test(s || ''); };

  /* ---------- build the CSS for a design; scope = '#login' (real page) or '#lcPrevWrap #login' (preview) ---------- */
  function css(c, s){
    var o = [], col = c.col, n = c.n, im = c.im;
    var r = function(sel, body){ if (body) o.push(sel.split(',').map(function(x){ return s + ' ' + x.trim(); }).join(',') + '{' + body + '}'); };
    if (c.font) o.push(s + ',' + s + ' input,' + s + ' button,' + s + ' textarea{font-family:' + FONT_CSS[c.font] + '!important}');
    if (col.heroA || col.heroB) r('.lg-hero', 'background:linear-gradient(135deg,' + (col.heroA || '#12234a') + ',' + (col.heroB || '#0a1020') + ')!important');
    if (col.sideBg) r('.lg-side', 'background:' + col.sideBg + '!important');
    if (col.cardBg) r('.login-card', 'background:' + col.cardBg + '!important');
    if (col.cardBr) r('.login-card', 'border-color:' + col.cardBr + '!important');
    if (n.rad !== undefined) r('.login-card', 'border-radius:' + n.rad + 'px!important');
    if (n.cw) r('.login-card', 'max-width:' + n.cw + 'px!important');
    if (col.inBg) r('.input', 'background:' + col.inBg + '!important');
    if (col.inBr) r('.input', 'border-color:' + col.inBr + '!important');
    if (col.ico) r('.field .fi', 'color:' + col.ico + '!important');
    if (col.btnA || col.btnB || col.btnTx) r('.btn:not(.ghost)', (col.btnA || col.btnB ? 'background:linear-gradient(90deg,' + (col.btnA || '#1d6fd8') + ',' + (col.btnB || '#1fa6b5') + ')!important;' : '') + (col.btnTx ? 'color:' + col.btnTx + '!important;' : ''));
    if (col.link) r('.linkbtn,.lg-foot b,.pw button', 'color:' + col.link + '!important');
    E.forEach(function(e){
      var v = c.el[e.id]; if (!v) return;
      var b = '';
      if (v.c) b += 'color:' + v.c + '!important;' + (e.grad ? 'background:none!important;-webkit-text-fill-color:' + v.c + '!important;' : '');
      if (v.s) b += 'font-size:' + v.s + 'px!important;';
      if (v.b) b += 'font-weight:' + (v.b === 1 ? 800 : 400) + '!important;';
      r(e.sel, b);
      if (v.h) r(e.hs || e.sel, 'display:none!important');
    });
    if (im.hh) r('.lg-heroimg', 'display:none!important'); else if (im.hw) r('.lg-heroimg', 'width:' + im.hw + 'px!important;max-width:90%!important');
    if (im.lh) r('.lg-brand img', 'display:none!important'); else if (im.lw) r('.lg-brand img', 'width:' + im.lw + 'px!important;height:' + im.lw + 'px!important');
    return o.join('\n');
  }
  function styleEl(id){ var el = document.getElementById(id); if (!el){ el = document.createElement('style'); el.id = id; document.head.appendChild(el); } return el; }

  /* ---------- texts + pictures (root = the real #login, or the preview copy) ---------- */
  function firstText(el){ for (var i = 0; i < el.childNodes.length; i++){ var n = el.childNodes[i]; if (n.nodeType === 3 && n.nodeValue.trim()) return n; } return null; }
  function setText(root, c, im, isPrev){
    var setup = false; try { setup = !!S.setup; } catch (x) {}
    E.forEach(function(e){
      var v = c.el[e.id], t = v && v.t;
      $$(e.sel, root).forEach(function(el){
        if (e.attr){
          if (el.dataset.lc0 == null) el.dataset.lc0 = el.getAttribute(e.attr) || '';
          el.setAttribute(e.attr, t || el.dataset.lc0); return;
        }
        if (e.tn){
          var tn = firstText(el); if (!tn) return;
          if (el.dataset.lc0 == null) el.dataset.lc0 = tn.nodeValue;
          tn.nodeValue = t ? (e.tn === 'l' ? ' ' + t : t + ' ') : el.dataset.lc0; return;
        }
        if (e.tx === 0) return;
        if (e.dyn){ if (t && !setup) el.textContent = t; return; }          // the app rewrites these itself; a custom text wins except while creating the very first login
        if (el.dataset.lc0 == null) el.dataset.lc0 = el.textContent;
        el.textContent = t || el.dataset.lc0;
      });
    });
    var ul = $('.lg-chips', root);
    if (ul){ ul.textContent = ''; (c.chips && c.chips.length ? c.chips : DEF_CHIPS).forEach(function(x){ var li = document.createElement('li'); li.textContent = x; ul.appendChild(li); }); }
    var hi = $('.lg-heroimg', root); if (hi){ var hs = okImg(im.hero) ? im.hero : 'logo.png'; if (hi.getAttribute('src') !== hs) hi.src = hs; }
    $$('.lg-brand img', root).forEach(function(l){ var ls = okImg(im.logo) ? im.logo : 'logo-sm.png'; if (l.getAttribute('src') !== ls) l.src = ls; });
  }
  function applyReal(){
    var root = $('#login'); if (!root) return;
    styleEl('lcReal').textContent = css(CFG, '#login');
    setText(root, CFG, IM);
  }

  /* ---------- sync with the server (called by app.js after the public "status" call) ---------- */
  function saveCache(){
    try { localStorage.setItem(LS_C, JSON.stringify(CFG)); } catch (e) {}
    try { localStorage.setItem(LS_I, JSON.stringify(IM)); } catch (e) {}
  }
  window.lcSync = function(st){
    var j = null; try { j = st && st.loginCfg ? JSON.parse(st.loginCfg) : null; } catch (e) {}
    CFG = norm(j); var v = String((st && st.loginImgv) || '');
    if (!v){ IM = { v:'', hero:'', logo:'' }; }
    saveCache(); applyReal();
    if (v && v !== IM.v && typeof callServer === 'function'){
      callServer({ action:'loginImgs' }).then(function(r){
        if (!r || !r.ok) return;
        IM = { v:v, hero:okImg(r.hero) ? r.hero : '', logo:okImg(r.logo) ? r.logo : '' };
        saveCache(); applyReal();
      }).catch(function(){});
    }
  };

  /* every time the app shows the sign-in screen (start, log out, session ended) the design is applied again */
  if (typeof window.showLogin === 'function'){
    var origShow = window.showLogin;
    window.showLogin = function(){ var r = origShow.apply(this, arguments); try { applyReal(); } catch (e) {} return r; };
  }
  applyReal();
  if (window.__lcSt) window.lcSync(window.__lcSt);

  /* =====================================================================
     SETTINGS CARD
     ===================================================================== */
  function elRow(e){
    var v = D.el[e.id] || {};
    var h = '<div class="lc-el" data-id="' + e.id + '"><div class="th-lbl"><span>' + e.l + '</span>' +
      (e.nohide || e.st === 0 ? '' : '<label class="lc-hide"><input type="checkbox" data-lc="h"' + (v.h ? ' checked' : '') + '> Hide</label>') + '</div>';
    if (e.tx !== 0) h += '<input class="input" data-lc="t" maxlength="' + (e.id === 'nt' ? 120 : 60) + '" value="' + esc(v.t || '') + '" placeholder="' + esc(e.d) + '">';
    if (e.st !== 0){
      var sz = v.s || e.px, lo = Math.max(6, Math.round(e.px * .5)), hi = Math.round(e.px * 2.4);
      h += '<div class="lc-ctl"><label class="th-col"><input type="color" data-lc="c" value="' + (v.c || e.dc) + '"><span>Colour</span></label>' +
        '<div class="lc-sz"><input type="range" data-lc="s" min="' + lo + '" max="' + hi + '" step="0.5" value="' + sz + '"><b>' + sz + 'px</b></div>' +
        '<button type="button" class="btn ghost sm lc-b' + (v.b === 1 ? ' on' : v.b === 2 ? ' off' : '') + '" data-lc="b" title="Bold / normal / default">B</button>' +
        '<button type="button" class="linkbtn" data-lc="rst">Reset</button></div>';
    }
    return h + '</div>';
  }
  function col(k, l, dc){ return '<label class="th-col"><input type="color" data-lcc="' + k + '" value="' + (D.col[k] || dc) + '"><span>' + l + '</span></label>'; }
  function imgBox(k, title, src, def, hideKey, wKey, wLo, wHi, wDef){
    var hid = D.im[hideKey], w = D.im[wKey] || wDef;
    return '<div class="lc-img"><div class="th-lbl"><span>' + title + '</span><label class="lc-hide"><input type="checkbox" data-lci="' + k + '-hide"' + (hid ? ' checked' : '') + '> Hide</label></div>' +
      '<img id="lcImg_' + k + '" src="' + (okImg(src) ? src : def) + '" alt="">' +
      '<div class="lc-btns"><button type="button" class="btn sm" data-lci="' + k + '-up">📷 Change picture</button><button type="button" class="btn ghost sm" data-lci="' + k + '-df">↺ Original</button></div>' +
      '<input type="file" accept="image/*" class="hidden" id="lcFile_' + k + '">' +
      '<div class="th-lbl" style="margin-top:10px"><span>Picture size</span></div><div class="lc-sz"><input type="range" data-lcn="' + wKey + '" min="' + wLo + '" max="' + wHi + '" value="' + w + '"><b>' + w + 'px</b></div></div>';
  }
  function curImg(k){ return PI[k] !== undefined ? PI[k] : IM[k]; }
  function cardHtml(){
    var hero = E.filter(function(e){ return e.g === 'hero'; }), card = E.filter(function(e){ return e.g === 'card'; });
    var rad = D.n.rad !== undefined ? D.n.rad : 24, cw = D.n.cw || 420;
    return '<div class="card" id="lcCard" style="grid-column:1/-1"><h3>🔑 Login page <button type="button" class="btn ghost sm" data-lca="reset">↺ Reset all</button></h3>' +
      '<p class="th-note">Change every picture, text, size and colour of the sign-in screen. The preview updates as you type; tap <b>Save</b> to publish it for all users.</p>' +
      '<div class="lc-prev"><div class="lc-pbar"><div class="seg" data-lcseg><button type="button" data-lcp="desk" class="on">🖥 Computer</button><button type="button" data-lcp="phone">📱 Phone</button></div>' +
      '<button type="button" class="btn ghost sm" data-lca="full">🔍 Full preview</button></div><div class="lc-pbox" id="lcPrevBox"></div></div>' +

      '<details class="regbox th-grp" open><summary>🖼 Pictures</summary><div class="lc-imgs">' +
        imgBox('hero', 'Big picture (left side)', curImg('hero'), 'logo.png', 'hh', 'hw', 60, 560, 320) +
        imgBox('logo', 'Small logo (on the card)', curImg('logo'), 'logo-sm.png', 'lh', 'lw', 20, 140, 46) + '</div>' +
        '<div class="th-note" style="margin-top:8px">Pictures are shrunk automatically so the sign-in screen stays fast.</div></details>' +

      '<details class="regbox th-grp"><summary>⬅️ Left side texts</summary>' + hero.map(elRow).join('') +
        '<div class="lc-el"><div class="th-lbl"><span>Feature chips – one per line</span></div><textarea class="input" data-lcchips maxlength="400" placeholder="' + esc(DEF_CHIPS.join('\n')) + '">' + esc((D.chips || []).join('\n')) + '</textarea>' +
        '<div class="th-note" style="margin:0">Empty = the original four chips. Up to 10 lines.</div></div></details>' +

      '<details class="regbox th-grp"><summary>🔤 Card texts, buttons &amp; “Ask your admin”</summary>' + card.map(elRow).join('') + '</details>' +

      '<details class="regbox th-grp"><summary>🎨 Colours, font &amp; shape</summary>' +
        '<div class="th-lbl"><span>Colours</span><button type="button" class="linkbtn" data-lca="rescol">Reset colours</button></div><div class="th-cols">' + COLS.map(function(c){ return col(c[0], c[1], c[2]); }).join('') + '</div>' +
        '<div class="th-row" style="margin-top:12px"><div class="th-lbl"><span>Font style (whole page)</span></div><div class="seg" data-lcfont>' + FONTS.map(function(f){ return '<button type="button" data-val="' + f[0] + '" class="' + ((D.font || '') === f[0] ? 'on' : '') + '">' + f[1] + '</button>'; }).join('') + '</div></div>' +
        '<div class="th-row"><div class="th-lbl"><span>Card corners</span></div><div class="lc-sz"><input type="range" data-lcn="rad" min="0" max="48" value="' + rad + '"><b>' + rad + 'px</b></div></div>' +
        '<div class="th-row"><div class="th-lbl"><span>Card width</span></div><div class="lc-sz"><input type="range" data-lcn="cw" min="300" max="640" value="' + cw + '"><b>' + cw + 'px</b></div></div></details>' +

      '<div class="lc-save"><button type="button" class="btn" data-lca="save">💾 Save login page</button></div></div>';
  }
  var isAdm = function(){ try { return !!isAdmin(); } catch (e) { return false; } };
  window.lcCard = function(){ if (!isAdm()) return ''; D = clone(CFG); PI = {}; return cardHtml(); };

  /* ---------- live preview ---------- */
  function buildPrev(){
    var box = $('#lcPrevBox'), src = $('#login'); if (!box || !src) return;
    var wrap = $('#lcPrevWrap');
    var W = prevMode === 'desk' ? 1000 : 390, H = prevMode === 'desk' ? 600 : 740;
    if (!wrap){
      wrap = document.createElement('div'); wrap.id = 'lcPrevWrap';
      var cl = src.cloneNode(true); cl.classList.remove('hidden');
      $$('input,button,textarea', cl).forEach(function(x){ x.disabled = true; x.removeAttribute('name'); x.setAttribute('autocomplete', 'off'); });
      wrap.appendChild(cl); box.appendChild(wrap);
    }
    wrap.className = prevMode; wrap.style.width = W + 'px'; wrap.style.height = H + 'px';
    var bw = box.clientWidth || 320, k = Math.min(1, bw / W, 230 / H);       // small on purpose: it stays pinned while you scroll the options
    wrap.style.transform = 'scale(' + k + ')'; wrap.style.left = Math.max(0, Math.round((bw - W * k) / 2)) + 'px';
    box.style.height = Math.round(H * k) + 'px';
    var im = { hero:curImg('hero'), logo:curImg('logo') };
    stylePrev = styleEl('lcPrev'); stylePrev.textContent = css(D, '#lcPrevWrap #login');
    setText(wrap, D, im, true);
    var loginF = $('#lcPrevWrap #loginForm'); if (loginF) loginF.classList.remove('hidden');
    var rf = $('#lcPrevWrap #resetForm'); if (rf) rf.classList.add('hidden');
  }
  function refresh(){ clearTimeout(prevT); prevT = setTimeout(buildPrev, 50); }
  window.lcBind = function(){
    if (!$('#lcCard')) return;
    prevMode = window.innerWidth < 700 ? 'phone' : 'desk';
    $$('[data-lcp]').forEach(function(b){ b.classList.toggle('on', b.dataset.lcp === prevMode); });
    buildPrev();
  };

  /* ---------- editing ---------- */
  function elOf(t){ var r = t.closest && t.closest('.lc-el'); return r ? E.filter(function(e){ return e.id === r.dataset.id; })[0] : null; }
  function setEl(id, key, val){
    var v = D.el[id] || (D.el[id] = {});
    if (val === '' || val === undefined || val === null || val === false) delete v[key]; else v[key] = val;
    if (!Object.keys(v).length) delete D.el[id];
  }
  document.addEventListener('input', function(ev){
    var t = ev.target; if (!t || !t.closest || !t.closest('#lcCard')) return;
    var e = t.dataset.lc && elOf(t);
    if (e){
      if (t.dataset.lc === 't') setEl(e.id, 't', t.value.trim() ? t.value : '');
      else if (t.dataset.lc === 'c') setEl(e.id, 'c', t.value);
      else if (t.dataset.lc === 's'){ var s = +t.value; setEl(e.id, 's', s === e.px ? '' : s); t.parentNode.querySelector('b').textContent = s + 'px'; }
    } else if (t.dataset.lcc) D.col[t.dataset.lcc] = t.value;
    else if (t.dataset.lcn){
      var k = t.dataset.lcn, n = +t.value; t.parentNode.querySelector('b').textContent = n + 'px';
      if (k === 'rad' || k === 'cw') D.n[k] = n; else D.im[k] = n;
    } else if (t.hasAttribute('data-lcchips')){ var l = t.value.split('\n').map(function(x){ return x.trim().slice(0, 40); }).filter(Boolean).slice(0, 10); D.chips = l.length ? l : null; }
    else return;
    refresh();
  });
  document.addEventListener('change', function(ev){
    var t = ev.target; if (!t || !t.closest || !t.closest('#lcCard')) return;
    if (t.dataset.lc === 'h'){ var e = elOf(t); if (e){ setEl(e.id, 'h', t.checked ? 1 : ''); refresh(); } }
    else if (t.dataset.lci && /-hide$/.test(t.dataset.lci)){ var key = t.dataset.lci === 'hero-hide' ? 'hh' : 'lh'; if (t.checked) D.im[key] = 1; else delete D.im[key]; refresh(); }
    else if (t.id === 'lcFile_hero' || t.id === 'lcFile_logo'){ var f = t.files && t.files[0]; t.value = ''; if (f) pickImg(t.id === 'lcFile_hero' ? 'hero' : 'logo', f); }
  });

  /* shrink a chosen picture so it fits the server limit; keeps transparency when the phone can encode WebP */
  function shrink(file, max, limit){
    return new Promise(function(res, rej){
      var url = URL.createObjectURL(file), im = new Image();
      im.onerror = function(){ URL.revokeObjectURL(url); rej(new Error('This file is not a picture.')); };
      im.onload = function(){
        URL.revokeObjectURL(url);
        var steps = [1, .8, .64, .5, .4, .3];
        for (var i = 0; i < steps.length; i++){
          var m = Math.round(max * steps[i]), k = Math.min(1, m / Math.max(im.naturalWidth, im.naturalHeight));
          var cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(im.naturalWidth * k)); cv.height = Math.max(1, Math.round(im.naturalHeight * k));
          cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
          var tries = [['image/webp', .85], ['image/webp', .65], ['image/png'], ['image/jpeg', .8], ['image/jpeg', .6]];
          for (var j = 0; j < tries.length; j++){
            var out = cv.toDataURL(tries[j][0], tries[j][1]);
            if (out.indexOf('data:' + tries[j][0]) === 0 && out.length <= limit && okImg(out)) return res(out);
          }
        }
        rej(new Error('Could not shrink this picture enough. Try a simpler one.'));
      };
      im.src = url;
    });
  }
  function pickImg(k, file){
    shrink(file, k === 'hero' ? 560 : 160, 46000).then(function(d){
      PI[k] = d; var img = $('#lcImg_' + k); if (img) img.src = d; refresh();
    }).catch(function(e){ toast(e.message, true); });
  }

  document.addEventListener('click', function(ev){
    var b = ev.target.closest && ev.target.closest('#lcCard button'); if (!b) return;
    var c = b.closest('#lcCard'); if (!c) return;
    if (b.dataset.lc){
      var e = elOf(b); if (!e) return;
      if (b.dataset.lc === 'b'){ var cur = (D.el[e.id] || {}).b || 0; setEl(e.id, 'b', cur === 0 ? 1 : cur === 1 ? 2 : ''); }
      else if (b.dataset.lc === 'rst') delete D.el[e.id];
      var row = b.closest('.lc-el'); var tmp = document.createElement('div'); tmp.innerHTML = elRow(e); row.replaceWith(tmp.firstChild);
      refresh(); return;
    }
    if (b.dataset.lcp){ prevMode = b.dataset.lcp; $$('[data-lcp]').forEach(function(x){ x.classList.toggle('on', x === b); }); buildPrev(); return; }
    if (b.parentNode.hasAttribute('data-lcfont')){ D.font = b.dataset.val || ''; $$('button', b.parentNode).forEach(function(x){ x.classList.toggle('on', x === b); }); refresh(); return; }
    if (b.dataset.lci){
      var m = b.dataset.lci.split('-'), k = m[0], act = m[1];
      if (act === 'up'){ var f = $('#lcFile_' + k); if (f) f.click(); }
      else if (act === 'df'){ PI[k] = ''; var img = $('#lcImg_' + k); if (img) img.src = k === 'hero' ? 'logo.png' : 'logo-sm.png'; refresh(); }
      return;
    }
    var a = b.dataset.lca; if (!a) return;
    if (a === 'rescol'){ D.col = {}; $$('[data-lcc]').forEach(function(x){ var d = COLS.filter(function(q){ return q[0] === x.dataset.lcc; })[0]; if (d) x.value = d[2]; }); refresh(); }
    else if (a === 'full') fullPrev();
    else if (a === 'save') save(b);
    else if (a === 'reset'){
      confirmBox('Reset the login page?', 'Every picture, text, size and colour of the sign-in screen goes back to the original design for all users.', 'Reset', true).then(function(ok){
        if (!ok) return; D = norm(null); PI = { hero:'', logo:'' }; save(null, true);
      });
    }
  });

  function fullPrev(){
    var w = openModal('<h3>Login page preview</h3><div class="lc-pbox" id="lcFullBox" style="margin:10px 0"></div><div style="text-align:right"><button class="btn" type="button" data-x>Close</button></div>');
    var box = w.querySelector('#lcFullBox'), src = $('#login'); if (!box || !src) return;
    var W = 390, H = 740, wrap = document.createElement('div'); wrap.id = 'lcPrevWrap'; wrap.className = 'phone';
    var cl = src.cloneNode(true); cl.classList.remove('hidden');
    $$('input,button,textarea', cl).forEach(function(x){ x.disabled = true; x.removeAttribute('name'); });
    wrap.appendChild(cl); box.appendChild(wrap);
    wrap.style.width = W + 'px'; wrap.style.height = H + 'px';
    var k = Math.min(1, ((box.clientWidth || 320)) / W); wrap.style.transform = 'scale(' + k + ')'; box.style.height = Math.round(H * k) + 'px';
    setText(wrap, D, { hero:curImg('hero'), logo:curImg('logo') }, true);
    var rf = wrap.querySelector('#resetForm'); if (rf) rf.classList.add('hidden');
    var x = w.querySelector('[data-x]'); if (x) x.onclick = function(){ w.remove(); };
  }

  function save(btn, silent){
    var body = { cfg:JSON.stringify(D) };
    if (PI.hero !== undefined) body.hero = PI.hero;
    if (PI.logo !== undefined) body.logo = PI.logo;
    if (btn){ btn.disabled = true; btn.textContent = 'Saving…'; }
    api('saveLoginCfg', body).then(function(r){
      CFG = norm(D);
      if (PI.hero !== undefined) IM.hero = PI.hero; if (PI.logo !== undefined) IM.logo = PI.logo;
      IM.v = String(r.loginImgv || IM.v); PI = {};
      saveCache(); applyReal();
      toast(silent ? 'Login page reset to the original design' : 'Login page saved');
      if (silent && typeof render === 'function') render();
      else if (btn){ btn.disabled = false; btn.textContent = '💾 Save login page'; }
    }).catch(function(e){
      if (btn){ btn.disabled = false; btn.textContent = '💾 Save login page'; }
      if (typeof handleErr === 'function') handleErr(e); else toast(e.message, true);
    });
  }
})();
