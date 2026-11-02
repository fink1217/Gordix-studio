"""從實際反推專案恢復可編輯圖層，修改橋位後仍保留原刀路位置。"""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
from draw_objects import BASE, RESULTS, check


def main():
    """核對實際恢復檔、橋位修改、復原與存檔重新開啟。"""
    path = Path(__file__).resolve().parents[1] / 'recovered' / 'composition.editable.gordix.json'
    if not path.exists():
        print('SKIP 本機使用者恢復檔未提供；純模組測試使用 tests/recovered.cjs')
        return
    data = json.loads(path.read_text(encoding='utf-8'))
    errors = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={'width': 1500, 'height': 1000})
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(BASE + '/CNC.html')
        page.set_input_files('#project-input', str(path))
        page.wait_for_function('job.objects.length===217')
        check('恢復到主編輯區的六個可編輯圖層', page.evaluate('job.layers.length===6 && !document.querySelector("#gcode-preview-dialog").open'))
        original = page.evaluate('files.map(f=>f.gcode)')
        check('初始輸出逐字等於既有雷射與橋位修正版', original == [f['gcode'] for f in data['job']['recovery']['files']])
        check('舊恢復檔顯示毛胚外框而不改刀路', page.evaluate('stock.on && boardPoly?.length===4') and page.is_checked('#opt-stock-model'))
        page.click('#view-3d')
        page.wait_for_function('simObj?.group.children.length>1')
        check('恢復後三維毛胚模型可見', page.evaluate('simObj.group.visible'))
        page.click('#view-2d')
        check('八處橋位標記來自實際刀路', page.evaluate('files[1].recoveredMarkers.length===8 && files[1].recoveredMarkers.every(m=>m.z===-13.2)'))
        page.evaluate('''()=>{selLayerId='L0';renderLayerPanel();}''')
        page.fill('#lp-tab-height', '3')
        page.dispatch_event('#lp-tab-height', 'change')
        check('修改橋位使用保留原位置的刀路', page.evaluate('files[1].recoveryMode==="tabs"'))
        check('修改橋位後所有 XY 與 F 逐字不變', page.evaluate(r'''before=>{
            const xy=s=>s.match(/X[^\r\nZ F]+ Y[^\r\nZ F]+/g),feed=s=>s.match(/ F[\d.]+/g);
            return JSON.stringify(xy(before))===JSON.stringify(xy(files[1].gcode)) && JSON.stringify(feed(before))===JSON.stringify(feed(files[1].gcode));
        }''', original[1]))
        check('雷射輸出完全不變', page.evaluate('files[0].gcode') == original[0])
        check('橋位預覽高度與實際輸出一致', page.evaluate('files[1].recoveredMarkers.filter(m=>m.layerId==="L0").length===4 && files[1].recoveredMarkers.filter(m=>m.layerId==="L0").every(m=>m.z===-12)'))
        changed = page.evaluate('files.map(f=>f.gcode)')
        with page.expect_download() as pending:
            page.click('#project-save')
        downloaded = Path(pending.value.path()).read_bytes()
        page.click('#btn-undo')
        check('復原橋位恢復逐字原始刀路', page.evaluate('files.map(f=>f.gcode)') == original)
        page.set_input_files('#project-input', {'name': 'edited.gordix.json', 'mimeType': 'application/json', 'buffer': downloaded})
        page.wait_for_timeout(300)
        check('修改後存檔重開仍保留刀路與橋位', page.evaluate('files.map(f=>f.gcode)') == changed and page.evaluate('job.layers[0].tabHeight===3'))
        page.click('#op-all')
        page.fill('#op-angle', '10')
        page.dispatch_event('#op-angle', 'change')
        check('可編輯物件並明示改用重算刀路', page.evaluate('files.every(f=>f.recoveryMode==="rebuilt")') and '重新計算' in page.locator('#project-recovery-mode').inner_text())
        check('沒有瀏覽器例外', not errors)
        browser.close()
    print(f'{sum(RESULTS)}/{len(RESULTS)} 通過')
    assert all(RESULTS)


if __name__ == '__main__':
    main()
