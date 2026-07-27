/**
 * Regression: idle metadata backfill must never call full render().
 * Run: cd web-files && npm test -- usability-backfill.test.js
 */
"use strict";

const fs = require("fs");
const path = require("path");

const appSrc = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}`);
  if (start < 0) {
    const asyncStart = src.indexOf(`async function ${name}`);
    if (asyncStart < 0) return null;
    return sliceBalanced(src, asyncStart);
  }
  return sliceBalanced(src, start);
}

function sliceBalanced(src, start) {
  const brace = src.indexOf("{", start);
  if (brace < 0) return null;
  let depth = 0;
  for (let i = brace; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

describe("usability: backfill must not full-render", () => {
  test("persistBackfillItem patches via syncListCard only", () => {
    const body = extractFunction(appSrc, "persistBackfillItem");
    expect(body).toBeTruthy();
    expect(body).toMatch(/syncListCard/);
    expect(body).not.toMatch(/\brender\s*\(/);
    expect(body).not.toMatch(/fullRender/);
  });

  test("year / ratings / title-meta / episode-total backfills avoid render()", () => {
    for (const name of [
      "backfillMissingYears",
      "backfillMissingRatings",
      "backfillTitleMeta",
      "backfillEpisodeTotals",
      "runMetadataBackfill",
    ]) {
      const body = extractFunction(appSrc, name);
      expect(body).toBeTruthy();
      expect(body).not.toMatch(/\brender\s*\(/);
    }
  });

  test("single in-flight metadata backfill gate exists", () => {
    expect(appSrc).toMatch(/let metadataBackfillRunning = false/);
    expect(appSrc).toMatch(/shouldAbortIdleBackfill/);
  });
});
