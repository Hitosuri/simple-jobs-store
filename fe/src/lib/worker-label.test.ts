import { describe, expect, it } from 'vitest';
import { workerLabels } from './worker-label';

const w = (id: string, name: string, ip: string) => ({ id, name, ip });

describe('workerLabels', () => {
  it('uses the bare name when it is unique', () => {
    expect(workerLabels([w('a', 'SKP converter', '10.0.0.1'), w('b', 'DXF processor', '10.0.0.1')])).toEqual(
      new Map([
        ['a', 'SKP converter'],
        ['b', 'DXF processor'],
      ]),
    );
  });

  it('adds the ip when same-named workers run on different machines', () => {
    const labels = workerLabels([w('a', 'SKP converter', '10.0.0.1'), w('b', 'SKP converter', '10.0.0.2')]);
    expect(labels.get('a')).toBe('SKP converter · 10.0.0.1');
    expect(labels.get('b')).toBe('SKP converter · 10.0.0.2');
  });

  it('adds a short id when same-named workers share a machine', () => {
    const labels = workerLabels([
      w('245de249-2740-47a8', 'SKP converter', '10.0.0.1'),
      w('60d55656-7e71-464b', 'SKP converter', '10.0.0.1'),
    ]);
    expect(labels.get('245de249-2740-47a8')).toBe('SKP converter · 245de249');
    expect(labels.get('60d55656-7e71-464b')).toBe('SKP converter · 60d55656');
  });

  it('lengthens the id until it tells hostname-pid ids apart', () => {
    const labels = workerLabels([
      w('render-host-1201', 'render', '10.0.0.1'),
      w('render-host-1388', 'render', '10.0.0.1'),
    ]);
    expect(labels.get('render-host-1201')).toBe('render · render-host-12');
    expect(labels.get('render-host-1388')).toBe('render · render-host-13');
  });
});
