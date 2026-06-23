(function () {
  "use strict";

  const MOBILE_QUERY = "(max-width: 640px)";
  const media = window.matchMedia(MOBILE_QUERY);

  let focusOverlay = null;
  let focusContent = null;
  let focusActions = null;
  let activeCardId = null;
  let listenersBound = false;

  function isMobile() {
    return media.matches;
  }

  function escapeHtml(text) {
    return String(text ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

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

  function formatRating(rating) {
    const num = Number(rating);
    if (!Number.isFinite(num)) return "0";
    return Number.isInteger(num) ? String(num) : num.toFixed(1);
  }

  function findItemById(itemId) {
    const listId = window.WatchlistAuth?.getProfile?.();
    const keys = listId ? window.WatchlistAuth?.storageKeys?.(listId) : null;
    if (!keys?.data) return null;

    try {
      const data = JSON.parse(localStorage.getItem(keys.data) || "{}");
      for (const [contentType, genres] of Object.entries(data)) {
        for (const [genre, titles] of Object.entries(genres || {})) {
          for (const entry of titles || []) {
            const id = `${contentType}::${genre}::${entry.title}`;
            if (id === itemId) {
              const leads = Array.isArray(entry.leads)
                ? entry.leads
                : entry.lead
                  ? String(entry.lead)
                      .split(",")
                      .map((part) => part.trim())
                      .filter(Boolean)
                  : [];
              return {
                ...entry,
                contentType,
                genre,
                id,
                leads,
                lead: leads.join(", "),
                secondaryGenres: entry.secondaryGenres || [],
                link: entry.link || "",
                imdbRating: entry.imdbRating || "",
                anilistRating: entry.anilistRating || "",
              };
            }
          }
        }
      }
    } catch {
      return null;
    }

    return null;
  }

  function getWatchEntry(itemId) {
    const listId = window.WatchlistAuth?.getProfile?.();
    const keys = listId ? window.WatchlistAuth?.storageKeys?.(listId) : null;
    if (!keys?.watched) return null;

    try {
      const watched = JSON.parse(localStorage.getItem(keys.watched) || "{}");
      return watched[itemId] || null;
    } catch {
      return null;
    }
  }

  function hasWatchRating(entry) {
    return entry?.rating != null && Number.isFinite(Number(entry.rating));
  }

  function t(key, vars) {
    return window.WatchlistI18n?.t(key, vars) ?? key;
  }

  function ltr(text) {
    return window.WatchlistI18n?.isolateLtr?.(text) ?? text;
  }

  function genreLabel(genre) {
    return window.WatchlistI18n?.genreLabel?.(genre) ?? genre;
  }

  function ensureCardFocusOverlay() {
    if (focusOverlay) return;

    focusOverlay = document.createElement("div");
    focusOverlay.id = "mobileCardFocus";
    focusOverlay.className = "mobile-card-focus";
    focusOverlay.hidden = true;
    focusOverlay.innerHTML = `
      <div class="mobile-card-focus__backdrop" data-action="close-mobile-card-focus"></div>
      <div class="mobile-card-focus__panel" role="dialog" aria-modal="true" aria-labelledby="mobileCardFocusTitle">
        <button type="button" class="mobile-card-focus__close" data-action="close-mobile-card-focus" aria-label="${escapeHtml(t("mobile.close"))}">×</button>
        <div class="mobile-card-focus__scroll" id="mobileCardFocusContent"></div>
        <div class="mobile-card-focus__actions" id="mobileCardFocusActions"></div>
      </div>
    `;
    document.body.appendChild(focusOverlay);
    focusContent = focusOverlay.querySelector("#mobileCardFocusContent");
    focusActions = focusOverlay.querySelector("#mobileCardFocusActions");

    focusOverlay.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]");
      if (!action) return;

      if (action.dataset.action === "close-mobile-card-focus") {
        closeCardFocus();
        return;
      }

      if (action.dataset.action === "open-mobile-card-link") {
        const link = action.dataset.link;
        if (link) {
          window.open(link, "_blank", "noopener,noreferrer");
        }
        return;
      }

      if (action.dataset.action === "mobile-card-rate") {
        const itemId = action.dataset.id;
        closeCardFocus();
        triggerCardAction(itemId, "rate");
        return;
      }

      if (action.dataset.action === "mobile-card-edit") {
        const itemId = action.dataset.id;
        closeCardFocus();
        triggerCardAction(itemId, "edit");
        return;
      }

      if (action.dataset.action === "mobile-card-move-list") {
        const itemId = action.dataset.id;
        closeCardFocus();
        triggerCardAction(itemId, "move-to-list");
        return;
      }

      if (action.dataset.action === "mobile-card-delete") {
        const itemId = action.dataset.id;
        closeCardFocus();
        triggerCardAction(itemId, "delete");
        return;
      }

      if (action.dataset.action === "mobile-card-toggle-watched") {
        const itemId = action.dataset.id;
        closeCardFocus();
        triggerCardAction(itemId, "toggle-watched");
      }
    });
  }

  function formatImdbDisplay(value) {
    const num = Number(String(value ?? "").replace(",", "."));
    if (!Number.isFinite(num)) return "";
    return Number.isInteger(num) ? String(num) : num.toFixed(1);
  }

  function formatAnilistDisplay(value) {
    const num = Number(String(value ?? "").replace(",", "."));
    if (!Number.isFinite(num)) return "";
    const pct = num > 10 ? Math.round(num) : Math.round(num * 10);
    return `${pct}%`;
  }

  function renderFocusExternalRatings(item) {
    if (window.WatchlistApp?.renderExternalRatings) {
      return window.WatchlistApp.renderExternalRatings(item);
    }

    const parts = [];
    const imdb = formatImdbDisplay(item.imdbRating);
    const anilist = formatAnilistDisplay(item.anilistRating);

    if (imdb) {
      parts.push(
        `<span class="card__score card__score--imdb" title="IMDb ${escapeHtml(imdb)}">
          <span class="card__score-value text-num">${escapeHtml(imdb)}</span>
          <img class="card__score-logo card__score-logo--imdb" src="assets/brand/imdb.svg" width="46" height="20" alt="" />
        </span>`
      );
    }
    if (anilist) {
      parts.push(
        `<span class="card__score card__score--anilist" title="AniList ${escapeHtml(anilist)}">
          <span class="card__score-value text-num">${escapeHtml(anilist)}</span>
          <img class="card__score-logo card__score-logo--anilist" src="assets/brand/anilist.svg" width="34" height="26" alt="" />
        </span>`
      );
    }

    if (!parts.length) return "";
    return `<div class="card__rating-badges">${parts.join("")}</div>`;
  }

  // DEPRECATED (Stage C): buildFocusMarkup / buildFocusActions / openCardFocus
  // are no longer called when title-detail.js is loaded. Kept as a fallback
  // for environments where title-detail.js fails to load. Remove in Stage F.
  function buildFocusMarkup(item, watchEntry) {
    const typeBadge = getTypeBadge(item);
    const secondaryBadges = (item.secondaryGenres || [])
      .map(
        (genre) =>
          `<span class="badge badge--genre-secondary">${escapeHtml(genreLabel(genre))}</span>`
      )
      .join("");
    const mainGenreBadge = item.genre
      ? `<span class="badge badge--genre-primary">${escapeHtml(genreLabel(item.genre))}</span>`
      : "";
    const yearLabel = item.year ? String(item.year).trim() : "";
    const yearBadge = yearLabel
      ? `<span class="badge badge--year text-num">${escapeHtml(yearLabel)}</span>`
      : "";
    const metaBadges = (window.WatchlistMetadata?.buildTitleMetaBadges(item, item.contentType) || [])
      .map(
        (badge) => {
          const titleAttr =
            badge.kind === "age" && badge.title
              ? ` title="${escapeHtml(badge.title)}"`
              : "";
          return `<span class="badge badge--${badge.kind}"${titleAttr}>${escapeHtml(badge.label)}</span>`;
        }
      )
      .join("");
    const genreRow = [mainGenreBadge, secondaryBadges].filter(Boolean).join("");
    const altTitle = item.altTitle
      ? `<span class="mobile-card-focus__alt text-ltr">${escapeHtml(ltr(item.altTitle))}</span>`
      : "";
    const poster = item.posterBroken
      ? `<div class="mobile-card-focus__poster mobile-card-focus__poster--empty mobile-card-focus__poster--broken" role="status">
          <span class="card__poster-message">${escapeHtml(t("card.posterBroken"))}</span>
        </div>`
      : item.poster
        ? `<img class="mobile-card-focus__poster" src="${escapeHtml(item.poster)}" alt="" />`
        : `<div class="mobile-card-focus__poster mobile-card-focus__poster--empty" aria-hidden="true">🎬</div>`;
    const leads = (item.leads || []).filter(Boolean);
    const leadBlock = leads.length
      ? `<p class="mobile-card-focus__lead">${escapeHtml(leads.join(", "))}</p>`
      : "";

    let ratingBlock = `<p class="mobile-card-focus__unwatched">${escapeHtml(t("mobile.notWatched"))}</p>`;
    let ratingInteractive = false;
    let ratingAriaLabel = "";

    if (watchEntry && hasWatchRating(watchEntry)) {
      ratingInteractive = true;
      ratingAriaLabel = t("mobile.editRating");
      ratingBlock = `
        <div class="mobile-card-focus__rating-top">
          <span class="mobile-card-focus__rating-label">${escapeHtml(t("card.yourRating"))}</span>
          <span class="mobile-card-focus__rating-score text-num">${escapeHtml(formatRating(watchEntry.rating))}/10</span>
        </div>
        ${
          watchEntry.note
            ? `<p class="mobile-card-focus__rating-note">${escapeHtml(watchEntry.note)}</p>`
            : ""
        }
      `;
    } else if (watchEntry) {
      ratingInteractive = true;
      ratingAriaLabel = t("mobile.rateTitle");
      ratingBlock = `<p class="mobile-card-focus__unwatched">${escapeHtml(t("mobile.watchedUnrated"))}</p>`;
    }

    const ratingClass = ratingInteractive
      ? "mobile-card-focus__rating mobile-card-focus__rating--interactive"
      : "mobile-card-focus__rating";
    const ratingEl = ratingInteractive
      ? `<button
          type="button"
          class="${ratingClass}"
          data-action="mobile-card-rate"
          data-id="${escapeHtml(item.id)}"
          aria-label="${escapeHtml(ratingAriaLabel)}"
        >${ratingBlock}</button>`
      : `<div class="${ratingClass}">${ratingBlock}</div>`;

    const externalScores = renderFocusExternalRatings(item);

    return `
      <header class="mobile-card-focus__header">
        <div class="mobile-card-focus__thumb">${poster}</div>
        <div class="mobile-card-focus__header-main">
          <h2 class="mobile-card-focus__title" id="mobileCardFocusTitle">
            <span class="text-ltr">${escapeHtml(ltr(window.WatchlistApp?.cardDisplayTitle?.(item) || item.title))}</span>
            ${altTitle}
          </h2>
          ${leadBlock}
          <div class="mobile-card-focus__badges">
            <div class="mobile-card-focus__badge-row">
              <span class="badge badge--${typeBadge.className}">${escapeHtml(typeBadge.label)}</span>
              ${yearBadge}
              ${metaBadges}
            </div>
            ${
              genreRow
                ? `<span class="mobile-card-focus__section-label">${escapeHtml(t("card.sectionGenres"))}</span>
                   <div class="mobile-card-focus__badge-row mobile-card-focus__badge-row--genres">${genreRow}</div>`
                : ""
            }
          </div>
        </div>
      </header>
      <p class="mobile-card-focus__summary">${escapeHtml(item.summary || "")}</p>
      ${externalScores ? `<div class="mobile-card-focus__scores">${externalScores}</div>` : ""}
      ${ratingEl}
    `;
  }

  function buildFocusActions(item, watchEntry) {
    const watched = Boolean(watchEntry);
    const listIds = window.WatchlistAuth?.discoverListIds?.() || [];
    const canMoveToList = listIds.length > 1;
    const buttons = [];

    if (item.link) {
      buttons.push(`
        <button
          type="button"
          class="btn btn--primary btn--sm mobile-card-focus__btn mobile-card-focus__btn--primary"
          data-action="open-mobile-card-link"
          data-link="${escapeHtml(item.link)}"
        >
          ${escapeHtml(t("card.openLink"))}
        </button>
      `);
    }

    buttons.push(`
      <button
        type="button"
        class="btn btn--ghost btn--sm mobile-card-focus__btn"
        data-action="mobile-card-toggle-watched"
        data-id="${escapeHtml(item.id)}"
      >
        ${escapeHtml(watched ? t("card.markUnwatched") : t("card.markWatched"))}
      </button>
    `);

    buttons.push(`
      <button
        type="button"
        class="btn btn--ghost btn--sm mobile-card-focus__btn"
        data-action="mobile-card-edit"
        data-id="${escapeHtml(item.id)}"
      >
        ${escapeHtml(t("card.edit"))}
      </button>
    `);

    if (canMoveToList) {
      buttons.push(`
        <button
          type="button"
          class="btn btn--ghost btn--sm mobile-card-focus__btn"
          data-action="mobile-card-move-list"
          data-id="${escapeHtml(item.id)}"
        >
          ${escapeHtml(t("card.moveToList"))}
        </button>
      `);
    }

    buttons.push(`
      <button
        type="button"
        class="btn btn--sm btn--danger mobile-card-focus__btn"
        data-action="mobile-card-delete"
        data-id="${escapeHtml(item.id)}"
      >
        ${escapeHtml(t("card.delete"))}
      </button>
    `);

    return `<div class="mobile-card-focus__actions-list">${buttons.join("")}</div>`;
  }

  function extractItemFromCard(card, itemId) {
    const titleEl = card.querySelector(".card__title");
    const title =
      titleEl?.childNodes?.[0]?.textContent?.trim() ||
      titleEl?.textContent?.trim() ||
      "";
    const altTitle = card.querySelector(".card__alt")?.textContent?.trim() || "";
    const summary = card.querySelector(".card__summary")?.textContent?.trim() || "";
    const lead = card.querySelector(".card__lead")?.textContent?.trim() || "";
    const posterImg = card.querySelector(".card__poster");
    const poster = posterImg?.src && !posterImg.classList.contains("card__poster--placeholder")
      ? posterImg.src
      : "";

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
      altTitle,
      summary,
      leads: lead ? lead.split(",").map((part) => part.trim()).filter(Boolean) : [],
      lead,
      genre,
      secondaryGenres,
      poster,
      link: card.dataset.link || "",
      contentType: "movies",
      kind: "movie",
    };
  }

  function openCardFocus(card) {
    const itemId = card?.dataset?.id;
    if (!itemId) return;

    let item = findItemById(itemId);
    if (!item) {
      item = extractItemFromCard(card, itemId);
    }

    const posterImg = card.querySelector(".card__poster");
    if (
      posterImg?.src &&
      !posterImg.classList.contains("card__poster--placeholder") &&
      !item.poster
    ) {
      item.poster = posterImg.src;
    }

    if (!item?.title) return;

    ensureCardFocusOverlay();

    const watchEntry = getWatchEntry(itemId);
    activeCardId = itemId;

    const markup = buildFocusMarkup(item, watchEntry);
    focusContent.innerHTML = markup;
    focusActions.innerHTML = buildFocusActions(item, watchEntry);
    focusOverlay.hidden = false;
    document.body.style.overflow = "hidden";

    focusOverlay.querySelector(".mobile-card-focus__close")?.focus();
  }

  function closeCardFocus() {
    if (!focusOverlay) return;
    focusOverlay.hidden = true;
    activeCardId = null;
    document.body.style.overflow = "";
  }

  function triggerCardAction(itemId, action) {
    if (!itemId) return;
    const card = document.querySelector(`.card[data-id="${CSS.escape(itemId)}"]`);
    card?.querySelector(`[data-action="${action}"]`)?.click();
  }

  function onMainClick(event) {
    // title-detail.js now handles card clicks on all breakpoints.
    // Return immediately when that module is loaded.
    if (window.WatchlistTitleDetail) return;

    // Legacy fallback (mobile-only, used if title-detail.js is absent)
    if (!isMobile()) return;
    if (focusOverlay && !focusOverlay.hidden) return;

    const card = event.target.closest(".card");
    if (!card) return;
    if (event.target.closest("button, a, .card-menu__panel")) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    openCardFocus(card);
  }

  function onDocumentKeydown(event) {
    if (event.key === "Escape" && focusOverlay && !focusOverlay.hidden) {
      closeCardFocus();
    }
  }

  function bindListeners() {
    if (listenersBound) return;
    listenersBound = true;

    const main = document.getElementById("mainContent");
    if (main) {
      main.addEventListener("click", onMainClick, true);
    }

    document.addEventListener("keydown", onDocumentKeydown);
  }

  function setViewportMode() {
    document.documentElement.dataset.viewport = isMobile() ? "mobile" : "desktop";
    document.documentElement.classList.toggle("is-mobile", isMobile());

    if (!isMobile()) {
      closeCardFocus();
    }
  }

  function initMobileLayout() {
    bindListeners();
  }

  window.WatchlistMobile = {
    isMobile,
    MOBILE_QUERY,
    openCardFocus,
    closeCardFocus,
    initMobileLayout,
  };

  function boot() {
    setViewportMode();
    if (isMobile()) {
      initMobileLayout();
    }
  }

  media.addEventListener("change", () => {
    setViewportMode();
    if (isMobile()) initMobileLayout();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
