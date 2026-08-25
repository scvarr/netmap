import type { LibraryRef } from './objectBlueprintTypes';

export type BlueprintUpgradeStatus = 'NOT_APPLICABLE' | 'UP_TO_DATE' | 'OUTDATED' | 'MODEL_INCONSISTENT';
export interface BlueprintUpgradeChange { code: string; slot_key?: string; slot_keys?: string[]; kind?: string; current_kind?: string; target_kind?: string; details?: string; }
export interface BlueprintUpgradeAnalysisDocument {
  schema_version: '1.0'; status: BlueprintUpgradeStatus;
  blueprint_ref?: LibraryRef; current_version_ref?: LibraryRef; current_version_number?: number;
  target_version_ref?: LibraryRef; target_version_number?: number;
  compatible_changes: BlueprintUpgradeChange[]; blockers: BlueprintUpgradeChange[];
}
export interface BlueprintUpgradeDataSource { analyzeBlueprintUpgrade(physicalObjectId: string): Promise<BlueprintUpgradeAnalysisDocument>; }
