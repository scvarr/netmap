import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../i18n";
import { Breadcrumbs, PageHeader, PageShell } from "../components/PageChrome";
import type {
  LocationDataSource,
  LocationDocument,
} from "../topology/locationTypes";

type Form = {
  mode: "create" | "edit" | "reparent";
  location?: LocationDocument;
  name: string;
  type: string;
  parentId: string | null;
  error: string | null;
};
const failure = (reason: unknown) =>
  reason instanceof Error ? reason.message : String(reason);

const descendants = (items: LocationDocument[], id: string) => {
  const children = new Map<string, string[]>();
  items.forEach((item) => {
    const parent = item.parent_location_ref?.entity_id;
    if (parent)
      children.set(parent, [
        ...(children.get(parent) ?? []),
        item.location_ref.entity_id,
      ]);
  });
  const blocked = new Set([id]);
  const queue = [id];
  while (queue.length)
    for (const child of children.get(queue.shift()!) ?? [])
      if (!blocked.has(child)) {
        blocked.add(child);
        queue.push(child);
      }
  return blocked;
};

function LocationTree({
  items,
  parentId,
  collapsed,
  onToggle,
  onEdit,
  onChild,
  onMove,
  onDelete,
}: {
  items: LocationDocument[];
  parentId: string | null;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  onEdit: (item: LocationDocument) => void;
  onChild: (item: LocationDocument) => void;
  onMove: (item: LocationDocument) => void;
  onDelete: (item: LocationDocument) => void;
}) {
  const { t } = useI18n();
  const children = items.filter(
    (item) => (item.parent_location_ref?.entity_id ?? null) === parentId,
  );
  if (!children.length) return null;
  return (
    <ul className="location-tree">
      {children.map((item) => {
        const id = item.location_ref.entity_id;
        const hasChildren = items.some(
          (child) => child.parent_location_ref?.entity_id === id,
        );
        const isExpanded = !collapsed.has(id);
        return (
        <li key={id}>
          <div className="location-tree__item">
            <div className="location-tree__identity">
              {hasChildren ? (
                <button type="button" className="location-tree__toggle" aria-label={isExpanded ? t("location.pickerCollapse", { name: item.name }) : t("location.pickerExpand", { name: item.name })} onClick={() => onToggle(id)}>
                  {isExpanded ? "−" : "+"}
                </button>
              ) : <span className="location-tree__toggle-placeholder" aria-hidden="true" />}
              <span>
                <strong>{item.name}</strong>
                {item.type && <small>{item.type}</small>}
              </span>
            </div>
            <div>
              <button type="button" onClick={() => onChild(item)}>
                {t("location.createChild")}
              </button>
              <button type="button" onClick={() => onEdit(item)}>
                {t("location.edit")}
              </button>
              <button type="button" onClick={() => onMove(item)}>
                {t("location.reparent")}
              </button>
              <button
                type="button"
                className="location-tree__danger"
                onClick={() => onDelete(item)}
              >
                {t("location.delete")}
              </button>
            </div>
          </div>
          {hasChildren && isExpanded && <LocationTree
            items={items}
            parentId={id}
            collapsed={collapsed}
            onToggle={onToggle}
            onEdit={onEdit}
            onChild={onChild}
            onMove={onMove}
            onDelete={onDelete}
          />}
        </li>
        );
      })}
    </ul>
  );
}

