import { describe, expect, it } from 'vitest';
import { physicalClassPresentation } from './presentation';

describe('physicalClassPresentation', () => {
  it('maps known classes to text and distinct visual accents', () => {
    const values = ['workstation', 'switch', 'cable', 'outlet', 'patch_panel'] as const;
    const presentations = values.map(physicalClassPresentation);

    expect(presentations.map((item) => item.label)).toEqual([
      'ПК', 'КОММУТАТОР', 'КАБЕЛЬ', 'РОЗЕТКА', 'ПАТЧ-ПАНЕЛЬ',
    ]);
    expect(new Set(presentations.map((item) => item.accent)).size).toBe(values.length);
  });

  it('does not infer a known presentation for absent or arbitrary classes', () => {
    expect(physicalClassPresentation(undefined)).toEqual({
      label: 'ФИЗИЧЕСКИЙ ОБЪЕКТ', accent: 'unknown',
    });
    expect(physicalClassPresentation('switch-looking-name')).toEqual({
      label: 'ФИЗИЧЕСКИЙ ОБЪЕКТ', accent: 'unknown',
    });
  });
});
