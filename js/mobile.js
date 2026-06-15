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
      return { label: "Anime", className: "anime" };
    }
    if (item.kind === "film series") {
      return { label: "Film series", className: "franchise" };
    }
    if (item.contentType === "tvSeries") {
      return { label: "TV Series", className: "tvSeries" };
    }
    return { label: "Movie", className: "movie" };
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
          <span class="card__score-value">${escapeHtml(imdb)}</span>
          <img class="card__score-logo card__score-logo--imdb" src="assets/brand/imdb.svg" width="46" height="20" alt="" />
        </span>`
      );
    }
    if (anilist) {
      parts.push(
        `<span class="card__score card__score--anilist" title="AniList ${escapeHtml(anilist)}">
          <span class="card__score-value">${escapeHtml(anilist)}</span>
          <img class="card__score-logo card__score-logo--anilist" src="assets/brand/anilist.svg" width="34" height="26" alt="" />
        </span>`
      );
    }

    if (!parts.length) return "";
    return `<div class="card__rating-badges">${parts.join("")}</div>`;
  }

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
    const altTitle = item.altTitle
      ? `<span class="mobile-card-focus__alt">${escapeHtml(item.altTitle)}</span>`
      : "";
    const poster = item.poster
      ? `<img class="mobile-card-focus__poster" src="${escapeHtml(item.poster)}" alt="" />`
      : `<div class="mobile-card-focus__poster mobile-card-focus__poster--empty" aria-hidden="true">🎬</div>`;
    const leads = (item.leads || []).filter(Boolean);
    const leadBlock = leads.length
      ? `<p class="mobile-card-focus__lead">${escapeHtml(leads.join(", "))}</p>`
      : "";

    let ratingBlock = `<p class="mobile-card-focus__unwatched">${escapeHtml(t("mobile.notWatched"))}</p>`;
    if (watchEntry && hasWatchRating(watchEntry)) {
      ratingBlock = `
        <div class="mobile-card-focus__rating-top">
          <span class="mobile-card-focus__rating-label">${escapeHtml(t("card.yourRating"))}</span>
          <span class="mobile-card-focus__rating-score">${escapeHtml(formatRating(watchEntry.rating))}/10</span>
        </div>
        ${
          watchEntry.note
            ? `<p class="mobile-card-focus__rating-note">${escapeHtml(watchEntry.note)}</p>`
            : ""
        }
      `;
    } else if (watchEntry) {
      ratingBlock = `<p class="mobile-card-focus__unwatched">${escapeHtml(t("mobile.watchedUnrated"))}</p>`;
    }

    const externalScores = renderFocusExternalRatings(item);

    return `
      ${poster}
      <div class="mobile-card-focus__badges">
        <div class="mobile-card-focus__badge-row">
          <span class="badge badge--${typeBadge.className}">${escapeHtml(typeBadge.label)}</span>
        </div>
        <div class="mobile-card-focus__badge-row">
          ${mainGenreBadge}
          ${secondaryBadges}
        </div>
      </div>
      <h2 class="mobile-card-focus__title" id="mobileCardFocusTitle">
        ${escapeHtml(item.title)}
        ${altTitle}
      </h2>
      ${leadBlock}
      <p class="mobile-card-focus__summary">${escapeHtml(item.summary || "")}</p>
      ${externalScores ? `<div class="mobile-card-focus__scores">${externalScores}</div>` : ""}
      <div class="mobile-card-focus__rating">${ratingBlock}</div>
    `;
  }

  function buildFocusActions(item, watchEntry) {
    const parts = [];

    if (item.link) {
      parts.push(`
        <button
          type="button"
          class="btn btn--primary mobile-card-focus__link-btn"
          data-action="open-mobile-card-link"
          data-link="${escapeHtml(item.link)}"
        >
          ${escapeHtml(t("card.openLink"))}
        </button>
      `);
    }

    if (watchEntry && !hasWatchRating(watchEntry)) {
      parts.push(`
        <button
          type="button"
          class="btn btn--ghost mobile-card-focus__rate-btn"
          data-action="mobile-card-rate"
          data-id="${escapeHtml(item.id)}"
        >
          ${escapeHtml(t("mobile.rateTitle"))}
        </button>
      `);
    } else if (watchEntry && hasWatchRating(watchEntry)) {
      parts.push(`
        <button
          type="button"
          class="btn btn--ghost mobile-card-focus__rate-btn"
          data-action="mobile-card-rate"
          data-id="${escapeHtml(item.id)}"
        >
          ${escapeHtml(t("mobile.editRating"))}
        </button>
      `);
    }

    return parts.join("");
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

    const genres = [...card.querySelectorAll(".badge--genre-primary")].map(
      (el) => el.textContent.trim()
    );
    const secondaryGenres = [
      ...card.querySelectorAll(".badge--genre-secondary"),
    ].map((el) => el.textContent.trim());

    return {
      id: itemId || "",
      title,
      altTitle,
      summary,
      leads: lead ? lead.split(",").map((part) => part.trim()).filter(Boolean) : [],
      lead,
      genre: genres[0] || "",
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

    focusContent.innerHTML = buildFocusMarkup(item, watchEntry);
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