function LocationParentPicker({ items, selected, forbidden, onSelect }: {
  items: LocationDocument[];
  selected: string | null;
  forbidden: Set<string>;
  onSelect: (id: string | null) => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(items.filter((item) => items.some((child) => child.parent_location_ref?.entity_id === item.location_ref.entity_id)).map((item) => item.location_ref.entity_id)));
  const children = (parentId: string | null) => items.filter((item) => (item.parent_location_ref?.entity_id ?? null) === parentId && !forbidden.has(item.location_ref.entity_id));
  const render = (parentId: string | null): React.ReactNode => {
    const nodes = children(parentId);
    if (!nodes.length) return null;
    return <ul className="object-location-picker-tree" role={parentId === null ? "radiogroup" : "group"}>{nodes.map((item) => {
      const id = item.location_ref.entity_id;
      const hasChildren = children(id).length > 0;
      const isExpanded = expanded.has(id);
      return <li key={id}><div className="object-location-picker-tree__row"><span className="object-location-picker-tree__toggle">{hasChildren ? <button type="button" aria-label={isExpanded ? t("location.pickerCollapse", { name: item.name }) : t("location.pickerExpand", { name: item.name })} onClick={() => setExpanded((previous) => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; })}>{isExpanded ? "−" : "+"}</button> : <span aria-hidden="true" />}</span><button type="button" role="radio" aria-checked={selected === id} className="object-location-picker-tree__choice" onClick={() => onSelect(id)}><strong>{item.name}</strong>{item.type && <small>{item.type}</small>}</button></div>{hasChildren && isExpanded && render(id)}</li>;
    })}</ul>;
  };
  return <fieldset className="location-parent-picker"><legend>{t("location.parent")}</legend><div className="object-location-picker__toolbar"><button type="button" role="radio" aria-checked={selected === null} onClick={() => onSelect(null)}>{t("location.root")}</button></div>{render(null)}</fieldset>;
}

