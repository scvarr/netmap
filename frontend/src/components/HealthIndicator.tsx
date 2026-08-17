import { useEffect, useState } from 'react';

type HealthState = 'checking' | 'healthy' | 'unavailable';

export function HealthIndicator() {
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

  const labels: Record<HealthState, string> = {
    checking: 'Проверка backend',
    healthy: 'Backend доступен',
    unavailable: 'Backend недоступен',
  };

  return <div className={`health health--${state}`} role="status"><i />{labels[state]}</div>;
}
