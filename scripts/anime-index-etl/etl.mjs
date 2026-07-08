#!/usr/bin/env node
/**
 * ETL: manami-project/anime-offline-database → Supabase anime_title_index
 *
 * Upstream is ARCHIVED (read-only). Default: pinned release 2026-27 only.
 * License: ODbL 1.0 + DbCL 1.0 — see docs/ANIME-DATA-LICENSE.md
 *
 * Does NOT crawl AniList. Does NOT download unverified forks.
 * Replacement sources require ANIME_INDEX_APPROVED_REPLACEMENT=1.
 */

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { decompress } from "@mongodb-js/zstd";
import {
  buildNormalizedSearchTerms,
  classifyTitleFields,
  extractAnilistId,
  extractMalId,
} from "../../shared/anime-title-match.mjs";
import {
  OFFICIAL_ARCHIVED_SOURCE,
  isApprovedOfficialDownloadUrl,
  normalizeChecksum,
  officialReleaseDownloadUrl,
} from "./dataset-source.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const MANIFEST_PATH = join(REPO_ROOT, "docs", "anime-dataset-manifest.json");
const WORK_DIR = join(__dirname, ".work");
const BATCH_SIZE = Math.max(25, parseInt(process.env.ETL_BATCH_SIZE || "100", 10) || 100);
const INSERT_RETRIES = Math.max(1, parseInt(process.env.ETL_INSERT_RETRIES || "8", 10) || 8);
const BATCH_DELAY_MS = Math.max(0, parseInt(process.env.ETL_BATCH_DELAY_MS || "100", 10) || 100);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(err) {
  const msg = String(err?.message || err?.details || err).toLowerCase();
  return (
    msg.includes("fetch failed") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("econnrefused") ||
    msg.includes("network") ||
    msg.includes("socket") ||
    msg.includes("522") ||
    msg.includes("503") ||
    msg.includes("504")
  );
}

async function withInsertRetry(runInsert, label) {
  let delayMs = 2000;
  for (let attempt = 1; attempt <= INSERT_RETRIES; attempt++) {
    try {
      const error = await runInsert();
      if (!error) return;
      if (!isRetryableError(error) || attempt === INSERT_RETRIES) {
        throw new Error(
          `${label}: ${error.message}${error.details ? ` (${error.details})` : ""}`
        );
      }
      console.warn(
        `${label} failed (${error.message}) — retry ${attempt}/${INSERT_RETRIES} in ${delayMs}ms…`
      );
    } catch (err) {
      if (!isRetryableError(err) || attempt === INSERT_RETRIES) throw err;
      console.warn(
        `${label} failed (${err.message}) — retry ${attempt}/${INSERT_RETRIES} in ${delayMs}ms…`
      );
    }
    await sleep(delayMs);
    delayMs = Math.min(delayMs * 2, 30000);
  }
}

async function getStagingCount(supabase) {
  const { count, error } = await supabase
    .from("anime_title_index_staging")
    .select("id", { count: "exact", head: true });
  if (error) throw new Error(`Could not count staging rows: ${error.message}`);
  return count || 0;
}

function cleanServiceRoleKey(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
    console.warn(
      "Removed < > around SUPABASE_SERVICE_ROLE_KEY — paste the raw JWT only (no angle brackets)."
    );
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function requireEnv(name) {
  let v = process.env[name]?.trim();
  if (!v) {
    console.error(`Missing ${name}. Set it in the environment.`);
    process.exit(1);
  }
  if (name === "SUPABASE_SERVICE_ROLE_KEY") {
    v = cleanServiceRoleKey(v);
  }
  return v;
}

async function verifySupabase(supabase) {
  const { error: metaErr } = await supabase.from("anime_dataset_meta").select("id").eq("id", 1).maybeSingle();
  if (metaErr) {
    const hint =
      metaErr.message?.includes("Invalid API key")
        ? " Use the service_role key (not anon/public), with no < > brackets or quotes inside the value."
        : " Check SUPABASE_URL has no trailing spaces and the service role key is correct.";
    throw new Error(`Supabase connection failed (${metaErr.message}).${hint}`);
  }

  const { error: stagingErr } = await supabase.from("anime_title_index_staging").select("id").limit(1);
  if (stagingErr) {
    throw new Error(
      `Database setup incomplete (${stagingErr.message}). Run supabase/migrate-anime-title-index.sql in the SQL Editor first.`
    );
  }
  console.log("Supabase connection OK");
}

function isDatasetMetadataLine(parsed) {
  return !!(parsed.lastUpdate && (parsed.$schema || parsed.license) && !parsed.title);
}

async function countJsonlAnimeEntries(jsonlPath) {
  const lines = readFileSync(jsonlPath, "utf8").split(/\r?\n/);
  let entries = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (isDatasetMetadataLine(parsed)) continue;
    entries += 1;
  }
  return entries;
}

