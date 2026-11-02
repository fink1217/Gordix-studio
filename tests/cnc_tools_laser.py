# -*- coding: utf-8 -*-
"""CNC 自訂刀具、雷射畫線與實際功率輸出回歸。"""
from playwright.sync_api import sync_playwright
from draw_objects import BASE, RESULTS, check, svg_file


def main():
    """從可操作介面驗證持久化與G-code，不連接機器。"""
    errors=[]
    with sync_playwright() as pw:
        browser=pw.chromium.launch()
        page=browser.new_page(viewport={'width':1500,'height':1000})
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(BASE+'/CNC.html')
        page.wait_for_function("typeof job!=='undefined'")
        page.click('#btn-add-tool')
        check('新增刀具有自訂名稱欄位',page.locator('#te-name').count()==1)
        if not RESULTS[-1]:
            browser.close()
            raise AssertionError('缺少自訂名稱')
        page.fill('#te-name','我的 3.2mm 六刃刀')
        page.dispatch_event('#te-name','change')
        for selector,value in [('#te-d','3.2'),('#te-flutes','6'),('#te-f','555'),('#te-step','.7')]:
            page.fill(selector,value)
            page.dispatch_event(selector,'change')
        page.click('#te-done')
        page.reload()
        page.wait_for_timeout(400)
        check('自訂名稱與規格重新整理仍保留',page.evaluate('tools.some(t=>t.name==="我的 3.2mm 六刃刀" && t.d===3.2 && t.flutes===6 && t.f===555 && t.step===.7)'))
        page.set_input_files('#file-input',svg_file('plate.svg'))
        page.wait_for_function('job.objects.length && !importBusy')
        custom=page.evaluate('tools.find(t=>t.name==="我的 3.2mm 六刃刀").id')
        page.select_option('#lp-tool',custom)
        check('圖層可使用自訂刀具並輸出走速',page.evaluate('files[0].gcode.includes("D3.2") && files[0].gcode.includes("F555")'))
        check('加工方式有雷射畫線',page.locator('#lp-op option[value="laserLine"]').count()==1)
        page.select_option('#lp-op','laserLine')
        check('顯示可調整雷射參數',page.locator('#lp-laser-pct').is_visible() and page.locator('#lp-laser-feed').is_visible())
        for selector,value in [('#lp-laser-pct','25'),('#lp-laser-feed','1234'),('#lp-laser-passes','3')]:
            page.fill(selector,value)
            page.dispatch_event(selector,'change')
        data=page.evaluate('''() => ({g:files[0].gcode,n:files[0].moves.filter(m=>m.m?.startsWith('M03')).length,
            params:[curLayer().laserPct,curLayer().feed,curLayer().laserPasses]})''')
        check('功率25%實際輸出S64與F1234', 'M03 S64' in data['g'] and 'F1234' in data['g'] and 'M03 S255' not in data['g'])
        check('重複三次且每次關雷射',data['n']==3 and data['g'].count('M05')>=3)
        page.click('#btn-undo')
        check('雷射參數支援復原',page.evaluate('curLayer().laserPasses===1'))
        page.click('#btn-redo')
        check('雷射參數支援重做',page.evaluate('curLayer().laserPasses===3'))
        line=svg_file('open.svg')
        line['buffer']=b'<svg xmlns="http://www.w3.org/2000/svg" width="100mm" viewBox="0 0 100 50"><polyline points="0,50 50,0 100,50" fill="none" stroke="black"/></svg>'
        page.set_input_files('#file-input',line)
        page.wait_for_function('sources.size===2 && !importBusy')
        page.select_option('#lp-op','laserLine')
        path=page.evaluate('''() => {
            const layer=curLayer(),o=job.objects.find(o=>o.layerId===layer.id),u=GordixCam.buildUnits(job,tools).find(u=>u.layerId===layer.id),p=u.phases[0].paths[0];
            return {closed:o.closed,d:Math.hypot(p[0].x-p.at(-1).x,p[0].y-p.at(-1).y),cut:GordixCam.OPS.laserLine.cut};
        }''')
        check('開放折線保持開放，沒有多一條閉合線',path['closed'] is False and path['d']>90)
        check('雷射畫線不當成材料切割邊界',path['cut'] is False)
        page.select_option('#lp-op','laser')
        check('雷射切割同樣可設定功率',page.locator('#lp-laser-pct').is_visible())
        page.fill('#lp-laser-pct','0');page.dispatch_event('#lp-laser-pct','change')
        check('零功率明確輸出S0',page.evaluate('files[0].gcode.includes("M03 S0")'))
        # 不合法功率不覆寫上一個有效設定，也不偷偷改成滿功率。
        page.fill('#lp-laser-pct','101');page.dispatch_event('#lp-laser-pct','change')
        check('功率超過100%不採用且顯示錯誤',page.evaluate('curLayer().laserPct===0') and 'calc-bad' in page.locator('#lp-laser-pct').get_attribute('class'))
        page.fill('#lp-laser-pct','10');page.dispatch_event('#lp-laser-pct','change')
        check('修正功率後清除錯誤並輸出S26',page.evaluate('files[0].gcode.includes("M03 S26")') and 'calc-bad' not in page.locator('#lp-laser-pct').get_attribute('class'))
        check('同檔雷射先畫線再切割',page.evaluate('files[0].units[0].operation==="laserLine" && files[0].units.at(-1).operation==="laser"'))
        check('沒有 JavaScript 錯誤',not errors)
        browser.close()
    print(f'{sum(RESULTS)}/{len(RESULTS)} 通過')
    assert all(RESULTS),errors


if __name__=='__main__':
    main()
