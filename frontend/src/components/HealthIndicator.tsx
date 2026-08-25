import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';

type HealthState = 'checking' | 'healthy' | 'unavailable';

export function HealthIndicator() {
  const { t } = useI18n();
  const [state, setState] = useState<HealthState>('checking');

  useEffect(() => {
    const controller = new AbortController();
    const check = async () => {
      try {
        const response = await fetch('/api/health', { signal: controller.signal });
        setState(response.ok ? 'healthy' : 'unavailable');
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setState('unavailable');
      }
    };
    void check();
    return () => controller.abort();
  }, []);

  const labels: Record<HealthState, ReturnType<typeof t>> = {
    checking: t('health.checking'), healthy: t('health.healthy'), unavailable: t('health.unavailable'),
  };

  return <div className={`health health--${state}`} role="status"><i />{labels[state]}</div>;
}
