"""Fetch OMDB posters and ratings into watchlist.json (optional offline poster mode).

Usage:
  set OMDB_API_KEY=your_key
  python scripts/fetch_posters.py
"""

import json
import os
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WATCHLIST = ROOT / "data" / "watchlist.json"
IMDB_ID = re.compile(r"tt\d{7,8}", re.I)


def omdb_lookup(imdb_id: str, api_key: str) -> dict | None:
    query = urllib.parse.urlencode({"i": imdb_id, "apikey": api_key})
    with urllib.request.urlopen(f"https://www.omdbapi.com/?{query}", timeout=20) as res:
        data = json.loads(res.read().decode("utf-8"))
    if data.get("Response") != "True":
        return None
    poster = data.get("Poster")
    return {
        "poster": poster if poster and poster != "N/A" else None,
        "imdbRating": data.get("imdbRating") if data.get("imdbRating") != "N/A" else None,
        "year": data.get("Year") if data.get("Year") != "N/A" else None,
    }


def main() -> None:
    api_key = os.environ.get("OMDB_API_KEY", "thewdb").strip()
    if not api_key:
        raise SystemExit("Set OMDB_API_KEY to your free key from https://www.omdbapi.com/apikey.aspx")

    watchlist = json.loads(WATCHLIST.read_text(encoding="utf-8-sig"))
    updated = 0

    for genres in watchlist.values():
        for titles in genres.values():
            for entry in titles:
                link = entry.get("link", "")
                match = IMDB_ID.search(link or "")
                if not match:
                    continue
                if entry.get("poster"):
                    continue

                meta = omdb_lookup(match.group(0).lower(), api_key)
                if not meta:
                    print(f"Skip: {entry.get('title')}")
                    time.sleep(0.25)
                    continue

                if meta.get("poster"):
                    entry["poster"] = meta["poster"]
                if meta.get("imdbRating"):
                    entry["imdbRating"] = meta["imdbRating"]
                if meta.get("year"):
                    entry["year"] = meta["year"]
                updated += 1
                print(f"OK: {entry.get('title')}")
                time.sleep(0.25)

    text = json.dumps(watchlist, indent=2, ensure_ascii=False) + "\n"
    WATCHLIST.write_text(text, encoding="utf-8")
    (ROOT / "js" / "data.js").write_text(f"window.WATCHLIST = {text[:-1]};\n", encoding="utf-8")
    print(f"Updated {updated} titles")


if __name__ == "__main__":
    main()
