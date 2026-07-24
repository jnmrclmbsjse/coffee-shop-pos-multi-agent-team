import { describe, expect, it } from 'vitest';
import {
  formatCentsAsPesosInput,
  formatPeso,
  parsePesosToCents,
} from './money';

describe('catalog money boundary', () => {
  it.each([
    ['0', 0],
    ['0.00', 0],
    ['145', 14500],
    ['145.5', 14550],
    ['145.50', 14550],
    [' 99.09 ', 9909],
  ])('parses %s pesos into integer cents', (input, expected) => {
    expect(parsePesosToCents(input)).toBe(expected);
  });

  it.each(['', '-1', '1.999', '1,000.00', 'not money'])(
    'rejects invalid peso input %s',
    (input) => {
      expect(parsePesosToCents(input)).toBeNull();
    },
  );

  it('formats integer cents for editing and display', () => {
    expect(formatCentsAsPesosInput(14505)).toBe('145.05');
    expect(formatPeso(14505)).toContain('145.05');
  });
});
