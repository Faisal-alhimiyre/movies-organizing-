"""Minimal title-detail open/close wheel scroll test (no auth gate)."""
import http.server
import os
import threading
import time

from playwright.sync_api import sync_playwright

ROOT = os.path.join(os.path.dirname(__file__), "..", "web-files")
PORT = 8778


def start_server():
    os.chdir(ROOT)
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), http.server.SimpleHTTPRequestHandler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def main():
    start_server()
    cards = "".join(
        f'<article class="card" data-id="c{i}" style="min-height:220px"><div class="card__body"><h3 class="card__title">Title {i}</h3><p>{"x"*80}</p></div></article>'
        for i in range(80)
    )
    html = f"""<!DOCTYPE html>
<html class="app-ready"><head>
<link rel="stylesheet" href="http://127.0.0.1:{PORT}/css/styles.css?v=152" />
<link rel="stylesheet" href="http://127.0.0.1:{PORT}/css/theme.css?v=152" />
<link rel="stylesheet" href="http://127.0.0.1:{PORT}/css/title-detail.css?v=150" />
<style>body{{margin:0}} .cards{{display:grid;grid-template-columns:repeat(5,1fr);gap:1rem}}</style>
</head><body>
<main class="main" id="mainContent"><div class="cards">{cards}</div></main>
<script src="http://127.0.0.1:{PORT}/js/i18n.js?v=1"></script>
<script src="http://127.0.0.1:{PORT}/js/title-detail.js?v=152"></script>
<script>
window.WatchlistApp = {{
  closeAllMenus: () => {{}},
  updateBodyScrollLock: () => {{}},
  queueItemBadgeEnrichment: () => {{}},
}};
window.WatchlistI18n = {{ t: (k) => k, onChange: () => {{}}, isolateLtr: (t) => t }};
document.querySelectorAll('.card').forEach((card, i) => {{
  card.addEventListener('click', () => window.WatchlistTitleDetail.open(card));
}});
</script>
</body></html>"""

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 967, "height": 800})
        page.set_content(html, wait_until="domcontentloaded")
        page.wait_for_timeout(300)

        before = page.evaluate("window.scrollY")
        page.mouse.wheel(0, 700)
        page.wait_for_timeout(150)
        mid = page.evaluate("window.scrollY")
        assert mid > before, f"pre-open wheel failed: {before} -> {mid}"

        page.locator(".card").first.click()
        page.wait_for_selector("#titleDetailOverlay.td-is-open")
        page.wait_for_timeout(200)

        page.locator("#tdCloseBtn").click()
        page.wait_for_function("() => !window.WatchlistTitleDetail.isOpen()")
        page.wait_for_timeout(500)

        active = page.evaluate(
            """() => {
              const el = document.activeElement;
              return el ? { tag: el.tagName, id: el.id || null } : null;
            }"""
        )
        overflow = page.evaluate(
            """() => ({
              html: getComputedStyle(document.documentElement).overflow,
              body: getComputedStyle(document.body).overflow,
            })"""
        )

        y0 = page.evaluate("window.scrollY")
        page.mouse.wheel(0, 500)
        page.wait_for_timeout(150)
        y1 = page.evaluate("window.scrollY")

        print("activeElement after close:", active)
        print("overflow after close:", overflow)
        print(f"wheel after close: {y0} -> {y1}")

        browser.close()
        if y1 <= y0:
            raise SystemExit(1)
        print("PASS")


if __name__ == "__main__":
    main()
