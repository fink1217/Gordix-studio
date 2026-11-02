# -*- coding: utf-8 -*-
"""CNC 刀路空跑與繪圖式圖層整合回歸，僅操作獨立瀏覽器。"""
import re
from playwright.sync_api import sync_playwright
from draw_objects import BASE, RESULTS, check


def rapid_distance(gcode):
    """依實際G-code逐行追蹤XY座標，累加G0的平面移動距離。"""
    x = y = total = 0.0
    for line in gcode.splitlines():
        if not re.match(r'G[01](?:\s|$)', line):
            continue
        fields = {key: float(value) for key, value in re.findall(r'([XY])(-?[0-9.]+)', line)}
        nx, ny = fields.get('X', x), fields.get('Y', y)
        if line.startswith('G0 '):
            total += ((nx-x)**2 + (ny-y)**2)**0.5
        x, y = nx, ny
    return total


def file(name, text):
    """建立測試用記憶體向量檔，不寫入使用者圖案。"""
    return {'name': name, 'mimeType': 'image/svg+xml', 'buffer': text.encode('utf-8')}


def test_routing(page):
    """確認排序確實縮短空跑，並保留原幾何與加工先後。"""
    shapes = ''.join(f'<rect x="{(i%2)*220+i*3}" y="{(i%3)*65}" width="10" height="8"/>' for i in range(20))
    page.set_input_files('#file-input', file('route.svg', f'<svg xmlns="http://www.w3.org/2000/svg" width="300mm">{shapes}</svg>'))
    page.wait_for_function('job.objects.length===20 && !importBusy')
    check('有空跑排序模式選擇', page.locator('#route-mode').count() == 1)
    if not RESULTS[-1]:
        return
    page.select_option('#route-mode','center')
    router_before=page.evaluate('files.map(f=>f.gcode).join("\\n")')
    page.select_option('#route-mode','short')
    check('銑削刀路仍維持原本中心排序',page.evaluate('files.map(f=>f.gcode).join("\\n")')==router_before)
    page.select_option('#lp-op','laserLine')
    geometry = page.evaluate('JSON.stringify(job.objects)')
    page.select_option('#route-mode', 'center')
    old = page.evaluate('files.map(f=>f.gcode).join("\\n")')
    page.select_option('#route-mode', 'short')
    new = page.evaluate('files.map(f=>f.gcode).join("\\n")')
    before, after = rapid_distance(old), rapid_distance(new)
    check('實際G0空跑縮短至少20%', after < before * .8)
    check('排序沒有修改原始物件幾何', page.evaluate('JSON.stringify(job.objects)') == geometry)
    check('顯示實際空跑比較', bool(page.inner_text('#route-stats').strip()))
    print(f'空跑比較：{before:.1f} -> {after:.1f} mm')
    page.evaluate('''() => {
        const outer={id:101,layerId:'O',points:[{x:-50,y:-50},{x:50,y:-50},{x:50,y:50},{x:-50,y:50},{x:-50,y:-50}]};
        const hole={id:102,layerId:'H',points:[{x:-5,y:-5},{x:5,y:-5},{x:5,y:5},{x:-5,y:5},{x:-5,y:-5}]};
        const base={visible:true,op:'profile',toolId:tools[0].id,depth:3,through:true};
        window.nestedJob={name:'nested',thickness:18,overcut:.3,safeZ:2,resolution:.1,routing:'short',
            layers:[{...base,id:'O'},{...base,id:'H'}],objects:[outer,hole]};
    }''')
    check('優化仍先做內孔再切外框', page.evaluate('''() => {
        const u=GordixCam.buildFiles(nestedJob,tools)[0].units;
        return u.findIndex(u=>u.objectIds.includes(102))<u.findIndex(u=>u.objectIds.includes(101));
    }'''))


    check('雷射切割不受自由排序模式影響',page.evaluate("""() => {
        const j={...nestedJob,layers:nestedJob.layers.map(l=>({...l,op:'laser',laserPct:50,laserPasses:1}))};
        return GordixCam.buildFiles({...j,routing:'center'},tools).map(f=>f.gcode).join('\\n')===
            GordixCam.buildFiles({...j,routing:'short'},tools).map(f=>f.gcode).join('\\n');
    }"""))
    check('不輸出的外框不影響內外刀徑補償',page.evaluate("""() => {
        nestedJob.objects[0].enabled=false;
        return GordixCam.buildUnits(nestedJob,tools).find(u=>u.objectIds.includes(102)).type==='outer';
    }"""))
    check('隱藏眼睛不影響內外加工判定',page.evaluate("""() => {
        nestedJob.objects[0].enabled=true;nestedJob.layers[0].hidden=true;
        return GordixCam.buildUnits(nestedJob,tools).find(u=>u.objectIds.includes(102)).type==='inner';
    }"""))

