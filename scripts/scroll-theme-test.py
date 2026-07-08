"""Test wheel scroll from top with styles+theme only."""
import http.server
import os
import threading

from playwright.sync_api import sync_playwright

ROOT = os.path.join(os.path.dirname(__file__), "..", "web-files")
PORT = 8782


def start_server():
    os.chdir(ROOT)
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), http.server.SimpleHTTPRequestHandler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()


def test_combo(name, css_files, layout="poster", cards=120):
    links = "\n".join(
        f'<link rel="stylesheet" href="http://127.0.0.1:{PORT}/{href}" />' for href in css_files
    )
    cards_html = "".join(
        f'<article class="card card--linked"><div class="card__media"></div><div class="card__body">'
        f'<h3 class="card__title">Title {i}</h3><p class="card__summary">{"word "*25}</p></div></article>'
        for i in range(cards)
    )
    html = f"""<!DOCTYPE html><html class="app-ready"><head>{links}
<style>html {{ scroll-behavior: auto !important; }}</style></head><body>
<div class="app" id="app" data-layout="{layout}"><main class="main" id="mainContent">
<div class="cards">{cards_html}</div></main></div></body></html>"""
    return html


def main():
    start_server()
    combos = [
        ("styles only", ["css/styles.css?v=145"]),
        ("styles+theme", ["css/styles.css?v=145", "css/theme.css?v=146"]),
        ("full stack", [
            "css/styles.css?v=145",
            "css/theme.css?v=146",
            "css/pull-to-refresh.css?v=139",
            "css/title-detail.css?v=150",
        ]),
    ]
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 967, "height": 800})
        for name, files in combos:
            page.set_content(test_combo(name, files), wait_until="networkidle")
            page.wait_for_timeout(200)
            info = page.evaluate(
                """() => ({
                  scrollY: window.scrollY,
                  maxScroll: document.documentElement.scrollHeight - document.documentElement.clientHeight,
                  cardHeight: getComputedStyle(document.querySelector('.card')).height,
                  cardOverflow: getComputedStyle(document.querySelector('.card')).overflow,
                })"""
            )
            page.evaluate("window.scrollTo(0, 0)")
            page.wait_for_timeout(100)
            y0 = page.evaluate("window.scrollY")
            page.mouse.move(480, 400)
            page.mouse.wheel(0, 900)
            page.wait_for_timeout(200)
            y1 = page.evaluate("window.scrollY")
            page.keyboard.press("PageDown")
            page.wait_for_timeout(100)
            y2 = page.evaluate("window.scrollY")
            print(
                f"{name:14} wheel {y0}->{y1}  PageDown->{y2}  maxScroll={info['maxScroll']}  "
                f"cardH={info['cardHeight']} overflow={info['cardOverflow']}"
            )
        browser.close()


if __name__ == "__main__":
    main()