async function probeStagingInsert(supabase) {
  const probe = {
    canonical_title: "__etl_probe__",
    english_title: "__etl_probe__",
    dataset_version: "probe",
    normalized_search_terms: ["etl-probe"],
  };
  const { error: insertErr } = await supabase.from("anime_title_index_staging").insert(probe);
  if (insertErr) {
    throw new Error(
      `Staging insert probe failed (${insertErr.message}). If this mentions row-level security, run supabase/migrate-anime-title-index-staging-fix.sql in the SQL Editor.`
    );
  }
  const { error: deleteErr } = await supabase
    .from("anime_title_index_staging")
    .delete()
    .eq("canonical_title", "__etl_probe__");
  if (deleteErr) {
    console.warn("Could not delete ETL probe row:", deleteErr.message);
  }
}

async function truncateStaging(supabase) {
  console.log("Truncating staging table…");
  const { error } = await supabase.rpc("truncate_anime_title_index_staging");
  if (error) {
    throw new Error(`Staging truncate failed: ${error.message}`);
  }
}

function isApprovedReplacement() {
  return process.env.ANIME_INDEX_APPROVED_REPLACEMENT === "1";
}

function resolveSourceConfig() {
  const approved = isApprovedReplacement();
  const artifactUrl = process.env.ANIME_INDEX_ARTIFACT_URL?.trim() || "";
  const releaseTag =
    process.env.ANIME_INDEX_RELEASE?.trim() || OFFICIAL_ARCHIVED_SOURCE.releaseTag;
  const artifact =
    process.env.ANIME_INDEX_ARTIFACT?.trim() ||
    OFFICIAL_ARCHIVED_SOURCE.artifactPreferred;

  if (releaseTag !== OFFICIAL_ARCHIVED_SOURCE.releaseTag && !approved) {
    throw new Error(
      `Release ${releaseTag} requires ANIME_INDEX_APPROVED_REPLACEMENT=1 (upstream is archived; default is ${OFFICIAL_ARCHIVED_SOURCE.releaseTag}).`
    );
  }

    if (artifactUrl) {
    if (!approved) {
      throw new Error("ANIME_INDEX_ARTIFACT_URL requires ANIME_INDEX_APPROVED_REPLACEMENT=1.");
    }
    if (!isApprovedOfficialDownloadUrl(artifactUrl)) {
      console.warn(`WARNING: non-official artifact URL (manual approval): ${artifactUrl}`);
    }
    return {
      releaseTag,
      artifact,
      downloadUrl: artifactUrl,
      expectChecksum: null,
      sourceLabel:
        process.env.ANIME_INDEX_SOURCE_LABEL ||
        `approved:${releaseTag}`,
    };
  }

  const downloadUrl = officialReleaseDownloadUrl(releaseTag, artifact);
  if (!isApprovedOfficialDownloadUrl(downloadUrl)) {
    throw new Error(`Refusing download outside official manami-project releases: ${downloadUrl}`);
  }

  let expectChecksum = null;
  if (artifact === OFFICIAL_ARCHIVED_SOURCE.artifactPreferred) {
    expectChecksum = OFFICIAL_ARCHIVED_SOURCE.checksumPreferred;
  } else if (artifact === OFFICIAL_ARCHIVED_SOURCE.artifactFallback) {
    expectChecksum = OFFICIAL_ARCHIVED_SOURCE.checksumJsonl;
  }

  return {
    releaseTag,
    artifact,
    downloadUrl,
    expectChecksum,
    sourceLabel:
      releaseTag === OFFICIAL_ARCHIVED_SOURCE.releaseTag
        ? "official_archived:manami-project/anime-offline-database"
        : process.env.ANIME_INDEX_SOURCE_LABEL || `approved:${releaseTag}`,
  };
}

async function fetchReleaseMetadata(releaseTag) {
  const res = await fetch(
    `https://api.github.com/repos/${OFFICIAL_ARCHIVED_SOURCE.owner}/${OFFICIAL_ARCHIVED_SOURCE.repo}/releases/tags/${releaseTag}`
  );
  if (!res.ok) throw new Error(`Release ${releaseTag} not found (${res.status})`);
  const release = await res.json();
  if (release.draft || release.prerelease) {
    throw new Error(`Release ${releaseTag} is draft/prerelease — refusing.`);
  }
  return release;
}

