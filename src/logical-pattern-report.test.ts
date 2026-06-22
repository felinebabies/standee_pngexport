import { describe, expect, it } from 'vitest';
import type { Part, PartGroup, StandeeProject } from './model';
import { createLogicalPatternReport } from './logical-pattern-report';

function part(id: string, groupId: string, collapsedGroupIds: string[] = []): Part {
  return {
    id, groupId, name: id.toUpperCase(), originalName: `${id}.png`, width: 100, height: 200,
    hash: `hash-${id}`, enabled: true, hasTransparency: true, image: new Blob(['image-data']), collapsedGroupIds,
  };
}

function group(id: string, required: boolean, parts: Part[]): PartGroup {
  return { id, name: id.toUpperCase(), category: 'other', required, enabled: true, parts };
}

function fixture(): StandeeProject {
  const body = group('body', true, [part('b1', 'body'), part('b2', 'body')]);
  const clothes = group('clothes', false, [part('c1', 'clothes', ['body']), part('c2', 'clothes')]);
  return {
    version: 2, id: 'project', name: 'Report test', character: 'sayo', width: 100, height: 200,
    groups: [body, clothes], exclusions: [{ id: 'rule', partA: 'b2', partB: 'c2' }],
    output: { relativePath: 'Character', digits: 4 }, createdAt: '2026-01-01', updatedAt: '2026-01-02',
  };
}

describe('logical pattern report', () => {
  it('captures the compact logical configuration and calculated counts without image data', () => {
    const report = createLogicalPatternReport(fixture(), '2026-06-22T00:00:00.000Z');

    expect(report.summary).toEqual({
      theoretical: 6, excluded: 1, deduplicated: 1, final: 4,
      enabledGroupCount: 2, enabledPartCount: 4,
    });
    expect(report.theoreticalFormula.expression).toBe('2 x 3');
    expect(report.groups[1].parts[0].collapsedGroups).toEqual([{ id: 'body', name: 'BODY' }]);
    expect(report.exclusions[0].partA).toEqual({ id: 'b2', groupId: 'body', groupName: 'BODY', name: 'B2' });
    expect(JSON.stringify(report)).not.toContain('image-data');
    expect(JSON.stringify(report)).not.toContain('"image"');
  });

  it('includes disabled groups and parts so reduction candidates remain visible', () => {
    const project = fixture();
    project.groups[0].enabled = false;
    project.groups[1].parts[1].enabled = false;

    const report = createLogicalPatternReport(project);

    expect(report.groups[0].logicalChoiceCount).toBe(0);
    expect(report.groups[0].parts).toHaveLength(2);
    expect(report.groups[1].logicalChoiceCount).toBe(2);
    expect(report.summary.final).toBe(2);
  });
});
