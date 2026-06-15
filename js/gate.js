(function () {
  "use strict";

  const auth = window.WatchlistAuth;
  const i18n = () => window.WatchlistI18n;
  const MIN_CODE_LENGTH = auth?.MIN_CODE_LENGTH ?? 6;

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
    createCodeRules: document.getElementById("createCodeRules"),
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

  function evaluateCodeRules(code) {
    const raw = String(code);
    const normalized = raw.trim().toLowerCase();

    return {
      length: normalized.length >= MIN_CODE_LENGTH,
      alnum: /[a-z]/.test(normalized) && /[0-9]/.test(normalized),
      spaces: raw.length > 0 && !/\s/.test(raw),
    };
  }

  function updateCreateCodeRules() {
    if (!els.createCodeRules || !els.createCode) return;
    const checks = evaluateCodeRules(els.createCode.value || "");

    els.createCodeRules.querySelectorAll(".gate__rule").forEach((item) => {
      const rule = item.dataset.rule;
      item.classList.toggle("gate__rule--met", Boolean(checks[rule]));
    });
  }

  function setPasswordVisible(inputId, visible) {
    const input = document.getElementById(inputId);
    if (!input) return;

    input.type = visible ? "text" : "password";

    document
      .querySelectorAll(`[data-action='toggle-password'][data-target='${inputId}']`)
      .forEach((btn) => {
        btn.setAttribute("aria-pressed", String(visible));
        btn.setAttribute("aria-label", t(visible ? "gate.hideCode" : "gate.showCode"));
      });
  }

  function togglePasswordVisibility(button) {
    const targetId = button?.dataset?.target;
    if (!targetId) return;

    const input = document.getElementById(targetId);
    if (!input) return;

    const show = input.type === "password";
    setPasswordVisible(targetId, show);
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
      updateCreateCodeRules();
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
      updateCreateCodeRules();
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

    els.openCode?.addEventListener("input", clearInputErrors);
    els.createCode?.addEventListener("input", () => {
      clearInputErrors();
      updateCreateCodeRules();
    });
    els.confirmCode?.addEventListener("input", clearInputErrors);

    els.openForm?.addEventListener("submit", handleOpen);
    els.createForm?.addEventListener("submit", handleCreate);

    document.addEventListener("click", (event) => {
      const lang = event.target.closest("[data-action='set-language']")?.dataset.lang;
      if (lang) {
        i18n()?.setLang(lang);
        return;
      }

      const toggleBtn = event.target.closest("[data-action='toggle-password']");
      if (toggleBtn) {
        togglePasswordVisibility(toggleBtn);
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
    updateCreateCodeRules();
    i18n()?.applyGateDocument();

    i18n()?.onChange(() => {
      i18n().applyGateDocument();
      updateCreateCodeRules();
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
