import type { BlueprintUpgradeAnalysisDocument, BlueprintUpgradeDataSource } from './blueprintUpgradeTypes';
const endpoint = '/api/v1/topology/physical-objects';
export class ApiBlueprintUpgradeDataSource implements BlueprintUpgradeDataSource {
  async analyzeBlueprintUpgrade(physicalObjectId: string): Promise<BlueprintUpgradeAnalysisDocument> {
    const response = await fetch(`${endpoint}/${encodeURIComponent(physicalObjectId)}/blueprint-upgrade-analysis`);
    const body: unknown = await response.json();
    if (!response.ok) throw new Error(`Blueprint upgrade analysis request failed with status ${response.status}.`);
    return body as BlueprintUpgradeAnalysisDocument;
  }
}
