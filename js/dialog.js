(function () {
  "use strict";

  let root = null;
  let titleEl = null;
  let messageEl = null;
  let cancelBtn = null;
  let confirmBtn = null;
  let settle = null;

  function ensureDialog() {
    if (root) return;

    root = document.createElement("div");
    root.className = "app-dialog";
    root.hidden = true;
    root.innerHTML = `
      <div class="app-dialog__backdrop" data-action="cancel"></div>
      <div
        class="app-dialog__panel"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="appDialogTitle"
        aria-describedby="appDialogMessage"
      >
        <h2 class="app-dialog__title" id="appDialogTitle"></h2>
        <p class="app-dialog__message" id="appDialogMessage"></p>
        <footer class="app-dialog__actions">
          <button type="button" class="btn btn--ghost" data-action="cancel">
            Cancel
          </button>
          <button type="button" class="btn btn--primary" data-action="confirm">
            OK
          </button>
        </footer>
      </div>
    `;

    document.body.appendChild(root);

    titleEl = root.querySelector(".app-dialog__title");
    messageEl = root.querySelector(".app-dialog__message");
    cancelBtn = root.querySelector('[data-action="cancel"]');
    confirmBtn = root.querySelector('[data-action="confirm"]');

    root.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (!action || !settle) return;

      if (action === "confirm") {
        const resolve = settle.resolve;
        close();
        resolve(true);
        return;
      }

      if (action === "cancel") {
        const resolve = settle.resolve;
        close();
        resolve(false);
      }
    });

    document.addEventListener("keydown", (event) => {
      if (root.hidden || !settle) return;

      if (event.key === "Escape") {
        const resolve = settle.resolve;
        close();
        resolve(settle.mode === "alert");
      }

      if (event.key === "Enter" && settle.mode === "alert") {
        const resolve = settle.resolve;
        close();
        resolve(true);
      }
    });
  }

  function open(options) {
    ensureDialog();

    const {
      title = "Notice",
      message = "",
      mode = "alert",
      confirmLabel = "OK",
      cancelLabel = "Cancel",
      danger = false,
    } = options;

    titleEl.textContent = title;
    messageEl.textContent = message;
    confirmBtn.textContent = confirmLabel;
    cancelBtn.textContent = cancelLabel;

    const isAlert = mode === "alert";
    cancelBtn.hidden = isAlert;
    confirmBtn.className = danger
      ? "btn btn--danger"
      : "btn btn--primary";

    root.hidden = false;
    document.body.style.overflow = "hidden";
    (isAlert ? confirmBtn : cancelBtn).focus();

    return new Promise((resolve) => {
      settle = { resolve, mode };
    });
  }

  function close() {
    if (!root) return;
    root.hidden = true;
    settle = null;

    if (
      !document.querySelector(".modal:not([hidden])") &&
      !document.querySelector(".app-dialog:not([hidden])")
    ) {
      document.body.style.overflow = "";
    }
  }

  function alert(message, options = {}) {
    return open({
      title: options.title || "Notice",
      message,
      mode: "alert",
      confirmLabel: options.confirmLabel || "OK",
    });
  }

  function confirm(message, options = {}) {
    return open({
      title: options.title || "Are you sure?",
      message,
      mode: "confirm",
      confirmLabel: options.confirmLabel || "Confirm",
      cancelLabel: options.cancelLabel || "Cancel",
      danger: Boolean(options.danger),
    });
  }

  window.WatchlistDialog = {
    alert,
    confirm,
  };
})();
