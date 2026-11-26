import { useEffect, useMemo, useState } from "react";
import type {
  DeviceDetailsDataSource,
  DeviceDetailsDocument,
} from "../topology/deviceDetailsTypes";
import type {
  CreatePhysicalEndpointConnectionRequest,
  PhysicalEndpointConnectionWriteDataSource,
  PhysicalEndpointRequest,
} from "../topology/physicalEndpointConnectionWriteTypes";
import type {
  ConnectionPointDetails,
  PhysicalObjectDetailsDataSource,
  PhysicalObjectDetailsDocument,
} from "../topology/physicalObjectDetailsTypes";
import { displayNodeLabel, numericAttribute } from "../topology/presentation";
import type { TopologyProjectionNode } from "../topology/types";
import { PhysicalMemberSelect } from "./PhysicalMemberSelect";
import { isAvailablePhysicalPort, physicalMemberLabel, selectedPhysicalMember } from "../topology/physicalPortAvailability";
import { useI18n } from "../i18n";
import { usePhysicalCompatibilityConfirmation } from './PhysicalCompatibilityDialog';
import { PhysicalCompatibilityError } from '../topology/physicalCompatibility';
import { FiberTypeSelect } from './FiberTypeSelect';
import type { FiberType } from '../topology/fiberTypes';
import { CableNamingFields } from './CableNamingFields';
import type { CableLabelDataSource, CableNamingInput } from '../topology/cableLabelTypes';

interface ConnectPhysicalEndpointProps {
  sourcePoint: ConnectionPointDetails;
  sourceObjectId?: string;
  topologyNodes: TopologyProjectionNode[];
  physicalDetailsDataSource: PhysicalObjectDetailsDataSource;
  deviceDetailsDataSource: DeviceDetailsDataSource;
  writeDataSource: PhysicalEndpointConnectionWriteDataSource;
  onConnected: () => void;
  cableLabelDataSource?: CableLabelDataSource;
}
type Mode = "PORT" | "INTERFACE";
type TargetState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "points"; document: PhysicalObjectDetailsDocument }
  | { kind: "interfaces"; document: DeviceDetailsDocument }
  | { kind: "error"; message: string };
const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});
const objectId = (node: TopologyProjectionNode): string | null => {
  const refs = node.source_refs.filter(
    (ref) =>
      ref.ref_type === "CANONICAL_FACT" && ref.entity_type === "PhysicalObject",
  );
  return refs.length === 1 ? refs[0].entity_id : null;
};
const sort = <T,>(items: T[], label: (item: T) => string) =>
  items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        collator.compare(label(a.item), label(b.item)) || a.index - b.index,
    )
    .map(({ item }) => item);
const label = (point: ConnectionPointDetails, fallback: string) =>
  /^ConnectionPoint\s+/i.test(point.label) ? fallback : point.label;
const freePort = (point: ConnectionPointDetails, sourceId: string) =>
  isAvailablePhysicalPort(point) &&
  point.connection_point_ref.entity_id !== sourceId;
const projectedFreePort = (node: TopologyProjectionNode, sourceId: string) =>
  (node.attributes.connection_points ?? []).some(
    (point) =>
      isAvailablePhysicalPort(point) && point.connection_point_id !== sourceId,
  );

