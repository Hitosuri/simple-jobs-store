import { describe, expect, it } from 'vitest';
import { knownTypes, optionalColumns, pageItems, typeFilterLabel } from './list';

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

describe('pageItems', () => {
  it('lists every page up to 7', () => {
    expect(pageItems(1, 1)).toEqual([1]);
    expect(pageItems(2, 3)).toEqual([1, 2, 3]);
    expect(pageItems(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(pageItems(1, 0)).toEqual([1]);
  });

  it('keeps 7 slots near the start, the end and the middle', () => {
    expect(pageItems(1, 20)).toEqual([1, 2, 3, 4, 5, 'gap', 20]);
    expect(pageItems(4, 20)).toEqual([1, 2, 3, 4, 5, 'gap', 20]);
    expect(pageItems(5, 20)).toEqual([1, 'gap', 4, 5, 6, 'gap', 20]);
    expect(pageItems(17, 20)).toEqual([1, 'gap', 16, 17, 18, 19, 20]);
    expect(pageItems(20, 20)).toEqual([1, 'gap', 16, 17, 18, 19, 20]);
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
