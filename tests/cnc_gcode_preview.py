"""既有刀路匯入、恢復檔與編輯專案互不覆蓋。"""
from pathlib import Path
from playwright.sync_api import sync_playwright
from draw_objects import BASE, RESULTS, check, svg_file


def main():
    """檢查真實恢復檔及不支援指令的拒絕行為。"""
    errors = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={'width': 1500, 'height': 1000})
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(BASE + '/CNC.html')
        page.set_input_files('#file-input', svg_file('editing.svg'))
        page.wait_for_function('job.objects.length>0 && !importBusy')
        original = page.evaluate('JSON.stringify({job,files})')
        sample = b'G21\nG90\nG0 Z2\nG0 X10 Y20\nG1 Z-3 F300\nG1 X40 Y60 F1000\nG0 Z2\n'
        page.set_input_files('#gcode-input', {'name': 'sample.nc', 'mimeType': 'text/plain', 'buffer': sample})
        page.wait_for_selector('#gcode-preview-dialog[open]')
        check('G-code 保留原始 XYZ 範圍', 'X 0.000～40.000' in page.locator('#gcode-preview-info').inner_text() and 'Z -3.000～2.000' in page.locator('#gcode-preview-info').inner_text())
        page.click('#gcode-close')
        check('預覽不改正在編輯的工作', page.evaluate('JSON.stringify({job,files})') == original)
        page.set_input_files('#gcode-input', {'name': 'unsupported.nc', 'mimeType': 'text/plain', 'buffer': sample+b'G91\n'})
        page.wait_for_timeout(200)
        check('不支援相對座標時明確拒絕', 'G91' in page.locator('#project-status').inner_text() and not page.locator('#gcode-preview-dialog').evaluate('(el)=>el.open'))
        page.set_input_files('#gcode-input', {'name': 'dwell.nc', 'mimeType': 'text/plain', 'buffer': sample+b'G4 X1\n'})
        page.wait_for_timeout(200)
        check('停頓參數不會被錯當成移動', 'G4' in page.locator('#project-status').inner_text())
        archive = Path(__file__).resolve().parents[1] / 'recovered' / 'composition.recovery.gordix.json'
        if archive.exists():
            page.set_input_files('#project-input', str(archive))
            page.wait_for_selector('#gcode-preview-dialog[open]')
            check('實際恢復檔含兩份加工刀路', page.locator('#gcode-file-select option').count() == 2)
            page.select_option('#gcode-file-select', '1')
            check('修正橋位的實際銑刀檔能完整預覽', int(page.locator('#gcode-preview-canvas').get_attribute('data-moves')) > 70000)
            page.click('#gcode-close')
            check('匯入恢復檔未重新計算或改寫編輯專案', page.evaluate('JSON.stringify({job,files})') == original)
        check('沒有瀏覽器例外', not errors)
        browser.close()
    print(f'{sum(RESULTS)}/{len(RESULTS)} 通過')
    assert all(RESULTS)


if __name__ == '__main__':
    main()
