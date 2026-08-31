export interface CableLabelSettings { unique_labels: boolean }
export interface CableLabelTemplate { id: string; name: string; description?: string | null; pattern: string; start_at: number }
export interface CableLabelTemplateListDocument { schema_version: '1.0'; templates: CableLabelTemplate[] }
export interface CableLabelTemplateWrite { name: string; description?: string | null; pattern: string; start_at: number }
export interface CableNamingInput { cable_label?: string | null; cable_label_template_id?: string | null; generate_cable_label?: boolean }
export interface CableLabelDataSource {
  setCableLabel(cableId: string, label: string | null): Promise<void>;
  generateCableLabel(cableId: string, templateId: string): Promise<void>;
  loadCableLabelSettings(): Promise<CableLabelSettings>;
  setCableLabelSettings(settings: CableLabelSettings): Promise<CableLabelSettings>;
  loadCableLabelTemplates(): Promise<CableLabelTemplateListDocument>;
  createCableLabelTemplate(value: CableLabelTemplateWrite): Promise<CableLabelTemplate>;
  updateCableLabelTemplate(id: string, value: CableLabelTemplateWrite): Promise<CableLabelTemplate>;
  deleteCableLabelTemplate(id: string): Promise<void>;
}
