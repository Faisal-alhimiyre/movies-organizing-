#!/usr/bin/env python3
"""Upload data/watchlist.json into Supabase for your personal list code.

Usage:
  python scripts/seed_supabase.py your-personal-code
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WATCHLIST_PATH = ROOT / "data" / "watchlist.json"
CONFIG_PATH = ROOT / "js" / "config.js"
MIN_CODE_LENGTH = 6


def normalize_code(code: str) -> str:
    return code.strip().lower()


def validate_code(code: str) -> None:
    if re.search(r"\s", code):
        raise SystemExit("Spaces are not allowed.")

    normalized = normalize_code(code)

    if len(normalized) < MIN_CODE_LENGTH:
        raise SystemExit(f"Use a code with at least {MIN_CODE_LENGTH} characters.")

    if not re.search(r"[a-z]", normalized):
        raise SystemExit("Use at least one letter.")

    if not re.search(r"\d", normalized):
        raise SystemExit("Use at least one number.")


def list_id_from_code(code: str) -> str:
    code = normalize_code(code)
    hash_value = 5381
    for char in code:
        hash_value = ((hash_value * 33) ^ ord(char)) & 0xFFFFFFFF

    digits = "0123456789abcdefghijklmnopqrstuvwxyz"

    def to_base36(number: int) -> str:
        if number == 0:
            return "0"
        out: list[str] = []
        while number:
            number, remainder = divmod(number, 36)
            out.append(digits[remainder])
        return "".join(reversed(out))

    return "l" + to_base36(hash_value)


def parse_leads(entry: dict) -> list[str]:
    leads = entry.get("leads")
    if isinstance(leads, list) and leads:
        return [str(name).strip() for name in leads if str(name).strip()]
    lead = entry.get("lead")
    if lead:
        return [part.strip() for part in str(lead).split(",") if part.strip()]
    return []


def default_kind(content_type: str, kind: str | None) -> str:
    if kind == "franchise":
        return "film series"
    if kind:
        return kind
    return "movie" if content_type == "movies" else "series"


def read_config() -> tuple[str, str]:
    text = CONFIG_PATH.read_text(encoding="utf-8")
    url_match = re.search(r'supabaseUrl:\s*"([^"]*)"', text)
    key_match = re.search(r'supabaseAnonKey:\s*"([^"]*)"', text)

    if not url_match or not key_match:
        raise SystemExit("Could not read supabaseUrl/supabaseAnonKey from js/config.js")

    url = url_match.group(1).strip()
    key = key_match.group(1).strip()

    if not url or not key:
        raise SystemExit("Set supabaseUrl and supabaseAnonKey in js/config.js first.")

    return url.rstrip("/"), key


def supabase_request(
    base_url: str,
    api_key: str,
    method: str,
    path: str,
    payload: list | dict | None = None,
    prefer: str | None = None,
) -> None:
    headers = {
        "apikey": api_key,
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer

    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")

    request = urllib.request.Request(
        f"{base_url}/rest/v1/{path}",
        data=data,
        headers=headers,
        method=method,
    )

    try:
        with urllib.request.urlopen(request) as response:
            response.read()
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise SystemExit(f"Supabase error {error.code} on {method} {path}: {body}") from error


def watchlist_to_rows(list_id: str, watchlist: dict) -> list[dict]:
    rows: list[dict] = []
    now = datetime.now(timezone.utc).isoformat()

    for content_type, genres in watchlist.items():
        if not isinstance(genres, dict):
            continue

        for genre, titles in genres.items():
            if not isinstance(titles, list):
                continue

            for entry in titles:
                title = entry.get("title")
                if not title:
                    continue

                leads = parse_leads(entry)
                item_id = f"{content_type}::{genre}::{title}"

                rows.append(
                    {
                        "list_id": list_id,
                        "item_id": item_id,
                        "content_type": content_type,
                        "genre": genre,
                        "title": title,
                        "kind": default_kind(content_type, entry.get("kind")),
                        "lead": entry.get("lead") or ", ".join(leads),
                        "leads": leads,
                        "summary": entry.get("summary") or entry.get("reminder") or "",
                        "link": entry.get("link") or "",
                        "secondary_genres": entry.get("secondaryGenres") or [],
                        "poster": entry.get("poster") or "",
                        "imdb_rating": entry.get("imdbRating") or "",
                        "anilist_rating": entry.get("anilistRating") or "",
                        "year": entry.get("year") or "",
                        "watched": False,
                        "watch_rating": None,
                        "watch_note": "",
                        "updated_at": now,
                    }
                )

    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed Supabase from watchlist.json")
    parser.add_argument(
        "code",
        help="Your personal list code (same one you use to sign in)",
    )
    args = parser.parse_args()

    code = args.code
    validate_code(code)

    if not WATCHLIST_PATH.exists():
        raise SystemExit(f"Missing {WATCHLIST_PATH}")

    watchlist = json.loads(WATCHLIST_PATH.read_text(encoding="utf-8-sig"))
    base_url, api_key = read_config()
    account_id = list_id_from_code(code)
    list_id = account_id
    rows = watchlist_to_rows(list_id, watchlist)
    now = datetime.now(timezone.utc).isoformat()

    print(f"Seeding account {account_id!r}, list {list_id!r} with {len(rows)} titles...")

    supabase_request(
        base_url,
        api_key,
        "POST",
        "accounts",
        {"account_id": account_id, "updated_at": now},
        prefer="resolution=merge-duplicates",
    )

    supabase_request(
        base_url,
        api_key,
        "POST",
        "lists",
        {
            "list_id": list_id,
            "account_id": account_id,
            "name": "My list",
            "description": "",
            "updated_at": now,
        },
        prefer="resolution=merge-duplicates",
    )

    supabase_request(
        base_url,
        api_key,
        "DELETE",
        f"watchlist_items?list_id=eq.{list_id}",
    )

    batch_size = 50
    for index in range(0, len(rows), batch_size):
        batch = rows[index : index + batch_size]
        supabase_request(base_url, api_key, "POST", "watchlist_items", batch)

    print(f"Done. Uploaded {len(rows)} rows for code {code!r}.")


if __name__ == "__main__":
    main()
