"""Authenticated open/close scroll verification (local-only, no Supabase)."""
import json
import os
import http.server
import threading
import time

from playwright.sync_api import sync_playwright

ROOT = os.path.join(os.path.dirname(__file__), "..", "web-files")
PORT = 8780
LIST_ID = "scroll-test-list"
ACCOUNT_ID = "scroll-test-acct"


def start_server():
    os.chdir(ROOT)
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), http.server.SimpleHTTPRequestHandler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()


def main():
    start_server()
    movies = {
        "Action": [
            {"title": f"Movie {i}", "summary": "x" * 120, "genre": "Action"}
            for i in range(40)
        ]
    }
    tv = {
        "Drama": [
            {
                "title": "TV Scroll Test",
                "summary": "y" * 200,
                "genre": "Drama",
                "contentType": "tvSeries",
            }
        ]
    }

    with sync_playwright() as p:
        for engine in ("chromium", "webkit"):
            browser = getattr(p, engine).launch()
            context = browser.new_context(viewport={"width": 1280, "height": 800})
            page = context.new_page()

            page.route(
                "**/js/config.js",
                lambda route: route.fulfill(
                    body="window.WATCHLIST_CONFIG = { omdbApiKey: 'thewdb', supabaseUrl: '', supabaseAnonKey: '' };",
                    content_type="application/javascript",
                ),
            )
            page.add_init_script(
                f"""
                localStorage.setItem('watchlist-session-v2', {json.dumps(json.dumps({"accountId": ACCOUNT_ID, "listId": LIST_ID}))});
                localStorage.setItem('watchlist-library-v2-{ACCOUNT_ID}', {json.dumps(json.dumps([{"listId": LIST_ID, "accountId": ACCOUNT_ID, "name": "Test"}]))});
                localStorage.setItem('watchlist-data-v2-{LIST_ID}', {json.dumps(json.dumps({"movies": movies, "tvSeries": tv, "anime": {}}))});
                localStorage.setItem('watchlist-watched-v1-{LIST_ID}', '{{}}');
                """
            )

            page.goto(f"http://127.0.0.1:{PORT}/index.html?scrolldebug=1", wait_until="domcontentloaded")
            page.wait_for_function(
                "() => document.documentElement.classList.contains('app-ready') && document.querySelector('.card')",
                timeout=120000,
            )

            page.mouse.wheel(0, 700)
            time.sleep(0.15)
            assert page.evaluate("window.scrollY") > 100, f"{engine}: baseline scroll failed"

            page.locator(".card").first.click()
            page.wait_for_selector("#titleDetailOverlay.td-is-open")
            time.sleep(0.3)

            page.locator("#tdCloseBtn").click()
            page.wait_for_function("() => !window.WatchlistTitleDetail?.isOpen?.()")
            time.sleep(0.6)

            state = page.evaluate(
                """() => {
                  const o = document.getElementById('titleDetailOverlay');
                  const os = o ? getComputedStyle(o) : null;
                  const el = document.elementFromPoint(innerWidth/2, innerHeight/2);
                  return {
                    htmlOverflowComputed: getComputedStyle(document.documentElement).overflow,
                    bodyOverflowComputed: getComputedStyle(document.body).overflow,
                    bodyPosition: document.body.style.position,
                    overlayDisplay: os?.display,
                    overlayPointerEvents: os?.pointerEvents,
                    openModals: window.WatchlistApp?.getOpenModalNames?.(),
                    hit: el ? { tag: el.tagName, id: el.id, class: String(el.className).slice(0,60) } : null,
                    diag: window.__scrollDiagAfterClose,
                  };
                }"""
            )

            y0 = page.evaluate("window.scrollY")
            page.mouse.wheel(0, 500)
            time.sleep(0.15)
            y1 = page.evaluate("window.scrollY")

            print(f"\n=== {engine} ===")
            print(json.dumps(state, indent=2))
            print(f"scroll delta after close: {y1 - y0}")

            if state["overlayDisplay"] != "none":
                raise SystemExit(f"{engine}: overlay still {state['overlayDisplay']}")
            if state["htmlOverflowComputed"] == "hidden" or state["bodyOverflowComputed"] == "hidden":
                raise SystemExit(f"{engine}: overflow still hidden")
            if y1 <= y0:
                raise SystemExit(f"{engine}: no scroll after close")

            browser.close()

        print("\nALL ENGINES PASS")


if __name__ == "__main__":
    main()
