"""舊恢復檔必須升級進主編輯區，不得繼續只開預覽。"""
import json
import re
from pathlib import Path
from playwright.sync_api import sync_playwright
from draw_objects import BASE, RESULTS, check


def main():
    """使用舊版實際封存檔驗證匯入、可編輯輸出與重複開啟。"""
    path = Path(__file__).resolve().parents[1] / 'recovered' / 'composition.recovery.gordix.json'
    if not path.exists():
        print('SKIP 缺少本機使用者封存檔')
        return
    data = json.loads(path.read_text(encoding='utf-8'))
    errors = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={'width': 1500, 'height': 1000})
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(BASE + '/CNC.html')
        sample = b'G21\nG90\nG0 Z2\nG0 X10 Y20\nG1 X40 Y60 Z-1 F1000\n'
        page.set_input_files('#gcode-input', {'name': 'sample.nc', 'mimeType': 'text/plain', 'buffer': sample})
        page.wait_for_selector('#gcode-preview-dialog[open]')
        page.set_input_files('#project-input', str(path))
        page.wait_for_function('job.objects.length===217', timeout=20000)
        check('舊恢復檔直接進主編輯區且關閉預覽', page.evaluate('job.layers.length===6 && !document.querySelector("#gcode-preview-dialog").open'))
        check('舊檔升級保留原雷射與銑刀輸出', page.evaluate('files.map(file=>file.gcode)') == [f['gcode'] for f in data['files']])
        page.evaluate('''()=>{selLayerId=job.layers.find(layer=>layer.op==='profile').id;renderLayerPanel();}''')
        page.fill('#lp-tab-height', '3')
        page.dispatch_event('#lp-tab-height', 'change')
        check('舊恢復檔的橋位可以修改並輸出', page.evaluate('files[1].recoveryMode==="tabs"'))
        page.set_input_files('#project-input', str(path))
        page.wait_for_function('files[1].recoveryMode==="original"')
        check('同一個舊檔可以再次開啟', page.evaluate('job.objects.length===217 && job.layers.length===6'))
        unchanged = page.evaluate('JSON.stringify({objects:job.objects,files:files.map(file=>file.gcode)})')
        wrong = json.loads(json.dumps(data))
        for source in wrong['sources']:
            if len(re.findall(r'<polygon\b', source['data'])) != 2:
                continue
            count = [0]

            def move_pocket(match):
                """只移動第二個多邊形，保留雷射與外框來測試完整核對。"""
                count[0] += 1
                return '<polygon transform="translate(5 0)"' if count[0] == 2 else match.group()

            source['data'] = re.sub(r'<polygon\b', move_pocket, source['data'])
        page.set_input_files('#project-input', {'name': 'wrong.json', 'mimeType': 'application/json', 'buffer': json.dumps(wrong).encode()})
        page.wait_for_function('document.querySelector("#project-status").textContent.includes("開啟失敗")')
        check('挖槽錯位的原圖會拒絕且不改目前工作', page.evaluate('JSON.stringify({objects:job.objects,files:files.map(file=>file.gcode)})') == unchanged)
        page.evaluate('data=>GordixGcodePreview.open(data)', data)
        page.click('#gcode-restore-edit')
        page.wait_for_function('!document.querySelector("#gcode-preview-dialog").open')
        check('預覽中的恢復按鈕可回主編輯區', page.evaluate('job.objects.length===217 && files[1].recoveryMode==="original"'))
        check('沒有瀏覽器例外', not errors)
        browser.close()
    print(f'{sum(RESULTS)}/{len(RESULTS)} 通過')
    assert all(RESULTS)


if __name__ == '__main__':
    main()
