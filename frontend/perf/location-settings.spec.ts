import {test,expect} from '@playwright/test';
for(const viewport of [{width:1024,height:768},{width:1600,height:900}]) for(const columns of [1,14]) {
 test(`42 children, ${columns} columns, ${viewport.width}`,async({page})=>{
  await page.setViewportSize(viewport); await page.goto(`/perf/location-settings.html?columns=${columns}`);
  await page.getByRole('button',{name:'Настройки 823'}).click();
  const dialog=page.getByRole('dialog',{name:'Настройки: 823',exact:true});
  await dialog.getByRole('tab',{name:'Компоновка',exact:true}).click();
  const table=dialog.locator('.location-grid-sorting__table');
  const bounds=await dialog.locator('section').boundingBox(); expect(bounds!.y).toBeGreaterThanOrEqual(0);expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(viewport.height);
  for(const name of ['Вся таблица','По возрастанию','По убыванию']) {const button=dialog.getByRole('button',{name,exact:true});await expect(button).toBeInViewport();await expect(button).toBeVisible();}
  if(columns===1) expect(await table.evaluate(e=>e.scrollHeight>e.clientHeight)).toBe(true);
  if(columns>1) expect(await table.evaluate(e=>e.scrollWidth>e.clientWidth)).toBe(true);
  await table.evaluate(e=>{e.scrollTop=e.scrollHeight;e.scrollLeft=e.scrollWidth;});
  if(columns===1) expect(await table.evaluate(e=>e.scrollTop)).toBeGreaterThan(0);
  if(columns>1) expect(await table.evaluate(e=>e.scrollLeft)).toBeGreaterThan(0);
  await table.evaluate(e=>{e.scrollTop=0;e.scrollLeft=0;});
  await dialog.getByRole('button',{name:'R1',exact:true}).click();await dialog.getByRole('button',{name:'По возрастанию',exact:true}).click();
  await dialog.getByRole('button',{name:'C1',exact:true}).click();await dialog.getByRole('button',{name:'По убыванию',exact:true}).click();
  await dialog.getByRole('button',{name:'Вся таблица',exact:true}).click();await dialog.getByRole('button',{name:'По возрастанию',exact:true}).click();
  const preview=await page.getByTestId('preview').textContent();
  await dialog.getByRole('tab',{name:'Сворачивание',exact:true}).click();await expect(dialog.getByLabel('U42',{exact:true})).toBeVisible();
  await dialog.getByRole('tab',{name:'Компоновка',exact:true}).click();await expect(page.getByTestId('preview')).toHaveText(preview!);await expect(page.getByTestId('variant')).toHaveText('one');
  await expect(page.getByTestId('saves')).toHaveText('0');await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();
  await expect(dialog).toHaveCount(0);await expect(page.getByTestId('preview')).toHaveText(preview!);await expect(page.locator('.location-frame[data-location-id="A"]')).toBeVisible();
  await page.getByRole('button',{name:'Отмена',exact:true}).click();await expect(page.getByTestId('saves')).toHaveText('0');
  await page.getByRole('button',{name:'Настройки 823'}).click();await dialog.getByRole('tab',{name:'Компоновка',exact:true}).click();await dialog.getByRole('button',{name:'По убыванию',exact:true}).click();await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();
  await page.getByRole('button',{name:'Готово',exact:true}).click();await expect(page.getByTestId('saves')).toHaveText('1');
 });
}
