export const FORMAT_VERSION = 2;

export type StandardCategory = 'body' | 'clothes' | 'expression' | 'blink' | 'lip' | 'decoration' | 'other';

export interface Part {
  id: string;
  groupId: string;
  name: string;
  originalName: string;
  width: number;
  height: number;
  hash: string;
  enabled: boolean;
  hasTransparency: boolean;
  image: Blob;
  /** When this part is selected, differences in these groups are collapsed to one output. */
  collapsedGroupIds?: string[];
}

export interface PartGroup {
  id: string;
  name: string;
  category: StandardCategory;
  required: boolean;
  enabled: boolean;
  parts: Part[];
}

export interface ExclusionRule {
  id: string;
  partA: string;
  partB: string;
}

export interface OutputSettings {
  relativePath: string;
  digits: number;
}

export interface StandeeProject {
  version: number;
  id: string;
  name: string;
  character: string;
  width: number;
  height: number;
  groups: PartGroup[];
  exclusions: ExclusionRule[];
  output: OutputSettings;
  createdAt: string;
  updatedAt: string;
}

export interface Combination {
  id: string;
  selections: Record<string, string | null>;
}

export interface ProjectFile extends Omit<StandeeProject, 'groups'> {
  groups: Array<Omit<PartGroup, 'parts'> & {
    parts: Array<Omit<Part, 'image'> & { imageBase64: string }>;
  }>;
}

export const CATEGORY_LABELS: Record<StandardCategory, string> = {
  body: '素体',
  clothes: '服',
  expression: '表情',
  blink: 'まばたき',
  lip: 'リップシンク',
  decoration: '装飾',
  other: 'その他',
};

export function uid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function createProject(): StandeeProject {
  const now = new Date().toISOString();
  const group = (name: string, category: StandardCategory): PartGroup => ({
    id: uid('group'), name, category, required: true, enabled: true, parts: [],
  });
  return {
    version: FORMAT_VERSION,
    id: uid('project'),
    name: '新しい立ち絵プロジェクト',
    character: 'character',
    width: 0,
    height: 0,
    groups: [
      group('素体', 'body'),
      group('服', 'clothes'),
      group('表情', 'expression'),
      group('まばたき', 'blink'),
      group('リップシンク', 'lip'),
    ],
    exclusions: [],
    output: { relativePath: 'Character', digits: 4 },
    createdAt: now,
    updatedAt: now,
  };
}

export function migrateProject(project: StandeeProject): StandeeProject {
  if (project.version < 1 || project.version > FORMAT_VERSION) {
    throw new Error(`未対応のプロジェクト形式です（version: ${project.version}）。`);
  }
  return {
    ...project,
    version: FORMAT_VERSION,
    groups: project.groups.map((group) => ({
      ...group,
      parts: group.parts.map((part) => ({ ...part, collapsedGroupIds: part.collapsedGroupIds ?? [] })),
    })),
  };
}

export function sanitizeSegment(value: string, fallback = 'character'): string {
  const safe = value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\.+$/g, '').trim();
  return safe || fallback;
}

export function normalizedOutputPath(project: StandeeProject): string {
  const base = project.output.relativePath.split(/[\\/]+/).map((part) => sanitizeSegment(part, '')).filter(Boolean);
  const character = sanitizeSegment(project.character);
  return [...base, character].join('/');
}

export function outputFileName(project: StandeeProject, index: number): string {
  return `${sanitizeSegment(project.character)}_${String(index).padStart(project.output.digits, '0')}.png`;
}
