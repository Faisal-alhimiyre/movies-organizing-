(function () {
  "use strict";

  const STORAGE_KEY = "watchlist-theme-v1";
  const THEMES = ["dark", "light", "purple", "brown"];
  const DEFAULT_THEME = "dark";
  const LEGACY_MAP = { fancy: "purple", midnight: "dark" };
  let listeners = [];

  function normalizeTheme(theme) {
    if (LEGACY_MAP[theme]) return LEGACY_MAP[theme];
    return THEMES.includes(theme) ? theme : DEFAULT_THEME;
  }

  function getTheme() {
    const saved = localStorage.getItem(STORAGE_KEY);
    return normalizeTheme(saved);
  }

  function applyTheme(theme) {
    const next = normalizeTheme(theme);
    document.documentElement.dataset.theme = next;
    localStorage.setItem(STORAGE_KEY, next);
    applyThemeUi();
    listeners.forEach((fn) => fn(next));
  }

  function applyThemeUi() {
    const current = getTheme();
    document.querySelectorAll("[data-action='set-theme']").forEach((btn) => {
      const active = btn.dataset.theme === current;
      btn.classList.toggle("theme-option--active", active);
      btn.classList.toggle("gate__theme-swatch--active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
  }

  function onChange(fn) {
    listeners.push(fn);
  }

  function init() {
    applyTheme(getTheme());
  }

  window.WatchlistThemes = {
    getTheme,
    setTheme: applyTheme,
    onChange,
    applyThemeUi,
    THEMES,
  };

  init();
})();