async function downloadArtifact(source) {
  await mkdir(WORK_DIR, { recursive: true });
  const dest = join(WORK_DIR, source.artifact);
  let jsonlPath = join(WORK_DIR, "anime-offline-database.jsonl");

  if (process.env.ANIME_INDEX_SKIP_DOWNLOAD === "1" && existsSync(jsonlPath)) {
    console.log(`Skipping download — reusing ${jsonlPath}`);
    const entryCount = await countJsonlAnimeEntries(jsonlPath);
    const size = readFileSync(jsonlPath).length;
    console.log(`  ${size} bytes, ${entryCount} anime entries`);
    if (entryCount < 35000) {
      throw new Error(`Cached JSONL has only ${entryCount} entries — delete .work/ and retry without ANIME_INDEX_SKIP_DOWNLOAD.`);
    }
    return { jsonlPath, checksum: "skipped", artifactName: source.artifact };
  }

  console.log(`Downloading ${source.artifact} from ${source.downloadUrl}…`);

  const res = await fetch(source.downloadUrl);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  await pipeline(res.body, createWriteStream(dest));

  const buf = readFileSync(dest);
  const checksum = createHash("sha256").update(buf).digest("hex");
  console.log(`SHA-256: ${checksum}`);

  if (
    source.expectChecksum &&
    process.env.ANIME_INDEX_SKIP_CHECKSUM !== "1" &&
    normalizeChecksum(checksum) !== normalizeChecksum(source.expectChecksum)
  ) {
    throw new Error(
      `Checksum mismatch for ${source.artifact}. Expected ${source.expectChecksum}, got ${checksum}.`
    );
  }

  if (source.artifact.endsWith(".zst")) {
    const decompressed = await decompress(buf);
    writeFileSync(jsonlPath, decompressed);
    const entryCount = await countJsonlAnimeEntries(jsonlPath);
    console.log(`Decompressed → ${jsonlPath} (${decompressed.length} bytes, ${entryCount} anime entries)`);
    if (entryCount < 35000) {
      throw new Error(
        `Decompressed JSONL has only ${entryCount} anime entries (expected ~${OFFICIAL_ARCHIVED_SOURCE.upstreamEntryCount}). Delete ${WORK_DIR} and retry.`
      );
    }
  } else {
    jsonlPath = dest;
  }

  return { jsonlPath, checksum, artifactName: source.artifact };
}

function mapAnimeEntry(entry, version, upstreamLastUpdate) {
  const sources = entry.sources || [];
  const anilistId = extractAnilistId(sources);
  const malId = extractMalId(sources);
  const canonical = String(entry.title || "").trim();
  if (!canonical) return { reject: "empty_title" };

  const synonyms = Array.isArray(entry.synonyms) ? entry.synonyms : [];
  const { english, romaji, native } = classifyTitleFields(canonical, synonyms);
  const startYear = entry.animeSeason?.year ?? null;
  const format = String(entry.type || "UNKNOWN").toUpperCase();
  const normalized = buildNormalizedSearchTerms(canonical, synonyms, [
    english,
    romaji,
    native,
  ]);

  if (!normalized.length) return { reject: "no_search_terms" };

  return {
    row: {
      anilist_id: anilistId,
      mal_id: malId,
      canonical_title: canonical,
      english_title: english || canonical,
      romaji_title: romaji,
      native_title: native,
      synonyms,
      start_year: startYear,
      format,
      provider_urls: sources,
      picture_url: String(entry.picture || entry.thumbnail || ""),
      normalized_search_terms: normalized,
      dataset_version: version,
      upstream_last_update: upstreamLastUpdate,
    },
  };
}

