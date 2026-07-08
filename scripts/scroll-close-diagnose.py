"""Authenticated desktop scroll diagnosis after title-detail close."""
import json
import os
import http.server
import threading
import time

from playwright.sync_api import sync_playwright

ROOT = os.path.join(os.path.dirname(__file__), "..", "web-files")
PORT = 8777
LIST_ID = "diag-list-1"
ACCOUNT_ID = "diag-account-1"


def start_server():
    os.chdir(ROOT)
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), http.server.SimpleHTTPRequestHandler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def seed_storage(page):
    movies = {
        "Action": [
            {
                "title": f"Scroll Test Movie {i}",
                "summary": "x" * 120,
                "genre": "Action",
            }
            for i in range(40)
        ]
    }
    tv = {
        "Drama": [
            {
                "title": "Scroll Test Series",
                "summary": "y" * 200,
                "genre": "Drama",
                "contentType": "tvSeries",
                "kind": "tv series",
            }
        ]
    }
    page.add_init_script(
        f"""
        window.WATCHLIST_CONFIG = {{ supabaseUrl: '', supabaseAnonKey: '' }};
        localStorage.setItem('watchlist-session-v2', {json.dumps(json.dumps({"accountId": ACCOUNT_ID, "listId": LIST_ID}))});
        localStorage.setItem('watchlist-library-v2-{ACCOUNT_ID}', {json.dumps(json.dumps([{"listId": LIST_ID, "accountId": ACCOUNT_ID, "name": "Diag", "addedAt": 1}]))});
        localStorage.setItem('watchlist-data-v2-{LIST_ID}', {json.dumps(json.dumps({"movies": movies, "tvSeries": tv, "anime": {}}))});
        localStorage.setItem('watchlist-watched-v1-{LIST_ID}', '{{}}');
        """
    )


def main():
    start_server()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        seed_storage(page)
        page.goto(f"http://127.0.0.1:{PORT}/index.html?scrolldebug=1&v=diag", wait_until="domcontentloaded")
        page.wait_for_function("() => document.documentElement.classList.contains('app-ready')", timeout=60000)
        html = page.content()
        if ".card" not in html:
            print("PAGE SNIPPET:", html[:3000])
            state = page.evaluate(
                """() => ({
                  url: location.href,
                  main: document.getElementById('mainContent')?.innerHTML?.slice(0, 500),
                  session: localStorage.getItem('watchlist-session-v2'),
                  sync: window.WatchlistSync?.isConfigured?.(),
                })"""
            )
            print("STATE:", state)
            raise SystemExit(2)
        page.wait_for_selector(".card", timeout=5000)

        before = page.evaluate("window.scrollY")
        page.mouse.wheel(0, 900)
        time.sleep(0.2)
        mid = page.evaluate("window.scrollY")
        assert mid > before, f"pre-open scroll failed {before}->{mid}"

        card = page.locator(".card").first
        card.click()
        page.wait_for_selector("#titleDetailOverlay.td-is-open", timeout=10000)
        time.sleep(0.3)

        page.locator("#tdCloseBtn").click()
        page.wait_for_function(
            "() => !window.WatchlistTitleDetail?.isOpen?.()",
            timeout=10000,
        )
        time.sleep(0.6)

        diag = page.evaluate("window.__scrollDiagAfterClose || null")
        print("DIAG:", json.dumps(diag, indent=2))

        y0 = page.evaluate("window.scrollY")
        page.mouse.wheel(0, 600)
        time.sleep(0.2)
        y1 = page.evaluate("window.scrollY")
        print(f"scroll after close: {y0} -> {y1}")

        hit = page.evaluate(
            """
            () => {
              const el = document.elementFromPoint(640, 400);
              return el ? { tag: el.tagName, id: el.id, className: String(el.className).slice(0, 80) } : null;
            }
            """
        )
        print("elementFromPoint(640,400):", hit)

        if y1 <= y0 and mid > 0:
            raise SystemExit(1)
        browser.close()
        print("PASS")


if __name__ == "__main__":
    main()
