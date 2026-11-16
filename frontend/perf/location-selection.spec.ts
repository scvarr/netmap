import {test,expect} from '@playwright/test';
test('selects and arranges Locations through real React Flow layers without stealing object/actions',async({page})=>{
 await page.setViewportSize({width:1600,height:1200});
 await page.goto('/perf/location-selection.html');
 const frame=(id:string)=>page.locator(`.location-frame[data-location-id="${id}"]`);
 const selected=()=>page.locator('.location-frame--arrangement-selected,.location-proxy--arrangement-selected');
 const arrows=page.locator('.location-arrangement-arrows');
 await expect(frame('A')).toBeVisible(); await page.waitForTimeout(400);
 await page.getByRole('button',{name:'zoom 1',exact:true}).click();
 await expect(arrows).toHaveCount(0);
 await page.getByLabel('Расстановка',{exact:true}).check();
 await frame('A').locator('.location-frame__label').click();
 await expect(frame('A')).toHaveClass(/arrangement-selected/); await expect(frame('A')).toHaveCSS('border-top-color','rgb(240, 189, 102)'); await expect(frame('A').locator('.location-frame__heading')).toHaveCSS('background-color','rgb(89, 64, 34)'); await expect(arrows.getByRole('button')).toHaveCount(4);
 // Free space at bottom right of a nested child belongs to the child, not its parent.
 const free=async(id:string)=>{const b=await frame(id).boundingBox();await page.mouse.click(b!.x+b!.width-18,b!.y+b!.height-12);};
 await free('inner');await expect(frame('inner')).toHaveClass(/arrangement-selected/);await expect(selected()).toHaveCount(1);
 // PhysicalObject remains an ordinary node click, leaving Location selection alone.
 await page.locator('.react-flow__node[data-id="one"]').click({position:{x:70,y:60}});
 await expect(page.getByTestId('object')).toHaveText('one');await expect(frame('inner')).toHaveClass(/arrangement-selected/);
 await frame('A').locator('button[title*="Свернуть"]').click();await expect(page.getByTestId('actions')).toHaveText('collapse:A');await expect(frame('inner')).toHaveClass(/arrangement-selected/);
 await frame('A').locator('.location-frame__actions button').last().click();await expect(page.getByTestId('actions')).toHaveText('configure:A');await expect(frame('inner')).toHaveClass(/arrangement-selected/);
 // Boundary starts its own edit session and must not select its Location.
 const point=await frame('A').locator('.location-boundary-point').boundingBox();await page.mouse.move(point!.x+point!.width/2,point!.y+point!.height/2);await page.mouse.down();await page.mouse.move(point!.x-20,point!.y+25,{steps:4});await page.mouse.up();await frame('A').getByRole('button',{name:'Сохранить',exact:true}).click();await expect(page.getByTestId('actions')).toHaveText('boundary');await expect(frame('inner')).toHaveClass(/arrangement-selected/);
 const proxy=page.locator('.location-proxy[data-location-id="B"]');await proxy.locator('.location-proxy__label').click();await expect(proxy).toHaveClass(/arrangement-selected/);await expect(selected()).toHaveCount(1);
 await free('A');await expect(frame('A')).toHaveClass(/arrangement-selected/);
 const oldX=(await frame('A').boundingBox())!.x;
 await page.getByRole('button',{name:'Переместить вправо',exact:true}).click();await expect(frame('A')).toHaveClass(/arrangement-selected/);await expect.poll(async()=>(await frame('A').boundingBox())!.x).not.toBe(oldX);
 // Force an ordinary RF node under the arrows to exercise stacking, not just visibility.
 for(const zoom of [.35,1,4]){
   await page.getByRole('button',{name:`zoom ${zoom}`,exact:true}).click();
   const button=arrows.getByRole('button').last();const b=await button.boundingBox();
   await page.locator('.react-flow__node[data-id="two"]').evaluate((node:any,box:any)=>{
     const viewport=node.closest('.react-flow__viewport');const origin=viewport.getBoundingClientRect();const scale=new DOMMatrix(getComputedStyle(viewport).transform).a;
     node.style.position='absolute';node.style.left='0';node.style.top='0';node.style.transform=`translate(${(box.x-origin.x)/scale}px,${(box.y-origin.y)/scale}px)`;
   },b);
   const covered=await page.locator('.react-flow__node[data-id="two"]').boundingBox();expect(covered!.x).toBeLessThanOrEqual(b!.x+1);expect(covered!.y).toBeLessThanOrEqual(b!.y+1);
   expect(await button.evaluate(el=>{const b=el.getBoundingClientRect();return el.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2));})).toBe(true);
 }
 await page.getByRole('button',{name:'zoom 1',exact:true}).click();
 await page.getByRole('button',{name:'Отмена',exact:true}).click();await expect(selected()).toHaveCount(0);await expect(arrows).toHaveCount(0);await expect(page.getByTestId('saves')).toHaveText('0');
 await page.getByLabel('Расстановка',{exact:true}).check();await frame('A').locator('.location-frame__label').click();await page.getByRole('button',{name:'Переместить вправо',exact:true}).click();await page.getByRole('button',{name:'Готово',exact:true}).click();await expect(page.getByTestId('saves')).toHaveText('1');await expect(selected()).toHaveCount(0);
 await page.getByLabel('Расстановка',{exact:true}).check();await frame('A').locator('.location-frame__label').click();await page.getByRole('button',{name:'variant',exact:true}).click();await expect(selected()).toHaveCount(0);await expect(arrows).toHaveCount(0);
 await page.getByLabel('Расстановка',{exact:true}).check();await frame('A').locator('.location-frame__label').click();await page.getByLabel('Расстановка',{exact:true}).uncheck();await expect(selected()).toHaveCount(0);
 await page.screenshot({path:test.info().outputPath('canvas.png')});
});