def test_layers(page):
    """確認縮圖、顯示與輸出分離、搬移及復原操作。"""
    page.reload()
    svg='<svg xmlns="http://www.w3.org/2000/svg" width="100mm"><g id="A"><rect x="0" y="0" width="30" height="20"/></g><g id="B"><rect x="60" y="10" width="30" height="20"/></g></svg>'
    page.set_input_files('#file-input', file('layers.svg', svg))
    page.wait_for_function('job.objects.length===2 && !importBusy')
    check('圖層標題有實際圖案縮圖', page.locator('#layer-list .layer-thumbnail svg').count() >= 2)
    if not RESULTS[-1]:
        return
    layer_a, layer_b = page.evaluate('job.layers.map(l=>l.id)')
    object_id = page.evaluate('job.objects[0].id')
    header = f'#layer-list [data-layer="{layer_a}"]'
    page.click(header+' [data-act="eye-layer"]')
    check('眼睛隱藏編輯圖形', page.locator(f'#ws [data-obj="{object_id}"]').count() == 0)
    check('隱藏不會取消加工輸出', page.evaluate('(id)=>files.some(f=>f.units.some(u=>u.objectIds.includes(id)))', object_id))
    page.click(header+' [data-act="eye-layer"]')
    if not page.locator(f'#layer-list [data-object-id="{object_id}"]').is_visible():
        page.click(header+' [data-act="expand"]')
    row = f'#layer-list [data-object-id="{object_id}"]'
    check('展開後每個物件有縮圖', page.locator(row+' .object-thumbnail svg').count() == 1)
    page.click(row+' [data-act="eye-object"]')
    check('單獨物件可以隱藏', page.locator(f'#ws [data-obj="{object_id}"]').count() == 0)
    page.click(row+' [data-act="eye-object"]')
    page.uncheck(row+' [data-act="output-object"]')
    check('物件輸出勾選只控制加工內容', page.locator(f'#ws [data-obj="{object_id}"]').count() == 1 and page.evaluate('(id)=>!files.some(f=>f.units.some(u=>u.objectIds.includes(id)))', object_id))
    page.check(row+' [data-act="output-object"]')
    page.select_option(row+' [data-act="move-object"]', layer_b)
    check('在物件列直接移至其他圖層', page.evaluate('(id)=>job.objects.find(o=>o.id===id).layerId', object_id) == layer_b)
    page.click('#btn-undo')
    check('復原物件搬移', page.evaluate('(id)=>job.objects.find(o=>o.id===id).layerId', object_id) == layer_a)
    page.locator(row+' [data-drag-object]').drag_to(page.locator(f'#layer-list [data-layer="{layer_b}"] .layer-heading'))
    check('拖曳物件到圖層即可搬移', page.evaluate('(id)=>job.objects.find(o=>o.id===id).layerId', object_id) == layer_b)
    page.click('#btn-undo')
    check('拖曳搬移也可以復原', page.evaluate('(id)=>job.objects.find(o=>o.id===id).layerId', object_id) == layer_a)
    page.uncheck(header+' [data-act="visible"]')
    check('圖層不輸出仍保留可編輯圖形', page.locator(f'#ws [data-obj="{object_id}"]').count() == 1 and page.evaluate('(id)=>!files.some(f=>f.units.some(u=>u.objectIds.includes(id)))', object_id))


def main():
    """在電腦版執行兩組流程並彙整錯誤。"""
    errors = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={'width': 1500, 'height': 1000})
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(BASE+'/CNC.html')
        test_routing(page)
        test_layers(page)
        check('沒有JavaScript錯誤', not errors)
        browser.close()
    print(f'{sum(RESULTS)}/{len(RESULTS)} 通過')
    assert all(RESULTS), errors


if __name__ == '__main__':
    main()
