// Encrypted daily backup to the owner's own Telegram bot. The same file is used in all three apps.
// Settings live under their own key, so the token and password never enter the app's data or exports.
(function (root) {
  'use strict';

  var API = 'https://api.telegram.org/bot';
  var FORMAT = 'zaxira-1', ITER = 210000, RETRY = 3600000, DAY = 86400000;
  var LINK = 'zaxira:';

  // ---------- pure: encryption ----------

  function toB64(buf) {
    var a = new Uint8Array(buf), s = '';
    for (var i = 0; i < a.length; i += 8192) s += String.fromCharCode.apply(null, a.subarray(i, i + 8192));
    return btoa(s);
  }
  function fromB64(s) {
    var bin = atob(s), a = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }
  function aesKey(pass, salt, iter) {
    return crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt, iterations: iter }, base,
        { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
  }
  function encrypt(text, pass, app) {
    var salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    return aesKey(pass, salt, ITER).then(function (key) {
      return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(text));
    }).then(function (data) {
      return JSON.stringify({ format: FORMAT, app: app, iter: ITER, salt: toB64(salt), iv: toB64(iv), data: toB64(data) });
    });
  }
  function isEncrypted(text) {
    try { return JSON.parse(text).format === FORMAT; } catch (e) { return false; }
  }
  // rejects on a wrong password
  function decrypt(text, pass) {
    var f = JSON.parse(text);
    return aesKey(pass, fromB64(f.salt), f.iter).then(function (key) {
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(f.iv) }, key, fromB64(f.data));
    }).then(function (plain) { return new TextDecoder().decode(plain); });
  }

  // ---------- pure: schedule ----------

  function hash(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) | 0;
    return s.length + '.' + h;
  }
  function sameDay(a, b) { return new Date(a).toDateString() === new Date(b).toDateString(); }
  // once a calendar day, only if the data changed, with a pause after a failed try
  function isDue(st, sum, now) {
    if (!st.token || !st.chat || !st.pass) return false;
    if (st.lastOk && sameDay(st.lastOk, now)) return false;
    if (st.lastHash === sum) return false;
    return !st.lastTry || st.lastOk === st.lastTry || now - st.lastTry >= RETRY;
  }
  // days since any backup, when that is long enough to warn about; otherwise 0
  function overdueDays(st, now) {
    var from = Math.max(st.lastOk || 0, st.lastManual || 0, st.firstSeen || now);
    var days = Math.floor((now - from) / DAY);
    return days >= (st.chat ? 7 : 14) ? days : 0;
  }

  function encodeLink(st) { return LINK + btoa(JSON.stringify({ t: st.token, c: st.chat, p: st.pass, b: st.bot })); }
  function decodeLink(code) {
    code = String(code).trim();
    if (code.indexOf(LINK) !== 0) return null;
    try {
      var o = JSON.parse(atob(code.slice(LINK.length)));
      return o.t && o.c && o.p ? { token: o.t, chat: o.c, pass: o.p, bot: o.b } : null;
    } catch (e) { return null; }
  }

  // ---------- Telegram ----------

  function call(token, method, body, fetchFn) {
    return (fetchFn || fetch)(API + token + '/' + method, body ? { method: 'POST', body: body } : {}).then(function (r) {
      return r.json();
    }).then(function (j) {
      if (!j.ok) { var e = new Error(j.description || 'Telegram'); e.code = j.error_code; throw e; }
      return j.result;
    });
  }
  function sendFile(st, name, text, caption, fetchFn) {
    var form = new FormData();
    form.append('chat_id', st.chat);
    form.append('caption', caption);
    form.append('disable_notification', 'true');
    form.append('document', new Blob([text], { type: 'application/json' }), name);
    return call(st.token, 'sendDocument', form, fetchFn);
  }
  function errorText(e) {
    if (e && e.code === 401) return 'Bot kaliti notoʻgʻri';
    if (e && e.code === 403) return 'Bot bloklangan: botda Start bosing';
    if (e && e.code === 400) return 'Bot sizni topmadi: botda Start bosing';
    if (e && e.code) return 'Telegram xatosi: ' + e.code;
    return 'Internet yoki Telegram bilan aloqa yoʻq';
  }

  // ---------- app side ----------

  var cfg = null, st = {}, busy = false, draft = { token: '', pass: '' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function keep() {
    try { localStorage.setItem(cfg.name + '-backup', JSON.stringify(st)); } catch (e) { /* retried on the next change */ }
  }
  function refresh() {
    var box = document.querySelector('[data-bk-box]');
    if (box) box.innerHTML = cfg.tr(inner());
  }
  function when(ts) {
    var d = new Date(ts), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function today() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function run(force) {
    if (busy || !cfg.hasData()) return Promise.resolve(false);
    var text = JSON.stringify(cfg.getData()), sum = hash(text), now = Date.now();
    if (!force && !isDue(st, sum, now)) return Promise.resolve(false);
    busy = true; st.lastTry = now; keep(); refresh();
    return encrypt(text, st.pass, cfg.name).then(function (file) {
      return sendFile(st, cfg.name + '-' + today() + '.json', file, cfg.title + ' zaxirasi · ' + when(now));
    }).then(function () {
      st.lastOk = now; st.lastHash = sum; st.lastError = null;
      return true;
    }).catch(function (e) {
      st.lastError = errorText(e);
      return false;
    }).then(function (ok) {
      busy = false; keep(); refresh();
      return ok;
    });
  }
  function tick() { if (!document.hidden && navigator.onLine !== false) run(false); }

  function inner() {
    var h = '<b style="font-size:17px">Telegramga avtomatik zaxira</b>';
    if (st.token && st.chat) {
      h += '<span class="small">Ulangan: <code class="bk-name">@' + esc(st.bot) + '</code>. Ilova har kuni birinchi ochilganda maʼlumot oʻzgargan boʻlsa, shifrlangan nusxani botga yuboradi.</span>';
      h += '<span class="small' + (st.lastError ? '' : ' muted') + '">' + (busy ? 'Yuborilmoqda…' : (st.lastOk ? 'Oxirgi zaxira: ' + when(st.lastOk) : 'Hali zaxira yuborilmagan') +
        (st.lastError ? '. Oxirgi urinish: ' + esc(st.lastError) : '')) + '</span>';
      h += '<button class="btn secondary block" data-bk="now">Hozir yuborish</button>' +
        '<button class="btn secondary block" data-bk="copy">Boshqa ilova uchun ulash kodi</button>' +
        '<span class="tiny muted">Kod boshqa ilovani bir bosishda ulaydi. Unda parol ham bor: hech kimga bermang. Zaxirani tiklash uchun parol kerak, unutilsa, zaxirani ochib boʻlmaydi.</span>' +
        '<button class="btn danger block" data-bk="reset">Uzish</button>';
    } else if (st.token) {
      h += '<span class="small">Endi botingizni oching va <b>Start</b> ni bosing, keyin shu yerga qaytib pastdagi tugmani bosing.</span>' +
        '<a class="btn secondary block" href="https://t.me/' + encodeURIComponent(st.bot) + '" target="_blank" rel="noopener"><code class="bk-name">@' + esc(st.bot) + '</code> ni ochish</a>' +
        '<button class="btn block" data-bk="find">Start bosdim</button>' +
        '<button class="btn danger block" data-bk="reset">Bekor qilish</button>';
    } else {
      h += '<span class="small">Telegramda <code class="bk-name">@BotFather</code> ni oching, <code class="bk-name">/newbot</code> yuboring, botga nom bering va u bergan kalitni nusxalang. Boshqa ilovada ulagan boʻlsangiz, shu yerga ulash kodini qoʻying.</span>' +
        '<label class="field"><span>Bot kaliti yoki ulash kodi</span><input class="input" data-bk-field="token" autocomplete="off" autocapitalize="off" spellcheck="false" value="' + esc(draft.token) + '" placeholder="123456:…"></label>' +
        '<label class="field"><span>Zaxira paroli (kamida 6 belgi)</span><input class="input" type="password" data-bk-field="pass" autocomplete="new-password" value="' + esc(draft.pass) + '"></label>' +
        '<span class="tiny muted">Fayl shu parol bilan shifrlanadi, uni Telegram ham oʻqiy olmaydi. Parolni yozib qoʻying: unutilsa, zaxirani ochib boʻlmaydi.</span>' +
        '<button class="btn block" data-bk="connect"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Tekshirilmoqda…' : 'Davom etish') + '</button>';
    }
    return h;
  }

  var ACTIONS = {
    connect: function () {
      var linked = decodeLink(draft.token);
      if (linked) {
        Object.assign(st, linked); draft = { token: '', pass: '' }; keep(); refresh();
        cfg.toast('Ulandi');
        run(true);
        return;
      }
      var token = draft.token.trim();
      if (!/^\d+:[\w-]+$/.test(token)) { cfg.toast('Bot kalitini toʻliq nusxalang'); return; }
      if (draft.pass.length < 6) { cfg.toast('Parol kamida 6 belgi boʻlsin'); return; }
      busy = true; refresh();
      call(token, 'getMe').then(function (me) {
        st.token = token; st.pass = draft.pass; st.bot = me.username;
        draft = { token: '', pass: '' }; keep();
      }).catch(function (e) { cfg.toast(errorText(e)); }).then(function () { busy = false; refresh(); });
    },
    find: function () {
      call(st.token, 'getUpdates').then(function (ups) {
        var chat = null;
        ups.forEach(function (u) { if (u.message && u.message.chat && u.message.chat.type === 'private') chat = u.message.chat.id; });
        if (!chat) { cfg.toast('Xabar hali kelmadi. Botda Start bosing'); return; }
        st.chat = chat; keep(); refresh();
        cfg.toast('Ulandi. Birinchi zaxira yuborilmoqda');
        run(true);
      }).catch(function (e) { cfg.toast(errorText(e)); });
    },
    now: function () {
      run(true).then(function (ok) { cfg.toast(ok ? 'Zaxira yuborildi' : (st.lastError || 'Yuborib boʻlmadi')); });
    },
    copy: function () {
      var code = encodeLink(st), done = function () { cfg.toast('Kod nusxalandi'); };
      if (navigator.clipboard) navigator.clipboard.writeText(code).then(done, function () { prompt('Kodni nusxalang', code); });
      else prompt('Kodni nusxalang', code);
    },
    reset: function () {
      if (!confirm('Telegramga zaxira toʻxtatilsinmi? Yuborilgan fayllar chatda qoladi.')) return;
      ['token', 'chat', 'pass', 'bot', 'lastOk', 'lastTry', 'lastHash', 'lastError'].forEach(function (k) { delete st[k]; });
      keep(); refresh();
    }
  };

  var api = {
    encrypt: encrypt, decrypt: decrypt, isEncrypted: isEncrypted, hash: hash, isDue: isDue, overdueDays: overdueDays,
    encodeLink: encodeLink, decodeLink: decodeLink, sendFile: sendFile, errorText: errorText,

    // cfg: { name, title, getData, hasData, toast, tr? }
    setup: function (c) {
      cfg = Object.assign({ tr: function (x) { return x; } }, c);
      try { st = JSON.parse(localStorage.getItem(cfg.name + '-backup')) || {}; } catch (e) { st = {}; }
      if (!st.firstSeen) { st.firstSeen = Date.now(); keep(); }
      document.addEventListener('click', function (ev) {
        var el = ev.target.closest('[data-bk]');
        if (!el) return;
        ev.preventDefault();
        ACTIONS[el.getAttribute('data-bk')]();
      });
      document.addEventListener('input', function (ev) {
        var f = ev.target.getAttribute && ev.target.getAttribute('data-bk-field');
        if (f) draft[f] = ev.target.value;
      });
      document.addEventListener('visibilitychange', tick);
      window.addEventListener('online', tick);
      setTimeout(tick, 1500);
    },
    html: function () { return '<section class="card" data-bk-box>' + inner() + '</section>'; },
    // reminder text for the home screen, or null
    reminder: function () {
      if (!cfg.hasData()) return null;
      var days = overdueDays(st, Date.now());
      if (!days) return null;
      return st.chat ? 'Telegramga zaxira ' + days + ' kundan beri ketmayapti. Bosib tekshiring.'
        : 'Maʼlumotlar zaxirasi ' + days + ' kundan beri olinmagan. Bosib Telegramga ulang.';
    },
    noteManual: function () { st.lastManual = Date.now(); keep(); },
    // backup file text -> plain JSON text; asks for the password when the saved one does not fit
    open: function (text) {
      if (!isEncrypted(text)) return Promise.resolve(text);
      var ask = function () {
        var pass = prompt('Zaxira paroli');
        if (!pass) return Promise.reject(Object.assign(new Error('cancel'), { userMsg: 'Parol kiritilmadi' }));
        return decrypt(text, pass).catch(function () {
          throw Object.assign(new Error('password'), { userMsg: 'Parol notoʻgʻri' });
        });
      };
      return st.pass ? decrypt(text, st.pass).catch(ask) : ask();
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Backup = api;
})(this);