export function LocationsPage({
  dataSource,
}: {
  dataSource: LocationDataSource;
}) {
  const { t } = useI18n();
  const [locations, setLocations] = useState<LocationDocument[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [form, setForm] = useState<Form | null>(null);
  const [collapsedLocations, setCollapsedLocations] = useState<Set<string>>(
    new Set(),
  );
  const [deleting, setDeleting] = useState<LocationDocument | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshAfterWrite, setRefreshAfterWrite] = useState(false);
  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      setLocations(await dataSource.loadLocations());
      setRefreshAfterWrite(false);
    } catch (reason) {
      setLocations(null);
      setLoadError(failure(reason));
      throw reason;
    }
  }, [dataSource]);
  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh, revision]);
  const sorted = useMemo(
    () =>
      locations
        ? [...locations].sort((a, b) => a.name.localeCompare(b.name))
        : [],
    [locations],
  );
  const openCreate = (parentId: string | null) =>
    setForm({ mode: "create", name: "", type: "", parentId, error: null });
  const openEdit = (location: LocationDocument) =>
    setForm({
      mode: "edit",
      location,
      name: location.name,
      type: location.type ?? "",
      parentId: location.parent_location_ref?.entity_id ?? null,
      error: null,
    });
  const openMove = (location: LocationDocument) =>
    setForm({
      mode: "reparent",
      location,
      name: location.name,
      type: location.type ?? "",
      parentId: location.parent_location_ref?.entity_id ?? null,
      error: null,
    });
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form) return;
    setBusy(true);
    const saved = form;
    try {
      if (saved.mode === "create")
        await dataSource.createLocation({
          name: saved.name.trim(),
          type: saved.type.trim() || null,
          parent_location_id: saved.parentId,
        });
      if (saved.mode === "edit")
        await dataSource.updateLocation(
          saved.location!.location_ref.entity_id,
          { name: saved.name.trim(), type: saved.type.trim() || null },
        );
      if (saved.mode === "reparent")
        await dataSource.reparentLocation(
          saved.location!.location_ref.entity_id,
          saved.parentId,
        );
      setForm(null);
      setLocations(null);
      try {
        await refresh();
      } catch {
        setRefreshAfterWrite(true);
      }
    } catch (reason) {
      setForm({ ...saved, error: failure(reason) });
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await dataSource.deleteLocation(deleting.location_ref.entity_id);
      setDeleting(null);
      setDeleteError(null);
      setLocations(null);
      try {
        await refresh();
      } catch {
        setRefreshAfterWrite(true);
      }
    } catch (reason) {
      setDeleteError(failure(reason));
    } finally {
      setBusy(false);
    }
  };
  const forbiddenParents =
    form?.location && locations
      ? descendants(locations, form.location.location_ref.entity_id)
      : new Set<string>();
  return (
    <PageShell className="catalog-page locations-page">
      <Breadcrumbs label={t("location.breadcrumbs")} items={[{ label: t("nav.infrastructure") }, { label: t("nav.locations") }]} />
      <PageHeader
        eyebrow={t("nav.infrastructure")}
        title={t("location.title")}
        description={t("location.description")}
        actions={
          <button
            className="primary-action"
            type="button"
            onClick={() => openCreate(null)}
          >
            {t("location.createRoot")}
          </button>
        }
      />
      {refreshAfterWrite && (
        <p role="alert" className="catalog-note catalog-note--gap">
          {t("location.writeRefreshFailed")}{" "}
          <button
            type="button"
            onClick={() => setRevision((value) => value + 1)}
          >
            {t("location.retryRefresh")}
          </button>
        </p>
      )}
      {loadError ? (
        <section className="catalog-note catalog-note--gap" role="alert">
          {t("location.loadFailed", { error: loadError })}{" "}
          <button
            type="button"
            onClick={() => setRevision((value) => value + 1)}
          >
            {t("action.retry")}
          </button>
        </section>
      ) : locations === null ? (
        <p>{t("location.loading")}</p>
      ) : sorted.length ? (
        <LocationTree
          items={sorted}
          parentId={null}
          collapsed={collapsedLocations}
          onToggle={(id) =>
            setCollapsedLocations((previous) => {
              const next = new Set(previous);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          onEdit={openEdit}
          onChild={(item) => openCreate(item.location_ref.entity_id)}
          onMove={openMove}
          onDelete={setDeleting}
        />
      ) : (
        <p>{t("location.empty")}</p>
      )}
      {form && (
        <section
          className="catalog-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={
            form.mode === "create"
              ? t("location.create")
              : form.mode === "edit"
                ? t("location.edit")
                : t("location.reparent")
          }
        >
          <form
            className="catalog-dialog__surface"
            onSubmit={(event) => void submit(event)}
          >
            <h2>
              {form.mode === "create"
                ? t("location.create")
                : form.mode === "edit"
                  ? t("location.edit")
                  : t("location.reparent")}
            </h2>
            {form.mode !== "reparent" && (
              <>
                <label>
                  <span>{t("location.name")}</span>
                  <input
                    autoFocus
                    value={form.name}
                    onChange={(event) =>
                      setForm({ ...form, name: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>{t("location.type")}</span>
                  <input
                    value={form.type}
                    onChange={(event) =>
                      setForm({ ...form, type: event.target.value })
                    }
                  />
                </label>
                <p className="location-form__hint">{t("location.typeHint")}</p>
              </>
            )}{" "}
            {form.mode !== "edit" && (
              <LocationParentPicker
                items={sorted}
                selected={form.parentId}
                forbidden={forbiddenParents}
                onSelect={(parentId) => setForm({ ...form, parentId })}
              />
            )}
            {form.error && (
              <p className="catalog-dialog__error" role="alert">
                {t("location.writeFailed", { error: form.error })}
              </p>
            )}
            <div className="catalog-dialog__actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => setForm(null)}
              >
                {t("action.cancel")}
              </button>
              <button
                type="submit"
                disabled={
                  busy || (form.mode !== "reparent" && !form.name.trim())
                }
              >
                {busy ? t("location.saving") : t("catalog.save")}
              </button>
            </div>
          </form>
        </section>
      )}
      {deleting && (
        <section
          className="catalog-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={t("location.delete")}
        >
          <div className="catalog-dialog__surface">
            <h2>{t("location.delete")}</h2>
            <p>{t("location.deleteConfirm", { name: deleting.name })}</p>
            {deleteError && (
              <p className="catalog-dialog__error" role="alert">
                {t("location.deleteFailed", { error: deleteError })}
              </p>
            )}
            <div className="catalog-dialog__actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setDeleting(null);
                  setDeleteError(null);
                }}
              >
                {t("action.cancel")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void remove()}
              >
                {busy ? t("location.deleting") : t("location.delete")}
              </button>
            </div>
          </div>
        </section>
      )}
    </PageShell>
  );
}
