(function () {
  "use strict";

  const DISPOSABLE_KEYS = [
    "watchlist-metadata-cache-v5",
    "watchlist-series-cache-v5",
    "bulk-import-draft-v1",
    "import_jobs",
    "import_items",
  ];

  function byteLength(str) {
    if (!str) return 0;
    try {
      return new Blob([str]).size;
    } catch {
      return str.length * 2;
    }
  }

  function auditLocalStorage() {
    const entries = [];
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      const value = localStorage.getItem(key) || "";
      const bytes = byteLength(value);
      total += bytes;
      entries.push({ key, bytes, kb: Math.round((bytes / 1024) * 10) / 10 });
    }
    entries.sort((a, b) => b.bytes - a.bytes);
    return { total, totalKb: Math.round((total / 1024) * 10) / 10, entries };
  }

  function clearDisposableCaches() {
    let freed = 0;
    for (const key of DISPOSABLE_KEYS) {
      const value = localStorage.getItem(key);
      if (!value) continue;
      freed += byteLength(value);
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    }
    window.WatchlistImportJobStore?.purgeLegacyLocalStorage?.();
    return freed;
  }

  async function renderDiagnosticsModal() {
    const audit = auditLocalStorage();
    const idbEstimate = await window.WatchlistIdb?.estimateUsage?.();
    const top = audit.entries.slice(0, 5);
    const lines = [
      `localStorage total: ${audit.totalKb} KB`,
      idbEstimate
        ? `IndexedDB usage: ${Math.round(((idbEstimate.usage || 0) / 1024) * 10) / 10} KB`
        : "IndexedDB usage: n/a",
      "",
      "Largest keys:",
      ...top.map((e) => `• ${e.key}: ${e.kb} KB`),
      "",
      ...audit.entries.map((e) => `${e.key}\t${e.kb} KB`),
    ];

    await window.WatchlistDialog?.alert(lines.join("\n"), {
      title: "Storage diagnostics",
    });
  }

  function maybeOpenFromQuery() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("debug") === "storage" || localStorage.getItem("watchlist-debug-storage") === "1") {
      void renderDiagnosticsModal();
    }
  }

  window.WatchlistStorageDiagnostics = {
    auditLocalStorage,
    clearDisposableCaches,
    renderDiagnosticsModal,
    maybeOpenFromQuery,
    DISPOSABLE_KEYS,
  };
})();
