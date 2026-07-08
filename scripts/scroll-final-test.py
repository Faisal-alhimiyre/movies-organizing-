"""Final scroll regression tests — build 154."""
import http.server
import json
import os
import threading
import time

from playwright.sync_api import sync_playwright

ROOT = os.path.join(os.path.dirname(__file__), "..", "web-files")
PORT = 8790
LIST_ID = "scroll-test-list"
ACCOUNT_ID = "scroll-test-account"


def start_server():
    os.chdir(ROOT)
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), http.server.SimpleHTTPRequestHandler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()


def seed(page):
    movies = {
        "Action": [
            {"title": f"Scroll Movie {i}", "summary": "x" * 100, "genre": "Action"}
            for i in range(50)
        ]
    }
    page.add_init_script(
        f"""
        window.WATCHLIST_CONFIG = {{ supabaseUrl: '', supabaseAnonKey: '' }};
        localStorage.setItem('watchlist-session-v2', {json.dumps(json.dumps({"accountId": ACCOUNT_ID, "listId": LIST_ID}))});
        localStorage.setItem('watchlist-library-v2-{ACCOUNT_ID}', {json.dumps(json.dumps([{"listId": LIST_ID, "accountId": ACCOUNT_ID, "name": "Test", "addedAt": 1}]))});
        localStorage.setItem('watchlist-data-v2-{LIST_ID}', {json.dumps(json.dumps({"movies": movies, "tvSeries": {}, "anime": {}}))});
        localStorage.setItem('watchlist-watched-v1-{LIST_ID}', '{{}}');
        """
    )


def wheel_scroll(page, dy=700):
    page.evaluate("window.scrollTo(0, 0)")
    page.wait_for_timeout(80)
    y0 = page.evaluate("window.scrollY")
    page.mouse.move(400, 400)
    page.mouse.wheel(0, dy)
    page.wait_for_timeout(200)
    y1 = page.evaluate("window.scrollY")
    return y0, y1


def overflow_state(page):
    return page.evaluate(
        """() => ({
          html: document.documentElement.style.overflow,
          body: document.body.style.overflow,
          htmlComputed: getComputedStyle(document.documentElement).overflowY,
          bodyComputed: getComputedStyle(document.body).overflowY,
          overscroll: getComputedStyle(document.documentElement).overscrollBehaviorY,
        })"""
    )


def load_app(page, width, height):
    page.set_viewport_size({"width": width, "height": height})
    page.goto(f"http://127.0.0.1:{PORT}/index.html?v=154", wait_until="domcontentloaded")
    page.wait_for_function(
        "() => document.documentElement.classList.contains('app-ready') && document.querySelectorAll('.card').length > 0",
        timeout=45000,
    )
    page.wait_for_timeout(300)


def test_laptop(page):
    load_app(page, 1280, 800)
    y0, y1 = wheel_scroll(page)
    assert y1 > y0, f"laptop initial wheel: {y0}->{y1}"

    page.locator(".card").first.click()
    page.wait_for_selector("#titleDetailOverlay.td-is-open")
    detail_before = page.evaluate("() => document.getElementById('tdScroll')?.scrollTop ?? 0")
    page.locator("#tdScroll").evaluate("el => { el.scrollTop = 200; }")
    detail_after = page.evaluate("() => document.getElementById('tdScroll')?.scrollTop ?? 0")
    assert detail_after > detail_before, "detail inner scroll"

    page.locator("#tdCloseBtn").click()
    page.wait_for_function("() => !window.WatchlistTitleDetail?.isOpen?.()")
    page.wait_for_timeout(400)
    overlay_display = page.evaluate(
        "() => getComputedStyle(document.getElementById('titleDetailOverlay')).display"
    )
    assert overlay_display == "none", f"overlay display after close: {overlay_display}"

    y0, y1 = wheel_scroll(page)
    assert y1 > y0, f"laptop wheel after detail close: {y0}->{y1}"
    return True


def test_ipad(page):
    load_app(page, 967, 800)
    y0, y1 = wheel_scroll(page)
    assert y1 > y0, f"ipad initial wheel: {y0}->{y1}"

    page.locator(".card").first.click()
    page.wait_for_selector("#titleDetailOverlay.td-is-open")
    page.locator("#tdCloseBtn").click()
    page.wait_for_function("() => !window.WatchlistTitleDetail?.isOpen?.()")
    page.wait_for_timeout(400)

    y0, y1 = wheel_scroll(page)
    assert y1 > y0, f"ipad wheel after detail close: {y0}->{y1}"
    return True


def test_iphone(page):
    load_app(page, 390, 844)
    y0, y1 = wheel_scroll(page)
    assert y1 > y0, f"iphone initial wheel: {y0}->{y1}"

    # pull-to-refresh mobile gate
    ptr_mobile = page.evaluate(
        """() => window.matchMedia('(max-width: 640px)').matches"""
    )
    assert ptr_mobile, "iphone should match mobile query"
    overscroll = page.evaluate(
        "() => getComputedStyle(document.documentElement).overscrollBehaviorY"
    )
    assert overscroll == "contain", f"iphone overscroll-behavior: {overscroll}"

    page.locator(".card").first.click()
    page.wait_for_selector("#titleDetailOverlay.td-is-open")
    page.locator("#tdCloseBtn").click()
    page.wait_for_function("() => !window.WatchlistTitleDetail?.isOpen?.()")
    page.wait_for_timeout(400)

    y0, y1 = wheel_scroll(page)
    assert y1 > y0, f"iphone wheel after detail close: {y0}->{y1}"

    # Add title modal
    page.locator("#addBtn").click()
    page.wait_for_selector("#itemModal:not([hidden])")
    locked = overflow_state(page)
    assert locked["html"] == "hidden" or locked["body"] == "hidden", f"add modal lock: {locked}"
    page.locator("#itemModal .modal__backdrop").click()
    page.wait_for_selector("#itemModal[hidden]")
    page.wait_for_timeout(200)
    unlocked = overflow_state(page)
    assert unlocked["html"] != "hidden" and unlocked["body"] != "hidden", f"add modal unlock: {unlocked}"
    return True


def test_dialogs(page):
    load_app(page, 1280, 800)
    before = overflow_state(page)
    assert before["html"] != "hidden", "page should scroll before dialog"

    page.evaluate("() => window.WatchlistDialog.alert('Test dialog')")
    page.wait_for_selector(".app-dialog:not([hidden])")
    during = overflow_state(page)
    assert during["html"] == "hidden" or during["body"] == "hidden", f"dialog lock: {during}"

    page.locator(".app-dialog .btn--primary").click()
    page.wait_for_selector(".app-dialog[hidden]")
    page.wait_for_timeout(200)
    after = overflow_state(page)
    assert after["html"] != "hidden" and after["body"] != "hidden", f"dialog unlock: {after}"

    y0, y1 = wheel_scroll(page)
    assert y1 > y0, f"wheel after dialog: {y0}->{y1}"
    return True


def main():
    start_server()
    results = {}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for name, fn, width, height in [
            ("laptop", test_laptop, 1280, 800),
            ("ipad", test_ipad, 967, 800),
            ("iphone", test_iphone, 390, 844),
            ("dialogs", test_dialogs, 1280, 800),
        ]:
            page = browser.new_page()
            seed(page)
            try:
                fn(page)
                results[name] = "PASS"
            except Exception as e:
                results[name] = f"FAIL: {e}"
            page.close()
        browser.close()
    print(json.dumps(results, indent=2))
    if any(v != "PASS" for v in results.values()):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
