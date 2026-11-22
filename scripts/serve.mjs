// Локальный сервер для разработки: node scripts/serve.mjs [порт]
// python3 -m http.server не шлёт заголовков кэширования, и Chrome по эвристике держит старые ES-модули:
// после правки часть файлов приходит новой, часть — из кэша, и игра падает при запуске.
// Здесь всё отдаётся с Cache-Control: no-store, а страница ещё и велит браузеру выбросить уже накопленный кэш
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

export function createDevServer(root = ROOT) {
  return createServer(async (req, res) => {
    const send = (code, body, headers = {}) => {
      res.writeHead(code, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
    let path;
    try { path = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { return send(400, 'Bad Request'); }
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(root, path));
    if (file !== root && !file.startsWith(root + sep)) return send(403, 'Forbidden');
    try {
      if (!(await stat(file)).isFile()) return send(404, 'Not Found');
      const type = TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
      const extra = type.startsWith('text/html') ? { 'Clear-Site-Data': '"cache"' } : {};
      send(200, await readFile(file), { 'Content-Type': type, ...extra });
    } catch { send(404, 'Not Found'); }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = +(process.argv[2] || process.env.PORT || 8080);
  createDevServer().listen(port, () => console.log(`Дельта-v: http://localhost:${port}`));
}
