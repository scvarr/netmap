import { Link, useNavigate } from "react-router-dom";
import { createBlueprintRequest } from "../blueprints/editorModel";
import {
  newBlueprintEditorState,
  ObjectBlueprintEditor,
} from "./ObjectBlueprintEditor";
import type { ObjectBlueprintDataSource } from "../topology/objectBlueprintTypes";
import type { PortBlockDataSource } from "../topology/portBlockTypes";
import { useI18n } from "../i18n";
import { Breadcrumbs, PageShell } from "../components/PageChrome";

export function NewObjectBlueprintPage({
  dataSource,
  portBlockDataSource,
}: {
  dataSource: ObjectBlueprintDataSource;
  portBlockDataSource: PortBlockDataSource;
}) {
  const navigate = useNavigate();
  const { t } = useI18n();
  return (
    <PageShell className="catalog-page blueprint-editor-page">
      <Breadcrumbs
        label={t("blueprint.breadcrumbs")}
        items={[
          {
            label: t("blueprint.breadcrumb.library"),
            to: "/library/object-blueprints",
          },
          { label: t("blueprint.breadcrumb.new") },
        ]}
      />
      <ObjectBlueprintEditor
        portBlockDataSource={portBlockDataSource}
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
    </PageShell>
  );
}
