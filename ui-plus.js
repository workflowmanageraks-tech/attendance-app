/* KS · UI polish layer: animations, skeletons, count-up, ripple, bottom tab bar, floating + button, table search.
   Pure add-on: it only watches the page; app.js logic is untouched. Respects "Animations: Off" and reduced-motion. */
(function(){
  'use strict';
  var $ = function(s, r){ return (r || document).querySelector(s); };
  var $$ = function(s, r){ return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var still = function(){
    return (document.body && document.body.dataset.motion === 'off') ||
      (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  };
  var view = $('#view'); if (!view) return;

  /* ---------- 1. page entrance: stagger + count-up + skeleton swap + table search ---------- */
  var lastKey = '';
  function viewKey(){ try { return (S.view || '') + '|' + (S.setSec || '') + '|' + (S.as || ''); } catch (e) { return ''; } }

  function countUp(el){
    if (el.children.length || el.dataset.cu) return;
    var m = /^([^\d\-]*)(-?[\d,]+(?:\.\d+)?)(.*)$/.exec(el.textContent.trim());
    if (!m) return;
    var end = parseFloat(m[2].replace(/,/g, '')); if (!isFinite(end) || end === 0) return;
    var dec = (m[2].split('.')[1] || '').length, t0 = performance.now(), dur = 750;
    el.dataset.cu = '1';
    (function tick(now){
      var p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3), v = end * e;
      el.textContent = m[1] + v.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + m[3];
      if (p < 1) requestAnimationFrame(tick);
    })(t0);
  }

  function skeletons(){
    $$('.empty-state', view).forEach(function(e){
      if (/^\s*Loading/i.test(e.textContent) && !e.children.length){
        e.className = 'skel-box'; e.innerHTML = '<i class="skel w60"></i><i class="skel"></i><i class="skel w80"></i><i class="skel w40"></i>';
      }
    });
  }

  function tableSearch(){
    $$('.tbl-wrap', view).forEach(function(w){
      if (w.dataset.qs || w.closest('.chat')) return;
      var rows = $$('tbody tr', w); if (rows.length < 7) return;
      w.dataset.qs = '1';
      var box = document.createElement('div'); box.className = 'tbl-q';
      box.innerHTML = '<span aria-hidden="true">🔍</span><input type="search" class="input" placeholder="Search in this table…" autocomplete="off">';
      w.parentNode.insertBefore(box, w);
      var inp = box.querySelector('input');
      inp.addEventListener('input', function(){
        var q = inp.value.trim().toLowerCase();
        rows.forEach(function(r){ r.classList.toggle('q-off', !!q && r.textContent.toLowerCase().indexOf(q) < 0); });
      });
    });
  }

  function enhance(animate){
    skeletons(); tableSearch();
    if (!animate || still()) return;
    var i = 0;
    $$('.card, .set-tile, .set-grp, .emp-item, .th-mi, .loglist > *', view).forEach(function(c){
      if (c.closest('.chat')) return;
      c.style.setProperty('--i', Math.min(i++, 14));
      c.classList.add('rv');
    });
    $$('.kpi .val', view).forEach(countUp);
  }

  new MutationObserver(function(){
    var k = viewKey(), changed = k !== lastKey; lastKey = k;
    if (changed && !still()){ view.classList.remove('vw-in'); void view.offsetWidth; view.classList.add('vw-in'); }
    enhance(changed);
  }).observe(view, { childList: true });

  /* ---------- 2. ripple on every button + loading spinner while the server works ---------- */
  var lastBtn = null;
  document.addEventListener('pointerdown', function(e){
    var b = e.target.closest && e.target.closest('.btn, .set-tile, .nav button, #btabs button, .fab');
    if (!b) return;
    lastBtn = b.classList.contains('btn') ? b : lastBtn;
    if (still()) return;
    var r = b.getBoundingClientRect(), s = Math.max(r.width, r.height) * 2, d = document.createElement('span');
    d.className = 'rip'; d.style.cssText = 'width:' + s + 'px;height:' + s + 'px;left:' + (e.clientX - r.left - s / 2) + 'px;top:' + (e.clientY - r.top - s / 2) + 'px';
    b.classList.add('rip-host'); b.appendChild(d);
    setTimeout(function(){ d.remove(); }, 650);
  }, { passive: true });

  var bar = $('#bar');
  if (bar) new MutationObserver(function(){
    var on = bar.classList.contains('on');
    document.body.classList.toggle('is-busy', on);
    if (on && lastBtn && lastBtn.isConnected && !lastBtn.classList.contains('ghost')){ lastBtn.classList.add('is-loading'); lastBtn._ld = true; }
    else if (!on) $$('.is-loading').forEach(function(x){ x.classList.remove('is-loading'); });
  }).observe(bar, { attributes: true, attributeFilter: ['class'] });

  /* ---------- 3. phone bottom tab bar ---------- */
  var app = $('#app'), nav = $('#nav'), tabs = null;
  var TAB_ORDER = ['dashboard', 'attendance', 'chat', 'expenses'];
  function buildTabs(){
    if (!app || !nav) return;
    if (!tabs){ tabs = document.createElement('nav'); tabs.id = 'btabs'; tabs.setAttribute('aria-label', 'Quick menu'); app.appendChild(tabs);
      tabs.addEventListener('click', function(e){
        var b = e.target.closest('button'); if (!b) return;
        if (b.dataset.more){ if (typeof setMenu === 'function') setMenu(true); return; }
        if (typeof go === 'function') go(b.dataset.v);
      }); }
    var html = '', n = 0;
    TAB_ORDER.forEach(function(v){
      var s = nav.querySelector('[data-v="' + v + '"]');
      if (!s || s.classList.contains('hidden') || s.classList.contains('th-off') || n > 3) return;
      var ic = s.querySelector('.ico'), lab = (ic && ic.nextSibling && ic.nextSibling.nodeValue || '').trim() || v;
      html += '<button type="button" data-v="' + v + '"><span class="bt-i">' + (ic ? ic.textContent : '•') + '</span><span class="bt-l">' + lab.replace(/</g, '&lt;') + '</span>' +
        (v === 'chat' ? '<span class="bt-b hidden" id="btBadge">0</span>' : '') + '</button>'; n++;
    });
    html += '<button type="button" data-more="1"><span class="bt-i">☰</span><span class="bt-l">More</span></button>';
    if (tabs.dataset.sig !== html){ tabs.innerHTML = html; tabs.dataset.sig = html; }
    var cur = (typeof S !== 'undefined' && S.view) || '';
    $$('button[data-v]', tabs).forEach(function(b){ b.classList.toggle('on', b.dataset.v === cur); });
    var cb = $('#chatBadge'), tb = $('#btBadge');
    if (cb && tb){ tb.textContent = cb.textContent; tb.classList.toggle('hidden', cb.classList.contains('hidden')); }
  }
  if (nav){
    var t1 = 0, again = function(){ cancelAnimationFrame(t1); t1 = requestAnimationFrame(buildTabs); };
    new MutationObserver(again).observe(nav, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'], characterData: true });
    new MutationObserver(again).observe(app, { attributes: true, attributeFilter: ['class'] });
    buildTabs();
  }

  /* ---------- 4. floating "+" button (uses the page's own main Add button) ---------- */
  var fab = document.createElement('button'); fab.type = 'button'; fab.className = 'fab hidden'; fab.setAttribute('aria-label', 'Add'); fab.textContent = '＋';
  document.body.appendChild(fab);
  var addBtn = null;
  fab.addEventListener('click', function(){ if (addBtn && addBtn.isConnected) addBtn.click(); });
  function findAdd(){
    addBtn = null;
    var v = (typeof S !== 'undefined' && S.view) || '';
    if (v && v !== 'settings' && v !== 'chat' && v !== 'dashboard'){
      $$('.btn[onclick]', view).some(function(b){
        if (b.classList.contains('ghost') || b.classList.contains('soft') || b.classList.contains('sm') || b.closest('.modal')) return false;
        if (/^\s*[＋+]/.test(b.textContent) && /^\w+\(\)$/.test(b.getAttribute('onclick').trim())){ addBtn = b; return true; }
        return false;
      });
    }
    fab.classList.toggle('hidden', !addBtn);
  }
  new MutationObserver(findAdd).observe(view, { childList: true });
})();
