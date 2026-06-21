import { describe, expect, it } from 'vitest';
import { combinationCounts, combinationLabel, iterateCombinations, theoreticalCount, validateProject } from './combinations';
import { outputFileName, sanitizeSegment, type Part, type PartGroup, type StandeeProject } from './model';

function part(id: string, groupId: string, name = id): Part {
  return {
    id, groupId, name, originalName: `${name}.png`, width: 100, height: 200,
    hash: id, enabled: true, hasTransparency: true, image: new Blob(),
  };
}

function group(id: string, required: boolean, partIds: string[]): PartGroup {
  return {
    id, name: id, category: 'other', required, enabled: true,
    parts: partIds.map((partId) => part(partId, id)),
  };
}

function fixture(groups: PartGroup[]): StandeeProject {
  return {
    version: 1, id: 'p', name: 'test', character: 'sayo', width: 100, height: 200,
    groups, exclusions: [], output: { relativePath: 'Character', digits: 4 },
    createdAt: '2026-01-01', updatedAt: '2026-01-01',
  };
}

describe('combination enumeration', () => {
  it('uses group and part order deterministically', () => {
    const project = fixture([group('body', true, ['b1', 'b2']), group('face', true, ['f1', 'f2'])]);
    expect([...iterateCombinations(project)].map((item) => item.id)).toEqual([
      'b1__f1', 'b1__f2', 'b2__f1', 'b2__f2',
    ]);
  });

  it('adds none as the first option for optional groups', () => {
    const project = fixture([group('body', true, ['b1']), group('decoration', false, ['d1', 'd2'])]);
    const combinations = [...iterateCombinations(project)];
    expect(theoreticalCount(project)).toBe(3);
    expect(combinations.map((item) => item.id)).toEqual(['b1__none', 'b1__d1', 'b1__d2']);
    expect(combinationLabel(project, combinations[0])).toBe('b1');
  });

  it('removes matching exclusion pairs from counts and iteration', () => {
    const project = fixture([group('body', true, ['b1', 'b2']), group('clothes', true, ['c1', 'c2'])]);
    project.exclusions.push({ id: 'rule', partA: 'b2', partB: 'c1' });
    expect(combinationCounts(project)).toEqual({ theoretical: 4, excluded: 1, final: 3 });
    expect([...iterateCombinations(project)].map((item) => item.id)).not.toContain('b2__c1');
  });

  it('reports an empty required group as an export error', () => {
    const project = fixture([group('body', true, [])]);
    expect(validateProject(project).errors).toContain('必須グループ「body」に有効なパーツがありません。');
  });

  it('reports zero theoretical combinations when every group is disabled', () => {
    const project = fixture([group('body', true, ['b1'])]);
    project.groups[0].enabled = false;
    expect(combinationCounts(project)).toEqual({ theoretical: 0, excluded: 0, final: 0 });
  });
});

describe('output names', () => {
  it('sanitizes unsafe path characters and pads the index', () => {
    const project = fixture([]); project.character = 'sa/yo:*';
    expect(sanitizeSegment(project.character)).toBe('sa_yo__');
    expect(outputFileName(project, 7)).toBe('sa_yo___0007.png');
  });
});
