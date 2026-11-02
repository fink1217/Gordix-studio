# -*- coding: utf-8 -*-
"""橋位必須在所有深度層保留材料，並可透過毛胚模型辨識。"""
from playwright.sync_api import sync_playwright
from draw_objects import BASE, RESULTS, check, svg_file


def main():
    """核對實際動作、模擬高度與顯示切換，不操作實體機器。"""
    errors=[]
    with sync_playwright() as pw:
        browser=pw.chromium.launch()
        page=browser.new_page(viewport={'width':1500,'height':1000})
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(BASE+'/CNC.html')
        page.set_input_files('#file-input',svg_file('tabs.svg'))
        page.wait_for_function('job.objects.length && !importBusy')
        page.evaluate('() => {tools[0].step=2;stock.t=18;}')
        page.check('#lp-through');page.check('#lp-tabs')
        data=page.evaluate('''() => {
            const f=files[0],u=f.units[0],z=u.cfg.tabTopZ ?? -u.cfg.depth+u.cfg.step;
            const raised=f.moves.filter(m=>m.g===1&&m.x!==undefined&&Math.abs(m.z-z)<1e-6);
            return {n:raised.length,bad:raised.filter(a=>f.moves.some(m=>m.g===1&&m.x!==undefined&&Math.hypot(m.x-a.x,m.y-a.y)<1e-6&&m.z<z-1e-6)).length};
        }''')
        check('橋位位置在較早深度層也沒有被切穿',data['n']>0 and data['bad']==0)
        check('有毛胚模型顯示開關',page.locator('#opt-stock-model').count()==1)
        if page.locator('#opt-stock-model').count():
            check('有明確的橋位保留厚度',page.locator('#lp-tab-height').is_visible())
            page.fill('#lp-tab-height','3');page.dispatch_event('#lp-tab-height','change')
            check('18mm板保留3mm橋位時頂部為Z-15',page.evaluate('Math.abs(files[0].units[0].cfg.tabTopZ+15)<1e-8'))
            check('2D可看到橋位標記',page.locator('#ws [data-tab-marker]').count()>0)
            gcode=page.evaluate('files[0].gcode')
            page.uncheck('#opt-tabs')
            check('橋位顯示可獨立切換且不改輸出',page.locator('#ws [data-tab-marker]').count()==0 and page.evaluate('files[0].gcode')==gcode)
            page.check('#opt-tabs')
            page.click('#view-3d')
            page.wait_for_function('sim && sim.done>=merged.moves.length',timeout=20000)
            check('毛胚模型預設可見',page.evaluate('simObj.group.visible'))
            page.uncheck('#opt-stock-model')
            check('可隱藏模型保留刀路',page.evaluate('!simObj.group.visible') and page.evaluate('files[0].gcode')==gcode)
            page.check('#opt-stock-model')
            remaining=page.evaluate('''() => GordixCam.tabMarkers(files[0].units).map(p=>{
                const i=Math.max(0,Math.min(sim.nx-1,Math.round((p.x-sim.x0)/sim.res)));
                const j=Math.max(0,Math.min(sim.ny-1,Math.round((p.y-sim.y0)/sim.res)));
                return sim.h[j*sim.nx+i];
            })''')
            check('完整切削模擬後橋位仍留有3mm材料',bool(remaining) and min(remaining)>=-15.6)
        check('沒有JavaScript錯誤',not errors)
        browser.close()
    print(f'{sum(RESULTS)}/{len(RESULTS)} 通過')
    assert all(RESULTS),errors


if __name__=='__main__':
    main()
