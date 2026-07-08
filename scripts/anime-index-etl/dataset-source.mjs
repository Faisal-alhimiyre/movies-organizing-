/**
 * Pinned official archived release — manami-project/anime-offline-database
 * Verified 2026-07-04 via GitHub API (repository archived: true).
 *
 * Do NOT auto-switch to "latest" or unverified forks.
 * Override only with ANIME_INDEX_APPROVED_REPLACEMENT=1.
 */

export const OFFICIAL_ARCHIVED_SOURCE = {
  owner: "manami-project",
  repo: "anime-offline-database",
  archived: true,
  releaseTag: "2026-27",
  publishedAt: "2026-07-04T15:39:29Z",
  upstreamLastUpdate: "2026-07-04",
  upstreamEntryCount: 41537,
  artifactPreferred: "anime-offline-database.jsonl.zst",
  artifactFallback: "anime-offline-database.jsonl",
  checksumPreferred:
    "9ed7e3fd8f0f47b63d977e915a555b7f6e552a7a25a465773451dbccd9cb8e03",
  checksumJsonl:
    "8a63189782176fe19e00eca275288ba855ce54d6cb4d7ae97ec71450f861b1aa",
  allowedDownloadHost: "github.com",
  allowedDownloadPathPrefix:
    "/manami-project/anime-offline-database/releases/download/",
};

export function officialReleaseDownloadUrl(releaseTag, artifactName) {
  return `https://github.com/${OFFICIAL_ARCHIVED_SOURCE.owner}/${OFFICIAL_ARCHIVED_SOURCE.repo}/releases/download/${releaseTag}/${artifactName}`;
}

export function isApprovedOfficialDownloadUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== OFFICIAL_ARCHIVED_SOURCE.allowedDownloadHost) return false;
    return u.pathname.startsWith(OFFICIAL_ARCHIVED_SOURCE.allowedDownloadPathPrefix);
  } catch {
    return false;
  }
}

export function normalizeChecksum(digest) {
  return String(digest || "")
    .replace(/^sha256:/i, "")
    .toLowerCase();
}
