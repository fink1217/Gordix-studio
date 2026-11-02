# -*- coding: utf-8 -*-
"""桌面預覽固定、功能欄獨立捲動，手機保留直向版面。"""
from playwright.sync_api import sync_playwright
from draw_objects import BASE, RESULTS, check, svg_file


def main():
    """在三個加工頁模擬展開長功能欄並實際滾動滑鼠。"""
    with sync_playwright() as pw:
        browser=pw.chromium.launch()
        for name in ['CNC','draw','Gcodetrans']:
            page=browser.new_page(viewport={'width':1440,'height':900})
            page.goto(BASE+'/'+name+'.html')
            page.wait_for_timeout(400)
            if name in ['CNC','draw']:
                page.set_input_files('#file-input',svg_file('preview.svg'))
                page.wait_for_timeout(400)
            else:
                page.set_input_files('#fileInput',{'name':'preview.gcode','mimeType':'text/plain','buffer':b'; Tool: flat end mill D3.2\nG21\nG90\nG0 Z2\nG0 X0 Y0\nG1 Z-1 F300\nG1 X50 Y0 F800\nG1 X50 Y50\nG0 Z2\nG0 X0 Y0'})
                page.wait_for_timeout(600)
            center=page.locator('.studio-center')
            sides=page.locator('.studio-sidebar')
            check(name+'有獨立預覽與功能欄',center.count()==1 and sides.count()==2)
            if not RESULTS[-1]:
                continue
            page.evaluate('''() => {
                const probe=document.createElement('div');probe.style.height='1400px';
                document.querySelector('.studio-sidebar').append(probe);
            }''')
            before=center.bounding_box()
            sidebar=sides.first.bounding_box()
            page.mouse.move(sidebar['x']+sidebar['width']/2,sidebar['y']+80)
            page.mouse.wheel(0,700)
            page.wait_for_timeout(250)
            after=center.bounding_box()
            check(name+'功能欄可以獨立捲動',sides.first.evaluate('el=>el.scrollTop')>100)
            check(name+'預覽位置與高度保持固定',abs(after['y']-before['y'])<1 and abs(after['height']-before['height'])<1)
            check(name+'預覽與控制列都在畫面內',after['y']>=0 and after['y']+after['height']<=901)
            check(name+'整頁不跟著滾動',page.evaluate('scrollY===0'))
            for width,height in [(1024,720),(1440,650)]:
                page.set_viewport_size({'width':width,'height':height})
                page.wait_for_timeout(150)
                bounds=center.bounding_box()
                canvas=page.locator('#preview-box,#container,#preview-container').first.bounding_box()
                check(f'{name} {width}×{height} 預覽及控制列未被裁切',bounds['y']+bounds['height']<=height+1 and canvas['height']>100)
            page.set_viewport_size({'width':390,'height':844})
            page.wait_for_timeout(200)
            check(name+'手機仍可上下捲動',page.evaluate('document.documentElement.scrollHeight>innerHeight') and page.evaluate('getComputedStyle(document.body).overflowY!=="hidden"'))
            page.close()
        browser.close()
    print(f'{sum(RESULTS)}/{len(RESULTS)} 通過')
    assert all(RESULTS),'固定預覽檢查失敗'


if __name__=='__main__':
    main()
