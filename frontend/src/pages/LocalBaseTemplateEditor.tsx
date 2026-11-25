import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { useNavigate } from 'react-router-dom';
import { BaseTemplateEditor } from './BaseTemplateEditor';
import { useI18n } from '../i18n';
import { readLocalDraft, localDraftKey } from '../blueprints/localDraft';
import type { BlueprintEditorState } from '../blueprints/editorModel';

type Props = ComponentProps<typeof BaseTemplateEditor> & { templateId?: string; generation?: number; seeded?: boolean; onResume?: () => void };
export function LocalBaseTemplateEditor({ templateId, generation, seeded, onSave, onStateChange, ...props }: Props) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const key = localDraftKey(templateId);
  const [loaded] = useState(() => readLocalDraft(key));
  const conflict = !!loaded.draft && loaded.draft.generation !== (generation ?? null);
  const [pending, setPending] = useState(!!loaded.draft && (!templateId || conflict) || loaded.error === 'corrupt');
  const [initial, setInitial] = useState(loaded.draft && !conflict ? loaded.draft.state : props.initialState);
  const [status, setStatus] = useState<'unsaved' | 'saved' | 'error'>(loaded.error ? 'error' : loaded.draft ? 'saved' : 'unsaved');
  const [saving, setSaving] = useState(false);
  const latest = useRef<BlueprintEditorState>(initial);
  const baseline = useRef(seeded ? '' : JSON.stringify(props.initialState));
  const persisted = useRef(loaded.draft ? JSON.stringify(loaded.draft.state) : '');
  const enabled = useRef(!pending);
  const currentGeneration = useRef(generation ?? null);
  currentGeneration.current = generation ?? null;
  const flush = () => {
    if (!enabled.current) return;
    const serialized = JSON.stringify(latest.current);
    if (serialized === persisted.current || serialized === baseline.current && !persisted.current) return;
    try {
      localStorage.setItem(key, JSON.stringify({ version: 1, generation: currentGeneration.current, state: latest.current }));
      persisted.current = serialized; setStatus('saved');
    } catch { setStatus('error'); }
  };
  useEffect(() => {
    const leave = () => flush();
    window.addEventListener('pagehide', leave);
    window.addEventListener('beforeunload', leave);
    const hidden = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', hidden);
    return () => { flush(); window.removeEventListener('pagehide', leave); window.removeEventListener('beforeunload', leave); document.removeEventListener('visibilitychange', hidden); };
  }, [key]); // refs retain the latest committed editor state
  const [revision, setRevision] = useState(0);
  useEffect(() => { const timer = window.setTimeout(flush, 350); return () => window.clearTimeout(timer); }, [revision]);
  const changed = useCallback((state: BlueprintEditorState) => {
    latest.current = state;
    const serialized = JSON.stringify(state);
    if (serialized !== persisted.current && (serialized !== baseline.current || persisted.current)) setStatus('unsaved');
    setRevision(value => value + 1); onStateChange?.(state);
  }, [onStateChange]);
  const discard = () => {
    if (!window.confirm(t('localDraft.confirm'))) return;
    try { localStorage.removeItem(key); }
    catch { setStatus('error'); return; }
    persisted.current = ''; baseline.current = seeded ? '' : JSON.stringify(props.initialState);
    latest.current = props.initialState; setInitial(props.initialState);
    enabled.current = true; setPending(false); setStatus('unsaved');
  };
  const cancel = () => {
    if ((pending || persisted.current || JSON.stringify(latest.current) !== baseline.current) && !window.confirm(t('localDraft.confirm'))) return;
    try { localStorage.removeItem(key); } catch { setStatus('error'); return; }
    enabled.current = false; navigate('/library/base-templates');
  };
  return <>
    <p role={status === 'error' ? 'alert' : undefined} aria-live="polite">{t(status === 'error' ? 'localDraft.error' : status === 'saved' ? 'localDraft.saved' : 'localDraft.unsaved')}</p>
    {loaded.error === 'corrupt' && pending && <p role="alert">{t('localDraft.corrupt')}</p>}
    {pending ? <section>
      <p>{t(conflict ? 'localDraft.conflict' : 'localDraft.resume')}</p>
      {loaded.draft && !conflict && <button className="primary-action" onClick={() => { enabled.current = true; setPending(false); }}>{t('localDraft.continue')}</button>}
      <button className="secondary-action" onClick={discard}>{t('localDraft.restart')}</button>
      <button className="secondary-action" onClick={cancel}>{t('templateCopy.cancel')}</button>
    </section> : <fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <BaseTemplateEditor {...props} onCancel={cancel} initialState={initial} onStateChange={changed} onSave={async state => {
        flush(); setSaving(true);
        const snapshot = JSON.stringify(state);
        try {
          await onSave(state);
          if (JSON.stringify(latest.current) === snapshot) {
            baseline.current = snapshot;
            try { localStorage.removeItem(key); persisted.current = ''; setStatus('unsaved'); }
            catch { setStatus('error'); }
          }
        } finally { setSaving(false); }
      }} />
    </fieldset>}
  </>;
}
