'use strict';

/**
 * Friseur Ulrich — сервер сайта.
 *  - раздаёт статику (index.html, assets/)
 *  - принимает записи на приём  -> POST /api/bookings
 *  - принимает отзывы           -> POST /api/reviews
 *  - личный кабинет             -> /admin (вход по паролю)
 *
 * Без внешних фреймворков: только http + nodemailer.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const store = require('./lib/store');
const mail = require('./lib/mail');

const PORT = Number(process.env.PORT) || 8099;
const ROOT = __dirname;

// ---------- доступ в кабинет ----------
const ADMIN_USER = process.env.ADMIN_USER || 'lorcyt';
const ADMIN_PASS = process.env.ADMIN_PASS || 'bagdu9-qeqnyq-kazbiX';
// Секрет для подписи cookie. Если не задан — генерируется при старте
// (после перезапуска сервера нужно войти заново).
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(24).toString('hex');
const SESSION_TTL = 1000 * 60 * 60 * 12; // 12 часов
const COOKIE_NAME = 'fu_session';

// ---------- вспомогательное ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8'
};

// Папки, которые никогда не отдаём как статику.
const BLOCKED_DIRS = new Set(['data', 'lib', 'node_modules', '.qa', '.git']);
// В корне сайта разрешены только эти файлы.
const ROOT_FILES = new Set(['index.html', 'admin.html', 'robots.txt', 'favicon.ico', 'sitemap.xml']);
const PUBLIC_EXTS = new Set([
  '.html', '.css', '.js', '.mjs', '.json',
  '.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.svg', '.ico',
  '.woff', '.woff2', '.ttf', '.otf', '.eot', '.mp4', '.webm', '.txt', '.xml', '.pdf', '.map'
]);

function json(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req, limit = 200 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('Слишком большой запрос'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (_) {
        reject(Object.assign(new Error('Некорректный JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie || '';
  header.split(';').forEach((pair) => {
    const i = pair.indexOf('=');
    if (i === -1) return;
    out[pair.slice(0, i).trim()] = decodeURIComponent(pair.slice(i + 1).trim());
  });
  return out;
}

function sign(value) {
  return crypto.createHmac('sha256', SECRET).update(value).digest('hex');
}

function makeSession(user) {
  const payload = Buffer.from(JSON.stringify({ u: user, exp: Date.now() + SESSION_TTL })).toString('base64url');
  return payload + '.' + sign(payload);
}

function readSession(token) {
  if (!token || token.indexOf('.') === -1) return null;
  const [payload, sig] = token.split('.');
  if (sign(payload) !== sig) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch (_) {
    return null;
  }
}

function currentUser(req) {
  const s = readSession(parseCookies(req)[COOKIE_NAME]);
  return s ? s.u : null;
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function clean(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
}

function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v);
}

// ---------- валидация ----------
function validateBooking(input) {
  const data = {
    name: clean(input.name, 80),
    phone: clean(input.phone, 40),
    email: clean(input.email, 120),
    service: clean(input.service, 120),
    date: clean(input.date, 40),
    time: clean(input.time, 20),
    message: clean(input.message, 1000)
  };
  if (data.name.length < 2) return { error: 'Укажите имя.' };
  if (data.phone.replace(/\D/g, '').length < 6) return { error: 'Укажите корректный телефон.' };
  if (data.email && !isEmail(data.email)) return { error: 'Некорректный e-mail.' };
  if (!data.service) return { error: 'Выберите услугу.' };
  return { data };
}

function validateReview(input) {
  const rating = Math.round(Number(input.rating));
  const data = {
    name: clean(input.name, 60) || 'Гость',
    service: clean(input.service, 80),
    text: clean(input.text, 1500),
    rating: Number.isFinite(rating) ? Math.min(5, Math.max(1, rating)) : 0
  };
  if (!data.text || data.text.length < 10) return { error: 'Отзыв слишком короткий (минимум 10 символов).' };
  if (!data.rating) return { error: 'Поставьте оценку от 1 до 5.' };
  // Простая защита от спам-ссылок.
  if ((data.text.match(/https?:\/\//gi) || []).length > 1) return { error: 'Ссылки в отзыве не разрешены.' };
  return { data };
}

function publicReview(r) {
  return {
    id: r.id,
    name: r.name,
    service: r.service,
    text: r.text,
    rating: r.rating,
    createdAt: r.createdAt
  };
}

// ---------- статика ----------
function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === '/' || rel === '') rel = '/index.html';
  if (rel === '/admin' || rel === '/admin/') rel = '/admin.html';

  const filePath = path.normalize(path.join(ROOT, rel));
  if (!filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  const relFromRoot = path.relative(ROOT, filePath).split(path.sep);
  const isDotPath = relFromRoot.some((seg) => seg.startsWith('.') && seg !== '.' && seg !== '..');
  if (BLOCKED_DIRS.has(relFromRoot[0]) || isDotPath) {
    res.writeHead(404);
    return res.end('Not found');
  }
  // В корне отдаём только страницы; всё остальное (server.js, package.json,
  // package-lock.json, .env и т.п.) наружу не уходит.
  const inAssets = relFromRoot[0] === 'assets' && relFromRoot.length > 1;
  const isRootPage = relFromRoot.length === 1 && ROOT_FILES.has(relFromRoot[0]);
  if (!inAssets && !isRootPage) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }
  // Отдаём только явно разрешённые типы файлов.
  const ext0 = path.extname(filePath).toLowerCase();
  if (!PUBLIC_EXTS.has(ext0)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(
        '<!doctype html><meta charset="utf-8"><title>404</title>' +
        '<body style="font-family:sans-serif;background:#1B1A17;color:#F4EFE7;display:grid;place-items:center;height:100vh;margin:0">' +
        '<div style="text-align:center"><h1 style="font-weight:400;font-size:56px;margin:0">404</h1>' +
        '<p style="opacity:.7">Страница не найдена</p><a style="color:#C9A45C" href="/">На главную</a></div></body>'
      );
    }
    const ext = path.extname(filePath).toLowerCase();
    const isHtml = ext === '.html';
    const cache = isHtml ? 'no-cache' : 'public, max-age=0, must-revalidate';
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': cache,
      'Content-Length': stat.size,
      'X-Content-Type-Options': 'nosniff'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

// ---------- CSV ----------
function csvCell(v) {
  const s = String(v == null ? '' : v).replace(/"/g, '""');
  return '"' + s + '"';
}

function toCsv(rows, columns) {
  const head = columns.map((c) => csvCell(c.label)).join(';');
  const body = rows.map((row) => columns.map((c) => csvCell(c.get(row))).join(';')).join('\r\n');
  // BOM, чтобы Excel открыл кириллицу правильно
  return '\uFEFF' + head + '\r\n' + body + '\r\n';
}

// ---------- обработчики API ----------
async function handleApi(req, res, url) {
  const { pathname } = url;
  const query = url.searchParams;
  const method = req.method;

  // ---- публичные ----
  if (pathname === '/api/reviews' && method === 'GET') {
    const approved = store
      .readAll('reviews')
      .filter((r) => r.status === 'approved')
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map(publicReview);
    return json(res, 200, { ok: true, reviews: approved });
  }

  if (pathname === '/api/reviews' && method === 'POST') {
    const body = await readBody(req);
    const { error, data } = validateReview(body);
    if (error) return json(res, 422, { ok: false, error });
    const review = await store.withLock('reviews', () =>
      Promise.resolve(store.insert('reviews', Object.assign({ status: 'pending' }, data)))
    );
    mail.sendReview(review).catch(() => { });
    return json(res, 201, {
      ok: true,
      message: 'Спасибо! Отзыв получен и появится после проверки администратором.'
    });
  }

  if ((pathname === '/api/bookings' || pathname === '/api/booking') && method === 'POST') {
    const body = await readBody(req);
    const { error, data } = validateBooking(body);
    if (error) return json(res, 422, { ok: false, error });
    const booking = await store.withLock('bookings', () =>
      Promise.resolve(store.insert('bookings', Object.assign({ status: 'new' }, data)))
    );
    const result = await mail.sendBooking(booking);
    return json(res, 201, {
      ok: true,
      id: booking.id,
      emailSent: result.sent,
      message: 'Заявка принята! Мы свяжемся с вами для подтверждения времени.'
    });
  }

  // ---- вход/выход ----
  if (pathname === '/api/admin/login' && method === 'POST') {
    const body = await readBody(req);
    const user = clean(body.user, 60);
    const pass = String(body.pass || '');
    if (user === ADMIN_USER && safeEqual(pass, ADMIN_PASS)) {
      const token = makeSession(user);
      // На хостинге (HTTPS за прокси) ставим Secure, локально по HTTP — нет.
      const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
      const secure = proto === 'https' ? '; Secure' : '';
      res.setHeader(
        'Set-Cookie',
        `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${SESSION_TTL / 1000}`
      );
      return json(res, 200, { ok: true });
    }
    return json(res, 401, { ok: false, error: 'Неверный логин или пароль.' });
  }

  if (pathname === '/api/admin/logout' && method === 'POST') {
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    return json(res, 200, { ok: true });
  }

  if (pathname === '/api/admin/me' && method === 'GET') {
    const user = currentUser(req);
    if (!user) return json(res, 401, { ok: false });
    return json(res, 200, { ok: true, user, mailConfigured: mail.enabled });
  }

  // ---- всё ниже требует авторизации ----
  const user = currentUser(req);
  if (!user) return json(res, 401, { ok: false, error: 'Требуется вход.' });

  if (pathname === '/api/admin/overview' && method === 'GET') {
    const bookings = store.readAll('bookings').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const reviews = store.readAll('reviews').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return json(res, 200, {
      ok: true,
      mailConfigured: mail.enabled,
      stats: {
        bookings: bookings.length,
        bookingsNew: bookings.filter((b) => b.status === 'new').length,
        reviews: reviews.length,
        reviewsPending: reviews.filter((r) => r.status === 'pending').length,
        avgRating:
          reviews.filter((r) => r.status === 'approved').length > 0
            ? Number(
              (
                reviews.filter((r) => r.status === 'approved').reduce((s, r) => s + (Number(r.rating) || 0), 0) /
                reviews.filter((r) => r.status === 'approved').length
              ).toFixed(1)
            )
            : 0
      },
      bookings,
      reviews
    });
  }

  // DELETE /api/admin/bookings/:id  |  PATCH со статусом
  let m = pathname.match(/^\/api\/admin\/bookings\/([\w-]+)$/);
  if (m) {
    const id = m[1];
    if (method === 'DELETE') {
      const ok = await store.withLock('bookings', () => Promise.resolve(store.remove('bookings', id)));
      return json(res, ok ? 200 : 404, { ok });
    }
    if (method === 'PATCH') {
      const body = await readBody(req);
      const status = clean(body.status, 20);
      if (!['new', 'confirmed', 'done', 'cancelled'].includes(status)) {
        return json(res, 422, { ok: false, error: 'Неизвестный статус.' });
      }
      const updated = await store.withLock('bookings', () => Promise.resolve(store.update('bookings', id, { status })));
      return updated ? json(res, 200, { ok: true, booking: updated }) : json(res, 404, { ok: false });
    }
  }

  m = pathname.match(/^\/api\/admin\/reviews\/([\w-]+)$/);
  if (m) {
    const id = m[1];
    if (method === 'DELETE') {
      const ok = await store.withLock('reviews', () => Promise.resolve(store.remove('reviews', id)));
      return json(res, ok ? 200 : 404, { ok });
    }
    if (method === 'PATCH') {
      const body = await readBody(req);
      const status = clean(body.status, 20);
      if (!['pending', 'approved', 'rejected'].includes(status)) {
        return json(res, 422, { ok: false, error: 'Неизвестный статус.' });
      }
      const updated = await store.withLock('reviews', () => Promise.resolve(store.update('reviews', id, { status })));
      return updated ? json(res, 200, { ok: true, review: updated }) : json(res, 404, { ok: false });
    }
  }

  // GET /api/admin/bookings?status=new|confirmed|done|cancelled|all
  if (pathname === '/api/admin/bookings' && method === 'GET') {
    const status = query.get('status') || 'all';
    let bookings = store.readAll('bookings').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    if (status !== 'all') bookings = bookings.filter((b) => b.status === status);
    return json(res, 200, { ok: true, bookings });
  }

  // GET /api/admin/reviews?status=pending|approved|rejected|all
  if (pathname === '/api/admin/reviews' && method === 'GET') {
    const status = query.get('status') || 'all';
    let reviews = store.readAll('reviews').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    if (status !== 'all') reviews = reviews.filter((r) => r.status === status);
    return json(res, 200, { ok: true, reviews });
  }

  // GET /api/admin/bookings.csv | /api/admin/reviews.csv
  if (pathname === '/api/admin/bookings.csv' && method === 'GET') {
    const bookings = store.readAll('bookings').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const csv = toCsv(bookings, [
      { label: 'ID', get: (r) => r.id },
      { label: 'Дата создания', get: (r) => r.createdAt },
      { label: 'Имя', get: (r) => r.name },
      { label: 'Телефон', get: (r) => r.phone },
      { label: 'E-mail', get: (r) => r.email },
      { label: 'Услуга', get: (r) => r.service },
      { label: 'Дата', get: (r) => r.date },
      { label: 'Время', get: (r) => r.time },
      { label: 'Комментарий', get: (r) => r.message },
      { label: 'Статус', get: (r) => r.status }
    ]);
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="bookings.csv"',
      'Cache-Control': 'no-store'
    });
    return res.end(csv);
  }

  if (pathname === '/api/admin/reviews.csv' && method === 'GET') {
    const reviews = store.readAll('reviews').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const csv = toCsv(reviews, [
      { label: 'ID', get: (r) => r.id },
      { label: 'Дата создания', get: (r) => r.createdAt },
      { label: 'Имя', get: (r) => r.name },
      { label: 'Услуга', get: (r) => r.service },
      { label: 'Оценка', get: (r) => r.rating },
      { label: 'Отзыв', get: (r) => r.text },
      { label: 'Статус', get: (r) => r.status }
    ]);
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="reviews.csv"',
      'Cache-Control': 'no-store'
    });
    return res.end(csv);
  }

  return json(res, 404, { ok: false, error: 'Не найдено.' });
}

// ---------- сервер ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // Health-check — удобно для проверки на хостинге.
  if (url.pathname === '/healthz') {
    return json(res, 200, { ok: true, uptime: Math.round(process.uptime()) });
  }

  if (url.pathname.startsWith('/api/')) {
    try {
      await handleApi(req, res, url);
    } catch (err) {
      console.error('[api]', err);
      if (!res.headersSent) {
        json(res, err.status || 500, { ok: false, error: err.status ? err.message : 'Внутренняя ошибка сервера.' });
      }
    }
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    return res.end('Method not allowed');
  }

  serveStatic(req, res, url.pathname);
});

store.ensureDir();

server.listen(PORT, () => {
  console.log('');
  console.log('  Friseur Ulrich — сайт запущен');
  console.log('  Адрес:          http://localhost:' + PORT);
  console.log('  Кабинет:        http://localhost:' + PORT + '/admin');
  console.log('  Логин/пароль:   ' + ADMIN_USER + ' / ' + (process.env.ADMIN_PASS ? '*** (из переменной окружения)' : ADMIN_PASS));
  console.log('  Почта:          ' + (mail.enabled ? 'SMTP настроен, заявки уходят на ' + (process.env.MAIL_TO || process.env.SMTP_USER) : 'SMTP НЕ настроен — заявки только в кабинете'));
  console.log('  Данные:         ' + store.DATA_DIR);
  console.log('');
});

module.exports = server;
