import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PhysicalCompatibilityPreview } from '../topology/physicalCompatibility';

type Result = { preview: PhysicalCompatibilityPreview; failed?: never } | { preview?: never; failed: true };

export function useCompatibilityPreview(
  requestKey: string | null,
  source: object | undefined,
  load: () => Promise<PhysicalCompatibilityPreview>,
) {
  const [attempt, setAttempt] = useState(0);
  const request = useMemo(() => ({ requestKey, source, attempt }), [requestKey, source, attempt]);
  const [result, setResult] = useState<{ request: typeof request } & Result>();
  const generation = useRef(0);
  const read = useEffectEvent(load);
  useLayoutEffect(() => {
    generation.current++;
    return () => { generation.current++; };
  }, [request]);
  useEffect(() => {
    if (request.requestKey === null) return;
    const current = generation.current;
    const publish = (outcome: Result) => {
      if (generation.current === current) setResult({ request, ...outcome });
    };
    // Let related form updates settle before sending a preview.
    const timer = setTimeout(() => {
      void Promise.resolve().then(read).then(preview => publish({ preview }), () => publish({ failed: true }));
    }, 150);
    return () => clearTimeout(timer);
  }, [request]);
  const current = result?.request === request ? result : undefined;
  const capture = () => {
    const stamp = generation.current;
    return () => generation.current === stamp;
  };
  return {
    preview: current?.preview, failed: current?.failed, waiting: requestKey !== null && !current,
    retry: () => { generation.current++; setAttempt(value => value + 1); }, capture,
  };
}