export function ConnectPhysicalEndpoint({
  sourcePoint,
  sourceObjectId,
  topologyNodes,
  physicalDetailsDataSource,
  deviceDetailsDataSource,
  writeDataSource,
  onConnected,
  cableLabelDataSource,
}: ConnectPhysicalEndpointProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("PORT");
  const [targetObjectId, setTargetObjectId] = useState("");
  const [targetEntityId, setTargetEntityId] = useState("");
  const [sourceMember, setSourceMember] = useState<number>();
  const [targetMember, setTargetMember] = useState<number>();
  const [query, setQuery] = useState("");
  const [targetState, setTargetState] = useState<TargetState>({ kind: "idle" });
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { confirm, confirmationDialog } = usePhysicalCompatibilityConfirmation();
  const [error, setError] = useState<string | null>(null);
  const [fiberType, setFiberType] = useState<FiberType | null>(null);
  const [cableNaming, setCableNaming] = useState<CableNamingInput>({ cable_label: null, cable_label_template_id: null, generate_cable_label: false });
  const reset = () => {
    setOpen(false);
    setSourceMember(undefined);
    setTargetMember(undefined);
    setMode("PORT");
    setTargetObjectId("");
    setTargetEntityId("");
    setQuery("");
    setTargetState({ kind: "idle" });
    setError(null);
    setFiberType(null);
    setCableNaming({ cable_label: null, cable_label_template_id: null, generate_cable_label: false });
  };
  const candidates = useMemo(
    () =>
      sort(
        topologyNodes
          .flatMap((node) => {
            const id = objectId(node);
            if (
              node.kind !== "PHYSICAL_OBJECT" ||
              !id || id === sourceObjectId ||
              node.attributes.class === "cable"
            )
              return [];
            const usable =
              mode === "PORT"
                ? projectedFreePort(
                    node,
                    sourcePoint.connection_point_ref.entity_id,
                  )
                : (numericAttribute(node, "owned_interface_count") ?? 0) > 0;
            return usable ? [{ id, label: displayNodeLabel(node) }] : [];
          })
          .filter(
            (item) =>
              mode !== "PORT" ||
              item.label
                .toLocaleLowerCase()
                .includes(query.trim().toLocaleLowerCase()),
          ),
        (item) => item.label,
      ),
    [mode, query, sourceObjectId, sourcePoint.connection_point_ref.entity_id, topologyNodes],
  );
  const selectedObjectIsVisible =
    !targetObjectId || candidates.some((item) => item.id === targetObjectId);
  useEffect(() => {
    if (targetObjectId && !selectedObjectIsVisible) {
      setTargetObjectId("");
      setTargetEntityId("");
      setTargetState({ kind: "idle" });
    }
  }, [selectedObjectIsVisible, targetObjectId]);
  useEffect(() => {
    setTargetEntityId("");
    setTargetMember(undefined);
    if (!targetObjectId || !open) {
      setTargetState({ kind: "idle" });
      return undefined;
    }
    let current = true;
    setTargetState({ kind: "loading" });
    const request =
      mode === "PORT"
        ? physicalDetailsDataSource.loadPhysicalObjectDetails(targetObjectId)
        : deviceDetailsDataSource.loadDeviceDetails(targetObjectId);
    void request.then(
      (document) => {
        if (current)
          setTargetState(
            mode === "PORT"
              ? {
                  kind: "points",
                  document: document as PhysicalObjectDetailsDocument,
                }
              : {
                  kind: "interfaces",
                  document: document as DeviceDetailsDocument,
                },
          );
      },
      () => {
        if (current)
          setTargetState({
            kind: "error",
            message: t('physical.connectTargetLoadFailed'),
          });
      },
    );
    return () => {
      current = false;
    };
  }, [
    deviceDetailsDataSource,
    mode,
    open,
    physicalDetailsDataSource,
    retry,
    targetObjectId,
  ]);
  const points =
    targetState.kind === "points"
      ? sort(
          targetState.document.connection_points.filter((point) =>
            freePort(point, sourcePoint.connection_point_ref.entity_id),
          ),
          (point) => label(point, t("physical.point", { id: "" }).trim()),
        )
      : [];
  const interfaces =
    targetState.kind === "interfaces"
      ? sort(
          targetState.document.interfaces.filter(
            (item) => item.direct_physical_bindings.length === 0,
          ),
          (item) => item.label,
        )
      : [];
  const targetPoint = points.find(point => point.connection_point_ref.entity_id === targetEntityId);
  const sourceIndex = selectedPhysicalMember(sourcePoint, sourceMember);
  const targetIndex = targetPoint ? selectedPhysicalMember(targetPoint, targetMember) : undefined;
  const canSubmit = Boolean(targetEntityId && sourceIndex && (mode === "INTERFACE" || targetIndex));
  const targetName = candidates.find(item => item.id === targetObjectId)?.label;
  const summary = targetPoint && canSubmit && (sourcePoint.cardinality > 1 || targetPoint.cardinality > 1) ? (
    `${physicalMemberLabel(sourcePoint, sourcePoint.label, sourceIndex, true)} ↔ ${targetName} / ${physicalMemberLabel(targetPoint, targetPoint.label, targetIndex, true)}`
  ) : undefined;
  const submit = async () => {
    if (!canSubmit || !sourceIndex || busy || (cableNaming.generate_cable_label && !cableNaming.cable_label_template_id)) return;
    setBusy(true);
    setError(null);
    const target: PhysicalEndpointRequest =
      mode === "PORT"
        ? {
            kind: "CONNECTION_POINT",
            connection_point_id: targetEntityId,
            member_index: targetIndex!,
          }
        : { kind: "NETWORK_INTERFACE", network_interface_id: targetEntityId };
    try {
      const request: CreatePhysicalEndpointConnectionRequest = {
        source: {
          kind: "CONNECTION_POINT",
          connection_point_id: sourcePoint.connection_point_ref.entity_id,
          member_index: sourceIndex,
        },
        target,
        ...cableNaming,
        ...(fiberType && { fiber_type: fiberType }),
      };
      if (writeDataSource.previewPhysicalEndpointConnection) {
        const compatibility = await confirm(await writeDataSource.previewPhysicalEndpointConnection(request), summary);
        if (!compatibility) return;
        request.compatibility = compatibility;
      }
      setSubmitting(true);
      await writeDataSource.createPhysicalEndpointConnection(request);
      reset();
      onConnected();
    } catch (reason) {
      setError(reason instanceof PhysicalCompatibilityError ? reason.message : t('physical.connectFailed'));
    } finally {
      setSubmitting(false);
      setBusy(false);
    }
  };
  return (
    <div className="connect-interface connect-endpoint">
      <button
        type="button"
        className="connect-interface__trigger port-icon-action"
        aria-label={t("connect.connectPort")}
        title={t("connect.connectPort")}
        aria-expanded={open}
        disabled={
          busy || !isAvailablePhysicalPort(sourcePoint)
        }
        onClick={() => {
          if (open) reset();
          else {
            setOpen(true);
            setError(null);
          }
        }}
      >
        ↗
      </button>
      {open && (
        <form className="connect-interface__form" onSubmit={(event) => { event.preventDefault(); void submit(); }} noValidate>
          <strong>
            {mode === "PORT"
              ? t("connect.portCable")
              : t("connect.freeInterface")}
          </strong>
          {mode === "PORT" ? (
            <>
              <label>
                <span>{t("connect.searchObject")}</span>
                <input
                  aria-label={t("connect.searchTarget")}
                  value={query}
                  disabled={busy}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <label>
                <span>{t("connect.targetObject")}</span>
                <select
                  aria-label={t("connect.targetObject")}
                  value={targetObjectId}
                  disabled={busy}
                  onChange={(event) => setTargetObjectId(event.target.value)}
                >
                  <option value="">{t("connect.selectObject")}</option>
                  {candidates.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{t("connect.freePort")}</span>
                <select
                  aria-label={t("connect.freePort")}
                  value={targetEntityId}
                  disabled={busy || targetState.kind !== "points"}
                  onChange={(event) => { setTargetEntityId(event.target.value); setTargetMember(undefined); }}
                >
                  <option value="">{t("connect.selectPort")}</option>
                  {points.map((point) => (
                    <option
                      key={point.connection_point_ref.entity_id}
                      value={point.connection_point_ref.entity_id}
                    >
                      {label(point, t("physical.point", { id: "" }).trim())}
                    </option>
                  ))}
                </select>
              </label>
              {targetPoint && <PhysicalMemberSelect point={targetPoint} label={t("connect.targetMember")}
                value={targetMember} onChange={setTargetMember} disabled={busy} />}
              {targetState.kind === "points" && !points.length && (
                <p className="muted">{t("connect.noFreePoints")}</p>
              )}
              {sourcePoint.cardinality === 1 && <button
                type="button"
                className="connect-interface__advanced"
                disabled={busy}
                onClick={() => {
                  setQuery("");
                  setMode("INTERFACE");
                  setTargetObjectId("");
                }}
              >
                {t("connect.advanced")}
              </button>}
            </>
          ) : (
            <>
              <label>
                <span>{t("connect.targetObject")}</span>
                <select
                  aria-label={t("connect.targetObject")}
                  value={targetObjectId}
                  disabled={busy}
                  onChange={(event) => setTargetObjectId(event.target.value)}
                >
                  <option value="">{t("connect.selectObject")}</option>
                  {candidates.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{t("connect.interface")}</span>
                <select
                  aria-label={t("connect.interface")}
                  value={targetEntityId}
                  disabled={busy || targetState.kind !== "interfaces"}
                  onChange={(event) => setTargetEntityId(event.target.value)}
                >
                  <option value="">{t("connect.selectInterface")}</option>
                  {interfaces.map((item) => (
                    <option
                      key={item.interface_ref.entity_id}
                      value={item.interface_ref.entity_id}
                    >
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="connect-interface__advanced"
                disabled={busy}
                onClick={() => {
                  setQuery("");
                  setMode("PORT");
                  setTargetObjectId("");
                }}
              >
                {t("connect.backPorts")}
              </button>
            </>
          )}
          {targetState.kind === "loading" && (
            <p className="muted">{t("connect.loading")}</p>
          )}
          {targetState.kind === "error" && (
            <div className="connect-interface__target-error">
              <p>{targetState.message}</p>
              <button
                type="button"
                onClick={() => setRetry((value) => value + 1)}
              >
                {t("connect.retryLoad")}
              </button>
            </div>
          )}
          {error && (
            <p className="connect-interface__error" role="alert">
              {error}
            </p>
          )}
          <PhysicalMemberSelect point={sourcePoint} label={t("connect.sourceMember")}
            value={sourceMember} onChange={setSourceMember} disabled={busy} />
          {summary && <p>{summary}</p>}
          <label>{t('fiber.type')} <FiberTypeSelect value={fiberType} onChange={setFiberType} disabled={busy} /></label>
          <CableNamingFields dataSource={cableLabelDataSource} disabled={busy} value={cableNaming} onChange={setCableNaming} />
          <div className="connect-interface__actions">
            <button type="button" disabled={busy} onClick={reset}>
              {t("action.cancel")}
            </button>
            <button
              type="submit"
              disabled={
                !canSubmit || !selectedObjectIsVisible || busy || (cableNaming.generate_cable_label === true && !cableNaming.cable_label_template_id)
              }
            >
              {submitting ? t("connect.connecting") : busy ? t('compatibility.checking') : error ? t("action.retry") : t("connect.connect")}
            </button>
          </div>
        </form>
      )}
      {confirmationDialog}
    </div>
  );
}
