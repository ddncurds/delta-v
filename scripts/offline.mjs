// Запуск игры со страницы, открытой как файл (file://): node scripts/offline.mjs [--check]
// Браузер не загружает ES-модули по file:// (у такой страницы нет origin, и запрос модуля падает на CORS),
// а обычный <script src> грузит. Поэтому собираем offline.js — обычный скрипт, в котором лежат исходники всех
// модулей игры. На file:// он делает из каждого модуля blob:-адрес, подставляет эти адреса вместо относительных
// импортов (зависимости раньше зависящих) и импортирует main.js. Модули остаются настоящими ES-модулями:
// живые привязки вроде `export let S` работают как обычно. На http(s) offline.js ничего не делает.
// --check: не писать файл, а упасть, если offline.js устарел
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const OUT = resolve(ROOT, 'offline.js');
const ENTRY = resolve(ROOT, 'src/main.js');

// статический импорт или реэкспорт с относительным путём: import … from './x.js', export … from '../y.js', import './z.js'
const IMPORT = /^(\s*(?:import|export)\b[^'"\n]*?)(['"])(\.\.?\/[^'"\n]+)\2/gm;
const dep = n => `__OFFLINE_DEP_${n}__`;

// модули в порядке «зависимости раньше»; в исходнике вместо путей импорта — метки с номером модуля
export function collect(entry = ENTRY) {
  const order = [], index = new Map(), open = new Set();
  const visit = file => {
    if (index.has(file)) return index.get(file);
    if (open.has(file)) throw new Error('циклический импорт: ' + relative(ROOT, file));
    open.add(file);
    const src = readFileSync(file, 'utf8');
    const ids = [...src.matchAll(IMPORT)].map(m => visit(resolve(dirname(file), m[3])));
    let k = 0;
    const code = src.replace(IMPORT, (_, head, q) => head + q + dep(ids[k++]) + q);
    if (/\bimport\s*\(|\bimport\.meta\b/.test(code)) throw new Error('offline.js не поддерживает import() и import.meta: ' + relative(ROOT, file));
    open.delete(file);
    const path = relative(ROOT, file).split('\\').join('/');
    index.set(file, order.length);
    order.push({ path, code: code + '\n//# sourceURL=' + path + '\n' });
    return order.length - 1;
  };
  visit(entry);
  return order;
}

export function build() {
  const mods = collect();
  return `// Сгенерировано scripts/offline.mjs (make offline) — руками не править.
// Запускает игру со страницы, открытой как файл: браузер не грузит ES-модули по file://
(function () {
  if (location.protocol !== 'file:') return;
  var M = [
${mods.map(m => '    ' + JSON.stringify(m.code)).join(',\n')}
  ];
  var urls = [];
  try {
    for (var i = 0; i < M.length; i++) {
      var code = M[i].replace(/__OFFLINE_DEP_(\\d+)__/g, function (_, n) { return urls[n]; });
      urls.push(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
    }
    import(urls[urls.length - 1]).catch(fail);
  } catch (e) { fail(e); }
  function fail(e) {
    console.error(e);
    if (window.offlineFailed) window.offlineFailed();
  }
})();
`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = build();
  if (process.argv.includes('--check')) {
    let old = '';
    try { old = readFileSync(OUT, 'utf8'); } catch (_) {}
    if (old !== out) { console.error('offline.js устарел: запустите make offline'); process.exit(1); }
    console.log('offline.js актуален');
  } else {
    writeFileSync(OUT, out);
    console.log('offline.js: ' + Math.round(out.length / 1024) + ' КБ');
  }
}
