import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  BlueprintInstantiationDialog,
  type BlueprintInstantiationTarget,
} from "../components/BlueprintInstantiationDialog";
import { CreateNetworkDevice } from "../components/CreateNetworkDevice";
import { CreatePhysicalObject } from "../components/CreatePhysicalObject";
import type { DeviceWriteDataSource } from "../topology/deviceWriteTypes";
import type {
  ObjectBlueprintDataSource,
  ObjectBlueprintListDocument,
} from "../topology/objectBlueprintTypes";
import type { PhysicalObjectWriteDataSource } from "../topology/physicalObjectWriteTypes";
import { useI18n } from "../i18n";
import { Breadcrumbs, PageHeader, PageShell } from "../components/PageChrome";

interface NewInfrastructureObjectPageProps {
  deviceWriteDataSource?: DeviceWriteDataSource;
  physicalObjectWriteDataSource?: PhysicalObjectWriteDataSource;
  objectBlueprintDataSource?: ObjectBlueprintDataSource;
}

type CreationIntent = "device" | "physical";

export function NewInfrastructureObjectPage({
  deviceWriteDataSource,
  physicalObjectWriteDataSource,
  objectBlueprintDataSource,
}: NewInfrastructureObjectPageProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [intent, setIntent] = useState<CreationIntent>("device");
  const [blueprints, setBlueprints] =
    useState<ObjectBlueprintListDocument | null>(null);
  const [blueprintError, setBlueprintError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [target, setTarget] = useState<BlueprintInstantiationTarget | null>(
    null,
  );
  const [manualOpen, setManualOpen] = useState(false);

  useEffect(() => {
    if (!objectBlueprintDataSource) {
      setBlueprints(null);
      return;
    }
    let active = true;
    setBlueprints(null);
    setBlueprintError(null);
    void objectBlueprintDataSource.loadObjectBlueprints().then(
      (next) => {
        if (active) setBlueprints(next);
      },
      () => {
        if (active) setBlueprintError(t("create.blueprintsLoadFailed"));
      },
    );
    return () => {
      active = false;
    };
  }, [objectBlueprintDataSource, retryKey, t]);
  useEffect(() => {
    if (!blueprints || target || !params.get("blueprint")) return;
    const item = blueprints.blueprints.find(
      (blueprint) =>
        blueprint.blueprint_ref.entity_id === params.get("blueprint") &&
        blueprint.version_ref.entity_id === params.get("version"),
    );
    if (item)
      setTarget({
        id: item.blueprint_ref.entity_id,
        versionId: item.version_ref.entity_id,
        name: item.name,
        versionNumber: item.version_number,
      });
  }, [blueprints, params, target]);

  return (
    <PageShell className="catalog-page create-object-page">
      <Breadcrumbs
        label={t("object.breadcrumbs")}
        items={[
          { label: t("catalog.infrastructure") },
          { label: t("nav.objects"), to: "/infrastructure/objects" },
          { label: t("create.create") },
        ]}
      />
      <PageHeader
        eyebrow={t("catalog.infrastructure")}
        title={t("catalog.createObject")}
        description={t("create.physicalObject")}
      />
      <section
        className="creation-form-surface"
        aria-label={t("create.blueprints")}
      >
        {!objectBlueprintDataSource && (
          <p className="catalog-note catalog-note--gap">
            {t("create.blueprintsUnavailable")}
          </p>
        )}
        {objectBlueprintDataSource && !blueprints && !blueprintError && (
          <p>{t("create.blueprintsLoading")}</p>
        )}
        {blueprintError && (
          <p role="alert" className="catalog-note catalog-note--gap">
            {blueprintError}{" "}
            <button
              type="button"
              onClick={() => setRetryKey((value) => value + 1)}
            >
              {t("action.retry")}
            </button>
          </p>
        )}
        {blueprints?.blueprints.length === 0 && (
          <div className="catalog-note">
            <h2>{t("create.blueprintsEmptyTitle")}</h2>
            <p>{t("create.blueprintsEmptyBody")}</p>
            <Link
              className="primary-action"
              to="/library/object-blueprints/new"
            >
              {t("create.blueprintsCreateFirst")}
            </Link>
          </div>
        )}
        {blueprints && blueprints.blueprints.length > 0 && (
          <div className="create-blueprint-table-wrap">
            <table className="create-blueprint-table">
              <thead>
                <tr>
                  <th scope="col">{t("blueprint.library.name")}</th>
                  <th scope="col">{t("blueprint.library.objectType")}</th>
                  <th scope="col">{t("blueprint.library.version")}</th>
                  <th scope="col">{t("physical.ports")}</th>
                  <th scope="col">{t("blueprint.library.internalLinks")}</th>
                  <th scope="col">{t("blueprint.library.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {blueprints.blueprints.map((blueprint) => (
                  <tr key={blueprint.blueprint_ref.entity_id}>
                    <th scope="row">{blueprint.name}</th>
                    <td>
                      {blueprint.default_physical_object_class ??
                        t("blueprint.library.notSpecified")}
                    </td>
                    <td className="create-blueprint-table__numeric">
                      v{blueprint.version_number}
                    </td>
                    <td className="create-blueprint-table__numeric">
                      {blueprint.slot_count}
                    </td>
                    <td className="create-blueprint-table__numeric">
                      {blueprint.internal_link_count}
                    </td>
                    <td className="create-blueprint-table__actions">
                      <button
                        type="button"
                        className="primary-action"
                        onClick={() =>
                          setTarget({
                            id: blueprint.blueprint_ref.entity_id,
                            versionId: blueprint.version_ref.entity_id,
                            name: blueprint.name,
                            versionNumber: blueprint.version_number,
                          })
                        }
                      >
                        {t("create.blueprintSelect")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section
        className="creation-form-surface"
        aria-label={t("create.manual")}
      >
        {!manualOpen && (
          <button
            type="button"
            className="secondary-action"
            onClick={() => setManualOpen(true)}
          >
            {t("create.manual")}
          </button>
        )}
        {manualOpen && (
          <>
            <h2>{t("create.manual")}</h2>
            <p className="catalog-note">{t("create.manualHint")}</p>
            <section
              className="creation-intents"
              aria-label={t("create.manualType")}
            >
              <button
                type="button"
                aria-pressed={intent === "device"}
                onClick={() => setIntent("device")}
              >
                <strong>{t("create.networkDevice")}</strong>
                <span>{t("create.deviceIntent")}</span>
              </button>
              <button
                type="button"
                aria-pressed={intent === "physical"}
                onClick={() => setIntent("physical")}
              >
                <strong>{t("create.physicalObject")}</strong>
                <span>{t("create.physicalIntent")}</span>
              </button>
            </section>
            {intent === "device" && deviceWriteDataSource && (
              <CreateNetworkDevice
                variant="page"
                dataSource={deviceWriteDataSource}
                onCreated={(document) =>
                  navigate(
                    `/infrastructure/objects/${encodeURIComponent(document.device.source_ref.entity_id)}`,
                  )
                }
              />
            )}
            {intent === "physical" && physicalObjectWriteDataSource && (
              <CreatePhysicalObject
                variant="page"
                dataSource={physicalObjectWriteDataSource}
                onCreated={(document) =>
                  navigate(
                    `/infrastructure/objects/${encodeURIComponent(document.physical_object.source_ref.entity_id)}`,
                  )
                }
              />
            )}
            {((intent === "device" && !deviceWriteDataSource) ||
              (intent === "physical" && !physicalObjectWriteDataSource)) && (
              <p className="catalog-note catalog-note--gap">
                {t("create.datasourceUnavailable")}
              </p>
            )}
          </>
        )}
      </section>
      {target && objectBlueprintDataSource && (
        <BlueprintInstantiationDialog
          dataSource={objectBlueprintDataSource}
          target={target}
          onClose={() => setTarget(null)}
        />
      )}
    </PageShell>
  );
}
