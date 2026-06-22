import { combinationCounts, enabledGroups } from './combinations';
import type { Part, PartGroup, StandeeProject } from './model';

export const LOGICAL_PATTERN_REPORT_VERSION = 1;

interface PartReference {
  id: string;
  groupId: string | null;
  groupName: string | null;
  name: string | null;
}

function partReference(project: StandeeProject, partId: string): PartReference {
  for (const group of project.groups) {
    const part = group.parts.find((candidate) => candidate.id === partId);
    if (part) return { id: part.id, groupId: group.id, groupName: group.name, name: part.name };
  }
  return { id: partId, groupId: null, groupName: null, name: null };
}

function collapsedGroups(project: StandeeProject, part: Part) {
  return (part.collapsedGroupIds ?? []).map((groupId) => {
    const group = project.groups.find((candidate) => candidate.id === groupId);
    return { id: groupId, name: group?.name ?? null };
  });
}

function logicalChoiceCount(group: PartGroup): number {
  if (!group.enabled) return 0;
  return group.parts.filter((part) => part.enabled).length + (group.required ? 0 : 1);
}

export function createLogicalPatternReport(project: StandeeProject, generatedAt = new Date().toISOString()) {
  const counts = combinationCounts(project);
  const factors = enabledGroups(project).map((group, index) => ({
    order: index + 1,
    groupId: group.id,
    groupName: group.name,
    required: group.required,
    enabledPartCount: group.parts.filter((part) => part.enabled).length,
    includesNone: !group.required,
    choiceCount: logicalChoiceCount(group),
  }));

  return {
    kind: 'VQStandeeForgeLogicalPatternReport',
    reportVersion: LOGICAL_PATTERN_REPORT_VERSION,
    generatedAt,
    project: {
      id: project.id,
      name: project.name,
      character: project.character,
      formatVersion: project.version,
      canvas: { width: project.width, height: project.height },
      output: { ...project.output },
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    },
    summary: {
      ...counts,
      enabledGroupCount: factors.length,
      enabledPartCount: factors.reduce((total, factor) => total + factor.enabledPartCount, 0),
    },
    theoreticalFormula: {
      expression: factors.length ? factors.map((factor) => factor.choiceCount).join(' x ') : '0',
      factors,
    },
    groups: project.groups.map((group, groupIndex) => ({
      order: groupIndex + 1,
      id: group.id,
      name: group.name,
      category: group.category,
      enabled: group.enabled,
      required: group.required,
      logicalChoiceCount: logicalChoiceCount(group),
      parts: group.parts.map((part, partIndex) => ({
        order: partIndex + 1,
        id: part.id,
        name: part.name,
        originalName: part.originalName,
        enabled: part.enabled,
        contentHash: part.hash,
        collapsedGroups: collapsedGroups(project, part),
      })),
    })),
    exclusions: project.exclusions.map((rule, index) => ({
      order: index + 1,
      id: rule.id,
      partA: partReference(project, rule.partA),
      partB: partReference(project, rule.partB),
    })),
  };
}
