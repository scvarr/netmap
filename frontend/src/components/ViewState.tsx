interface ViewStateProps {
  kind: 'loading' | 'empty' | 'error';
  message?: string;
  onRetry?: () => void;
}

export function ViewState({ kind, message, onRetry }: ViewStateProps) {
  const content = {
    loading: ['Загружаем topology projection', 'Подготавливаем логическую схему…'],
    empty: ['В этом scope пока пусто', 'Projection не содержит устройств или связей.'],
    error: ['Не удалось загрузить схему', message ?? 'Источник topology projection вернул ошибку.'],
  }[kind];

  return (
    <div className={`view-state view-state--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <div className="view-state__signal">{kind === 'loading' ? <span className="spinner" /> : kind === 'empty' ? '○' : '!'}</div>
      <h2>{content[0]}</h2>
      <p>{content[1]}</p>
      {kind === 'error' && onRetry && <button onClick={onRetry}>Повторить</button>}
    </div>
  );
}
