import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LINKS = json.loads(
    (Path(__file__).parent / "imdb-links.json").read_text(encoding="utf-8")
)

watchlist_path = ROOT / "data" / "watchlist.json"
watchlist = json.loads(watchlist_path.read_text(encoding="utf-8-sig"))

missing = []
count = 0
for genres in watchlist.values():
    for titles in genres.values():
        for entry in titles:
            url = LINKS.get(entry["title"])
            if url:
                entry["link"] = url
                count += 1
            else:
                missing.append(entry["title"])

if missing:
    raise SystemExit("Missing links for: " + ", ".join(missing))

text = json.dumps(watchlist, indent=2, ensure_ascii=False) + "\n"
watchlist_path.write_text(text, encoding="utf-8")
(ROOT / "js" / "data.js").write_text(f"window.WATCHLIST = {text[:-1]};\n", encoding="utf-8")
print(f"Linked {count} titles")
