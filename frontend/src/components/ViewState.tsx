interface ViewStateProps {
  kind: 'loading' | 'empty' | 'error';
  message?: string;
  onRetry?: () => void;
}
import { useI18n } from '../i18n';

export function ViewState({ kind, message, onRetry }: ViewStateProps) {
  const { t } = useI18n();
  const content = {
    loading: [t('view.loading.title'), t('view.loading.body')], empty: [t('view.empty.title'), t('view.empty.body')], error: [t('view.error.title'), message ?? t('view.error.body')],
  }[kind];

  return (
    <div className={`view-state view-state--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <div className="view-state__signal">{kind === 'loading' ? <span className="spinner" /> : kind === 'empty' ? '○' : '!'}</div>
      <h2>{content[0]}</h2>
      <p>{content[1]}</p>
      {kind === 'error' && onRetry && <button onClick={onRetry}>{t('action.retry')}</button>}
    </div>
  );
}
