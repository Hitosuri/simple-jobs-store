import { describe, expect, it } from 'vitest';
import { typeColorIndex, typeColorVar } from './type-color';

describe('typeColorIndex', () => {
  it('is stable', () => {
    expect(typeColorIndex('render.video')).toBe(typeColorIndex('render.video'));
  });

  it('spreads 20 names over all 4 indexes', () => {
    const names = Array.from({ length: 20 }, (_, i) => `job.type-${i}`);
    expect(new Set(names.map(typeColorIndex))).toEqual(new Set([0, 1, 2, 3]));
  });

  it('matches the FNV-1a reference', () => {
    expect(typeColorIndex('a')).toBe(0xe40c292c % 4);
  });
});

describe('typeColorVar', () => {
  it('maps the index to a css var', () => {
    expect(typeColorVar('a')).toBe(`var(--type-${(0xe40c292c % 4) + 1})`);
  });
});
