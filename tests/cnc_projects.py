"""驗證專案往返、重新載入備份、非法檔案及繼續追加圖檔。"""
import json
from playwright.sync_api import sync_playwright
from draw_objects import BASE, RESULTS, check, svg_file


def main():
    """透過真實瀏覽器下載與開啟完整專案。"""
    errors = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={'width': 1500, 'height': 1000})
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(BASE + '/CNC.html')
        page.set_input_files('#file-input', [svg_file('one.svg'), svg_file('two.svg')])
        page.wait_for_function('job.objects.length===2 && !importBusy')
        page.click('#op-all')
        page.click('#op-group')
        page.fill('#op-angle', '37')
        page.dispatch_event('#op-angle', 'change')
        page.click('#advanced-toggle')
        page.fill('#safe-z', '4')
        page.dispatch_event('#safe-z', 'change')
        before = page.evaluate('({objects:job.objects,layers:job.layers,tools,stock,table,code:files.map(f=>f.gcode)})')
        with page.expect_download() as pending:
            page.click('#project-save')
        download = pending.value
        data = json.loads(open(download.path(), encoding='utf-8').read())
        check('專案內包含兩份完整原圖', len(data['sources']) == 2 and all(s['data'] for s in data['sources']))
        page.wait_for_timeout(900)
        page.reload()
        page.wait_for_selector('#project-recover:visible')
        check('重新載入保留恢復入口', page.evaluate('job.objects.length===0'))
        page.click('#project-recover')
        page.wait_for_function('job.objects.length===2')
        restored = page.evaluate('({objects:job.objects,layers:job.layers,tools,stock,table,code:files.map(f=>f.gcode)})')
        check('自動備份恢復座標群組參數與逐字相同刀路', restored == before)
        page.set_input_files('#project-input', {'name': 'project.json', 'mimeType': 'application/json', 'buffer': json.dumps(data).encode()})
        page.wait_for_timeout(300)
        check('專案檔開啟後刀路逐字相同', page.evaluate('files.map(f=>f.gcode)') == before['code'])
        invalid = json.loads(json.dumps(data))
        invalid['job']['objects'][0]['layerId'] = 'missing'
        page.set_input_files('#project-input', {'name': 'broken.json', 'mimeType': 'application/json', 'buffer': json.dumps(invalid).encode()})
        page.wait_for_timeout(300)
        check('非法專案拒絕且不改目前刀路', '開啟失敗' in page.locator('#project-status').inner_text() and page.evaluate('files.map(f=>f.gcode)') == before['code'])
        page.evaluate('''() => {
            const original=sourcePaths;
            sourcePaths=async(...args)=>{await new Promise(resolve=>setTimeout(resolve,2000));return original(...args);};
        }''')
        page.fill('#target-width', '200')
        page.dispatch_event('#target-width', 'input')
        page.wait_for_function('sourcePending>0')
        page.click('#project-save')
        page.wait_for_timeout(800)
        check('解析尚未完成時拒絕保存過時狀態', '重新解析' in page.locator('#project-status').inner_text())
        page.wait_for_function('sourcePending===0')
        page.set_input_files('#file-input', svg_file('three.svg'))
        page.wait_for_function('job.objects.length===3 && !importBusy')
        check('恢復後可追加圖片且識別碼不重複', page.evaluate('new Set(job.objects.map(o=>o.id)).size===3 && sources.size===3'))
        check('沒有瀏覽器例外', not errors)
        browser.close()
    print(f'{sum(RESULTS)}/{len(RESULTS)} 通過')
    assert all(RESULTS)


if __name__ == '__main__':
    main()
