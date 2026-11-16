import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { LocationArrangementArrows } from './LocationArrangementArrows';
vi.mock('../i18n', () => ({ useI18n: () => ({t:(key:string)=>key}) }));
it('renders four distinct arrow commands and disables no-result operations without bubbling', () => {
 const move=vi.fn(), parent=vi.fn();
 render(<div onClick={parent}><LocationArrangementArrows canMove={d=>d==='RIGHT'} onMove={move}/></div>);
 expect(screen.getAllByRole('button')).toHaveLength(4);
 expect(screen.getByLabelText('autoLocation.moveUP')).toBeDisabled();
 fireEvent.click(screen.getByLabelText('autoLocation.moveRIGHT'));
 expect(move).toHaveBeenCalledWith('RIGHT'); expect(parent).not.toHaveBeenCalled();
});
