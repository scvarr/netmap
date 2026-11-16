import {fireEvent,render,screen} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {I18nProvider} from '../i18n';
import {LocationGridSorting} from './LocationGridSorting';
import type {LocationGridArrangement} from './useLocationGridArrangement';
it('selects indexed row/column scopes, shows holes and supports traversal and direction',()=>{
 const sort=vi.fn();
 render(<I18nProvider><LocationGridSorting parent="root" table={[[null,'a'],['b',null]]} locations={[]} arrangement={{sort,busy:false} as unknown as LocationGridArrangement}/></I18nProvider>);
 expect(screen.getAllByText('Пусто')).toHaveLength(2);
 fireEvent.click(screen.getByRole('button',{name:'R1'})); fireEvent.click(screen.getByText('По возрастанию'));
 expect(sort).toHaveBeenLastCalledWith('root',{kind:'row',index:0},false);
 fireEvent.click(screen.getByRole('button',{name:'C2'})); fireEvent.click(screen.getByText('По убыванию'));
 expect(sort).toHaveBeenLastCalledWith('root',{kind:'column',index:1},true);
 fireEvent.click(screen.getByText('Вся таблица')); fireEvent.change(screen.getByLabelText('Порядок обхода'),{target:{value:'columns'}}); fireEvent.click(screen.getByText('По возрастанию'));
 expect(sort).toHaveBeenLastCalledWith('root',{kind:'all',traversal:'columns'},false);
});
