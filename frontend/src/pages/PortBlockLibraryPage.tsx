import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ViewState } from "../components/ViewState";
import { useI18n } from "../i18n";
import { PortBlockDeletionConflictError } from "../topology/apiPortBlockDataSource";
import { Breadcrumbs, PageHeader, PageShell } from "../components/PageChrome";
import type {
  PortBlockDataSource,
  PortBlockListDocument,
} from "../topology/portBlockTypes";

export function PortBlockLibraryPage({
  dataSource,
}: {
  dataSource: PortBlockDataSource;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [document, setDocument] = useState<PortBlockListDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = () => {
    setError(null);
    return dataSource
      .loadPortBlocks()
      .then(setDocument, (reason) =>
        setError(
          reason instanceof Error
            ? reason.message
            : t("portBlock.library.loadFailed"),
        ),
      );
  };
  const remove = async (id: string, name: string) => {
    if (!window.confirm(t("portBlock.library.deleteConfirm", { name }))) return;
    setActionError(null);
    try {
      if (!dataSource.deletePortBlock)
        throw new Error("PortBlock deletion is not supported.");
      await dataSource.deletePortBlock(id);
      await refresh();
    } catch (reason) {
      setActionError(
        reason instanceof PortBlockDeletionConflictError
          ? t("portBlock.library.deleteInUse")
          : t("portBlock.library.deleteFailed"),
      );
    }
  };

  useEffect(() => {
    void refresh();
  }, [dataSource]);

  return (
    <PageShell className="catalog-page">
      <Breadcrumbs label={t("portBlock.breadcrumb.library")} items={[{ label: t("portBlock.library.section") }, { label: t("portBlock.library.title") }]} />
      <PageHeader
        eyebrow={t("portBlock.library.section")}
        title={t("portBlock.library.title")}
        description={t("portBlock.library.description")}
        actions={
          <button
            className="primary-action"
            type="button"
            onClick={() => navigate("/library/port-blocks/new")}
          >
            {t("portBlock.library.create")}
          </button>
        }
      />
      <div className="port-block-library__content">
        {actionError && (
          <p role="alert" className="blueprint-editor__error">
            {actionError}
          </p>
        )}
        {error ? (
          <ViewState kind="error" message={error} />
        ) : !document ? (
          <ViewState kind="loading" />
        ) : document.port_blocks.length === 0 ? (
          <ViewState kind="empty" message={t("portBlock.library.empty")} />
        ) : (
          <div className="port-block-library-table-wrap">
            <table className="port-block-library-table">
              <thead>
                <tr>
                  <th scope="col">{t("portBlock.library.name")}</th>
                  <th scope="col">{t("portBlock.library.currentVersion")}</th>
                  <th scope="col">{t("portBlock.library.versions")}</th>
                  <th scope="col">{t("portBlock.library.connectionPoints")}</th>
                  <th scope="col">{t("portBlock.library.networkPorts")}</th>
                  <th scope="col">{t("portBlock.library.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {document.port_blocks.map((item) => (
                  <tr key={item.port_block_ref.entity_id}>
                    <th scope="row">{item.name}</th>
                    <td className="port-block-library-table__numeric">
                      v{item.version_number}
                    </td>
                    <td className="port-block-library-table__numeric">
                      {item.version_count}
                    </td>
                    <td className="port-block-library-table__numeric">
                      {item.connection_point_count}
                    </td>
                    <td className="port-block-library-table__numeric">
                      {item.network_port_count}
                    </td>
                    <td>
                      <div className="port-block-library-table__actions">
                        <Link
                          className="blueprint-icon-action"
                          to={`/library/port-blocks/${item.port_block_ref.entity_id}/versions/${item.version_ref.entity_id}/edit`}
                        >
                          {t("portBlock.library.newVersion")}
                        </Link>
                        <button
                          type="button"
                          className="blueprint-icon-action blueprint-icon-action--danger"
                          aria-label={t("portBlock.library.delete")}
                          title={t("portBlock.library.delete")}
                          onClick={() =>
                            void remove(
                              item.port_block_ref.entity_id,
                              item.name,
                            )
                          }
                        >
                          ×
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageShell>
  );
}
