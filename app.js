// Hamyon: family budget on one phone. Screens are rendered from `db` into #app; data lives in localStorage.
(function () {
  'use strict';

  var E = window.Engine;
  var KEY = 'hamyon-v1';
  var VERSION = '0.1';
  var FALLBACK_RATE = 12000;
  var CBU_URL = 'https://cbu.uz/uz/arkhiv-kursov-valyut/json/USD/';
  var TABS = [['asosiy', 'Asosiy', 'wallet'], ['tahlil', 'Tahlil', 'chart'], ['rejalar', 'Rejalar', 'target'], ['hisoblar', 'Hisoblar', 'list']];
  var KINDS = [['out', 'Xarajat'], ['in', 'Daromad'], ['move', 'Oʻtkazma']];
  var MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
  var MONTHS_SHORT = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyn', 'Iyl', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek'];
  var WD = ['yakshanba', 'dushanba', 'seshanba', 'chorshanba', 'payshanba', 'juma', 'shanba'];

  // ---------- helpers ----------

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function today() { return E.dateKey(Date.now()); }
  function num(v) {
    var x = parseFloat(String(v == null ? '' : v).replace(/[\s ]/g, '').replace(',', '.'));
    return isNaN(x) ? null : x;
  }
  function icon(name, size, w) {
    return '<svg width="' + (size || 22) + '" height="' + (size || 22) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' +
      (w || 2) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + window.ICONS[name] + '"/></svg>';
  }
  function money(minor, ccy, opts) { return E.fmtMoney(minor, ccy, opts); }
  function som(n) { return E.fmtMoney(Math.round(n), 'UZS'); }
  function dayLabel(key) {
    var d = E.keyToDate(key), t = today();
    if (key === t) return 'Bugun';
    if (key === E.addDays(t, -1)) return 'Kecha';
    return d.getDate() + '-' + MONTHS[d.getMonth()] + ', ' + WD[d.getDay()];
  }
  function shortDate(key) { var d = E.keyToDate(key); return d.getDate() + '-' + MONTHS[d.getMonth()]; }
  function monthLabel(month) { return MONTHS[+month.slice(5, 7) - 1].replace(/^./, function (c) { return c.toUpperCase(); }) + ' ' + month.slice(0, 4); }

  // ---------- storage ----------

  function normalize(d) {
    d = d || {};
    var arr = function (x) { return Array.isArray(x) ? x : []; };
    return {
      settings: Object.assign({ script: 'lat', plan: 0, rateMode: 'cbu', market: null }, d.settings || {}),
      accounts: arr(d.accounts), cats: arr(d.cats).length ? d.cats : window.DEFAULT_CATS.slice(),
      tx: arr(d.tx), limits: d.limits && typeof d.limits === 'object' ? d.limits : {},
      recurring: arr(d.recurring), debts: arr(d.debts), goals: arr(d.goals),
      rates: d.rates && typeof d.rates === 'object' ? d.rates : {}
    };
  }
  function load() {
    try { var raw = localStorage.getItem(KEY); if (raw) return normalize(JSON.parse(raw)); } catch (e) { /* defaults */ }
    return normalize({});
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { toast('Saqlab boʻlmadi'); }
  }

  var db = load();
  var ui = { route: null, k: null, month: null, ccyView: 'UZS', form: null, text: '', sms: '', textAcc: null, smsAcc: null,
    editLimits: false, removed: null, rateBusy: false };

  // ---------- script (Latin / 2026 Latin / Cyrillic) ----------

  function tr(html) {
    var s = db.settings.script;
    return s === 'new' ? E.translitHtml(html, E.toNewLatin) : s === 'cyr' ? E.translitHtml(html, E.toCyrillic) : html;
  }

  var toastTimer = null;
  // undo: { act, v } adds a "Bekor" button that runs that action
  function toast(msg, undo) {
    var box = document.getElementById('toast');
    box.innerHTML = tr('<div class="toast" role="status">' + icon('check', 18, 3) + '<span class="sp">' + esc(msg) + '</span>' +
      (undo ? '<button data-act="' + undo.act + '" data-v="' + esc(undo.v) + '">Bekor</button>' : '') + '</div>');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.innerHTML = ''; }, undo ? 5000 : 2000);
  }

  // ---------- data helpers ----------

  function cats(kind) { return db.cats.filter(function (c) { return c.kind === kind && !c.hidden; }); }
  function catById(id) { return db.cats.filter(function (c) { return c.id === id; })[0] || { id: id, name: 'Boshqa', icon: 'dots', tone: 7 }; }
  function accById(id) { return db.accounts.filter(function (a) { return a.id === id; })[0] || null; }
  function accsOf(ccy) { return db.accounts.filter(function (a) { return a.ccy === ccy; }); }
  function cbuLatest() {
    var keys = Object.keys(db.rates).sort();
    return keys.length ? { date: keys[keys.length - 1], rate: db.rates[keys[keys.length - 1]] } : null;
  }
  function rateNow() {
    if (db.settings.rateMode === 'market' && db.settings.market) return db.settings.market;
    var c = cbuLatest();
    return c ? c.rate : FALLBACK_RATE;
  }
  function hasRate() { return !!(cbuLatest() || (db.settings.rateMode === 'market' && db.settings.market)); }
  function catBadge(c, size) {
    var t = window.TONES[c.tone || 0];
    return '<span class="cat-ic" style="--cb:' + t[0] + ';--cf:' + t[1] + '">' + icon(c.icon || 'dots', size || 18, 2.1) + '</span>';
  }
  // categories of a kind, most used in the last 90 days first
  function usageOrder(kind) {
    var from = E.addDays(today(), -90), n = {};
    db.tx.forEach(function (t) { if (t.kind === kind && t.date >= from) n[t.cat] = (n[t.cat] || 0) + 1; });
    var list = cats(kind);
    return list.slice().sort(function (a, b) { return (n[b.id] || 0) - (n[a.id] || 0) || list.indexOf(a) - list.indexOf(b); });
  }
  function sortedTx() { return db.tx.slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (b.created || 0) - (a.created || 0); }); }
  function txTitle(t) {
    if (t.kind === 'move') {
      var a = accById(t.acc), b = accById(t.toAcc);
      return (a ? a.name : '?') + ' → ' + (b ? b.name : '?');
    }
    return t.note || catById(t.cat).name;
  }
  function txRow(t) {
    var c = t.kind === 'move' ? { icon: 'swap', tone: 1 } : catById(t.cat), a = accById(t.acc);
    var sub = t.kind === 'move' ? 'Oʻtkazma' + (t.toAmount != null && t.ccy !== (accById(t.toAcc) || {}).ccy ? ' · ' + money(t.toAmount, accById(t.toAcc).ccy) : '')
      : (t.note ? catById(t.cat).name + ' · ' : '') + (a ? a.name : '');
    var amt = t.kind === 'in' ? money(t.amount, t.ccy, { plus: true }) : t.kind === 'out' ? money(-t.amount, t.ccy) : money(t.amount, t.ccy);
    return '<a class="row" href="#yozuv/' + esc(t.id) + '">' + catBadge(c) + '<span class="grow"><b>' + esc(txTitle(t)) + '</b><span class="sub">' + esc(sub) +
      '</span></span><b class="num' + (t.kind === 'in' ? ' pos' : t.kind === 'move' ? ' mu' : '') + '">' + amt.replace(' soʻm', '') + '</b></a>';
  }

  // ---------- shared pieces ----------

  function header(eyebrow, title, extra) {
    return '<header class="head"><div><div class="eyebrow">' + eyebrow + '</div><h1>' + title + '</h1></div>' + (extra || '') + '</header>';
  }
  function sectionTitle(t, extra) { return '<div class="sec"><span>' + t + '</span>' + (extra || '') + '</div>'; }
  function seg(items, act, current, cls) {
    return '<div class="seg ' + (cls || '') + '" role="group">' + items.map(function (x) {
      return '<button data-act="' + act + '" data-v="' + x[0] + '" aria-pressed="' + (x[0] === current) + '">' + x[1] + '</button>';
    }).join('') + '</div>';
  }
  function monthNav(month) {
    var cur = E.monthOf(today());
    return '<div class="month-nav"><button class="icon-btn" data-act="month" data-v="-1" aria-label="Oldingi oy">' + icon('back', 20) + '</button>' +
      '<b>' + monthLabel(month) + '</b>' + (month < cur ? '<button class="icon-btn" data-act="month" data-v="1" aria-label="Keyingi oy">' + icon('chev', 20) + '</button>' : '<span class="icon-gap"></span>') + '</div>';
  }

  // ---------- first run ----------

  function viewSetup() {
    return header('Xush kelibsiz', 'Hamyon') +
      '<section class="card"><p class="lead">Ilova oila pulini bir telefonda hisoblaydi. Maʼlumotlar faqat shu telefonda saqlanadi.</p>' +
      '<p class="small mu">Hozirgi qoldiqlarni yozing (bilmasangiz, 0 qoldiring, keyin tuzatasiz).</p>' +
      '<label class="field"><span>Naqd soʻm</span><input class="input num" id="s-cash" inputmode="numeric" placeholder="0"></label>' +
      '<label class="field"><span>Bank kartasi (soʻm)</span><input class="input num" id="s-card" inputmode="numeric" placeholder="0"></label>' +
      '<label class="field"><span>Naqd dollar ($)</span><input class="input num" id="s-usd" inputmode="decimal" placeholder="0"></label>' +
      '<label class="field"><span>Oyiga qancha sarflashni rejalaysiz (soʻm)</span><input class="input num" id="s-plan" inputmode="numeric" placeholder="Masalan: 12 000 000"></label>' +
      '<button class="btn block" data-act="setup">Boshlash</button></section>' +
      '<button class="btn ghost block" data-act="demo">Namuna maʼlumot bilan koʻrish</button>';
  }

  // ---------- main ----------

  function viewMain() {
    var t = today(), month = E.monthOf(t), st = E.monthStats(db.tx, month), plan = db.settings.plan, h = '';
    var d = E.keyToDate(t);
    h += header(d.getDate() + '-' + MONTHS[d.getMonth()] + ', ' + WD[d.getDay()], 'Hamyon',
      '<a class="icon-btn" href="#sozlamalar" aria-label="Sozlamalar">' + icon('user', 20) + '</a>');

    if (plan > 0) {
      var s = E.safeToSpend(plan, st.exp, t), over = s.left < 0;
      h += '<section class="card hero"><div class="between"><span class="mu b6">' + (over ? 'Oylik rejadan oshdi' : 'Oy oxirigacha sarflash mumkin') + '</span><span class="mu">' + s.pct + '%</span></div>' +
        '<div class="big"><span class="num' + (over ? ' warn' : '') + '">' + E.fmtNum(Math.abs(s.left)) + '</span><span class="unit">soʻm</span></div>' +
        '<div class="bar"><div style="width:' + Math.min(100, s.pct) + '%;background:' + (over ? 'var(--warn)' : 'var(--accent)') + '"></div></div>' +
        '<div class="mu small">' + (over ? 'Reja: ' + som(plan) : 'Kuniga ~' + som(s.perDay) + ' · ' + s.daysLeft + ' kun qoldi · ≈ ' + money(Math.round(s.left / rateNow() * 100), 'USD')) + '</div>';
    } else {
      h += '<section class="card hero"><span class="mu b6">Bu oy xarajat</span><div class="big"><span class="num">' + E.fmtNum(st.exp) + '</span><span class="unit">soʻm</span></div>' +
        '<a class="link" href="#rejalar">Oylik reja qoʻying: kuniga qancha sarflash mumkinligini koʻrsatadi</a>';
    }
    h += '<div class="grid3 stats"><div><b class="num pos">' + E.fmtShort(st.inc) + '</b><span>daromad</span></div><div><b class="num">' + E.fmtShort(st.exp) +
      '</b><span>xarajat</span></div><div><b class="num acc">' + E.fmtShort(st.inc - st.exp) + '</b><span>farq</span></div></div></section>';

    var bal = E.balances(db.accounts, db.tx);
    h += '<div class="hscroll">' + db.accounts.map(function (a) {
      return '<a class="acc-chip" href="#hisoblar"><span>' + esc(a.name) + '</span><b class="num">' + money(bal[a.id], a.ccy).replace(' soʻm', '') + '</b></a>';
    }).join('') + '</div>';

    alerts().slice(0, 2).forEach(function (x) {
      h += '<a class="alert ' + x.kind + '" href="' + x.href + '">' + icon('alert', 20) + '<span>' + x.text + '</span></a>';
    });
    if (!hasRate()) h += '<a class="alert warn" href="#hisoblar">' + icon('alert', 20) + '<span>Dollar kursi hali yuklanmadi. Internetga ulaning yoki kursni qoʻlda kiriting.</span></a>';

    var list = sortedTx(), yest = E.addDays(t, -1);
    var recent = list.filter(function (x) { return x.date >= yest; });
    if (!recent.length) recent = list.slice(0, 5);
    if (!recent.length) {
      return h + sectionTitle('Oxirgi yozuvlar') + '<section class="card empty"><p>Hali yozuv yoʻq. Pastdagi <b>+</b> tugmasi bilan birinchi xarajatni yozing.</p></section>';
    }
    var days = [];
    recent.forEach(function (x) { if (days.indexOf(x.date) < 0) days.push(x.date); });
    days.forEach(function (d, i) {
      h += sectionTitle(dayLabel(d), i === 0 ? '<a href="#tarix">Hammasi</a>' : '') +
        '<section class="card list">' + recent.filter(function (x) { return x.date === d; }).map(txRow).join('') + '</section>';
    });
    return h;
  }

  // reminders shown on the main screen
  function alerts() {
    var t = today(), month = E.monthOf(t), st = E.monthStats(db.tx, month), out = [];
    Object.keys(db.limits).forEach(function (id) {
      var lim = db.limits[id], sp = st.byCat[id] || 0;
      if (lim && sp > lim) out.push({ kind: 'warn', href: '#rejalar', text: catById(id).name + ' limiti ' + som(sp - lim) + 'ga oshdi.' });
    });
    db.recurring.forEach(function (r) {
      var due = E.nextDue(r.day, t, r.paid), days = E.daysBetween(t, due);
      if (r.paid === month || days > 3) return;
      out.push({ kind: days < 0 ? 'warn' : 'info', href: '#rejalar',
        text: r.name + ': ' + money(r.amount, r.ccy) + (days < 0 ? ' — muddati ' + (-days) + ' kun oʻtdi' : days === 0 ? ' — bugun' : ' — ' + days + ' kundan keyin') });
    });
    return out;
  }

  // ---------- add / edit ----------

  function newEntry(kind) {
    // the account used last for this kind of entry, else the first one
    var last = sortedTx().filter(function (t) { return t.kind === (kind || 'out') && accById(t.acc); })[0];
    var acc = last ? accById(last.acc) : db.accounts[0];
    return { kind: kind || 'out', amount: '', acc: acc ? acc.id : null, toAcc: (db.accounts[1] || {}).id || null, toAmount: '',
      cat: usageOrder(kind === 'in' ? 'in' : 'out')[0].id, date: today(), note: '', allCats: false, editId: null };
  }
  function entryFrom(t) {
    var acc = accById(t.acc), dec = acc && acc.ccy === 'USD';
    var amt = dec ? String(t.amount / 100).replace('.', ',') : String(t.amount);
    var to = accById(t.toAcc);
    return { kind: t.kind, amount: amt, acc: t.acc, toAcc: t.toAcc || null,
      toAmount: t.toAmount != null && to ? (to.ccy === 'USD' ? String(t.toAmount / 100).replace('.', ',') : String(t.toAmount)) : '',
      cat: t.cat || usageOrder('out')[0].id, date: t.date, note: t.note || '', allCats: false, editId: t.id };
  }
  function entryValue(k) { return num(k.amount) || 0; }
  function shownAmount(s) {
    if (!s) return '0';
    var p = s.split(',');
    return E.fmtNum(+p[0] || 0) + (p.length > 1 ? ',' + p[1] : '');
  }
  // money received on the other side of a transfer between currencies
  function moveTarget(k) {
    var a = accById(k.acc), b = accById(k.toAcc);
    if (!a || !b) return null;
    var v = entryValue(k), minor = E.toMinor(v, a.ccy);
    if (a.ccy === b.ccy) return { ccy: b.ccy, minor: minor, same: true };
    var typed = num(k.toAmount);
    if (typed != null) return { ccy: b.ccy, minor: E.toMinor(typed, b.ccy), typed: true };
    var r = rateNow(), conv = a.ccy === 'USD' ? Math.round(v * r) : Math.round(v / r * 100);
    return { ccy: b.ccy, minor: conv };
  }

  function viewAdd() {
    var k = ui.k, acc = accById(k.acc), ccy = acc ? acc.ccy : 'UZS', v = entryValue(k), r = rateNow(), h = '';
    h += '<div class="add-head"><a class="pill" href="#asosiy">Yopish</a>' + seg(KINDS, 'kind', k.kind, 'seg-kind') +
      '<a class="pill ghost" href="#matn">Matn</a></div>';
    var conv = !v ? 'Summani kiriting' : ccy === 'USD' ? '≈ ' + som(v * r) : '≈ ' + money(Math.round(v / r * 100), 'USD');
    h += '<section class="amount"><div class="amt-row"><span class="amt num' + (k.kind === 'in' ? ' pos' : '') + '">' + (ccy === 'USD' ? '$' : '') + shownAmount(k.amount) +
      '</span><button class="ccy" data-act="swapCcy" aria-label="Valyutani almashtirish">' + (ccy === 'USD' ? 'dollar' : 'soʻm') + ' ⇄</button></div>' +
      '<div class="mu small num">' + conv + (v ? ' · kurs ' + E.fmtNum(r) : '') + '</div></section>';

    if (k.kind === 'move') {
      h += '<div class="lbl">Qayerdan</div>' + accChips('acc', k.acc) + '<div class="lbl">Qayerga</div>' + accChips('toAcc', k.toAcc);
      var mt = moveTarget(k);
      if (mt && !mt.same) {
        h += '<label class="field"><span>Qabul qilingan summa (' + (mt.ccy === 'USD' ? '$' : 'soʻm') + '), bozor kursida boʻlsa oʻzgartiring</span>' +
          '<input class="input num" data-field="toAmount" inputmode="decimal" value="' + esc(k.toAmount) + '" placeholder="' +
          esc(mt.ccy === 'USD' ? String(mt.minor / 100).replace('.', ',') : E.fmtNum(mt.minor)) + '"></label>';
      }
    } else {
      var list = usageOrder(k.kind), show = k.allCats ? list : list.slice(0, 7);
      if (!k.allCats && show.every(function (c) { return c.id !== k.cat; })) show[6] = catById(k.cat);
      h += '<div class="cats">' + show.map(function (c) {
        return '<button class="cat" data-act="cat" data-v="' + c.id + '" aria-pressed="' + (c.id === k.cat) + '">' + catBadge(c) + '<span>' + esc(c.name) + '</span></button>';
      }).join('') + (!k.allCats && list.length > 7 ? '<button class="cat" data-act="allCats">' + catBadge({ icon: 'dots', tone: 7 }) + '<span>Barchasi</span></button>' : '') + '</div>';
      h += accChips('acc', k.acc);
    }
    h += '<div class="row2"><input class="input" type="date" data-field="date" value="' + esc(k.date) + '" max="' + today() + '" aria-label="Sana">' +
      '<input class="input" data-field="note" value="' + esc(k.note) + '" placeholder="Izoh (ixtiyoriy)" aria-label="Izoh"></div>';
    var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ccy === 'USD' ? ',' : '000', '0', 'del'];
    h += '<div class="keypad">' + keys.map(function (x) {
      return '<button data-act="key" data-v="' + x + '"' + (x === 'del' ? ' aria-label="Oʻchirish">⌫' : '>' + x) + '</button>';
    }).join('') + '</div>';
    var label = k.kind === 'move' ? 'Oʻtkazish' : 'Saqlash · ' + catById(k.cat).name;
    h += '<button class="btn block" data-act="saveEntry">' + esc(label) + '</button>';
    if (k.editId) h += '<button class="btn danger block" data-act="deleteEntry">Yozuvni oʻchirish</button>';
    return h;
  }

  function accChips(field, current) {
    return '<div class="hscroll chips">' + db.accounts.map(function (a) {
      return '<button class="chip" data-act="pickAcc" data-f="' + field + '" data-v="' + a.id + '" aria-pressed="' + (a.id === current) + '">' + esc(a.name) +
        ' <span class="mu">' + (a.ccy === 'USD' ? '$' : 'soʻm') + '</span></button>';
    }).join('') + '</div>';
  }

  function buildTx(k, old) {
    var acc = accById(k.acc);
    if (!acc) return { error: 'Hisobni tanlang' };
    var v = entryValue(k);
    if (!(v > 0)) return { error: 'Summani kiriting' };
    var rate = old ? old.rate : rateNow(), amount = E.toMinor(v, acc.ccy);
    var t = { id: old ? old.id : uid(), date: k.date || today(), kind: k.kind, amount: amount, ccy: acc.ccy, acc: acc.id,
      cat: k.kind === 'move' ? null : k.cat, note: k.note.trim(), rate: rate, uzs: E.toUZS(amount, acc.ccy, rate), created: old ? old.created : Date.now() };
    if (k.kind === 'move') {
      if (!k.toAcc || k.toAcc === k.acc) return { error: 'Boshqa hisobni tanlang' };
      var mt = moveTarget(k);
      t.toAcc = k.toAcc; t.toAmount = mt.minor;
      if (mt.typed) t.rate = acc.ccy === 'USD' ? mt.minor / (amount / 100) : amount / (mt.minor / 100);
    }
    return { tx: t };
  }

  // ---------- text and SMS entry ----------

  function viewText() {
    var h = '<div class="add-head"><a class="pill" href="#qoshish">' + icon('back', 18) + ' Orqaga</a><b class="grow center">Matn bilan kiritish</b><span class="pill-gap"></span></div>';
    h += '<label class="field"><span>Bir qatorda bir nechta xarajat</span><textarea class="input" rows="2" data-field="text" placeholder="non 8 ming, sut 14 000, taksi 25k"></textarea></label>';
    h += '<div id="text-preview">' + textPreview() + '</div>';
    h += sectionTitle('SMS yoki bildirishnomadan');
    h += '<section class="card"><textarea class="input mono" rows="3" data-field="sms" placeholder="Bank SMS matnini shu yerga qoʻying"></textarea>' +
      '<button class="btn secondary block" data-act="pasteSms">Nusxadan qoʻyish</button><div id="sms-preview">' + smsPreview() + '</div></section>';
    return h;
  }

  function textItems() {
    return E.parseLine(ui.text, db.cats.filter(function (c) { return !c.hidden; })).map(function (x) {
      if (!x.ok) return x;
      var c = x.cat ? catById(x.cat) : catById('other');
      x.kind = c.kind; x.cat = c.id;
      return x;
    });
  }
  // account for an item: the chosen one if the currency matches, else the first account in that currency
  function accountFor(ccy, chosen) {
    var a = accById(chosen);
    if (a && a.ccy === ccy) return a;
    return accsOf(ccy)[0] || null;
  }
  function textPreview() {
    if (!ui.text.trim()) return '<p class="hint">“ming”, “k”, “mln” va “$” tushuniladi. Turkum soʻzdan oʻzi aniqlanadi.</p>';
    var items = textItems(), ok = items.filter(function (x) { return x.ok; }), total = 0;
    var h = '<section class="card list">' + items.map(function (x) {
      if (!x.ok) return '<div class="row"><span class="grow"><b class="mu">' + esc(x.text) + '</b><span class="sub warn">Summa topilmadi</span></span></div>';
      var c = catById(x.cat), a = accountFor(x.ccy, ui.textAcc);
      if (x.ccy === 'UZS') total += x.amount; else total += Math.round(x.amount / 100 * rateNow());
      return '<div class="row">' + catBadge(c) + '<span class="grow"><b>' + esc(x.name) + '</b><span class="sub">' + esc(c.name) + ' · ' +
        (a ? esc(a.name) : '<span class="warn">' + (x.ccy === 'USD' ? 'dollar' : 'soʻm') + ' hisobi yoʻq</span>') + '</span></span><b class="num' + (x.kind === 'in' ? ' pos' : '') + '">' +
        money(x.amount, x.ccy).replace(' soʻm', '') + '</b></div>';
    }).join('') + '</section>';
    if (ok.length) {
      h += '<div class="lbl">Qaysi hisobdan</div>' + accChips('textAcc', ui.textAcc || (accsOf('UZS')[0] || {}).id);
      h += '<button class="btn block" data-act="saveText">' + ok.length + ' tasini saqlash · ' + som(total) + '</button>';
    }
    return h;
  }

  function smsResult() {
    var r = E.parseSms(ui.sms, db.cats.filter(function (c) { return !c.hidden; }));
    if (!r) return null;
    var byCard = r.card ? db.accounts.filter(function (a) { return a.card && String(a.card) === r.card; })[0] : null;
    r.acc = byCard || accById(ui.smsAcc) || accountFor(r.ccy, null);
    r.cat = r.cat || (r.kind === 'in' ? 'otherin' : 'other');
    return r;
  }
  function smsPreview() {
    if (!ui.sms.trim()) return '<p class="hint">Karta SMS yoki ilova bildirishnomasini nusxalab qoʻying: summa, doʻkon va karta oʻzi aniqlanadi.</p>';
    var r = smsResult();
    if (!r) return '<p class="hint warn">Summani topa olmadim. Matnda “UZS” yoki “soʻm” bilan summa boʻlishi kerak.</p>';
    var c = catById(r.cat), h = '<div class="row">' + catBadge(c) + '<span class="grow"><b>' + esc(r.name) + '</b><span class="sub">' + esc(c.name) +
      (r.acc ? ' · ' + esc(r.acc.name) : '') + (r.card ? ' (*' + r.card + ')' : '') + '</span></span><b class="num' + (r.kind === 'in' ? ' pos' : '') + '">' +
      money(r.kind === 'in' ? r.amount : -r.amount, r.ccy, { plus: true }).replace(' soʻm', '') + '</b></div>';
    if (r.acc && r.balance != null && r.acc.ccy === r.ccy) {
      var after = E.balances(db.accounts, db.tx)[r.acc.id] + (r.kind === 'in' ? r.amount : -r.amount);
      h += after === r.balance ? '<p class="hint pos">Karta qoldigʻi ilovadagi bilan mos: ' + money(r.balance, r.ccy) + '</p>'
        : '<p class="hint warn">Bankda qoldiq ' + money(r.balance, r.ccy) + ', ilovada ' + money(after, r.ccy) + ' boʻladi. Farq: ' + money(r.balance - after, r.ccy) + '.</p>';
    }
    if (!r.card || !db.accounts.some(function (a) { return a.card === r.card; })) h += accChips('smsAcc', r.acc ? r.acc.id : null);
    h += '<button class="btn block" data-act="saveSms"' + (r.acc ? '' : ' disabled') + '>Saqlash</button>';
    return h;
  }

  // ---------- history ----------

  function viewHistory() {
    var month = ui.month || E.monthOf(today()), list = sortedTx().filter(function (t) { return E.monthOf(t.date) === month; });
    var h = header('Barcha yozuvlar', 'Tarix', '<a class="icon-btn" href="#asosiy" aria-label="Orqaga">' + icon('back', 20) + '</a>') + monthNav(month);
    if (!list.length) return h + '<section class="card empty"><p>Bu oyda yozuv yoʻq.</p></section>';
    var days = {};
    list.forEach(function (t) { (days[t.date] = days[t.date] || []).push(t); });
    Object.keys(days).sort().reverse().forEach(function (d) {
      var spent = days[d].reduce(function (a, t) { return a + (t.kind === 'out' ? t.uzs : 0); }, 0);
      h += sectionTitle(dayLabel(d), spent ? '<span class="num">−' + E.fmtNum(spent) + '</span>' : '') + '<section class="card list">' + days[d].map(txRow).join('') + '</section>';
    });
    return h;
  }

  // ---------- analysis ----------

  function viewAnalysis() {
    var month = ui.month || E.monthOf(today()), usd = ui.ccyView === 'USD', st = E.monthStats(db.tx, month), h = '';
    var cur = month === E.monthOf(today()), day = +today().slice(8, 10);
    h += header(cur ? monthLabel(month) + ', 1–' + day : monthLabel(month), 'Tahlil', seg([['UZS', 'soʻm'], ['USD', '$']], 'ccyView', ui.ccyView));
    h += monthNav(month);
    var fmtV = function (uzs, usdV) { return usd ? money(Math.round(usdV) * 100, 'USD') : E.fmtNum(uzs); };
    var cmp = E.compareMonths(db.tx, month, today());
    h += '<section class="card"><span class="mu b6">Xarajat</span><div class="big"><span class="num">' + fmtV(st.exp, st.expUsd) + '</span>' + (usd ? '' : '<span class="unit">soʻm</span>') + '</div>';
    if (cmp) {
      var p = usd ? Math.round((cmp.now.expUsd - cmp.prev.expUsd) / (cmp.prev.expUsd || 1) * 100) : cmp.pct;
      h += '<div class="small ' + (p <= 0 ? 'pos' : 'warn') + '">' + (cmp.partial ? 'Oʻtgan oyning shu kunlariga' : 'Oʻtgan oyga') + ' nisbatan ' + Math.abs(p) + '% ' + (p <= 0 ? 'kam' : 'koʻp') + '</div>';
    }
    if (st.inc) h += '<div class="small mu">Daromad: ' + (usd ? '≈ ' + money(Math.round(st.inc / rateNow()) * 100, 'USD') : som(st.inc)) + ' · ' +
      (st.inc > st.exp ? 'daromadning ' + Math.round((st.inc - st.exp) / st.inc * 100) + ' foizi qoldi' : 'xarajat daromaddan koʻp') + '</div>';
    h += '</section>';

    var ids = Object.keys(st.byCat).sort(function (a, b) { return st.byCat[b] - st.byCat[a]; });
    if (!ids.length) return h + '<section class="card empty"><p>Bu oyda xarajat yozilmagan.</p></section>';
    var max = st.byCat[ids[0]];
    h += '<section class="card bars">' + ids.map(function (id) {
      var c = catById(id), v = st.byCat[id], lim = db.limits[id], tone = window.TONES[c.tone || 0][1];
      return '<div class="barrow"><div class="between"><span>' + esc(c.name) + '</span><span class="num"><b>' + fmtV(v, st.byCatUsd[id]) + '</b> <span class="mu">' +
        (v / st.exp < 0.01 ? '&lt;1' : Math.round(v / st.exp * 100)) + '%</span></span></div><div class="track"><div style="width:' + Math.max(2, Math.round(v / max * 100)) + '%;background:' + tone + '"></div></div>' +
        (lim ? '<div class="tiny ' + (v > lim ? 'warn' : 'mu') + '">Limit ' + som(lim) + (v > lim ? ' · ' + som(v - lim) + ' oshdi' : '') + '</div>' : '') + '</div>';
    }).join('') + '</section>';

    var tips = [];
    var top = catById(ids[0]);
    tips.push('Har 100 soʻmdan <b>' + Math.round(st.byCat[ids[0]] / st.exp * 100) + ' soʻmi</b> “' + esc(top.name) + '” uchun ketyapti.');
    if (cmp) {
      var up = Object.keys(cmp.catDiff).filter(function (id) { return cmp.catDiff[id] > 0; }).sort(function (a, b) { return cmp.catDiff[b] - cmp.catDiff[a]; })[0];
      if (up) tips.push('“' + esc(catById(up).name) + '” ' + (cmp.partial ? 'oʻtgan oyning shu kunlaridan' : 'oʻtgan oydan') + ' <b>' + som(cmp.catDiff[up]) + ' koʻp</b>.');
      tips.push('Dollarda oʻlchasak: <b>' + money(cmp.now.expUsd * 100, 'USD') + '</b>, oʻtgan oy shu davrda ' + money(cmp.prev.expUsd * 100, 'USD') + '. Bu soʻm qadrsizlanishini hisobga oladi.');
    }
    h += sectionTitle('Oddiy tilda') + '<section class="card tips">' + tips.map(function (t) { return '<p>' + t + '</p>'; }).join('') + '</section>';

    var ser = E.series(db.tx, month, 6), top6 = Math.max.apply(null, ser.map(function (x) { return Math.max(x.inc, x.exp); }).concat([1]));
    h += sectionTitle('6 oy') + '<section class="card"><div class="legend"><span><i class="inc"></i>daromad</span><span><i class="exp"></i>xarajat</span></div><div class="cols">' +
      ser.map(function (x) {
        return '<div class="col"><div class="pair"><div class="inc" style="height:' + Math.round(x.inc / top6 * 72) + 'px"></div><div class="exp" style="height:' +
          Math.round(x.exp / top6 * 72) + 'px"></div></div><span>' + MONTHS_SHORT[+x.month.slice(5, 7) - 1] + '</span></div>';
      }).join('') + '</div><div class="tiny mu">' + ser.map(function (x) { return E.fmtShort(x.exp); }).join(' · ') + '</div></section>';
    return h;
  }

  // ---------- plans ----------

  function viewPlans() {
    var t = today(), month = E.monthOf(t), st = E.monthStats(db.tx, month), h = '';
    var left = E.daysInMonth(month) - +t.slice(8, 10) + 1;
    h += header(monthLabel(month) + ' · ' + left + ' kun qoldi', 'Rejalar');
    h += '<section class="card"><label class="field"><span>Oylik xarajat rejasi (soʻm)</span><input class="input num" data-field="plan" inputmode="numeric" value="' +
      (db.settings.plan ? E.fmtNum(db.settings.plan) : '') + '" placeholder="Masalan: 12 000 000"></label></section>';

    var withLim = cats('out').filter(function (c) { return db.limits[c.id]; });
    h += sectionTitle('Turkum limitlari', '<button class="link-btn" data-act="editLimits">' + (ui.editLimits ? 'Tayyor' : 'Oʻzgartirish') + '</button>');
    if (ui.editLimits) {
      h += '<section class="card list">' + cats('out').map(function (c) {
        return '<label class="row">' + catBadge(c) + '<span class="grow">' + esc(c.name) + '</span><input class="input num lim" data-field="limit" data-v="' + c.id + '" inputmode="numeric" value="' +
          (db.limits[c.id] ? E.fmtNum(db.limits[c.id]) : '') + '" placeholder="—" aria-label="' + esc(c.name) + ' limiti"></label>';
      }).join('') + '</section>';
    } else if (withLim.length) {
      h += '<section class="card bars">' + withLim.map(function (c) {
        var lim = db.limits[c.id], sp = st.byCat[c.id] || 0, over = sp > lim, pct = Math.min(100, Math.round(sp / lim * 100));
        return '<div class="barrow"><div class="between"><b class="b6">' + esc(c.name) + '</b><span class="num ' + (over ? 'warn' : 'mu') + '">' + E.fmtNum(sp) + ' / ' + E.fmtNum(lim) + '</span></div>' +
          '<div class="track"><div style="width:' + pct + '%;background:' + (over ? 'var(--warn)' : 'var(--pos)') + '"></div></div><div class="tiny ' + (over ? 'warn' : 'mu') + '">' +
          (over ? som(sp - lim) + 'ga oshdi' : som(lim - sp) + ' qoldi · kuniga ~' + som(Math.floor((lim - sp) / left / 1000) * 1000)) + '</div></div>';
      }).join('') + '</section>';
    } else {
      h += '<section class="card empty"><p>Masalan, oziq-ovqatga oyiga 4 mln. Limitdan oshsa, asosiy ekranda ogohlantiradi.</p></section>';
    }

    h += sectionTitle('Doimiy toʻlovlar', '<button class="link-btn" data-act="form" data-v="rec">+ Qoʻshish</button>');
    if (ui.form === 'rec') h += recForm();
    if (db.recurring.length) {
      h += '<section class="card list">' + db.recurring.slice().sort(function (a, b) { return E.nextDue(a.day, t, a.paid) < E.nextDue(b.day, t, b.paid) ? -1 : 1; }).map(function (r) {
        var due = E.nextDue(r.day, t, r.paid), days = E.daysBetween(t, due), paid = r.paid === month;
        return '<div class="row"><span class="grow"><b>' + esc(r.name) + '</b><span class="sub ' + (paid ? 'pos' : days < 0 ? 'warn' : '') + '">' +
          (paid ? 'Bu oy toʻlandi · keyingisi ' + shortDate(due) : shortDate(due) + (days < 0 ? ' · muddati oʻtdi' : days === 0 ? '' : ' · ' + days + ' kundan keyin')) + '</span></span>' +
          '<b class="num">' + money(r.amount, r.ccy).replace(' soʻm', '') + '</b>' +
          (paid ? '<button class="x-btn" data-act="delRec" data-v="' + r.id + '" aria-label="Oʻchirish">×</button>' : '<button class="btn sm secondary" data-act="payRec" data-v="' + r.id + '">Toʻlandi</button>') + '</div>';
      }).join('') + '</section>';
    } else if (ui.form !== 'rec') {
      h += '<section class="card empty"><p>Bogʻcha, kredit, internet, kommunal: muddatidan oldin eslatadi, bir bosishda yoziladi.</p></section>';
    }

    var open = db.debts.filter(function (d) { return !d.closed; });
    h += sectionTitle('Qarzlar', '<button class="link-btn" data-act="form" data-v="debt">+ Qoʻshish</button>');
    if (ui.form === 'debt') h += debtForm();
    if (open.length) {
      h += '<section class="card list">' + open.map(function (d) {
        var late = d.due && d.due < t;
        return '<div class="row"><span class="grow"><b>' + (d.dir === 'gave' ? 'Berildi: ' : 'Olindi: ') + esc(d.who) + '</b><span class="sub ' + (late ? 'warn' : '') + '">' +
          (d.due ? shortDate(d.due) + 'gacha' : 'Muddatsiz') + '</span></span><b class="num ' + (d.dir === 'gave' ? 'pos' : '') + '">' + money(d.amount, d.ccy).replace(' soʻm', '') + '</b>' +
          '<button class="btn sm secondary" data-act="closeDebt" data-v="' + d.id + '">Yopildi</button></div>';
      }).join('') + '</section><p class="hint">Qarzlar eslatma sifatida turadi; pul berilgan yoki qaytgan boʻlsa, uni alohida yozing.</p>';
    } else if (ui.form !== 'debt') {
      h += '<section class="card empty"><p>Kimga qancha berilgan yoki olingan: muddati bilan.</p></section>';
    }

    h += sectionTitle('Jamgʻarma maqsadlari', '<button class="link-btn" data-act="form" data-v="goal">+ Qoʻshish</button>');
    if (ui.form === 'goal') h += goalForm();
    db.goals.forEach(function (g) {
      var pct = Math.min(100, Math.round(g.saved / g.target * 100));
      h += '<section class="card"><div class="between"><b class="b6">' + esc(g.name) + '</b><span class="num">' + money(g.saved, g.ccy) + ' / ' + money(g.target, g.ccy) + '</span></div>' +
        '<div class="bar"><div style="width:' + pct + '%;background:var(--accent)"></div></div>' +
        (ui.form === 'goalAdd:' + g.id
          ? '<div class="row2"><input class="input num" id="g-add" inputmode="decimal" placeholder="Qancha qoʻshildi"><button class="btn sm" data-act="goalAdd" data-v="' + g.id + '">Qoʻshish</button></div>'
          : '<div class="between"><span class="small mu">' + (g.saved >= g.target ? 'Maqsadga yetildi!' : money(g.target - g.saved, g.ccy) + ' qoldi') + '</span><span><button class="link-btn" data-act="form" data-v="goalAdd:' + g.id +
            '">+ Pul qoʻshish</button><button class="x-btn" data-act="delGoal" data-v="' + g.id + '" aria-label="Oʻchirish">×</button></span></div>') + '</section>';
    });
    return h;
  }

  function accSelect(id, ccy) {
    var list = ccy ? accsOf(ccy) : db.accounts;
    return '<select class="input" id="' + id + '">' + list.map(function (a) { return '<option value="' + a.id + '">' + esc(a.name) + ' (' + (a.ccy === 'USD' ? '$' : 'soʻm') + ')</option>'; }).join('') + '</select>';
  }
  function ccySelect(id) { return '<select class="input" id="' + id + '"><option value="UZS">soʻm</option><option value="USD">$</option></select>'; }
  function catSelect(id, kind) { return '<select class="input" id="' + id + '">' + cats(kind).map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join('') + '</select>'; }

  function recForm() {
    return '<section class="card form"><label class="field"><span>Nomi</span><input class="input" id="r-name" placeholder="Masalan: Bogʻcha"></label>' +
      '<div class="grid2"><label class="field"><span>Summa</span><input class="input num" id="r-amount" inputmode="decimal"></label><label class="field"><span>Har oyning nechanchi kuni</span><input class="input num" id="r-day" inputmode="numeric" placeholder="1–31"></label></div>' +
      '<div class="grid2"><label class="field"><span>Hisob</span>' + accSelect('r-acc') + '</label><label class="field"><span>Turkum</span>' + catSelect('r-cat', 'out') + '</label></div>' +
      '<div class="grid2"><button class="btn secondary" data-act="form" data-v="">Bekor</button><button class="btn" data-act="saveRec">Saqlash</button></div></section>';
  }
  function debtForm() {
    return '<section class="card form">' + seg([['gave', 'Men berdim'], ['took', 'Men oldim']], 'debtDir', ui.debtDir || 'gave') +
      '<label class="field"><span>Kim / qayer</span><input class="input" id="d-who" placeholder="Masalan: qoʻshni, doʻkon"></label>' +
      '<div class="grid2"><label class="field"><span>Summa</span><input class="input num" id="d-amount" inputmode="decimal"></label><label class="field"><span>Valyuta</span>' + ccySelect('d-ccy') + '</label></div>' +
      '<label class="field"><span>Qaytarish muddati (ixtiyoriy)</span><input class="input" type="date" id="d-due"></label>' +
      '<div class="grid2"><button class="btn secondary" data-act="form" data-v="">Bekor</button><button class="btn" data-act="saveDebt">Saqlash</button></div></section>';
  }
  function goalForm() {
    return '<section class="card form"><label class="field"><span>Maqsad</span><input class="input" id="g-name" placeholder="Masalan: Yozgi taʼtil"></label>' +
      '<div class="grid2"><label class="field"><span>Kerakli summa</span><input class="input num" id="g-target" inputmode="decimal"></label><label class="field"><span>Valyuta</span>' + ccySelect('g-ccy') + '</label></div>' +
      '<div class="grid2"><button class="btn secondary" data-act="form" data-v="">Bekor</button><button class="btn" data-act="saveGoal">Saqlash</button></div></section>';
  }

  // ---------- accounts and rate ----------

  function viewAccounts() {
    var bal = E.balances(db.accounts, db.tx), r = rateNow(), total = 0, h = '';
    db.accounts.forEach(function (a) { total += E.toUZS(bal[a.id], a.ccy, r); });
    var usdPart = accsOf('USD').reduce(function (s, a) { return s + E.toUZS(bal[a.id], 'USD', r); }, 0);
    h += header('Oilaning barcha pullari', 'Hisoblar');
    h += '<section class="card"><span class="mu b6">Jami</span><div class="big"><span class="num">' + E.fmtNum(total) + '</span><span class="unit">soʻm</span></div>' +
      '<div class="small mu">≈ ' + money(Math.round(total / r) * 100, 'USD') + (total > 0 && usdPart > 0 ? ' · ' + Math.round(usdPart / total * 100) + '% dollarda' : '') + '</div></section>';
    ['UZS', 'USD'].forEach(function (ccy) {
      var list = accsOf(ccy);
      if (!list.length) return;
      h += sectionTitle(ccy === 'USD' ? 'Dollar' : 'Soʻm') + '<section class="card list">' + list.map(function (a) {
        if (ui.form === 'acc:' + a.id) return accForm(a);
        return '<button class="row" data-act="form" data-v="acc:' + a.id + '"><span class="grow"><b>' + esc(a.name) + '</b>' + (a.card ? '<span class="sub">karta *' + esc(a.card) + '</span>' : '') +
          '</span><b class="num' + (bal[a.id] < 0 ? ' warn' : '') + '">' + money(bal[a.id], a.ccy).replace(' soʻm', '') + '</b></button>';
      }).join('') + '</section>';
    });
    h += ui.form === 'acc:new' ? '<section class="card">' + accForm(null) + '</section>' : '<button class="btn secondary block" data-act="form" data-v="acc:new">+ Hisob qoʻshish</button>';
    if (db.accounts.length > 1) h += '<a class="btn secondary block" href="#qoshish/move">' + icon('swap', 18) + ' Oʻtkazma yoki valyuta almashtirish</a>';

    var c = cbuLatest();
    h += sectionTitle('Dollar kursi') + '<section class="card">' +
      '<div class="between"><b class="b6">1 $ = ' + (c ? E.fmtNum(Math.floor(c.rate)) + ',' + E.pad(Math.round((c.rate % 1) * 100)) + ' soʻm' : 'yuklanmagan') + '</b>' +
      '<button class="link-btn" data-act="refreshRate">' + icon('refresh', 16) + (ui.rateBusy ? ' Yuklanmoqda…' : ' Yangilash') + '</button></div>' +
      '<div class="small mu">Markaziy bank' + (c ? ' · ' + dayLabel(c.date) : '') + '. Har bir yozuvga oʻsha kungi kurs yoziladi, eski hisoblar oʻzgarmaydi.</div>' +
      seg([['cbu', 'Markaziy bank'], ['market', 'Bozor kursi']], 'rateMode', db.settings.rateMode) +
      (db.settings.rateMode === 'market' ? '<label class="field"><span>Bozor kursi (1 $ uchun soʻm)</span><input class="input num" data-field="market" inputmode="decimal" value="' +
        (db.settings.market ? E.fmtNum(db.settings.market) : '') + '" placeholder="Masalan: 12 050"></label>' : '') + '</section>';
    return h;
  }

  function accForm(a) {
    var start = a ? (a.ccy === 'USD' ? String(a.start / 100).replace('.', ',') : E.fmtNum(a.start)) : '';
    var used = a && db.tx.some(function (t) { return t.acc === a.id || t.toAcc === a.id; });
    return '<div class="form pad"><label class="field"><span>Nomi</span><input class="input" id="a-name" value="' + esc(a ? a.name : '') + '" placeholder="Masalan: Humo karta"></label>' +
      (a ? '' : '<label class="field"><span>Valyuta</span>' + ccySelect('a-ccy') + '</label>') +
      '<div class="grid2"><label class="field"><span>Boshlangʻich qoldiq</span><input class="input num" id="a-start" inputmode="decimal" value="' + esc(start) + '" placeholder="0"></label>' +
      '<label class="field"><span>Karta oxirgi 4 raqami</span><input class="input num" id="a-card" inputmode="numeric" maxlength="4" value="' + esc(a && a.card || '') + '" placeholder="SMS uchun"></label></div>' +
      '<div class="grid2"><button class="btn secondary" data-act="form" data-v="">Bekor</button><button class="btn" data-act="saveAcc" data-v="' + (a ? a.id : '') + '">Saqlash</button></div>' +
      (a && !used ? '<button class="btn danger block" data-act="delAcc" data-v="' + a.id + '">Hisobni oʻchirish</button>' : '') + '</div>';
  }

  // ---------- settings ----------

  function viewSettings() {
    var h = header('Sozlamalar', 'Hamyon', '<a class="icon-btn" href="#asosiy" aria-label="Orqaga">' + icon('back', 20) + '</a>');
    h += sectionTitle('Yozuv') + '<section class="card">' + seg([['lat', 'Lotin'], ['new', 'Lotin 2026'], ['cyr', 'Кирилл']], 'script', db.settings.script, 'seg3') +
      '<p class="small mu">“Lotin 2026” — 2026-yil 21-oktabrdagi qonun boʻyicha yangi alifbo (Ö, Ğ, Ş, Ç), 2027-yil 22-apreldan kuchga kiradi. Maʼlumotlar oʻzgarmaydi, faqat ekrandagi yozuv almashadi.</p></section>';
    h += sectionTitle('Maʼlumotlar') + '<section class="card">' +
      '<button class="btn secondary block" data-act="export">Nusxa olish (JSON fayl)</button>' +
      '<label class="btn secondary block">Nusxadan tiklash<input type="file" accept="application/json,.json" data-change="import" hidden></label>' +
      '<p class="small mu">Maʼlumotlar faqat shu telefonda. Oyiga bir marta nusxa olib, iCloud yoki Telegram “Saqlangan”ga qoʻyib qoʻying.</p>' +
      '<button class="btn danger block" data-act="clearAll">Hamma maʼlumotni oʻchirish</button></section>';
    h += '<p class="tiny mu center">Hamyon ' + VERSION + ' · ' + db.tx.length + ' ta yozuv · kurs: cbu.uz</p>';
    return h;
  }

  // ---------- actions ----------

  function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }

  function addTx(t) { db.tx.push(t); return t.id; }

  var ACTIONS = {
    setup: function () {
      var v = function (id) { return num(document.getElementById(id).value) || 0; };
      db.accounts = [
        { id: 'cash', name: 'Naqd', ccy: 'UZS', start: Math.round(v('s-cash')) },
        { id: 'card', name: 'Bank kartasi', ccy: 'UZS', start: Math.round(v('s-card')) },
        { id: 'usd', name: 'Naqd dollar', ccy: 'USD', start: Math.round(v('s-usd') * 100) }
      ];
      db.settings.plan = Math.round(v('s-plan'));
      save(); fetchRate(); go('#asosiy');
    },
    demo: function () { demoData(); save(); toast('Namuna yuklandi'); go('#asosiy'); fetchRate(false); },
    kind: function (el) {
      var k = ui.k, v = el.getAttribute('data-v');
      k.kind = v;
      if (v !== 'move') k.cat = usageOrder(v)[0].id;
      k.allCats = false; render();
    },
    cat: function (el) { ui.k.cat = el.getAttribute('data-v'); render(); },
    allCats: function () { ui.k.allCats = true; render(); },
    pickAcc: function (el) {
      var f = el.getAttribute('data-f'), v = el.getAttribute('data-v');
      if (f === 'textAcc') { ui.textAcc = v; document.getElementById('text-preview').innerHTML = tr(textPreview()); return; }
      if (f === 'smsAcc') { ui.smsAcc = v; document.getElementById('sms-preview').innerHTML = tr(smsPreview()); return; }
      var k = ui.k, before = accById(k[f]);
      k[f] = v;
      if (f === 'acc' && before && accById(v).ccy !== before.ccy) k.amount = '';
      if (f === 'toAcc' || f === 'acc') k.toAmount = '';
      render();
    },
    swapCcy: function () {
      var k = ui.k, acc = accById(k.acc), other = accsOf(acc && acc.ccy === 'USD' ? 'UZS' : 'USD')[0];
      if (!other) { toast(acc && acc.ccy === 'USD' ? 'Soʻm hisobi yoʻq' : 'Dollar hisobi yoʻq: Hisoblar boʻlimida qoʻshing'); return; }
      k.acc = other.id; k.amount = ''; render();
    },
    key: function (el) {
      var k = ui.k, x = el.getAttribute('data-v'), a = k.amount;
      if (x === 'del') a = a.slice(0, -1);
      else if (x === ',') { if (a.indexOf(',') < 0) a = (a || '0') + ','; }
      else if (a.replace(',', '').length < 12) {
        if (a.indexOf(',') >= 0 && a.split(',')[1].length >= 2) return;
        a = (a === '0' ? '' : a) + x;
      }
      k.amount = a.replace(/^0+(?=\d)/, '');
      render();
    },
    saveEntry: function () {
      var k = ui.k, old = k.editId ? db.tx.filter(function (t) { return t.id === k.editId; })[0] : null;
      var r = buildTx(k, old);
      if (r.error) { toast(r.error); return; }
      if (old) { db.tx[db.tx.indexOf(old)] = r.tx; save(); toast('Oʻzgartirildi'); go('#tarix'); return; }
      addTx(r.tx); save();
      var c = r.tx.kind === 'move' ? 'Oʻtkazma' : catById(r.tx.cat).name;
      toast(c + ' · ' + money(r.tx.amount, r.tx.ccy), { act: 'undo', v: r.tx.id });
      ui.k = null; go('#asosiy');
    },
    deleteEntry: function () {
      var id = ui.k.editId, t = db.tx.filter(function (x) { return x.id === id; })[0];
      if (!t) return;
      ui.removed = [t]; db.tx = db.tx.filter(function (x) { return x.id !== id; }); save();
      toast('Yozuv oʻchirildi', { act: 'restore', v: id }); go('#tarix');
    },
    undo: function (el) {
      var ids = el.getAttribute('data-v').split(',');
      db.tx = db.tx.filter(function (t) { return ids.indexOf(t.id) < 0; });
      save(); document.getElementById('toast').innerHTML = ''; render();
    },
    restore: function () {
      if (ui.removed) { db.tx = db.tx.concat(ui.removed); ui.removed = null; save(); }
      document.getElementById('toast').innerHTML = ''; render();
    },
    saveText: function () {
      var items = textItems().filter(function (x) { return x.ok; }), ids = [], r = rateNow(), skipped = 0;
      items.forEach(function (x) {
        var a = accountFor(x.ccy, ui.textAcc || (accsOf('UZS')[0] || {}).id);
        if (!a) { skipped++; return; }
        ids.push(addTx({ id: uid(), date: today(), kind: x.kind, amount: x.amount, ccy: x.ccy, acc: a.id, cat: x.cat, note: x.name, rate: r,
          uzs: E.toUZS(x.amount, x.ccy, r), created: Date.now() + ids.length }));
      });
      if (!ids.length) { toast('Mos hisob yoʻq'); return; }
      save(); ui.text = '';
      toast(ids.length + ' ta yozuv saqlandi' + (skipped ? ', ' + skipped + ' tasi hisob yoʻqligi uchun qoldi' : ''), { act: 'undo', v: ids.join(',') });
      go('#asosiy');
    },
    pasteSms: function () {
      if (!navigator.clipboard || !navigator.clipboard.readText) { toast('Matn maydoniga bosib, “Вставить”ni tanlang'); return; }
      navigator.clipboard.readText().then(function (s) {
        ui.sms = s || ''; var f = document.querySelector('[data-field=sms]'); if (f) f.value = ui.sms;
        document.getElementById('sms-preview').innerHTML = tr(smsPreview());
      }).catch(function () { toast('Ruxsat berilmadi: matn maydoniga qoʻlda qoʻying'); });
    },
    saveSms: function () {
      var x = smsResult();
      if (!x || !x.acc) return;
      var r = rateNow(), id = addTx({ id: uid(), date: today(), kind: x.kind, amount: x.amount, ccy: x.acc.ccy === x.ccy ? x.ccy : x.acc.ccy,
        acc: x.acc.id, cat: x.cat, note: x.name, rate: r, uzs: E.toUZS(x.amount, x.ccy, r), created: Date.now() });
      if (x.acc.ccy !== x.ccy) { var t = db.tx[db.tx.length - 1]; t.amount = x.acc.ccy === 'USD' ? Math.round(t.uzs / r * 100) : t.uzs; }
      save(); ui.sms = '';
      toast(x.name + ' · ' + money(x.amount, x.ccy), { act: 'undo', v: id }); go('#asosiy');
    },
    month: function (el) {
      var m = ui.month || E.monthOf(today());
      ui.month = E.addMonths(m, Number(el.getAttribute('data-v'))); render();
    },
    ccyView: function (el) { ui.ccyView = el.getAttribute('data-v'); render(); },
    editLimits: function () { ui.editLimits = !ui.editLimits; render(); },
    form: function (el) { ui.form = el.getAttribute('data-v') || null; render(); },
    debtDir: function (el) { ui.debtDir = el.getAttribute('data-v'); render(); },
    saveRec: function () {
      var g = function (id) { return document.getElementById(id).value; };
      var acc = accById(g('r-acc')), amount = num(g('r-amount')), day = Math.round(num(g('r-day')) || 0);
      if (!g('r-name').trim() || !(amount > 0) || day < 1 || day > 31 || !acc) { toast('Nomi, summa va kunni kiriting'); return; }
      db.recurring.push({ id: uid(), name: g('r-name').trim(), amount: E.toMinor(amount, acc.ccy), ccy: acc.ccy, acc: acc.id, cat: g('r-cat'), day: day, paid: null });
      ui.form = null; save(); render();
    },
    payRec: function (el) {
      var r = db.recurring.filter(function (x) { return x.id === el.getAttribute('data-v'); })[0];
      if (!r) return;
      var acc = accById(r.acc) || db.accounts[0], rate = rateNow();
      var id = addTx({ id: uid(), date: today(), kind: 'out', amount: r.amount, ccy: r.ccy, acc: acc.id, cat: r.cat, note: r.name, rate: rate,
        uzs: E.toUZS(r.amount, r.ccy, rate), created: Date.now() });
      r.paid = E.monthOf(today()); save();
      toast(r.name + ' yozildi · ' + money(r.amount, r.ccy)); render();
      return id;
    },
    delRec: function (el) { db.recurring = db.recurring.filter(function (x) { return x.id !== el.getAttribute('data-v'); }); save(); render(); },
    saveDebt: function () {
      var g = function (id) { return document.getElementById(id).value; }, ccy = g('d-ccy'), amount = num(g('d-amount'));
      if (!g('d-who').trim() || !(amount > 0)) { toast('Kim va summani kiriting'); return; }
      db.debts.push({ id: uid(), dir: ui.debtDir || 'gave', who: g('d-who').trim(), amount: E.toMinor(amount, ccy), ccy: ccy, due: g('d-due') || null, closed: false });
      ui.form = null; save(); render();
    },
    closeDebt: function (el) {
      var d = db.debts.filter(function (x) { return x.id === el.getAttribute('data-v'); })[0];
      if (d) { d.closed = today(); save(); toast('Qarz yopildi'); render(); }
    },
    saveGoal: function () {
      var g = function (id) { return document.getElementById(id).value; }, ccy = g('g-ccy'), target = num(g('g-target'));
      if (!g('g-name').trim() || !(target > 0)) { toast('Maqsad va summani kiriting'); return; }
      db.goals.push({ id: uid(), name: g('g-name').trim(), target: E.toMinor(target, ccy), ccy: ccy, saved: 0 });
      ui.form = null; save(); render();
    },
    goalAdd: function (el) {
      var g = db.goals.filter(function (x) { return x.id === el.getAttribute('data-v'); })[0], v = num(document.getElementById('g-add').value);
      if (!g || !v) return;
      g.saved += E.toMinor(v, g.ccy); ui.form = null; save(); render();
    },
    delGoal: function (el) { db.goals = db.goals.filter(function (x) { return x.id !== el.getAttribute('data-v'); }); save(); render(); },
    saveAcc: function (el) {
      var id = el.getAttribute('data-v'), a = accById(id), name = document.getElementById('a-name').value.trim();
      if (!name) { toast('Nomini kiriting'); return; }
      var ccy = a ? a.ccy : document.getElementById('a-ccy').value, start = num(document.getElementById('a-start').value) || 0;
      var card = document.getElementById('a-card').value.replace(/\D/g, '').slice(0, 4) || null;
      if (!a) { a = { id: uid(), ccy: ccy }; db.accounts.push(a); }
      a.name = name; a.start = E.toMinor(start, ccy); a.card = card;
      ui.form = null; save(); render();
    },
    delAcc: function (el) { db.accounts = db.accounts.filter(function (a) { return a.id !== el.getAttribute('data-v'); }); ui.form = null; save(); render(); },
    refreshRate: function () { fetchRate(true); },
    rateMode: function (el) { db.settings.rateMode = el.getAttribute('data-v'); save(); render(); },
    script: function (el) { db.settings.script = el.getAttribute('data-v'); save(); render(); },
    export: function () {
      var name = 'hamyon-' + today() + '.json', file = new File([JSON.stringify(db, null, 2)], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { navigator.share({ files: [file], title: name }).catch(function () { /* closed */ }); return; }
      var a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    },
    clearAll: function () {
      if (!confirm('Hamma yozuvlar, hisoblar va rejalar oʻchiriladi. Davom etilsinmi?')) return;
      db = normalize({}); save(); go('#asosiy');
    }
  };

  function importFile(input) {
    var f = input.files && input.files[0];
    if (!f) return;
    f.text().then(function (text) {
      var data = normalize(JSON.parse(text));
      if (!confirm(data.tx.length + ' ta yozuv topildi. Joriy maʼlumotlar almashtirilsinmi?')) return;
      db = data; save(); toast('Tiklandi'); go('#asosiy');
    }).catch(function () { toast('Fayl oʻqilmadi'); });
  }

  // ---------- exchange rate ----------

  function fetchRate(manual) {
    if (ui.rateBusy) return;
    ui.rateBusy = true;
    if (manual) render();
    fetch(CBU_URL).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (d) {
      var x = d && d[0], rate = x && parseFloat(x.Rate), p = x && String(x.Date).split('.');
      if (!rate || !p || p.length !== 3) throw new Error('format');
      db.rates[p[2] + '-' + p[1] + '-' + p[0]] = rate; save();
      if (manual) toast('Kurs yangilandi: ' + E.fmtNum(rate) + ' soʻm');
    }).catch(function () {
      if (manual) toast('Kursni yuklab boʻlmadi. Internetni tekshiring.');
    }).then(function () { ui.rateBusy = false; render(); });
  }

  // ---------- demo ----------

  function demoData() {
    var seed = 7, rnd = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    var t = today(), start = E.addMonths(E.monthOf(t), -2) + '-01', rate = 11930;
    db = normalize({ settings: { script: db.settings.script, plan: 12000000 } });
    db.accounts = [
      { id: 'cash', name: 'Naqd', ccy: 'UZS', start: 2500000 },
      { id: 'humo', name: 'Humo karta', ccy: 'UZS', start: 6000000, card: '4417' },
      { id: 'uzcard', name: 'Uzcard karta', ccy: 'UZS', start: 1500000, card: '0921' },
      { id: 'usd', name: 'Naqd dollar', ccy: 'USD', start: 150000 }
    ];
    db.limits = { food: 4000000, taxi: 600000, kids: 1500000, cafe: 800000 };
    var add = function (date, kind, amount, acc, cat, note) {
      var a = accById(acc), r = rate + Math.round(rnd() * 60);
      db.tx.push({ id: uid() + db.tx.length, date: date, kind: kind, amount: amount, ccy: a.ccy, acc: acc, cat: cat, note: note || '', rate: r,
        uzs: E.toUZS(amount, a.ccy, r), created: E.keyToDate(date).getTime() + db.tx.length });
    };
    for (var d = start; d <= t; d = E.addDays(d, 1)) {
      var dom = +d.slice(8, 10);
      rate += 1;
      if (dom === 5) add(d, 'in', 9500000, 'humo', 'salary', 'Oylik');
      if (dom === 20) add(d, 'in', 5000000, 'uzcard', 'salary', 'Avans');
      if (dom === 2) { add(d, 'out', 900000, 'humo', 'kids', 'Bogʻcha'); add(d, 'out', 150000, 'humo', 'phone', 'Internet'); }
      if (dom === 10) add(d, 'out', 380000 + Math.round(rnd() * 80) * 1000, 'humo', 'util', 'Gaz, svet, suv');
      if (dom === 6) add(d, 'out', 2100000, 'uzcard', 'credit', 'Kredit');
      if (dom === 7 || dom === 21) {
        db.tx.push({ id: uid() + db.tx.length, date: d, kind: 'move', amount: 2000000, ccy: 'UZS', acc: 'humo', toAcc: 'cash', toAmount: 2000000,
          rate: rate, uzs: 2000000, created: E.keyToDate(d).getTime() + db.tx.length });
      }
      add(d, 'out', 8000, 'cash', 'food', 'Non');
      if (rnd() < 0.45) add(d, 'out', Math.round(60 + rnd() * 200) * 1000, 'humo', 'food', rnd() < 0.5 ? 'Korzinka' : 'Makro');
      if (rnd() < 0.18) add(d, 'out', Math.round(250 + rnd() * 250) * 1000, 'cash', 'food', 'Bozor');
      if (rnd() < 0.5) add(d, 'out', Math.round(15 + rnd() * 30) * 1000, 'humo', 'taxi', 'Taksi');
      if (rnd() < 0.15) add(d, 'out', Math.round(40 + rnd() * 120) * 1000, 'humo', 'cafe', 'Kafe');
      if (rnd() < 0.08) add(d, 'out', Math.round(30 + rnd() * 150) * 1000, 'cash', 'health', 'Dorixona');
      if (rnd() < 0.06) add(d, 'out', Math.round(100 + rnd() * 400) * 1000, 'humo', 'home', 'Uy uchun');
      if (rnd() < 0.04) add(d, 'out', 500000, 'cash', 'gift', 'Toʻyona');
      if (rnd() < 0.05) add(d, 'out', Math.round(20 + rnd() * 80) * 1000, 'cash', 'charity', 'Sadaqa');
    }
    db.recurring = [
      { id: 'r1', name: 'Bogʻcha', amount: 900000, ccy: 'UZS', acc: 'humo', cat: 'kids', day: 2, paid: E.monthOf(t) },
      { id: 'r2', name: 'Kredit', amount: 2100000, ccy: 'UZS', acc: 'uzcard', cat: 'credit', day: 6, paid: +t.slice(8, 10) >= 6 ? E.monthOf(t) : null },
      { id: 'r3', name: 'Internet', amount: 150000, ccy: 'UZS', acc: 'humo', cat: 'phone', day: 2, paid: E.monthOf(t) }
    ];
    db.debts = [
      { id: 'd1', dir: 'gave', who: 'Qarindoshga', amount: 30000, ccy: 'USD', due: E.addDays(t, 45), closed: false },
      { id: 'd2', dir: 'took', who: 'Doʻkon (nasiya)', amount: 450000, ccy: 'UZS', due: E.addDays(t, 10), closed: false }
    ];
    db.goals = [{ id: 'g1', name: 'Yozgi taʼtil', target: 300000, ccy: 'USD', saved: 120000 }];
    if (!Object.keys(db.rates).length) db.rates[t] = rate;
  }

  // ---------- render ----------

  function route() {
    var parts = (location.hash || '#asosiy').slice(1).split('/');
    return { name: parts[0] || 'asosiy', arg: parts[1] || null };
  }

  function enter(r) {
    ui.form = null; ui.editLimits = false;
    if (r.name === 'qoshish') ui.k = newEntry(r.arg === 'move' || r.arg === 'in' ? r.arg : 'out');
    if (r.name === 'yozuv') {
      var t = db.tx.filter(function (x) { return x.id === r.arg; })[0];
      ui.k = t ? entryFrom(t) : null;
    }
    if (r.name === 'tarix' || r.name === 'tahlil') ui.month = ui.month || null;
    if (r.name === 'qoshish' && r.arg === 'move' && db.accounts.length > 1) { ui.k.acc = db.accounts[0].id; ui.k.toAcc = db.accounts[1].id; }
  }

  function render() {
    var r = route(), key = r.name + '/' + (r.arg || '');
    if (!db.accounts.length && r.name !== 'setup') r = { name: 'setup' };
    if (ui.route !== key) { enter(r); ui.route = key; window.scrollTo(0, 0); }
    var views = { asosiy: viewMain, qoshish: viewAdd, yozuv: viewAdd, matn: viewText, tarix: viewHistory, tahlil: viewAnalysis,
      rejalar: viewPlans, hisoblar: viewAccounts, sozlamalar: viewSettings, setup: viewSetup };
    var view = views[r.name] || viewMain;
    if ((r.name === 'qoshish' || r.name === 'yozuv') && !ui.k) view = viewMain;
    document.getElementById('app').innerHTML = tr(view());
    // user text stays as typed, so it is set after transliteration
    var tf = document.querySelector('[data-field=text]'), sf = document.querySelector('[data-field=sms]');
    if (tf) tf.value = ui.text;
    if (sf) sf.value = ui.sms;

    var full = r.name === 'qoshish' || r.name === 'yozuv' || r.name === 'matn' || r.name === 'setup';
    var dock = document.getElementById('dock');
    dock.hidden = full;
    document.getElementById('tabs').innerHTML = tr(TABS.map(function (t) {
      var on = t[0] === r.name || (t[0] === 'asosiy' && (r.name === 'tarix' || r.name === 'sozlamalar'));
      return '<a href="#' + t[0] + '"' + (on ? ' aria-current="page"' : '') + '>' + icon(t[2], 22) + '<span>' + t[1] + '</span></a>';
    }).join(''));
    document.getElementById('fab').setAttribute('aria-label', tr('Yozuv qoʻshish'));
    document.documentElement.lang = db.settings.script === 'cyr' ? 'uz-Cyrl' : 'uz';
  }

  // ---------- wiring ----------

  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-act]');
    if (!el || !ACTIONS[el.getAttribute('data-act')]) return;
    if (el.tagName !== 'A') ev.preventDefault();
    ACTIONS[el.getAttribute('data-act')](el, ev);
  });

  document.addEventListener('input', function (ev) {
    var f = ev.target.getAttribute('data-field'), v = ev.target.value;
    if (!f) return;
    if (f === 'text') { ui.text = v; document.getElementById('text-preview').innerHTML = tr(textPreview()); return; }
    if (f === 'sms') { ui.sms = v; document.getElementById('sms-preview').innerHTML = tr(smsPreview()); return; }
    if (f === 'note' && ui.k) ui.k.note = v;
    if (f === 'toAmount' && ui.k) ui.k.toAmount = v;
  });

  document.addEventListener('change', function (ev) {
    var el = ev.target, f = el.getAttribute('data-field');
    if (el.getAttribute('data-change') === 'import') { importFile(el); el.value = ''; return; }
    if (f === 'date' && ui.k) { ui.k.date = el.value || today(); return; }
    if (f === 'toAmount' && ui.k) { render(); return; }
    if (f === 'plan') { db.settings.plan = Math.round(num(el.value) || 0); save(); render(); return; }
    if (f === 'market') { db.settings.market = num(el.value); save(); render(); return; }
    if (f === 'limit') {
      var id = el.getAttribute('data-v'), v = num(el.value);
      if (v > 0) db.limits[id] = Math.round(v); else delete db.limits[id];
      save();
    }
  });

  window.addEventListener('hashchange', render);

  render();
  // refresh the official rate once a day when online
  if (db.accounts.length && !db.rates[today()]) fetchRate(false);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function () { /* offline cache is optional */ });
})();
