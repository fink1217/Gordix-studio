# -*- coding: utf-8 -*-
"""多圖、群組、旋轉及輸出整合測試；先在專案啟動 localhost:8765。"""
import base64
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = os.environ.get('GORDIX_TEST_URL', 'http://127.0.0.1:8765')
RESULTS = []
SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" viewBox="0 0 100 50"><path d="M0 0H100V50H0Z" fill="none" stroke="black"/></svg>'


def check(name, condition):
    """記錄使用行為檢查，結束時統一判定。"""
    RESULTS.append(bool(condition))
    print(('PASS ' if condition else 'FAIL ') + name)


def svg_file(name):
    """回傳可直接匯入的記憶體 SVG。"""
    return {'name': name, 'mimeType': 'image/svg+xml', 'buffer': SVG.encode('utf-8')}


def test(page, errors):
    """驗證完整操作流程與世界座標，不操作實體機器。"""
    check('可以一次選取多張圖', page.locator('#file-input').get_attribute('multiple') is not None)
    page.set_input_files('#file-input', [svg_file('first.svg'), svg_file('second.svg')])
    page.wait_for_function('drawObjects.length===2 && !sceneBusy')
    check('批次匯入兩個獨立物件', page.locator('#object-list [data-object]').count() == 2)
    png = page.evaluate('''() => {
        const c=document.createElement('canvas'); c.width=100;c.height=50;
        const g=c.getContext('2d');g.fillStyle='white';g.fillRect(0,0,100,50);
        g.fillStyle='black';g.fillRect(10,10,80,30);return c.toDataURL().split(',')[1];
    }''')
    page.set_input_files('#file-input', {'name': 'blocks.png', 'mimeType': 'image/png', 'buffer': base64.b64decode(png)})
    page.wait_for_function('drawObjects.length===3 && !sceneBusy')
    check('追加點陣圖不清空向量圖', page.evaluate('drawObjects.length===3'))
    page.click('#object-list [data-object="1"] [data-select]')
    page.fill('#obj-angle', '90')
    page.dispatch_event('#obj-angle', 'change')
    check('角度欄位旋轉單一物件', page.evaluate('drawObjects[0].angle===90 && drawObjects[1].angle===0'))
    page.click('#btn-select-all')
    page.click('#btn-group')
    check('多圖建立同一群組', page.evaluate('new Set(drawObjects.map(o=>o.groupId)).size===1 && !!drawObjects[0].groupId'))
    page.evaluate('commitDraw()')
    state = 'drawObjects.map(o=>({x:o.x,y:o.y,angle:o.angle,width:o.width}))'
    before = page.evaluate(state)
    page.fill('#obj-angle', '90')
    page.dispatch_event('#obj-angle', 'change')
    page.evaluate('commitDraw()')
    after = page.evaluate(state)
    check('群組旋轉更新所有成員角度', all(abs((a['angle']-b['angle']-90+180) % 360-180) < .001 for a,b in zip(after,before)))
    page.click('#btn-undo')
    check('復原整組旋轉', page.evaluate(state) == before)
    page.click('#btn-redo')
    check('重做整組旋轉', page.evaluate(state) == after)
    geometry = page.evaluate('''() => {
        const paths=scenePaths(), g=GordixPreview.parse(generateGcode());
        return {n:paths.length,bad:paths.flatMap(p=>p.pts).some(p=>!g.moves.some(m=>
            Math.abs(m.x-p.x)<.002 && Math.abs(m.y-penYOffset()+p.y)<.002)),svg:generateSVG()};
    }''')
    check('G-code 包含每個物件轉換後的座標', geometry['n'] > 0 and not geometry['bad'])
    check('SVG 包含全部路徑', geometry['svg'].count('<path ') == geometry['n'])
    page.click('#btn-ungroup')
    check('解散群組保持位置與角度', page.evaluate('drawObjects.every(o=>!o.groupId)') and page.evaluate(state) == after)
    page.click('#btn-group')
    before_scale = page.evaluate('drawObjects.map(o=>o.width)')
    width = page.input_value('#obj-w')
    page.fill('#obj-w', width+'*2')
    page.press('#obj-w', 'Enter')
    page.wait_for_timeout(400)
    check('群組縮放保持所有成員比例', all(abs(a-b*2)<.1 for a,b in zip(page.evaluate('drawObjects.map(o=>o.width)'), before_scale)))
    page.fill('#obj-x', '123')
    page.dispatch_event('#obj-x', 'input')
    check('群組移動以共同中心定位', page.evaluate('Math.abs(GordixObjects.bounds(drawObjects).x-123)<.001'))
    page.click('#btn-ungroup')
    page.click('#object-list [data-object="1"] [data-select]')
    check('解散後可以單獨選取', page.evaluate('selectedObjects.size===1'))
    page.evaluate('''() => {
        const o=drawObjects[0], b=GordixObjects.bounds([o]), r=workspace.getBoundingClientRect();
        view.w=600;view.h=600*r.height/r.width;view.x=b.x-view.w/2;view.y=-b.y-view.h/2;applyView();
    }''')
    handle = page.locator('#design-rotate').bounding_box()
    old_angle = page.evaluate('drawObjects[0].angle')
    page.mouse.move(handle['x']+handle['width']/2, handle['y']+handle['height']/2)
    page.mouse.down()
    page.mouse.move(handle['x']+80, handle['y']+40, steps=10)
    page.mouse.up()
    check('拖曳圓形把手可以旋轉', abs(page.evaluate('drawObjects[0].angle')-old_angle)>1)
    count = page.evaluate('drawObjects.length')
    page.set_input_files('#file-input', {'name': 'broken.svg', 'mimeType': 'image/svg+xml', 'buffer': b'<svg/>'})
    page.wait_for_function('!sceneBusy')
    check('錯誤檔不破壞既有圖案', page.evaluate('drawObjects.length') == count and bool(page.inner_text('#import-errors')))
    page.set_input_files('#file-input', svg_file('first.svg'))
    page.wait_for_function('drawObjects.length===4 && !sceneBusy')
    check('同檔案可再次追加', page.evaluate('drawObjects.length===4'))
    page.click('#btn-select-all')
    page.click('#btn-delete-object')
    check('可以刪除所有物件', page.evaluate('drawObjects.length===0 && !hasOutput()'))
    page.click('#btn-undo')
    check('刪除物件可以復原', page.evaluate('drawObjects.length===4 && hasOutput()'))
    page.set_viewport_size({'width':390,'height':844})
    page.wait_for_timeout(400)
    check('手機沒有水平溢出', page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
    page.locator('#obj-angle').scroll_into_view_if_needed()
    check('手機可操作旋轉角度', page.locator('#obj-angle').is_visible())
    check('沒有 JavaScript 錯誤', not errors)
    if errors:
        print(errors)
    artifacts = Path('.claude/tests')
    if artifacts.exists():
        page.screenshot(path=str(artifacts/'objects-mobile.png'),full_page=True)
        page.set_viewport_size({'width':1440,'height':1000})
        page.screenshot(path=str(artifacts/'objects-desktop.png'),full_page=True)


def analysis_history(page):
    """驗證不同門檻的歷史保留各自幾何，及全域功率不超過新上限。"""
    page.goto(BASE+'/draw.html')
    page.wait_for_function("typeof drawObjects!=='undefined'")
    png=page.evaluate("""() => {
        const c=document.createElement('canvas');c.width=100;c.height=50;
        const g=c.getContext('2d');g.fillStyle='white';g.fillRect(0,0,100,50);
        g.fillStyle='rgb(150,150,150)';g.fillRect(10,10,80,30);return c.toDataURL().split(',')[1];
    }""")
    file={'name':'gray.png','mimeType':'image/png','buffer':base64.b64decode(png)}
    page.set_input_files('#file-input',file)
    page.wait_for_function('drawObjects.length===1 && !sceneBusy')
    page.evaluate('() => {thresholdSlider.value=100;processImage();commitDraw();}')
    check('低門檻沒有灰色矩形路徑', page.evaluate('scenePaths().length===0'))
    page.evaluate('() => {thresholdSlider.value=200;processImage();commitDraw();}')
    check('高門檻產生灰色矩形路徑', page.evaluate('scenePaths().length>0'))
    page.click('#btn-undo')
    check('復原低門檻必須還原空幾何',page.evaluate('+thresholdSlider.value===100 && scenePaths().length===0'))
    page.click('#btn-redo')
    check('重做高門檻必須還原矩形幾何',page.evaluate('+thresholdSlider.value===200 && scenePaths().length>0'))
    page.evaluate("""() => {
        fillEnable.checked=true;setFillModes(true);grayscaleFillCheckbox.checked=true;
        maxSPowerInput.value=64;minSPowerInput.value=0;processImage();commitDraw();
    }""")
    page.set_input_files('#file-input',file)
    page.wait_for_function('drawObjects.length===2 && !sceneBusy')
    page.evaluate('() => {maxSPowerInput.value=20; maxSPowerInput.oninput();}')
    page.wait_for_timeout(400)
    check('降低全域功率後所有物件皆遵守上限',page.evaluate("""() => {
        const values=generateGcode().match(/S([0-9.]+)/g).map(s=>+s.slice(1));
        return Math.max(...values)<=20;
    }"""))


def main():
    """啟動獨立測試瀏覽器，執行後回報通過數。"""
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={'width':1440,'height':1000})
        errors = []
        page.on('pageerror',lambda error: errors.append(str(error)))
        page.goto(BASE+'/draw.html')
        page.wait_for_function("typeof drawObjects!=='undefined'")
        test(page,errors)
        analysis_history(page)
        browser.close()
    print(f'{sum(RESULTS)}/{len(RESULTS)} 通過')
    assert all(RESULTS),'整合測試有失敗項目'


if __name__ == '__main__':
    main()
