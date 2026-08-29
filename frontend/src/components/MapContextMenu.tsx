import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../i18n";

export type MapContextTarget =
  | { kind: "empty"; anchor: { x: number; y: number }; screen: { x: number; y: number } }
  | { kind: "object"; id: string; label: string; locked: boolean; screen: { x: number; y: number } }
  | { kind: "cable"; id: string; label: string; hasRoute: boolean; screen: { x: number; y: number } }
  | { kind: "port"; objectId: string; label: string; connectionPointId: string; screen: { x: number; y: number }; action: "loading" | "connect" | { disconnectConnectionId: string } | "unavailable" };

interface MapContextMenuProps {
  target: MapContextTarget; onClose: () => void;
  onAdd?: (anchor: { x: number; y: number }) => void; onSetLock?: (id: string, locked: boolean) => void;
  onRemove?: (id: string) => void; onDeleteObject?: (id: string, label: string) => void;
  onEditRoute?: (id: string) => void; onResetRoute?: (id: string) => void; onDeleteCable?: (id: string, label: string) => void;
  onConnectFromPort?: (objectId: string, connectionPointId: string) => void; onDisconnect?: (connectionId: string, label: string) => void;
}
export function MapContextMenu({ target, onClose, ...actions }: MapContextMenuProps) {
  const { t } = useI18n(); const ref = useRef<HTMLDivElement>(null); const [position, setPosition] = useState(target.screen);
  useLayoutEffect(() => { const rect = ref.current?.getBoundingClientRect(); if (rect) setPosition({ x: Math.max(12, Math.min(target.screen.x, window.innerWidth - rect.width - 12)), y: Math.max(12, Math.min(target.screen.y, window.innerHeight - rect.height - 12)) }); }, [target]);
  useEffect(() => { const escape = (event: KeyboardEvent) => event.key === "Escape" && onClose(); const outside = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) onClose(); }; window.addEventListener("keydown", escape); window.addEventListener("mousedown", outside); return () => { window.removeEventListener("keydown", escape); window.removeEventListener("mousedown", outside); }; }, [onClose]);
  const run = (action?: () => void) => { onClose(); action?.(); };
  const portAction = target.kind === "port" && typeof target.action === "object" ? target.action : null;
  return <div ref={ref} className="map-context-menu" role="menu" style={{ left: position.x, top: position.y }}>
    {target.kind === "empty" && <button role="menuitem" onClick={() => run(() => actions.onAdd?.(target.anchor))}>{t("map.add")}&hellip;</button>}
    {target.kind === "object" && <><Link role="menuitem" to={`/infrastructure/objects/${encodeURIComponent(target.id)}`} onClick={onClose}>{t("inspector.open")}</Link><button role="menuitem" onClick={() => run(() => actions.onSetLock?.(target.id, !target.locked))}>{target.locked ? t("inspector.unlock") : t("inspector.lock")}</button><button role="menuitem" onClick={() => run(() => actions.onRemove?.(target.id))}>{t("inspector.remove")}</button><button role="menuitem" className="map-context-menu__danger" onClick={() => run(() => actions.onDeleteObject?.(target.id, target.label))}>{t("inspector.deleteObject")}&hellip;</button></>}
    {target.kind === "cable" && <><button role="menuitem" onClick={() => run(() => actions.onEditRoute?.(target.id))}>{t("inspector.editRoute")}</button>{target.hasRoute && <button role="menuitem" onClick={() => run(() => actions.onResetRoute?.(target.id))}>{t("inspector.resetRoute")}</button>}<button role="menuitem" className="map-context-menu__danger" onClick={() => run(() => actions.onDeleteCable?.(target.id, target.label))}>{t("inspector.deleteCable")}&hellip;</button></>}
    {target.kind === "port" && <><p>{target.label}</p>{target.action === "loading" && <p>{t("map.context.loadingPort")}</p>}{target.action === "connect" && <button role="menuitem" onClick={() => run(() => actions.onConnectFromPort?.(target.objectId, target.connectionPointId))}>{t("map.context.connectFrom")}&hellip;</button>}{portAction && <button role="menuitem" className="map-context-menu__danger" onClick={() => run(() => actions.onDisconnect?.(portAction.disconnectConnectionId, target.label))}>{t("map.context.disconnect")}&hellip;</button>}{target.action === "unavailable" && <p>{t("map.context.portUnavailable")}</p>}</>}
  </div>;
}
