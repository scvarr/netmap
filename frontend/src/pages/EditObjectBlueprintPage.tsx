import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  createBlueprintRequest,
  hydrateBlueprintEditorState,
} from "../blueprints/editorModel";
import { ObjectBlueprintEditor } from "./ObjectBlueprintEditor";
import { ViewState } from "../components/ViewState";
import { useI18n } from "../i18n";
import { Breadcrumbs, PageShell } from "../components/PageChrome";
import type {
  ObjectBlueprintDataSource,
  ObjectBlueprintVersionDocument,
} from "../topology/objectBlueprintTypes";

export function EditObjectBlueprintPage({
  dataSource,
}: {
  dataSource: ObjectBlueprintDataSource;
}) {
  const { blueprintId, versionId } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [version, setVersion] = useState<ObjectBlueprintVersionDocument | null>(
    null,
  );
  const [initial, setInitial] = useState<
    Awaited<ReturnType<typeof hydrateBlueprintEditorState>> | undefined
  >(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        if (!blueprintId || !versionId)
          throw new Error(t("blueprint.edit.invalidAddress"));
        const document = await dataSource.loadObjectBlueprintVersion(
          blueprintId,
          versionId,
        );
        const hydrated = hydrateBlueprintEditorState(document);
        if (active) {
          setVersion(document);
          setInitial(hydrated);
        }
      } catch (reason) {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : t("blueprint.edit.loadFailed"),
          );
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [blueprintId, versionId, dataSource, t]);
  const breadcrumbs = (
    <Breadcrumbs
      label={t("blueprint.breadcrumbs")}
      items={[
        { label: t("blueprint.library.section") },
        {
          label: t("blueprint.breadcrumb.library"),
          to: "/library/object-blueprints",
        },
        { label: t("blueprint.breadcrumb.edit") },
      ]}
    />
  );
  if (error)
    return (
      <PageShell className="catalog-page blueprint-editor-page">
        {breadcrumbs}
        <ViewState kind="error" message={error} />
      </PageShell>
    );
  if (!version)
    return (
      <PageShell className="catalog-page blueprint-editor-page">
        {breadcrumbs}
        <ViewState kind="loading" />
      </PageShell>
    );
  if (initial === undefined)
    return (
      <PageShell className="catalog-page blueprint-editor-page">
        {breadcrumbs}
        <ViewState kind="loading" />
      </PageShell>
    );
  return (
    <PageShell className="catalog-page blueprint-editor-page">
      {breadcrumbs}
      <ObjectBlueprintEditor
        key={version.version_ref.entity_id}
        initialState={initial}
        title={t("blueprint.edit.title")}
        description={t("blueprint.edit.description")}
        versionNotice={t("blueprint.edit.notice", {
          version: version.version_number,
          nextVersion: version.version_number + 1,
        })}
        saveLabel={t("blueprint.edit.save", {
          version: version.version_number + 1,
        })}
        onSave={async (editor) => {
          const result = createBlueprintRequest(editor);
          if (!result.request) throw new Error(result.errors.join(" "));
          const { name, ...snapshot } = result.request;
          if (!dataSource.createObjectBlueprintVersion)
            throw new Error(t("blueprint.edit.versionUnsupported"));
          await dataSource.createObjectBlueprintVersion(
            version.blueprint_ref.entity_id,
            { ...snapshot, blueprint_name: name },
          );
          navigate("/library/object-blueprints");
        }}
      />
    </PageShell>
  );
}
