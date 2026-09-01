interface Props { candidate: string; pending?: boolean; onCancel: () => void; onConfirm: () => void; }

export function HistoricalCableLabelReuseDialog({ candidate, pending = false, onCancel, onConfirm }: Props) {
  return <div className="catalog-dialog" role="dialog" aria-modal="true" aria-labelledby="historical-cable-label-title"><section className="catalog-dialog__surface">
    <h2 id="historical-cable-label-title">Имя {candidate} использовалось ранее</h2>
    <p>Кабель с этим именем был удалён или переименован. Такая маркировка ещё может встречаться на физическом оборудовании или в документации.</p>
    <div className="catalog-dialog__actions"><button type="button" onClick={onCancel} disabled={pending}>Отмена</button><button type="button" onClick={onConfirm} disabled={pending}>Использовать {candidate}</button></div>
  </section></div>;
}
