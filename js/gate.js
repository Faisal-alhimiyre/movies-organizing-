(function () {
  "use strict";

  const auth = window.WatchlistAuth;

  const els = {
    modes: document.querySelectorAll(".gate__mode"),
    openForm: document.getElementById("openForm"),
    createForm: document.getElementById("createForm"),
    openCode: document.getElementById("openCode"),
    createCode: document.getElementById("createCode"),
    confirmCode: document.getElementById("confirmCode"),
    error: document.getElementById("gateError"),
  };

  function showError(message) {
    if (!els.error) return;
    els.error.hidden = !message;
    els.error.textContent = message || "";
  }

  function goToApp() {
    window.location.href = "index.html";
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
    showError("");

    if (isCreate) {
      els.createCode?.focus();
    } else {
      els.openCode?.focus();
    }
  }

  function handleOpen(event) {
    event.preventDefault();
    showError("");

    const result = auth.signIn(els.openCode?.value || "", { create: false });
    if (!result.ok) {
      showError(result.error);
      return;
    }

    goToApp();
  }

  function handleCreate(event) {
    event.preventDefault();
    showError("");

    const code = els.createCode?.value || "";
    const confirm = els.confirmCode?.value || "";

    if (code !== confirm) {
      showError("Codes do not match.");
      return;
    }

    if (auth.codeHasList(code)) {
      showError("A list with this code already exists. Use Open list instead.");
      return;
    }

    const result = auth.signIn(code, { create: true });
    if (!result.ok) {
      showError(result.error);
      return;
    }

    goToApp();
  }

  function bindEvents() {
    els.modes.forEach((btn) => {
      btn.addEventListener("click", () => setMode(btn.dataset.mode));
    });

    els.openForm?.addEventListener("submit", handleOpen);
    els.createForm?.addEventListener("submit", handleCreate);
  }

  function boot() {
    if (auth.isAuthenticated()) {
      goToApp();
      return;
    }

    bindEvents();
    setMode("open");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
