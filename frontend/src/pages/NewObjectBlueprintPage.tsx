import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createBlueprintRequest } from "../blueprints/editorModel";
import {
  newBlueprintEditorState,
  ObjectBlueprintEditor,
} from "./ObjectBlueprintEditor";
import type { ObjectBlueprintDataSource } from "../topology/objectBlueprintTypes";
import type { PortBlockDataSource } from "../topology/portBlockTypes";
import { useI18n } from "../i18n";
import { ViewState } from "../components/ViewState";
import { Breadcrumbs, PageHeader, PageShell } from "../components/PageChrome";

const objectBlueprintCreationPath = "/library/object-blueprints/new";

export function NewObjectBlueprintPage({
  dataSource,
  portBlockDataSource,
}: {
  dataSource: ObjectBlueprintDataSource;
  portBlockDataSource: PortBlockDataSource;
}) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [portBlocks, setPortBlocks] = useState<
    Awaited<ReturnType<PortBlockDataSource["loadPortBlocks"]>>["port_blocks"] | null
  >(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void portBlockDataSource.loadPortBlocks().then(
      (data) => {
        if (active) setPortBlocks(data.port_blocks);
      },
      (reason) => {
        if (active)
          setLoadError(
            reason instanceof Error
              ? reason.message
              : t("portBlock.library.loadFailed"),
          );
      },
    );
    return () => {
      active = false;
    };
  }, [portBlockDataSource, t]);
  const breadcrumbs = (
    <Breadcrumbs
      label={t("blueprint.breadcrumbs")}
      items={[
        { label: t("blueprint.library.section") },
        {
          label: t("blueprint.breadcrumb.library"),
          to: "/library/object-blueprints",
        },
        { label: t("blueprint.breadcrumb.new") },
      ]}
    />
  );
  const header = (
    <PageHeader
      title={t("blueprint.new.title")}
      description={t("blueprint.new.description")}
    />
  );
  return (
    <PageShell className="catalog-page blueprint-editor-page">
      {breadcrumbs}
      {loadError ? (
        <>
          {header}
          <ViewState kind="error" message={loadError} />
        </>
      ) : portBlocks === null ? (
        <>
          {header}
          <ViewState kind="loading" />
        </>
      ) : portBlocks.length === 0 ? (
        <>
          {header}
          <section className="view-state view-state--empty" role="status">
            <div className="view-state__signal">○</div>
            <h2>{t("blueprint.new.portBlocksRequired.title")}</h2>
            <p>{t("blueprint.new.portBlocksRequired.description")}</p>
            <Link className="primary-action" to="/library/port-blocks/new" state={{ returnTo: objectBlueprintCreationPath }}>
              {t("blueprint.new.portBlocksRequired.action")}
            </Link>
          </section>
        </>
      ) : (
      <ObjectBlueprintEditor
        portBlockDataSource={portBlockDataSource}
        initialPortBlocks={portBlocks}
        initialState={newBlueprintEditorState()}
        title={t("blueprint.new.title")}
        description={t("blueprint.new.description")}
        saveLabel={t("blueprint.new.save")}
        onSave={async (editor) => {
          const result = createBlueprintRequest(editor);
          if (!result.request) throw new Error(result.errors.join(" "));
          await dataSource.createObjectBlueprint(result.request);
          navigate("/library/object-blueprints");
        }}
      />
      )}
    </PageShell>
  );
}
