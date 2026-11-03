import { describe, expect, it } from 'vitest';
import { knownTypes, optionalColumns, parsePage, typeFilterLabel } from './list';

describe('knownTypes', () => {
  it('merges every source into one sorted list without duplicates', () => {
    expect(knownTypes(['B', 'A'], undefined, ['C', 'A'], [])).toEqual(['A', 'B', 'C']);
  });

  it('is empty when nothing is known yet', () => {
    expect(knownTypes(undefined, undefined)).toEqual([]);
  });
});

describe('typeFilterLabel', () => {
  it('names the selection', () => {
    expect(typeFilterLabel([])).toBe('All types');
    expect(typeFilterLabel(['TILESET_OPTIMIZE'])).toBe('TILESET_OPTIMIZE');
    expect(typeFilterLabel(['TILESET_OPTIMIZE', 'A', 'B'])).toBe('TILESET_OPTIMIZE +2');
  });
});

describe('parsePage', () => {
  it('accepts a page in range', () => {
    expect(parsePage('3', 6)).toBe(3);
    expect(parsePage(' 2 ', 6)).toBe(2);
  });

  it('clamps to the first and last page and rounds', () => {
    expect(parsePage('0', 6)).toBe(1);
    expect(parsePage('-4', 6)).toBe(1);
    expect(parsePage('99', 6)).toBe(6);
    expect(parsePage('2.6', 6)).toBe(3);
    expect(parsePage('5', 0)).toBe(1);
  });

  it('rejects text that is not a number', () => {
    expect(parsePage('', 6)).toBeNull();
    expect(parsePage('abc', 6)).toBeNull();
  });
});

describe('optionalColumns', () => {
  it('hides Status only under a single-status filter', () => {
    expect(optionalColumns([], undefined).status).toBe(true);
    expect(optionalColumns([], ['failed']).status).toBe(false);
    expect(optionalColumns([], ['failed', 'cancelled']).status).toBe(true);
  });

  it('shows Priority only when a job on the page has one', () => {
    expect(optionalColumns([{ priority: 0 }, { priority: 0 }], undefined).priority).toBe(false);
    expect(optionalColumns([{ priority: 0 }, { priority: -2 }], undefined).priority).toBe(true);
  });
});
