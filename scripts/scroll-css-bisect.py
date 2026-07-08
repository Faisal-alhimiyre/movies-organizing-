"""Cumulative CSS bisect for wheel scroll."""
import http.server
import os
import threading

from playwright.sync_api import sync_playwright

ROOT = os.path.join(os.path.dirname(__file__), "..", "web-files")
PORT = 8781

ALL_CSS = [
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


def wheel_delta(page):
    page.evaluate("window.scrollTo(0, 0)")
    page.wait_for_timeout(50)
    y0 = page.evaluate("window.scrollY")
    page.mouse.move(480, 400)
    page.mouse.wheel(0, 800)
    page.wait_for_timeout(150)
    y1 = page.evaluate("window.scrollY")
    return y0, y1


def html_for(css_files):
    links = "\n".join(
        f'<link rel="stylesheet" href="http://127.0.0.1:{PORT}/{href}" />' for href in css_files
    )
    cards = "".join(
        f'<article class="card card--linked"><div class="card__body"><h3 class="card__title">T{i}</h3>'
        f'<p>{"x "*40}</p></div></article>'
        for i in range(120)
    )
    return f"""<!DOCTYPE html><html class="app-ready"><head>{links}</head><body>
<div class="app" id="app" data-layout="poster"><main class="main" id="mainContent">
<div class="cards">{cards}</div></main></div></body></html>"""


def main():
    start_server()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 967, "height": 800})
        active = []
        for href in ALL_CSS:
            active.append(href)
            page.set_content(html_for(active), wait_until="networkidle")
            page.wait_for_timeout(150)
            y0, y1 = wheel_delta(page)
            name = href.split("/")[-1]
            print(f"{'BROKEN' if y1 <= y0 else 'OK    '} + {name:32} {y0} -> {y1}")
        browser.close()


if __name__ == "__main__":
    main()
