(function () {
  "use strict";

  const auth = window.WatchlistAuth;
  const i18n = () => window.WatchlistI18n;

  function t(key, vars) {
    return i18n()?.t(key, vars) ?? key;
  }

  const els = {
    modes: document.querySelectorAll(".gate__mode"),
    openForm: document.getElementById("openForm"),
    createForm: document.getElementById("createForm"),
    openCode: document.getElementById("openCode"),
    createCode: document.getElementById("createCode"),
    confirmCode: document.getElementById("confirmCode"),
    error: document.getElementById("gateError"),
    themeModal: document.getElementById("themeModal"),
  };

  function openGateThemeModal() {
    if (!els.themeModal) return;
    els.themeModal.hidden = false;
    document.body.style.overflow = "hidden";
    window.WatchlistThemes?.applyThemeUi?.();
    els.themeModal.querySelector(".theme-option")?.focus();
  }

  function closeGateThemeModal() {
    if (!els.themeModal) return;
    els.themeModal.hidden = true;
    document.body.style.overflow = "";
  }

  function showError(message, fields = []) {
    const text = i18n()?.translateAuthError(message) || message || "";
    if (els.error) {
      els.error.hidden = !text;
      els.error.textContent = text;
    }

    const targets = fields.length
      ? fields
      : [els.openCode, els.createCode, els.confirmCode];

    targets.forEach((field) => {
      if (!field) return;
      field.classList.toggle("gate__input--invalid", Boolean(text));
    });
  }

  function clearInputErrors() {
    showError("");
  }

  const PENDING_SHARE_KEY = "watchlist-pending-share";

  function getShareIdFromLocation() {
    return new URLSearchParams(window.location.search).get("share")?.trim() || "";
  }

  function persistPendingShareId(shareId) {
    if (!shareId) return;
    try {
      sessionStorage.setItem(PENDING_SHARE_KEY, shareId);
    } catch {
      /* ignore */
    }
  }

  function readPendingShareId() {
    const fromUrl = getShareIdFromLocation();
    if (fromUrl) return fromUrl;
    try {
      return sessionStorage.getItem(PENDING_SHARE_KEY)?.trim() || "";
    } catch {
      return "";
    }
  }

  function goToApp() {
    const shareId = readPendingShareId();
    if (shareId) persistPendingShareId(shareId);
    window.location.href = shareId
      ? `index.html?share=${encodeURIComponent(shareId)}`
      : "index.html";
  }

  function setMode(mode) {
    const isCreate = mode === "create";

    els.modes.forEach((btn) => {
      const active = btn.dataset.mode === mode;
      btn.classList.toggle("gate__mode--active", active);
      btn.setAttribute("aria-selected", String(active));
    });

    if (els.openForm) els.openForm.hidden = isCreate;
    if (els.createForm) els.createForm.hidden = !isCreate;
    clearInputErrors();

    if (isCreate) {
      els.createCode?.focus();
    } else {
      els.openCode?.focus();
    }
  }

  async function handleOpen(event) {
    event.preventDefault();
    clearInputErrors();

    const code = els.openCode?.value || "";
    const formatError = auth.validateCode(code, { forCreate: false });
    if (formatError) {
      showError(formatError, [els.openCode]);
      return;
    }

    if (!(await auth.accountExists(code))) {
      showError(t("gate.noList"), [els.openCode]);
      return;
    }

    const result = auth.signIn(code, { create: false });
    if (!result.ok) {
      showError(result.error, [els.openCode]);
      return;
    }

    goToApp();
  }

  async function codeIsTaken(code) {
    return auth.accountExists(code);
  }

  async function handleCreate(event) {
    event.preventDefault();
    clearInputErrors();

    const code = els.createCode?.value || "";
    const confirm = els.confirmCode?.value || "";

    const formatError = auth.validateCode(code, { forCreate: true });
    if (formatError) {
      showError(formatError, [els.createCode, els.confirmCode]);
      return;
    }

    if (code !== confirm) {
      showError(t("gate.codesMismatch"), [els.createCode, els.confirmCode]);
      return;
    }

    if (await codeIsTaken(code)) {
      showError(t("gate.codeExists"), [els.createCode]);
      return;
    }

    const result = auth.signIn(code, { create: true });
    if (!result.ok) {
      showError(result.error, [els.createCode]);
      return;
    }

    goToApp();
  }

  function bindEvents() {
    els.modes.forEach((btn) => {
      btn.addEventListener("click", () => setMode(btn.dataset.mode));
    });

    [els.openCode, els.createCode, els.confirmCode].forEach((field) => {
      field?.addEventListener("input", clearInputErrors);
    });

    els.openForm?.addEventListener("submit", handleOpen);
    els.createForm?.addEventListener("submit", handleCreate);

    document.addEventListener("click", (event) => {
      const lang = event.target.closest("[data-action='set-language']")?.dataset.lang;
      if (lang) {
        i18n()?.setLang(lang);
        return;
      }

      const action = event.target.closest("[data-action]")?.dataset.action;
      if (action === "open-theme") {
        openGateThemeModal();
        return;
      }

      if (action === "close-theme-modal") {
        closeGateThemeModal();
        return;
      }

      const theme = event.target.closest("[data-action='set-theme']")?.dataset.theme;
      if (theme) window.WatchlistThemes?.setTheme(theme);
    });
  }

  function boot() {
    const params = new URLSearchParams(window.location.search);
    const shareId = params.get("share")?.trim();
    if (shareId) persistPendingShareId(shareId);

    const startMode = params.get("mode") === "create" ? "create" : "open";

    if (auth.isAuthenticated()) {
      goToApp();
      return;
    }

    bindEvents();
    setMode(startMode);
    i18n()?.applyGateDocument();

    i18n()?.onChange(() => {
      i18n().applyGateDocument();
      document.querySelectorAll("[data-action='set-language']").forEach((btn) => {
        btn.classList.toggle(
          "gate__lang-btn--active",
          btn.dataset.lang === i18n().getLang()
        );
      });
    });

    document.querySelectorAll("[data-action='set-language']").forEach((btn) => {
      btn.classList.toggle("gate__lang-btn--active", btn.dataset.lang === i18n()?.getLang());
    });

    window.WatchlistThemes?.applyThemeUi?.();

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!els.themeModal?.hidden) closeGateThemeModal();
    });

    if (params.get("deleted") === "1") {
      setMode("create");
      showError(t("gate.deleted"));
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