async function loadStaging(supabase, jsonlPath, version) {
  let imported = 0;
  let accepted = 0;
  let rejected = 0;
  let withoutAnilistId = 0;
  let upstreamLastUpdate = null;
  let batch = [];
  const seenKeys = new Set();

  const existingRows = await getStagingCount(supabase);
  const resume = process.env.ETL_RESUME === "1" && existingRows > 0;
  let skipAccepted = resume ? existingRows : 0;

  console.log(`Loading into staging (batch size ${BATCH_SIZE})…`);
  if (resume) {
    console.log(`Resuming — ${existingRows} rows already staged, continuing from there…`);
    accepted = existingRows;
  } else {
    await truncateStaging(supabase);
    await probeStagingInsert(supabase);
  }

  console.log(`Reading ${jsonlPath}…`);
  const lines = readFileSync(jsonlPath, "utf8").split(/\r?\n/);
  console.log(`  ${lines.length} lines in file`);

  async function flushBatch() {
    if (!batch.length) return;
    const batchSize = batch.length;
    const rowHint = accepted + 1;
    await withInsertRetry(async () => {
      const { error } = await supabase.from("anime_title_index_staging").insert(batch);
      return error;
    }, `Staging insert at row ~${rowHint}`);
    accepted += batchSize;
    batch = [];
    console.log(`  staged ${accepted}…`);
    if (BATCH_DELAY_MS > 0) await sleep(BATCH_DELAY_MS);
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      rejected += 1;
      continue;
    }

    if (isDatasetMetadataLine(parsed)) {
      upstreamLastUpdate = parsed.lastUpdate;
      console.log(`Dataset lastUpdate: ${upstreamLastUpdate}`);
      continue;
    }

    imported += 1;
    const mapped = mapAnimeEntry(parsed, version, upstreamLastUpdate);
    if (mapped.reject) {
      rejected += 1;
      continue;
    }

    if (!mapped.row.anilist_id) withoutAnilistId += 1;

    const dedupeKey = mapped.row.anilist_id
      ? `a:${mapped.row.anilist_id}`
      : `t:${mapped.row.canonical_title}:${mapped.row.start_year ?? "x"}`;
    if (seenKeys.has(dedupeKey)) {
      rejected += 1;
      continue;
    }
    seenKeys.add(dedupeKey);

    if (skipAccepted > 0) {
      skipAccepted -= 1;
      continue;
    }

    batch.push(mapped.row);
    if (batch.length >= BATCH_SIZE) await flushBatch();
  }

  await flushBatch();
  console.log(
    `Rows without AniList ID: ${withoutAnilistId} (may need live AniList fallback at match time).`
  );
  return { imported, accepted, rejected, upstreamLastUpdate, withoutAnilistId };
}

function writeInstalledManifest(installed) {
  try {
    const raw = readFileSync(MANIFEST_PATH, "utf8");
    const manifest = JSON.parse(raw);
    manifest.installed = {
      ...manifest.installed,
      ...installed,
    };
    manifest.status = "installed";
    writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    console.log(`Updated ${MANIFEST_PATH}`);
  } catch (err) {
    console.warn("Could not update manifest JSON:", err.message);
  }
}

async function main() {
  const url = requireEnv("SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  await verifySupabase(supabase);

  const source = resolveSourceConfig();
  console.log(`Source: ${source.sourceLabel}`);
  console.log(`Pinned archived upstream — no automatic fork/latest downloads.`);

  await fetchReleaseMetadata(source.releaseTag);

  const { jsonlPath, checksum } = await downloadArtifact(source);
  const { imported, accepted, rejected, upstreamLastUpdate, withoutAnilistId } =
    await loadStaging(supabase, jsonlPath, source.releaseTag);

  console.log(`Imported: ${imported}, accepted: ${accepted}, rejected: ${rejected}`);

  if (imported !== OFFICIAL_ARCHIVED_SOURCE.upstreamEntryCount && source.releaseTag === OFFICIAL_ARCHIVED_SOURCE.releaseTag) {
    console.warn(
      `Warning: parsed ${imported} anime lines; upstream README states ${OFFICIAL_ARCHIVED_SOURCE.upstreamEntryCount}.`
    );
  }

  if (accepted < 35000) {
    throw new Error(`Accepted row count ${accepted} is below minimum guard (35000).`);
  }

  const downloadedAt = new Date().toISOString();
  const notes = [
    source.sourceLabel,
    OFFICIAL_ARCHIVED_SOURCE.archived ? "upstream_archived=true" : "",
    `without_anilist_id=${withoutAnilistId}`,
  ]
    .filter(Boolean)
    .join("; ");

  await withInsertRetry(async () => {
    const { error } = await supabase.rpc("activate_anime_title_index", {
      p_version: source.releaseTag,
      p_upstream_release: source.releaseTag,
      p_upstream_last_update: upstreamLastUpdate || OFFICIAL_ARCHIVED_SOURCE.upstreamLastUpdate,
      p_downloaded_at: downloadedAt,
      p_checksum_sha256: checksum,
      p_imported_rows: imported,
      p_accepted_rows: accepted,
      p_rejected_rows: rejected,
    });
    return error;
  }, "Activation");

  await supabase.from("anime_dataset_meta").update({ notes }).eq("id", 1);

  writeInstalledManifest({
    activeVersion: source.releaseTag,
    upstreamLastUpdate: upstreamLastUpdate || OFFICIAL_ARCHIVED_SOURCE.upstreamLastUpdate,
    acceptedRows: accepted,
    importedRows: imported,
    rejectedRows: rejected,
    rowsWithoutAnilistId: withoutAnilistId,
    checksumSha256: checksum,
    downloadedAt,
    activatedAt: new Date().toISOString(),
    sourceLabel: source.sourceLabel,
    notes: "Upstream repository archived; no automatic updates expected.",
  });

  console.log("Activation complete.");
  console.log(`Active dataset version: ${source.releaseTag}`);

  if (existsSync(WORK_DIR)) {
    try {
      await rm(WORK_DIR, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err);
  process.exit(1);
});
