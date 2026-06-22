(function () {
  "use strict";

  const ACCOUNTS_TABLE = "accounts";
  const LISTS_TABLE = "lists";
  const ITEMS_TABLE = "watchlist_items";
  const SNAPSHOTS_TABLE = "list_snapshots";
  const DEBOUNCE_MS = 900;

  let client = null;
  let syncTimer = null;
  let syncing = false;

  function config() {
    return window.WATCHLIST_CONFIG || {};
  }

  function isConfigured() {
    const { supabaseUrl, supabaseAnonKey } = config();
    return Boolean(supabaseUrl && supabaseAnonKey);
  }

  function getClient() {
    if (!isConfigured()) return null;
    if (!client) {
      const { supabaseUrl, supabaseAnonKey } = config();
      client = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
    }
    return client;
  }

  function emptyWatchlist() {
    return { movies: {}, tvSeries: {}, anime: {} };
  }

  function makeItemId(contentType, genre, title) {
    return `${contentType}::${genre}::${title}`;
  }

  function parseLeads(entry) {
    if (Array.isArray(entry.leads) && entry.leads.length) {
      return entry.leads.map((name) => String(name).trim()).filter(Boolean);
    }
    if (entry.lead) {
      return String(entry.lead)
        .split(/,\s*/)
        .map((name) => name.trim())
        .filter(Boolean);
    }
    return [];
  }

  function defaultKind(contentType, kind) {
    if (kind === "franchise") return "film series";
    if (kind) return kind;
    return contentType === "movies" ? "movie" : "series";
  }

  function watchEntryMeta(entry) {
    if (!entry) return { watched: false, rating: null, note: "", progress: null };
    if (entry === true) return { watched: true, rating: null, note: "", progress: null };
    if (typeof entry !== "object") return { watched: false, rating: null, note: "", progress: null };

    const ratingRaw = entry.rating;
    const rating =
      ratingRaw == null || ratingRaw === ""
        ? null
        : Number(String(ratingRaw).replace(",", "."));

    let progress = null;
    if (entry.progress && typeof entry.progress === "object" &&
        Array.isArray(entry.progress.episodes)) {
      // Preserve the completed flag so the DB row accurately reflects state
      // and the client can restore it on next load without needing episode data.
      progress = {
        version: 1,
        episodes: entry.progress.episodes,
        ...(entry.progress.completed === true ? { completed: true } : {}),
      };
    }

    // `watched` in the DB means "legacy-complete or fully-granular-complete".
    // In-progress entries (granular progress without completed=true) store
    // watched=false so that watched_count stays accurate.
    const isLegacyComplete = progress === null; // no granular progress object
    const isGranularComplete = progress !== null && entry.progress?.completed === true;
    const watched = isLegacyComplete || isGranularComplete;

    return {
      watched,
      rating: Number.isFinite(rating) ? rating : null,
      note: entry.note ? String(entry.note).trim() : "",
      progress,
    };
  }

  function parseAddedAtMs(value) {
    if (value == null || value === "") return null;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const ms = Date.parse(String(value));
    return Number.isFinite(ms) ? ms : null;
  }

  function resolveAddedAtIso(entry, itemId, existingAddedAt = new Map()) {
    const localMs = parseAddedAtMs(entry.addedAt);
    if (localMs != null) return new Date(localMs).toISOString();

    const remoteMs = parseAddedAtMs(existingAddedAt.get(itemId));
    if (remoteMs != null) return new Date(remoteMs).toISOString();

    return new Date().toISOString();
  }

  function watchlistToRows(listId, watchlist, watched, existingAddedAt = new Map()) {
    const rows = [];
    const now = new Date().toISOString();

    for (const [contentType, genres] of Object.entries(watchlist || {})) {
      if (!genres || typeof genres !== "object") continue;

      for (const [genre, titles] of Object.entries(genres)) {
        if (!Array.isArray(titles)) continue;

        for (const entry of titles) {
          if (!entry?.title) continue;

          const leads = parseLeads(entry);
          const itemId = makeItemId(contentType, genre, entry.title);
          const watchMeta = watchEntryMeta(watched?.[itemId]);

          rows.push({
            list_id: listId,
            item_id: itemId,
            content_type: contentType,
            genre,
            title: entry.title,
            kind: defaultKind(contentType, entry.kind),
            lead: entry.lead || leads.join(", "),
            leads,
            summary: entry.summary || entry.reminder || "",
            link: entry.link || "",
            secondary_genres: entry.secondaryGenres || [],
            poster: entry.poster || "",
            imdb_rating: entry.imdbRating || "",
            anilist_rating: entry.anilistRating || "",
            age_rating: entry.ageRating || "",
            runtime: entry.runtime || "",
            season_count: entry.seasonCount ? String(entry.seasonCount) : "",
            episode_count: entry.episodeCount ? String(entry.episodeCount) : "",
            year: entry.year || "",
            watched: watchMeta.watched,
            watch_rating: watchMeta.rating,
            watch_note: watchMeta.note,
            watch_progress: watchMeta.progress || { version: 1, episodes: [] },
            added_at: resolveAddedAtIso(entry, itemId, existingAddedAt),
            updated_at: now,
          });
        }
      }
    }

    return rows;
  }

  async function fetchExistingAddedAtMap(sb, listId) {
    const { data, error } = await sb
      .from(ITEMS_TABLE)
      .select("item_id, added_at")
      .eq("list_id", listId);

    if (error) {
      console.warn("[sync] added_at fetch failed:", error.message);
      return new Map();
    }

    return new Map((data || []).map((row) => [row.item_id, row.added_at]));
  }

  function rowsToWatchlist(rows) {
    const watchlist = emptyWatchlist();
    const watched = {};

    for (const row of rows || []) {
      const contentType = row.content_type;
      const genre = row.genre;
      if (!watchlist[contentType]) continue;

      if (!watchlist[contentType][genre]) {
        watchlist[contentType][genre] = [];
      }

      const entry = {
        title: row.title,
        kind: row.kind,
        summary: row.summary || "",
      };

      if (row.lead) entry.lead = row.lead;
      if (Array.isArray(row.leads) && row.leads.length) entry.leads = row.leads;
      if (row.link) entry.link = row.link;
      if (Array.isArray(row.secondary_genres) && row.secondary_genres.length) {
        entry.secondaryGenres = row.secondary_genres;
      }
      if (row.poster) entry.poster = row.poster;
      if (row.imdb_rating) entry.imdbRating = row.imdb_rating;
      if (row.anilist_rating) entry.anilistRating = row.anilist_rating;
      if (row.age_rating) entry.ageRating = row.age_rating;
      if (row.runtime) entry.runtime = row.runtime;
      if (row.season_count) entry.seasonCount = row.season_count;
      if (row.episode_count) entry.episodeCount = row.episode_count;
      if (row.year) entry.year = row.year;
      const addedMs = parseAddedAtMs(row.added_at);
      if (addedMs != null) entry.addedAt = addedMs;

      watchlist[contentType][genre].push(entry);

      // Rows with granular progress but !watched are also tracked (in-progress state).
      const rawProgress = row.watch_progress;
      const hasProgress =
        rawProgress &&
        typeof rawProgress === "object" &&
        Array.isArray(rawProgress.episodes) &&
        rawProgress.episodes.length > 0;

      if (row.watched || hasProgress) {
        const watchEntry = {};
        if (row.watched) {
          if (row.watch_rating != null && row.watch_rating !== "") {
            const rating = Number(row.watch_rating);
            if (Number.isFinite(rating)) watchEntry.rating = rating;
          }
          if (row.watch_note) watchEntry.note = row.watch_note;
        }
        if (hasProgress) {
          watchEntry.progress = {
            version: 1,
            episodes: rawProgress.episodes,
            ...(rawProgress.completed === true ? { completed: true } : {}),
          };
        }
        watched[row.item_id] = watchEntry;
      }
    }

    return { watchlist, watched };
  }

  async function listExists(listId) {
    const sb = getClient();
    if (!sb || !listId) return false;

    const { data, error } = await sb
      .from(LISTS_TABLE)
      .select("list_id")
      .eq("list_id", listId)
      .maybeSingle();

    if (error) {
      console.warn("[sync] list exists check failed:", error.message);
      return false;
    }

    return Boolean(data);
  }

  async function accountExists(accountId) {
    const sb = getClient();
    if (!sb || !accountId) return false;

    const [accountResult, listsResult] = await Promise.all([
      sb.from(ACCOUNTS_TABLE).select("account_id").eq("account_id", accountId).maybeSingle(),
      sb
        .from(LISTS_TABLE)
        .select("list_id", { count: "exact", head: true })
        .eq("account_id", accountId),
    ]);

    if (accountResult.error) {
      console.warn("[sync] account check failed:", accountResult.error.message);
    } else if (accountResult.data) {
      return true;
    }

    if (listsResult.error) {
      console.warn("[sync] account lists check failed:", listsResult.error.message);
      return false;
    }

    return (listsResult.count || 0) > 0;
  }

  async function fetchListsForAccount(accountId) {
    const sb = getClient();
    if (!sb || !accountId) return [];

    const { data, error } = await sb
      .from(LISTS_TABLE)
      .select("list_id, name, description, title_count, watched_count, updated_at")
      .eq("account_id", accountId)
      .order("updated_at", { ascending: true });

    if (error) {
      console.warn("[sync] fetch lists failed:", error.message);
      return [];
    }

    return data || [];
  }

  async function fetchSnapshot(listId) {
    const sb = getClient();
    if (!sb || !listId) return null;

    const [{ data: listRow, error: listError }, { data: items, error: itemsError }] =
      await Promise.all([
        sb
          .from(LISTS_TABLE)
          .select("account_id, name, description, updated_at")
          .eq("list_id", listId)
          .maybeSingle(),
        sb.from(ITEMS_TABLE).select("*").eq("list_id", listId),
      ]);

    if (listError) {
      console.warn("[sync] list fetch failed:", listError.message);
      return null;
    }

    if (itemsError) {
      console.warn("[sync] items fetch failed:", itemsError.message);
      return null;
    }

    if (!listRow && (!items || items.length === 0)) {
      return null;
    }

    if (!listRow && items?.length) {
      console.warn(
        `[sync] orphaned items for ${listId} — list row missing; clearing ${items.length} rows`
      );
      const { error: orphanError } = await sb
        .from(ITEMS_TABLE)
        .delete()
        .eq("list_id", listId);

      if (orphanError) {
        console.warn("[sync] orphan cleanup failed:", orphanError.message);
      }
      return null;
    }

    const converted = rowsToWatchlist(items);
    return {
      watchlist: converted.watchlist,
      watched: converted.watched,
      name: listRow?.name || "My list",
      description: listRow?.description || "",
      account_id: listRow?.account_id || null,
      updated_at: listRow?.updated_at || null,
    };
  }

  async function pushSnapshot(listId, watchlist, watched, meta = {}) {
    const sb = getClient();
    if (!sb || !listId) return { ok: false };

    const accountId = meta.accountId || meta.account_id;
    if (!accountId) {
      console.warn("[sync] push skipped — missing accountId");
      return { ok: false };
    }

    syncing = true;
    dispatchStatus("saving");

    const existingAddedAt = await fetchExistingAddedAtMap(sb, listId);
    const rows = watchlistToRows(listId, watchlist, watched, existingAddedAt);
    const now = new Date().toISOString();
    const titleCount = rows.length;
    const watchedCount = rows.filter((row) => row.watched === true).length;

    const { error: accountError } = await sb.from(ACCOUNTS_TABLE).upsert(
      { account_id: accountId, updated_at: now },
      { onConflict: "account_id" }
    );

    if (accountError) {
      syncing = false;
      console.warn("[sync] account save failed:", accountError.message);
      dispatchStatus("error");
      return { ok: false, error: accountError };
    }

    const { error: listError } = await sb.from(LISTS_TABLE).upsert(
      {
        list_id: listId,
        account_id: accountId,
        name: meta.name || "My list",
        description: meta.description || "",
        updated_at: now,
      },
      { onConflict: "list_id" }
    );

    if (listError) {
      syncing = false;
      console.warn("[sync] list save failed:", listError.message);
      dispatchStatus("error");
      return { ok: false, error: listError };
    }

    const { error: deleteError } = await sb
      .from(ITEMS_TABLE)
      .delete()
      .eq("list_id", listId);

    if (deleteError) {
      syncing = false;
      console.warn("[sync] item clear failed:", deleteError.message);
      dispatchStatus("error");
      return { ok: false, error: deleteError };
    }

    if (rows.length) {
      const { error: insertError } = await sb.from(ITEMS_TABLE).insert(rows);

      if (insertError) {
        syncing = false;
        console.warn("[sync] item save failed:", insertError.message);
        dispatchStatus("error");
        return { ok: false, error: insertError };
      }
    }

    const { error: statsError } = await sb
      .from(LISTS_TABLE)
      .update({
        title_count: titleCount,
        watched_count: watchedCount,
        updated_at: now,
      })
      .eq("list_id", listId);

    if (statsError) {
      syncing = false;
      console.warn("[sync] list stats update failed:", statsError.message);
      dispatchStatus("error");
      return { ok: false, error: statsError };
    }

    syncing = false;
    dispatchStatus("saved");
    return { ok: true };
  }

  async function createListRow(accountId, listId, name, description) {
    const sb = getClient();
    if (!sb || !accountId || !listId) return { ok: false };

    const now = new Date().toISOString();

    const { error: accountError } = await sb.from(ACCOUNTS_TABLE).upsert(
      { account_id: accountId, updated_at: now },
      { onConflict: "account_id" }
    );

    if (accountError) {
      console.warn("[sync] account create failed:", accountError.message);
      return { ok: false, error: accountError };
    }

    const { error: listError } = await sb.from(LISTS_TABLE).upsert(
      {
        list_id: listId,
        account_id: accountId,
        name: name || "My list",
        description: description || "",
        updated_at: now,
      },
      { onConflict: "list_id" }
    );

    if (listError) {
      console.warn("[sync] list create failed:", listError.message);
      return { ok: false, error: listError };
    }

    return { ok: true };
  }

  function dispatchStatus(status) {
    window.dispatchEvent(
      new CustomEvent("watchlist-sync-status", { detail: { status } })
    );
  }

  function schedulePush(listId, getPayload, onComplete) {
    if (!isConfigured() || !listId) return;

    clearTimeout(syncTimer);
    dispatchStatus("pending");

    syncTimer = setTimeout(async () => {
      if (window.WatchlistAuth?.getProfile() !== listId) {
        onComplete?.({ ok: false, skipped: true });
        return;
      }
      const payload = getPayload();
      if (window.WatchlistAuth?.getProfile() !== listId) {
        onComplete?.({ ok: false, skipped: true });
        return;
      }
      const result = await pushSnapshot(
        listId,
        payload.watchlist,
        payload.watched,
        payload.meta
      );
      onComplete?.(result);
    }, DEBOUNCE_MS);
  }

  function isSyncing() {
    return syncing;
  }

  async function migrateAccount(oldAccountId, newAccountId, lists = []) {
    const sb = getClient();
    if (!sb || !oldAccountId || !newAccountId) return { ok: false };

    for (const entry of lists) {
      const pushResult = await pushSnapshot(
        entry.listId,
        entry.watchlist || emptyWatchlist(),
        entry.watched || {},
        {
          accountId: newAccountId,
          name: entry.name || "My list",
          description: entry.description || "",
        }
      );
      if (!pushResult.ok) return pushResult;
    }

    if (oldAccountId === newAccountId) return { ok: true };

    const { error: deleteError } = await sb
      .from(ACCOUNTS_TABLE)
      .delete()
      .eq("account_id", oldAccountId);

    if (deleteError) {
      console.warn("[sync] migrate delete account failed:", deleteError.message);
      return { ok: false, error: deleteError };
    }

    return { ok: true };
  }

  async function migrateList(oldListId, newListId, watchlist, watched, meta = {}) {
    const pushResult = await pushSnapshot(newListId, watchlist, watched, meta);
    if (!pushResult.ok) return pushResult;
    if (oldListId === newListId) return { ok: true };
    return deleteList(oldListId);
  }

  function cancelScheduledPush() {
    clearTimeout(syncTimer);
  }

  async function deleteList(listId) {
    const sb = getClient();
    if (!sb || !listId) return { ok: false };

    const { error: itemsError } = await sb
      .from(ITEMS_TABLE)
      .delete()
      .eq("list_id", listId);

    if (itemsError) {
      console.warn("[sync] delete items failed:", itemsError.message);
      return { ok: false, error: itemsError };
    }

    const { error: listError } = await sb
      .from(LISTS_TABLE)
      .delete()
      .eq("list_id", listId);

    if (listError) {
      console.warn("[sync] delete list failed:", listError.message);
      return { ok: false, error: listError };
    }

    return { ok: true };
  }

  async function deleteAccount(accountId) {
    const sb = getClient();
    if (!sb || !accountId) return { ok: false };

    const { error } = await sb
      .from(ACCOUNTS_TABLE)
      .delete()
      .eq("account_id", accountId);

    if (error) {
      console.warn("[sync] delete account failed:", error.message);
      return { ok: false, error };
    }

    return { ok: true };
  }

  async function updateListMeta(listId, accountId, name, description) {
    const sb = getClient();
    if (!sb || !listId || !accountId) return { ok: false };

    const now = new Date().toISOString();

    const { error: accountError } = await sb.from(ACCOUNTS_TABLE).upsert(
      { account_id: accountId, updated_at: now },
      { onConflict: "account_id" }
    );

    if (accountError) {
      console.warn("[sync] update account meta failed:", accountError.message);
      return { ok: false, error: accountError };
    }

    const { error: listError } = await sb.from(LISTS_TABLE).upsert(
      {
        list_id: listId,
        account_id: accountId,
        name: name || "My list",
        description: description || "",
        updated_at: now,
      },
      { onConflict: "list_id" }
    );

    if (listError) {
      console.warn("[sync] update list meta failed:", listError.message);
      return { ok: false, error: listError };
    }

    return { ok: true };
  }

  function countTitlesInWatchlist(watchlist) {
    let count = 0;
    for (const genres of Object.values(watchlist || {})) {
      if (!genres || typeof genres !== "object") continue;
      for (const titles of Object.values(genres)) {
        if (!titles || typeof titles !== "object") continue;
        count += Object.keys(titles).length;
      }
    }
    return count;
  }

  async function publishShareSnapshot(payload) {
    const sb = getClient();
    if (!sb || !payload?.watchlist) return { ok: false, error: "not_configured" };

    const shareId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `share-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    const { error } = await sb.from(SNAPSHOTS_TABLE).insert({
      share_id: shareId,
      list_name: payload.listName || "Shared list",
      title_count: payload.stats?.titles ?? countTitlesInWatchlist(payload.watchlist),
      payload,
    });

    if (error) {
      console.warn("[sync] publish share failed:", error.message);
      return { ok: false, error };
    }

    return { ok: true, shareId };
  }

  async function fetchShareSnapshot(shareId) {
    const sb = getClient();
    if (!sb || !shareId) return { ok: false, error: "not_configured" };

    const { data, error } = await sb
      .from(SNAPSHOTS_TABLE)
      .select("payload, expires_at")
      .eq("share_id", shareId)
      .maybeSingle();

    if (error) {
      console.warn("[sync] fetch share failed:", error.message);
      return { ok: false, error };
    }

    if (!data?.payload?.watchlist) {
      return { ok: false, error: "not_found" };
    }

    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      return { ok: false, error: "expired" };
    }

    return { ok: true, payload: data.payload };
  }

  window.WatchlistSync = {
    isConfigured,
    listExists,
    accountExists,
    fetchListsForAccount,
    fetchSnapshot,
    pushSnapshot,
    createListRow,
    updateListMeta,
    migrateAccount,
    migrateList,
    deleteList,
    deleteAccount,
    schedulePush,
    cancelScheduledPush,
    isSyncing,
    publishShareSnapshot,
    fetchShareSnapshot,
  };
})();
