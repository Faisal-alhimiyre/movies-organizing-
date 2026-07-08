"""Isolate desktop title-detail overlay blocking after close."""
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


def run_case(page, use_hidden_on_close: bool):
    page.set_content(
        f"""
        <link rel="stylesheet" href="http://127.0.0.1:{PORT}/css/title-detail.css?v=149">
        <style>
          body {{ margin: 0; }}
          .spacer {{ height: 40px; }}
        </style>
        <div class="spacer"></div>
        <main id="mainContent">
          {'<p style="height:120px;margin:0">row</p>' * 40}
        </main>
        <div class="td-overlay" id="titleDetailOverlay" aria-hidden="true" inert>
          <div class="td-backdrop" id="tdBackdrop"></div>
          <div class="td-panel" id="tdPanel"><div class="td-scroll" id="tdScroll" style="height:300px;overflow:auto">{'<p>ep</p>'*30}</div></div>
        </div>
        <script>
          window.__useHidden = {str(use_hidden_on_close).lower()};
          const overlay = document.getElementById('titleDetailOverlay');
          function openDetail() {{
            overlay.removeAttribute('inert');
            overlay.removeAttribute('aria-hidden');
            overlay.classList.add('td-is-open');
            if (!window.__useHidden) overlay.removeAttribute('hidden');
          }}
          function closeDetail() {{
            overlay.classList.remove('td-is-open');
            overlay.setAttribute('aria-hidden', 'true');
            overlay.setAttribute('inert', '');
            if (window.__useHidden) overlay.setAttribute('hidden', '');
          }}
        </script>
        """,
        wait_until="domcontentloaded",
    )
    page.set_viewport_size({"width": 1280, "height": 800})

    before = page.evaluate("window.scrollY")
    page.mouse.wheel(0, 700)
    time.sleep(0.15)
    mid = page.evaluate("window.scrollY")

    page.evaluate("openDetail()")
    time.sleep(0.2)
    page.evaluate("closeDetail()")
    time.sleep(0.3)

    hit = page.evaluate(
        """() => {
          const el = document.elementFromPoint(640, 400);
          return el ? { id: el.id, className: String(el.className), tag: el.tagName } : null;
        }"""
    )
    y0 = page.evaluate("window.scrollY")
    page.mouse.wheel(0, 500)
    time.sleep(0.15)
    y1 = page.evaluate("window.scrollY")
    overlay = page.evaluate(
        """() => {
          const o = document.getElementById('titleDetailOverlay');
          const s = getComputedStyle(o);
          return {
            hidden: o.hidden,
            tdIsOpen: o.classList.contains('td-is-open'),
            display: s.display,
            visibility: s.visibility,
            pointerEvents: s.pointerEvents,
          };
        }"""
    )
    return {
        "use_hidden_on_close": use_hidden_on_close,
        "pre_scroll": mid - before,
        "post_scroll": y1 - y0,
        "elementFromPoint": hit,
        "overlay": overlay,
    }


def main():
    start_server()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        a = run_case(page, False)
        page = browser.new_page()
        b = run_case(page, True)
        browser.close()
        print("WITHOUT hidden on close:", a)
        print("WITH hidden on close:", b)
        if a["post_scroll"] <= 0 and b["post_scroll"] > 0:
            print("CONFIRMED: display:none fix changes post-close scroll")
        elif a["post_scroll"] <= 0:
            print("Both failed in chromium - need webkit or overflow issue")


if __name__ == "__main__":
    main()
