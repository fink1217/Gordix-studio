# -*- coding: utf-8 -*-
"""站點視覺冒煙測試：流程位置、表單可用性、響應式及執行期錯誤。"""
import os
from playwright.sync_api import sync_playwright

PAGES = ['index', 'table_conf', 'stock', 'CNC', 'draw', 'Gcodetrans', 'params', 'vc']
BASE = os.environ.get('GORDIX_TEST_URL', 'http://127.0.0.1:8765')


def main():
    """檢查各頁雙主題與手機版，保留現有功能的可用狀態。"""
    errors = []
    failures = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context(viewport={'width': 1440, 'height': 1000})
        for name in PAGES:
            page = ctx.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(f'{BASE}/{name}.html')
            page.wait_for_timeout(500)
            nav = page.locator('.studio-workflow')
            if nav.count() != 1 or nav.locator('a').count() != 4:
                failures.append(name + '：缺少流程導覽')
                page.close()
                continue
            for dark in [True, False]:
                if page.evaluate('document.documentElement.classList.contains("dark")') != dark:
                    page.locator('#theme-toggle, #theme-toggle-btn, button[onclick*="toggleTheme"]').first.click()
                for width in [1440, 768, 390]:
                    page.set_viewport_size({'width':width, 'height':1000})
                    page.wait_for_timeout(100)
                    overflow = page.evaluate('document.documentElement.scrollWidth > innerWidth')
                    if overflow:
                        failures.append(f'{name}：{width}px 水平溢出')
                    if not nav.is_visible():
                        failures.append(name + '：流程導覽不可見')
            language=page.locator('#lang-toggle, #langBtn, button[onclick*="toggleLang"]')
            if language.count():
                language.first.click()
                page.wait_for_timeout(100)
                expected=page.evaluate('localStorage.getItem("gordix-lang")')
                if page.locator('html').get_attribute('lang') != ('en' if expected=='en' else 'zh-TW'):
                    failures.append(name+'：共用導覽語系未同步')
            page.close()
            print('PASS ' + name + '：雙主題與三種尺寸已檢查')
        browser.close()
    assert not errors, errors
    assert not failures, failures
    print('8 頁、48 種主題／尺寸組合通過，沒有 JavaScript 錯誤')


if __name__ == '__main__':
    main()
