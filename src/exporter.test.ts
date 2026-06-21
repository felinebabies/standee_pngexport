import { strFromU8, unzipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Part, StandeeProject } from './model';

const renderPng = vi.fn(async () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }));

vi.mock('./image', () => ({ renderPng }));
vi.mock('./project-file', () => ({ serializeProject: vi.fn(async (project: StandeeProject) => ({ ...project, groups: [] })) }));

const { exportProjectZip } = await import('./exporter');

function fixture(): StandeeProject {
  const makePart = (id: string): Part => ({
    id, groupId: 'body', name: id.toUpperCase(), originalName: `${id}.png`, width: 100, height: 200,
    hash: id, enabled: true, hasTransparency: true, image: new Blob(),
  });
  return {
    version: 1, id: 'project', name: 'Export test', character: 'sayo', width: 100, height: 200,
    groups: [{ id: 'body', name: '素体', category: 'body', required: true, enabled: true, parts: [makePart('base1'), makePart('base2')] }],
    exclusions: [], output: { relativePath: 'Character', digits: 4 },
    createdAt: '2026-01-01', updatedAt: '2026-01-01',
  };
}

describe('ZIP export', () => {
  beforeEach(() => renderPng.mockClear());

  it('contains deterministic PNG names, mapping files, and project definition', async () => {
    const progress = vi.fn();
    const blob = await exportProjectZip(fixture(), new AbortController().signal, progress);
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));

    expect(Object.keys(files).sort()).toEqual([
      'Character/sayo/sayo_0001.png',
      'Character/sayo/sayo_0002.png',
      'character_patterns.csv',
      'character_patterns.json',
      'project.standee.json',
    ]);
    expect(strFromU8(files['character_patterns.csv'])).toContain('BASE1,Character/sayo/sayo_0001,素体=BASE1');
    expect(JSON.parse(strFromU8(files['character_patterns.json']))).toHaveLength(2);
    expect(progress).toHaveBeenLastCalledWith({ completed: 2, total: 2, fileName: 'sayo_0002.png' });
  });

  it('does not finalize an archive after cancellation', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(exportProjectZip(fixture(), controller.signal, vi.fn())).rejects.toMatchObject({ name: 'AbortError' });
    expect(renderPng).not.toHaveBeenCalled();
  });
});
