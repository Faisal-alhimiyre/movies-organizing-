(function () {
  "use strict";

  const LEGACY_JOBS_KEY = "import_jobs";
  const LEGACY_ITEMS_KEY = "import_items";
  const POINTER_KEY = "import-job-pointer-v1";
  const PERSIST_DEBOUNCE_MS = 400;
  const REMOTE_CHUNK = 50;
  const ADDED_STATUS = "added";
  const PERSISTENCE_ERROR_MESSAGE =
    "Import progress could not be saved. Database migration or permissions need attention.";

  const memory = {
    jobs: new Map(),
    items: new Map(),
  };

  let persistTimer = null;
  let pendingListIds = new Set();
  let persistenceFailure = null;
  let remotePersistPausedFor = null;

  function pauseRemotePersist(listId) {
    remotePersistPausedFor = listId || null;
  }

  function resumeRemotePersist(listId) {
    if (!listId || remotePersistPausedFor === listId) {
      remotePersistPausedFor = null;
    }
  }

  function classifyRemotePersistError(message) {
    const text = String(message || "").toLowerCase();
    if (text.includes("row-level security") || text.includes("42501")) return "rls";
    if (text.includes("could not find") && text.includes("column")) return "schema";
    if (text.includes("schema cache")) return "schema";
    // A dropped/blipped connection (common during a long bulk import doing
    // lots of concurrent network work) throws a plain "Failed to fetch"
    // TypeError — that is NOT a database migration/permissions problem and
    // must not permanently halt the import the way a real RLS/schema error
    // should. Let it retry on the next save instead.
    if (
      text.includes("failed to fetch") ||
      text.includes("networkerror") ||
      text.includes("network request failed") ||
      text.includes("load failed") ||
      text.includes("timed out") ||
      text.includes("timeout")
    ) {
      return "network";
    }
    return "remote";
  }

  function isTransientPersistErrorKind(kind) {
    return kind === "network";
  }

  function notePersistenceFailure(listId, error, source) {
    const message = String(error?.message || error || "Unknown persistence error");
    remotePersistPausedFor = listId;
    persistenceFailure = {
      listId,
      source,
      kind: classifyRemotePersistError(message),
      message,
      userMessage: PERSISTENCE_ERROR_MESSAGE,
      at: Date.now(),
    };
    window.dispatchEvent(
      new CustomEvent("watchlist-import-persist-failed", {
        detail: { ...persistenceFailure },
      })
    );
    return persistenceFailure;
  }

  function clearPersistenceFailure(listId) {
    if (!persistenceFailure) return;
    if (listId && persistenceFailure.listId !== listId) return;
    persistenceFailure = null;
    if (remotePersistPausedFor === listId) remotePersistPausedFor = null;
  }

  function getPersistenceFailure(listId) {
    if (!persistenceFailure) return null;
    if (listId && persistenceFailure.listId !== listId) return null;
    return persistenceFailure;
  }

  function isPersistenceBlocked(listId) {
    return Boolean(getPersistenceFailure(listId));
  }

  function getPointer(listId) {
    try {
      const raw = localStorage.getItem(POINTER_KEY);
      const all = raw ? JSON.parse(raw) : {};
      return all[listId] || null;
    } catch {
      return null;
    }
  }

  function setPointer(listId, patch) {
    try {
      const raw = localStorage.getItem(POINTER_KEY);
      const all = raw ? JSON.parse(raw) : {};
      all[listId] = { ...(all[listId] || {}), ...patch, listId, updatedAt: Date.now() };
      localStorage.setItem(POINTER_KEY, JSON.stringify(all));
    } catch (err) {
      console.warn("[import-store] pointer save failed:", err);
    }
  }

  function clearPointer(listId) {
    try {
      const raw = localStorage.getItem(POINTER_KEY);
      if (!raw) return;
      const all = JSON.parse(raw);
      delete all[listId];
      localStorage.setItem(POINTER_KEY, JSON.stringify(all));
    } catch {
      /* ignore */
    }
  }

  function extractProviderId(item) {
    if (!item) return "";
    if (item.pick?.anilist_id) return `anilist:${item.pick.anilist_id}`;
    if (item.pick?.tmdb_id) return `tmdb:${item.pick.tmdb_id}`;
    if (item.pick?.id) return String(item.pick.id);
    if (item.providerKey) return String(item.providerKey);
    return "";
  }

  function packItemMeta(item) {
    return {
      originalType: item.originalType || "",
      correctedType: item.correctedType || "",
      typeCorrectionReason: item.typeCorrectionReason || "",
      typeCorrectionConfidence: item.typeCorrectionConfidence ?? null,
      typeCorrectionProvider: item.typeCorrectionProvider || "",
      typeCorrected: item.typeCorrected || "",
      duplicateCategory: item.duplicateCategory || "",
      duplicateSourceTitle: item.duplicateSourceTitle || "",
      matchRevision: item.matchRevision || 1,
      commitClaimed: Boolean(item.commitClaimed),
      commitError: item.commitError || "",
      lastProvider: item.lastProvider || "",
      matchReason: item.matchReason || "",
      retryHistory: Array.isArray(item.retryHistory) ? item.retryHistory : [],
      franchiseMember: Boolean(item.franchiseMember),
      franchisePrimary: Boolean(item.franchisePrimary),
      franchiseGroupId: item.franchiseGroupId || "",
      retries: item.retries || 0,
      posterRetries: item.posterRetries || 0,
      waiting: Boolean(item.waiting),
      waitingReason: item.waitingReason || "",
      retryAfter: item.retryAfter || 0,
      nextRetryAt: item.nextRetryAt || 0,
      providerUrl: item.providerUrl || "",
    };
  }

  function unpackItemMeta(item, meta) {
    if (!meta || typeof meta !== "object") return item;
    for (const [key, value] of Object.entries(meta)) {
      if (value == null || value === "") continue;
      if (key === "retryHistory" && !Array.isArray(value)) continue;
      item[key] = value;
    }
    return item;
  }

  function compactItem(item) {
    if (!item) return item;
    if (item.status !== ADDED_STATUS && item.status !== "cancelled") return item;

    const compact = {
      id: item.id,
      line: item.line,
      title: item.title || "",
      importedTitle: item.importedTitle || item.title || "",
      year: item.year ?? null,
      contentType: item.contentType || "",
      status: item.status,
      matchStatus: item.matchStatus || "",
      metadataStatus: item.metadataStatus || "",
      failureKind: item.failureKind || "",
      error: item.error || "",
      providerKey: extractProviderId(item),
      watchlistItemId: item.watchlistItemId || "",
      addedAt: item.addedAt || Date.now(),
      pick: item.pick
        ? {
            anilist_id: item.pick.anilist_id ?? null,
            tmdb_id: item.pick.tmdb_id ?? null,
            id: item.pick.id ?? null,
            title: item.pick.title || item.details?.title || "",
          }
        : null,
      details: item.details?.title
        ? { title: item.details.title, year: item.details.year ?? null }
        : null,
      candidates: [],
      retryHistory: [],
      retries: item.retries || 0,
    };
    return compact;
  }

  function compactItemsMap(items) {
    const out = {};
    for (const [id, item] of Object.entries(items || {})) {
      out[id] = compactItem(item);
    }
    return out;
  }

  function getSupabase() {
    return window.WatchlistSync?.getClient?.() || null;
  }

  function jobToRow(listId, job) {
    const accountId = window.WatchlistAuth?.getAccountId?.() || "";
    if (!accountId) {
      console.warn("[import-store] missing accountId for import_jobs upsert");
    }
    return {
      list_id: listId,
      job_id: job.jobId,
      account_id: accountId,
      status: job.status || "idle",
      paused: Boolean(job.paused),
      format: job.format || "tsv",
      stats: job.stats || {},
      provider_ids: job.providerIds || [],
      version: job.version || 1,
      next_index: job.nextIndex || 0,
      checked_count: job.checkedCount || 0,
      updated_at: new Date().toISOString(),
    };
  }

  function itemToRow(listId, item) {
    const c = compactItem(item);
    return {
      list_id: listId,
      item_id: c.id,
      line: c.line || 0,
      title: c.title || "",
      imported_title: c.importedTitle || c.title || "",
      year: c.year ?? null,
      content_type: c.contentType || "",
      status: c.status || "pending",
      match_status: c.matchStatus || "",
      metadata_status: c.metadataStatus || "",
      failure_kind: c.failureKind || "",
      error: c.error || "",
      provider_id: extractProviderId(c),
      watchlist_item_id: c.watchlistItemId || "",
      pick: c.pick || null,
      details: c.status === ADDED_STATUS ? c.details : item.details || c.details || null,
      candidates:
        c.status === ADDED_STATUS ? [] : Array.isArray(item.candidates) ? item.candidates : [],
      added_at: c.addedAt ? new Date(c.addedAt).toISOString() : null,
      updated_at: new Date().toISOString(),
      meta: packItemMeta(item),
    };
  }

  function rowToItem(row) {
    const item = {
      id: row.item_id,
      line: row.line,
      title: row.title,
      importedTitle: row.imported_title || row.title,
      year: row.year ?? null,
      contentType: row.content_type,
      status: row.status,
      matchStatus: row.match_status || "",
      metadataStatus: row.metadata_status || "",
      failureKind: row.failure_kind || "",
      error: row.error || "",
      providerKey: row.provider_id || "",
      watchlistItemId: row.watchlist_item_id || "",
      pick: row.pick || null,
      details: row.details || null,
      candidates: row.candidates || [],
      addedAt: row.added_at ? Date.parse(row.added_at) : null,
      retries: 0,
    };
    return unpackItemMeta(item, row.meta);
  }

  function rowToJob(row) {
    if (!row) return null;
    return {
      version: row.version || 1,
      jobId: row.job_id,
      listId: row.list_id,
      status: row.status,
      paused: row.paused,
      format: row.format,
      stats: row.stats || {},
      providerIds: row.provider_ids || [],
      nextIndex: row.next_index || 0,
      checkedCount: row.checked_count || 0,
      createdAt: row.created_at ? Date.parse(row.created_at) : Date.now(),
      updatedAt: row.updated_at ? Date.parse(row.updated_at) : Date.now(),
    };
  }

  function schedulePersist(listId) {
    if (!listId) return;
    if (remotePersistPausedFor === listId) return;
    pendingListIds.add(listId);
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      void flushPending();
    }, PERSIST_DEBOUNCE_MS);
  }

  async function flushPending() {
    const ids = [...pendingListIds];
    pendingListIds.clear();
    for (const listId of ids) {
      await persistList(listId);
    }
  }

  async function persistList(listId) {
    const job = memory.jobs.get(listId);
    const items = memory.items.get(listId);
    if (!job || !items) return { ok: false, reason: "missing_memory" };

    const idb = window.WatchlistIdb;
    if (idb) {
      try {
        await idb.putImportJob(listId, job);
        await idb.putImportItems(listId, items);
      } catch (err) {
        console.warn("[import-store] IDB persist failed:", err);
      }
    }

    const sb = getSupabase();
    if (!sb || !window.WatchlistSync?.isConfigured?.()) {
      return { ok: true, localOnly: true };
    }

    try {
      const { error: jobErr } = await sb.from("import_jobs").upsert(jobToRow(listId, job), {
        onConflict: "list_id",
      });
      if (jobErr) {
        const kind = classifyRemotePersistError(jobErr.message);
        console.warn("[import-store] job upsert failed:", jobErr.message);
        if (!isTransientPersistErrorKind(kind)) notePersistenceFailure(listId, jobErr, "import_jobs");
        return { ok: false, error: jobErr, kind, transient: isTransientPersistErrorKind(kind) };
      }

      const rows = Object.values(items).map((item) => itemToRow(listId, item));
      for (let i = 0; i < rows.length; i += REMOTE_CHUNK) {
        const chunk = rows.slice(i, i + REMOTE_CHUNK);
        const { error } = await sb.from("import_items").upsert(chunk, {
          onConflict: "list_id,item_id",
        });
        if (error) {
          const kind = classifyRemotePersistError(error.message);
          console.warn("[import-store] items upsert failed:", error.message);
          if (!isTransientPersistErrorKind(kind)) notePersistenceFailure(listId, error, "import_items");
          return { ok: false, error, kind, transient: isTransientPersistErrorKind(kind) };
        }
      }

      clearPersistenceFailure(listId);
      return { ok: true };
    } catch (err) {
      const kind = classifyRemotePersistError(err?.message);
      console.warn("[import-store] remote persist failed:", err);
      if (!isTransientPersistErrorKind(kind)) notePersistenceFailure(listId, err, "import_jobs");
      return { ok: false, error: err, kind, transient: isTransientPersistErrorKind(kind) };
    }
  }

  function saveJob(listId, job) {
    memory.jobs.set(listId, job);
    setPointer(listId, { jobId: job.jobId, status: job.status });
    schedulePersist(listId);
  }

  function saveItems(listId, items) {
    memory.items.set(listId, items);
    schedulePersist(listId);
  }

  function loadJob(listId) {
    return memory.jobs.get(listId) || null;
  }

  function loadItems(listId) {
    return memory.items.get(listId) || {};
  }

  function hasMemory(listId) {
    return memory.items.has(listId) && Object.keys(memory.items.get(listId) || {}).length > 0;
  }

  async function hydrate(listId) {
    if (!listId) return null;

    if (hasMemory(listId)) {
      return { job: loadJob(listId), items: loadItems(listId) };
    }

    let job = null;
    let items = {};

    const idb = window.WatchlistIdb;
    if (idb) {
      try {
        job = await idb.getImportJob(listId);
        items = await idb.getImportItems(listId);
      } catch (err) {
        console.warn("[import-store] IDB hydrate failed:", err);
      }
    }

    const sb = getSupabase();
    if (sb && window.WatchlistSync?.isConfigured?.()) {
      try {
        const { data: remoteJob } = await sb
          .from("import_jobs")
          .select("*")
          .eq("list_id", listId)
          .maybeSingle();

        let remoteItems = [];
        const pageSize = 500;
        let from = 0;
        while (true) {
          const { data: page, error: pageError } = await sb
            .from("import_items")
            .select("*")
            .eq("list_id", listId)
            .range(from, from + pageSize - 1);
          if (pageError) throw pageError;
          const batch = page || [];
          remoteItems = remoteItems.concat(batch);
          if (batch.length < pageSize) break;
          from += pageSize;
        }

        if (remoteJob) {
          const remoteJobObj = rowToJob(remoteJob);
          const remoteUpdated = remoteJobObj.updatedAt || 0;
          const localUpdated = job?.updatedAt || 0;
          if (!job || remoteUpdated >= localUpdated) job = remoteJobObj;
        }
        if (remoteItems.length) {
          const remoteMap = {};
          for (const row of remoteItems) remoteMap[row.item_id] = rowToItem(row);
          if (Object.keys(remoteMap).length >= Object.keys(items).length) {
            items = remoteMap;
          }
        }
      } catch (err) {
        console.warn("[import-store] remote hydrate failed:", err);
      }
    }

    if (job && Object.keys(items).length) {
      memory.jobs.set(listId, job);
      memory.items.set(listId, items);
      setPointer(listId, { jobId: job.jobId, status: job.status });
      return { job, items };
    }

    return null;
  }

  async function clearJob(listId) {
    memory.jobs.delete(listId);
    memory.items.delete(listId);
    clearPointer(listId);
    if (window.WatchlistIdb) {
      await window.WatchlistIdb.clearImportData(listId);
    }
    const sb = getSupabase();
    if (sb && window.WatchlistSync?.isConfigured?.()) {
      await sb.from("import_items").delete().eq("list_id", listId);
      await sb.from("import_jobs").delete().eq("list_id", listId);
    }
  }

  function purgeLegacyLocalStorage() {
    try {
      localStorage.removeItem(LEGACY_JOBS_KEY);
      localStorage.removeItem(LEGACY_ITEMS_KEY);
    } catch {
      /* ignore */
    }
  }

  async function migrateLegacyLocalStorage(listId) {
    let legacyJobs;
    let legacyItems;
    try {
      const jobsRaw = localStorage.getItem(LEGACY_JOBS_KEY);
      const itemsRaw = localStorage.getItem(LEGACY_ITEMS_KEY);
      if (!jobsRaw && !itemsRaw) return false;
      legacyJobs = jobsRaw ? JSON.parse(jobsRaw) : {};
      legacyItems = itemsRaw ? JSON.parse(itemsRaw) : {};
    } catch {
      purgeLegacyLocalStorage();
      return false;
    }

    const job = legacyJobs[listId];
    const items = legacyItems[listId];
    if (!job || !items) {
      purgeLegacyLocalStorage();
      return false;
    }

    memory.jobs.set(listId, job);
    memory.items.set(listId, items);
    await persistList(listId);
    purgeLegacyLocalStorage();
    console.info("[import-store] migrated legacy localStorage import job to remote/IDB");
    return true;
  }

  function archiveCompletedJob(listId) {
    const job = loadJob(listId);
    const items = loadItems(listId);
    if (!job || !items) return;

    let changed = false;
    for (const item of Object.values(items)) {
      if (item.status === ADDED_STATUS) {
        const compact = compactItem(item);
        if (JSON.stringify(compact).length < JSON.stringify(item).length) {
          Object.assign(item, compact);
          changed = true;
        }
      }
    }

    const active = Object.values(items).filter(
      (it) => it.status !== ADDED_STATUS && it.status !== "cancelled"
    );
    if (!active.length) {
      job.status = "completed";
      changed = true;
    }

    if (changed) {
      job.stats = window.WatchlistImportJob?.recomputeStats?.(items, job) || job.stats;
      job.updatedAt = Date.now();
      saveJob(listId, job);
      saveItems(listId, items);
    }
  }

  window.WatchlistImportJobStore = {
    POINTER_KEY,
    LEGACY_JOBS_KEY,
    LEGACY_ITEMS_KEY,
    PERSISTENCE_ERROR_MESSAGE,
    saveJob,
    saveItems,
    loadJob,
    loadItems,
    hydrate,
    clearJob,
    compactItem,
    archiveCompletedJob,
    purgeLegacyLocalStorage,
    migrateLegacyLocalStorage,
    flushPending,
    persistList,
    getPointer,
    setPointer,
    hasMemory,
    getPersistenceFailure,
    clearPersistenceFailure,
    isPersistenceBlocked,
    notePersistenceFailure,
    pauseRemotePersist,
    resumeRemotePersist,
  };
})();
