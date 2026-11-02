"""刀徑補償圓角使用毫米容差，不產生不必要的超細分段。"""
from playwright.sync_api import sync_playwright
from draw_objects import BASE, RESULTS, check


def main():
    """以六毫米刀繞方形，核對分段數、補償距離與閉合。"""
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page()
        page.goto(BASE + '/CNC.html')
        result = page.evaluate('''() => {
            const path=GordixCam.profilePaths([{x:0,y:0},{x:20,y:0},{x:20,y:20},{x:0,y:20},{x:0,y:0}],{type:'outer',d:6,resolution:.000001},1)[0];
            const distances=path.slice(1).map((p,i)=>{
                const x=(p.x+path[i].x)/2,y=(p.y+path[i].y)/2;
                return Math.hypot(x-Math.max(0,Math.min(20,x)),y-Math.max(0,Math.min(20,y)));
            });
            return {n:path.length,min:Math.min(...distances),max:Math.max(...distances),closed:JSON.stringify(path[0])===JSON.stringify(path.at(-1))};
        }''')
        check('圓角不再產生過量線段', result['n'] < 100)
        check('三毫米刀徑補償誤差小於六微米', result['min'] >= 2.994 and result['max'] <= 3.0002)
        check('輪廓仍閉合', result['closed'])
        browser.close()
    assert all(RESULTS)


if __name__ == '__main__':
    main()
