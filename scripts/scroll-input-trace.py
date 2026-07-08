"""Collect scroll-input-diag console output after detail close."""
import json
import os
import http.server
import threading
import time

from playwright.sync_api import sync_playwright

ROOT = os.path.join(os.path.dirname(__file__), "..", "web-files")
PORT = 8781
LIST_ID = "diag-input"
ACCOUNT_ID = "diag-input-acct"
LOGS = []


def start_server():
    os.chdir(ROOT)
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), http.server.SimpleHTTPRequestHandler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()


def main():
    start_server()
    movies = {
        "Action": [
            {"title": f"Movie {i}", "summary": "x" * 120, "genre": "Action"}
            for i in range(35)
        ]
    }

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 967, "height": 800})

        page.on("console", lambda msg: LOGS.append(msg.text) if "[scroll-input-diag]" in msg.text else None)
        page.route("**/sw.js", lambda r: r.fulfill(status=404))
        page.route(
            "**/js/config.js",
            lambda r: r.fulfill(
                body="window.WATCHLIST_CONFIG={omdbApiKey:'x',supabaseUrl:'',supabaseAnonKey:''};",
                content_type="application/javascript",
            ),
        )
        page.add_init_script(
            f"""
            localStorage.setItem('watchlist-session-v2', {json.dumps(json.dumps({"accountId": ACCOUNT_ID, "listId": LIST_ID}))});
            localStorage.setItem('watchlist-library-v2-{ACCOUNT_ID}', {json.dumps(json.dumps([{"listId": LIST_ID, "accountId": ACCOUNT_ID, "name": "T"}]))});
            localStorage.setItem('watchlist-data-v2-{LIST_ID}', {json.dumps(json.dumps({"movies": movies, "tvSeries": {}, "anime": {}}))});
            localStorage.setItem('watchlist-watched-v1-{LIST_ID}', '{{}}');
            """
        )

        page.goto(f"http://127.0.0.1:{PORT}/index.html?scrolldebug=1", wait_until="domcontentloaded")
        page.wait_for_function(
            "() => document.documentElement.classList.contains('app-ready') && document.querySelector('.card')",
            timeout=90000,
        )

        page.mouse.wheel(0, 400)
        time.sleep(0.2)
        page.evaluate(
            """() => {
              const card = document.querySelector('.card');
              if (card) window.WatchlistTitleDetail?.open?.(card);
            }"""
        )
        page.wait_for_selector("#titleDetailOverlay.td-is-open")
        time.sleep(0.3)
        page.locator("#tdCloseBtn").click()
        page.wait_for_function("() => !window.WatchlistTitleDetail?.isOpen?.()")
        time.sleep(0.8)

        prog = page.evaluate("() => window.__scrollInputDiag?.results?.programmaticScroll")
        y0 = page.evaluate("window.scrollY")
        page.mouse.wheel(0, 400)
        time.sleep(0.3)
        y1 = page.evaluate("window.scrollY")
        page.evaluate("window.__scrollInputDiag?.armWheelSampleOnNextInput?.()")
        page.mouse.wheel(0, 400)
        time.sleep(1.2)

        prevent = page.evaluate("() => window.__scrollInputDiag?.results?.preventDefaultCalls || []")
        scrollCalls = page.evaluate("() => window.__scrollInputDiag?.results?.scrollCalls || []")
        inputEvents = page.evaluate("() => window.__scrollInputDiag?.results?.inputEvents || []")

        print("PROGRAMMATIC:", json.dumps(prog, indent=2))
        print(f"WHEEL scrollY: {y0} -> {y1}")
        print(f"preventDefault calls: {len(prevent)}")
        for p in prevent[:5]:
            print("  PD:", p.get("type"), p.get("target"), p.get("stack", [])[:2])
        print(f"scroll API calls after close: {len(scrollCalls)}")
        for s in scrollCalls[-5:]:
            print("  SC:", s.get("api"), s.get("args"), s.get("scrollYBefore"))
        print(f"input events captured: {len(inputEvents)}")
        for e in inputEvents[:8]:
            print("  IN:", e.get("type"), e.get("phase"), e.get("defaultPrevented"))

        print("\n--- console logs ---")
        for line in LOGS:
            if any(k in line for k in ("programmatic-scroll", "preventDefault", "scroll-api", "input-", "listener-audit")):
                print(line[:500])

        browser.close()


if __name__ == "__main__":
    main()
