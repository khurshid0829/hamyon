const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../backup.js');

const NOW = new Date(2026, 10, 2, 9, 0).getTime();
const YESTERDAY = NOW - 86400000;
const READY = { token: '1:a', chat: 5, pass: 'secret1' };

test('encrypted file opens only with its password and hides the data', async () => {
  const plain = JSON.stringify({ tx: [{ note: 'Non soʻm' }] });
  const file = await B.encrypt(plain, 'secret1', 'hamyon');
  assert.equal(B.isEncrypted(file), true);
  assert.equal(B.isEncrypted(plain), false);
  assert.equal(B.isEncrypted('not json'), false);
  assert.equal(file.includes('Non'), false);
  assert.equal(await B.decrypt(file, 'secret1'), plain);
  await assert.rejects(B.decrypt(file, 'wrong-password'));
});

test('large data survives encryption', async () => {
  const plain = 'x'.repeat(300000);
  assert.equal(await B.decrypt(await B.encrypt(plain, 'secret1', 'a'), 'secret1'), plain);
});

test('backup runs once a day, only for changed data', () => {
  assert.equal(B.isDue({}, 'h', NOW), false);
  assert.equal(B.isDue({ token: '1:a', pass: 'p' }, 'h', NOW), false);
  assert.equal(B.isDue(READY, 'h', NOW), true);
  assert.equal(B.isDue({ ...READY, lastOk: YESTERDAY, lastTry: YESTERDAY, lastHash: 'old' }, 'h', NOW), true);
  assert.equal(B.isDue({ ...READY, lastOk: YESTERDAY, lastTry: YESTERDAY, lastHash: 'h' }, 'h', NOW), false);
  assert.equal(B.isDue({ ...READY, lastOk: NOW - 60000, lastTry: NOW - 60000, lastHash: 'old' }, 'h', NOW), false);
});

test('a failed try waits an hour before the next one', () => {
  const failed = { ...READY, lastOk: YESTERDAY, lastHash: 'old' };
  assert.equal(B.isDue({ ...failed, lastTry: NOW - 600000 }, 'h', NOW), false);
  assert.equal(B.isDue({ ...failed, lastTry: NOW - 3600000 }, 'h', NOW), true);
});

test('reminder after 14 days without a bot, 7 days with one', () => {
  const d = (n) => NOW - n * 86400000;
  assert.equal(B.overdueDays({ firstSeen: d(13) }, NOW), 0);
  assert.equal(B.overdueDays({ firstSeen: d(14) }, NOW), 14);
  assert.equal(B.overdueDays({ firstSeen: d(30), lastManual: d(2) }, NOW), 0);
  assert.equal(B.overdueDays({ firstSeen: d(30), chat: 5, lastOk: d(6) }, NOW), 0);
  assert.equal(B.overdueDays({ firstSeen: d(30), chat: 5, lastOk: d(8) }, NOW), 8);
});

test('link code carries the connection to another app', () => {
  const code = B.encodeLink({ ...READY, bot: 'my_bot' });
  assert.deepEqual(B.decodeLink(code), { token: '1:a', chat: 5, pass: 'secret1', bot: 'my_bot' });
  assert.equal(B.decodeLink('123:abc'), null);
  assert.equal(B.decodeLink('zaxira:%%%'), null);
});

test('file goes to the right chat silently; Telegram errors become plain text', async () => {
  let url, body;
  const ok = async (u, o) => { url = u; body = o.body; return { json: async () => ({ ok: true, result: {} }) }; };
  await B.sendFile(READY, 'hamyon-2026-11-02.json', '{}', 'Hamyon', ok);
  assert.equal(url, 'https://api.telegram.org/bot1:a/sendDocument');
  assert.equal(body.get('chat_id'), '5');
  assert.equal(body.get('disable_notification'), 'true');
  assert.equal(body.get('document').name, 'hamyon-2026-11-02.json');
  const bad = async () => ({ json: async () => ({ ok: false, error_code: 401, description: 'Unauthorized' }) });
  await assert.rejects(B.sendFile(READY, 'a.json', '{}', 'x', bad), (e) => {
    assert.equal(B.errorText(e), 'Bot kaliti notoʻgʻri');
    return true;
  });
  assert.equal(B.errorText(new TypeError('Failed to fetch')), 'Internet yoki Telegram bilan aloqa yoʻq');
});
