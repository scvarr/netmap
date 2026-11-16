import {test,expect} from '@playwright/test';
test('sorts the real tiled canvas in one arrangement draft and saves only on Done',async({page})=>{
 await page.setViewportSize({width:1600,height:1500});
 await page.goto('/perf/location-selection.html');
 const frame=(id:string)=>page.locator(`.location-frame[data-location-id="${id}"]`);
 await expect(frame('A')).toBeVisible();
 await page.getByRole('button',{name:'По убыванию',exact:true}).click();
 await expect(page.getByLabel('Расстановка',{exact:true})).toBeChecked();
 await expect(page.getByTestId('saves')).toHaveText('0');
 await expect.poll(async()=>{const a=await frame('A').boundingBox();const c=await frame('C').boundingBox();return a!.y>c!.y;}).toBe(true);
 await expect(frame('inner')).toBeVisible();
 await page.getByRole('button',{name:'Отмена',exact:true}).click();
 await expect(page.getByTestId('saves')).toHaveText('0');
 await page.getByRole('button',{name:'По убыванию',exact:true}).click();
 await page.getByRole('button',{name:'Готово',exact:true}).click();
 await expect(page.getByTestId('saves')).toHaveText('1');
 await expect(page.getByTestId('saved')).toContainText('"root":[["C"],["B"],["A"]]');
 await expect(page.getByLabel('Расстановка',{exact:true})).not.toBeChecked();
});
