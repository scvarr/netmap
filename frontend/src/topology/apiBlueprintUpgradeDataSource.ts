import type { BlueprintUpgradeAnalysisDocument, BlueprintUpgradeDataSource } from './blueprintUpgradeTypes';
const endpoint = '/api/v1/topology/physical-objects';
export class ApiBlueprintUpgradeDataSource implements BlueprintUpgradeDataSource {
  async analyzeBlueprintUpgrade(physicalObjectId: string): Promise<BlueprintUpgradeAnalysisDocument> {
    const response = await fetch(`${endpoint}/${encodeURIComponent(physicalObjectId)}/blueprint-upgrade-analysis`);
    const body: unknown = await response.json();
    if (!response.ok) throw new Error(`Blueprint upgrade analysis request failed with status ${response.status}.`);
    return body as BlueprintUpgradeAnalysisDocument;
  }
  async applyBlueprintUpgrade(physicalObjectId: string, targetVersionId: string): Promise<unknown> {
    const response = await fetch(`${endpoint}/${encodeURIComponent(physicalObjectId)}/blueprint-upgrade`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target_version_id: targetVersionId }),
    });
    const body: unknown = await response.json();
    if (!response.ok) throw new Error(`Blueprint upgrade apply request failed with status ${response.status}.`);
    return body;
  }
}
