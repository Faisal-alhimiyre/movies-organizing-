(function () {
  "use strict";

  const i18n = () => window.WatchlistI18n;

  function goToApp() {
    const auth = window.WatchlistAuth;
    window.location.href = auth?.isAuthenticated?.() ? "index.html" : "gate.html";
  }

  document.querySelectorAll("[data-action='set-language']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const lang = btn.dataset.lang;
      if (lang) i18n()?.setLang(lang);
    });
  });

  document.querySelector("[data-action='go-app']")?.addEventListener("click", goToApp);

  i18n()?.onChange(() => {
    i18n()?.applyAboutDocument?.();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => i18n()?.applyAboutDocument?.());
  } else {
    i18n()?.applyAboutDocument?.();
  }
})();
