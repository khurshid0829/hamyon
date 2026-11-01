const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine.js');

const CATS = [
  { id: 'food', kw: ['non', 'sut', 'bozor', 'korzinka', 'goʻsht'] },
  { id: 'taxi', kw: ['taksi', 'yandex', 'benzin', 'metan'] },
  { id: 'util', kw: ['gaz', 'svet'] }
];

test('money formatting: spaces for thousands, dollars with cents only when needed', () => {
  assert.equal(E.fmtMoney(186500, 'UZS'), '186 500 soʻm');
  assert.equal(E.fmtMoney(-8000, 'UZS'), '−8 000 soʻm');
  assert.equal(E.fmtMoney(120000, 'USD'), '$1 200');
  assert.equal(E.fmtMoney(1550, 'USD'), '$15,50');
  assert.equal(E.fmtMoney(15000, 'USD', { plus: true }), '+$150');
  assert.equal(E.fmtShort(14500000), '14,5 mln');
  assert.equal(E.fmtShort(420000), '420 ming');
});

test('currency conversion keeps integers', () => {
  assert.equal(E.toUZS(10000, 'USD', 12023.46), 1202346);
  assert.equal(E.toUZS(5000, 'UZS', 12023.46), 5000);
  assert.equal(E.toMinor(15.5, 'USD'), 1550);
});

test('typed amounts: ming, k, mln, spaces, decimals, dollars', () => {
  const v = (t) => { const a = E.findAmount(t); return a && [a.value, a.ccy]; };
  assert.deepEqual(v('non 8 ming'), [8000, 'UZS']);
  assert.deepEqual(v('taksi 25k'), [25000, 'UZS']);
  assert.deepEqual(v('sut 14 000'), [14000, 'UZS']);
  assert.deepEqual(v('kredit 2,1 mln'), [2100000, 'UZS']);
  assert.deepEqual(v('kitob $15'), [15, 'USD']);
  assert.deepEqual(v('kurs 150 dollar'), [150, 'USD']);
  assert.deepEqual(v('gaz 94 300,50'), [94300.5, 'UZS']);
  assert.equal(E.findAmount('faqat matn'), null);
});

test('one line, several expenses, category from words', () => {
  const r = E.parseLine('non 8 ming, sut 14 000, taksi 25k, bozor 420 ming, nimadir', CATS);
  assert.equal(r.length, 5);
  assert.deepEqual(r.slice(0, 4).map((x) => [x.name, x.amount, x.cat]),
    [['Non', 8000, 'food'], ['Sut', 14000, 'food'], ['Taksi', 25000, 'taxi'], ['Bozor', 420000, 'food']]);
  assert.equal(r[4].ok, false);
  assert.equal(E.parseLine('goshtga 95 ming', CATS)[0].cat, 'food');
  // typed in Cyrillic
  const c = E.parseLine('нон 8 минг, такси 25000', CATS);
  assert.deepEqual(c.map((x) => [x.name, x.amount, x.cat]), [['Нон', 8000, 'food'], ['Такси', 25000, 'taxi']]);
});

test('bank SMS: amount, merchant, card and balance', () => {
  const s = E.parseSms('Karta *4417: xarid 186 500,00 UZS. KORZINKA CHILONZOR. Balans: 4 815 000,00 UZS', CATS);
  assert.equal(s.kind, 'out');
  assert.equal(s.amount, 186500);
  assert.equal(s.ccy, 'UZS');
  assert.equal(s.card, '4417');
  assert.equal(s.balance, 4815000);
  assert.equal(s.name, 'Korzinka Chilonzor');
  assert.equal(s.cat, 'food');
  const inc = E.parseSms('Popolnenie: 2 500 000.00 UZS, karta ***0921. Ostatok: 4 800 000.00 UZS', CATS);
  assert.equal(inc.kind, 'in');
  assert.equal(inc.amount, 2500000);
  assert.equal(inc.card, '0921');
  assert.equal(E.parseSms('Salom, ertaga uchrashamiz', CATS), null);
});

test('money fields are grouped while typing', () => {
  assert.equal(E.fmtTyping('500000'), '500 000');
  assert.equal(E.fmtTyping('5000'), '5 000');
  assert.equal(E.fmtTyping('50 0000'), '500 000');
  assert.equal(E.fmtTyping('1250,505'), '1 250,50');
  assert.equal(E.fmtTyping('12.5'), '12,5');
  assert.equal(E.fmtTyping('007'), '7');
  assert.equal(E.fmtTyping('-150000'), '-150 000');
  assert.equal(E.fmtTyping(''), '');
});

test('receipt text: total and shop, VAT and paid-by lines ignored', () => {
  const r = E.parseReceipt([
    '"KORZINKA" MChJ', 'STIR: 301234567', 'Chek № 1842', 'Non 1 x 4 000,00   4 000,00', 'Sut 2 x 14 000,00   28 000,00',
    'Jami: 186 500,00', 'shu jumladan QQS 12%: 19 982,14', 'Karta: 186 500,00'
  ].join('\n'), CATS);
  assert.equal(r.amount, 186500);
  assert.equal(r.name, 'Korzinka');
  assert.equal(r.cat, 'food');
  // Russian receipt, total on the next line
  const ru = E.parseReceipt('ООО "Makro"\nИНН 123456789\nИТОГО К ОПЛАТЕ\n94 300.00\nНДС 12% 10 103.57', CATS);
  assert.equal(ru.amount, 94300);
  assert.equal(ru.name, 'Makro');
  assert.equal(E.parseReceipt('Salom\nertaga', CATS), null);
});

