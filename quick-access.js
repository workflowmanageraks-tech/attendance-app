/* AKS_VCS · Quick access: ⚡ button with your own shortcuts (any menu section + Refresh). Saved on this phone. */
(function(){
  'use strict';
  var $ = function(s, r){ return (r || document).querySelector(s); };
  var app = $('#app'), nav = $('#nav'); if (!app || !nav) return;
  var key = function(){ try { return 'ks_qa_' + ((S.me && S.me.id) || 'x'); } catch (e) { return 'ks_qa_x'; } };
  var DEF = ['attendance', 'chat', 'expenses'];
  function load(){ try { var a = JSON.parse(localStorage.getItem(key())); if (Array.isArray(a)) return a; } catch (e) {} return DEF.slice(); }
  function save(a){ try { localStorage.setItem(key(), JSON.stringify(a)); } catch (e) {} }
  function all(){
    var out = [];
    [].forEach.call(nav.querySelectorAll('button[data-v]'), function(b){
      if (b.classList.contains('hidden') || b.classList.contains('th-off')) return;
      var ic = b.querySelector('.ico'), lab = ((ic && ic.nextSibling && ic.nextSibling.nodeValue) || b.textContent || '').trim();
      out.push({ id: b.dataset.v, ic: ic ? ic.textContent : '•', lb: lab });
    });
    out.push({ id: '@refresh', ic: '↻', lb: 'Refresh' });
    return out;
  }
  var btn = document.createElement('button'); btn.type = 'button'; btn.id = 'qaBtn'; btn.className = 'hidden'; btn.setAttribute('aria-label', 'Quick access'); btn.textContent = '⚡';
  var sheet = document.createElement('div'); sheet.id = 'qaSheet'; sheet.className = 'hidden';
  document.body.appendChild(btn); document.body.appendChild(sheet);
  var editing = false;
  function esc(t){ return String(t).replace(/[&<>"]/g, function(c){ return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function draw(){
    var items = all(), pins = load(), h;
    if (!editing){
      var tiles = items.filter(function(i){ return pins.indexOf(i.id) > -1; }).sort(function(a, b){ return pins.indexOf(a.id) - pins.indexOf(b.id); });
      h = '<div class="qa-h"><b>⚡ Quick access</b><button type="button" data-e="1">✎ Edit</button></div><div class="qa-g">' +
        (tiles.map(function(i){ return '<button type="button" data-go="' + esc(i.id) + '"><span>' + esc(i.ic) + '</span><small>' + esc(i.lb) + '</small></button>'; }).join('') ||
        '<p class="qa-e">Nothing pinned yet. Tap ✎ Edit and choose your shortcuts.</p>') + '</div>';
    } else {
      h = '<div class="qa-h"><b>Choose shortcuts</b><button type="button" data-e="0">✓ Done</button></div><div class="qa-l">' +
        items.map(function(i){ var on = pins.indexOf(i.id) > -1; return '<label><input type="checkbox" data-pin="' + esc(i.id) + '"' + (on ? ' checked' : '') + '><span>' + esc(i.ic) + '</span>' + esc(i.lb) + '</label>'; }).join('') + '</div>';
    }
    sheet.innerHTML = '<div class="qa-card">' + h + '</div>';
  }
  function open(on){ sheet.classList.toggle('hidden', !on); btn.classList.toggle('on', on); if (on){ editing = false; draw(); } }
  btn.onclick = function(){ open(sheet.classList.contains('hidden')); };
  sheet.addEventListener('click', function(e){
    var t = e.target;
    if (t === sheet){ open(false); return; }
    var ed = t.closest('[data-e]'); if (ed){ editing = ed.dataset.e === '1'; draw(); return; }
    var g = t.closest('[data-go]'); if (g){ var v = g.dataset.go; open(false); if (v === '@refresh'){ var r = $('#refreshBtn'); if (r) r.click(); } else if (typeof go === 'function') go(v); }
  });
  sheet.addEventListener('change', function(e){
    var c = e.target.closest('[data-pin]'); if (!c) return;
    var p = load().filter(function(x){ return x !== c.dataset.pin; }); if (c.checked) p.push(c.dataset.pin); save(p);
  });
  function vis(){ btn.classList.toggle('hidden', app.classList.contains('hidden') || document.body.classList.contains('vc-open')); if (btn.classList.contains('hidden')) open(false); }
  new MutationObserver(vis).observe(app, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(vis).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  vis();
})();
