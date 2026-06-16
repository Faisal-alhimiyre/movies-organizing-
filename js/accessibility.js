(function () {
  "use strict";

  function initSkipLinks() {
    document.querySelectorAll(".skip-link").forEach((link) => {
      if (link.dataset.skipBound) return;
      link.dataset.skipBound = "1";

      link.addEventListener("click", (event) => {
        const href = link.getAttribute("href");
        if (!href?.startsWith("#")) return;

        const target = document.querySelector(href);
        if (!target) return;

        event.preventDefault();
        if (!target.hasAttribute("tabindex")) {
          target.setAttribute("tabindex", "-1");
        }
        target.focus({ preventScroll: false });
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initSkipLinks);
  } else {
    initSkipLinks();
  }
})();