const TX = [
  { date: '2026-09-05', kind: 'out', amount: 300000, ccy: 'UZS', acc: 'a', cat: 'food', uzs: 300000, rate: 12000 },
  { date: '2026-09-20', kind: 'out', amount: 500000, ccy: 'UZS', acc: 'a', cat: 'food', uzs: 500000, rate: 12000 },
  { date: '2026-10-02', kind: 'in', amount: 5000000, ccy: 'UZS', acc: 'a', cat: 'salary', uzs: 5000000, rate: 12000 },
  { date: '2026-10-03', kind: 'out', amount: 240000, ccy: 'UZS', acc: 'a', cat: 'food', uzs: 240000, rate: 12000 },
  { date: '2026-10-10', kind: 'out', amount: 1000, ccy: 'USD', acc: 'b', cat: 'taxi', uzs: 120000, rate: 12000 },
  { date: '2026-10-12', kind: 'move', amount: 10000, ccy: 'USD', acc: 'b', toAcc: 'a', toAmount: 1205000, uzs: 1205000, rate: 12050 }
];

test('balances follow expenses, income and exchange', () => {
  const b = E.balances([{ id: 'a', start: 100000 }, { id: 'b', start: 50000 }], TX);
  assert.equal(b.a, 100000 - 300000 - 500000 + 5000000 - 240000 + 1205000);
  assert.equal(b.b, 50000 - 1000 - 10000);
});

test('month stats exclude transfers and can stop at a day', () => {
  const s = E.monthStats(TX, '2026-10');
  assert.equal(s.inc, 5000000);
  assert.equal(s.exp, 360000);
  assert.equal(s.expUsd, 30);
  assert.deepEqual(s.byCat, { food: 240000, taxi: 120000 });
  assert.equal(E.monthStats(TX, '2026-09', 10).exp, 300000);
});

test('compare with the same days of the previous month', () => {
  const c = E.compareMonths(TX, '2026-10', '2026-10-18');
  assert.equal(c.prev.exp, 300000);
  assert.equal(c.now.exp, 360000);
  assert.equal(c.pct, 20);
  assert.equal(c.catDiff.taxi, 120000);
  assert.equal(c.catDiff.food, -60000);
});

test('safe to spend per day, today included', () => {
  const s = E.safeToSpend(12000000, 8580000, '2026-10-18');
  assert.equal(s.left, 3420000);
  assert.equal(s.daysLeft, 14);
  assert.equal(s.perDay, 244000);
  assert.equal(s.pct, 72);
  assert.equal(E.safeToSpend(1000, 2000, '2026-10-31').perDay, 0);
});

test('six month series and month arithmetic', () => {
  assert.equal(E.addMonths('2026-01', -1), '2025-12');
  assert.equal(E.addMonths('2026-11', 3), '2027-02');
  const s = E.series(TX, '2026-10', 2);
  assert.deepEqual(s.map((x) => [x.month, x.exp]), [['2026-09', 800000], ['2026-10', 360000]]);
});

test('monthly payment due dates', () => {
  assert.equal(E.nextDue(5, '2026-10-18', null), '2026-10-05');
  assert.equal(E.nextDue(5, '2026-10-18', '2026-10'), '2026-11-05');
  assert.equal(E.nextDue(31, '2026-11-02', null), '2026-11-30');
});

test('2026 Latin alphabet: Ö, Ğ, Ş, Ç', () => {
  assert.equal(E.toNewLatin('Choʻntak puli, soʻm, sogʻliq, Shu oy'), 'Çöntak puli, söm, soğliq, Şu oy');
  assert.equal(E.toNewLatin("o'g'il"), 'öğil');
  assert.equal(E.toNewLatin('Maʼlumot'), 'Maʼlumot');
});

test('Cyrillic transliteration', () => {
  assert.equal(E.toCyrillic('Oziq-ovqat, sogʻliq'), 'Озиқ-овқат, соғлиқ');
  assert.equal(E.toCyrillic('Maʼlumotlarni saqlash'), 'Маълумотларни сақлаш');
  assert.equal(E.toCyrillic('Shu oy xarajati: 8 580 000 soʻm'), 'Шу ой харажати: 8 580 000 сўм');
  assert.equal(E.toCyrillic('Yangi ekran, hadyalar, yoʻl'), 'Янги экран, ҳадялар, йўл');
  assert.equal(E.toCyrillic('31-oktabr, Sentabr 2026'), '31-октябрь, Сентябрь 2026');
});

test('HTML transliteration leaves tags, entities and values', () => {
  assert.equal(E.translitHtml('Bot <code>@BotFather</code> oching', E.toCyrillic), 'Бот <code>@BotFather</code> очинг');
  const h = '<a href="#tahlil" data-v="oziq" aria-label="Tahlil">Soʻm &amp; dollar</a><input placeholder="Izoh" value="non">';
  assert.equal(E.translitHtml(h, E.toCyrillic),
    '<a href="#tahlil" data-v="oziq" aria-label="Таҳлил">Сўм &amp; доллар</a><input placeholder="Изоҳ" value="non">');
});
