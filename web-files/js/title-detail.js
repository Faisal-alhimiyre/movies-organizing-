/**
 * title-detail.js — Semi-fullscreen title detail surface.
 *
 * Stage C: header, metadata, existing actions, responsive behavior,
 *          accessibility, themes, RTL.
 * Stage D: seasons/episodes integration, three-dot overflow menu,
 *          clickable rating badges, My Rating section.
 *
 * Architecture notes:
 *   - Actions live in a topbar three-dot (⋮) overflow menu, not in scroll content.
 *   - IMDb/AniList badges are clickable links; Open Link button is removed.
 *   - My Rating section shows watched/unrated/unwatched states below scores.
 *   - Targeted update functions replace the old full-rebuild refresh() pattern.
 *     refreshAllSections() patches each section individually, leaving
 *     #tdSeasonsSlot untouched so title-seasons.js owns that DOM.
 *   - _ignoreMutations flag prevents the MutationObserver from triggering
 *     a full detail rebuild during synchronous toggle-watched actions.
 *
 * Depends on:
 *   - window.WatchlistI18n       (t, getLang, isolateLtr, genreLabel, onChange)
 *   - window.WatchlistApp        (findItem, isWatched, getWatchEntry,
 *                                 closeAllMenus, deleteAndRender, saveWatchedEntry,
 *                                 updateCardInPlace, renderExternalRatings)
 *   - window.WatchlistMetadata   (buildTitleMetaBadges, extractImdbId,
 *                                 extractAnilistId)
 *   - window.WatchlistDialog     (confirm)
 *   - window.WatchlistAuth       (discoverListIds)
 *   - window.WatchlistSeasons    (attach, detach, onLangChange, onTitleWatchedChanged)
 *
 * Exposed as window.WatchlistTitleDetail
 */
