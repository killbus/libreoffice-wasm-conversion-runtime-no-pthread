import { describe, expect, it } from 'vitest';
import {
  ConversionErrorCode,
  FORMAT_FILTER_OPTIONS,
  resolveSingleResultFilterOptions,
} from '../src/types.js';

describe('CSV single-result filter option contract', () => {
  it('uses a canonical zero sheet token by default', () => {
    const resolved = resolveSingleResultFilterOptions('csv');

    expect(resolved).toBe(FORMAT_FILTER_OPTIONS.csv);
    expect(resolved?.split(',')[11]).toBe('0');
  });

  it.each([
    ['', ''],
    ['44,34,76,1,,0,false,true,false,false,false', '44,34,76,1,,0,false,true,false,false,false'],
    [
      '59,39,76,1,,1033,true,false,true,true,true,0,true,true,false',
      '59,39,76,1,,1033,true,false,true,true,true,0,true,true,false',
    ],
  ])('accepts and preserves singular CSV options %j', (input, expected) => {
    expect(resolveSingleResultFilterOptions('csv', input)).toBe(expected);
  });

  it.each(['-1', '1', '-2', '27', 'sheet', '00', '+0', '-0', '0.0'])(
    'rejects CSV sheet token %j with a deterministic input error',
    (sheetToken) => {
      const options = `44,34,76,1,,0,false,true,false,false,false,${sheetToken}`;

      expect(() => resolveSingleResultFilterOptions('csv', options)).toThrowError(
        expect.objectContaining({
          code: ConversionErrorCode.INVALID_INPUT,
          message: expect.stringContaining('token 11'),
        })
      );
    }
  );

  it('does not reinterpret filter options for other output formats', () => {
    expect(resolveSingleResultFilterOptions('txt', '-1')).toBe('-1');
    expect(resolveSingleResultFilterOptions('pdf')).toBeUndefined();
  });
});
