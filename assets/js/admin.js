/* =========================================================
   Friseur Ulrich — личный кабинет (admin.js)
   ========================================================= */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const loginView = $('#loginView');
  const appView = $('#appView');
  const loginForm = $('#loginForm');
  const loginStatus = $('#loginStatus');
  const loginBtn = $('#loginBtn');
  const toastEl = $('#toast');

  const state = {
    bookings: [],
    reviews: [],
    stats: {},
    mailConfigured: false,
    tab: 'bookings',
    bookingFilter: 'all',
    bookingSearch: '',
    reviewFilter: 'all'
  };

  /* ---------- утилиты ---------- */
  const esc = (v) =>
    String(v == null ? '' : v).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));

  const stars = (n) => {
    const r = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
    return '★'.repeat(r) + '☆'.repeat(5 - r);
  };

  const fmtDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    const p = (x) => String(x).padStart(2, '0');
    return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  let toastTimer = null;
  function toast(msg, isError = false) {
    toastEl.textContent = msg;
    toastEl.classList.toggle('is-error', isError);
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), 3200);
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      credentials: 'same-origin',
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      ...options
    });
    let data = null;
    try { data = await res.json(); } catch (_) { data = null; }
    if (res.status === 401 && path !== '/api/admin/login') {
      showLogin('Сессия истекла — войдите снова.');
      throw new Error('unauthorized');
    }
    if (!res.ok) {
      throw new Error((data && data.error) || `Ошибка ${res.status}`);
    }
    return data || { ok: true };
  }

  /* ---------- вход ---------- */
  function showLogin(msg) {
    appView.hidden = true;
    loginView.hidden = false;
    if (msg) {
      loginStatus.textContent = msg;
      loginStatus.classList.remove('is-ok');
    }
    const u = $('#loginUser');
    if (u) setTimeout(() => u.focus(), 60);
  }

  function showApp() {
    loginView.hidden = true;
    appView.hidden = false;
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginStatus.textContent = '';
    loginStatus.classList.remove('is-ok');
    loginBtn.disabled = true;
    loginBtn.textContent = 'Проверяем…';
    try {
      await api('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ user: $('#loginUser').value.trim(), pass: $('#loginPass').value })
      });
      loginForm.reset();
      showApp();
      await load();
    } catch (err) {
      loginStatus.textContent = err.message === 'unauthorized'
        ? 'Неверный логин или пароль.'
        : err.message;
    } finally {
      loginBtn.disabled = false;
      loginBtn.textContent = 'Войти';
    }
  });

  $('#logoutBtn').addEventListener('click', async () => {
    try { await api('/api/admin/logout', { method: 'POST', body: '{}' }); } catch (_) { /* ignore */ }
    state.bookings = [];
    state.reviews = [];
    showLogin('Вы вышли из кабинета.');
  });

  $('#refreshBtn').addEventListener('click', () => load(true));

  /* ---------- вкладки ---------- */
  $$('.adm-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      state.tab = tab.dataset.tab;
      $$('.adm-tab').forEach((t) => t.classList.toggle('is-active', t === tab));
      $$('.adm-panel').forEach((p) => { p.hidden = p.dataset.panel !== state.tab; });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  /* ---------- загрузка ---------- */
  async function load(silent = false) {
    try {
      const data = await api('/api/admin/overview');
      state.bookings = Array.isArray(data.bookings) ? data.bookings : [];
      state.reviews = Array.isArray(data.reviews) ? data.reviews : [];
      state.stats = data.stats || {};
      state.mailConfigured = !!data.mailConfigured;
      renderAll();
      if (silent) toast('Данные обновлены');
    } catch (err) {
      if (err.message !== 'unauthorized') toast(err.message, true);
    }
  }

  function renderAll() {
    renderStats();
    renderMailNotice();
    renderBookings();
    renderReviews();
  }

  function renderStats() {
    const s = state.stats || {};
    $('#statBookings').textContent = s.bookings ?? state.bookings.length;
    $('#statNew').textContent = s.bookingsNew ?? state.bookings.filter((b) => b.status === 'new').length;
    $('#statPending').textContent = s.reviewsPending ?? state.reviews.filter((r) => r.status === 'pending').length;
    $('#statRating').textContent = s.avgRating ? `${s.avgRating} ★` : '—';

    $('#countBookings').textContent = state.bookings.filter((b) => b.status === 'new').length || 0;
    const pending = state.reviews.filter((r) => r.status === 'pending').length;
    $('#countReviews').textContent = pending || '';
  }

  function renderMailNotice() {
    const notice = $('#mailNotice');
    const mailState = $('#mailState');
    if (state.mailConfigured) {
      notice.hidden = true;
      if (mailState) mailState.innerHTML = '<span class="adm-badge adm-badge--approved">Почта подключена</span>';
    } else {
      notice.hidden = false;
      notice.textContent = 'Почта не настроена: заявки и отзывы сохраняются здесь, в кабинете, но письма на e-mail не уходят. Инструкция — в DEPLOY.md (переменные SMTP_*).';
      if (mailState) mailState.innerHTML = '<span class="adm-badge adm-badge--pending">Почта не подключена</span>';
    }
    const up = $('#uptimeInfo');
    if (up && !up.dataset.filled) {
      fetch('/healthz').then((r) => r.json()).then((d) => {
        if (d && typeof d.uptime === 'number') {
          const m = Math.floor(d.uptime / 60);
          up.textContent = `Сервер работает: ${m < 60 ? m + ' мин' : Math.floor(m / 60) + ' ч ' + (m % 60) + ' мин'}.`;
          up.dataset.filled = '1';
        }
      }).catch(() => { });
    }
  }

  /* ---------- заявки ---------- */
  const BOOKING_LABELS = {
    new: 'Новая',
    confirmed: 'Подтверждена',
    done: 'Выполнена',
    cancelled: 'Отменена'
  };

  function bookingMatches(b) {
    if (state.bookingFilter !== 'all' && b.status !== state.bookingFilter) return false;
    const q = state.bookingSearch.trim().toLowerCase();
    if (!q) return true;
    return [b.name, b.phone, b.email, b.service, b.message]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(q));
  }

  function renderBookings() {
    const list = $('#bookingsList');
    const items = state.bookings.filter(bookingMatches);

    if (!items.length) {
      list.innerHTML = `<div class="adm-empty">${state.bookings.length
        ? 'По этому фильтру заявок нет.'
        : 'Пока нет заявок. Как только клиент отправит форму на сайте — заявка появится здесь.'}</div>`;
      return;
    }

    list.innerHTML = items.map((b) => {
      const status = b.status || 'new';
      return `
        <article class="adm-item adm-item--${esc(status)}" data-id="${esc(b.id)}">
          <div class="adm-item__top">
            <span class="adm-item__name">${esc(b.name || 'Без имени')}</span>
            <span class="adm-badge adm-badge--${esc(status)}">${esc(BOOKING_LABELS[status] || status)}</span>
            <span class="adm-item__meta">${esc(fmtDate(b.createdAt))}</span>
          </div>
          <dl class="adm-item__body">
            <div><dt>Телефон:</dt> ${b.phone ? `<a href="tel:${esc(b.phone)}">${esc(b.phone)}</a>` : '—'}</div>
            <div><dt>E-mail:</dt> ${b.email ? `<a href="mailto:${esc(b.email)}">${esc(b.email)}</a>` : '—'}</div>
            <div><dt>Услуга:</dt> ${esc(b.service || '—')}</div>
            <div><dt>Желает:</dt> ${esc(b.date || '—')} ${esc(b.time || '')}</div>
          </dl>
          ${b.message ? `<p class="adm-item__text">${esc(b.message)}</p>` : ''}
          <div class="adm-item__actions">
            ${status !== 'confirmed' ? `<button class="adm-act adm-act--ok" data-act="status" data-status="confirmed">Подтвердить</button>` : ''}
            ${status !== 'done' ? `<button class="adm-act" data-act="status" data-status="done">Выполнена</button>` : ''}
            ${status !== 'cancelled' ? `<button class="adm-act adm-act--warn" data-act="status" data-status="cancelled">Отменить</button>` : ''}
            <button class="adm-act adm-act--danger" data-act="delete">Удалить</button>
          </div>
        </article>`;
    }).join('');
  }

  /* ---------- отзывы ---------- */
  const REVIEW_LABELS = { pending: 'На проверке', approved: 'Опубликован', rejected: 'Отклонён' };

  function renderReviews() {
    const list = $('#reviewsList');
    const items = state.reviews.filter((r) => state.reviewFilter === 'all' || r.status === state.reviewFilter);

    if (!items.length) {
      list.innerHTML = `<div class="adm-empty">${state.reviews.length
        ? 'По этому фильтру отзывов нет.'
        : 'Отзывов пока нет. Новые отзывы с сайта попадают сюда на проверку.'}</div>`;
      return;
    }

    list.innerHTML = items.map((r) => {
      const status = r.status || 'pending';
      return `
        <article class="adm-item adm-item--${esc(status)}" data-id="${esc(r.id)}">
          <div class="adm-item__top">
            <span class="adm-item__name">${esc(r.name || 'Гость')}</span>
            <span class="adm-stars" aria-label="Оценка ${esc(r.rating)} из 5">${stars(r.rating)}</span>
            <span class="adm-badge adm-badge--${esc(status)}">${esc(REVIEW_LABELS[status] || status)}</span>
            <span class="adm-item__meta">${esc(fmtDate(r.createdAt))}</span>
          </div>
          <dl class="adm-item__body">
            <div><dt>Услуга:</dt> ${esc(r.service || '—')}</div>
          </dl>
          <p class="adm-item__text">${esc(r.text || '')}</p>
          <div class="adm-item__actions">
            ${status !== 'approved' ? `<button class="adm-act adm-act--ok" data-act="status" data-status="approved">Опубликовать</button>` : ''}
            ${status !== 'pending' ? `<button class="adm-act" data-act="status" data-status="pending">На проверку</button>` : ''}
            ${status !== 'rejected' ? `<button class="adm-act adm-act--warn" data-act="status" data-status="rejected">Отклонить</button>` : ''}
            <button class="adm-act adm-act--danger" data-act="delete">Удалить</button>
          </div>
        </article>`;
    }).join('');
  }

  /* ---------- действия ---------- */
  async function handleAction(e, kind) {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const card = e.target.closest('.adm-item');
    if (!card) return;
    const id = card.dataset.id;
    const act = btn.dataset.act;

    if (act === 'delete') {
      const what = kind === 'bookings' ? 'заявку' : 'отзыв';
      if (!window.confirm(`Удалить ${what} безвозвратно?`)) return;
      btn.disabled = true;
      try {
        await api(`/api/admin/${kind}/${encodeURIComponent(id)}`, { method: 'DELETE' });
        toast('Удалено');
        await load();
      } catch (err) { toast(err.message, true); btn.disabled = false; }
      return;
    }

    if (act === 'status') {
      const status = btn.dataset.status;
      btn.disabled = true;
      try {
        await api(`/api/admin/${kind}/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ status })
        });
        toast('Статус обновлён');
        await load();
      } catch (err) { toast(err.message, true); btn.disabled = false; }
    }
  }

  $('#bookingsList').addEventListener('click', (e) => handleAction(e, 'bookings'));
  $('#reviewsList').addEventListener('click', (e) => handleAction(e, 'reviews'));

  $('#bookingFilter').addEventListener('change', (e) => {
    state.bookingFilter = e.target.value;
    renderBookings();
  });

  let searchTimer = null;
  $('#bookingSearch').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const value = e.target.value;
    searchTimer = setTimeout(() => {
      state.bookingSearch = value;
      renderBookings();
    }, 160);
  });

  $('#reviewFilter').addEventListener('change', (e) => {
    state.reviewFilter = e.target.value;
    renderReviews();
  });

  /* ---------- старт ---------- */
  (async function boot() {
    try {
      const me = await api('/api/admin/me');
      if (me && me.ok) {
        showApp();
        await load();
        return;
      }
    } catch (_) { /* не авторизован */ }
    showLogin();
  })();
})();
