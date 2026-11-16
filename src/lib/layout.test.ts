import { describe, expect, it } from 'vitest';
import { layoutNodes, NODE_WIDTH } from './layout';

const node = (id: string, height = 100) => ({ id, width: NODE_WIDTH, height });

describe('layout', () => {
  it('puts collections without references in a grid instead of one tall column', () => {
    const positions = layoutNodes(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => node(id)), []);
    const rows = new Set([...positions.values()].map((p) => p.y));
    const columns = new Set([...positions.values()].map((p) => p.x));
    expect(rows.size).toBe(2);
    expect(columns.size).toBe(3);
    expect(positions.get('a')).toEqual({ x: 20, y: 20 });
    expect(positions.get('b')!.x).toBeGreaterThan(positions.get('a')!.x);
  });

  it('lays out linked collections with dagre and the rest below them', () => {
    const positions = layoutNodes([node('a'), node('b'), node('alone')], [['a', 'b']]);
    // Referenced collections go to the left.
    expect(positions.get('a')!.x).toBeLessThan(positions.get('b')!.x);
    const linkedBottom = Math.max(positions.get('a')!.y, positions.get('b')!.y) + 100;
    expect(positions.get('alone')!.y).toBeGreaterThan(linkedBottom);
  });
});