(function () {
  "use strict";

  // ─── State ────────────────────────────────────────────────────────────────
  let _overlay = null;
  let _panel = null;
  let _scroll = null;
  let _topbarTitle = null;
  let _menuBtn = null;
  let _menuPanel = null;
  let _activeItemId = null;
  let _openerEl = null;
  let _isOpen = false;
  let _menuOpen = false;
  let _cardClickBound = false;
  let _staleObserver = null;
  let _titleIntersecting = true;
  let _titleObserver = null;
  let _restoring = false;
  /** Set to true while a toggle-watched card-click is in flight.
   *  Prevents the MutationObserver from triggering a full detail rebuild. */
  let _ignoreMutations = false;

  /** Mobile pull-to-dismiss + background scroll lock */
  let _savedScrollY = 0;
  let _panelDrag = null;
  let _swipeBound = false;
  const MOBILE_SHEET_MQ = "(max-width: 640px)";
  const PANEL_DRAG_CLOSE_PX = 120;
  const PANEL_DRAG_START_PX = 8;

  function isMobileSheet() {
    return window.matchMedia(MOBILE_SHEET_MQ).matches;
  }

  function lockBackgroundScroll() {
    _savedScrollY = window.scrollY || window.pageYOffset || 0;
    document.documentElement.classList.add("td-scroll-lock");
    document.body.classList.add("td-scroll-lock");
    document.body.style.position = "fixed";
    document.body.style.top = `-${_savedScrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
  }

  function restorePageScrollY(y) {
    const root = document.documentElement;
    const prev = root.style.scrollBehavior;
    root.style.scrollBehavior = "auto";
    window.scrollTo(0, y);
    root.style.scrollBehavior = prev;
  }

  function unlockBackgroundScroll() {
    document.documentElement.classList.remove("td-scroll-lock");
    document.body.classList.remove("td-scroll-lock");
    const y = _savedScrollY;
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.width = "";
    restorePageScrollY(y);
  }

  function scrollAtTop() {
    return (_scroll?.scrollTop ?? 0) <= 0;
  }

  function canStartPanelDrag(target) {
    if (!target?.closest) return false;
    if (target.closest(
      "button, a, input, textarea, select, label, [role='menu'], #tdMenuPanel, .tds-carousel, .tds-carousel-wrap, .tds-ep-modal"
    )) {
      return false;
    }
    return true;
  }

  function resetPanelDragStyles() {
    if (!_panel || !_overlay) return;
    _panel.classList.remove("td-panel--dragging");
    _overlay.classList.remove("td-overlay--dragging");
    _panel.style.transform = "";
    const backdrop = _overlay.querySelector("#tdBackdrop");
    if (backdrop) backdrop.style.opacity = "";
  }

  function onPanelTouchStart(event) {
    if (!isMobileSheet() || !_isOpen || _panelDrag) return;
    if (!canStartPanelDrag(event.target)) return;

    const onTopbar = Boolean(event.target.closest("#tdTopbar"));
    if (!scrollAtTop() && !onTopbar) return;

    const touch = event.changedTouches?.[0] || event.touches?.[0];
    if (!touch) return;

    _panelDrag = {
      pointerId: touch.identifier,
      startY: touch.clientY,
      startX: touch.clientX,
      dragging: false,
    };
  }

  function onPanelTouchMove(event) {
    if (!_panelDrag || !_isOpen) return;

    const touch = Array.from(event.changedTouches).find(
      (t) => t.identifier === _panelDrag.pointerId
    ) || event.touches?.[0];
    if (!touch || touch.identifier !== _panelDrag.pointerId) return;

    const dy = touch.clientY - _panelDrag.startY;
    const dx = touch.clientX - _panelDrag.startX;

    if (!_panelDrag.dragging) {
      if (dy <= 0) return;
      if (Math.abs(dx) > Math.abs(dy)) {
        _panelDrag = null;
        return;
      }
      if (dy < PANEL_DRAG_START_PX) return;
      if (!scrollAtTop()) {
        _panelDrag = null;
        return;
      }
      _panelDrag.dragging = true;
      _panel.classList.add("td-panel--dragging");
      _overlay.classList.add("td-overlay--dragging");
    }

    event.preventDefault();
    const offset = Math.max(0, dy);
    _panel.style.transform = `translateY(${offset}px)`;
    const backdrop = _overlay.querySelector("#tdBackdrop");
    if (backdrop) {
      const fade = Math.max(0, 1 - offset / 280);
      backdrop.style.opacity = String(0.62 * fade);
    }
  }

  function onPanelTouchEnd(event) {
    if (!_panelDrag) return;

    const touch = Array.from(event.changedTouches).find(
      (t) => t.identifier === _panelDrag.pointerId
    );
    const dy = touch ? touch.clientY - _panelDrag.startY : 0;
    const wasDragging = _panelDrag.dragging;
    _panelDrag = null;

    resetPanelDragStyles();

    if (!wasDragging) return;

    const panelHeight = _panel?.offsetHeight || 0;
    if (dy > PANEL_DRAG_CLOSE_PX || dy > panelHeight * 0.22) close();
  }

  function setupSwipeToDismiss() {
    if (_swipeBound || !_panel) return;
    _swipeBound = true;
    _panel.addEventListener("touchstart", onPanelTouchStart, { passive: true });
    _panel.addEventListener("touchmove", onPanelTouchMove, { passive: false });
    _panel.addEventListener("touchend", onPanelTouchEnd, { passive: true });
    _panel.addEventListener("touchcancel", onPanelTouchEnd, { passive: true });
  }

  // ─── I18n helpers ─────────────────────────────────────────────────────────
  function t(key, vars) {
    const i18n = window.WatchlistI18n;
    if (!i18n) {
      console.warn("[title-detail] WatchlistI18n not ready, key:", key);
      return key;
    }
    const result = i18n.t(key, vars);
    if (result === key && typeof key === "string" && key.includes(".")) {
      if (!t._warned) t._warned = new Set();
      if (!t._warned.has(key)) {
        t._warned.add(key);
        console.warn("[title-detail] Missing translation key:", key);
      }
    }
    return result;
  }

  function ltr(text) {
    return window.WatchlistI18n?.isolateLtr?.(text) ?? text;
  }

  function genreLabel(genre) {
    return window.WatchlistI18n?.genreLabel?.(genre) ?? genre;
  }

  // ─── Escape HTML ──────────────────────────────────────────────────────────
  function esc(text) {
    return String(text ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ─── App state helpers ────────────────────────────────────────────────────
  function findItem(id) {
    return window.WatchlistApp?.findItem?.(id) ?? null;
  }

  function isWatched(id) {
    return Boolean(window.WatchlistApp?.isWatched?.(id));
  }

  /** Derived progress state: unwatched | inProgress | watched */
  function titleProgressState(id) {
    return window.WatchlistApp?.progressState?.(id)
      ?? (isWatched(id) ? "watched" : "unwatched");
  }

  function isTitleFullyWatched(id) {
    return titleProgressState(id) === "watched";
  }

  function getWatchEntry(id) {
    // app.js returns {} (empty object) for items with no watched entry, which
    // isLegacyComplete({}) incorrectly treats as "fully watched". Return null
    // instead so that unwatched titles show their seasons as unchecked.
    if (!isWatched(id)) return null;
    return window.WatchlistApp?.getWatchEntry?.(id) ?? null;
  }

  function hasWatchRating(entry) {
    return entry?.rating != null && Number.isFinite(Number(entry.rating));
  }

  function formatRating(rating) {
    const num = Number(rating);
    if (!Number.isFinite(num)) return "0";
    return Number.isInteger(num) ? String(num) : num.toFixed(1);
  }

  function canMoveToList() {
    const ids = window.WatchlistAuth?.discoverListIds?.() || [];
    return ids.length > 1;
  }

  /** True for TV series and anime; these items get the seasons section. */
  function isTvOrAnime(item) {
    return item?.contentType === "tvSeries" || item?.contentType === "anime";
  }

  // ─── Type badge ───────────────────────────────────────────────────────────
  function getTypeBadge(item) {
    if (item.contentType === "anime") {
      return { label: t("type.anime"), className: "anime" };
    }
    if (item.kind === "film series") {
      return { label: t("type.filmSeries"), className: "franchise" };
    }
    if (item.contentType === "tvSeries") {
      return { label: t("type.tvSeries"), className: "tvSeries" };
    }
    return { label: t("type.movie"), className: "movie" };
  }

  // ─── Poster markup ────────────────────────────────────────────────────────
  function displayPoster(item) {
    return item?.cardPoster || item?.poster || "";
  }

  function posterMarkup(item, posterUrl) {
    const src = posterUrl || displayPoster(item);
    const altText = t("detail.posterAlt", { title: item.title || "" });
    if (item.posterBroken && !posterUrl) {
      return `<div class="td-poster td-poster--broken" role="img" aria-label="${esc(altText)}">
        <span>${esc(t("detail.posterBroken"))}</span>
      </div>`;
    }
    if (src) {
      return `<img class="td-poster" data-td-poster src="${esc(src)}" alt="${esc(altText)}" />`;
    }
    return `<div class="td-poster td-poster--empty" aria-hidden="true">🎬</div>`;
  }

  function formatSeasonLabel(season) {
    if (!season) return "";
    const num = season.seasonNumber;
    if (season.isSpecials) return t("seasons.specials");
    if (season.name && !/^Season \d+$/i.test(season.name)) return season.name;
    return t("seasons.seasonNum", { n: num });
  }

  /** Update header poster + season detail block when the user selects a season. */
  function updateHeaderSeasonPresentation(payload, { progressOnly = false } = {}) {
    if (!_scroll || !payload?.season) return;
    const season = payload.season;
    const item = findItem(_activeItemId);
    if (!item || !isTvOrAnime(item)) return;

    const detailEl = _scroll.querySelector("[data-td-season-detail]");
    const seriesSummaryEl = _scroll.querySelector("[data-td-series-summary]");

    if (!progressOnly) {
      const poster = season.poster || displayPoster(item) || "";
      const posterEl = _scroll.querySelector("[data-td-poster]");
      if (posterEl && posterEl.tagName === "IMG" && poster && posterEl.getAttribute("src") !== poster) {
        posterEl.setAttribute("src", poster);
      }

      if (detailEl) {
        const titleEl = detailEl.querySelector("[data-td-part='season-title']");
        const metaEl = detailEl.querySelector("[data-td-part='season-meta']");

        if (titleEl) titleEl.textContent = payload.name || formatSeasonLabel(season);

        if (metaEl) {
          metaEl.textContent = "";
          metaEl.hidden = true;
        }

        const overviewEl = detailEl.querySelector("[data-td-part='season-overview']");
        if (overviewEl) {
          if (season.overview) {
            overviewEl.textContent = season.overview;
            overviewEl.hidden = false;
          } else {
            overviewEl.textContent = "";
            overviewEl.hidden = true;
          }
        }

        detailEl.hidden = false;
      }

      if (seriesSummaryEl) seriesSummaryEl.hidden = true;
    }
  }

  function resetHeaderSeasonPresentation() {
    if (!_scroll) return;
    const item = findItem(_activeItemId);
    if (!item) return;

    const posterEl = _scroll.querySelector("[data-td-poster]");
    const poster = displayPoster(item);
    if (posterEl && posterEl.tagName === "IMG" && poster && posterEl.getAttribute("src") !== poster) {
      posterEl.setAttribute("src", poster);
    }

    const detailEl = _scroll.querySelector("[data-td-season-detail]");
    if (detailEl) detailEl.hidden = true;

    const seriesSummaryEl = _scroll.querySelector("[data-td-series-summary]");
    if (seriesSummaryEl) seriesSummaryEl.hidden = false;
  }

  // ─── My Rating block ──────────────────────────────────────────────────────
  function myRatingMarkup(itemId) {
    const state = titleProgressState(itemId);
    const entry = getWatchEntry(itemId);
    const rated = entry && hasWatchRating(entry);
    const hasNote = Boolean(String(entry?.note || "").trim());
    const noteSnippet = hasNote
      ? `<p class="td-my-rating__note">${esc(entry.note)}</p>` : "";

    // Unwatched: tap to mark watched
    if (state === "unwatched") {
      return `<div class="td-my-rating td-my-rating--chip">
        <button type="button"
          class="card__footer-badge card__footer-badge--unwatched"
          data-td-action="quick-toggle-watched"
          data-td-id="${esc(itemId)}"
          aria-label="${esc(t("card.markWatched"))}">
          ${esc(t("card.notWatchedShort"))}
        </button>
      </div>`;
    }

    // In progress: tap to mark fully watched
    if (state === "inProgress") {
      return `<div class="td-my-rating td-my-rating--chip td-my-rating--in-progress">
        <div class="td-my-rating__toolbar">
          <button type="button"
            class="card__watch-status card__watch-status--in-progress"
            data-td-action="quick-toggle-watched"
            data-td-id="${esc(itemId)}"
            aria-label="${esc(t("card.markWatched"))}">
            ${esc(t("card.inProgress"))}
          </button>
          <button type="button" class="btn btn--ghost btn--sm td-my-rating__note-btn"
            data-td-action="add-note" data-td-id="${esc(itemId)}">
            ${esc(hasNote ? t("detail.editNote") : t("detail.addNote"))}
          </button>
        </div>
        ${noteSnippet}
      </div>`;
    }

    // Watched (fully): show rating controls
    if (!rated) {
      return `<div class="td-my-rating td-my-rating--chip">
        <button
          type="button"
          class="btn btn--primary td-my-rating__rate-btn"
          data-td-action="rate"
          data-td-id="${esc(itemId)}"
        >${esc(t("detail.rate"))}</button>
      </div>`;
    }

    const ratingDisplay = formatRating(entry.rating);
    const label = `<span class="td-my-rating__label">${esc(t("detail.myRating"))}</span>`;
    return `<div class="td-my-rating td-my-rating--rated">
      ${label}
      <div class="td-my-rating__value">
        <span class="td-my-rating__score text-num">${esc(ratingDisplay)}</span>
        <span class="td-my-rating__denom text-num">/10</span>
      </div>
      ${noteSnippet}
      <button
        type="button"
        class="btn btn--ghost btn--sm td-my-rating__edit-btn"
        data-td-action="rate"
        data-td-id="${esc(itemId)}"
      >${esc(t("detail.editRating"))}</button>
    </div>`;
  }

  // ─── Header markup ────────────────────────────────────────────────────────
  function headerMarkup(item) {
    const typeBadge = getTypeBadge(item);
    const yearLabel = item.year ? String(item.year).trim() : "";
    const metaBadges = (window.WatchlistMetadata?.buildTitleMetaBadges?.(item, item.contentType) || [])
      .map((badge) => {
        const titleAttr = badge.kind === "age" && badge.title
          ? ` title="${esc(badge.title)}"` : "";
        return `<span class="badge badge--${badge.kind}"${titleAttr}>${esc(badge.label)}</span>`;
      })
      .join("");
    const yearBadge = yearLabel
      ? `<span class="badge badge--year text-num">${esc(yearLabel)}</span>` : "";
    const altTitle = item.altTitle
      ? `<span class="td-alt-title text-ltr">${esc(ltr(item.altTitle))}</span>` : "";
    const leads = (item.leads || []).filter(Boolean);
    const leadBlock = leads.length
      ? `<p class="td-lead">${esc(leads.join(", "))}</p>` : "";
    const scores = scoresMarkup(item);

    return `
      <div class="td-header">
        <div class="td-poster-wrap">${posterMarkup(item)}</div>
        <div class="td-header-info">
          <div class="td-badge-row">
            <span class="badge badge--${esc(typeBadge.className)}">${esc(typeBadge.label)}</span>
            ${yearBadge}
            ${metaBadges}
          </div>
          <h2 class="td-title" id="tdDetailTitle">
            <span class="text-ltr">${esc(ltr(item.title))}</span>
            ${altTitle}
          </h2>
          ${leadBlock}
          ${scores}
        </div>
      </div>`;
  }

  function seasonDetailShell() {
    return `<div class="td-season-detail" data-td-season-detail hidden>
      <h3 class="td-season-detail__title" data-td-part="season-title"></h3>
      <p class="td-season-detail__meta" data-td-part="season-meta" hidden></p>
      <p class="td-season-detail__overview" data-td-part="season-overview" hidden></p>
    </div>`;
  }

  // ─── Genre badges ──────────────────────────────────────────────────────────
  function genresMarkup(item) {
    const seen = new Set();
    const parts = [];
    const normalizeGenre = window.WatchlistApp?.normalizeGenre;

    function canonicalGenre(genre) {
      const label = String(genre || "").trim();
      if (!label) return "";
      if (typeof normalizeGenre === "function") {
        const mapped = normalizeGenre(label);
        if (mapped && mapped !== "Drama") return mapped;
        if (window.STANDARD_GENRES?.includes?.(label)) return label;
      }
      return label;
    }

    function addGenre(genre, primary = false) {
      const canonical = canonicalGenre(genre);
      if (!canonical) return;
      const key = canonical.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      const cls = primary ? "badge--genre-primary" : "badge--genre-secondary";
      parts.push(`<span class="badge ${cls}">${esc(genreLabel(canonical))}</span>`);
    }

    addGenre(item.genre, true);
    (item.secondaryGenres || []).forEach((g) => addGenre(g));
    (item.sourceGenres || []).forEach((g) => addGenre(g));

    if (!parts.length) return "";
    return `<div class="td-genres">
      <span class="td-section-label">${esc(t("detail.genres"))}</span>
      <div class="td-badge-row td-badge-row--genres">${parts.join("")}</div>
    </div>`;
  }

  // ─── External scores with clickable links ────────────────────────────────
  /**
   * Build the score badge row.  Where we can construct a valid source URL
   * we render an <a> link; otherwise a <span> (non-interactive).
   * We do NOT use the existing renderExternalRatings() because it returns
   * plain <span> elements — we need <a> wrappers for the detail surface.
   */
  function scoresMarkup(item) {
    const parts = [];

    const imdbRaw = item.imdbRating;
    const anilistRaw = item.anilistRating;
    const imdbId =
      window.WatchlistMetadata?.extractImdbId?.(item.imdbLink || item.link) || null;

    // IMDb badge
    if (imdbRaw) {
      const display = formatScoreDisplay(imdbRaw);
      if (display) {
        if (imdbId) {
          const url = `https://www.imdb.com/title/${imdbId}/`;
          parts.push(
            `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer"
               class="card__score card__score--imdb td-score-link"
               aria-label="${esc(t("detail.openIMDb"))} — ${esc(display)}"
               title="IMDb ${esc(display)}">
              <span class="card__score-value text-num">${esc(display)}</span>
              <img class="card__score-logo card__score-logo--imdb"
                   src="assets/brand/imdb.svg"
                   width="46" height="20" alt="IMDb" />
            </a>`
          );
        } else {
          parts.push(
            `<span class="card__score card__score--imdb" title="IMDb ${esc(display)}">
              <span class="card__score-value text-num">${esc(display)}</span>
              <img class="card__score-logo card__score-logo--imdb"
                   src="assets/brand/imdb.svg"
                   width="46" height="20" alt="" />
            </span>`
          );
        }
      }
    } else if (imdbId && item.imdbLink) {
      const url = `https://www.imdb.com/title/${imdbId}/`;
      parts.push(
        `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer"
           class="card__score card__score--imdb td-score-link"
           aria-label="${esc(t("detail.openIMDb"))}"
           title="IMDb">
          <img class="card__score-logo card__score-logo--imdb"
               src="assets/brand/imdb.svg"
               width="46" height="20" alt="IMDb" />
        </a>`
      );
    }

    // AniList badge
    if (anilistRaw) {
      const anilistId = window.WatchlistMetadata?.extractAnilistId?.(item.link) || null;
      const display = formatAnilistDisplay(anilistRaw);
      if (display) {
        const anilistUrl = (anilistId && item.link && item.link.includes("anilist.co"))
          ? item.link
          : anilistId ? `https://anilist.co/anime/${anilistId}` : null;
        if (anilistUrl) {
          parts.push(
            `<a href="${esc(anilistUrl)}" target="_blank" rel="noopener noreferrer"
               class="card__score card__score--anilist td-score-link"
               aria-label="${esc(t("detail.openAniList"))} — ${esc(display)}"
               title="AniList ${esc(display)}">
              <span class="card__score-value text-num">${esc(display)}</span>
              <img class="card__score-logo card__score-logo--anilist"
                   src="assets/brand/anilist.svg"
                   width="34" height="26" alt="AniList" />
            </a>`
          );
        } else {
          parts.push(
            `<span class="card__score card__score--anilist" title="AniList ${esc(display)}">
              <span class="card__score-value text-num">${esc(display)}</span>
              <img class="card__score-logo card__score-logo--anilist"
                   src="assets/brand/anilist.svg"
                   width="34" height="26" alt="" />
            </span>`
          );
        }
      }
    }

    if (!parts.length) return "";
    return `<div class="td-scores"><div class="card__rating-badges">${parts.join("")}</div></div>`;
  }

  function formatScoreDisplay(raw) {
    if (raw == null || raw === "") return "";
    const s = String(raw).trim();
    if (!s || /^n\/a$/i.test(s)) return "";
    const n = parseFloat(s);
    if (!Number.isFinite(n)) return s;
    return n % 1 === 0 ? String(n) : n.toFixed(1);
  }

  function formatAnilistDisplay(raw) {
    if (raw == null || raw === "") return "";
    const s = String(raw).trim();
    if (!s || /^n\/a$/i.test(s)) return "";
    const n = parseFloat(s);
    if (!Number.isFinite(n)) return s;
    // AniList stores 0–100; display as percentage
    return `${Math.round(n)}%`;
  }

  // ─── Three-dot overflow menu (topbar) ─────────────────────────────────────
  /** Build the menu item HTML. Called both when first opening and on lang change. */
  function buildMenuItems(itemId) {
    const item = findItem(itemId);
    if (!item) return "";
    const progState = window.WatchlistApp?.progressState?.(itemId) ?? (isWatched(itemId) ? "watched" : "unwatched");
    const canMove = canMoveToList();

    const rows = [];

    rows.push(
      `<button type="button" role="menuitem" class="td-menu-item"
         data-td-action="toggle-watched" data-td-id="${esc(itemId)}">
        ${esc(progState === "watched" ? t("detail.markUnwatched") : t("detail.markWatched"))}
      </button>`
    );
    rows.push(
      `<button type="button" role="menuitem" class="td-menu-item"
         data-td-action="edit" data-td-id="${esc(itemId)}">
        ${esc(t("detail.edit"))}
      </button>`
    );
    if (canMove) {
      rows.push(
        `<button type="button" role="menuitem" class="td-menu-item"
           data-td-action="move" data-td-id="${esc(itemId)}">
          ${esc(t("detail.move"))}
        </button>`
      );
    }
    rows.push(
      `<button type="button" role="menuitem" class="td-menu-item td-menu-item--danger"
         data-td-action="delete" data-td-id="${esc(itemId)}">
        ${esc(t("detail.delete"))}
      </button>`
    );

    return rows.join("");
  }

  function openMenu() {
    if (!_menuBtn || !_menuPanel || !_activeItemId) return;
    _menuOpen = true;
    _menuPanel.innerHTML = buildMenuItems(_activeItemId);
    _menuPanel.hidden = false;
    _menuBtn.setAttribute("aria-expanded", "true");
    // Focus first item
    const first = _menuPanel.querySelector("[role='menuitem']");
    first?.focus();
  }

  function closeMenu() {
    if (!_menuBtn || !_menuPanel) return;
    _menuOpen = false;
    _menuPanel.hidden = true;
    _menuPanel.innerHTML = "";
    _menuBtn.setAttribute("aria-expanded", "false");
  }

  function toggleMenu() {
    if (_menuOpen) closeMenu();
    else openMenu();
  }

  /** Rebuild menu items (e.g. after watched state changes) without closing. */
  function refreshMenuItems() {
    if (!_menuOpen || !_menuPanel || !_activeItemId) return;
    _menuPanel.innerHTML = buildMenuItems(_activeItemId);
  }

  // ─── Full scroll content ───────────────────────────────────────────────────
  function buildScrollContent(item) {
    const myRating = myRatingMarkup(item.id);
    const seasonDetail = isTvOrAnime(item) ? seasonDetailShell() : "";
    return `
      ${headerMarkup(item)}
      ${genresMarkup(item)}
      ${seasonDetail}
      ${item.summary ? `<p class="td-summary" data-td-series-summary>${esc(item.summary)}</p>` : ""}
      ${myRating}
      <div class="td-seasons-slot" id="tdSeasonsSlot"></div>
    `;
  }

  // ─── Targeted section update helpers (Stage D) ────────────────────────────
  function replaceSection(selector, html) {
    if (!_scroll) return false;
    const el = _scroll.querySelector(selector);
    if (!el || !html) return false;
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    const newEl = tmp.firstElementChild;
    if (newEl) { el.replaceWith(newEl); return true; }
    return false;
  }

  /** Re-render only the My Rating block (.td-my-rating). */
  function updateMyRating() {
    if (!_scroll || !_activeItemId) return;
    const el = _scroll.querySelector(".td-my-rating");
    if (!el) return;
    const tmp = document.createElement("div");
    tmp.innerHTML = myRatingMarkup(_activeItemId);
    const newEl = tmp.firstElementChild;
    if (newEl) el.replaceWith(newEl);
  }

  /** Re-render only the action buttons (now: refresh menu items). */
  function updateDetailActions(item) {
    if (!_activeItemId || !item) return;
    // If menu is open, refresh its contents so watched label stays correct.
    refreshMenuItems();
    // Keep the menu-btn aria-label fresh (it doesn't change with watched state
    // but update it on lang change).
    if (_menuBtn) {
      _menuBtn.setAttribute("aria-label", t("detail.openMenu"));
    }
  }

  /**
   * Refresh all sections (header, genres, scores, my-rating) WITHOUT
   * touching #tdSeasonsSlot. Called by MutationObserver after external changes
   * (edit, move) and by onLangChange().
   */
  function refreshAllSections(item) {
    if (!_scroll || !item) return;
    replaceSection(".td-header", headerMarkup(item));
    replaceSection(".td-genres", genresMarkup(item));
    const summaryEl = _scroll.querySelector(".td-summary");
    if (summaryEl) {
      if (item.summary) {
        summaryEl.textContent = item.summary;
      } else {
        summaryEl.remove();
      }
    }
    replaceSection(".td-scores", scoresMarkup(item));
    updateMyRating();
    updateDetailActions(item);
    if (_topbarTitle) _topbarTitle.textContent = item.title || "";
    requestAnimationFrame(() => setupTitleObserver());
  }

  // ─── DOM construction ─────────────────────────────────────────────────────
  function ensureOverlay() {
    if (_overlay) return;

    _overlay = document.createElement("div");
    _overlay.id = "titleDetailOverlay";
    _overlay.className = "td-overlay";
    _overlay.setAttribute("aria-hidden", "true");
    _overlay.setAttribute("inert", "");

    _overlay.innerHTML = `
      <div class="td-backdrop" id="tdBackdrop"></div>
      <div
        class="td-panel"
        id="tdPanel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tdDetailTitle"
      >
        <div class="td-topbar" id="tdTopbar">
          <span class="td-topbar__title" id="tdTopbarTitle" aria-hidden="true"></span>
          <div class="td-menu" id="tdMenu">
            <button
              type="button"
              class="td-menu-btn"
              id="tdMenuBtn"
              aria-label="${esc(t("detail.openMenu"))}"
              aria-haspopup="menu"
              aria-expanded="false"
            >
              <svg class="td-menu-btn__icon" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
                <circle cx="12" cy="5" r="1.5"/>
                <circle cx="12" cy="12" r="1.5"/>
                <circle cx="12" cy="19" r="1.5"/>
              </svg>
            </button>
            <div
              class="td-menu-panel"
              id="tdMenuPanel"
              role="menu"
              hidden
            ></div>
          </div>
          <button
            type="button"
            class="td-close"
            id="tdCloseBtn"
            aria-label="${esc(t("detail.close"))}"
          >
            <svg class="td-close__icon" viewBox="0 0 24 24" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="td-scroll" id="tdScroll"></div>
      </div>
    `;

    document.body.appendChild(_overlay);

    _panel = _overlay.querySelector("#tdPanel");
    _scroll = _overlay.querySelector("#tdScroll");
    _topbarTitle = _overlay.querySelector("#tdTopbarTitle");
    _menuBtn = _overlay.querySelector("#tdMenuBtn");
    _menuPanel = _overlay.querySelector("#tdMenuPanel");

    _overlay.querySelector("#tdBackdrop").addEventListener("click", () => close());
    _overlay.querySelector("#tdCloseBtn").addEventListener("click", () => close());
    _menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleMenu();
    });
    // Close menu when clicking anywhere in overlay that is not the menu itself
    _overlay.addEventListener("click", onOverlayClick);
    _overlay.addEventListener("keydown", onOverlayKeydown);
    _titleObserver = null;
    setupSwipeToDismiss();
  }

  // ─── Seasons integration ───────────────────────────────────────────────────
  function attachSeasons(item) {
    if (!isTvOrAnime(item)) return;
    const slot = _scroll?.querySelector("#tdSeasonsSlot");
    if (!slot) return;

    window.WatchlistSeasons?.attach?.(slot, item, {
      getWatchEntry: () => getWatchEntry(_activeItemId),
      saveWatchedEntry: (entry) => window.WatchlistApp?.saveWatchedEntry?.(_activeItemId, entry),
      updateCardInPlace: () => window.WatchlistApp?.updateCardInPlace?.(_activeItemId),
      // Called by title-seasons when a watch state changes — refresh My Rating + menu.
      updateHeaderWatchState: () => {
        updateMyRating();
        const fresh = findItem(_activeItemId);
        if (fresh) updateDetailActions(fresh);
      },
      updateDetailActions: () => {
        const fresh = findItem(_activeItemId);
        if (fresh) updateDetailActions(fresh);
        updateMyRating();
      },
      onSeasonSelected: (payload) => updateHeaderSeasonPresentation(payload),
    });
  }

  function detachSeasons() {
    window.WatchlistSeasons?.detach?.();
  }

  // ─── Open ──────────────────────────────────────────────────────────────────
  function _openCore(itemId, item) {
    _activeItemId = itemId;
    _isOpen = true;
    _ignoreMutations = false;
    _menuOpen = false;

    _scroll.innerHTML = buildScrollContent(item);
    if (_topbarTitle) _topbarTitle.textContent = item.title || "";

    // Reset menu panel state
    if (_menuPanel) { _menuPanel.hidden = true; _menuPanel.innerHTML = ""; }
    if (_menuBtn) _menuBtn.setAttribute("aria-expanded", "false");

    _overlay.removeAttribute("inert");
    _overlay.removeAttribute("aria-hidden");
    _overlay.classList.add("td-is-open");

    lockBackgroundScroll();

    requestAnimationFrame(() => {
      _overlay.querySelector("#tdCloseBtn")?.focus();
    });

    _titleIntersecting = true;
    requestAnimationFrame(() => setupTitleObserver());

    watchForAppChanges();
    attachSeasons(item);
    if (item.contentType === "anime" || item.contentType === "tvSeries") {
      window.WatchlistApp?.queueItemBadgeEnrichment?.(itemId);
    }
  }

  function open(card) {
    const itemId = card?.dataset?.id;
    if (!itemId) return;

    const item = resolveItemData(itemId, card);
    if (!item?.title) return;

    _openerEl = document.activeElement;
    ensureOverlay();
    window.WatchlistApp?.closeAllMenus?.();
    _openCore(itemId, item);
  }

  function openById(itemId) {
    const card = document.querySelector(`.card[data-id="${CSS.escape(itemId)}"]`);
    if (card) {
      open(card);
      return;
    }
    const item = findItem(itemId);
    if (!item) return;
    ensureOverlay();
    window.WatchlistApp?.closeAllMenus?.();
    _openerEl = document.activeElement;
    _openCore(itemId, item);
  }

  // ─── Close ─────────────────────────────────────────────────────────────────
  function close() {
    if (!_overlay || !_isOpen) return;
    _isOpen = false;

    closeMenu();
    detachSeasons();
    _panelDrag = null;
    resetPanelDragStyles();

    const returnFocus = _openerEl;
    _openerEl = null;
    _activeItemId = null;
    _ignoreMutations = false;

    // Move focus out before aria-hidden — close button often still has focus here.
    const active = document.activeElement;
    if (active && _overlay.contains(active)) {
      active.blur();
    }
    if (returnFocus && document.contains(returnFocus)) {
      try {
        returnFocus.focus({ preventScroll: true });
      } catch {
        /* opener may not accept focus */
      }
    }

    _overlay.classList.remove("td-is-open");
    _overlay.setAttribute("aria-hidden", "true");
    _overlay.setAttribute("inert", "");

    unlockBackgroundScroll();

    disconnectObservers();
    _topbarTitle?.classList.remove("td-topbar__title--visible");

    _restoring = true;
    const onTransitionEnd = () => {
      _restoring = false;
      _panel?.removeEventListener("transitionend", onTransitionEnd);
      if (
        returnFocus &&
        document.contains(returnFocus) &&
        (!_overlay.contains(document.activeElement) ||
          document.activeElement === document.body)
      ) {
        returnFocus.focus?.({ preventScroll: true });
      }
    };
    _panel?.addEventListener("transitionend", onTransitionEnd);
    setTimeout(() => {
      if (_restoring) onTransitionEnd();
    }, 400);
  }

  // ─── Refresh (non-destructive, seasons preserved) ─────────────────────────
  function refresh() {
    if (!_isOpen || !_activeItemId) return;
    const item = findItem(_activeItemId);
    if (!item) {
      close();
      return;
    }
    refreshAllSections(item);
  }

  // ─── Resolve item data from card DOM + app state ───────────────────────────
  function resolveItemData(itemId, card) {
    let item = findItem(itemId);
    if (!item) {
      item = extractFromCard(card, itemId);
    }
    const posterImg = card?.querySelector(".card__poster");
    if (posterImg?.src && !posterImg.classList.contains("card__poster--placeholder") && !item?.poster) {
      if (item) item = { ...item, poster: posterImg.src };
    }
    return item;
  }

  function extractFromCard(card, itemId) {
    if (!card) return null;
    const titleEl = card.querySelector(".card__title");
    const title =
      titleEl?.childNodes?.[0]?.textContent?.trim() ||
      titleEl?.textContent?.trim() || "";
    const summary = card.querySelector(".card__summary")?.textContent?.trim() || "";
    const lead = card.querySelector(".card__lead")?.textContent?.trim() || "";
    const posterImg = card.querySelector(".card__poster");
    const poster = posterImg?.src && !posterImg.classList.contains("card__poster--placeholder")
      ? posterImg.src : "";
    const primaryGenreEl =
      card.querySelector(".card__overlay .badge--genre-primary") ||
      card.querySelector(".card__head .badge--genre-primary");
    const genre = primaryGenreEl?.textContent.trim() || "";
    const secondaryGenres = [
      ...card.querySelectorAll(
        ".card__overlay .badge--genre-secondary, .card__head .badge--genre-secondary"
      ),
    ].map((el) => el.textContent.trim());

    return {
      id: itemId || "",
      title,
      altTitle: card.querySelector(".card__alt")?.textContent?.trim() || "",
      summary,
      leads: lead ? lead.split(",").map((p) => p.trim()).filter(Boolean) : [],
      lead,
      genre,
      secondaryGenres,
      poster,
      link: card.dataset.link || "",
      contentType: "movies",
      kind: "movie",
    };
  }

  // ─── Compact title observer ───────────────────────────────────────────────
  function setupTitleObserver() {
    if (_titleObserver) {
      _titleObserver.disconnect();
      _titleObserver = null;
    }
    if (!_scroll || !_topbarTitle) return;
    const titleEl = _scroll.querySelector("#tdDetailTitle");
    if (!titleEl) return;

    _titleObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        _titleIntersecting = entry.isIntersecting;
        _topbarTitle.classList.toggle("td-topbar__title--visible", !_titleIntersecting);
      },
      { root: _scroll, threshold: 0 }
    );
    _titleObserver.observe(titleEl);
  }

  // ─── Watch for external item updates / deletion ───────────────────────────
  function watchForAppChanges() {
    disconnectObservers();
    const main = document.getElementById("mainContent");
    if (!main) return;

    _staleObserver = new MutationObserver(() => {
      if (!_isOpen || !_activeItemId) return;
      if (_ignoreMutations) return;

      const cardStillExists = main.querySelector(
        `.card[data-id="${CSS.escape(_activeItemId)}"]`
      );
      if (!cardStillExists) {
        close();
        return;
      }
      const freshItem = findItem(_activeItemId);
      if (freshItem) {
        refreshAllSections(freshItem);
        window.WatchlistSeasons?.onExternalRefresh?.();
      }
    });

    _staleObserver.observe(main, { childList: true, subtree: false });
  }

  function disconnectObservers() {
    _staleObserver?.disconnect();
    _staleObserver = null;
    _titleObserver?.disconnect();
    _titleObserver = null;
  }

  // ─── Action handler ───────────────────────────────────────────────────────
  function onOverlayClick(event) {
    // Close menu when clicking outside the menu root
    if (_menuOpen) {
      const menuRoot = _overlay.querySelector("#tdMenu");
      if (menuRoot && !menuRoot.contains(event.target)) {
        closeMenu();
      }
    }

    const target = event.target.closest("[data-td-action]");
    if (!target) return;

    const action = target.dataset.tdAction;
    const id = target.dataset.tdId || _activeItemId;
    if (!id) return;

    // Close menu before acting (except for the menu open button which is handled separately)
    if (action !== "open-menu") closeMenu();

    handleAction(action, id, target, event);
  }

  async function handleAction(action, itemId, target, event) {
    switch (action) {
      case "quick-toggle-watched": {
        event?.stopPropagation?.();
        event?.preventDefault?.();
        _ignoreMutations = true;
        await window.WatchlistApp?.quickToggleWatched?.(itemId);
        updateMyRating();
        refreshMenuItems();
        window.WatchlistSeasons?.onTitleWatchedChanged?.();
        Promise.resolve().then(() => { _ignoreMutations = false; });
        break;
      }

      case "toggle-watched": {
        // Suppress MutationObserver so it doesn't trigger a full rebuild.
        _ignoreMutations = true;
        triggerCardAction(itemId, "toggle-watched");
        // app.js render() has already fired synchronously.
        const freshItem = findItem(itemId);
        // Update My Rating section (watched state changed).
        updateMyRating();
        // Refresh menu items so the watched label flips.
        refreshMenuItems();
        // Notify seasons module to re-read episode/season watched state.
        window.WatchlistSeasons?.onTitleWatchedChanged?.();
        Promise.resolve().then(() => { _ignoreMutations = false; });
        break;
      }

      case "rate": {
        if (!isTitleFullyWatched(itemId)) break;
        triggerCardAction(itemId, "rate");
        break;
      }

      case "add-note": {
        // Open the rating modal in note-only mode (picker hidden by openRatingModal)
        triggerCardAction(itemId, "rate");
        break;
      }

      case "edit": {
        triggerCardAction(itemId, "edit");
        break;
      }

      case "move": {
        triggerCardAction(itemId, "move-to-list");
        break;
      }

      case "delete": {
        const item = findItem(itemId);
        const name = item ? item.title : t("list.thisTitle");
        let confirmed = false;
        try {
          confirmed = await window.WatchlistDialog.confirm(
            t("alert.deleteTitleConfirm", { name: ltr(name) }),
            {
              title: t("alert.deleteTitleTitle"),
              confirmLabel: t("btn.delete"),
              cancelLabel: t("btn.cancel"),
              danger: true,
            }
          );
        } catch {
          confirmed = false;
        }
        if (!confirmed) return;
        window.WatchlistApp?.deleteAndRender?.(itemId);
        break;
      }
    }
  }

  function triggerCardAction(itemId, action) {
    if (!itemId) return;
    const card = document.querySelector(`.card[data-id="${CSS.escape(itemId)}"]`);
    card?.querySelector(`[data-action="${action}"]`)?.click();
  }

  // ─── Overlay keyboard handler ──────────────────────────────────────────────
  function onOverlayKeydown(event) {
    // Escape: close menu first, then close panel if menu was already closed
    if (event.key === "Escape") {
      event.stopPropagation();
      if (_menuOpen) {
        closeMenu();
        _menuBtn?.focus();
      } else {
        close();
      }
      return;
    }

    // Arrow keys inside open menu
    if (_menuOpen && _menuPanel && !_menuPanel.hidden) {
      const items = [..._menuPanel.querySelectorAll("[role='menuitem']")];
      if (!items.length) return;
      const current = items.indexOf(document.activeElement);
      if (event.key === "ArrowDown") {
        event.preventDefault();
        items[(current + 1) % items.length].focus();
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        items[(current - 1 + items.length) % items.length].focus();
        return;
      }
    }

    if (event.key === "Tab" && _panel) {
      const focusable = getFocusable(_panel);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey) {
        if (document.activeElement === first) {
          event.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
  }

  function getFocusable(container) {
    return [
      ...container.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]),' +
        ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ),
    ].filter((el) => !el.closest("[hidden]") && !el.closest("[inert]"));
  }

  // ─── Card click interception (all breakpoints) ────────────────────────────
  function bindCardClick() {
    if (_cardClickBound) return;
    const main = document.getElementById("mainContent");
    if (!main) return;
    _cardClickBound = true;

    main.addEventListener(
      "click",
      (event) => {
        const card = event.target.closest(".card");
        if (!card) return;

        if (
          event.target.closest(
            "button, a, input, select, textarea, [role='menuitem'], .card-menu__panel, .card-menu__trigger"
          )
        ) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        open(card);
      },
      true // capture phase
    );
  }

  // ─── Language change ──────────────────────────────────────────────────────
  function onLangChange() {
    if (!_isOpen || !_activeItemId) return;
    const item = findItem(_activeItemId);
    if (!item) return;
    // Patch all text sections without touching the seasons slot.
    refreshAllSections(item);
    // Update close/menu button aria-labels.
    const closeBtn = _overlay?.querySelector("#tdCloseBtn");
    if (closeBtn) closeBtn.setAttribute("aria-label", t("detail.close"));
    if (_menuBtn) _menuBtn.setAttribute("aria-label", t("detail.openMenu"));
    // Let the seasons module update its own labels.
    window.WatchlistSeasons?.onLangChange?.();
  }

  // ─── Init ─────────────────────────────────────────────────────────────────
  function init() {
    bindCardClick();

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && _isOpen) {
        if (_menuOpen) { closeMenu(); _menuBtn?.focus(); }
        else close();
      }
    });

    window.WatchlistI18n?.onChange?.(onLangChange);
  }

  function boot() {
    init();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  // ─── Public API ───────────────────────────────────────────────────────────
  window.WatchlistTitleDetail = {
    open,
    openById,
    close,
    refresh,
    isOpen: () => _isOpen,
    activeItemId: () => _activeItemId,
    // Targeted update hooks (used by WatchlistSeasons)
    updateMyRating,
    updateDetailActions: (item) => updateDetailActions(item || findItem(_activeItemId)),
  };
})();
