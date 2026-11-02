"""實際點擊恢復入口，核對原生選檔視窗與模態視窗內操作。"""
from pathlib import Path
from playwright.sync_api import sync_playwright
from draw_objects import BASE, RESULTS, check


def main():
    """不用直接塞隱藏輸入框，驗證使用者真正點擊的路徑。"""
    project = Path(__file__).resolve().parents[1] / 'recovered' / 'composition.editable.gordix.json'
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={'width': 1500, 'height': 1000})
        page.goto(BASE + '/CNC.html')
        with page.expect_file_chooser() as pending:
            page.click('#project-open')
        check('點擊專案按鈕確實開啟選檔視窗', pending.value is not None)
        if project.exists():
            pending.value.set_files(str(project))
            page.wait_for_function('job.objects.length===217')
        sample = {'name': 'sample.nc', 'mimeType': 'text/plain', 'buffer': b'G21\nG90\nG0 Z2\nG0 X10 Y20\nG1 X40 Y60 Z-1 F1000\n'}
        with page.expect_file_chooser() as pending:
            page.click('#gcode-import')
        pending.value.set_files(sample)
        page.wait_for_selector('#gcode-preview-dialog[open]')
        with page.expect_file_chooser() as pending:
            page.click('#gcode-restore-edit')
        check('缺少原圖時恢復按鈕可點且開啟補選視窗', pending.value is not None)
        if project.exists():
            pending.value.set_files(str(project))
            page.wait_for_function('!document.querySelector("#gcode-preview-dialog").open')
            check('從預覽內補選專案後回到主編輯區', page.evaluate('job.objects.length===217 && job.layers.length===6'))
            with page.expect_file_chooser() as pending:
                page.click('#gcode-import')
            pending.value.set_files(sample)
            page.wait_for_selector('#gcode-preview-dialog[open]')
            with page.expect_file_chooser() as pending:
                page.click('#gcode-open-project')
            pending.value.set_files(str(project))
            page.wait_for_function('!document.querySelector("#gcode-preview-dialog").open')
            check('模態視窗內也可開啟專案', page.evaluate('job.objects.length===217'))
        browser.close()
    assert all(RESULTS)


if __name__ == '__main__':
    main()
