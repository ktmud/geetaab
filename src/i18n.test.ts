import { describe, expect, it } from 'vitest';
import { dictionary } from './i18n';

describe('i18n dictionary', () => {
  it('has the same keys for en and zh', () => {
    const enKeys = Object.keys(dictionary.en).sort();
    const zhKeys = Object.keys(dictionary.zh).sort();
    expect(zhKeys).toEqual(enKeys);
  });

  it('has no empty string values', () => {
    const checkValues = (obj: any, path: string = ''): string[] => {
      const errors: string[] = [];
      for (const key in obj) {
        const fullPath = path ? `${path}.${key}` : key;
        const value = obj[key];
        if (typeof value === 'string') {
          if (value.trim() === '') {
            errors.push(`Empty string at ${fullPath}`);
          }
        } else if (typeof value === 'function') {
          // Test the function with dummy arguments
          try {
            const result = value(1, 'test');
            if (typeof result === 'string' && result.trim() === '') {
              errors.push(`Function at ${fullPath} returned empty string`);
            }
          } catch {
            // Some functions might not work with dummy args, but we can't test all
          }
        } else if (Array.isArray(value)) {
          value.forEach((item, idx) => {
            if (typeof item === 'string' && item.trim() === '') {
              errors.push(`Empty string in array at ${fullPath}[${idx}]`);
            } else if (typeof item === 'function') {
              try {
                const result = item(1, 2, 3);
                if (typeof result === 'string' && result.trim() === '') {
                  errors.push(`Function in array at ${fullPath}[${idx}] returned empty string`);
                }
              } catch {
                // Some functions might not work with dummy args
              }
            }
          });
        } else if (typeof value === 'object' && value !== null) {
          errors.push(...checkValues(value, fullPath));
        }
      }
      return errors;
    };

    const enErrors = checkValues(dictionary.en);
    const zhErrors = checkValues(dictionary.zh);

    expect(enErrors).toEqual([]);
    expect(zhErrors).toEqual([]);
  });
});
