import { describe, expect, it } from 'vitest';
import { typeColorIndex, typeColorVar } from './type-color';

describe('typeColorIndex', () => {
  it('is stable', () => {
    expect(typeColorIndex('render.video')).toBe(typeColorIndex('render.video'));
  });

  it('spreads 40 names over all 8 indexes', () => {
    const names = Array.from({ length: 40 }, (_, i) => `job.type-${i}`);
    expect(new Set(names.map(typeColorIndex))).toEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7]));
  });

  it('matches the FNV-1a reference', () => {
    expect(typeColorIndex('a')).toBe(0xe40c292c % 8);
  });

  it('keeps the current worker types apart', () => {
    const types = ['DXF_TO_DXFB', 'LAS_TO_COPC', 'TILESET_OPTIMIZE'];
    expect(new Set(types.map(typeColorIndex)).size).toBe(types.length);
  });
});

describe('typeColorVar', () => {
  it('maps the index to a css var', () => {
    expect(typeColorVar('a')).toBe(`var(--type-${(0xe40c292c % 8) + 1})`);
  });
});
