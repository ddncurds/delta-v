// Страница, открытая как файл (file://): браузер не грузит ES-модули, игру запускает offline.js.
// Здесь offline.js исполняется как обычный скрипт в DOM-заглушке; blob:-адреса Node не импортирует,
// поэтому URL.createObjectURL подменён: исходник модуля пишется во временный файл, адрес — file:// этого файла
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { dom } from './dom-stub.js';
import { build, OUT } from '../scripts/offline.mjs';

const wait = ms => new Promise(r => setTimeout(r, ms));
const $ = id => dom.byId.get(id);

test('offline.js собран из текущих исходников (иначе: make offline)', () => {
  assert.equal(readFileSync(OUT, 'utf8'), build());
});

test('index.html на file:// грузит offline.js, а не модуль', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /location\.protocol === 'file:'\) \{ sc\.src = 'offline\.js'/);
  assert.doesNotMatch(html, /<script type="module"/);
});

test('на file:// offline.js запускает игру, и кнопка «Начать бой» начинает бой с ИИ', async () => {
  const errors = [];
  process.on('uncaughtException', e => errors.push(e));
  process.on('unhandledRejection', e => errors.push(e));
  const realUrl = URL.createObjectURL;
  // Blob читается асинхронно, а offline.js строит адреса синхронно — храним исходник рядом
  const RealBlob = globalThis.Blob;
  globalThis.Blob = class extends RealBlob { constructor(parts, o) { super(parts, o); this.src = parts.join(''); } };
  const dir = mkdtempSync(join(tmpdir(), 'deltav-offline-'));
  let n = 0;
  URL.createObjectURL = blob => { const f = join(dir, 'm' + n++ + '.mjs'); writeFileSync(f, blob.src); return pathToFileURL(f).href; };
  let failed = false;
  window.offlineFailed = () => { failed = true; };
  location.protocol = 'file:';
  try {
    new Function(readFileSync(OUT, 'utf8'))();
    for (let i = 0; i < 100 && $('ovBtn').textContent !== 'Start battle'; i++) await wait(20);
    dom.frame();
    assert.equal(failed, false);
    assert.equal($('overlay').hidden, false);
    $('ovBtn').click();
    assert.equal($('overlay').hidden, true, 'оверлей закрылся — бой начался');
    const t0 = $('clock').textContent;
    for (let i = 0; i < 40 && $('clock').textContent === t0; i++) { await wait(30); dom.frame(); }
    assert.notEqual($('clock').textContent, t0, 'время боя идёт');
    assert.deepEqual(errors, []);
  } finally {
    URL.createObjectURL = realUrl; globalThis.Blob = RealBlob; location.protocol = 'http:';
    rmSync(dir, { recursive: true, force: true });
  }
});
