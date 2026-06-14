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

  function showError(message, fields = []) {
    if (els.error) {
      els.error.hidden = !message;
      els.error.textContent = message || "";
    }

    const targets = fields.length
      ? fields
      : [els.openCode, els.createCode, els.confirmCode];

    targets.forEach((field) => {
      if (!field) return;
      field.classList.toggle("gate__input--invalid", Boolean(message));
    });
  }

  function clearInputErrors() {
    showError("");
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
      showError("No list found with this code. Use New list to create one.", [els.openCode]);
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
      showError("Codes do not match.", [els.createCode, els.confirmCode]);
      return;
    }

    if (await codeIsTaken(code)) {
      showError("A list with this code already exists. Use Open list instead.", [
        els.createCode,
      ]);
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
  }

  function boot() {
    const params = new URLSearchParams(window.location.search);
    const startMode = params.get("mode") === "create" ? "create" : "open";

    if (auth.isAuthenticated()) {
      goToApp();
      return;
    }

    bindEvents();
    setMode(startMode);

    if (params.get("deleted") === "1") {
      setMode("create");
      showError("Account deleted. You can create a new list with the same code.");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
