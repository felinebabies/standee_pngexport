import type { Combination, StandeeProject } from './model';

export function enabledGroups(project: StandeeProject) {
  return project.groups.filter((group) => group.enabled);
}

export function theoreticalCount(project: StandeeProject): number {
  const groups = enabledGroups(project);
  if (groups.length === 0) return 0;
  return groups.reduce((total, group) => {
    const count = group.parts.filter((part) => part.enabled).length + (group.required ? 0 : 1);
    return total * count;
  }, 1);
}

export function isExcluded(project: StandeeProject, selections: Record<string, string | null>): boolean {
  const selected = new Set(Object.values(selections).filter((id): id is string => id !== null));
  return project.exclusions.some((rule) => selected.has(rule.partA) && selected.has(rule.partB));
}

export function* iterateCombinations(project: StandeeProject): Generator<Combination> {
  const groups = enabledGroups(project);
  if (groups.length === 0) return;
  const choices = groups.map((group) => {
    const ids: Array<string | null> = group.parts.filter((part) => part.enabled).map((part) => part.id);
    if (!group.required) ids.unshift(null);
    return ids;
  });
  if (choices.some((items) => items.length === 0)) return;

  const selected: Record<string, string | null> = {};
  function* visit(depth: number): Generator<Combination> {
    if (depth === groups.length) {
      if (!isExcluded(project, selected)) {
        const values = groups.map((group) => selected[group.id] ?? 'none');
        yield { id: values.join('__'), selections: { ...selected } };
      }
      return;
    }
    const group = groups[depth];
    for (const partId of choices[depth]) {
      selected[group.id] = partId;
      yield* visit(depth + 1);
    }
  }
  yield* visit(0);
}

export function combinationCounts(project: StandeeProject) {
  const theoretical = theoreticalCount(project);
  let final = 0;
  for (const _combination of iterateCombinations(project)) final += 1;
  return { theoretical, excluded: theoretical - final, final };
}

export function combinationLabel(project: StandeeProject, combination: Combination): string {
  return enabledGroups(project).flatMap((group) => {
    const id = combination.selections[group.id];
    const part = group.parts.find((candidate) => candidate.id === id);
    return part ? [part.name] : [];
  }).join('_') || 'なし';
}

export function combinationParts(project: StandeeProject, combination: Combination): string {
  return enabledGroups(project).map((group) => {
    const id = combination.selections[group.id];
    const part = group.parts.find((candidate) => candidate.id === id);
    return `${group.name}=${part?.name ?? 'なし'}`;
  }).join('; ');
}

export function validateProject(project: StandeeProject): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const groups = enabledGroups(project);
  if (groups.length === 0) errors.push('有効なグループがありません。');
  for (const group of groups) {
    if (group.required && !group.parts.some((part) => part.enabled)) {
      errors.push(`必須グループ「${group.name}」に有効なパーツがありません。`);
    }
  }
  const allParts = groups.flatMap((group) => group.parts.filter((part) => part.enabled));
  if (allParts.some((part) => part.width !== project.width || part.height !== project.height)) {
    errors.push('キャンバス寸法と一致しないPNGがあります。');
  }
  for (const part of allParts.filter((candidate) => !candidate.hasTransparency)) {
    warnings.push(`「${part.originalName}」に透過ピクセルがありません。`);
  }
  const hashes = new Map<string, string>();
  for (const part of allParts) {
    if (hashes.has(part.hash)) warnings.push(`「${part.originalName}」は「${hashes.get(part.hash)}」と同一内容の可能性があります。`);
    else hashes.set(part.hash, part.originalName);
  }
  const categories = new Set<string>();
  for (const group of groups.filter((candidate) => candidate.category !== 'other')) {
    if (categories.has(group.category)) warnings.push(`標準カテゴリ「${group.name}」が重複しています。`);
    categories.add(group.category);
  }
  const counts = combinationCounts(project);
  if (counts.final === 0) errors.push('有効な組み合わせが0件です。');
  if (counts.final > 1000) warnings.push(`出力は${counts.final.toLocaleString()}件です。処理時間と容量に注意してください。`);
  if (project.width * project.height * counts.final > 2_000_000_000) warnings.push('展開時の推定画像容量が2GBを超えます。');
  for (const rule of project.exclusions) {
    if (rule.partA === rule.partB) warnings.push('同じパーツを指定した使用禁止ペアがあります。');
  }
  return { errors, warnings };
}
