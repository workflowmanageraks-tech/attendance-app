/* AKS_VCS · Extras
   1) Back: swipe in from the left or right edge (and the phone's Back button) goes one step back.
   2) Call reactions: send ❤️ 😊 😢 😘 😂 🎉 during a voice / video call - the animation plays on both phones (peer-to-peer, no server).
   3) Admin online / offline pop-ups: a card appears anywhere in the app when a user comes online or goes offline.
   4) "Smart options" settings card (compact view, swipe back, reactions, alerts). Saved on this phone. */
(function(){
  'use strict';
  var $ = function(s, r){ return (r || document).querySelector(s); };
  var LS = 'ks_opt_v1';
  var DEF = { compact:1, swipe:1, fx:1, pa:1, pon:1, poff:1, psnd:1, pvib:1 };
  function opts(){ var o = {}; try { o = JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) {} return Object.assign({}, DEF, o); }
  function setOpt(k, v){ var o = opts(); o[k] = v ? 1 : 0; try { localStorage.setItem(LS, JSON.stringify(o)); } catch (e) {} applyOpts(); }
  function applyOpts(){ document.documentElement.classList.toggle('ks-compact', !!opts().compact); }
  applyOpts();
  var still = function(){ return (document.body && document.body.dataset.motion === 'off') || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); };
  var esc = function(t){ return String(t == null ? '' : t).replace(/[&<>"']/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]; }); };
  var appVisible = function(){ var a = $('#app'); return !!a && !a.classList.contains('hidden'); };
  var note = function(m, bad){ try { toast(m, bad); } catch (e) {} };

  /* =====================================================================
     1) BACK  (swipe from an edge + the phone's Back button)
     ===================================================================== */
  var stack = [], backing = false;
  if (typeof window.go === 'function'){
    var origGo = window.go;
    window.go = function(v){
      var cur = null; try { cur = S.view; } catch (e) {}
      if (!backing && cur && v !== cur){ stack.push(cur); if (stack.length > 20) stack.shift(); }
      return origGo.apply(this, arguments);
    };
  }
  function goBack(v){ backing = true; try { window.go(v); } finally { backing = false; } }

  /* returns true when it closed / went back one step, false when there is nothing left to go back to */
  window.ksBack = function(){
    if (!opts().swipe) return false;
    var ov = document.querySelectorAll('.overlay');
    if (ov.length){ var top = ov[ov.length - 1], no = top.querySelector('[data-no],[data-x]'); if (no) no.click(); else top.remove(); return true; }
    if (document.body.classList.contains('menu-open')){ setMenu(false); return true; }
    var qa = $('#qaSheet'); if (qa && !qa.classList.contains('hidden')){ qa.click(); return true; }
    if ($('#ksTray.show')){ fx.tray(false); return true; }
    if ($('#ludo')){ note('Use the ✕ button to leave the game'); return true; }
    var vc = $('#vcUI');
    if (vc && !vc.classList.contains('hidden')){
      if (!vc.classList.contains('vc-mini') && typeof vcMini === 'function'){
        if (typeof VC !== 'undefined' && VC.incoming && !VC.busy){ note('Accept or decline the call first'); return true; }
        vcMini(true); return true;                                   // call -> small window + chat
      }
    }
    var st = null; try { st = S; } catch (e) {}
    if (!st) return false;
    if (st.view === 'chat' && st.chat && st.chat.with && typeof chatBack === 'function'){ chatBack(); return true; }
    if (st.view === 'settings' && st.setSec && typeof setBack === 'function'){ setBack(); return true; }
    while (stack.length){ var v = stack.pop(); if (v && v !== st.view){ goBack(v); return true; } }
    if (st.view !== 'dashboard'){ goBack('dashboard'); return true; }
    return false;
  };

  /* little arrow that follows the finger while you swipe in from an edge */
  (function swipeHint(){
    var el = document.createElement('div'); el.id = 'ksSwipe'; el.innerHTML = '<span>‹</span>'; document.body.appendChild(el);
    var s = null;
    document.addEventListener('touchstart', function(e){
      var t = e.touches[0], W = window.innerWidth;
      if (!opts().swipe || !appVisible() || e.touches.length > 1){ s = null; return; }
      s = t.clientX < 28 ? 'L' : t.clientX > W - 28 ? 'R' : null;
      if (s){ s = { side:s, x:t.clientX }; el.className = s.side === 'L' ? 'l' : 'r'; }
    }, { passive:true });
    document.addEventListener('touchmove', function(e){
      if (!s) return;
      var d = Math.max(0, (e.touches[0].clientX - s.x) * (s.side === 'L' ? 1 : -1));
      if (d < 10){ el.classList.remove('on'); return; }
      el.classList.toggle('go', d > 70); el.classList.add('on');
      el.style.setProperty('--d', Math.min(d, 90) + 'px');
    }, { passive:true });
    var end = function(){ s = null; el.classList.remove('on', 'go'); };
    document.addEventListener('touchend', end, { passive:true }); document.addEventListener('touchcancel', end, { passive:true });
  })();

  /* the phone's own Back button / browser back: same behaviour, press twice at the first screen to leave */
  (function hwBack(){
    var armed = false, exitAt = 0;
    function arm(){ if (!armed && appVisible()){ try { history.pushState({ ks:1 }, ''); armed = true; } catch (e) {} } }
    window.addEventListener('popstate', function(){
      if (!armed) return;
      armed = false;
      if (!appVisible() || !opts().swipe) return;
      if (window.ksBack()){ arm(); return; }
      if (Date.now() < exitAt){ exitAt = 0; try { history.back(); } catch (e) {} return; }
      exitAt = Date.now() + 2000; note('Press Back again to exit'); arm();
    });
    var app = $('#app');
    if (app) new MutationObserver(function(){ if (appVisible()) arm(); else { armed = false; stack.length = 0; } }).observe(app, { attributes:true, attributeFilter:['class'] });
    arm();
  })();

  /* =====================================================================
     2) CALL REACTIONS
     ===================================================================== */
  var EMO = [['❤️', 'heart'], ['😊', 'smile'], ['😢', 'cry'], ['😘', 'kiss'], ['😂', 'laugh'], ['🎉', 'party']];
  var KIND = {}; EMO.forEach(function(e){ KIND[e[0]] = e[1]; }); KIND['❤'] = 'heart'; KIND['😍'] = 'heart'; KIND['🥰'] = 'heart'; KIND['😭'] = 'cry'; KIND['🙂'] = 'smile'; KIND['😁'] = 'smile'; KIND['😄'] = 'smile'; KIND['🤣'] = 'laugh'; KIND['💋'] = 'kiss'; KIND['💖'] = 'heart'; KIND['💕'] = 'heart'; KIND['💗'] = 'heart';
  var ch = null, lastSend = 0, live = 0, layer = null;

  function fxLayer(){
    if (layer && layer.isConnected) return layer;
    layer = document.createElement('div'); layer.id = 'ksFx'; document.body.appendChild(layer); return layer;
  }
  var rnd = function(a, b){ return a + Math.random() * (b - a); };
  function spawn(txt, o){
    if (live > 90) return; live++;
    var p = document.createElement('i'); p.className = 'fxp ' + (o.cls || '');
    p.textContent = txt;
    p.style.cssText = '--x:' + (o.x != null ? o.x : rnd(4, 96)) + 'vw;--y:' + (o.y != null ? o.y : 100) + 'vh;--s:' + (o.s || rnd(22, 46)).toFixed(0) + 'px;--d:' + (o.d || rnd(2.4, 4.2)).toFixed(2) + 's;--w:' + (o.w != null ? o.w : rnd(-60, 60)).toFixed(0) + 'px;--r:' + (o.r != null ? o.r : rnd(-25, 25)).toFixed(0) + 'deg;animation-delay:' + (o.delay || 0).toFixed(2) + 's';
    fxLayer().appendChild(p);
    var done = function(){ if (p.isConnected){ p.remove(); live--; } };
    p.addEventListener('animationend', done); setTimeout(done, ((o.d || 4.2) + (o.delay || 0) + 1) * 1000);
  }
  function flash(cls){
    var f = document.createElement('div'); f.className = 'fxflash ' + cls; fxLayer().appendChild(f);
    setTimeout(function(){ f.remove(); }, 1900);
  }
  function big(txt, cls){
    var b = document.createElement('div'); b.className = 'fxbig ' + cls; b.textContent = txt; fxLayer().appendChild(b);
    setTimeout(function(){ b.remove(); }, 1700);
  }
  function tag(who, emo){
    if (!who) return;
    var t = document.createElement('div'); t.className = 'fxtag'; t.textContent = emo + ' ' + who; fxLayer().appendChild(t);
    setTimeout(function(){ t.remove(); }, 2300);
  }
  function tone(kind){
    try {
      if (typeof vcBeep !== 'function') return;
      if (kind === 'heart' || kind === 'kiss'){ vcBeep(784, .1); setTimeout(function(){ vcBeep(1175, .16); }, 110); }
      else if (kind === 'cry'){ vcBeep(392, .2); setTimeout(function(){ vcBeep(294, .3); }, 200); }
      else if (kind === 'party'){ vcBeep(660, .08); setTimeout(function(){ vcBeep(880, .08); }, 90); setTimeout(function(){ vcBeep(1320, .14); }, 180); }
      else vcBeep(988, .1);
    } catch (e) {}
  }
  function play(emo, who){
    var kind = KIND[emo] || 'heart', i;
    if (still()){ big(emo, 'fx-still'); tag(who, emo); return; }
    tag(who, emo); tone(kind);
    if (kind === 'heart'){
      flash('pink'); big('❤️', 'beat');
      for (i = 0; i < 26; i++) spawn(['❤️', '💖', '💕', '💗', '🩷'][i % 5], { cls:'up', delay:i * .07 });
      try { navigator.vibrate && navigator.vibrate([40, 60, 40, 60, 90]); } catch (e) {}
    } else if (kind === 'smile'){
      flash('sun'); big('😊', 'pop');
      for (i = 0; i < 16; i++) spawn(i % 3 ? '😊' : '✨', { cls:'burst', x:rnd(8, 92), y:rnd(18, 82), s:rnd(26, 52), d:rnd(1.4, 2.2), delay:i * .06 });
    } else if (kind === 'cry'){
      flash('rain'); big('😢', 'shake');
      for (i = 0; i < 30; i++) spawn(i % 6 === 0 ? '😢' : '💧', { cls:'down', y:-8, s:rnd(18, 34), d:rnd(1.8, 3.4), delay:i * .08, w:rnd(-18, 18) });
    } else if (kind === 'kiss'){
      flash('pink'); big('😘', 'pop');
      for (i = 0; i < 14; i++) spawn(i % 3 ? '💋' : '❤️', { cls:'kiss', x:rnd(10, 90), y:rnd(55, 90), s:rnd(26, 50), d:rnd(1.6, 2.6), delay:i * .08 });
    } else if (kind === 'laugh'){
      flash('sun'); big('😂', 'shake');
      for (i = 0; i < 18; i++) spawn('😂', { cls:'burst', x:rnd(6, 94), y:rnd(15, 85), s:rnd(24, 48), d:rnd(1.2, 2), delay:i * .05 });
    } else {
      flash('party'); big('🎉', 'pop');
      for (i = 0; i < 22; i++) spawn(['🎉', '🎊', '✨', '⭐'][i % 4], { cls:'down', y:-8, s:rnd(20, 38), d:rnd(2, 3.4), delay:i * .06, w:rnd(-70, 70) });
    }
  }

  function wire(c){
    c.onopen = function(){ if (typeof vcPoke === 'function') vcPoke(); };
    c.onmessage = function(ev){
      try {
        var m = JSON.parse(ev.data); if (!m || m.t !== 'fx' || !KIND[m.e]) return;
        var who = ''; try { who = (VC.peer && VC.peer.name) || ''; } catch (e) {}
        play(m.e, who);
      } catch (e) {}
    };
  }
  var fx = window.ksFx = {
    on: function(){ return !!opts().fx; },
    attach: function(pc){
      ch = null;
      if (!opts().fx) return;
      var role = ''; try { role = VC.role; } catch (e) {}
      if (role === 'caller'){ try { ch = pc.createDataChannel('ks-fx', { ordered:true }); wire(ch); } catch (e) {} }
      else pc.ondatachannel = function(e){ if (e.channel && e.channel.label === 'ks-fx'){ ch = e.channel; wire(ch); } };
    },
    detach: function(){ ch = null; fx.tray(false); var l = $('#ksFx'); if (l) l.innerHTML = ''; live = 0; },
    send: function(emo){
      if (!KIND[emo]) return;
      var now = Date.now(); if (now - lastSend < 220) return; lastSend = now;
      play(emo, '');                                                         // I see it too
      if (ch && ch.readyState === 'open'){ try { ch.send(JSON.stringify({ t:'fx', e:emo })); } catch (e) {} }
      else note('Reaction shown here · the other phone connects in a moment');
    },
    chatHook: function(text){                                                // typing just ❤️ / 😊 / 😢 in the chat while on a call
      try {
        if (!opts().fx || !VC.started || !ch) return;
        var s = String(text).replace(/\uFE0F/g, '').replace(/\s+/g, '');
        var u = Array.from(s); if (!u.length || u.length > 6) return;
        var first = u[0]; if (!KIND[first] && !KIND[first + '\uFE0F']) return;
        if (u.every(function(x){ return x === first; })) fx.send(KIND[first] ? first : first + '\uFE0F');
      } catch (e) {}
    },
    tray: function(force){
      var vc = $('#vcUI'); if (!vc) return;
      var t = $('#ksTray');
      if (!t){
        t = document.createElement('div'); t.id = 'ksTray';
        t.innerHTML = EMO.map(function(e){ return '<button type="button" data-e="' + e[0] + '" aria-label="' + e[1] + '">' + e[0] + '</button>'; }).join('');
        t.addEventListener('pointerdown', function(e){ e.stopPropagation(); });
        t.addEventListener('click', function(e){
          var b = e.target.closest('button'); if (!b) return;
          fx.send(b.dataset.e); clearTimeout(t._t); t._t = setTimeout(function(){ fx.tray(false); }, 6000);
        });
        vc.appendChild(t);
      } else if (t.parentNode !== vc) vc.appendChild(t);
      var on = force === undefined ? !t.classList.contains('show') : !!force;
      t.classList.toggle('show', on); clearTimeout(t._t);
      if (on) t._t = setTimeout(function(){ fx.tray(false); }, 6000);
    }
  };

  /* double-tap anywhere on the full-screen call = a big ❤️ */
  (function dbl(){
    var last = { t:0, x:0, y:0 };
    document.addEventListener('pointerup', function(e){
      var vc = $('#vcUI'); if (!vc || vc.classList.contains('hidden') || vc.classList.contains('vc-mini') || !opts().fx) return;
      if (typeof VC === 'undefined' || !VC.started) return;
      if (!vc.contains(e.target) || e.target.closest('.vc-bar,.vc-btn,.vc-minbtn,#ksTray,.vc-pop')) return;
      var n = Date.now();
      if (n - last.t < 320 && Math.abs(e.clientX - last.x) < 50 && Math.abs(e.clientY - last.y) < 50){ last.t = 0; fx.send('❤️'); }
      else last = { t:n, x:e.clientX, y:e.clientY };
    }, true);
  })();

  /* =====================================================================
     3) ADMIN: online / offline pop-ups (works on every screen of the app)
     ===================================================================== */
  var pres = { map:null, busy:false, timer:null };
  var isAdminNow = function(){ try { return !!(S.me && S.me.role === 'admin'); } catch (e) { return false; } };
  function popHost(){
    var h = $('#ksPres'); if (!h){ h = document.createElement('div'); h.id = 'ksPres'; document.body.appendChild(h); } return h;
  }
  function popAlert(u, on){
    var o = opts(), h = popHost();
    var c = document.createElement('div'); c.className = 'pa ' + (on ? 'on' : 'off');
    var name = u.name || u.username || 'User';
    var img = ''; try { img = (typeof avSrc === 'function' && avSrc(u.id)) || ''; } catch (e) {}
    var col = '#6366f1'; try { col = chColor(u.id || name); } catch (e) {}
    c.innerHTML = '<span class="pa-av" style="background:' + col + '">' + (img ? '<img alt="" src="' + esc(img) + '">' : '') + esc(name.trim().charAt(0).toUpperCase()) + '<i></i></span>' +
      '<span class="pa-tx"><b>' + esc(name) + '</b><small>' + (on ? 'came online' : 'went offline') + '</small></span>' +
      '<span class="pa-st">' + (on ? '🟢 Online' : '⚫ Offline') + '</span><button type="button" class="pa-x" aria-label="Close">✕</button>';
    var close = function(){ c.classList.add('out'); setTimeout(function(){ c.remove(); }, 260); };
    c.querySelector('.pa-x').onclick = function(e){ e.stopPropagation(); close(); };
    c.onclick = function(){ close(); if (u.id === 'test') return; try { if (S.view !== 'chat') go('chat'); if (chatPeer(u.id)) chatOpen(u.id); } catch (e) {} };
    h.appendChild(c); while (h.children.length > 4) h.firstChild.remove();
    setTimeout(close, 5500);
    if (o.psnd) try { if (on){ vcBeep(740, .12); setTimeout(function(){ vcBeep(988, .18); }, 130); } else { vcBeep(520, .14); setTimeout(function(){ vcBeep(392, .2); }, 140); } } catch (e) {}
    if (o.pvib) try { navigator.vibrate && navigator.vibrate(on ? [60, 50, 60] : [120]); } catch (e) {}
  }
  function presCheck(first){
    var o = opts();
    if (!o.pa || !isAdminNow() || !appVisible() || document.hidden || pres.busy) return;
    pres.busy = true;
    chatApi('chatUsers').then(function(r){
      var next = {}, list = r.users || [];
      list.forEach(function(u){ next[u.id] = !!u.online; });
      if (pres.map){
        list.forEach(function(u){
          var was = pres.map[u.id];
          if (was === undefined || was === !!u.online) return;           // new person in the list, or no change
          var oo = opts();
          if (u.online && oo.pon) popAlert(u, true);
          else if (!u.online && oo.poff) popAlert(u, false);
        });
      }
      pres.map = next;
    }).catch(function(e){ try { chatErr(e); } catch (x) {} }).then(function(){ pres.busy = false; });
  }
  function presStart(){
    clearInterval(pres.timer);
    pres.timer = setInterval(presCheck, 8000);
    setTimeout(presCheck, 1500);
  }
  var appEl = $('#app');
  if (appEl) new MutationObserver(function(){ if (appVisible()){ pres.map = null; presStart(); } else { clearInterval(pres.timer); pres.map = null; } }).observe(appEl, { attributes:true, attributeFilter:['class'] });
  document.addEventListener('visibilitychange', function(){ if (!document.hidden){ pres.map = null; setTimeout(presCheck, 800); } });   // coming back: start fresh, no old alerts
  if (appVisible()) presStart();

  /* =====================================================================
     4) SETTINGS CARD
     ===================================================================== */
  function row(k, ico, title, sub, sm){
    return '<label class="ks-opt' + (sm ? ' sm' : '') + '"><span class="ks-oi">' + ico + '</span><span class="ks-ot"><b>' + title + '</b><small>' + sub + '</small></span>' +
      '<input type="checkbox" class="ks-sw" data-ks="' + k + '"' + (opts()[k] ? ' checked' : '') + '></label>';
  }
  window.ksOptCard = function(){
    var adm = isAdminNow();
    return '<div class="card" id="ksOptCard"><h3>✨ Smart options</h3>' +
      '<p class="muted" style="margin-bottom:10px">These switches are saved on this phone.</p>' +
      row('compact', '📱', 'Compact view', 'Smaller spacing and sizes so more fits on the screen') +
      row('swipe', '👈', 'Swipe back', 'Swipe in from the left or right edge to go back (also the Back button)') +
      row('fx', '💞', 'Call reactions', 'During a call send ❤️ 😊 😢 😘 😂 🎉 and both phones play an animation. Double-tap the video for a ❤️') +
      (adm ? '<div class="sec-title" style="margin-top:14px">🔔 Online / offline pop-ups</div>' +
        row('pa', '🔔', 'Show pop-ups', 'A card appears anywhere in the app when a user comes online or goes offline') +
        row('pon', '🟢', 'When someone comes online', 'Show a pop-up', 1) +
        row('poff', '⚫', 'When someone goes offline', 'Shown about a minute after they close the app', 1) +
        row('psnd', '🔊', 'Sound', 'A short tone with the pop-up', 1) +
        row('pvib', '📳', 'Vibrate', 'A short buzz with the pop-up', 1) +
        '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn soft sm" data-ksa="t-on">Test: online</button><button type="button" class="btn soft sm" data-ksa="t-off">Test: offline</button></div>' : '') +
      '</div>';
  };
  document.addEventListener('change', function(e){
    var t = e.target; if (!t || !t.matches || !t.matches('[data-ks]')) return;
    setOpt(t.dataset.ks, t.checked);
    if (t.dataset.ks === 'pa' && t.checked){ pres.map = null; presStart(); }
    if (t.dataset.ks === 'swipe') note(t.checked ? 'Swipe back is on' : 'Swipe back is off');
  });
  document.addEventListener('click', function(e){
    var b = e.target.closest && e.target.closest('[data-ksa]'); if (!b) return;
    var me = ''; try { me = (S.me && (S.me.name || S.me.username)) || 'Test user'; } catch (x) {}
    popAlert({ id:'test', name:me === 'Test user' ? me : 'Test user', username:'test' }, b.dataset.ksa === 't-on');
  });
})();
