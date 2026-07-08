"""Pinpoint pull-to-refresh vs title-detail CSS wheel break."""
import http.server
import os
import threading

from playwright.sync_api import sync_playwright

ROOT = os.path.join(os.path.dirname(__file__), "..", "web-files")
PORT = 8783
BASE = ["css/styles.css?v=145", "css/theme.css?v=146"]


def start_server():
    os.chdir(ROOT)
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), http.server.SimpleHTTPRequestHandler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()


def run(page, extra):
    files = BASE + extra
    links = "\n".join(f'<link rel="stylesheet" href="http://127.0.0.1:{PORT}/{f}" />' for f in files)
    cards = "".join(
        f'<article class="card card--linked"><div class="card__media"></div><div class="card__body">'
        f'<h3 class="card__title">T{i}</h3><p>{"w "*30}</p></div></article>'
        for i in range(120)
    )
    html = f"""<!DOCTYPE html><html class="app-ready"><head>{links}
<style>html{{scroll-behavior:auto!important}}</style></head><body>
<div class="app" id="app" data-layout="poster"><main class="main" id="mainContent">
<div class="cards">{cards}</div></main></div></body></html>"""
    page.set_content(html, wait_until="networkidle")
    page.wait_for_timeout(150)
    page.evaluate("window.scrollTo(0,0)")
    y0 = page.evaluate("window.scrollY")
    page.mouse.move(480, 400)
    page.mouse.wheel(0, 900)
    page.wait_for_timeout(200)
    y1 = page.evaluate("window.scrollY")
    return y0, y1


def main():
    start_server()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 967, "height": 800})
        for label, extra in [
            ("base", []),
            ("+pull-to-refresh.css", ["css/pull-to-refresh.css?v=139"]),
            ("+title-detail.css", ["css/title-detail.css?v=150"]),
            ("+both", ["css/pull-to-refresh.css?v=139", "css/title-detail.css?v=150"]),
        ]:
            y0, y1 = run(page, extra)
            print(f"{label:24} wheel {y0} -> {y1} {'BROKEN' if y1 <= y0 else 'OK'}")
        browser.close()


if __name__ == "__main__":
    main()
