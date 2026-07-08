#!/usr/bin/env node
/**
 * Verify offline index matching for canonical bulk-import titles.
 * Run: npm run test:titles
 * With SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY: also tests live edge function.
 */

import { createClient } from "@supabase/supabase-js";
import {
  autoPickScored,
  scoreIndexRow,
} from "../../shared/anime-title-match.mjs";

const FIXTURES = [
  {
    name: "Code Geass",
    query: { title: "Code Geass", year: 2006 },
    row: {
      anilist_id: 1575,
      canonical_title: "Code Geass: Hangyaku no Lelouch",
      english_title: "Code Geass: Lelouch of the Rebellion",
      romaji_title: "Code Geass: Hangyaku no Lelouch",
      native_title: "コードギアス 反逆のルルーシュ",
      synonyms: ["Code Geass"],
      start_year: 2006,
      format: "TV",
    },
  },
  {
    name: "Summertime Rendering",
    query: { title: "Summertime Rendering", year: 2022 },
    row: {
      anilist_id: 129201,
      canonical_title: "Summertime Render",
      english_title: "Summer Time Rendering",
      romaji_title: "Summertime Render",
      native_title: "サマータイムレンダ",
      synonyms: ["Summertime Rendering"],
      start_year: 2022,
      format: "TV",
    },
  },
  {
    name: "Future Diary",
    query: { title: "Future Diary", year: 2011 },
    row: {
      anilist_id: 10620,
      canonical_title: "Mirai Nikki",
      english_title: "The Future Diary",
      romaji_title: "Mirai Nikki",
      native_title: "未来日記",
      synonyms: ["Future Diary"],
      start_year: 2011,
      format: "TV",
    },
  },
  {
    name: "86",
    query: { title: "86", year: 2021 },
    row: {
      anilist_id: 116589,
      canonical_title: "86 Eighty-Six",
      english_title: "86 Eighty-Six",
      romaji_title: "86 Eighty-Six",
      native_title: "８６―エイティシックス―",
      synonyms: ["86"],
      start_year: 2021,
      format: "TV",
    },
  },
  {
    name: "Seraph of the End",
    query: { title: "Seraph of the End", year: 2015 },
    row: {
      anilist_id: 20829,
      canonical_title: "Owari no Seraph",
      english_title: "Seraph of the End: Vampire Reign",
      romaji_title: "Owari no Seraph",
      native_title: "終わりのセラフ",
      synonyms: ["Seraph of the End"],
      start_year: 2015,
      format: "TV",
    },
  },
  {
    name: "KonoSuba",
    query: { title: "KonoSuba", year: 2016 },
    row: {
      anilist_id: 21202,
      canonical_title: "Kono Subarashii Sekai ni Syukufuku wo!",
      english_title: "KonoSuba: God's Blessing on This Wonderful World!",
      romaji_title: "Kono Subarashii Sekai ni Syukufuku wo!",
      native_title: "この素晴らしい世界に祝福を！",
      synonyms: ["KonoSuba"],
      start_year: 2016,
      format: "TV",
    },
  },
  {
    name: "Naruto",
    query: { title: "Naruto", year: 2002 },
    row: {
      anilist_id: 20,
      canonical_title: "Naruto",
      english_title: "Naruto",
      romaji_title: "Naruto",
      native_title: "ナルト",
      synonyms: [],
      start_year: 2002,
      format: "TV",
    },
  },
  {
    name: "Naruto: Shippuden",
    query: { title: "Naruto: Shippuden", year: 2007 },
    row: {
      anilist_id: 1735,
      canonical_title: "Naruto: Shippuuden",
      english_title: "Naruto Shippuden",
      romaji_title: "Naruto: Shippuuden",
      native_title: "ナルト 疾風伝",
      synonyms: ["Naruto: Shippuden"],
      start_year: 2007,
      format: "TV",
    },
  },
];

function testLocalScoring() {
  let passed = 0;
  for (const fx of FIXTURES) {
    const scored = [{ row: fx.row, ...scoreIndexRow(fx.row, fx.query) }];
    const auto = autoPickScored(scored, fx.query);
    const ok = auto.pick && auto.score >= 95;
    console.log(`${ok ? "✓" : "✗"} ${fx.name} → score ${auto.score} (${auto.reason})`);
    if (ok) passed += 1;
  }
  console.log(`Local scoring: ${passed}/${FIXTURES.length}`);
  if (passed !== FIXTURES.length) process.exitCode = 1;
}

async function testEdgeFunction() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log("Skipping edge tests (SUPABASE_URL / SERVICE_ROLE_KEY not set).");
    return;
  }

  const sb = createClient(url, key);
  let passed = 0;
  for (const fx of FIXTURES) {
    const { data, error } = await sb.functions.invoke("anime-index-search", {
      body: {
        action: "search",
        title: fx.query.title,
        year: fx.query.year,
        limit: 10,
      },
    });
    if (error) {
      console.log(`✗ ${fx.name} edge error:`, error.message);
      continue;
    }
    const pickId = data?.pick?.anilist_id || data?.pick?.anilistId;
    const ok = pickId === fx.row.anilist_id;
    console.log(
      `${ok ? "✓" : "✗"} ${fx.name} edge → ${pickId || "none"} (expected ${fx.row.anilist_id})`
    );
    if (ok) passed += 1;
  }
  console.log(`Edge function: ${passed}/${FIXTURES.length}`);
  if (passed !== FIXTURES.length) process.exitCode = 1;
}

testLocalScoring();
await testEdgeFunction();
