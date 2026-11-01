// Pure money, parsing, statistics and script functions. No DOM, no storage; "today" is passed in.
// Money is an integer in minor units: UZS in whole so'm, USD in cents. Dates are "YYYY-MM-DD".
(function (root) {
  'use strict';

  // ---------- dates ----------

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dateKey(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function keyToDate(key) {
    var p = key.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2], 12, 0, 0, 0);
  }
  function addDays(key, n) {
    var d = keyToDate(key);
    d.setDate(d.getDate() + n);
    return dateKey(d.getTime());
  }
  function monthOf(key) { return key.slice(0, 7); }
  function addMonths(month, n) {
    var y = +month.slice(0, 4), m = +month.slice(5, 7) - 1 + n;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return y + '-' + pad(m + 1);
  }
  function daysInMonth(month) { return new Date(+month.slice(0, 4), +month.slice(5, 7), 0).getDate(); }

  // ---------- money ----------

  function group(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }

  // 1234567 -> "1 234 567"; negative keeps a real minus sign
  function fmtNum(n) {
    n = Math.round(n);
    return (n < 0 ? '−' : '') + group(Math.abs(n));
  }

  function fmtMoney(minor, ccy, opts) {
    opts = opts || {};
    var sign = minor < 0 ? '−' : opts.plus && minor > 0 ? '+' : '', a = Math.abs(minor);
    if (ccy === 'USD') {
      var whole = Math.floor(a / 100), cents = a % 100;
      return sign + '$' + group(whole) + (cents ? ',' + pad(cents) : '');
    }
    return sign + group(a) + (opts.bare ? '' : ' soʻm');
  }

  // short form for tight places: 14 500 000 -> "14,5 mln"
  function fmtShort(uzs) {
    var a = Math.abs(uzs), s = uzs < 0 ? '−' : '';
    if (a >= 1e6) return s + String(Math.round(a / 1e4) / 100).replace('.', ',') + ' mln';
    if (a >= 1e4) return s + Math.round(a / 1e3) + ' ming';
    return s + group(a);
  }

  // value of an amount in so'm at the given rate (so'm per dollar)
  function toUZS(minor, ccy, rate) { return ccy === 'USD' ? Math.round(minor / 100 * rate) : minor; }
  function toMinor(value, ccy) { return ccy === 'USD' ? Math.round(value * 100) : Math.round(value); }

  // ---------- parsing typed amounts ----------

  var MULT = { k: 1e3, ming: 1e3, 'минг': 1e3, 'тыс': 1e3, mln: 1e6, million: 1e6, 'млн': 1e6 };
  var USD_WORD = /^(\$|usd|dollar|doll|долл|доллар)$/i;
  // number with optional thousands spaces and decimal comma/point, then optional multiplier and currency
  var AMOUNT_RE = /(\$\s?)?(\d{1,3}(?:[  ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)\s?(k|ming|mln|million|минг|тыс|млн)?\.?\s?(\$|usd|dollar|doll|долл|доллар)?(?=[\s,;.!]|$)/i;

  // finds the first amount in a piece of text; returns { value, ccy, index, length } or null
  function findAmount(text) {
    var m = AMOUNT_RE.exec(text);
    if (!m) return null;
    var v = parseFloat(m[2].replace(/[  ]/g, '').replace(',', '.'));
    if (m[3]) v *= MULT[m[3].toLowerCase()] || 1;
    var usd = !!m[1] || (m[4] && USD_WORD.test(m[4]));
    return { value: v, ccy: usd ? 'USD' : 'UZS', index: m.index, length: m[0].length };
  }

  // ---------- categories ----------

  function skey(s) { return String(s).toLowerCase().replace(/[ʻʼ’‘'`]/g, ''); }

  var LAT = { 'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'j', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k',
    'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'x', 'ц': 'ts', 'ч': 'ch',
    'ш': 'sh', 'ъ': 'ʼ', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya', 'ў': 'oʻ', 'қ': 'q', 'ғ': 'gʻ', 'ҳ': 'h', 'ы': 'i' };

  // Cyrillic -> current Latin, lower case; used to match words typed in Cyrillic
  function fromCyrillic(s) {
    return String(s).toLowerCase().replace(/[а-яёўқғҳ]/g, function (c) { return LAT[c] != null ? LAT[c] : c; });
  }

  // first category whose keyword starts one of the words in the text
  function detectCategory(text, cats) {
    var words = skey(fromCyrillic(text)).split(/[^a-z0-9]+/).filter(Boolean);
    for (var i = 0; i < cats.length; i++) {
      var kws = cats[i].kw || [];
      for (var j = 0; j < kws.length; j++) {
        var k = skey(kws[j]);
        if (words.some(function (w) { return w.indexOf(k) === 0; })) return cats[i].id;
      }
    }
    return null;
  }

  function capital(s) { s = String(s).trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  // "non 8 ming, sut 14 000, taksi 25k" -> items; parts without an amount come back with ok: false
  function parseLine(text, cats) {
    return String(text).split(/[,;\n]+/).map(function (part) {
      part = part.trim();
      if (!part) return null;
      var a = findAmount(part);
      if (!a || !a.value) return { text: part, ok: false };
      var name = (part.slice(0, a.index) + ' ' + part.slice(a.index + a.length)).replace(/\s+/g, ' ').trim();
      return { text: part, ok: true, name: capital(name) || 'Xarajat', amount: toMinor(a.value, a.ccy), ccy: a.ccy,
        cat: detectCategory(name, cats) };
    }).filter(Boolean);
  }

  // ---------- bank SMS / push notifications ----------

  var SMS_MONEY = /(\d{1,3}(?:[  ]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s?(UZS|USD|so[ʻ'’]?m|сум|сўм|\$)/gi;
  var INCOME_WORDS = /(kirim|tushum|tushdi|qabul|popolnen|zachislen|пополн|зачисл|поступ|refund|vozvrat|возврат)/i;
  var BALANCE_WORDS = /(balans|qoldiq|ostatok|остаток|баланс|dostupno|доступно)/i;
  var NOISE = /(karta|card|карт|balans|qoldiq|ostatok|остаток|баланс|xarid|pokupka|покупка|oplata|оплата|tolov|to'lov|summa|сумма|uzs|usd|списан|spisan|operats|операц|kirim|tushum|popolnen|пополн|зачисл|sms|kod|code|uzcard|humo|visa)/i;

  // reads amount, direction, card, merchant and balance from a bank message
  function parseSms(text, cats) {
    text = String(text || '').replace(/ /g, ' ');
    var found = [], m;
    SMS_MONEY.lastIndex = 0;
    while ((m = SMS_MONEY.exec(text))) {
      var ccy = /usd|\$/i.test(m[2]) ? 'USD' : 'UZS';
      var v = parseFloat(m[1].replace(/ /g, '').replace(',', '.'));
      var before = text.slice(Math.max(0, m.index - 24), m.index);
      found.push({ value: v, ccy: ccy, balance: BALANCE_WORDS.test(before) });
    }
    var main = found.filter(function (f) { return !f.balance; })[0];
    if (!main) return null;
    var bal = found.filter(function (f) { return f.balance; })[0];
    var card = (text.match(/\*+\s?(\d{4})/) || text.match(/(\d{4})\s*$/m) || [])[1] || null;
    var merchant = '';
    text.split(/[.;\n,:]+/).some(function (seg) {
      seg = seg.trim();
      if (seg.length < 3 || /\d/.test(seg) || NOISE.test(seg)) return false;
      merchant = seg.toLowerCase().replace(/(^|\s)\S/g, function (c) { return c.toUpperCase(); });
      return true;
    });
    return {
      kind: INCOME_WORDS.test(text) ? 'in' : 'out',
      amount: toMinor(main.value, main.ccy), ccy: main.ccy,
      balance: bal ? toMinor(bal.value, bal.ccy) : null,
      card: card, name: merchant || (INCOME_WORDS.test(text) ? 'Kirim' : 'Karta orqali'),
      cat: merchant ? detectCategory(merchant, cats) : null
    };
  }

  // ---------- typing and receipts ----------

  // what a money field shows while typing: "1250000,5" -> "1 250 000,5"; keeps a leading minus and up to 2 decimals
  function fmtTyping(s) {
    s = String(s == null ? '' : s).replace(/[^\d.,−-]/g, '');
    var neg = /^[−-]/.test(s);
    s = s.replace(/[−-]/g, '');
    var i = s.search(/[.,]/), whole = i < 0 ? s : s.slice(0, i), frac = i < 0 ? null : s.slice(i + 1).replace(/[.,]/g, '').slice(0, 2);
    whole = whole.replace(/^0+(?=\d)/, '');
    return (neg ? '-' : '') + group(whole) + (frac == null ? '' : ',' + frac);
  }

  // "186 500,00", "186,500.00", "186.500" -> whole so'm
  function receiptNumber(tok) {
    tok = tok.replace(/[\s ]/g, '');
    var m = /^(.*?)[.,](\d{2})$/.exec(tok), whole = m ? m[1] : tok;
    var v = parseInt(whole.replace(/[.,]/g, ''), 10);
    return isNaN(v) ? null : v + (m && +m[2] >= 50 ? 1 : 0);
  }

  var TOTAL_WORDS = /(jami|umumiy|итого|всего|жами|total|к оплате|to[ʻ'’`]?lov\s+summa)/i;
  var NOT_TOTAL = /(qqs|ндс|nds|vat|soliq|qaytim|сдача|chegirma|скидка|naqd|наличн|karta|карт|bank|terminal)/i;
  var SHOP_SKIP = /(chek|чек|stir|инн|inn|kassa|касс|sana|дата|vaqt|время|manzil|адрес|tel|fiskal|фиск|ofd|qr|xarid|покупк|smena|смена|№)/i;

  // reads the total and shop from receipt text copied with the phone's text recognition
  function parseReceipt(text, cats) {
    var lines = String(text || '').replace(/ /g, ' ').split(/\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    if (lines.length < 2) return null;
    var total = null;
    lines.forEach(function (l, i) {
      if (!TOTAL_WORDS.test(l) || NOT_TOTAL.test(l)) return;
      var toks = (l.match(/\d[\d\s.,]*\d|\d/g) || []).concat(lines[i + 1] && !/[a-zа-я]{3}/i.test(lines[i + 1]) ? lines[i + 1].match(/\d[\d\s.,]*\d|\d/g) || [] : []);
      toks.forEach(function (t) { var v = receiptNumber(t.trim()); if (v && (total == null || v > total)) total = v; });
    });
    if (!total) return null;
    var shop = '';
    lines.some(function (l) {
      var s = l.replace(/["«»“”]/g, '').replace(/(^|\s)(MChJ|MCHJ|XK|OOO|ООО|МЧЖ|ХК|LLC|AJ|АЖ|YaTT|ЯТТ)\.?(?=\s|$)/gi, ' ').replace(/\s+/g, ' ').trim();
      if (s.length < 3 || /\d{3}/.test(s) || SHOP_SKIP.test(s) || TOTAL_WORDS.test(s)) return false;
      shop = s === s.toUpperCase() ? s.toLowerCase().replace(/(^|\s)\S/g, function (c) { return c.toUpperCase(); }) : s;
      return true;
    });
    return { kind: 'out', amount: total, ccy: 'UZS', balance: null, card: null, receipt: true,
      name: shop || 'Chek', cat: detectCategory(shop, cats) || detectCategory(lines.join(' '), cats) };
  }

  // ---------- balances and statistics ----------

  // tx: { date, kind: 'out'|'in'|'move', amount, ccy, acc, toAcc, toAmount, cat, uzs, rate }
  function balances(accounts, txs) {
    var b = {};
    accounts.forEach(function (a) { b[a.id] = a.start || 0; });
    txs.forEach(function (t) {
      if (t.kind === 'out' && t.acc in b) b[t.acc] -= t.amount;
      if (t.kind === 'in' && t.acc in b) b[t.acc] += t.amount;
      if (t.kind === 'move') {
        if (t.acc in b) b[t.acc] -= t.amount;
        if (t.toAcc in b) b[t.toAcc] += t.toAmount != null ? t.toAmount : t.amount;
      }
    });
    return b;
  }

  // totals in so'm for one month, optionally only up to a day of the month
  function monthStats(txs, month, uptoDay) {
    var s = { inc: 0, exp: 0, expUsd: 0, byCat: {}, byCatUsd: {}, count: 0 };
    txs.forEach(function (t) {
      if (monthOf(t.date) !== month || t.kind === 'move') return;
      if (uptoDay && +t.date.slice(8, 10) > uptoDay) return;
      if (t.kind === 'in') { s.inc += t.uzs; return; }
      s.exp += t.uzs; s.count++;
      var usd = t.rate ? t.uzs / t.rate : 0;
      s.expUsd += usd;
      s.byCat[t.cat] = (s.byCat[t.cat] || 0) + t.uzs;
      s.byCatUsd[t.cat] = (s.byCatUsd[t.cat] || 0) + usd;
    });
    s.expUsd = Math.round(s.expUsd);
    return s;
  }

  // what can still be spent this month and per remaining day (today included)
  function safeToSpend(plan, spent, todayKey) {
    var month = monthOf(todayKey), day = +todayKey.slice(8, 10);
    var daysLeft = daysInMonth(month) - day + 1, left = plan - spent;
    return { left: left, daysLeft: daysLeft, perDay: left > 0 ? Math.floor(left / daysLeft / 1000) * 1000 : 0,
      pct: plan ? Math.round(spent / plan * 100) : 0 };
  }

  // last n months ending with `month`: [{ month, inc, exp }]
  function series(txs, month, n) {
    var out = [];
    for (var i = n - 1; i >= 0; i--) {
      var m = addMonths(month, -i), s = monthStats(txs, m);
      out.push({ month: m, inc: s.inc, exp: s.exp });
    }
    return out;
  }

  // compares a month with the previous one over the same days; null when there is nothing to compare
  function compareMonths(txs, month, todayKey) {
    var current = monthOf(todayKey) === month, day = current ? +todayKey.slice(8, 10) : null;
    var now = monthStats(txs, month, day), prev = monthStats(txs, addMonths(month, -1), day);
    if (!prev.exp) return null;
    var cats = {};
    Object.keys(now.byCat).concat(Object.keys(prev.byCat)).forEach(function (c) {
      cats[c] = (now.byCat[c] || 0) - (prev.byCat[c] || 0);
    });
    return { now: now, prev: prev, partial: current, pct: Math.round((now.exp - prev.exp) / prev.exp * 100), catDiff: cats };
  }

  // due date of a monthly payment: this month's until it is paid (may be overdue), then next month's
  function nextDue(day, todayKey, paidMonth) {
    var month = monthOf(todayKey);
    if (paidMonth === month) month = addMonths(month, 1);
    return month + '-' + pad(Math.min(day, daysInMonth(month)));
  }

  function daysBetween(a, b) { return Math.round((keyToDate(b) - keyToDate(a)) / 864e5); }

  // ---------- scripts: current Latin -> 2026 Latin / Cyrillic ----------

  // OʻRQ-1184 (signed 21 Oct 2026): Oʻ->Ö, Gʻ->Ğ, Sh->Ş, Ch->Ç
  function toNewLatin(s) {
    return String(s).replace(/([OoGg])[ʻ‘’'`]/g, function (m, c) { return { O: 'Ö', o: 'ö', G: 'Ğ', g: 'ğ' }[c]; })
      .replace(/S[Hh]/g, 'Ş').replace(/sh/g, 'ş').replace(/C[Hh]/g, 'Ç').replace(/ch/g, 'ç');
  }

  var CYR = [['yoʻ', 'йў'], ['oʻ', 'ў'], ['gʻ', 'ғ'], ['sh', 'ш'], ['ch', 'ч'], ['yo', 'ё'], ['yu', 'ю'], ['ya', 'я'], ['ye', 'е'], ['ʼ', 'ъ'],
    ['a', 'а'], ['b', 'б'], ['d', 'д'], ['e', 'е'], ['f', 'ф'], ['g', 'г'], ['h', 'ҳ'], ['i', 'и'], ['j', 'ж'], ['k', 'к'],
    ['l', 'л'], ['m', 'м'], ['n', 'н'], ['o', 'о'], ['p', 'п'], ['q', 'қ'], ['r', 'р'], ['s', 'с'], ['t', 'т'], ['u', 'у'],
    ['v', 'в'], ['x', 'х'], ['y', 'й'], ['z', 'з'], ['c', 'к'], ['w', 'в']]; // c, w only appear in brand names (Uzcard)

  // words whose Cyrillic spelling keeps the Russian form (months)
  var CYR_WORDS = { yanvar: 'январь', fevral: 'февраль', aprel: 'апрель', iyun: 'июнь', iyul: 'июль', sentabr: 'сентябрь',
    oktabr: 'октябрь', noyabr: 'ноябрь', dekabr: 'декабрь' };

  function toCyrillic(s) {
    s = String(s).replace(/([OoGg])[‘’'`]/g, '$1ʻ').replace(/[A-Za-z]+/g, function (w) {
      var c = CYR_WORDS[w.toLowerCase()];
      return c ? (w.charAt(0) !== w.charAt(0).toLowerCase() ? c.charAt(0).toUpperCase() + c.slice(1) : c) : w;
    });
    var low = s.toLowerCase(), out = '', i = 0;
    while (i < s.length) {
      var hit = null;
      for (var k = 0; k < CYR.length; k++) {
        if (low.substr(i, CYR[k][0].length) === CYR[k][0]) { hit = CYR[k]; break; }
      }
      if (!hit) { out += s[i]; i++; continue; }
      var ch = hit[1];
      // word-initial e is э (ekran -> экран)
      if (hit[0] === 'e' && (i === 0 || !/[a-zʻʼ]/i.test(s[i - 1]))) ch = 'э';
      if (s[i] !== low[i]) ch = ch.toUpperCase();
      out += ch; i += hit[0].length;
    }
    return out;
  }

  // converts visible text of an HTML string; tags, entities and attribute values stay (except a few visible ones)
  function translitHtml(html, fn) {
    var literal = false; // <code> holds names that must not change, like a bot name
    return String(html).split(/(<[^>]*>)/).map(function (part) {
      if (part.charAt(0) === '<') {
        if (/^<code\b/.test(part)) literal = true;
        if (/^<\/code/.test(part)) literal = false;
        return part.replace(/(placeholder|aria-label|title)="([^"]*)"/g, function (m, a, v) { return a + '="' + textOnly(v, fn) + '"'; });
      }
      return literal ? part : textOnly(part, fn);
    }).join('');
  }
  function textOnly(s, fn) {
    return s.split(/(&[a-z#0-9]+;)/i).map(function (p) { return p.charAt(0) === '&' && p.slice(-1) === ';' ? p : fn(p); }).join('');
  }

  var api = {
    pad: pad, dateKey: dateKey, keyToDate: keyToDate, addDays: addDays, monthOf: monthOf, addMonths: addMonths,
    daysInMonth: daysInMonth, daysBetween: daysBetween,
    fmtNum: fmtNum, fmtMoney: fmtMoney, fmtShort: fmtShort, toUZS: toUZS, toMinor: toMinor,
    findAmount: findAmount, skey: skey, fromCyrillic: fromCyrillic, detectCategory: detectCategory, parseLine: parseLine, parseSms: parseSms,
    fmtTyping: fmtTyping, parseReceipt: parseReceipt,
    balances: balances, monthStats: monthStats, safeToSpend: safeToSpend, series: series, compareMonths: compareMonths,
    nextDue: nextDue, toNewLatin: toNewLatin, toCyrillic: toCyrillic, translitHtml: translitHtml
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Engine = api;
})(this);
