(function () {
  "use strict";

  const LEGACY_IMPORT_JOBS_KEY = "import_jobs";
  const LEGACY_IMPORT_ITEMS_KEY = "import_items";
  const JOB_VERSION = 1;
  const BATCH_SIZE = 20;
  const MAX_CONCURRENCY = 4;
  const ANILIST_ITEM_DELAY_MS = 350;
  const MAX_RATE_LIMIT_RETRIES = 40;
  const MAX_TRANSIENT_RETRIES = 15;
  const MAX_POSTER_FETCH_RETRIES = 8;
  const MAX_PERMANENT_RETRIES = 8;
  const COMMIT_CHUNK = 40;
  /** Bump when audit heuristics change so open jobs re-check once. */
  const TYPE_AUDIT_VERSION = 8;

  const DUPLICATE_CATEGORY = {
    import_tsv: "import_tsv",
    on_watchlist: "on_watchlist",
    provider_id: "provider_id",
    already_added_in_job: "already_added_in_job",
    grouped_member: "grouped_member",
    title_collision: "title_collision",
  };

  const FAILURE_KIND = {
    rate_limit: "rate_limit",
    transient: "transient",
    network: "network",
    not_found: "not_found",
    low_confidence: "low_confidence",
    invalid: "invalid",
    provider: "provider",
    other: "other",
  };

  const STATUS = {
    pending: "pending",
    processing: "processing",
    waiting_retry: "waiting_retry",
    waiting_poster: "waiting_poster",
    exact_match: "exact_match",
    possible_match: "possible_match",
    duplicate: "duplicate",
    not_found: "not_found",
    invalid: "invalid",
    failed: "failed",
    ready_to_add: "ready_to_add",
    ready: "ready",
    needs_attention: "needs_attention",
    added: "added",
    grouped: "grouped",
    cancelled: "cancelled",
  };

  const MATCH_STATUS = {
    pending: "pending",
    matching: "matching",
    verified: "verified",
    needs_attention: "needs_attention",
    not_found: "not_found",
  };

  const METADATA_STATUS = {
    not_started: "not_started",
    pending: "pending",
    metadata_waiting: "metadata_waiting",
    complete: "complete",
    temporary_failure: "temporary_failure",
    permanent_failure: "permanent_failure",
  };

  const PREVIEW_STATUS_ORDER = {
    [STATUS.failed]: 0,
    [STATUS.not_found]: 1,
    [STATUS.invalid]: 2,
    [STATUS.possible_match]: 3,
    [STATUS.pending]: 4,
    [STATUS.processing]: 5,
    [STATUS.duplicate]: 6,
    [STATUS.grouped]: 7,
    [STATUS.exact_match]: 8,
    [STATUS.ready_to_add]: 9,
    [STATUS.added]: 10,
    [STATUS.cancelled]: 11,
  };

  const FAILED_SUBORDER = {
    [FAILURE_KIND.transient]: 0,
    [FAILURE_KIND.rate_limit]: 1,
    [FAILURE_KIND.network]: 2,
    [FAILURE_KIND.provider]: 3,
    [FAILURE_KIND.other]: 4,
    [FAILURE_KIND.invalid]: 5,
    [FAILURE_KIND.low_confidence]: 6,
    [FAILURE_KIND.not_found]: 7,
  };

  let processing = false;
  let paused = false;
  let rematchOnlyIds = null;
  let onChange = null;
  let activeListId = null;
  let processingStartedAt = 0;
  let queueWakeTimerId = null;
  let queueWatchdogTimerId = null;
  const QUEUE_WATCHDOG_MS = 3000;
  const STUCK_PROCESSING_MS = 45000;
  const STALE_WORKER_MS = 60000;
  const RETRY_STAGGER_MS = 450;

  function formatPosterRetryReason(retryAtMs) {
    const at = Number(retryAtMs) || 0;
    let timeLabel = "";
    try {
      timeLabel = new Date(at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      timeLabel = "";
    }
    return timeLabel
      ? `Waiting for AniList poster — retrying at ${timeLabel}`
      : "Waiting for AniList poster";
  }

  function isImportPersistenceBlocked(listId) {
    return Boolean(store()?.isPersistenceBlocked?.(listId));
  }

  function getImportPersistenceFailure(listId) {
    return store()?.getPersistenceFailure?.(listId) || null;
  }

  function handleImportPersistenceFailure(detail) {
    const listId = detail?.listId;
    if (!listId) return;

    store()?.pauseRemotePersist?.(listId);
    paused = true;
    processing = false;
    processingStartedAt = 0;
    stopQueueWatchdog();
    if (queueWakeTimerId) {
      clearTimeout(queueWakeTimerId);
      queueWakeTimerId = null;
    }

    const job = loadJob(listId);
    const items = loadItems(listId);
    if (job) {
      job.paused = true;
      job.status = "paused";
      job.persistenceError =
        detail.userMessage ||
        store()?.PERSISTENCE_ERROR_MESSAGE ||
        "Import progress could not be saved. Database migration or permissions need attention.";
      job.persistenceErrorKind = detail.kind || "remote";
      job.updatedAt = Date.now();
      saveJob(listId, job);
    }

    onChange?.({
      listId,
      job,
      items,
      persistenceFailed: true,
      persistenceError: detail,
    });
  }

  function syncRetrySchedule(item, retryAtMs, waitingReason) {
    const at = Number(retryAtMs) || 0;
    item.retryAfter = at;
    item.nextRetryAt = at;
    item.waiting = true;
    if (waitingReason) item.waitingReason = waitingReason;
  }

  function clearRetrySchedule(item) {
    item.retryAfter = 0;
    item.nextRetryAt = 0;
    item.waiting = false;
    item.waitingReason = "";
    item.processingSince = 0;
  }

  function queueItemAwaitingRetry(item) {
    return (
      item.status === STATUS.pending ||
      item.status === STATUS.waiting_poster ||
      item.status === STATUS.processing ||
      (item.status === STATUS.failed && isTransientFailure(item))
    );
  }

  function hasQueueWork(items, now = Date.now()) {
    return Object.values(items || {}).some((item) => {
      if (!queueItemAwaitingRetry(item)) return false;
      if (item.status === STATUS.processing) return true;
      if (!item.retryAfter || item.retryAfter <= now) return true;
      return item.retryAfter > now;
    });
  }

  function countDueQueueItems(items, now = Date.now()) {
    return Object.values(items || {}).filter((item) => {
      if (item.status === STATUS.pending) {
        return !item.retryAfter || item.retryAfter <= now;
      }
      if (item.status === STATUS.failed && isTransientFailure(item)) {
        return !item.retryAfter || item.retryAfter <= now;
      }
      if (item.status === STATUS.processing) {
        const since = item.processingSince || 0;
        return !since || now - since > STUCK_PROCESSING_MS;
      }
      return false;
    }).length;
  }

  function getQueueCandidates(items, now = Date.now()) {
    return Object.values(items || {}).filter((item) => {
      if (isMatchVerified(item)) return false;
      if (item.status === STATUS.pending) {
        return !item.retryAfter || item.retryAfter <= now;
      }
      if (item.status === STATUS.failed && isTransientFailure(item)) {
        return !item.retryAfter || item.retryAfter <= now;
      }
      return false;
    });
  }

  function promoteDueWaitingItems(items, now = Date.now()) {
    let changed = false;
    for (const item of Object.values(items || {})) {
      if (!item.retryAfter || item.retryAfter > now) continue;
      if (item.status === STATUS.failed && isTransientFailure(item)) {
        item.status = STATUS.pending;
        item.waiting = true;
        changed = true;
      } else if (item.status === STATUS.waiting_poster && item.waiting) {
        if (!item.retryAfter || item.retryAfter <= now) {
          item.status = STATUS.pending;
          item.waiting = true;
          changed = true;
        }
      } else if (item.status === STATUS.pending && item.waiting) {
        item.waiting = true;
        changed = true;
      }
    }
    return changed;
  }

  function recoverStuckProcessingItems(items, now = Date.now()) {
    let changed = false;
    for (const item of Object.values(items || {})) {
      if (isMatchVerified(item)) continue;
      if (item.status !== STATUS.processing) continue;
      const since = item.processingSince || 0;
      if (since && now - since <= STUCK_PROCESSING_MS) continue;
      item.status = STATUS.pending;
      syncRetrySchedule(
        item,
        now + RETRY_STAGGER_MS,
        item.waitingReason || "Recovered from stalled processing"
      );
      item.error = item.waitingReason;
      changed = true;
    }
    return changed;
  }

  function getEarliestRetryAt(items, now = Date.now()) {
    const times = Object.values(items || {})
      .filter((item) => queueItemAwaitingRetry(item) && item.retryAfter && item.retryAfter > now)
      .map((item) => item.retryAfter);
    return times.length ? Math.min(...times) : 0;
  }

  function clearQueueWake() {
    if (queueWakeTimerId) {
      clearTimeout(queueWakeTimerId);
      queueWakeTimerId = null;
    }
  }

  function scheduleQueueWake(listId, items) {
    clearQueueWake();
    if (!listId || !items) return;
    const job = loadJob(listId);
    if (!job || job.paused || paused) return;

    const now = Date.now();
    const earliest = getEarliestRetryAt(items, now);
    if (!earliest) return;

    const delay = Math.max(50, Math.min(60000, earliest - now + 50));
    queueWakeTimerId = setTimeout(() => {
      queueWakeTimerId = null;
      void wakeQueueNow(listId);
    }, delay);
  }

  function stopQueueWatchdog() {
    if (queueWatchdogTimerId) {
      clearInterval(queueWatchdogTimerId);
      queueWatchdogTimerId = null;
    }
  }

  function startQueueWatchdog(listId) {
    if (!listId) return;
    activeListId = listId;
    if (queueWatchdogTimerId) return;
    queueWatchdogTimerId = setInterval(() => {
      void runQueueWatchdog(listId);
    }, QUEUE_WATCHDOG_MS);
  }

  async function runQueueWatchdog(listId) {
    if (isImportPersistenceBlocked(listId)) {
      stopQueueWatchdog();
      return;
    }
    const job = loadJob(listId);
    const items = loadItems(listId);
    if (!job || !items || !Object.keys(items).length) {
      stopQueueWatchdog();
      return;
    }
    if (job.paused || paused) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;

    const now = Date.now();
    let changed = promoteDueWaitingItems(items, now);
    changed = recoverStuckProcessingItems(items, now) || changed;
    if (changed) {
      job.stats = recomputeStats(items);
      job.updatedAt = now;
      saveJob(listId, job);
      saveItems(listId, items);
      onChange?.({ listId, job, items });
    }

    const due = countDueQueueItems(items, now);
    const work = hasQueueWork(items, now);
    if (!processing && work && due > 0) {
      void ensureQueueProcessing(listId);
    }
    scheduleQueueWake(listId, items);
  }

  async function wakeQueueNow(listId) {
    const items = loadItems(listId);
    const job = loadJob(listId);
    if (!items || !job || job.paused || paused) return;

    const now = Date.now();
    promoteDueWaitingItems(items, now);
    recoverStuckProcessingItems(items, now);
    saveItems(listId, items);
    await ensureQueueProcessing(listId);
    scheduleQueueWake(listId, loadItems(listId));
  }

  function ensureJobRecord(listId, items) {
    let job = loadJob(listId);
    if (job) return job;
    const list = items || loadItems(listId);
    if (!list || !Object.keys(list).length) return null;
    job = {
      version: JOB_VERSION,
      jobId: `job-${Date.now()}`,
      listId,
      status: "idle",
      paused: false,
      format: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      nextIndex: 0,
      batchSize: BATCH_SIZE,
      stats: recomputeStats(list),
      providerIds: {},
      checkedCount: 0,
    };
    saveJob(listId, job);
    return job;
  }

  function releaseStaleWorkerLock() {
    if (!processing) return false;
    if (!processingStartedAt || Date.now() - processingStartedAt <= STALE_WORKER_MS) {
      return false;
    }
    console.warn("[bulk-import:queue] releasing stale worker lock");
    processing = false;
    processingStartedAt = 0;
    return true;
  }

  function kickImportQueue(listId, options = {}) {
    if (isImportPersistenceBlocked(listId)) {
      return { started: false, reason: "persistence_blocked" };
    }
    if (options?.onlyIds?.length) {
      rematchOnlyIds = new Set(options.onlyIds);
    }
    if (!listId) return { started: false, reason: "no_list" };
    const items = loadItems(listId);
    const job = ensureJobRecord(listId, items);
    if (!job || !items || !Object.keys(items).length) {
      return { started: false, reason: "no_job" };
    }
    if (job.paused || paused) return { started: false, reason: "paused" };
    if (processing && !rematchOnlyIds) return { started: false, reason: "worker_busy" };

    promoteDueWaitingItems(items, Date.now());
    recoverStuckProcessingItems(items, Date.now());
    if (job.status === "completed" && hasQueueWork(items)) {
      job.status = "idle";
      saveJob(listId, job);
    }
    saveItems(listId, items);

    startQueueWatchdog(listId);
    scheduleQueueWake(listId, items);
    void ensureQueueProcessing(listId);
    return { started: true };
  }
  function ensureQueueProcessing(listId) {
    releaseStaleWorkerLock();
    const job = ensureJobRecord(listId, null);
    if (!job || job.paused || paused) return Promise.resolve();
    if (typeof navigator !== "undefined" && navigator.onLine === false) return Promise.resolve();
    if (processing) return Promise.resolve();

    const items = loadItems(listId);
    promoteDueWaitingItems(items, Date.now());
    recoverStuckProcessingItems(items, Date.now());
    if (!hasQueueWork(items)) return Promise.resolve();

    if (job.status === "completed" && hasQueueWork(items)) {
      job.status = "idle";
      saveJob(listId, job);
    }

    return runProcessingLoop(listId);
  }

  function continueProcessing(listId) {
    const items = loadItems(listId);
    const job = ensureJobRecord(listId, items);
    if (!items || !job) return { started: false, reason: "no_job" };

    promoteDueWaitingItems(items, Date.now());
    recoverStuckProcessingItems(items, Date.now());
    job.paused = false;
    paused = false;
    if (hasQueueWork(items)) {
      job.status = "idle";
    }
    job.updatedAt = Date.now();
    job.stats = recomputeStats(items);
    saveJob(listId, job);
    saveItems(listId, items);
    onChange?.({ listId, job, items });
    return kickImportQueue(listId);
  }

  function isWorkerActive() {
    return processing;
  }

  function formatRetryCountdown(item, now = Date.now()) {
    const retryAt = item.nextRetryAt || item.retryAfter || 0;
    if (!retryAt || retryAt <= now) return "";
    const seconds = Math.max(1, Math.ceil((retryAt - now) / 1000));
    return `${seconds}s`;
  }

  function formatWaitingItemDetail(item, now = Date.now()) {
    const provider = item.lastProvider || providerForItem(item);
    const retries = item.retries || item.rateLimitRetries || 0;
    const retryAt = item.nextRetryAt || item.retryAfter || 0;
    const countdown = formatRetryCountdown(item, now);
    const reason = item.waitingReason || humanizeFailureReason(item) || "Waiting to retry";
    return {
      provider,
      reason,
      retries,
      nextRetryAt: retryAt,
      countdown,
      isDue: !retryAt || retryAt <= now,
    };
  }

  function formatQueueProgress(items) {
    const list = Object.values(items || {});
    const submitted = list.length;
    const matched = countVerifiedItems(list);
    const remainingAnime = countRemainingAnime(list);
    const resolved = list.filter(
      (item) =>
        isMatchVerified(item) ||
        isSkippedItem(item) ||
        item.status === STATUS.added ||
        isPermanentUnresolved(item)
    ).length;
    const waiting = list.filter(isWaitingItem).length;
    const due = countDueQueueItems(list);
    const earliest = getEarliestRetryAt(list);
    return { submitted, resolved, matched, remainingAnime, waiting, due, earliest };
  }

  function formatQueueStatusLine(items, job, now = Date.now()) {
    const progress = formatQueueProgress(items);
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    if (offline) return "offline";
    if (job?.paused || paused) return "paused";

    const anilistGate = window.WatchlistMetadata?.getAnilistQueueStatus?.();
    if (anilistGate?.paused) {
      return {
        kind: "anilist_paused",
        progress,
        resumeAt: anilistGate.resumeAt,
      };
    }

    const waitingItems = Object.values(items || {}).filter(isWaitingItem);
    const nextItem = waitingItems
      .filter((item) => item.retryAfter && item.retryAfter > now)
      .sort((a, b) => (a.retryAfter || 0) - (b.retryAfter || 0))[0];

    if (nextItem) {
      const detail = formatWaitingItemDetail(nextItem, now);
      return {
        kind: "waiting",
        progress,
        detail,
        workerActive: processing,
      };
    }

    if (processing) {
      return { kind: "processing", progress, workerActive: true };
    }

    if (progress.due > 0 && !processing) {
      return { kind: "stalled", progress, workerActive: false };
    }

    return { kind: "idle", progress, workerActive: false };
  }

  function makeItemId(line, title, contentType) {
    return `imp-${line}-${contentType}-${String(title || "")
      .trim()
      .toLowerCase()
      .replace(/\W+/g, "-")
      .slice(0, 40)}`;
  }

  function store() {
    return window.WatchlistImportJobStore;
  }

  function saveJob(listId, job) {
    const s = store();
    if (s) s.saveJob(listId, job);
  }

  function saveItems(listId, items) {
    const s = store();
    if (s) s.saveItems(listId, items);
  }

  function loadJob(listId) {
    const s = store();
    return s ? s.loadJob(listId) : null;
  }

  function loadItems(listId) {
    const s = store();
    const items = s ? s.loadItems(listId) : {};
    for (const item of Object.values(items)) {
      hydrateImportItem(item);
    }
    return items;
  }

  function hasActiveJob(listId) {
    const items = loadItems(listId);
    return Boolean(items && Object.keys(items).length);
  }

  async function clearJob(listId) {
    const s = store();
    if (s) await s.clearJob(listId);
  }

  function hydrateJobData(listId) {
    const job = loadJob(listId);
    const items = loadItems(listId);
    if (!job || job.version !== JOB_VERSION || !items || !Object.keys(items).length) {
      return null;
    }
    let changed = false;
    for (const item of Object.values(items)) {
      const before = item.status;
      hydrateImportItem(item);
      if (before !== item.status) changed = true;
    }
    if (healDuplicateClassifications(items)) changed = true;
    job.stats = recomputeStats(items, job);
    job.updatedAt = Date.now();
    if (changed) saveItems(listId, items);
    saveJob(listId, job);
    return { job, items };
  }

  async function hydrateJobDataAsync(listId) {
    const s = store();
    if (s && !s.hasMemory(listId)) {
      await s.hydrate(listId);
    }
    return hydrateJobData(listId);
  }

  function normalizeImportTitle(title) {
    return String(title || "")
      .trim()
      .toLowerCase()
      .replace(/[''`´]/g, "'")
      .replace(/[＆&]/g, " and ")
      .replace(/\band\b/g, " and ")
      .replace(/[：:]/g, ":")
      .replace(/[-–—]/g, " ")
      .replace(/\s*\/\s*/g, " ")
      // Providers often omit periods on short abbreviations (Man vs. Bee → Man vs Bee).
      .replace(/\bvs\.\s*/gi, "vs ")
      .replace(/\b([a-z]{1,4})\.(?=\s|$)/gi, "$1")
      .replace(/[^\p{L}\p{N}\s:'.]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function collapseTitleSpaces(title) {
    return normalizeImportTitle(title).replace(/\s+/g, "");
  }

  function stripBracketChars(title) {
    return String(title || "")
      .trim()
      .replace(/[「」『』【】()（）[\]]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function buildAnimeSearchPasses(item) {
    const raw = String(item.importedTitle || item.title || "").trim();
    const display = String(item.title || "").trim();
    const normalized = normalizeImportTitle(raw);
    const bracketStripped = normalizeImportTitle(stripBracketChars(raw));
    const punctStripped = normalizeTitleKey(raw);
    const passes = [raw];
    if (display && display !== raw) passes.push(display);
    if (/\//.test(raw)) {
      const slashAsSpace = raw.replace(/\s*\/\s*/g, " ").replace(/\s+/g, " ").trim();
      if (slashAsSpace && slashAsSpace !== raw) passes.push(slashAsSpace);
      const slashRemoved = raw.replace(/\s*\/\s*/g, "").replace(/\s+/g, " ").trim();
      if (slashRemoved && slashRemoved !== raw && slashRemoved !== slashAsSpace) {
        passes.push(slashRemoved);
      }
    }
    if (normalized && normalized !== raw.toLowerCase()) passes.push(normalized);
    if (
      bracketStripped &&
      bracketStripped !== normalized &&
      bracketStripped !== raw.toLowerCase()
    ) {
      passes.push(bracketStripped);
    }
    if (punctStripped && punctStripped.length >= 2 && punctStripped !== normalized) {
      passes.push(punctStripped);
    }
    return [...new Set(passes.filter((p) => p.length >= 2))];
  }

  function buildWesternSearchPasses(item) {
    const raw = String(item.importedTitle || item.title || "").trim();
    const passes = [raw];
    const noPeriods = raw.replace(/\./g, " ").replace(/\s+/g, " ").trim();
    if (noPeriods && noPeriods !== raw) passes.push(noPeriods);
    if (/\bvs\.?\b/i.test(raw)) {
      const vsCompact = raw.replace(/\bvs\.\s*/gi, "vs ").replace(/\s+/g, " ").trim();
      if (vsCompact && vsCompact !== raw) passes.push(vsCompact);
      const vsDotted = raw.replace(/\bvs\b(?!\.)/gi, "vs.").replace(/\s+/g, " ").trim();
      if (vsDotted && vsDotted !== raw) passes.push(vsDotted);
    }
    return [...new Set(passes.filter((p) => p.length >= 2))];
  }

  function mergeSearchResultRows(rows, into) {
    for (const row of rows || []) {
      const key =
        row.resultKey ||
        `${row.source || "tmdb"}:${row.tmdbType || row.type || ""}:${row.tmdbId || row.imdbId || row.title || ""}`;
      if (!into.has(key)) into.set(key, row);
    }
  }

  async function searchTmdbScoredForItem(item, searchType) {
    const WM = window.WatchlistMetadata;
    if (!WM?.searchTitles) {
      return {
        ok: false,
        apiFailed: true,
        scored: [],
        auto: { pick: null, reason: "no_provider" },
        contentType: searchType === "movie" ? "movies" : "tvSeries",
        provider: "TMDb",
        topScore: 0,
        pick: null,
      };
    }

    const contentType = searchType === "movie" ? "movies" : "tvSeries";
    const probe = { ...item, contentType };
    const merged = new Map();
    let anyOk = false;
    let apiFailed = false;

    for (const query of buildWesternSearchPasses(item)) {
      const result = await WM.searchTitles(query, { type: searchType, page: 1 });
      if (!result?.ok) {
        apiFailed = true;
        continue;
      }
      anyOk = true;
      mergeSearchResultRows(result.results, merged);
    }

    const scored = scoreCandidates([...merged.values()], probe);
    const auto = autoPickFromScored(scored, probe);
    return {
      ok: anyOk,
      apiFailed: apiFailed && !anyOk,
      scored,
      auto,
      contentType,
      provider: "TMDb",
      topScore: scored[0]?.score || 0,
      pick: auto.pick,
    };
  }

  function normalizeTitleKey(title) {
    return normalizeImportTitle(title).replace(/[^\p{L}\p{N}\s]/gu, "");
  }

  function logBulkMatch(item, data) {
    console.warn("[bulk-import:match]", {
      title: item.title,
      normalized: normalizeImportTitle(item.title),
      contentType: item.contentType,
      ...data,
    });
  }

  function saveProgress(listId, job, items) {
    job.stats = recomputeStats(items);
    job.updatedAt = Date.now();
    saveJob(listId, job);
    saveItems(listId, items);
    onChange?.({ listId, job, items });
  }

  function providerForItem(item) {
    if (item.contentType === "anime") {
      if (item.typeConflictAmbiguous) {
        return item.typeConflictAnime?.provider || item.lastProvider || "AniList";
      }
      return item.lastProvider || "AniList";
    }
    if (item.contentType === "movies" || item.contentType === "tvSeries") return "TMDb";
    return item.lastProvider || "";
  }

  function hasProviderId(item) {
    if (!item) return false;
    if (item.providerKey) return true;
    if (!item.pick) return false;
    return Boolean(providerKeyFromPick(item.pick, item.contentType));
  }

  function pickMediaTypeMatchesContentType(item) {
    const pick = item?.pick;
    const details = item?.details;
    if (!pick && !details) return true;
    const ct = item?.contentType;
    const tmdbType = pick?.tmdbType || details?.tmdbType;
    const anilistId = pick?.anilistId || details?.anilistId;

    if (ct === "anime") {
      return Boolean(anilistId);
    }
    if (ct === "movies") {
      if (anilistId && !pick?.tmdbId && !details?.tmdbId) return false;
      if (tmdbType === "tv") return false;
      return tmdbType === "movie" || Boolean(pick?.tmdbId || pick?.imdbId || details?.tmdbId || details?.imdbId);
    }
    if (ct === "tvSeries") {
      if (anilistId && !pick?.tmdbId && !details?.tmdbId) return false;
      if (tmdbType === "movie") return false;
      return tmdbType === "tv" || Boolean(pick?.tmdbId || pick?.imdbId || details?.tmdbId || details?.imdbId);
    }
    return true;
  }

  function hasCommitTypeBlock(item) {
    if (!item) return true;
    if (item.typeReviewRequired || item.typeConflictAmbiguous) return true;
    if (item.typeCorrectionUncertain) return true;
    const imported = item.originalType || item.contentType;
    if (effectiveImportedType(item) === "anime" && item.contentType === "tvSeries") return true;
    if (
      imported === "anime" &&
      item.contentType === "anime" &&
      item.pick &&
      !item.pick.anilistId &&
      item.pick.tmdbType === "tv"
    ) {
      return true;
    }
    if (item.status === STATUS.needs_attention || item.status === STATUS.possible_match) return true;
    if (item.status === STATUS.failed && isPermanentUnresolved(item)) return true;
    if (item.waiting) return true;
    if (!pickMediaTypeMatchesContentType(item)) return true;
    return false;
  }

  function isCommitEligible(item) {
    if (!isMatchVerified(item)) return false;
    if (
      item.status === STATUS.added ||
      item.status === STATUS.duplicate ||
      item.status === STATUS.cancelled
    ) {
      return false;
    }
    if (item.franchiseMember) return false;
    if (item.commitClaimed) return false;
    if (!hasProviderId(item)) return false;
    if (hasCommitTypeBlock(item)) return false;
    if (item.contentType === "anime") {
      const poster = item.details?.poster;
      if (!poster || item.details?.posterPending) return false;
    }
    return (
      item.status === STATUS.ready_to_add ||
      item.status === STATUS.ready ||
      item.status === STATUS.exact_match
    );
  }

  function countCommitEligible(items) {
    return Object.values(items || {}).filter(isCommitEligible).length;
  }

  function markDuplicate(item, category, sourceTitle, message) {
    item.status = STATUS.duplicate;
    item.duplicateCategory = category;
    item.duplicateSourceTitle = sourceTitle || "";
    item.error = message || "";
    item.pick = null;
    item.details = null;
    item.candidates = [];
    if (item.matchStatus !== MATCH_STATUS.verified) {
      item.matchStatus = MATCH_STATUS.pending;
    }
  }

  function formatDuplicateCategory(category) {
    const labels = {
      [DUPLICATE_CATEGORY.import_tsv]: "Repeated in this import",
      [DUPLICATE_CATEGORY.on_watchlist]: "Already on your watchlist",
      [DUPLICATE_CATEGORY.provider_id]: "Same verified provider ID",
      [DUPLICATE_CATEGORY.already_added_in_job]: "Already added from this import",
      [DUPLICATE_CATEGORY.grouped_member]: "Grouped under another imported title",
      [DUPLICATE_CATEGORY.title_collision]: "Normalized title collision (review)",
    };
    return labels[category] || category || "Duplicate";
  }

  function isDuplicateRow(item) {
    if (!item) return false;
    if (item.status === STATUS.duplicate) return true;
    if (item.duplicateCategory && item.duplicateCategory !== DUPLICATE_CATEGORY.grouped_member) {
      return true;
    }
    if (item.franchiseMember && item.duplicateCategory === DUPLICATE_CATEGORY.grouped_member) {
      return true;
    }
    return false;
  }

  function healDuplicateClassifications(items) {
    const helpers = window.WatchlistImportJob?._helpers || {};
    const isOnList = helpers.isOnList || (() => false);
    const sorted = Object.values(items || {}).sort((a, b) => a.line - b.line);
    const firstByKey = new Map();
    const providerOwner = new Map();
    let changed = false;

    for (const item of sorted) {
      const key = rowDupKey(item.contentType, item.title, item.year);
      if (!firstByKey.has(key)) firstByKey.set(key, item.id);
      const pKey =
        item.providerKey ||
        (item.pick ? providerKeyFromPick(item.pick, item.contentType) : "");
      if (pKey && (isMatchVerified(item) || item.status === STATUS.added)) {
        if (!providerOwner.has(pKey)) providerOwner.set(pKey, item.id);
      }
    }

    for (const item of sorted) {
      if (item.franchiseMember) {
        const primaryTitle = item.duplicateSourceTitle || item.error || "";
        if (item.duplicateCategory !== DUPLICATE_CATEGORY.grouped_member) {
          item.duplicateCategory = DUPLICATE_CATEGORY.grouped_member;
          changed = true;
        }
        if (item.status === STATUS.duplicate) {
          item.status = isMatchVerified(item) ? STATUS.ready_to_add : STATUS.pending;
          changed = true;
        }
        continue;
      }

      if (item.status === STATUS.added || item.status === STATUS.cancelled) continue;

      let category = null;
      let sourceTitle = "";
      let message = "";

      const key = rowDupKey(item.contentType, item.title, item.year);
      if (firstByKey.get(key) !== item.id) {
        const other = items[firstByKey.get(key)];
        category = DUPLICATE_CATEGORY.import_tsv;
        sourceTitle = other?.importedTitle || other?.title || "";
        message = "Duplicate in this import.";
      } else if (isOnList(item.contentType, item.title)) {
        category = DUPLICATE_CATEGORY.on_watchlist;
        message = "Already on your list.";
      } else {
        const pKey =
          item.providerKey ||
          (item.pick ? providerKeyFromPick(item.pick, item.contentType) : "");
        if (pKey) {
          const ownerId = providerOwner.get(pKey);
          if (ownerId && ownerId !== item.id) {
            const other = items[ownerId];
            sourceTitle = other?.details?.title || other?.importedTitle || other?.title || "";
            if (other?.status === STATUS.added) {
              category = DUPLICATE_CATEGORY.already_added_in_job;
              message = "Already added from this import.";
            } else if (isMatchVerified(other) || other?.status === STATUS.ready_to_add) {
              category = DUPLICATE_CATEGORY.provider_id;
              message = "Same provider ID already matched in this import.";
            }
          }
        }
      }

      if (category) {
        const wasDup = item.status === STATUS.duplicate;
        item.status = STATUS.duplicate;
        item.duplicateCategory = category;
        item.duplicateSourceTitle = sourceTitle;
        item.error = message;
        if (!wasDup || item.duplicateCategory !== category) changed = true;
      } else if (item.status === STATUS.duplicate || item.duplicateCategory) {
        item.duplicateCategory = null;
        item.duplicateSourceTitle = "";
        item.error = "";
        if (!isMatchVerified(item)) {
          item.status = STATUS.pending;
          item.matchStatus = MATCH_STATUS.pending;
        } else {
          item.status = STATUS.ready_to_add;
        }
        changed = true;
      }
    }

    return changed;
  }

  function filterRowsBySearch(rows, query) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return rows;
    const exactProvider = /^(anilist|tmdb):[\w-]+$/i.test(q) ? q.toLowerCase() : "";
    return rows.filter((row) => {
      const fields = [
        row.title,
        row.importedTitle,
        row.details?.title,
        row.correctedType,
        row.originalType,
        row.providerKey,
        row.pick?.anilist_id != null ? `anilist:${row.pick.anilist_id}` : "",
        row.pick?.tmdb_id != null ? `tmdb:${row.pick.tmdb_id}` : "",
        row.pick?.id != null ? String(row.pick.id) : "",
      ]
        .filter(Boolean)
        .map((s) => String(s).toLowerCase());
      if (exactProvider) {
        return fields.some((f) => f === exactProvider);
      }
      return fields.some((f) => f.includes(q));
    });
  }

  function setJobWorkerLabel(job, label, itemId = "") {
    if (!job) return;
    job.workerLabel = label || "";
    job.workerItemId = itemId || "";
  }

  function appendRetryHistory(item, entry) {
    if (!item.retryHistory) item.retryHistory = [];
    item.retryHistory.push({ ...entry, at: Date.now() });
    if (item.retryHistory.length > 8) item.retryHistory.shift();
  }

  function setItemFailure(item, kind, message, provider) {
    item.failureKind = kind || FAILURE_KIND.other;
    item.lastProvider = provider || providerForItem(item);
    item.error = message || "";
    appendRetryHistory(item, {
      status: item.status,
      kind: item.failureKind,
      message: item.error,
      provider: item.lastProvider,
      retries: item.retries || 0,
    });
  }

  function humanizeFailureReason(item) {
    const err = String(item.error || "").toLowerCase();
    const kind = item.failureKind;

    if (item.status === STATUS.invalid) {
      if (err.includes("type") || err.includes("content")) return "Missing type";
      if (err.includes("year")) return "Invalid year";
      return item.error || "Invalid row";
    }
    if (item.status === STATUS.not_found) {
      if (kind === FAILURE_KIND.low_confidence || err.includes("low_confidence")) {
        return "Several conflicting matches";
      }
      if (item.contentType === "anime") return "No matching anime found";
      if (item.contentType === "tvSeries") return "No matching TV series found";
      if (item.contentType === "movies") return "No matching movie found";
      return "No provider match";
    }
    if (item.status === STATUS.failed) {
      if (kind === FAILURE_KIND.rate_limit || err.includes("rate limit")) {
        return "AniList rate limit";
      }
      if (kind === FAILURE_KIND.network || err.includes("network")) {
        return "Network timeout";
      }
      if (kind === FAILURE_KIND.transient || err.includes("temporary")) {
        return "AniList temporarily unavailable";
      }
      if (err.includes("provider details")) return "Provider details unavailable";
      if (err.includes("not configured")) return "Search not configured";
    }
    if (item.status === STATUS.pending || item.status === STATUS.processing) {
      if (item.waiting || item.failureKind === FAILURE_KIND.rate_limit) {
        return "Waiting for AniList — retrying automatically";
      }
      if (item.failureKind === FAILURE_KIND.network) {
        return "Network timeout";
      }
      if (item.failureKind === FAILURE_KIND.transient) {
        return "AniList temporarily unavailable";
      }
    }
    return item.error || "";
  }

  function failedSubSortKey(item) {
    if (item.status !== STATUS.failed) return 99;
    return FAILED_SUBORDER[item.failureKind] ?? FAILED_SUBORDER[FAILURE_KIND.other];
  }

  function sortPreviewRows(rows) {
    return [...(rows || [])].sort((a, b) => {
      const sa = PREVIEW_STATUS_ORDER[a.status] ?? 50;
      const sb = PREVIEW_STATUS_ORDER[b.status] ?? 50;
      if (sa !== sb) return sa - sb;
      if (a.status === STATUS.failed && b.status === STATUS.failed) {
        const fa = failedSubSortKey(a);
        const fb = failedSubSortKey(b);
        if (fa !== fb) return fa - fb;
      }
      return (a.line || 0) - (b.line || 0);
    });
  }

  function isPermanentUnresolved(item) {
    if (item.status === STATUS.needs_attention) return true;
    if (item.status === STATUS.not_found) return true;
    if (item.status === STATUS.invalid) return true;
    if (item.status === STATUS.possible_match) return true;
    if (item.status === STATUS.failed) {
      return !isTransientFailure(item) && item.failureKind !== FAILURE_KIND.rate_limit;
    }
    return false;
  }

  function isWaitingItem(item) {
    if (item.status === STATUS.waiting_retry) return true;
    if (item.status === STATUS.waiting_poster) return true;
    if (item.status === STATUS.processing) return true;
    if (item.status === STATUS.failed && isTransientFailure(item)) return true;
    if (item.status === STATUS.pending) {
      return Boolean(
        item.waiting || (item.retryAfter && item.retryAfter > Date.now())
      );
    }
    return false;
  }

  function isQueuedItem(item) {
    return (
      item.status === STATUS.pending &&
      !item.waiting &&
      (!item.retryAfter || item.retryAfter <= Date.now())
    );
  }

  function isReadyItem(item) {
    return isCommitEligible(item);
  }

  function isSkippedItem(item) {
    return item.status === STATUS.duplicate || item.status === STATUS.cancelled;
  }

  function isGroupedImportItem(item) {
    return Boolean(item?.franchiseMember && isMatchVerified(item) && item.status !== STATUS.added);
  }

  function stripLeadingArticle(title) {
    return normalizeImportTitle(title).replace(/^the\s+/, "");
  }

  const SPINOFF_TITLE_WORDS = new Set([
    "another",
    "world",
    "parallel",
    "remix",
    "reborn",
    "rebirth",
    "gaiden",
    "side",
    "story",
    "chronicles",
    "origins",
    "beginning",
    "season",
    "ova",
    "ona",
    "special",
    "movie",
  ]);

  /** Same work as imported title — not a spinoff/subtitle (e.g. Future Diary ≠ Future Diary Another World). */
  function importTitleSameWork(importTitle, candidateTitle) {
    const q = stripLeadingArticle(importTitle);
    const v = stripLeadingArticle(candidateTitle);
    if (!q || !v) return false;
    if (q === v) return true;
    if (collapseTitleSpaces(q) === collapseTitleSpaces(v)) return true;

    const qWords = q.split(/\s+/).filter(Boolean);
    const vWords = v.split(/\s+/).filter(Boolean);
    if (!qWords.length || !vWords.length) return false;
    if (qWords.join(" ") === vWords.join(" ")) return true;

    if (vWords.length > qWords.length) {
      const extraWords = vWords.slice(qWords.length);
      if (extraWords.some((w) => SPINOFF_TITLE_WORDS.has(w))) return false;
      if (extraWords.length >= 2) return false;
      const prefix = vWords.slice(0, qWords.length).join(" ");
      return prefix === qWords.join(" ");
    }

    if (qWords.length > vWords.length) {
      return qWords.slice(0, vWords.length).join(" ") === vWords.join(" ");
    }

    return false;
  }

  function isTmdbRivalForImportedAnime(item, tvPick, tvScore) {
    if (!tvPick || tvScore < 110) return false;
    if (!importTitleSameWork(item.importedTitle || item.title, tvPick.title || "")) return false;
    if (item.year != null) {
      const yp = yearScore(item.year, tvPick.year);
      if (yp < 0) return false;
    }
    return true;
  }

  function isTypeCorrectedFromAnime(item) {
    const imported = effectiveImportedType(item);
    return (
      imported === "anime" &&
      item.contentType === "tvSeries" &&
      (item.correctedType === "tvSeries" ||
        String(item.typeCorrected || "").startsWith("anime→"))
    );
  }

  function statusBucket(item) {
    if (item.status === STATUS.added) return "added";
    if (isGroupedImportItem(item)) return "grouped";
    if (isTypeCorrectedFromAnime(item) && isMatchVerified(item)) return "corrected";
    if (isReadyItem(item)) return "ready";
    if (isSkippedItem(item)) return "skipped";
    if (isWaitingItem(item)) return "waiting";
    if (item.status === STATUS.processing || isQueuedItem(item)) return "processing";
    if (item.status === STATUS.pending) return "processing";
    if (item.status === STATUS.invalid) return "needs_attention";
    if (isPermanentUnresolved(item)) return "needs_attention";
    return "other";
  }

  function hydrateImportItem(item) {
    if (!item) return item;
    if (!item.importedTitle && item.title) {
      item.importedTitle = item.title;
    }
    if (item.status === STATUS.exact_match) {
      item.status = STATUS.ready_to_add;
    }
    if (item.status === STATUS.ready) {
      item.status = STATUS.ready_to_add;
    }
    if (item.status === STATUS.needs_attention) {
      if (item.failureKind === FAILURE_KIND.invalid) {
        item.status = STATUS.invalid;
      } else if (item.failureKind === FAILURE_KIND.not_found) {
        item.status = STATUS.not_found;
      } else {
        item.status = STATUS.failed;
      }
    }
    if (item.status === STATUS.waiting_retry) {
      item.status = STATUS.pending;
      item.waiting = true;
    }
    if (item.status === STATUS.waiting_poster) {
      item.waiting = true;
      if (!item.metadataStatus || item.metadataStatus === METADATA_STATUS.not_started) {
        item.metadataStatus = METADATA_STATUS.metadata_waiting;
      }
    }
    if (item.retryAfter && !item.nextRetryAt) {
      item.nextRetryAt = item.retryAfter;
    }
    ensureMatchFields(item);
    if (
      item.status !== STATUS.added &&
      item.originalType === "anime" &&
      item.contentType === "tvSeries" &&
      item.typeCorrectionProvider !== "User"
    ) {
      resetItemForTypeRematch(item);
    }
    freezeVerifiedMatch(item);
    return item;
  }

  function isLegacyReadyStatus(status) {
    return (
      status === STATUS.ready_to_add ||
      status === STATUS.exact_match ||
      status === STATUS.ready
    );
  }

  function legacyStatusToMatchStatus(item) {
    if (item.status === STATUS.added) return MATCH_STATUS.verified;
    if (isLegacyReadyStatus(item.status)) return MATCH_STATUS.verified;
    if (item.status === STATUS.grouped && item.pick) return MATCH_STATUS.verified;
    if (item.status === STATUS.not_found) return MATCH_STATUS.not_found;
    if (item.status === STATUS.possible_match) return MATCH_STATUS.needs_attention;
    if (item.status === STATUS.failed || item.status === STATUS.invalid) {
      return MATCH_STATUS.needs_attention;
    }
    return MATCH_STATUS.pending;
  }

  function legacyStatusToMetadataStatus(item) {
    if (item.details?.plot) return METADATA_STATUS.complete;
    if (item.needsEnrichment || item.details?.enrichmentDeferred) {
      return METADATA_STATUS.pending;
    }
    if (isMatchVerified(item) && item.details?.title) return METADATA_STATUS.pending;
    return METADATA_STATUS.not_started;
  }

  function ensureMatchFields(item) {
    if (!item.matchRevision) item.matchRevision = 1;
    if (!item.matchStatus) item.matchStatus = legacyStatusToMatchStatus(item);
    if (!item.metadataStatus) item.metadataStatus = legacyStatusToMetadataStatus(item);
  }

  function isMatchVerified(item) {
    return item?.matchStatus === MATCH_STATUS.verified;
  }

  function bumpMatchRevision(item) {
    item.matchRevision = (item.matchRevision || 0) + 1;
    return item.matchRevision;
  }

  function canApplyMatchUpdate(item, revision) {
    if (!item || !revision) return true;
    return revision >= (item.matchRevision || 0);
  }

  function freezeVerifiedMatch(item) {
    if (item.status === STATUS.grouped && item.pick) {
      item.matchStatus = MATCH_STATUS.verified;
      item.status = STATUS.ready_to_add;
      item.franchiseMember = true;
    }
    if (isLegacyReadyStatus(item.status) && item.pick) {
      item.matchStatus = MATCH_STATUS.verified;
    }
    if (item.status === STATUS.added) {
      item.matchStatus = MATCH_STATUS.verified;
    }
  }

  function syncLegacyStatusFromMatch(item) {
    switch (item.matchStatus) {
      case MATCH_STATUS.verified:
        if (
          item.status !== STATUS.added &&
          item.status !== STATUS.duplicate &&
          !item.franchiseMember
        ) {
          item.status = STATUS.ready_to_add;
        }
        break;
      case MATCH_STATUS.not_found:
        item.status = STATUS.not_found;
        break;
      case MATCH_STATUS.needs_attention:
        if (item.status !== STATUS.possible_match) item.status = STATUS.failed;
        break;
      case MATCH_STATUS.matching:
        item.status = STATUS.processing;
        break;
      case MATCH_STATUS.pending:
        if (item.status !== STATUS.duplicate) item.status = STATUS.pending;
        break;
      default:
        break;
    }
  }

  function setMatchStatus(item, status) {
    ensureMatchFields(item);
    if (isMatchVerified(item) && status !== MATCH_STATUS.verified) return false;
    item.matchStatus = status;
    syncLegacyStatusFromMatch(item);
    return true;
  }

  function buildMinimalDetailsFromPick(pick, item) {
    const WM = window.WatchlistMetadata;
    return (
      WM?.getLightweightDetailsForPick?.(pick, {
        contentType: item.contentType,
        importTitle: item.title,
        year: item.year,
      }) ||
      WM?.buildLightweightDetailsFromSearchResult?.(pick, item.contentType) ||
      null
    );
  }

  function setMatchVerified(item, pick, details, job, providerIds) {
    ensureMatchFields(item);
    const pKey = providerKeyFromPick(pick, item.contentType);
    if (pKey && providerIds[pKey] && providerIds[pKey] !== item.id) {
      markDuplicate(
        item,
        DUPLICATE_CATEGORY.provider_id,
        "",
        "Same provider ID already matched in this import."
      );
      return false;
    }

    bumpMatchRevision(item);
    applyLightweightDetails(item, pick, details);
    window.WatchlistMetadata?.cacheResolvedPreview?.(pick, details);

    item.providerKey = pKey;
    item.candidates = [];
    item.lastProvider = providerForItem(item);
    item.failureKind = null;
    item.waiting = false;
    item.error = "";
    clearRetrySchedule(item);
    if (pKey) providerIds[pKey] = item.id;

    item.matchStatus = MATCH_STATUS.verified;
    item.metadataStatus = details?.plot
      ? METADATA_STATUS.complete
      : details?.title
        ? METADATA_STATUS.pending
        : METADATA_STATUS.not_started;
    item.needsEnrichment = item.metadataStatus === METADATA_STATUS.pending;

    if (!item.franchiseMember) {
      item.status = STATUS.ready_to_add;
    }
    return true;
  }

  function countVerifiedItems(items) {
    return Object.values(items || {}).filter(
      (item) =>
        isMatchVerified(item) &&
        item.status !== STATUS.duplicate &&
        item.status !== STATUS.added &&
        item.status !== STATUS.cancelled
    ).length;
  }

  function countRemainingAnime(items) {
    return Object.values(items || {}).filter(
      (item) =>
        item.contentType === "anime" &&
        !isMatchVerified(item) &&
        item.status !== STATUS.duplicate &&
        item.status !== STATUS.added &&
        item.status !== STATUS.cancelled &&
        item.status !== STATUS.invalid
    ).length;
  }

  function formatAccountingLine(stats) {
    const parts = [];
    if (stats.ready) parts.push(`${stats.ready} ready`);
    if (stats.needsAttention) parts.push(`${stats.needsAttention} attention`);
    if (stats.grouped) parts.push(`${stats.grouped} grouped`);
    if (stats.corrected) parts.push(`${stats.corrected} corrected`);
    if (stats.processing) parts.push(`${stats.processing} processing`);
    if (stats.waiting) parts.push(`${stats.waiting} waiting`);
    if (stats.skipped) parts.push(`${stats.skipped} skipped`);
    if (stats.added) parts.push(`${stats.added} added`);
    if (stats.other) parts.push(`${stats.other} other`);
    return `${stats.submitted} submitted = ${parts.join(" + ")}`;
  }

  function validateImportStatusAccounting(stats) {
    const total =
      (stats.ready || 0) +
      (stats.needsAttention || 0) +
      (stats.grouped || 0) +
      (stats.corrected || 0) +
      (stats.processing || 0) +
      (stats.waiting || 0) +
      (stats.skipped || 0) +
      (stats.added || 0) +
      (stats.other || 0);
    return {
      ok: total === (stats.submitted || 0),
      total,
      submitted: stats.submitted || 0,
      gap: (stats.submitted || 0) - total,
      stats,
    };
  }

  function logStatusAccounting(items, stats) {
    const list = Object.values(items || {});
    const rawStatus = {};
    const displayBuckets = {};
    const unbucketed = [];
    for (const item of list) {
      rawStatus[item.status] = (rawStatus[item.status] || 0) + 1;
      const bucket = statusBucket(item);
      displayBuckets[bucket] = (displayBuckets[bucket] || 0) + 1;
    }
    const accounting = validateImportStatusAccounting(stats);
    if (!accounting.ok) {
      for (const item of list) {
        const bucket = statusBucket(item);
        if (bucket === "other") {
          unbucketed.push({
            id: item.id,
            title: item.title,
            status: item.status,
            matchStatus: item.matchStatus,
            franchiseMember: Boolean(item.franchiseMember),
            waiting: Boolean(item.waiting),
          });
        }
      }
    }
    console.warn("[bulk-import:status-accounting]", {
      submitted: stats.submitted,
      rawStatus,
      displayBuckets,
      stats,
      accounted: accounting.total,
      gap: accounting.gap,
      unbucketed,
    });
    return accounting;
  }

  function healTransientFailedItems(items) {
    let changed = false;
    for (const item of Object.values(items || {})) {
      if (isMatchVerified(item)) {
        if (
          item.status === STATUS.failed &&
          (item.failureKind === FAILURE_KIND.rate_limit ||
            item.failureKind === FAILURE_KIND.transient ||
            item.failureKind === FAILURE_KIND.network ||
            item.failureKind === FAILURE_KIND.provider)
        ) {
          item.metadataStatus = METADATA_STATUS.temporary_failure;
          item.status = STATUS.ready_to_add;
          item.error = "";
          changed = true;
        }
        continue;
      }
      if (
        item.status === STATUS.failed &&
        (item.failureKind === FAILURE_KIND.rate_limit ||
          item.failureKind === FAILURE_KIND.transient ||
          item.failureKind === FAILURE_KIND.network ||
          (item.failureKind === FAILURE_KIND.provider && item.pick))
      ) {
        if (item.pick && item.failureKind === FAILURE_KIND.provider) {
          item.status = STATUS.pending;
          item.waiting = true;
          item.error = "Retrying provider details…";
        } else {
          resetItemForRetry(item);
        }
        changed = true;
      }
    }
    return changed;
  }

  function countNeedsAttention(items) {
    return Object.values(items || {}).filter(isPermanentUnresolved).length;
  }

  function countWaiting(items) {
    return Object.values(items || {}).filter(isWaitingItem).length;
  }

  function filterRowsByPreviewFilter(rows, filter) {
    if (!filter || filter === "all" || filter === "submitted") return rows;
    switch (filter) {
      case "ready":
        return rows.filter(isReadyItem);
      case "needs_attention":
        return rows.filter(isPermanentUnresolved);
      case "waiting":
        return rows.filter(isWaitingItem);
      case "added":
        return rows.filter((r) => r.status === STATUS.added);
      case "processing":
        return rows.filter(
          (r) => r.status === STATUS.processing || isQueuedItem(r)
        );
      case "verified":
        return rows.filter(
          (r) => r.status === STATUS.exact_match || r.status === STATUS.ready_to_add
        );
      case "duplicates":
        return rows.filter(isDuplicateRow);
      case "grouped":
        return rows.filter(isGroupedImportItem);
      case "corrected":
        return rows.filter(isTypeCorrectedFromAnime);
      case "other":
        return rows.filter((r) => statusBucket(r) === "other");
      case "not_found":
        return rows.filter((r) => r.status === STATUS.not_found);
      case "failed":
        return rows.filter((r) => r.status === STATUS.failed);
      default:
        return rows;
    }
  }

  function resetItemForRetry(item) {
    if (isMatchVerified(item)) return;
    item.status = STATUS.pending;
    item.retries = 0;
    clearRetrySchedule(item);
    item.error = "";
    item.pick = null;
    item.details = null;
    item.candidates = [];
    item._retryBatch = true;
  }

  function isAnilistFailure(item) {
    if (item.contentType !== "anime") return false;
    if (item.status !== STATUS.failed && item.status !== STATUS.pending) return false;
    const err = String(item.error || "").toLowerCase();
    return (
      item.failureKind === FAILURE_KIND.rate_limit ||
      item.failureKind === FAILURE_KIND.transient ||
      item.failureKind === FAILURE_KIND.network ||
      err.includes("anilist") ||
      err.includes("rate limit") ||
      err.includes("temporary")
    );
  }

  function isTransientFailure(item) {
    if (item.status !== STATUS.failed) return false;
    return (
      item.failureKind === FAILURE_KIND.rate_limit ||
      item.failureKind === FAILURE_KIND.transient ||
      item.failureKind === FAILURE_KIND.network
    );
  }

  function touchRetryProgress(job, item) {
    if (!job?.retryProgress || !item?._retryBatch) return;
    if (item.status === STATUS.pending || item.status === STATUS.processing) return;
    job.retryProgress.current = Math.min(
      job.retryProgress.total,
      (job.retryProgress.current || 0) + 1
    );
    delete item._retryBatch;
    if (job.retryProgress.current >= job.retryProgress.total) {
      job.retryProgress = null;
    }
  }

  function requeueItems(listId, predicate, options = {}) {
    const items = loadItems(listId);
    const job = loadJob(listId);
    if (!items || !job) return 0;

    const targets = Object.values(items).filter(predicate);
    if (!targets.length) return 0;

    for (const item of targets) {
      resetItemForRetry(item);
    }

    job.paused = false;
    job.status = "processing";
    job.retryProgress = {
      label: options.label || "Retrying",
      total: targets.length,
      current: 0,
    };
    job.stats = recomputeStats(items);
    job.updatedAt = Date.now();
    saveJob(listId, job);
    saveItems(listId, items);
    onChange?.({ listId, job, items });
    paused = false;
    void kickImportQueue(listId);
    return targets.length;
  }

  function retryAllFailed(listId) {
    return requeueItems(
      listId,
      (item) => item.status === STATUS.failed,
      { label: "Retrying failed" }
    );
  }

  function retryAnimeFailures(listId) {
    return requeueItems(
      listId,
      (item) =>
        item.contentType === "anime" &&
        (item.status === STATUS.failed || item.status === STATUS.not_found),
      { label: "Retrying anime" }
    );
  }

  function retryTransientFailures(listId) {
    return requeueItems(
      listId,
      (item) => item.status === STATUS.failed && isTransientFailure(item),
      { label: "Retrying temporary" }
    );
  }

  function retryNotFound(listId) {
    return requeueItems(
      listId,
      (item) => item.status === STATUS.not_found,
      { label: "Retrying not found" }
    );
  }

  function retryAnilistFailures(listId) {
    return requeueItems(
      listId,
      (item) => item.status === STATUS.failed && isAnilistFailure(item),
      { label: "Retrying anime" }
    );
  }

  function escapeTsvCell(value) {
    return String(value ?? "")
      .replace(/\t/g, " ")
      .replace(/\r?\n/g, " ")
      .trim();
  }

  function exportItemsTsv(items, options = {}) {
    const { statusFilter = "unresolved" } = options;
    let rows = Object.values(items || {});

    if (statusFilter === "failed") {
      rows = rows.filter((r) => r.status === STATUS.failed);
    } else if (statusFilter === "not_found") {
      rows = rows.filter((r) => r.status === STATUS.not_found);
    } else if (statusFilter === "unresolved") {
      rows = rows.filter(isPermanentUnresolved);
    } else {
      rows = filterRowsByPreviewFilter(rows, statusFilter);
      rows = rows.filter(
        (r) => r.status === STATUS.failed || r.status === STATUS.not_found
      );
    }

    rows = sortPreviewRows(rows);
    const lines = [
      "ImportItemID\tTitle\tYear\tType\tProviderURL\tStatus\tReason",
    ];
    for (const item of rows) {
      const statusKey =
        item.status === STATUS.failed
          ? "failed"
          : item.status === STATUS.not_found
            ? "not_found"
            : item.status;
      lines.push(
        [
          escapeTsvCell(item.id),
          escapeTsvCell(item.importedTitle || item.title),
          item.year != null && Number.isFinite(item.year) ? String(item.year) : "",
          escapeTsvCell(item.contentType),
          escapeTsvCell(item.providerUrl || ""),
          escapeTsvCell(statusKey),
          escapeTsvCell(humanizeFailureReason(item)),
        ].join("\t")
      );
    }
    return lines.join("\n") + (lines.length > 1 ? "\n" : "");
  }

  async function copyUnresolvedTsv(items, options = {}) {
    const tsv = exportItemsTsv(items, options);
    if (!tsv.trim() || tsv.split("\n").length < 2) return false;
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(tsv);
      return true;
    }
    return false;
  }

  function downloadImportTsv(filename, tsv) {
    const blob = new Blob([tsv], { type: "text/tab-separated-values;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function parseCorrectedTsv(raw) {
    const text = String(raw || "")
      .replace(/^\uFEFF/, "")
      .trim();
    if (!text) return { ok: false, rows: [], error: "empty" };

    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    if (lines.length < 2) return { ok: false, rows: [], error: "no_data" };

    const header = lines[0].split("\t").map((h) => h.trim().toLowerCase());
    const col = (name) => header.indexOf(name);
    const titleIdx = col("title");
    const yearIdx = col("year");
    const typeIdx = col("type");
    const idIdx = col("import_item_id");
    const importItemIdIdx = idIdx >= 0 ? idIdx : col("importitemid");
    const providerUrlIdx = col("providerurl");

    if (titleIdx < 0 || typeIdx < 0) {
      return { ok: false, rows: [], error: "bad_header" };
    }

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split("\t");
      const title = parts[titleIdx]?.trim();
      if (!title) continue;
      let year = null;
      if (yearIdx >= 0 && parts[yearIdx]?.trim()) {
        const y = parseInt(parts[yearIdx].trim(), 10);
        if (Number.isFinite(y)) year = y;
      }
      const idCol = importItemIdIdx >= 0 ? importItemIdIdx : idIdx;
      rows.push({
        importItemId: idCol >= 0 ? parts[idCol]?.trim() : "",
        title,
        year,
        contentType: parts[typeIdx]?.trim(),
        providerUrl: providerUrlIdx >= 0 ? parts[providerUrlIdx]?.trim() : "",
      });
    }
    return { ok: true, rows };
  }

  function applyCorrectedTsv(listId, raw) {
    const parsed = parseCorrectedTsv(raw);
    if (!parsed.ok || !parsed.rows.length) {
      return { updated: 0, skipped: 0, ambiguous: 0, error: parsed.error };
    }

    const items = loadItems(listId);
    const job = loadJob(listId);
    if (!items || !job) return { updated: 0, skipped: parsed.rows.length, ambiguous: 0 };

    const unresolved = Object.values(items).filter(
      (it) =>
        it.status === STATUS.failed ||
        it.status === STATUS.not_found ||
        it.status === STATUS.invalid ||
        it.status === STATUS.possible_match
    );

    let updated = 0;
    let ambiguous = 0;
    let skipped = 0;

    for (const row of parsed.rows) {
      let target = null;

      if (row.importItemId && items[row.importItemId]) {
        const candidate = items[row.importItemId];
        if (
          candidate.status === STATUS.failed ||
          candidate.status === STATUS.not_found ||
          candidate.status === STATUS.invalid ||
          candidate.status === STATUS.possible_match
        ) {
          target = candidate;
        }
      }

      if (!target) {
        const matches = unresolved.filter((it) => {
          if (row.contentType && it.contentType !== row.contentType) return false;
          const rowTitle = normalizeImportTitle(row.title);
          return (
            normalizeImportTitle(it.title) === rowTitle ||
            normalizeImportTitle(it.importedTitle || "") === rowTitle
          );
        });
        if (matches.length === 1) target = matches[0];
        else if (matches.length > 1) {
          ambiguous += 1;
          skipped += 1;
          continue;
        }
      }

      if (!target) {
        skipped += 1;
        continue;
      }

      target.title = row.title;
      if (!target.importedTitle) target.importedTitle = target.title;
      target.year = row.year;
      if (row.contentType && ["movies", "tvSeries", "anime"].includes(row.contentType)) {
        target.contentType = row.contentType;
      }
      if (row.providerUrl) target.providerUrl = row.providerUrl;
      resetItemForRetry(target);
      updated += 1;
    }

    if (updated) {
      job.paused = false;
      job.status = "processing";
      job.retryProgress = {
        label: "Retrying corrected",
        total: updated,
        current: 0,
      };
      job.stats = recomputeStats(items);
      job.updatedAt = Date.now();
      saveJob(listId, job);
      saveItems(listId, items);
      onChange?.({ listId, job, items });
      paused = false;
      kickImportQueue(listId);
    }

    return { updated, skipped, ambiguous, error: null };
  }

  function rowDupKey(contentType, title, year) {
    const base = `${contentType}::${normalizeTitleKey(title)}`;
    return year != null ? `${base}::${year}` : base;
  }

  function emptyStats() {
    return {
      submitted: 0,
      ready: 0,
      needsAttention: 0,
      waiting: 0,
      skipped: 0,
      added: 0,
      other: 0,
      processing: 0,
      grouped: 0,
      corrected: 0,
      exact: 0,
      possible: 0,
      duplicates: 0,
      notFound: 0,
      failed: 0,
      invalid: 0,
      accountingOk: true,
      accountingGap: 0,
    };
  }

  function recomputeStats(items, job) {
    const stats = emptyStats();
    const list = Object.values(items || {});
    stats.submitted = list.length;
    for (const item of list) {
      const bucket = statusBucket(item);
      if (bucket === "ready") stats.ready += 1;
      else if (bucket === "needs_attention") stats.needsAttention += 1;
      else if (bucket === "waiting") stats.waiting += 1;
      else if (bucket === "processing") stats.processing += 1;
      else if (bucket === "skipped") stats.skipped += 1;
      else if (bucket === "added") stats.added += 1;
      else if (bucket === "grouped") stats.grouped += 1;
      else if (bucket === "corrected") stats.corrected += 1;
      else stats.other += 1;

      switch (item.status) {
        case STATUS.exact_match:
          stats.exact += 1;
          break;
        case STATUS.possible_match:
          stats.possible += 1;
          break;
        case STATUS.duplicate:
          stats.duplicates += 1;
          break;
        case STATUS.not_found:
          stats.notFound += 1;
          break;
        case STATUS.failed:
          if (isPermanentUnresolved(item)) stats.failed += 1;
          break;
        case STATUS.invalid:
          stats.invalid += 1;
          break;
        default:
          break;
      }
    }
    stats.verified = countVerifiedItems(items);
    stats.remainingAnime = countRemainingAnime(items);
    const accounting = validateImportStatusAccounting(stats);
    stats.accountingOk = accounting.ok;
    stats.accountingGap = accounting.gap;
    if (!accounting.ok || stats.other > 0) {
      logStatusAccounting(items, stats);
    }
    if (job) {
      job.statsReadyHighWater = Math.max(job.statsReadyHighWater || 0, stats.ready);
    }
    return stats;
  }

  function createJobFromParse(listId, parsed) {
    const items = {};
    const seenImport = new Set();
    const helpers = window.WatchlistImportJob?._helpers || {};
    const isOnList = helpers.isOnList || (() => false);

    for (const row of parsed.rows || []) {
      const id = makeItemId(row.line, row.title || row.error, row.contentType || "x");
      let status = row.status;
      let error = row.error || "";

      if (status === "invalid") {
      items[id] = {
        id,
        line: row.line,
        title: row.title || "",
        importedTitle: row.title || "",
        originalType: row.contentType || "",
        year: row.year ?? null,
        contentType: row.contentType || "",
        providerUrl: row.providerUrl || "",
        status: STATUS.invalid,
          error,
          candidates: [],
          pick: null,
          details: null,
          groupId: null,
          groupMembers: [],
          providerKey: null,
          retries: 0,
        };
        continue;
      }

      const dupKey = rowDupKey(row.contentType, row.title, row.year);
      if (status === "duplicate_list" || status === "duplicate_import") {
        const dupCategory =
          status === "duplicate_list"
            ? DUPLICATE_CATEGORY.on_watchlist
            : DUPLICATE_CATEGORY.import_tsv;
        items[id] = {
          id,
          line: row.line,
          title: row.title,
          importedTitle: row.title,
          originalType: row.contentType,
          year: row.year ?? null,
          contentType: row.contentType,
          providerUrl: row.providerUrl || "",
          status: STATUS.duplicate,
          duplicateCategory: dupCategory,
          error:
            status === "duplicate_list"
              ? "Already on your list."
              : "Duplicate in this import.",
          candidates: [],
          pick: null,
          details: null,
          groupId: null,
          groupMembers: [],
          providerKey: null,
          retries: 0,
        };
        continue;
      }

      if (seenImport.has(dupKey)) {
        items[id] = {
          id,
          line: row.line,
          title: row.title,
          importedTitle: row.title,
          originalType: row.contentType,
          year: row.year ?? null,
          contentType: row.contentType,
          providerUrl: row.providerUrl || "",
          status: STATUS.duplicate,
          duplicateCategory: DUPLICATE_CATEGORY.import_tsv,
          error: "Duplicate in this import.",
          candidates: [],
          pick: null,
          details: null,
          groupId: null,
          groupMembers: [],
          providerKey: null,
          retries: 0,
        };
        continue;
      }
      seenImport.add(dupKey);

      items[id] = {
        id,
        line: row.line,
        title: row.title,
        importedTitle: row.title,
        originalType: row.contentType,
        year: row.year ?? null,
        contentType: row.contentType,
        providerUrl: row.providerUrl || "",
        status: STATUS.pending,
        error: "",
        candidates: [],
        pick: null,
        details: null,
        groupId: null,
        groupMembers: [],
        providerKey: null,
        retries: 0,
        matchStatus: MATCH_STATUS.pending,
        metadataStatus: METADATA_STATUS.not_started,
        matchRevision: 1,
      };

      if (isOnList(row.contentType, row.title)) {
        items[id].status = STATUS.duplicate;
        items[id].duplicateCategory = DUPLICATE_CATEGORY.on_watchlist;
        items[id].error = "Already on your list.";
      }
    }

    healDuplicateClassifications(items);

    const job = {
      version: JOB_VERSION,
      jobId: `job-${Date.now()}`,
      listId,
      status: "idle",
      paused: false,
      format: parsed.format || "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      nextIndex: 0,
      batchSize: BATCH_SIZE,
      stats: recomputeStats(items),
      providerIds: {},
      checkedCount: 0,
    };

    saveJob(listId, job);
    saveItems(listId, items);
    return { job, items };
  }

  function titleVariantScore(queryNorm, variantNorm) {
    if (!queryNorm || !variantNorm) return { score: 0, reason: "" };
    if (queryNorm === variantNorm) return { score: 130, reason: "exact_normalized" };

    const qCollapsed = collapseTitleSpaces(queryNorm);
    const vCollapsed = collapseTitleSpaces(variantNorm);
    if (qCollapsed && qCollapsed === vCollapsed) {
      return { score: 128, reason: "collapsed_exact" };
    }

    if (
      variantNorm.startsWith(queryNorm + ":") ||
      variantNorm.startsWith(queryNorm + " -") ||
      (variantNorm.startsWith(queryNorm + " ") && variantNorm.length > queryNorm.length + 2)
    ) {
      return { score: 122, reason: "root_subtitle" };
    }

    if (
      qCollapsed &&
      vCollapsed &&
      (vCollapsed.startsWith(qCollapsed + ":") ||
        (vCollapsed.startsWith(qCollapsed) && vCollapsed.length > qCollapsed.length + 2))
    ) {
      return { score: 120, reason: "root_subtitle_collapsed" };
    }

    if (/^\d+(\.\d+)?$/.test(queryNorm)) {
      if (
        variantNorm.startsWith(queryNorm + ":") ||
        variantNorm.startsWith(queryNorm + " ")
      ) {
        return { score: 125, reason: "numeric_prefix" };
      }
      if (vCollapsed.startsWith(qCollapsed + ":") || vCollapsed === qCollapsed) {
        return { score: 125, reason: "numeric_prefix" };
      }
    }

    const qWords = queryNorm.split(" ").filter(Boolean);
    const vWords = variantNorm.split(" ").filter(Boolean);
    const vSet = new Set(vWords);
    let hits = 0;
    for (const w of qWords) {
      if (w.length > 1 && vSet.has(w)) hits += 1;
    }
    const minLen = Math.min(qWords.length, vWords.length);
    if (minLen >= 2 && hits === qWords.length && hits === vWords.length) {
      return { score: 125, reason: "word_exact" };
    }
    if (
      hits >= Math.max(2, Math.ceil(qWords.length * 0.85)) &&
      hits >= Math.ceil(vWords.length * 0.85)
    ) {
      return { score: 112, reason: "strong_words" };
    }
    return { score: Math.min(85, hits * 16), reason: "partial" };
  }

  function candidateTitleVariants(result) {
    const raw = [];
    if (result.titleEnglish) raw.push(result.titleEnglish);
    if (result.titleRomaji) raw.push(result.titleRomaji);
    if (result.titleNative) raw.push(result.titleNative);
    if (result.title) raw.push(result.title);
    for (const s of result.synonyms || []) raw.push(s);
    return [...new Set(raw.map(normalizeImportTitle).filter(Boolean))];
  }

  function titleScore(queryTitle, candidateTitle) {
    const a = normalizeImportTitle(queryTitle);
    const b = normalizeImportTitle(candidateTitle);
    return titleVariantScore(a, b).score;
  }

  function yearScore(expected, candidateYear) {
    if (expected == null) return 0;
    const y = parseInt(String(candidateYear || "").trim(), 10);
    if (!Number.isFinite(y)) return -10;
    const diff = Math.abs(y - expected);
    if (diff === 0) return 30;
    if (diff === 1) return 10;
    if (diff <= 2) return 0;
    return -25;
  }

  function pickSearchType(contentType) {
    if (contentType === "movies") return "movie";
    if (contentType === "tvSeries") return "series";
    return "anime";
  }

  function resultMatchesType(result, contentType) {
    if (!result) return false;
    if (contentType === "movies") {
      return result.type === "movie" || result.tmdbType === "movie";
    }
    if (contentType === "tvSeries") {
      return (
        result.type === "series" ||
        result.tmdbType === "tv" ||
        result.mediaType === "series"
      );
    }
    if (contentType === "anime") {
      return result.source === "anilist" || result.type === "anime";
    }
    return false;
  }

  function providerKeyFromPick(pick, contentType) {
    if (!pick) return null;
    if (pick.anilistId) return `anilist:${pick.anilistId}`;
    if (pick.tmdbId) return `tmdb:${pick.tmdbType || contentType}:${pick.tmdbId}`;
    if (pick.imdbId) return `imdb:${pick.imdbId}`;
    return null;
  }

  function scoreAnimeCandidate(item, result) {
    const queryPasses = buildAnimeSearchPasses(item).map(normalizeImportTitle);
    const variants = candidateTitleVariants(result);
    let bestTitle = 0;
    let bestReason = "";
    for (const q of queryPasses) {
      for (const v of variants) {
        const { score, reason } = titleVariantScore(q, v);
        if (score > bestTitle) {
          bestTitle = score;
          bestReason = reason;
        }
      }
    }
    const yearPart = yearScore(item.year, result.year);
    const importedBonus =
      (item.originalType === "anime" || item.contentType === "anime")
        ? IMPORTED_ANIME_SCORE_BONUS
        : 0;
    return {
      result,
      score: bestTitle + yearPart + importedBonus,
      titlePart: bestTitle,
      yearPart,
      reason: bestReason,
      importedBonus,
    };
  }

  function scoreCandidates(results, item) {
    const filtered = (results || []).filter((r) => resultMatchesType(r, item.contentType));
    const scorer =
      item.contentType === "anime"
        ? (r) => scoreAnimeCandidate(item, r)
        : (result) => {
            const titlePart = titleScore(item.title, result.title);
            const yearPart = yearScore(item.year, result.year);
            return { result, score: titlePart + yearPart, titlePart, yearPart, reason: "" };
          };
    return filtered
      .map(scorer)
      .filter((entry) => entry.score >= 70)
      .sort((a, b) => b.score - a.score);
  }

  function preferAnimeFranchiseRoot(scored, item) {
    if (!scored.length) return scored;
    const queryNorm = normalizeImportTitle(item.title);
    const franchiseLike = scored.filter((entry) => {
      const variants = candidateTitleVariants(entry.result);
      return variants.some(
        (v) => v === queryNorm || titleVariantScore(queryNorm, v).score >= 112
      );
    });
    if (franchiseLike.length < 2) return scored;

    const ranked = [...franchiseLike].sort((a, b) => {
      const ya = parseInt(String(a.result.year || ""), 10) || 9999;
      const yb = parseInt(String(b.result.year || ""), 10) || 9999;
      if (ya !== yb) return ya - yb;
      const fa = String(a.result.format || "").toUpperCase();
      const fb = String(b.result.format || "").toUpperCase();
      const seasonRank = (f) => (f === "TV" ? 0 : f === "TV_SHORT" ? 1 : f === "MOVIE" ? 2 : 3);
      return seasonRank(fa) - seasonRank(fb);
    });

    const root = ranked[0];
    const rest = scored.filter((s) => s !== root);
    return [root, ...rest];
  }

  function autoPickFromScored(scored, item) {
    const ordered =
      item.contentType === "anime" ? preferAnimeFranchiseRoot(scored, item) : scored;
    if (!ordered.length) {
      return { pick: null, reason: "no_candidates" };
    }
    const top = ordered[0];
    const second = ordered[1];
    const gap = second ? top.score - second.score : top.score;
    const matchReason = top.reason || "";

    const rootMatch =
      matchReason === "root_subtitle" ||
      matchReason === "root_subtitle_collapsed" ||
      matchReason === "collapsed_exact" ||
      matchReason === "numeric_prefix";

    if (rootMatch) {
      if (item.year == null) {
        if (top.titlePart >= 115 && gap >= 6) {
          return { pick: top.result, reason: matchReason };
        }
      } else if (top.yearPart >= 25) {
        return { pick: top.result, reason: "root_year_match" };
      } else if (top.yearPart >= 10 && gap >= 12) {
        return { pick: top.result, reason: "root_year_close" };
      }
    }

    if (top.titlePart >= 130) {
      return { pick: top.result, reason: "exact_title" };
    }
    if (item.year != null && top.titlePart >= 100 && top.yearPart >= 25 && gap >= 8) {
      return { pick: top.result, reason: "title_year" };
    }
    if (item.year == null && top.score >= 115 && gap >= 12) {
      return { pick: top.result, reason: "strong_gap" };
    }
    if (top.score >= 118 && gap >= 15) {
      return { pick: top.result, reason: "high_confidence" };
    }
    if (item.contentType === "anime" && top.titlePart >= 112 && gap >= 10) {
      return { pick: top.result, reason: "anime_strong" };
    }
    if (scored.length === 1 && top.score >= 100) {
      return { pick: top.result, reason: "single_candidate" };
    }
    if (
      second &&
      item.year != null &&
      top.yearPart >= 25 &&
      second.yearPart < 10 &&
      top.titlePart >= 105
    ) {
      return { pick: top.result, reason: "year_disambiguated" };
    }
    if (
      item.contentType === "anime" &&
      (item.originalType === "anime" || !item.correctedType) &&
      item.year != null &&
      top.titlePart >= 88 &&
      top.yearPart >= 20
    ) {
      return { pick: top.result, reason: "imported_anime_year_match" };
    }
    return {
      pick: null,
      reason: `low_confidence: top=${top.score} gap=${gap} ${top.reason || ""}`,
    };
  }

  const TYPE_VERIFY_STRONG = 115;
  const TYPE_VERIFY_CROSS_GAP = 15;
  const IMPORTED_ANIME_SCORE_BONUS = 15;
  const ANIME_TV_AUTO_CORRECT_MIN_GAP = 30;
  const ANIME_TV_AUTO_CORRECT_MIN_TV_SCORE = 128;

  const COMMON_SHORT_TITLE_WORDS = new Set([
    "another",
    "charlotte",
    "monster",
    "kingdom",
    "pluto",
    "orange",
    "given",
    "erased",
    "hero",
    "gate",
    "free",
    "working",
    "blood",
    "shield",
    "banana",
  ]);

  function isCommonShortTitle(title) {
    const norm = normalizeImportTitle(title).toLowerCase().trim();
    if (COMMON_SHORT_TITLE_WORDS.has(norm)) return true;
    const words = norm.split(/\s+/).filter(Boolean);
    return words.length === 1 && words[0].length <= 9;
  }

  function animeEvidenceScore(rawScore, item) {
    const imported = item.originalType || item.contentType;
    return rawScore + (imported === "anime" ? IMPORTED_ANIME_SCORE_BONUS : 0);
  }

  function userImportedAsAnime(item) {
    return effectiveImportedType(item) === "anime" || item?.originalType === "anime";
  }

  function canAutoCorrectAnimeToTv(item, animeScore, tvScore) {
    // TSV/import type "anime" is authoritative — never auto-switch to TMDb TV.
    if (userImportedAsAnime(item)) return false;
    if (effectiveImportedType(item) !== "anime") return false;
    if (animeScore >= 88) return false;
    if (isCommonShortTitle(item.title)) return false;
    if (tvScore < ANIME_TV_AUTO_CORRECT_MIN_TV_SCORE) return false;
    if (tvScore < animeScore + ANIME_TV_AUTO_CORRECT_MIN_GAP) return false;
    return true;
  }

  function buildTypeConflictError(item, animeCand, tvCand) {
    const imported = effectiveImportedType(item) === "anime" ? "Anime" : item.originalType || "Anime";
    const lines = [`Imported type: ${imported}`];
    if (animeCand) {
      const state = animeCand.lookupState || "found";
      lines.push(
        `Anime candidate: ${state} · ${animeCand.provider || "AniList"} · score ${animeCand.score ?? "—"}` +
          (animeCand.anilistId ? ` · AniList ${animeCand.anilistId}` : "")
      );
    } else {
      lines.push("Anime candidate: not found");
    }
    if (tvCand) {
      lines.push(
        `TMDb candidate: found · score ${tvCand.score ?? "—"}` +
          (tvCand.tmdbId ? ` · TMDb ${tvCand.tmdbId}` : "")
      );
    } else {
      lines.push("TMDb candidate: not found");
    }
    const decision =
      item.typeConflictReason === "anime_lookup_waiting"
        ? "Retry anime lookup"
        : "Review needed";
    lines.push(`Decision: ${decision}`);
    return lines.join(" ");
  }

  function animeCandidateFromScored(scored, item, pick, boostedAnimeScore, providerLabel) {
    if (pick) {
      return {
        pick,
        score: boostedAnimeScore,
        provider: providerLabel || "AniList",
        anilistId: pick.anilistId,
        lookupState: "found",
      };
    }
    const top = scored?.[0];
    if (!top?.result) return null;
    const score = animeEvidenceScore(top.score, item);
    return {
      pick: top.result,
      score,
      provider: providerLabel || "AniList",
      anilistId: top.result.anilistId,
      lookupState: score >= 88 ? "found" : "weak",
      weak: score < 88,
    };
  }

  function flagAnimeTvTypeConflict(item, { anime, tv, reason } = {}) {
    item.typeConflictAmbiguous = true;
    item.typeReviewRequired = true;
    item.typeCorrectionUncertain = true;
    item.typeConflictReason = reason || "anime_tv_type_conflict";
    item.lastProvider = "AniList";
    if (anime) {
      item.typeConflictAnime = {
        contentType: "anime",
        provider: anime.provider || "AniList",
        score: anime.score,
        anilistId: anime.anilistId || anime.pick?.anilistId || null,
        title: anime.pick?.title || anime.title || "",
        lookupState: anime.lookupState || "found",
      };
    } else {
      item.typeConflictAnime = {
        contentType: "anime",
        provider: "AniList",
        lookupState: reason === "anime_lookup_waiting" ? "waiting" : "not_found",
      };
    }
    if (tv) {
      item.typeConflictTv = {
        contentType: "tvSeries",
        provider: "TMDb",
        score: tv.score,
        tmdbId: tv.tmdbId || tv.pick?.tmdbId || null,
        title: tv.pick?.title || tv.title || "",
      };
    }
    if (effectiveImportedType(item) === "anime") {
      item.contentType = "anime";
      item.correctedType = null;
      item.typeCorrected = null;
      item.typeCorrectionProvider = null;
    }
    if (reason === "anime_lookup_waiting") {
      item.status = STATUS.pending;
      item.failureKind = FAILURE_KIND.transient;
      item.error = buildTypeConflictError(item, item.typeConflictAnime, item.typeConflictTv);
      syncRetrySchedule(
        item,
        Date.now() + 30000,
        "Retrying anime lookup after provider conflict"
      );
      setMatchStatus(item, MATCH_STATUS.needs_attention);
      item.pick = null;
      item.details = null;
      item.candidates = [];
      return;
    }
    item.status = STATUS.failed;
    setItemFailure(
      item,
      FAILURE_KIND.low_confidence,
      buildTypeConflictError(item, item.typeConflictAnime, item.typeConflictTv),
      "AniList"
    );
    setMatchStatus(item, MATCH_STATUS.needs_attention);
    item.pick = null;
    item.details = null;
    item.candidates = [];
  }

  function typeLabelKey(contentType) {
    if (contentType === "movies") return "bulk.type.movies";
    if (contentType === "tvSeries") return "bulk.type.tvSeries";
    if (contentType === "anime") return "bulk.type.anime";
    return "bulk.type.movies";
  }

  function applyTypeCorrection(item, fromType, toType, meta = {}) {
    if (
      fromType === "anime" &&
      (toType === "tvSeries" || toType === "movies") &&
      meta.provider !== "User"
    ) {
      return false;
    }
    if (!item.originalType) item.originalType = fromType;
    item.correctedType = toType;
    item.contentType = toType;
    item.typeCorrectionReason = meta.reason || meta.matchReason || "";
    item.typeCorrectionConfidence = meta.confidence ?? meta.score ?? null;
    item.typeCorrectionProvider = meta.provider || "";
    item.typeCorrected = `${fromType}→${toType}`;
    item.matchReason = meta.matchReason || item.typeCorrectionReason;
  }

  function formatTypeCorrectionNote(item) {
    const from = item.originalType || item.contentType;
    const to = item.correctedType || item.contentType;
    if (
      item.typeConflictAmbiguous ||
      item.typeReviewRequired ||
      item.typeCorrectionUncertain
    ) {
      const fromLabel =
        from === "movies" ? "Movie" : from === "tvSeries" ? "TV series" : from === "anime" ? "Anime" : from;
      const conflictTo =
        item.typeConflictTv?.contentType === "tvSeries"
          ? "TV series"
          : to === "tvSeries"
            ? "TV series"
            : to === "movies"
              ? "Movie"
              : to === "anime"
                ? "Anime"
                : to;
      if (fromLabel && conflictTo && from !== to) {
        return `Type conflict: ${fromLabel} vs ${conflictTo} — review needed`;
      }
    }
    if (!to || from === to) return "";
    const fromLabel =
      from === "movies" ? "Movie" : from === "tvSeries" ? "TV series" : from === "anime" ? "Anime" : from;
    const toLabel =
      to === "movies" ? "Movie" : to === "tvSeries" ? "TV series" : to === "anime" ? "Anime" : to;
    if (
      effectiveImportedType(item) === "anime" &&
      to === "tvSeries" &&
      item.typeCorrectionProvider !== "User"
    ) {
      return `Type wrongly corrected: ${fromLabel} → ${toLabel} — review needed`;
    }
    return `Type corrected: ${fromLabel} → ${toLabel}`;
  }

  async function scoreTmdbForItem(item, searchType) {
    const result = await searchTmdbScoredForItem(item, searchType);
    if (!result.ok) return null;
    return {
      contentType: result.contentType,
      provider: result.provider,
      scored: result.scored,
      auto: result.auto,
      topScore: result.topScore,
      pick: result.pick,
    };
  }

  async function scoreAnimeForItem(item, { allowAnilist = false } = {}) {
    const WM = window.WatchlistMetadata;
    const probe = { ...item, contentType: "anime" };

    if (WM?.lookupCachedAnilistMatch) {
      const cached = WM.lookupCachedAnilistMatch(item.title, {
        year: item.year,
        searchPasses: buildAnimeSearchPasses(item),
      });
      if (cached?.pick) {
        const asResult = {
          source: "anilist",
          anilistId: cached.pick.anilistId,
          title: cached.pick.title || item.title,
          year: cached.pick.year || "",
          type: "anime",
          format: cached.pick.format || "TV",
          titleEnglish: cached.pick.titleEnglish,
          titleRomaji: cached.pick.titleRomaji,
          synonyms: cached.pick.synonyms || [],
        };
        const scored = scoreCandidates([asResult], probe);
        const auto = autoPickFromScored(scored, probe);
        if (auto.pick) {
          return {
            contentType: "anime",
            provider: "Provider cache",
            scored,
            auto,
            topScore: scored[0]?.score || 0,
            pick: auto.pick,
          };
        }
      }
    }

    if (WM?.searchAnimeOfflineIndex) {
      const offline = await WM.searchAnimeOfflineIndex(item.title, {
        year: item.year,
        searchPasses: buildAnimeSearchPasses(item),
      });
      if (offline?.ok && offline.pick) {
        const scored = scoreCandidates([offline.pick], probe);
        const auto = autoPickFromScored(scored, probe);
        if (auto.pick) {
          return {
            contentType: "anime",
            provider: "Anime index",
            scored,
            auto,
            topScore: scored[0]?.score || 0,
            pick: auto.pick,
          };
        }
      }
      if (offline?.ok && offline.results?.length) {
        const scored = scoreCandidates(offline.results, probe);
        const auto = autoPickFromScored(scored, probe);
        if (auto.pick && (scored[0]?.score || 0) >= 95) {
          return {
            contentType: "anime",
            provider: "Anime index",
            scored,
            auto,
            topScore: scored[0]?.score || 0,
            pick: auto.pick,
          };
        }
      }
    }

    if (!allowAnilist || !WM?.searchAnilistForBulkImport) return null;

    const searchResult = await WM.searchAnilistForBulkImport(item.title, {
      searchPasses: buildAnimeSearchPasses(item),
      year: item.year,
    });
    if (searchResult.transient || !searchResult.ok) return null;
    const scored = scoreCandidates(searchResult.results, probe);
    const auto = autoPickFromScored(scored, probe);
    return {
      contentType: "anime",
      provider: "AniList",
      scored,
      auto,
      topScore: scored[0]?.score || 0,
      pick: auto.pick,
    };
  }

  function pickStrongestTypeCandidate(importedType, candidates) {
    const viable = candidates.filter((c) => c?.pick && c.topScore >= TYPE_VERIFY_STRONG);
    if (!viable.length) return null;
    viable.sort((a, b) => b.topScore - a.topScore);
    const winner = viable[0];
    const runner = viable[1];
    const gap = runner ? winner.topScore - runner.topScore : winner.topScore;
    if (runner && gap < TYPE_VERIFY_CROSS_GAP && winner.topScore < 125) {
      return { ambiguous: true, reason: "Type ambiguous across providers." };
    }
    return { winner, gap };
  }

  function effectiveImportedType(item) {
    if (item.typeCorrectionProvider === "User") return item.contentType;
    if (item.originalType) return item.originalType;
    if (item.typeCorrected) {
      const from = String(item.typeCorrected).split("→")[0]?.trim();
      if (from) return from;
    }
    return item.contentType;
  }

  async function verifyMovieTvContentType(item, primaryScored, primaryAuto) {
    const importedType = effectiveImportedType(item);
    if (importedType === "anime") return null;
    const candidates = [];

    const primaryScore = primaryScored[0]?.score || 0;
    if (primaryAuto.pick) {
      candidates.push({
        contentType: importedType,
        provider: "TMDb",
        scored: primaryScored,
        auto: primaryAuto,
        topScore: primaryScore,
        pick: primaryAuto.pick,
      });
    }

    const primaryStrong =
      primaryAuto.pick && primaryScore >= TYPE_VERIFY_STRONG + 5;

    if (importedType === "tvSeries") {
      if (!primaryStrong) {
        const movie = await scoreTmdbForItem(item, "movie");
        if (movie?.pick) candidates.push(movie);
        const anime = await scoreAnimeForItem(item, { allowAnilist: !primaryAuto.pick });
        if (anime?.pick) candidates.push(anime);
      } else if (primaryScore < 125) {
        const anime = await scoreAnimeForItem(item, { allowAnilist: false });
        if (anime?.pick && anime.topScore > primaryScore + TYPE_VERIFY_CROSS_GAP) {
          candidates.push(anime);
        }
      }
    } else if (importedType === "movies") {
      if (!primaryStrong) {
        const tv = await scoreTmdbForItem(item, "series");
        if (tv?.pick) candidates.push(tv);
      }
    }

    const decision = pickStrongestTypeCandidate(importedType, candidates);
    if (!decision) return null;
    if (decision.ambiguous) return decision;

    const { winner } = decision;
    if (winner.contentType !== importedType) {
      applyTypeCorrection(item, importedType, winner.contentType, {
        reason: winner.auto.reason,
        matchReason: winner.auto.reason,
        confidence: winner.topScore,
        provider: winner.provider,
        score: winner.topScore,
      });
    }
    item.lastProvider = winner.provider;
    return winner;
  }

  function isMisclassifiedItem(item) {
    if (!item || item.status === STATUS.added) return false;
    if (!isMatchVerified(item) && item.status !== STATUS.ready_to_add) return false;

    const imported = item.originalType || item.contentType;
    const pick = item.pick || {};
    const details = item.details || {};

    if (item.correctedType && item.correctedType === item.contentType) {
      if (item.contentType === "anime" && pick.anilistId) return false;
      if (item.contentType === "movies" && (pick.tmdbType === "movie" || details.tmdbType === "movie")) {
        return false;
      }
      if (item.contentType === "tvSeries" && pick.tmdbType === "tv") return false;
    }

    if (imported === "tvSeries" || item.contentType === "tvSeries") {
      if (pick.anilistId) return true;
      if (pick.tmdbType === "movie" || details.tmdbType === "movie") return true;
    }
    if (imported === "anime" && pick.tmdbType === "tv" && !pick.anilistId) return true;
    return false;
  }

  function resetItemForTypeRematch(item) {
    if (!item || item.status === STATUS.added) return false;
    if (!item.originalType) item.originalType = item.contentType;
    const restoreType = item.originalType || item.contentType;
    item.contentType = restoreType;
    item.correctedType = null;
    item.typeCorrected = null;
    item.typeCorrectionProvider = null;
    item.typeCorrectionReason = null;
    item.typeCorrectionUncertain = false;
    item.typeConflictAmbiguous = false;
    item.typeReviewRequired = false;
    item.typeConflictAnime = null;
    item.typeConflictTv = null;
    item.animeProvidersExhausted = false;
    bumpMatchRevision(item);
    item.pick = null;
    item.details = null;
    item.candidates = [];
    item.providerKey = null;
    item.error = "";
    item.failureKind = null;
    clearRetrySchedule(item);
    item.matchStatus = MATCH_STATUS.pending;
    item.metadataStatus = METADATA_STATUS.not_started;
    item.status = STATUS.pending;
    return true;
  }

  function itemTypeEvidenceScore(item) {
    return (
      item.typeCorrectionConfidence ||
      item.details?.typeCorrectionConfidence ||
      item.details?.matchConfidence ||
      0
    );
  }

  async function detectTypeAuditMismatch(item) {
    if (!item || item.status === STATUS.added) return null;

    const imported = effectiveImportedType(item);

    if (
      imported === "anime" &&
      item.typeConflictAmbiguous &&
      item.typeConflictAnime?.anilistId
    ) {
      const tvTitle = item.typeConflictTv?.title || item.typeConflictTv?.pick?.title;
      if (!tvTitle || !importTitleSameWork(item.importedTitle || item.title, tvTitle)) {
        return "anime_spurious_tmdb_conflict";
      }
    }

    if (
      !isMatchVerified(item) &&
      item.status !== STATUS.ready_to_add &&
      item.status !== STATUS.failed
    ) {
      return null;
    }

    if (isMisclassifiedItem(item)) return "provider_pick_mismatch";

    const contentType = item.contentType;

    if (imported === "anime" && contentType === "tvSeries") {
      const anime = await scoreAnimeForItem(item, { allowAnilist: true });
      if (anime?.pick && anime.topScore >= 85) return "anime_imported_corrected_to_tv";
      if (item.pick?.tmdbId && !item.pick?.anilistId) return "anime_imported_corrected_to_tv";
    }

    if (
      imported === "anime" &&
      (item.typeConflictAmbiguous ||
        String(item.error || "").includes("TMDb candidate") ||
        item.lastProvider === "TMDb")
    ) {
      return "anime_tmdb_routing";
    }

    if (contentType !== "tvSeries") return null;
    if (imported !== "tvSeries") return null;

    if (item.pick?.anilistId) {
      return "tv_with_anilist";
    }

    const tvScore = itemTypeEvidenceScore(item);

    const anime = await scoreAnimeForItem(item, { allowAnilist: false });
    if (
      anime?.pick &&
      anime.topScore >= 120 &&
      (!item.pick?.tmdbId ||
        tvScore < TYPE_VERIFY_STRONG ||
        anime.topScore > tvScore + TYPE_VERIFY_CROSS_GAP)
    ) {
      return "anime_stronger";
    }

    const movie = await scoreTmdbForItem(item, "movie");
    if (
      movie?.pick &&
      movie.topScore >= 120 &&
      (!item.pick?.tmdbId ||
        tvScore < TYPE_VERIFY_STRONG ||
        movie.topScore > tvScore + TYPE_VERIFY_CROSS_GAP)
    ) {
      return "movie_stronger";
    }

    return null;
  }

  async function auditMisclassifiedTypes(listId, { autoRetry = true } = {}) {
    const items = loadItems(listId);
    const job = loadJob(listId);
    if (!items || !job) return { found: 0, retried: 0 };
    if ((job.typeAuditVersion || 0) >= TYPE_AUDIT_VERSION) {
      return { found: 0, retried: 0, skipped: true, version: job.typeAuditVersion };
    }

    const retryIds = [];
    const reasons = {};
    for (const item of Object.values(items)) {
      const reason = await detectTypeAuditMismatch(item);
      if (!reason) continue;
      retryIds.push(item.id);
      reasons[item.id] = reason;
      console.warn("[bulk-import:type-audit]", {
        title: item.title,
        contentType: item.contentType,
        originalType: item.originalType,
        status: item.status,
        reason,
        pick: item.pick,
      });
    }

    job.typeAuditVersion = TYPE_AUDIT_VERSION;
    job.typeMismatchAudit = 2;

    if (!retryIds.length) {
      saveJob(listId, job);
      return { found: 0, retried: 0, version: TYPE_AUDIT_VERSION };
    }

    if (!autoRetry) {
      saveJob(listId, job);
      return { found: retryIds.length, retried: 0, ids: retryIds, reasons, version: TYPE_AUDIT_VERSION };
    }

    for (const id of retryIds) {
      resetItemForTypeRematch(items[id]);
    }
    job.paused = false;
    job.status = "processing";
    setJobWorkerLabel(job, "Re-verifying content types…");
    saveProgress(listId, job, items);
    kickImportQueue(listId, { onlyIds: retryIds });
    return {
      found: retryIds.length,
      retried: retryIds.length,
      reasons,
      version: TYPE_AUDIT_VERSION,
    };
  }

  const ADDED_TYPE_AUDIT_VERSION = 3;

  function watchlistHasUserData(watchItem, watchedState = {}) {
    if (!watchItem) return false;
    const entry = watchedState[watchItem.id];
    if (entry) {
      if (entry.rating != null && entry.rating !== "") return true;
      if (entry.note && String(entry.note).trim()) return true;
      if (entry.watched || entry.inProgress) return true;
    }
    if (watchItem.userEdited) return true;
    return false;
  }

  async function detectAddedTypeMismatch(importRow, watchItem) {
    if (!importRow || !watchItem) return null;
    if (importRow.status !== STATUS.added) return null;

    const imported = importRow.originalType || importRow.contentType;
    const effectiveType = watchItem.contentType || importRow.contentType;
    const probe = {
      ...importRow,
      title: watchItem.title || importRow.title,
      year: watchItem.year ?? importRow.year,
      contentType: effectiveType,
    };

    const pickMismatch =
      isMisclassifiedItem(importRow) ||
      !pickMediaTypeMatchesContentType(importRow) ||
      (effectiveType === "tvSeries" && (importRow.pick?.anilistId || watchItem.anilistId));

    if (!pickMismatch && imported === effectiveType && effectiveType !== "tvSeries") {
      return null;
    }
    if (!pickMismatch && imported !== "tvSeries" && effectiveType !== "tvSeries") {
      return null;
    }

    const tvScore = itemTypeEvidenceScore(importRow);
    const candidates = [];

    if (importRow.pick?.anilistId || watchItem.anilistId) {
      candidates.push({
        contentType: "anime",
        provider: "AniList",
        topScore: Math.max(tvScore, TYPE_VERIFY_STRONG + 10),
        pick: importRow.pick?.anilistId
          ? importRow.pick
          : {
              source: "anilist",
              anilistId: watchItem.anilistId,
              title: watchItem.title,
              year: watchItem.year || "",
              type: "anime",
            },
        auto: { reason: "anilist_id_on_tv_row" },
      });
    }

    const anime = await scoreAnimeForItem(probe, { allowAnilist: false });
    if (anime?.pick && anime.topScore >= 120) {
      candidates.push({ contentType: "anime", ...anime });
    }

    const movie = await scoreTmdbForItem(probe, "movie");
    if (movie?.pick && movie.topScore >= 120) {
      candidates.push({ contentType: "movies", ...movie });
    }

    if (!candidates.length) return null;

    const viable = candidates.filter((c) => c?.pick && c.topScore >= TYPE_VERIFY_STRONG);
    if (!viable.length) return null;
    viable.sort((a, b) => b.topScore - a.topScore);
    const winner = viable[0];
    const runner = viable[1];
    const gap = runner ? winner.topScore - runner.topScore : winner.topScore;

    if (
      effectiveType === winner.contentType &&
      pickMediaTypeMatchesContentType({ ...importRow, contentType: winner.contentType })
    ) {
      return null;
    }

    if (runner && gap < TYPE_VERIFY_CROSS_GAP && winner.topScore < 125) {
      return {
        action: "flag",
        toType: winner.contentType,
        reason: "ambiguous_type_evidence",
        winner,
        candidates: viable,
      };
    }

    if (
      winner.topScore > tvScore + TYPE_VERIFY_CROSS_GAP ||
      tvScore < TYPE_VERIFY_STRONG ||
      !pickMediaTypeMatchesContentType(importRow)
    ) {
      if (imported === "anime" && winner.contentType === "tvSeries") {
        return null;
      }
      return {
        action: "correct",
        toType: winner.contentType,
        reason: winner.auto?.reason || "stronger_provider_type",
        winner,
        provider: winner.provider,
        pick: winner.pick,
        topScore: winner.topScore,
      };
    }

    return null;
  }

  function isImportAuditDebugEnabled() {
    try {
      return localStorage.getItem("watchlist-debug-import-audit") === "1";
    } catch {
      return false;
    }
  }

  async function auditAddedWatchlistTypes(listId, { getWatchlistItem, getWatchedState } = {}) {
    const items = loadItems(listId);
    const job = loadJob(listId);
    if (!items || !job) return { corrected: 0, flagged: 0, actions: [] };
    if ((job.addedTypeCorrectionsVersion || 0) >= ADDED_TYPE_AUDIT_VERSION) {
      return { corrected: 0, flagged: 0, skipped: true, actions: [] };
    }

    const watchedState = getWatchedState?.() || {};
    const actions = [];
    for (const row of Object.values(items)) {
      if (row.status !== STATUS.added || !row.watchlistItemId) continue;
      const watchItem = getWatchlistItem?.(row.watchlistItemId);
      if (!watchItem) continue;

      const mismatch = await detectAddedTypeMismatch(row, watchItem);
      if (!mismatch) continue;

      mismatch.importRowId = row.id;
      mismatch.watchlistItemId = row.watchlistItemId;
      mismatch.hasUserData = watchlistHasUserData(watchItem, watchedState);
      actions.push(mismatch);

      if (isImportAuditDebugEnabled()) {
        console.warn("[bulk-import:added-type-audit]", {
          title: watchItem.title || row.title,
          action: mismatch.action,
          toType: mismatch.toType,
          reason: mismatch.reason,
          provider: mismatch.provider,
          hasUserData: mismatch.hasUserData,
        });
      }
    }

    return {
      actions,
      corrected: actions.filter((a) => a.action === "correct").length,
      flagged: actions.filter((a) => a.action === "flag").length,
    };
  }

  function markAddedTypeCorrectionsApplied(listId) {
    const job = loadJob(listId);
    if (!job) return;
    job.addedTypeCorrectionsVersion = ADDED_TYPE_AUDIT_VERSION;
    saveJob(listId, job);
  }

  function recordImportTypeCorrection(importRow, fromType, toType, meta = {}) {
    if (!importRow) return;
    if (!importRow.originalType) importRow.originalType = fromType;
    importRow.correctedType = toType;
    importRow.contentType = toType;
    importRow.typeCorrectionReason = meta.reason || "";
    importRow.typeCorrectionConfidence = meta.confidence ?? meta.topScore ?? null;
    importRow.typeCorrectionProvider = meta.provider || "";
    if (meta.pick) {
      importRow.pick = meta.pick;
      importRow.providerKey = providerKeyFromPick(meta.pick, toType);
      importRow.lastProvider = meta.provider || providerForItem(importRow);
      importRow.finalProvider = importRow.lastProvider;
      importRow.finalProviderId = importRow.providerKey;
    } else if (importRow.providerKey) {
      importRow.finalProvider = importRow.lastProvider || providerForItem(importRow);
      importRow.finalProviderId = importRow.providerKey;
    }
  }

  async function fetchDetailsForPick(pick, item) {
    const WM = window.WatchlistMetadata;
    if (!WM?.getDetailsForPick) return null;
    const preferAnime = item.contentType === "anime";
    let details = null;
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        details = await WM.getDetailsForPick(pick, {
          searchQuery: item.title,
          preferAnime,
        });
        if (details?.title) break;
      } catch (error) {
        lastError = error;
        console.warn("[bulk-import:details]", {
          title: item.title,
          attempt,
          pick,
          message: String(error?.message || error),
        });
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 800 * attempt));
        }
      }
    }
    if (!details?.title && lastError) {
      console.warn("[bulk-import:details] exhausted", {
        title: item.title,
        pick,
        message: String(lastError?.message || lastError),
      });
    }
    if (preferAnime && details) {
      details = await WM.ensureAnimeDetails(details, {
        pick,
        preferAnime: true,
        forceAnime: true,
      });
    }
    return details;
  }

  async function retryStoredPickDetails(item) {
    if (!item.pick) return false;
    item.lastProvider = providerForItem(item);
    const WM = window.WatchlistMetadata;
    let details =
      WM?.getLightweightDetailsForPick?.(item.pick, {
        contentType: item.contentType,
        importTitle: item.title,
      }) || null;
    if (!details?.title) {
      details = await fetchDetailsForPick(item.pick, item);
    }
    if (!details?.title) {
      item.retries = (item.retries || 0) + 1;
      if (item.retries < MAX_TRANSIENT_RETRIES) {
        item.status = STATUS.pending;
        syncRetrySchedule(
          item,
          Date.now() +
            Math.min(60000, 1500 * Math.pow(2, item.retries)) +
            ((item.line || 0) % 5) * RETRY_STAGGER_MS,
          `Provider details unavailable — retry ${item.retries}/${MAX_TRANSIENT_RETRIES}`
        );
        item.failureKind = FAILURE_KIND.provider;
        item.error = item.waitingReason;
        appendRetryHistory(item, {
          status: STATUS.pending,
          kind: FAILURE_KIND.provider,
          message: item.error,
          provider: item.lastProvider,
          retries: item.retries,
        });
        return true;
      }
      item.status = STATUS.failed;
      setItemFailure(
        item,
        FAILURE_KIND.provider,
        "Provider details unavailable.",
        item.lastProvider
      );
      return false;
    }
    item.details = details;
    item.needsEnrichment = !details.plot;
    item.status = STATUS.ready_to_add;
    item.error = "";
    item.failureKind = null;
    item.waiting = false;
    return true;
  }

  function detailsContentTypeMatches(details, contentType) {
    const ct = details.contentType || details.mediaType || "";
    if (contentType === "anime") {
      return ct === "anime" || details.anilistId;
    }
    if (contentType === "movies") {
      return ct === "movies" || details.omdbType === "movie" || details.mediaType === "movie";
    }
    if (contentType === "tvSeries") {
      return ct === "tvSeries" || details.omdbType === "series" || details.mediaType === "series";
    }
    return false;
  }

  function buildPickFromDetails(details) {
    if (!details) return null;
    if (details.anilistId) {
      return {
        source: "anilist",
        anilistId: details.anilistId,
        title: details.title,
        year: details.year,
        type: "anime",
      };
    }
    if (details.tmdbId) {
      return {
        source: "tmdb",
        tmdbId: details.tmdbId,
        tmdbType: details.tmdbType || (details.mediaType === "series" ? "tv" : "movie"),
        imdbId: details.imdbId || null,
        title: details.title,
        year: details.year,
        type: details.tmdbType === "tv" ? "series" : "movie",
      };
    }
    if (details.imdbId) {
      return {
        source: "imdb",
        imdbId: details.imdbId,
        title: details.title,
        year: details.year,
        type: details.omdbType === "series" ? "series" : "movie",
      };
    }
    return null;
  }

  function validateDetailsAgainstItem(details, item) {
    if (!detailsContentTypeMatches(details, item.contentType)) {
      return { ok: false, reason: "type_mismatch", score: 0 };
    }
    const titlePart = titleScore(item.title, details.title);
    const yearPart = yearScore(item.year, details.year);
    const score = titlePart + yearPart;
    if (titlePart < 80) {
      return { ok: false, reason: "title_mismatch", score, titlePart };
    }
    if (item.year != null && yearPart < -10) {
      return { ok: false, reason: "year_mismatch", score, yearPart };
    }
    return { ok: true, score, titlePart, yearPart };
  }

  async function matchFromProviderUrl(item, job, providerIds) {
    const url = String(item.providerUrl || "").trim();
    if (!url) return false;

    const WM = window.WatchlistMetadata;
    if (!WM) return false;

    logBulkMatch(item, { path: "provider_url_hint", providerUrl: url, requestedType: item.contentType });

    const anilistId = WM.extractAnilistId?.(url);
    const imdbId = WM.extractImdbId?.(url);
    let pick = null;

    if (item.contentType === "anime" && anilistId) {
      pick = {
        source: "anilist",
        anilistId: Number(anilistId),
        title: item.title,
        year: item.year != null ? String(item.year) : "",
        type: "anime",
      };
    } else if (imdbId && (item.contentType === "movies" || item.contentType === "tvSeries")) {
      pick = {
        source: "imdb",
        imdbId,
        title: item.title,
        year: item.year != null ? String(item.year) : "",
        type: item.contentType === "tvSeries" ? "series" : "movie",
      };
    } else {
      return false;
    }

    const cached = WM.getCachedDetailsForPick?.(pick);
    if (cached?.title) {
      const check = validateDetailsAgainstItem(cached, item);
      if (check.ok || check.titlePart >= 65) {
        item.lastProvider = item.contentType === "anime" ? "AniList" : "TMDb";
        applyLightweightDetails(item, pick, {
          ...cached,
          enrichmentDeferred: !cached.plot,
        });
        const pKey = providerKeyFromPick(pick, item.contentType);
        if (pKey && providerIds[pKey]) {
          item.status = STATUS.duplicate;
          item.error = "Same provider ID already matched in this import.";
          item.pick = null;
          return false;
        }
        item.providerKey = pKey;
        if (pKey) providerIds[pKey] = item.id;
        item.status = STATUS.ready_to_add;
        item.error = "";
        return true;
      }
    }

    const lightweight = WM.getLightweightDetailsForPick?.(pick, {
      contentType: item.contentType,
      importTitle: item.title,
    });
    if (lightweight?.title) {
      const check = validateDetailsAgainstItem(lightweight, item);
      if (check.ok || check.titlePart >= 55) {
        item.lastProvider = item.contentType === "anime" ? "AniList" : "TMDb";
        return finalizeMatchPick(item, pick, job, providerIds);
      }
    }

    logBulkMatch(item, { rejection: "url_hint_weak", providerUrl: url });
    return false;
  }

  async function tryWesternTvFallback(item, job, providerIds) {
    if (effectiveImportedType(item) === "anime") return false;
    const WM = window.WatchlistMetadata;
    if (!WM?.searchTitles) return false;

    const result = await WM.searchTitles(item.title, { type: "series", page: 1 });
    if (!result?.ok || !result.results?.length) return false;

    const tvItem = { ...item, contentType: "tvSeries" };
    const scored = scoreCandidates(result.results, tvItem);
    const auto = autoPickFromScored(scored, tvItem);

    logBulkMatch(item, {
      path: "cross_provider_tv_fallback",
      topScore: scored[0]?.score,
      autoPick: auto.pick?.title,
      rejection: auto.reason,
    });

    if (!auto.pick || (scored[0]?.score || 0) < 110) return false;

    const gap = scored[1] ? scored[0].score - scored[1].score : scored[0].score;
    if (gap < 12 && scored.length > 1) return false;

    applyTypeCorrection(item, item.originalType || item.contentType, "tvSeries", {
      reason: auto.reason,
      matchReason: auto.reason,
      confidence: scored[0]?.score,
      provider: "TMDb",
    });
    item.lastProvider = "TMDb";
    return finalizeMatchPick(item, auto.pick, job, providerIds);
  }

  async function tryAnimeFallback(item, job, providerIds) {
    const anime = await scoreAnimeForItem(item, { allowAnilist: true });
    if (!anime?.pick || anime.topScore < 120) return false;

    logBulkMatch(item, {
      path: "cross_provider_anime_fallback",
      topScore: anime.topScore,
      rejection: anime.auto.reason,
    });

    applyTypeCorrection(item, item.originalType || item.contentType, "anime", {
      reason: anime.auto.reason,
      matchReason: anime.auto.reason,
      confidence: anime.topScore,
      provider: anime.provider,
    });
    item.lastProvider = anime.provider;
    return finalizeMatchPick(item, anime.pick, job, providerIds);
  }

  async function tryMovieFallback(item, job, providerIds) {
    const movie = await scoreTmdbForItem(item, "movie");
    if (!movie?.pick || movie.topScore < 115) return false;

    logBulkMatch(item, {
      path: "cross_provider_movie_fallback",
      topScore: movie.topScore,
      rejection: movie.auto.reason,
    });

    applyTypeCorrection(item, item.originalType || item.contentType, "movies", {
      reason: movie.auto.reason,
      matchReason: movie.auto.reason,
      confidence: movie.topScore,
      provider: "TMDb",
    });
    item.lastProvider = "TMDb";
    return finalizeMatchPick(item, movie.pick, job, providerIds);
  }

  async function tryTvSeriesFallback(item, job, providerIds) {
    const tv = await scoreTmdbForItem(item, "series");
    if (!tv?.pick || tv.topScore < 110) return false;

    const gap = tv.scored[1] ? tv.topScore - tv.scored[1].score : tv.topScore;
    if (gap < 10 && tv.scored.length > 1) return false;

    logBulkMatch(item, {
      path: "cross_provider_tv_fallback",
      topScore: tv.topScore,
      rejection: tv.auto.reason,
    });

    applyTypeCorrection(item, item.originalType || item.contentType, "tvSeries", {
      reason: tv.auto.reason,
      matchReason: tv.auto.reason,
      confidence: tv.topScore,
      provider: "TMDb",
    });
    item.lastProvider = "TMDb";
    return finalizeMatchPick(item, tv.pick, job, providerIds);
  }

  function handleTransientFailure(item, searchResult) {
    if (isMatchVerified(item)) {
      item.metadataStatus = METADATA_STATUS.temporary_failure;
      return;
    }
    item.lastProvider = "AniList";
    const retryAfterHdr = searchResult.retryAfter
      ? parseInt(String(searchResult.retryAfter), 10) * 1000
      : 0;
    const kind = searchResult.rateLimited
      ? FAILURE_KIND.rate_limit
      : searchResult.networkError
        ? FAILURE_KIND.network
        : FAILURE_KIND.transient;

    if (searchResult.rateLimited) {
      item.rateLimitRetries = (item.rateLimitRetries || 0) + 1;
      const gate = window.WatchlistMetadata?.getAnilistQueueStatus?.();
      const retryAt =
        gate?.resumeAt ||
        Date.now() +
          Math.max(
            retryAfterHdr || 0,
            Math.min(120000, 2500 * Math.pow(1.6, item.rateLimitRetries - 1))
          );
      syncRetrySchedule(item, retryAt, "AniList rate limit — resuming automatically");
      setMatchStatus(item, MATCH_STATUS.pending);
      item.failureKind = kind;
      item.error = item.waitingReason;
      appendRetryHistory(item, {
        status: STATUS.pending,
        kind,
        message: item.error,
        provider: "AniList",
        retries: item.rateLimitRetries,
      });
      return;
    }

    item.retries = (item.retries || 0) + 1;
    const backoff = Math.min(90000, 1200 * Math.pow(2, item.retries - 1));
    const stagger = ((item.line || 0) % 7) * RETRY_STAGGER_MS;
    syncRetrySchedule(
      item,
      Date.now() + Math.max(backoff, retryAfterHdr || 0) + stagger,
      `Waiting for ${item.lastProvider || "provider"} — temporary error`
    );

    if (item.retries >= MAX_TRANSIENT_RETRIES) {
      item.status = STATUS.failed;
      item.waiting = false;
      setItemFailure(
        item,
        kind,
        "Temporary provider error — use Resolve remaining.",
        "AniList"
      );
    } else {
      item.status = STATUS.pending;
      item.failureKind = kind;
      item.error = `${item.waitingReason} (retry ${item.retries}/${MAX_TRANSIENT_RETRIES})`;
      appendRetryHistory(item, {
        status: STATUS.pending,
        kind,
        message: item.error,
        provider: "AniList",
        retries: item.retries,
      });
    }
  }

  function applyLightweightDetails(item, pick, details) {
    if (!details?.title) return false;
    details.enrichmentDeferred = !details.plot;
    item.pick = pick;
    item.details = details;
    item.needsEnrichment = Boolean(details.enrichmentDeferred);
    return true;
  }

  async function finalizeMatchPick(item, pick, job, providerIds) {
    const revision = item.matchRevision || 0;
    const pKey = providerKeyFromPick(pick, item.contentType);
    if (pKey && providerIds[pKey] && providerIds[pKey] !== item.id) {
      markDuplicate(
        item,
        DUPLICATE_CATEGORY.provider_id,
        "",
        "Same provider ID already matched in this import."
      );
      return false;
    }

    let details = null;
    const WM = window.WatchlistMetadata;
    const isAnimePick =
      item.contentType === "anime" || pick.anilistId || pick.source === "anilist";

    if (isAnimePick && WM?.resolveDetailsForWatchlistAdd) {
      const bypassPosterCache = (item.posterRetries || 0) > 0;
      details = await WM.resolveDetailsForWatchlistAdd(pick, item.contentType, {
        searchQuery: item.title,
        pipeline: "bulk-verify",
        posterRequired: true,
        verifyPoster: false,
        bypassCache: bypassPosterCache,
        forceLive: bypassPosterCache,
      });
    } else if (isAnimePick) {
      details = await fetchDetailsForPick(pick, item);
    } else {
      details = buildMinimalDetailsFromPick(pick, item);
      if (!details?.title || (!details?.poster && !details?.plot)) {
        details = await fetchDetailsForPick(pick, item);
      }
    }

    if (!details?.title) {
      details = buildMinimalDetailsFromPick(pick, item);
    }

    if (isAnimePick && details?.title && !details?.poster) {
      details = await WM.ensureAnimePosterOnDetails?.(details, {
        pick,
        required: true,
        bypassCache: true,
        forceLive: true,
        reason: "provider_cache_missing_poster",
      });
    }

    if (isAnimePick && details?.title && !details?.poster) {
      item.pick = pick;
      item.details = details;
      item.posterRetries = (item.posterRetries || 0) + 1;
      const retryAt =
        Date.now() +
        Math.min(60000, 1500 * Math.pow(2, item.posterRetries)) +
        ((item.line || 0) % 5) * RETRY_STAGGER_MS;
      const posterReason = formatPosterRetryReason(retryAt);
      if (item.posterRetries < MAX_POSTER_FETCH_RETRIES) {
        setMatchStatus(item, MATCH_STATUS.pending);
        item.status = STATUS.waiting_poster;
        item.waiting = true;
        syncRetrySchedule(item, retryAt, posterReason);
        item.failureKind = null;
        item.error = "Fetching anime poster";
        item.metadataStatus = METADATA_STATUS.metadata_waiting;
        return false;
      }
      setMatchStatus(item, MATCH_STATUS.needs_attention);
      item.status = STATUS.failed;
      setItemFailure(
        item,
        FAILURE_KIND.provider,
        "AniList cover fetch failed",
        providerForItem(item)
      );
      item.metadataStatus = METADATA_STATUS.permanent_failure;
      return false;
    }

    if (!details?.title) {
      if (isMatchVerified(item)) {
        item.metadataStatus = METADATA_STATUS.temporary_failure;
        return true;
      }
      item.pick = pick;
      item.retries = (item.retries || 0) + 1;
      if (item.retries < MAX_TRANSIENT_RETRIES) {
        setMatchStatus(item, MATCH_STATUS.pending);
        syncRetrySchedule(
          item,
          Date.now() +
            Math.min(60000, 1500 * Math.pow(2, item.retries)) +
            ((item.line || 0) % 5) * RETRY_STAGGER_MS,
          `Provider details unavailable — retry ${item.retries}/${MAX_TRANSIENT_RETRIES}`
        );
        item.failureKind = FAILURE_KIND.provider;
        item.error = item.waitingReason;
        item.metadataStatus = METADATA_STATUS.temporary_failure;
        appendRetryHistory(item, {
          status: STATUS.pending,
          kind: FAILURE_KIND.provider,
          message: item.error,
          provider: providerForItem(item),
          retries: item.retries,
        });
        return false;
      }
      setMatchStatus(item, MATCH_STATUS.needs_attention);
      item.status = STATUS.failed;
      setItemFailure(
        item,
        FAILURE_KIND.provider,
        "Provider details unavailable.",
        providerForItem(item)
      );
      item.metadataStatus = METADATA_STATUS.permanent_failure;
      return false;
    }

    if (!canApplyMatchUpdate(item, revision)) return false;
    return setMatchVerified(item, pick, details, job, providerIds);
  }

  async function matchAnimeItem(item, job, providerIds, preloadedSearch) {
    if (isMatchVerified(item)) return;
    const WM = window.WatchlistMetadata;
    item.lastProvider = "AniList";
    setJobWorkerLabel(job, "Searching anime index…", item.id);
    if (!WM?.searchAnilistForBulkImport && !WM?.searchAnimeOfflineIndex) {
      item.status = STATUS.failed;
      setItemFailure(item, FAILURE_KIND.other, "Anime search is not configured.", "AniList");
      return;
    }

    if (WM?.lookupCachedAnilistMatch) {
      const cached = WM.lookupCachedAnilistMatch(item.title, {
        year: item.year,
        searchPasses: buildAnimeSearchPasses(item),
      });
      if (cached?.pick) {
        await finalizeMatchPick(item, cached.pick, job, providerIds);
        if (isMatchVerified(item)) return;
      }
    }

    if (WM?.searchAnimeOfflineIndex) {
      const offline = await WM.searchAnimeOfflineIndex(item.title, {
        year: item.year,
        searchPasses: buildAnimeSearchPasses(item),
      });
      if (offline?.ok && offline.pick) {
        await finalizeMatchPick(item, offline.pick, job, providerIds);
        if (isMatchVerified(item)) return;
      }
      if (offline?.ok && offline.results?.length) {
        const scored = scoreCandidates(offline.results, item);
        const auto = autoPickFromScored(scored, item);
        const topScore = scored[0]?.score || 0;
        if (auto.pick && topScore >= 95) {
          await finalizeMatchPick(item, auto.pick, job, providerIds);
          if (isMatchVerified(item)) return;
        }
      }
    }

    if (!WM?.searchAnilistForBulkImport) {
      item.status = STATUS.failed;
      setItemFailure(item, FAILURE_KIND.other, "Anime search is not configured.", "AniList");
      return;
    }

    let searchResult = preloadedSearch;
    if (!searchResult) {
      setJobWorkerLabel(job, "Waiting for AniList…", item.id);
      const searchPasses = buildAnimeSearchPasses(item);
      searchResult = await WM.searchAnilistForBulkImport(item.title, {
        searchPasses,
        year: item.year,
      });
    }

    logBulkMatch(item, {
      batched: Boolean(preloadedSearch),
      passes: buildAnimeSearchPasses(item),
      httpStatus: searchResult.httpStatus,
      rateLimited: searchResult.rateLimited,
      graphqlErrors: searchResult.errors,
      candidateCount: searchResult.results?.length || 0,
      candidates: (searchResult.results || []).slice(0, 5).map((c) => ({
        id: c.anilistId,
        english: c.titleEnglish,
        romaji: c.titleRomaji,
        native: c.titleNative,
        synonyms: (c.synonyms || []).slice(0, 4),
        year: c.year,
        format: c.format,
      })),
    });

    if (searchResult.transient) {
      handleTransientFailure(item, searchResult);
      logBulkMatch(item, {
        rejection: item.error,
        transient: true,
      });
      return;
    }

    if (!searchResult.ok) {
      item.status = STATUS.failed;
      setItemFailure(item, FAILURE_KIND.provider, "AniList search failed.", "AniList");
      return;
    }

    const scored = scoreCandidates(searchResult.results, item);
    const auto = autoPickFromScored(scored, item);

    logBulkMatch(item, {
      topScores: scored.slice(0, 3).map((s) => ({
        id: s.result.anilistId,
        score: s.score,
        titlePart: s.titlePart,
        yearPart: s.yearPart,
        reason: s.reason,
        title: s.result.title,
      })),
      autoPick: auto.pick?.anilistId || null,
      rejection: auto.pick ? null : auto.reason,
    });

    const topScore = scored[0]?.score || 0;
    const boostedAnimeScore = animeEvidenceScore(topScore, item);
    let pick = auto.pick;
    let pickReason = auto.reason;
    const animeProviderLabel = preloadedSearch ? "AniList" : "AniList";

    if (
      !pick &&
      effectiveImportedType(item) === "anime" &&
      scored[0] &&
      item.year != null &&
      scored[0].titlePart >= 80 &&
      scored[0].yearPart >= 10
    ) {
      pick = scored[0].result;
      pickReason = "imported_anime_year_match";
    }

    if (
      !pick &&
      effectiveImportedType(item) === "anime" &&
      scored[0] &&
      scored[0].titlePart >= 100 &&
      scored.length === 1
    ) {
      pick = scored[0].result;
      pickReason = "imported_anime_single_candidate";
    }

    if (pick && (topScore >= 95 || pickReason === "imported_anime_year_match" || pickReason === "imported_anime_single_candidate")) {
      await finalizeMatchPick(item, pick, job, providerIds);
      return;
    }

    if (effectiveImportedType(item) === "anime") {
      const tv = await scoreTmdbForItem({ ...item, contentType: "tvSeries" }, "series");
      const tvScore = tv?.topScore || 0;
      const animeCand = animeCandidateFromScored(
        scored,
        item,
        pick,
        boostedAnimeScore,
        animeProviderLabel
      );
      const tvCand =
        tv?.pick && tvScore >= 110
          ? { pick: tv.pick, score: tvScore, tmdbId: tv.pick.tmdbId }
          : null;
      const tvRival = Boolean(
        tvCand && isTmdbRivalForImportedAnime(item, tvCand.pick, tvScore)
      );

      const animeStrong = Boolean(animeCand) && (animeCand.score ?? 0) >= 100;
      const animeModerate = Boolean(animeCand) && (animeCand.score ?? 0) >= 88;
      const animeYearOk =
        item.year == null || (scored[0]?.yearPart ?? 0) >= 10;
      const tvStrong = tvRival;

      if (animeStrong && (!tvStrong || (animeCand.score ?? 0) >= tvScore)) {
        await finalizeMatchPick(item, pick || animeCand.pick, job, providerIds);
        return;
      }

      if (animeModerate && animeYearOk && !tvStrong) {
        await finalizeMatchPick(item, pick || animeCand.pick, job, providerIds);
        return;
      }

      if (isCommonShortTitle(item.title) && (animeModerate || tvStrong)) {
        flagAnimeTvTypeConflict(item, {
          anime: animeCand,
          tv: tvCand,
          reason: "common_title_collision",
        });
        return;
      }

      if (animeModerate && tvStrong) {
        flagAnimeTvTypeConflict(item, {
          anime: animeCand,
          tv: tvCand,
          reason: "strong_both_providers",
        });
        return;
      }

      if (animeModerate && !tvStrong) {
        await finalizeMatchPick(item, pick || animeCand.pick, job, providerIds);
        return;
      }

      if (canAutoCorrectAnimeToTv(item, boostedAnimeScore, tvScore) && tv?.pick) {
        flagAnimeTvTypeConflict(item, {
          anime: animeCand,
          tv: tvCand,
          reason: "anime_providers_failed_tv_available",
        });
        return;
      }

      if (tvStrong) {
        flagAnimeTvTypeConflict(item, {
          anime: animeCand,
          tv: tvCand,
          reason: scored.length ? "anime_weak_tv_strong" : "anime_not_found_tv_present",
        });
        return;
      }
    }

    if (!pick) {
      setMatchStatus(item, MATCH_STATUS.not_found);
      item.status = STATUS.not_found;
      const kind = String(auto.reason || "").includes("low_confidence")
        ? FAILURE_KIND.low_confidence
        : FAILURE_KIND.not_found;
      setItemFailure(item, kind, auto.reason || "No reliable match.", "AniList");
      item.pick = null;
      item.details = null;
      item.candidates = [];
      return;
    }

    await finalizeMatchPick(item, pick, job, providerIds);
  }

  async function matchMovieTvItem(item, job, providerIds) {
    if (isMatchVerified(item)) return;
    const WM = window.WatchlistMetadata;
    item.lastProvider = "TMDb";
    if (!WM?.searchTitles) {
      item.status = STATUS.failed;
      setItemFailure(item, FAILURE_KIND.other, "Search is not configured.", "TMDb");
      return;
    }

    const searchType = pickSearchType(item.contentType);
    const tmdb = await searchTmdbScoredForItem(item, searchType);
    if (tmdb.apiFailed) {
      item.retries = (item.retries || 0) + 1;
      if (item.retries < MAX_TRANSIENT_RETRIES) {
        item.status = STATUS.pending;
        syncRetrySchedule(
          item,
          Date.now() +
            Math.min(45000, 1200 * Math.pow(2, item.retries)) +
            ((item.line || 0) % 5) * RETRY_STAGGER_MS,
          `Waiting for provider — retry ${item.retries}/${MAX_TRANSIENT_RETRIES}`
        );
        item.failureKind = FAILURE_KIND.transient;
        item.error = item.waitingReason;
        appendRetryHistory(item, {
          status: STATUS.pending,
          kind: FAILURE_KIND.transient,
          message: item.error,
          provider: "TMDb",
          retries: item.retries,
        });
      } else {
        item.status = STATUS.failed;
        setItemFailure(item, FAILURE_KIND.transient, "Search failed.", "TMDb");
      }
      return;
    }

    const scored = tmdb.scored;
    const auto = tmdb.auto;

    const verified =
      item.typeCorrectionProvider === "User"
        ? auto.pick
          ? {
              contentType: item.contentType,
              provider: "TMDb",
              scored,
              auto,
              topScore: tmdb.topScore,
              pick: auto.pick,
            }
          : null
        : await verifyMovieTvContentType(item, scored, auto);
    if (verified?.ambiguous) {
      item.typeConflictAmbiguous = true;
      item.typeReviewRequired = true;
      item.status = STATUS.failed;
      setItemFailure(
        item,
        FAILURE_KIND.low_confidence,
        verified.reason || "Type ambiguous across providers.",
        "TMDb"
      );
      item.pick = null;
      item.details = null;
      item.candidates = [];
      setMatchStatus(item, MATCH_STATUS.needs_attention);
      return;
    }
    if (verified?.pick) {
      await finalizeMatchPick(item, verified.pick, job, providerIds);
      return;
    }

    if (!auto.pick) {
      if (item.contentType === "tvSeries") {
        if (await tryAnimeFallback(item, job, providerIds)) return;
        if (await tryMovieFallback(item, job, providerIds)) return;
      } else if (item.contentType === "movies") {
        if (await tryTvSeriesFallback(item, job, providerIds)) return;
      }

      item.status = STATUS.not_found;
      const kind = String(auto.reason || "").includes("low_confidence")
        ? FAILURE_KIND.low_confidence
        : FAILURE_KIND.not_found;
      setItemFailure(item, kind, auto.reason || "No reliable match.", "TMDb");
      item.pick = null;
      item.details = null;
      item.candidates = [];
      return;
    }

    await finalizeMatchPick(item, auto.pick, job, providerIds);
  }

  async function matchOneItem(item, job, items, providerIds) {
    if (isMatchVerified(item)) return;
    const revision = bumpMatchRevision(item);
    item.matchStatus = MATCH_STATUS.matching;
    item.status = STATUS.processing;
    item.processingSince = Date.now();
    item.error = "";
    item.waiting = false;

    try {
      if (item.pick && !item.details?.title && !isMatchVerified(item)) {
        await retryStoredPickDetails(item);
        if (isMatchVerified(item)) return;
        if (item.status === STATUS.ready_to_add) return;
        if (item.status === STATUS.pending || item.status === STATUS.failed) return;
      }

      if (await matchFromProviderUrl(item, job, providerIds)) {
        return;
      }

      if (item.contentType === "anime") {
        await matchAnimeItem(item, job, providerIds);
      } else {
        await matchMovieTvItem(item, job, providerIds);
      }
    } catch (error) {
      if (isMatchVerified(item)) return;
      if (!canApplyMatchUpdate(item, revision)) return;
      item.retries = (item.retries || 0) + 1;
      const kind = FAILURE_KIND.network;
      if (item.retries < MAX_TRANSIENT_RETRIES) {
        item.status = STATUS.pending;
        syncRetrySchedule(
          item,
          Date.now() +
            Math.min(60000, 1500 * Math.pow(2, item.retries)) +
            ((item.line || 0) % 5) * RETRY_STAGGER_MS,
          `Waiting for network — retry ${item.retries}/${MAX_TRANSIENT_RETRIES}`
        );
        item.failureKind = kind;
        item.error = item.waitingReason;
        appendRetryHistory(item, {
          status: STATUS.pending,
          kind,
          message: item.error,
          provider: providerForItem(item),
          retries: item.retries,
        });
      } else {
        item.status = STATUS.failed;
        setItemFailure(item, kind, String(error?.message || error), providerForItem(item));
      }
    } finally {
      touchRetryProgress(job, item);
    }
  }

  async function runPool(queue, worker, limit) {
    const executing = new Set();
    for (const entry of queue) {
      if (paused) break;
      const p = Promise.resolve()
        .then(() => worker(entry))
        .catch((error) => {
          console.warn("[bulk-import:worker]", {
            title: entry?.title,
            message: String(error?.message || error),
          });
        });
      executing.add(p);
      const clean = () => executing.delete(p);
      p.then(clean, clean);
      if (executing.size >= limit) {
        await Promise.race(executing);
      }
    }
    await Promise.allSettled(executing);
  }

  async function applyAnimeGrouping(listId, items) {
    const SM = window.WatchlistSeriesMetadata;
    if (!SM?.buildBatchFranchiseRootMapFromCache) return;

    const animeReady = [];
    for (const it of Object.values(items || {})) {
      if (it.contentType !== "anime") continue;
      if (!isMatchVerified(it)) continue;
      if (it.status === STATUS.duplicate || it.status === STATUS.cancelled) continue;
      const anilistId = Number(it.details?.anilistId || it.pick?.anilistId);
      if (!Number.isFinite(anilistId)) continue;
      if (!it.details) it.details = {};
      if (!it.details.anilistId) it.details.anilistId = anilistId;
      if (!it.pick?.anilistId) {
        it.pick = { ...(it.pick || {}), anilistId, source: "anilist" };
      }
      animeReady.push(it);
    }

    if (animeReady.length < 2) {
      await applyAnimeWatchlistGrouping(listId, items);
      return;
    }

    const idToRoot = SM.buildBatchFranchiseRootMapFromCache(
      animeReady.map((it) => Number(it.details?.anilistId))
    );

    const roots = new Map();
    for (const item of animeReady) {
      const anilistId = Number(item.details?.anilistId);
      const rootAnilistId = idToRoot.get(anilistId);
      if (!rootAnilistId) continue;
      const gKey = String(rootAnilistId);
      if (!roots.has(gKey)) {
        const cachedRoot = SM.readFranchiseRootCacheEntry?.(rootAnilistId);
        roots.set(gKey, {
          rootAnilistId,
          rootTitle: cachedRoot?.rootTitle || "",
          members: [],
        });
      }
      roots.get(gKey).members.push(item);
    }

    for (const group of roots.values()) {
      if (group.members.length < 2) continue;

      let primary =
        group.members.find(
          (m) => Number(m.details?.anilistId) === group.rootAnilistId
        ) || null;

      if (!primary) {
        group.members.sort((a, b) => {
          const ya = a.year ?? 9999;
          const yb = b.year ?? 9999;
          return ya - yb;
        });
        primary = group.members[0];
        const WM = window.WatchlistMetadata;
        if (group.rootAnilistId) {
          const pick = {
            source: "anilist",
            anilistId: group.rootAnilistId,
            title: group.rootTitle || primary.title,
          };
          let rootDetails = WM?.getLightweightDetailsForPick?.(pick, {
            contentType: "anime",
          });
          if (!rootDetails?.plot && WM?.fetchAnilistById) {
            rootDetails = await WM.fetchAnilistById(group.rootAnilistId);
          }
          if (rootDetails?.title) {
            primary.details = rootDetails;
            primary.pick = { anilistId: group.rootAnilistId, source: "anilist" };
            primary.needsEnrichment = !rootDetails.plot;
          }
        }
      }

      const groupId = primary.id;
      primary.groupId = groupId;
      primary.groupMembers = group.members.map((m) => ({
        id: m.id,
        title: m.title,
        year: m.year,
      }));

      for (const member of group.members) {
        if (member.id === primary.id) {
          member.franchisePrimary = true;
          member.franchiseGroupId = groupId;
          member.groupId = groupId;
          continue;
        }
        member.franchiseMember = true;
        member.franchiseGroupId = groupId;
        member.groupId = groupId;
        member.groupMembers = primary.groupMembers;
        member.duplicateCategory = DUPLICATE_CATEGORY.grouped_member;
        member.duplicateSourceTitle = primary.details?.title || group.rootTitle || primary.title;
        member.error = `Will be grouped under “${primary.details?.title || group.rootTitle || primary.title}”.`;
        if (isMatchVerified(member)) {
          member.status =
            member.status === STATUS.added ? STATUS.added : STATUS.ready_to_add;
        }
      }
    }

    await applyAnimeWatchlistGrouping(listId, items);
  }

  async function applyAnimeWatchlistGrouping(listId, items) {
    const SM = window.WatchlistSeriesMetadata;
    const helpers = window.WatchlistImportJob?._helpers || {};
    const getWatchlistAnime = helpers.getWatchlistAnime || (() => []);
    if (!SM?.findAnimeParentOnList || !SM?.resolveWatchlistItemAnilistId) return;

    const watchlistAnime = getWatchlistAnime();
    if (!watchlistAnime.length) return;

    for (const item of Object.values(items || {})) {
      if (item.contentType !== "anime") continue;
      if (item.status === STATUS.duplicate || item.status === STATUS.cancelled) continue;
      if (item.franchiseMember) continue;

      const resolved = await SM.resolveWatchlistItemAnilistId(item, { persist: false });
      if (!resolved?.anilistId) continue;

      const relation = await SM.findAnimeParentOnList(resolved.anilistId, watchlistAnime);
      if (!relation?.parent) continue;

      item.franchiseMember = true;
      item.franchiseGroupId = relation.parent.id || "";
      item.groupedUnderWatchlistId = relation.parent.id || "";
      item.duplicateCategory = DUPLICATE_CATEGORY.grouped_member;
      item.duplicateSourceTitle = relation.parent.title || "";
      item.groupedRelationType = relation.relationType || "sequel_chain";
      item.groupedSeasonNumber = relation.seasonNumber || null;
      item.error = `Will be grouped under “${relation.parent.title}”.`;
      if (item.status !== STATUS.added && isMatchVerified(item)) {
        item.status = STATUS.ready_to_add;
      }
    }
  }

  async function isAnimeGroupedChild(anilistId) {
    const SM = window.WatchlistSeriesMetadata;
    const helpers = window.WatchlistImportJob?._helpers || {};
    const getWatchlistAnime =
      helpers.getWatchlistAnime || (() => []);
    if (!SM?.findAnimeParentOnList || !anilistId) return null;
    return SM.findAnimeParentOnList(anilistId, getWatchlistAnime());
  }

  async function processNextBatch(listId) {
    const items = loadItems(listId);
    const job = ensureJobRecord(listId, items);
    if (!job || !items) return false;

    const now = Date.now();
    promoteDueWaitingItems(items, now);
    recoverStuckProcessingItems(items, now);

    const pending = getQueueCandidates(items, now)
      .filter((item) => !rematchOnlyIds?.size || rematchOnlyIds.has(item.id))
      .sort((a, b) => a.line - b.line);

    if (!pending.length) {
      const futureWaiting = Object.values(items).filter(
        (it) => queueItemAwaitingRetry(it) && it.retryAfter && it.retryAfter > now
      );

      if (futureWaiting.length && !paused && !job.paused) {
        scheduleQueueWake(listId, items);
        return true;
      }

      if (hasQueueWork(items, now)) {
        scheduleQueueWake(listId, items);
        return true;
      }

      job.status = "completed";
      job.retryProgress = null;
      job.stats = recomputeStats(items);
      job.updatedAt = now;
      saveJob(listId, job);
      saveItems(listId, items);
      onChange?.({ listId, job, items });
      stopQueueWatchdog();
      return false;
    }

    const batch = pending.slice(0, job.batchSize || BATCH_SIZE);
    if (rematchOnlyIds?.size) {
      for (const item of batch) rematchOnlyIds.delete(item.id);
      if (rematchOnlyIds.size === 0) rematchOnlyIds = null;
    }
    job.status = "processing";
    job.updatedAt = now;
    saveJob(listId, job);

    const providerIds = job.providerIds || (job.providerIds = {});
    const animeBatch = batch.filter((it) => it.contentType === "anime" && !isMatchVerified(it));
    const otherBatch = batch.filter((it) => it.contentType !== "anime" && !isMatchVerified(it));

    const WM = window.WatchlistMetadata;
    if (animeBatch.length && WM?.searchAnimeOfflineBatch) {
      try {
        const offlineMap = await WM.searchAnimeOfflineBatch(
          animeBatch.map((item) => ({
            id: item.id,
            title: item.title,
            searchPasses: buildAnimeSearchPasses(item),
            year: item.year,
          }))
        );
        for (const item of animeBatch) {
          if (isMatchVerified(item)) continue;
          const offline = offlineMap?.get(item.id);
          if (!offline?.ok) continue;
          if (offline.pick) {
            await finalizeMatchPick(item, offline.pick, job, providerIds);
            continue;
          }
          if (!offline.results?.length) continue;
          const scored = scoreCandidates(offline.results, item);
          const auto = autoPickFromScored(scored, item);
          const topScore = scored[0]?.score || 0;
          if (auto.pick && topScore >= 95) {
            await finalizeMatchPick(item, auto.pick, job, providerIds);
          }
        }
      } catch (error) {
        console.warn("[bulk-import:offline-index]", error);
      }
    }

    let animeSearchMap = null;
    const animeNeedingAnilist = animeBatch.filter((it) => !isMatchVerified(it));
    if (animeNeedingAnilist.length && WM?.searchAnilistBulkBatch) {
      try {
        animeSearchMap = await WM.searchAnilistBulkBatch(
          animeNeedingAnilist.map((item) => ({
            id: item.id,
            title: item.title,
            searchPasses: buildAnimeSearchPasses(item),
            year: item.year,
          }))
        );
      } catch (error) {
        console.warn("[bulk-import:anime-batch]", error);
      }
    }

    await runPool(
      otherBatch,
      async (item) => {
        await matchOneItem(item, job, items, providerIds);
        saveProgress(listId, job, items);
      },
      MAX_CONCURRENCY
    );

    for (let i = 0; i < animeBatch.length; i++) {
      const item = animeBatch[i];
      if (paused || job.paused) break;
      if (isMatchVerified(item)) continue;
      try {
        const preloaded = animeSearchMap?.get(item.id) || null;
        await matchAnimeItem(item, job, providerIds, preloaded);
      } catch (error) {
        if (isMatchVerified(item)) continue;
        console.warn("[bulk-import:anime-item]", {
          title: item.title,
          message: String(error?.message || error),
        });
        item.status = STATUS.pending;
        syncRetrySchedule(
          item,
          now + 1500 + i * RETRY_STAGGER_MS,
          "Temporary error — retrying"
        );
        item.failureKind = FAILURE_KIND.transient;
        item.error = item.waitingReason;
      }
      saveProgress(listId, job, items);
      if (!paused && !animeSearchMap?.get(item.id)) {
        await new Promise((r) => setTimeout(r, ANILIST_ITEM_DELAY_MS));
      }
    }

    job.stats = recomputeStats(items, job);
    job.updatedAt = Date.now();
    setJobWorkerLabel(job, "");
    job.status = paused || job.paused
      ? "paused"
      : hasQueueWork(items)
        ? "idle"
        : "completed";
    saveJob(listId, job);
    saveItems(listId, items);
    onChange?.({ listId, job, items });
    scheduleQueueWake(listId, items);
    return !paused && !job.paused && hasQueueWork(items);
  }

  async function runProcessingLoop(listId) {
    if (isImportPersistenceBlocked(listId)) {
      const failure = getImportPersistenceFailure(listId);
      handleImportPersistenceFailure(
        failure || {
          listId,
          userMessage: store()?.PERSISTENCE_ERROR_MESSAGE,
          kind: "remote",
        }
      );
      return;
    }
    activeListId = listId;
    releaseStaleWorkerLock();
    const job = ensureJobRecord(listId, null);
    if (job?.paused) {
      paused = true;
      return;
    }

    if (processing) {
      releaseStaleWorkerLock();
      if (processing) return;
    }
    processing = true;
    processingStartedAt = Date.now();
    startQueueWatchdog(listId);

    const items = loadItems(listId);
    if (items && job) {
      if (healTransientFailedItems(items)) {
        saveItems(listId, items);
        job.stats = recomputeStats(items);
        saveJob(listId, job);
      }
      promoteDueWaitingItems(items, Date.now());
      recoverStuckProcessingItems(items, Date.now());
      saveItems(listId, items);
    }

    try {
      let more = true;
      while (more && !paused && !loadJob(listId)?.paused) {
        try {
          more = await processNextBatch(listId);
        } catch (error) {
          console.warn("[bulk-import:batch]", error);
          more = hasQueueWork(loadItems(listId));
          await new Promise((r) => setTimeout(r, 500));
        }
        if (more) {
          await new Promise((r) => setTimeout(r, 300));
        }
      }
    } finally {
      processing = false;
      processingStartedAt = 0;
      const latestItems = loadItems(listId);
      scheduleQueueWake(listId, latestItems);
      if (hasQueueWork(latestItems)) {
        startQueueWatchdog(listId);
      }
    }
  }

  function pauseJob(listId) {
    paused = true;
    const job = loadJob(listId);
    if (job) {
      job.paused = true;
      job.status = "paused";
      job.updatedAt = Date.now();
      saveJob(listId, job);
      onChange?.({ listId, job, items: loadItems(listId) });
    }
  }

  function resumeJob(listId) {
    return continueProcessing(listId);
  }

  async function confirmPossibleMatch(listId, itemId, pickIndex) {
    const items = loadItems(listId);
    const item = items[itemId];
    if (!item || item.status !== STATUS.possible_match) return false;

    const pick = item.candidates?.[pickIndex];
    if (!pick) return false;

    const job = loadJob(listId);
    const pKey = providerKeyFromPick(pick, item.contentType);
    if (pKey && job?.providerIds?.[pKey]) {
      item.status = STATUS.duplicate;
      item.error = "Same provider ID already matched in this import.";
      saveItems(listId, items);
      return false;
    }

    item.status = STATUS.processing;
    item.matchStatus = MATCH_STATUS.matching;
    const providerIds = job?.providerIds || {};
    const ok = await finalizeMatchPick(item, pick, job, providerIds);
    if (!ok && !isMatchVerified(item)) {
      item.status = STATUS.possible_match;
      item.matchStatus = MATCH_STATUS.needs_attention;
      if (!item.error) item.error = "Could not load provider details.";
      saveItems(listId, items);
      return false;
    }

    if (job) {
      job.stats = recomputeStats(items, job);
      job.updatedAt = Date.now();
      saveJob(listId, job);
    }
    saveItems(listId, items);
    onChange?.({ listId, job, items });
    return true;
  }

  function getGroupsForPreview(items) {
    const groups = new Map();
    for (const item of Object.values(items || {})) {
      const gid = item.groupId || item.franchiseGroupId;
      if (!gid) continue;
      if (item.franchiseMember || item.status === STATUS.grouped) {
        if (!groups.has(gid)) {
          const primary = items[gid];
          groups.set(gid, {
            id: gid,
            title: primary?.details?.title || primary?.title || item.title,
            members: primary?.groupMembers || item.groupMembers || [],
          });
        }
        continue;
      }
      if (item.groupMembers?.length) {
        groups.set(gid, {
          id: gid,
          title: item.details?.title || item.title,
          members: item.groupMembers,
        });
      }
    }
    return [...groups.values()];
  }

  async function changeItemType(listId, itemId, newType) {
    const allowed = ["movies", "tvSeries", "anime"];
    if (!allowed.includes(newType)) return { ok: false, reason: "invalid_type" };

    const typeLabels = {
      movies: "Movie",
      tvSeries: "TV series",
      anime: "Anime",
    };

    const items = loadItems(listId);
    const job = loadJob(listId);
    const item = items?.[itemId];
    if (!item || !job) return { ok: false, reason: "not_found" };
    if (!isPermanentUnresolved(item)) return { ok: false, reason: "not_editable" };
    if (processing && !rematchOnlyIds) return { ok: false, reason: "worker_busy" };

    if (!item.originalType) item.originalType = item.contentType;
    item.correctedType = newType;
    item.contentType = newType;
    item.typeCorrectionReason = "Manual correction";
    item.typeCorrectionProvider = "User";
    item.typeCorrected = item.originalType !== newType ? `${item.originalType}→${newType}` : null;
    item.typeConflictAmbiguous = false;
    item.typeReviewRequired = false;
    item.typeCorrectionUncertain = false;
    item.typeConflictReason = null;
    item.typeConflictAnime = null;
    item.typeConflictTv = null;
    item.animeProvidersExhausted = false;

    bumpMatchRevision(item);
    item.pick = null;
    item.details = null;
    item.candidates = [];
    item.providerKey = null;
    item.lastProvider = null;
    item.error = "";
    item.failureKind = null;
    item.duplicateCategory = null;
    item.duplicateSourceTitle = "";
    clearRetrySchedule(item);

    item.matchStatus = MATCH_STATUS.pending;
    item.metadataStatus = METADATA_STATUS.not_started;
    item.status = STATUS.pending;

    job.paused = false;
    job.status = "processing";
    setJobWorkerLabel(job, `Retrying as ${typeLabels[newType]}…`, itemId);
    saveProgress(listId, job, items);

    const kick = kickImportQueue(listId, { onlyIds: [itemId] });
    if (!kick.started) {
      setJobWorkerLabel(job, "");
      saveJob(listId, job);
      return { ok: false, reason: kick.reason || "worker_busy" };
    }
    return { ok: true };
  }

  async function commitReadyItems(listId, addItemFn, options = {}) {
    const onProgress = options.onProgress;
    const items = loadItems(listId);
    const job = loadJob(listId);
    if (!items || !job || typeof addItemFn !== "function") {
      return {
        added: 0,
        alreadyPresent: 0,
        grouped: 0,
        failed: 0,
        stillReady: 0,
        errors: [],
        blocked: true,
        reason: "missing_data",
      };
    }

    const stats = recomputeStats(items, job);
    const accounting = validateImportStatusAccounting(stats);
    if (!accounting.ok) {
      return {
        added: 0,
        alreadyPresent: 0,
        grouped: 0,
        failed: 0,
        stillReady: countCommitEligible(items),
        errors: ["Import status is incomplete. Resolve hidden rows first."],
        blocked: true,
        reason: "incomplete_accounting",
        accounting,
      };
    }

    try {
      await applyAnimeGrouping(listId, items);
      healDuplicateClassifications(items);
    } catch (error) {
      console.warn("[bulk-import:grouping]", error);
    }

    const eligible = Object.values(items)
      .filter(isCommitEligible)
      .sort((a, b) => a.line - b.line);

    const result = {
      added: 0,
      alreadyPresent: 0,
      grouped: Object.values(items).filter((it) => it.franchiseMember && it.status !== STATUS.added)
        .length,
      failed: 0,
      stillReady: 0,
      errors: [],
    };

    const total = eligible.length;
    let processed = 0;

    for (let i = 0; i < eligible.length; i += COMMIT_CHUNK) {
      const chunk = eligible.slice(i, i + COMMIT_CHUNK);
      const chunkAddedIds = [];

      for (const row of chunk) {
        if (!isCommitEligible(row)) continue;
        if (row.commitClaimed) continue;

        row.commitClaimed = true;
        row.commitError = "";
        saveItems(listId, items);

        processed += 1;
        onProgress?.({
          current: processed,
          total,
          label: `Adding ${processed} of ${total}`,
        });

        try {
          const addResult = await addItemFn(row);
          const ok = addResult === true || addResult?.ok === true;
          if (ok) {
            row.status = STATUS.added;
            row.addedAt = Date.now();
            row.watchlistItemId =
              typeof addResult === "object"
                ? addResult.itemId || addResult.watchlistItemId || ""
                : "";
            row.commitClaimed = false;
            if (row.providerKey) {
              job.providerIds = job.providerIds || {};
              job.providerIds[row.providerKey] = row.id;
            }
            const compacted = store()?.compactItem?.(row);
            if (compacted) Object.assign(row, compacted);
            result.added += 1;
            chunkAddedIds.push(row.watchlistItemId);
          } else if (addResult?.reason === "duplicate" || addResult?.reason === "already_present") {
            row.commitClaimed = false;
            row.commitError = addResult.reason;
            result.alreadyPresent += 1;
          } else if (addResult?.reason === "already_added") {
            row.status = STATUS.added;
            row.commitClaimed = false;
            result.alreadyPresent += 1;
          } else if (addResult?.reason === "poster_pending") {
            row.commitClaimed = false;
            row.waiting = true;
            row.status = STATUS.pending;
            row.error = addResult.message || "Fetching anime poster";
            syncRetrySchedule(row, Date.now() + 4000, row.error);
            result.posterPending = (result.posterPending || 0) + 1;
          } else {
            row.commitClaimed = false;
            row.commitError = addResult?.reason || "failed";
            result.failed += 1;
            result.errors.push({ id: row.id, title: row.title, reason: row.commitError });
          }
        } catch (error) {
          row.commitClaimed = false;
          row.commitError = String(error?.message || error);
          result.failed += 1;
          result.errors.push({ id: row.id, title: row.title, reason: row.commitError });
        }
      }

      job.stats = recomputeStats(items, job);
      job.updatedAt = Date.now();
      saveJob(listId, job);
      saveItems(listId, items);
      onChange?.({ listId, job, items, commitChunk: chunkAddedIds });

      await new Promise((r) => setTimeout(r, 50));
    }

    result.stillReady = countCommitEligible(items);
    job.stats = recomputeStats(items, job);
    job.updatedAt = Date.now();
    saveJob(listId, job);
    saveItems(listId, items);
    store()?.archiveCompletedJob?.(listId);
    onChange?.({ listId, job, items });
    return result;
  }

  function resolveRemaining(listId) {
    const items = loadItems(listId);
    if (items) healTransientFailedItems(items);
    return requeueItems(
      listId,
      (item) => isPermanentUnresolved(item),
      { label: "Resolving" }
    );
  }

  function retryFailed(listId) {
    return resolveRemaining(listId);
  }

  function cancelRemaining(listId) {
    const items = loadItems(listId);
    for (const item of Object.values(items)) {
      if (item.status === STATUS.pending || item.status === STATUS.processing) {
        item.status = STATUS.cancelled;
        item.error = "Cancelled.";
      }
    }
    const job = loadJob(listId);
    if (job) {
      job.status = "cancelled";
      job.paused = true;
      job.stats = recomputeStats(items);
      saveJob(listId, job);
    }
    saveItems(listId, items);
    paused = true;
    onChange?.({ listId, job, items });
  }

  function setChangeHandler(fn) {
    onChange = fn;
  }

  window.WatchlistImportJob = {
    STATUS,
    MATCH_STATUS,
    METADATA_STATUS,
    FAILURE_KIND,
    DUPLICATE_CATEGORY,
    IMPORT_JOBS_KEY: LEGACY_IMPORT_JOBS_KEY,
    IMPORT_ITEMS_KEY: LEGACY_IMPORT_ITEMS_KEY,
    BATCH_SIZE,
    COMMIT_CHUNK,
    createJobFromParse,
    loadJob,
    loadItems,
    clearJob,
    runProcessingLoop,
    kickImportQueue,
    continueProcessing,
    ensureQueueProcessing,
    wakeQueueNow,
    startQueueWatchdog,
    formatQueueStatusLine,
    formatWaitingItemDetail,
    formatQueueProgress,
    isWorkerActive,
    pauseJob,
    resumeJob,
    resolveRemaining,
    retryFailed,
    retryAllFailed,
    retryAnimeFailures,
    retryTransientFailures,
    retryNotFound,
    retryAnilistFailures,
    cancelRemaining,
    confirmPossibleMatch,
    commitReadyItems,
    changeItemType,
    auditMisclassifiedTypes,
    auditAddedWatchlistTypes,
    markAddedTypeCorrectionsApplied,
    recordImportTypeCorrection,
    saveImportItems: saveItems,
    applyAnimeWatchlistGrouping,
    isAnimeGroupedChild,
    hasCommitTypeBlock,
    formatTypeCorrectionNote,
    isMisclassifiedItem,
    getGroupsForPreview,
    recomputeStats,
    sortPreviewRows,
    filterRowsByPreviewFilter,
    filterRowsBySearch,
    formatDuplicateCategory,
    healDuplicateClassifications,
    humanizeFailureReason,
    providerForItem,
    isPermanentUnresolved,
    isWaitingItem,
    isDuplicateRow,
    countNeedsAttention,
    healTransientFailedItems,
    exportItemsTsv,
    downloadImportTsv,
    copyUnresolvedTsv,
    applyCorrectedTsv,
    formatAccountingLine,
    validateImportStatusAccounting,
    logStatusAccounting,
    isTypeCorrectedFromAnime,
    isGroupedImportItem,
    importTitleSameWork,
    isTmdbRivalForImportedAnime,
    statusBucket,
    hydrateJobData,
    hydrateJobDataAsync,
    hasActiveJob,
    isReadyItem,
    isCommitEligible,
    countCommitEligible,
    isMatchVerified,
    isImportPersistenceBlocked,
    getImportPersistenceFailure,
    handleImportPersistenceFailure,
    countVerifiedItems,
    countRemainingAnime,
    buildMinimalDetailsFromPick,
    setChangeHandler,
    _helpers: {},
  };

  window.addEventListener("watchlist-import-persist-failed", (event) => {
    handleImportPersistenceFailure(event.detail || {});
  });
})();
