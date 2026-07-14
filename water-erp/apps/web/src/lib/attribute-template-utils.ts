import type { AttributeTemplate } from '@/lib/api/catalog-admin';

export interface DynamicField {
  templateId: number;
  name: string;
  fieldKey: string;
  fieldType: string;
  required: boolean;
  options: string[] | null;
  unit: string | null;
  value: string;
}

export function buildDynamicFields(templates: AttributeTemplate[]): DynamicField[] {
  return templates.map(t => ({
    templateId: t.id, name: t.name, fieldKey: t.fieldKey,
    fieldType: t.fieldType, required: t.required,
    options: t.options, unit: t.unit, value: '',
  }));
}

export function extractAttributeValues(fields: DynamicField[]): { templateId: number; value: string }[] {
  return fields.filter(f => f.value !== '').map(f => ({ templateId: f.templateId, value: f.value }));
}
