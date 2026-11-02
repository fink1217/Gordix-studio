# -*- coding: utf-8 -*-
"""CNC 多圖追加、獨立來源設定、群組旋轉與復原回歸。"""
from playwright.sync_api import sync_playwright
from draw_objects import BASE, RESULTS, check, svg_file


def main():
    """在獨立瀏覽器驗證 CNC 物件流程與既有圖層不受覆蓋。"""
    errors=[]
    with sync_playwright() as pw:
        browser=pw.chromium.launch()
        page=browser.new_page(viewport={'width':1500,'height':1000})
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(BASE+'/CNC.html')
        page.wait_for_function("typeof job!=='undefined'")
        check('CNC 可一次選取多個檔案',page.locator('#file-input').get_attribute('multiple') is not None)
        if not RESULTS[-1]:
            browser.close()
            raise AssertionError('尚未支援多圖')
        page.set_input_files('#file-input',[svg_file('one.svg'),svg_file('two.svg')])
        page.wait_for_function('job.objects.length===2 && !importBusy')
        check('批次匯入兩圖並保留獨立圖層',page.evaluate('job.objects.length===2 && job.layers.length===2'))
        old=page.evaluate('job.objects[0].points')
        page.set_input_files('#file-input',svg_file('three.svg'))
        page.wait_for_function('job.objects.length===3 && !importBusy')
        check('追加匯入保持第一張圖座標',page.evaluate('job.objects[0].points')==old)
        check('每個物件 ID 不重複',page.evaluate('new Set(job.objects.map(o=>o.id)).size===3'))
        page.select_option('#source-select','1')
        page.fill('#target-width','200')
        page.dispatch_event('#target-width','input')
        page.wait_for_timeout(700)
        check('重設單一來源寬度不刪其他圖',page.evaluate('job.objects.length===3 && sources.size===3'))
        page.click('#op-all')
        page.click('#op-group')
        before=page.evaluate('job.objects.map(o=>o.points)')
        page.fill('#op-angle','90')
        page.dispatch_event('#op-angle','change')
        after=page.evaluate('job.objects.map(o=>o.points)')
        check('群組旋轉後幾何改變',before!=after)
        check('旋轉後 G-code 與預覽使用同一幾何',page.evaluate('files.length>0 && files.every(f=>f.gcode.includes("G1"))'))
        page.click('#btn-undo')
        check('旋轉可完整復原',page.evaluate('job.objects.map(o=>o.points)')==before)
        page.click('#btn-redo')
        check('旋轉可完整重做',page.evaluate('job.objects.map(o=>o.points)')==after)
        page.select_option('#source-select','1')
        old_bounds=page.evaluate('selectionBox(job.objects.filter(o=>o.sourceId===1))')
        page.evaluate("() => {$('smooth').value=.2;return importSource(true);}")
        new_bounds=page.evaluate('selectionBox(job.objects.filter(o=>o.sourceId===1))')
        check('重解析保留既有旋轉與尺寸方向',all(abs(new_bounds[k]-v)<.01 for k,v in old_bounds.items()))
        page.click('#op-all')
        page.click('#op-ungroup')
        check('解散群組保留旋轉結果',page.evaluate('job.objects.every(o=>!o.groupId)') and page.evaluate('job.objects.length===3'))
        page.set_input_files('#file-input',{'name':'bad.svg','mimeType':'image/svg+xml','buffer':b'<svg/>'})
        page.wait_for_function('!importBusy')
        check('匯入空檔不破壞舊圖',page.evaluate('job.objects.length===3'))
        page.evaluate("() => {job.objects.find(o=>o.sourceId===2).layerId=job.layers.find(l=>l.sourceId===1).id;rebuild();}")
        page.select_option('#source-select','1')
        page.click('[data-group="color"]')
        page.wait_for_timeout(500)
        check('來源重新分組不刪除其他物件正在使用的圖層',page.evaluate('job.objects.every(o=>job.layers.some(l=>l.id===o.layerId))'))
        check('沒有 JavaScript 錯誤',not errors)
        browser.close()
    print(f'{sum(RESULTS)}/{len(RESULTS)} 通過')
    assert all(RESULTS),errors


if __name__=='__main__':
    main()
