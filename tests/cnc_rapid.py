# -*- coding: utf-8 -*-
"""空切帶獨立F值，第一筆加工必須恢復原走速，不改幾何或G0模式。"""
from playwright.sync_api import sync_playwright
from draw_objects import BASE, RESULTS, check, svg_file


def main():
    """以實際輸出檢查快移與加工走速隔離。"""
    with sync_playwright() as pw:
        browser=pw.chromium.launch();page=browser.new_page(viewport={'width':1500,'height':1000})
        page.goto(BASE+'/CNC.html')
        page.set_input_files('#file-input',svg_file('rapid.svg'))
        page.wait_for_function('job.objects.length&&!importBusy')
        check('有空切加速開關',page.locator('#rapid-enable').count()==1)
        if not RESULTS[-1]:
            browser.close();raise AssertionError('缺少空切加速控制')
        page.check('#rapid-enable');page.fill('#rapid-feed','1800');page.dispatch_event('#rapid-feed','change')
        result=page.evaluate('''() => {
            const lines=files[0].gcode.split('\\n');let rapid=false,bad=false,n=0;
            lines.forEach(line=>{
                if(/^G0 X/.test(line)){n++;if(!line.includes('F1800'))bad=true;rapid=true;}
                if(/^G1 /.test(line)&&rapid){if(!/ F[0-9.]+/.test(line))bad=true;rapid=false;}
            });
            return {n,bad,g:files[0].gcode};
        }''')
        check('空切維持G0且明確帶F1800',result['n']>1 and not result['bad'])
        check('切削走速仍恢復刀具原值',page.evaluate('files[0].gcode.includes("F"+tools[0].f)'))
        page.uncheck('#rapid-enable')
        check('可切回原本控制器快移',page.evaluate('!files[0].gcode.split("\\n").some(line=>/^G0 X.* F/.test(line))'))
        page.check('#rapid-enable');page.select_option('#lp-op','laserLine')
        page.fill('#lp-laser-feed','555');page.dispatch_event('#lp-laser-feed','change')
        check('雷射畫線加工F與空切F各自獨立',page.evaluate('files[0].gcode.includes("F555")&&files[0].gcode.includes("G0 X")&&files[0].gcode.includes("F1800")'))
        browser.close()
    print(f'{sum(RESULTS)}/{len(RESULTS)} 通過');assert all(RESULTS)


if __name__=='__main__':
    main()
