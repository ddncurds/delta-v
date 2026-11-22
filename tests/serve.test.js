// Сервер разработки: браузер не должен держать старые модули в кэше
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDevServer } from '../scripts/serve.mjs';

const srv = createDevServer();
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + srv.address().port;
test.after(() => srv.close());

test('страница отдаётся без кэша и сбрасывает старый кэш браузера', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^text\/html/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('clear-site-data'), '"cache"');
  assert.match(await r.text(), /src\/main\.js/);
});

test('модули отдаются как JavaScript и без кэша', async () => {
  const r = await fetch(base + '/src/main.js');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^text\/javascript/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('clear-site-data'), null);
});

test('нет файла — 404, выход за папку проекта — запрещён', async () => {
  assert.equal((await fetch(base + '/nope.js')).status, 404);
  assert.equal((await fetch(base + '/src')).status, 404);
  assert.equal((await fetch(base + '/..%2f..%2fetc%2fpasswd')).status, 403);
  assert.equal((await fetch(base + '/%2e%2e/%2e%2e/etc/passwd')).status, 404, 'точки URL сворачивает сам');
  assert.equal((await fetch(base + '/', { method: 'POST' })).status, 405);
});
