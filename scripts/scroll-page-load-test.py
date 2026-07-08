"""Page-load desktop wheel scroll test with full CSS stack."""
import http.server
import os
import threading

from playwright.sync_api import sync_playwright

ROOT = os.path.join(os.path.dirname(__file__), "..", "web-files")
PORT = 8779

CSS = [
    "css/styles.css?v=145",
    "css/theme.css?v=146",
    "css/theme-light.css?v=139",
    "css/theme-purple.css?v=139",
    "css/theme-brown.css?v=139",
    "css/theme-pink.css?v=139",
    "css/theme-consistency.css?v=139",
    "css/typography.css?v=139",
    "css/reduced-motion.css?v=139",
    "css/accessibility.css?v=139",
    "css/rtl.css?v=139",
    "css/title-detail.css?v=150",
    "css/title-seasons.css?v=139",
    "css/pull-to-refresh.css?v=139",
]


def start_server():
    os.chdir(ROOT)
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), http.server.SimpleHTTPRequestHandler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def main():
    start_server()
    links = "\n".join(
        f'<link rel="stylesheet" href="http://127.0.0.1:{PORT}/{href}" />' for href in CSS
    )
    cards = "".join(
        f'<article class="card card--linked" data-id="c{i}"><div class="card__media"></div>'
        f'<div class="card__body"><h3 class="card__title">Anime Title {i}</h3>'
        f'<p class="card__summary">{"summary text " * 30}</p></div></article>'
        for i in range(100)
    )
    html = f"""<!DOCTYPE html>
<html class="app-ready"><head>{links}</head>
<body>
<div class="app" id="app" data-layout="poster">
<header class="header" style="margin-bottom:1rem"><h1 class="header__title">Watchlist</h1></header>
<main class="main" id="mainContent">
<section class="genre-section genre-section--all-match">
<div class="genre-section__header"><h2 class="genre-section__title">ANIME</h2><span class="genre-section__count">100</span></div>
<div class="cards">{cards}</div>
</section>
</main>
</div>
<script src="http://127.0.0.1:{PORT}/js/pull-to-refresh.js?v=139"></script>
<script>window.WatchlistApp={{canPullToRefresh:()=>true,isPullToRefreshActive:()=>false}};window.WatchlistPullRefresh.init();</script>
</body></html>"""

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 967, "height": 800})
        page.set_content(html, wait_until="networkidle")
        page.wait_for_timeout(400)

        metrics = page.evaluate(
            """() => ({
              scrollY: window.scrollY,
              htmlOverflow: getComputedStyle(document.documentElement).overflow,
              bodyOverflow: getComputedStyle(document.body).overflow,
              htmlTouchAction: getComputedStyle(document.documentElement).touchAction,
              bodyTouchAction: getComputedStyle(document.body).touchAction,
              htmlScrollHeight: document.documentElement.scrollHeight,
              clientHeight: document.documentElement.clientHeight,
              cardOverflow: getComputedStyle(document.querySelector('.card')).overflow,
              cardsHeight: getComputedStyle(document.querySelector('.cards')).height,
              cardHeight: getComputedStyle(document.querySelector('.card')).height,
            })"""
        )
        print("METRICS:", metrics)

        y0 = page.evaluate("window.scrollY")
        page.mouse.move(480, 400)
        page.mouse.wheel(0, 800)
        page.wait_for_timeout(200)
        y1 = page.evaluate("window.scrollY")
        print(f"wheel at center: {y0} -> {y1}")

        # drag scrollbar via keyboard PageDown as alternate input
        page.keyboard.press("PageDown")
        page.wait_for_timeout(150)
        y2 = page.evaluate("window.scrollY")
        print(f"PageDown: {y1} -> {y2}")

        browser.close()
        if y1 <= y0 and metrics["htmlScrollHeight"] > metrics["clientHeight"]:
            raise SystemExit(1)
        print("PASS")


if __name__ == "__main__":
    main()
