/* =========================================================
   Friseur Ulrich — интерактив
   ========================================================= */
(function () {
  "use strict";

  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Отправка JSON на бэкенд
  const postJSON = (url, body) =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((res) => {
      if (!res.ok) return Promise.reject(res);
      return res.json().catch(() => ({}));
    });

  /* ---------- 1. Прелоадер ---------- */
  const preloader = $("#preloader");
  const hidePreloader = () => {
    if (!preloader) return;
    preloader.classList.add("is-done");
    setTimeout(() => preloader.remove(), 800);
  };
  // Не полагаемся только на window.load: если что-то не догрузится,
  // страница осталась бы навсегда скрытой под прелоадером.
  window.addEventListener("load", () => setTimeout(hidePreloader, 250));
  if (document.readyState === "complete") setTimeout(hidePreloader, 250);
  setTimeout(hidePreloader, 1500); // жёсткая страховка

  /* ---------- 2. Хедер, прогресс, кнопка "наверх" ---------- */
  const header = $("#header");
  const progress = $("#scrollProgress");
  const toTop = $("#toTop");

  let ticking = false;
  const onScroll = () => {
    const y = window.scrollY || document.documentElement.scrollTop;
    const docH = document.documentElement.scrollHeight - window.innerHeight;

    if (header) header.classList.toggle("is-scrolled", y > 40);
    if (toTop) toTop.classList.toggle("is-visible", y > 700);
    if (progress && docH > 0) {
      progress.style.transform = "scaleX(" + Math.min(y / docH, 1) + ")";
    }
    ticking = false;
  };
  window.addEventListener(
    "scroll",
    () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(onScroll);
      }
    },
    { passive: true }
  );
  onScroll();

  if (toTop) {
    toTop.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    });
  }

  /* ---------- 3. Мобильное меню ---------- */
  const burger = $("#burger");
  const nav = $("#nav");

  const closeNav = () => {
    if (!nav || !burger) return;
    nav.classList.remove("is-open");
    burger.classList.remove("is-open");
    burger.setAttribute("aria-expanded", "false");
    burger.setAttribute("aria-label", "Открыть меню");
    document.body.classList.remove("is-locked");
  };

  if (burger && nav) {
    burger.addEventListener("click", () => {
      const open = nav.classList.toggle("is-open");
      burger.classList.toggle("is-open", open);
      burger.setAttribute("aria-expanded", String(open));
      burger.setAttribute("aria-label", open ? "Закрыть меню" : "Открыть меню");
      document.body.classList.toggle("is-locked", open);
    });

    $$(".nav__link", nav).forEach((link) => link.addEventListener("click", closeNav));

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeNav();
    });
  }

  /* ---------- 4. Появление блоков при прокрутке ---------- */
  const revealEls = $$(".reveal");

  if (!reduceMotion && "IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          // лёгкая "волна": соседние элементы появляются по очереди
          const el = entry.target;
          const siblings = el.parentElement ? $$(".reveal", el.parentElement) : [];
          const idx = siblings.indexOf(el);
          const delay = siblings.length > 1 ? Math.min(idx, 6) * 70 : 0;
          setTimeout(() => el.classList.add("is-visible"), delay);
          obs.unobserve(el);
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    revealEls.forEach((el) => io.observe(el));

    // Страховка: если по какой-то причине observer не сработал —
    // через 6 секунд показываем всё, что осталось скрытым.
    setTimeout(() => {
      revealEls.forEach((el) => el.classList.add("is-visible"));
    }, 6000);
  } else {
    revealEls.forEach((el) => el.classList.add("is-visible"));
  }

  /* ---------- 5. Счётчики ---------- */
  const counters = $$("[data-count]");

  const animateCount = (el) => {
    const target = parseInt(el.dataset.count, 10);
    if (Number.isNaN(target)) return;

    if (reduceMotion) {
      el.textContent = target;
      return;
    }

    const isYear = target > 1900 && target < 2100;
    const duration = 1500;
    const start = performance.now();

    const step = (now) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      const value = Math.round(target * eased);
      el.textContent = isYear ? value : value;
      if (p < 1) requestAnimationFrame(step);
      else el.textContent = target;
    };
    requestAnimationFrame(step);
  };

  if ("IntersectionObserver" in window) {
    const cio = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          animateCount(entry.target);
          obs.unobserve(entry.target);
        });
      },
      { threshold: 0.5 }
    );
    counters.forEach((el) => cio.observe(el));
  } else {
    counters.forEach((el) => (el.textContent = el.dataset.count));
  }

  /* ---------- 6. Табы прайса ---------- */
  const tabs = $$(".price-tab");
  const panels = $$(".price-panel");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const key = tab.dataset.tab;
      tabs.forEach((t) => {
        const active = t === tab;
        t.classList.toggle("is-active", active);
        t.setAttribute("aria-selected", String(active));
      });
      panels.forEach((p) => p.classList.toggle("is-active", p.dataset.panel === key));
    });
  });

  /* ---------- 7. Активный пункт меню при скролле ---------- */
  const navLinks = $$(".nav__link");
  const sections = navLinks
    .map((link) => {
      const id = link.getAttribute("href");
      return id && id.length > 1 ? { link, el: $(id) } : null;
    })
    .filter(Boolean);

  if (sections.length && "IntersectionObserver" in window) {
    const sio = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const current = sections.find((s) => s.el === entry.target);
          if (!current) return;
          navLinks.forEach((l) => l.classList.toggle("is-active", l === current.link));
        });
      },
      { rootMargin: "-45% 0px -50% 0px" }
    );
    sections.forEach((s) => s.el && sio.observe(s.el));
  }

  /* ---------- 8. Плавный скролл по якорям (с учётом высоты хедера) ---------- */
  $$('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", (e) => {
      const href = link.getAttribute("href");
      if (!href || href === "#" || href.length < 2) return;
      const target = document.getElementById(href.slice(1));
      if (!target) return;

      e.preventDefault();
      const headerH = header ? header.offsetHeight : 0;
      const top = target.getBoundingClientRect().top + window.scrollY - headerH + 2;

      window.scrollTo({ top: Math.max(top, 0), behavior: reduceMotion ? "auto" : "smooth" });
      history.replaceState(null, "", href);
    });
  });

  /* ---------- 9. Форма записи ---------- */
  const form = $("#bookingForm");
  const status = $("#formStatus");

  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();

      let valid = true;
      $$("[required]", form).forEach((input) => {
        const field = input.closest(".field");
        const ok = input.value.trim().length >= (input.type === "tel" ? 5 : 2);
        if (field) field.classList.toggle("is-invalid", !ok);
        if (!ok) valid = false;
      });

      if (!valid) {
        if (status) {
          status.textContent = "Пожалуйста, укажите имя и телефон.";
          status.classList.add("is-visible");
        }
        return;
      }

      const btn = $('button[type="submit"]', form);
      const name = form.elements.name.value.trim();
      const el = (n) => (form.elements[n] ? String(form.elements[n].value || "").trim() : "");
      const data = {
        name: name,
        phone: el("phone"),
        email: el("email"),
        service: el("service"),
        date: el("date"),
        time: el("time"),
        message: el("message"),
      };

      if (btn) {
        btn.disabled = true;
        btn.textContent = "Отправляем…";
      }

      postJSON("/api/bookings", data)
        .then(() => {
          if (status) {
            status.textContent =
              "Спасибо, " + name + "! Заявка принята — мы перезвоним, чтобы подтвердить время.";
            status.classList.remove("is-error");
            status.classList.add("is-visible");
          }
          form.reset();
        })
        .catch(() => {
          if (status) {
            status.textContent =
              "Не удалось отправить заявку. Позвоните нам: 07321 43947";
            status.classList.add("is-visible", "is-error");
          }
        })
        .then(() => {
          if (btn) {
            btn.disabled = false;
            btn.textContent = "Отправить запрос";
          }
        });
    });

    $$("input, textarea", form).forEach((input) => {
      input.addEventListener("input", () => {
        const field = input.closest(".field");
        if (field) field.classList.remove("is-invalid");
      });
    });
  }

  /* ---------- 9b. Отзывы: подгрузка + отправка ---------- */
  const liveWrap = $("#reviewsLive");

  const escapeHtml = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));

  const formatDate = (iso) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    try {
      return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
    } catch (err) {
      return d.toLocaleDateString();
    }
  };

  const renderReviews = (items) => {
    if (!liveWrap) return;
    liveWrap.innerHTML = items
      .map((r) => {
        const rating = Math.max(1, Math.min(5, parseInt(r.rating, 10) || 5));
        return (
          '<figure class="review review--live">' +
          '<div class="review__stars" aria-label="Оценка ' + rating + ' из 5">' + "★".repeat(rating) + '<span>' + "★".repeat(5 - rating) + "</span></div>" +
          '<blockquote class="review__text">' + escapeHtml(r.text) + "</blockquote>" +
          '<figcaption><span class="review__name">' + escapeHtml(r.name) + "</span>" +
          '<span class="review__meta">' + escapeHtml(r.service || "Отзыв клиента") +
          (r.createdAt ? " · " + formatDate(r.createdAt) : "") +
          "</span></figcaption></figure>"
        );
      })
      .join("");
    liveWrap.hidden = items.length === 0;
  };

  if (liveWrap) {
    fetch("/api/reviews")
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((payload) =>
        renderReviews(
          Array.isArray(payload) ? payload : payload.reviews || payload.items || []
        )
      )
      .catch(() => { "" /* бэкенд недоступен — остаются статические отзывы */ });
  }

  const reviewForm = $("#reviewForm");
  const reviewStatus = $("#reviewStatus");

  if (reviewForm) {
    reviewForm.addEventListener("submit", (e) => {
      e.preventDefault();

      let valid = true;
      $$("[required]", reviewForm).forEach((input) => {
        const field = input.closest(".field");
        const ok = input.value.trim().length >= 2;
        if (field) field.classList.toggle("is-invalid", !ok);
        if (!ok) valid = false;
      });

      if (!valid) {
        if (reviewStatus) {
          reviewStatus.textContent = "Напишите, пожалуйста, имя и текст отзыва.";
          reviewStatus.classList.add("is-visible", "is-error");
        }
        return;
      }

      const btn = $('button[type="submit"]', reviewForm);
      const name = reviewForm.elements.name.value.trim();
      const ratingInput = $('input[name="rating"]:checked', reviewForm);

      if (btn) {
        btn.disabled = true;
        btn.textContent = "Отправляем…";
      }

      postJSON("/api/reviews", {
        name: name,
        service: reviewForm.elements.service.value,
        rating: ratingInput ? parseInt(ratingInput.value, 10) : 5,
        text: reviewForm.elements.text.value.trim(),
      })
        .then(() => {
          if (reviewStatus) {
            reviewStatus.textContent =
              "Спасибо, " + name + "! Отзыв отправлен и появится после проверки.";
            reviewStatus.classList.remove("is-error");
            reviewStatus.classList.add("is-visible");
          }
          reviewForm.reset();
        })
        .catch(() => {
          if (reviewStatus) {
            reviewStatus.textContent =
              "Не получилось отправить отзыв. Попробуйте ещё раз чуть позже.";
            reviewStatus.classList.add("is-visible", "is-error");
          }
        })
        .then(() => {
          if (btn) {
            btn.disabled = false;
            btn.textContent = "Отправить отзыв";
          }
        });
    });

    $$("input, textarea", reviewForm).forEach((input) => {
      input.addEventListener("input", () => {
        const field = input.closest(".field");
        if (field) field.classList.remove("is-invalid");
      });
    });
  }

  /* ---------- 10. Год в футере ---------- */
  const year = $("#year");
  if (year) year.textContent = new Date().getFullYear();

  /* ---------- 11. Легкий параллакс для hero ---------- */
  if (!reduceMotion && window.matchMedia("(min-width: 1080px)").matches) {
    const heroPhoto = $(".hero__photo img");
    const heroVisual = $(".hero__visual");

    if (heroPhoto && heroVisual) {
      window.addEventListener(
        "scroll",
        () => {
          const y = window.scrollY;
          if (y > window.innerHeight) return;
          heroVisual.style.transform = "translate3d(0," + y * 0.05 + "px,0)";
        },
        { passive: true }
      );
    }
  }
})();
