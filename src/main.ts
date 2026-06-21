import './styles.css';
import { combinationCounts, combinationLabel, enabledGroups, isExcluded, iterateCombinations, validateProject } from './combinations';
import { exportProjectZip, type ExportProgress } from './exporter';
import { drawCombination, hashBlob, inspectPng, releasePartBitmap } from './image';
import {
  CATEGORY_LABELS,
  createProject,
  normalizedOutputPath,
  uid,
  type Combination,
  type ExclusionRule,
  type Part,
  type PartGroup,
  type StandardCategory,
} from './model';
import { deserializeProject, serializeProject } from './project-file';
import { loadLatestProject, saveToIndexedDb } from './storage';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('アプリケーションの初期化に失敗しました。');

let project = createProject();
let selectedGroupId = project.groups[0].id;
let selectedPartId: string | null = null;
let currentSelections: Record<string, string | null> = {};
let currentCombinationIndex = 0;
let zoom: 'fit' | 'actual' | number = 'fit';
let saveTimer: number | undefined;
let exportController: AbortController | null = null;
let exportProgress: ExportProgress | null = null;
let statusMessage = 'PNGを登録してプロジェクトを開始してください。';
let statusTone: 'neutral' | 'success' | 'error' = 'neutral';

app.innerHTML = `
  <div class="app-shell">
    <header class="topbar">
      <div class="brand"><span class="brand-mark">VQ</span><span><b>VQStandeeForge</b><small>TRANSPARENT PNG COMPOSITOR</small></span></div>
      <nav class="toolbar" aria-label="プロジェクト操作">
        <button id="new-project" class="button ghost">新規</button>
        <button id="load-project" class="button ghost">読込</button>
        <button id="save-project" class="button ghost">プロジェクト保存</button>
        <button id="add-png" class="button">PNG登録</button>
        <button id="export-zip" class="button accent">ZIP書き出し</button>
      </nav>
      <input id="png-input" type="file" accept="image/png,.png" multiple hidden />
      <input id="project-input" type="file" accept="application/json,.json,.standee.json" hidden />
    </header>
    <main class="workspace">
      <aside class="left-panel panel">
        <div class="panel-heading"><span><small>LAYERS</small>グループとパーツ</span><button id="add-group" class="icon-button" title="グループを追加" aria-label="グループを追加">＋</button></div>
        <p class="layer-guide"><i></i> 上にあるグループほど前面に合成</p>
        <div id="tree" class="tree"></div>
        <button id="drop-zone" class="drop-zone"><b>PNGをドロップ</b><span>選択中のグループへ登録</span></button>
      </aside>
      <section class="stage-panel">
        <div class="stage-toolbar">
          <div><b id="combination-name">プレビューなし</b><span id="canvas-size">未設定</span></div>
          <div class="segmented" aria-label="ズーム">
            <button data-zoom="fit" class="active">フィット</button><button data-zoom="actual">等倍</button><button data-zoom="in">＋</button><button data-zoom="out">−</button>
          </div>
        </div>
        <div id="stage" class="stage" tabindex="0" aria-label="合成プレビュー">
          <canvas id="preview-canvas"></canvas>
          <div id="empty-stage" class="empty-stage"><span class="empty-glyph">＋</span><b>透過PNGを登録</b><span>左のグループを選び、ファイルをドロップしてください</span></div>
        </div>
        <div class="preview-nav"><button id="prev-combination" class="button ghost">← 前へ</button><span id="combination-position">0 / 0</span><button id="next-combination" class="button ghost">次へ →</button></div>
      </section>
      <aside class="right-panel panel">
        <div class="panel-heading"><span><small>CONTROL</small>設定と組み合わせ</span></div>
        <div id="inspector" class="inspector"></div>
      </aside>
    </main>
    <footer class="statusbar">
      <div class="status-message"><span id="status-dot"></span><span id="status-text"></span></div>
      <div id="validation-summary" class="validation-summary"></div>
      <div id="counts" class="counts"></div>
    </footer>
    <div id="export-overlay" class="export-overlay" hidden>
      <div class="export-card"><small>GENERATING ARCHIVE</small><h2>PNGを書き出しています</h2><p id="export-file"></p><progress id="export-progress" max="1" value="0"></progress><div><span id="export-count"></span><button id="cancel-export" class="button danger">キャンセル</button></div></div>
    </div>
  </div>`;

const tree = required<HTMLDivElement>('tree');
const inspector = required<HTMLDivElement>('inspector');
const canvas = required<HTMLCanvasElement>('preview-canvas');
const stage = required<HTMLDivElement>('stage');
const emptyStage = required<HTMLDivElement>('empty-stage');
const pngInput = required<HTMLInputElement>('png-input');
const projectInput = required<HTMLInputElement>('project-input');

function required<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`要素 #${id} が見つかりません。`);
  return element as T;
}

function button(label: string, className = 'mini-button', title = label): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.textContent = label;
  element.title = title;
  return element;
}

function field(label: string, value: string, onChange: (value: string) => void, type = 'text'): HTMLLabelElement {
  const wrapper = document.createElement('label');
  wrapper.className = 'field';
  const caption = document.createElement('span');
  caption.textContent = label;
  const input = document.createElement('input');
  input.type = type;
  input.value = value;
  input.addEventListener('change', () => onChange(input.value));
  wrapper.append(caption, input);
  return wrapper;
}

function currentGroup(): PartGroup | undefined {
  return project.groups.find((group) => group.id === selectedGroupId);
}

function currentPart(): Part | undefined {
  return currentGroup()?.parts.find((part) => part.id === selectedPartId);
}

function combinations(): Combination[] {
  return [...iterateCombinations(project)];
}

function ensureSelections(): void {
  const groups = enabledGroups(project);
  const validGroupIds = new Set(groups.map((group) => group.id));
  for (const key of Object.keys(currentSelections)) if (!validGroupIds.has(key)) delete currentSelections[key];
  for (const group of groups) {
    const selected = currentSelections[group.id];
    const valid = selected === null ? !group.required : group.parts.some((part) => part.id === selected && part.enabled);
    if (!valid) currentSelections[group.id] = group.required ? group.parts.find((part) => part.enabled)?.id ?? null : null;
  }
}

function touch(message?: string, tone: typeof statusTone = 'neutral'): void {
  project.updatedAt = new Date().toISOString();
  if (message) { statusMessage = message; statusTone = tone; }
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveToIndexedDb(project).catch((error: unknown) => setStatus(`自動保存に失敗しました: ${messageOf(error)}`, 'error'));
  }, 450);
  render();
}

function setStatus(message: string, tone: typeof statusTone = 'neutral'): void {
  statusMessage = message;
  statusTone = tone;
  renderStatus();
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function render(): void {
  ensureSelections();
  renderTree();
  renderInspector();
  renderStatus();
  void renderPreview();
}

function renderTree(): void {
  tree.replaceChildren();
  [...project.groups].reverse().forEach((group) => {
    const groupElement = document.createElement('section');
    groupElement.className = `group ${group.id === selectedGroupId ? 'selected' : ''} ${group.enabled ? '' : 'disabled'}`;
    const head = document.createElement('div');
    head.className = 'group-head';
    head.tabIndex = 0;
    head.addEventListener('click', () => { selectedGroupId = group.id; selectedPartId = null; render(); });
    const visibility = button(group.enabled ? '●' : '○', 'visibility', group.enabled ? 'グループを無効にする' : 'グループを有効にする');
    visibility.addEventListener('click', (event) => { event.stopPropagation(); group.enabled = !group.enabled; touch(); });
    const labels = document.createElement('span');
    const groupName = document.createElement('b'); groupName.textContent = group.name;
    const meta = document.createElement('small'); meta.textContent = `${group.required ? '必須' : '任意'} · ${group.parts.filter((part) => part.enabled).length} PNG`;
    labels.append(groupName, meta);
    const add = button('＋', 'mini-button add-part', 'このグループにPNGを追加');
    add.addEventListener('click', (event) => { event.stopPropagation(); selectedGroupId = group.id; pngInput.click(); });
    head.append(visibility, labels, add);
    groupElement.append(head);

    for (const part of [...group.parts].reverse()) {
      const row = document.createElement('div');
      row.className = `part-row ${part.id === selectedPartId ? 'selected' : ''} ${part.enabled ? '' : 'disabled'}`;
      row.addEventListener('click', () => {
        selectedGroupId = group.id; selectedPartId = part.id; currentSelections[group.id] = part.id; render();
      });
      const vis = button(part.enabled ? '◆' : '◇', 'part-vis', part.enabled ? 'パーツを無効にする' : 'パーツを有効にする');
      vis.addEventListener('click', (event) => { event.stopPropagation(); part.enabled = !part.enabled; touch(); });
      const name = document.createElement('span'); name.textContent = part.name; name.title = part.originalName;
      const selected = document.createElement('span'); selected.className = 'current-indicator'; selected.textContent = currentSelections[group.id] === part.id ? '表示中' : '';
      row.append(vis, name, selected);
      groupElement.append(row);
    }
    tree.append(groupElement);
  });
}

function section(title: string, eyebrow: string): HTMLElement {
  const element = document.createElement('section');
  element.className = 'inspector-section';
  const heading = document.createElement('h3');
  const small = document.createElement('small'); small.textContent = eyebrow;
  const text = document.createTextNode(title);
  heading.append(small, text);
  element.append(heading);
  return element;
}

function renderInspector(): void {
  inspector.replaceChildren();
  const projectSection = section('プロジェクト', 'PROJECT');
  projectSection.append(
    field('プロジェクト名', project.name, (value) => { project.name = value; touch(); }),
    field('キャラクター識別名', project.character, (value) => { project.character = value; touch(); }),
  );
  inspector.append(projectSection);

  const selected = section(currentPart() ? 'パーツ設定' : 'グループ設定', 'SELECTED');
  const group = currentGroup();
  const part = currentPart();
  if (group && part) renderPartSettings(selected, group, part);
  else if (group) renderGroupSettings(selected, group);
  else { const p = document.createElement('p'); p.className = 'muted'; p.textContent = '左側からグループを選択してください。'; selected.append(p); }
  inspector.append(selected);

  const choiceSection = section('現在の組み合わせ', 'COMBINATION');
  for (const choiceGroup of enabledGroups(project)) {
    const label = document.createElement('label'); label.className = 'field';
    const caption = document.createElement('span'); caption.textContent = choiceGroup.name;
    const select = document.createElement('select');
    if (!choiceGroup.required) select.add(new Option('なし', ''));
    for (const choicePart of choiceGroup.parts.filter((candidate) => candidate.enabled)) select.add(new Option(choicePart.name, choicePart.id));
    select.value = currentSelections[choiceGroup.id] ?? '';
    select.addEventListener('change', () => { currentSelections[choiceGroup.id] = select.value || null; currentCombinationIndex = combinationIndexForSelections(); render(); });
    label.append(caption, select); choiceSection.append(label);
  }
  if (isExcluded(project, currentSelections)) {
    const warning = document.createElement('p'); warning.className = 'inline-warning'; warning.textContent = 'この組み合わせは除外規則に該当します。'; choiceSection.append(warning);
  }
  inspector.append(choiceSection);

  inspector.append(renderExclusions());

  const output = section('出力設定', 'EXPORT');
  output.append(
    field('ZIP内の相対パス', project.output.relativePath, (value) => { project.output.relativePath = value; touch(); }),
    field('連番の桁数', String(project.output.digits), (value) => { project.output.digits = Math.min(8, Math.max(1, Number(value) || 4)); touch(); }, 'number'),
  );
  const sample = document.createElement('code'); sample.textContent = `${normalizedOutputPath(project)}/${project.character}_${String(1).padStart(project.output.digits, '0')}.png`; output.append(sample);
  inspector.append(output);
}

function renderGroupSettings(container: HTMLElement, group: PartGroup): void {
  container.append(field('表示名', group.name, (value) => { group.name = value.trim() || '名称未設定'; touch(); }));
  const categoryLabel = document.createElement('label'); categoryLabel.className = 'field';
  const caption = document.createElement('span'); caption.textContent = '標準カテゴリ';
  const category = document.createElement('select');
  for (const [value, label] of Object.entries(CATEGORY_LABELS)) category.add(new Option(label, value));
  category.value = group.category;
  category.addEventListener('change', () => { group.category = category.value as StandardCategory; touch(); });
  categoryLabel.append(caption, category); container.append(categoryLabel);
  const toggles = document.createElement('div'); toggles.className = 'toggle-row';
  const requiredLabel = document.createElement('label');
  const required = document.createElement('input'); required.type = 'checkbox'; required.checked = group.required;
  required.addEventListener('change', () => { group.required = required.checked; touch(); });
  requiredLabel.append(required, document.createTextNode(' 必須グループ'));
  toggles.append(requiredLabel); container.append(toggles);
  const actions = document.createElement('div'); actions.className = 'action-row';
  const down = button('背面へ'); down.addEventListener('click', () => moveGroup(group.id, -1));
  const up = button('前面へ'); up.addEventListener('click', () => moveGroup(group.id, 1));
  const remove = button('削除', 'mini-button danger'); remove.addEventListener('click', () => removeGroup(group));
  actions.append(down, up, remove); container.append(actions);
}

function renderPartSettings(container: HTMLElement, group: PartGroup, part: Part): void {
  container.append(field('表示名', part.name, (value) => { part.name = value.trim() || '名称未設定'; touch(); }));
  const details = document.createElement('dl'); details.className = 'part-details';
  for (const [term, value] of [['元ファイル', part.originalName], ['寸法', `${part.width} × ${part.height}px`], ['SHA-256', part.hash.slice(0, 12)]] as const) {
    const dt = document.createElement('dt'); dt.textContent = term; const dd = document.createElement('dd'); dd.textContent = value; details.append(dt, dd);
  }
  container.append(details);
  const actions = document.createElement('div'); actions.className = 'action-row';
  const down = button('下へ'); down.addEventListener('click', () => movePart(group, part.id, -1));
  const up = button('上へ'); up.addEventListener('click', () => movePart(group, part.id, 1));
  const remove = button('削除', 'mini-button danger'); remove.addEventListener('click', () => removePart(group, part));
  actions.append(down, up, remove); container.append(actions);
}

function renderExclusions(): HTMLElement {
  const container = section('使用禁止ペア', 'EXCLUSION RULES');
  const parts = project.groups.flatMap((group) => group.parts.map((part) => ({ group, part })));
  if (parts.length < 2) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = '2つ以上のパーツ登録後に設定できます。'; container.append(p); return container; }
  for (const rule of project.exclusions) container.append(exclusionRow(rule, parts));
  const add = button('＋ 使用禁止ペアを追加', 'wide-button');
  add.addEventListener('click', () => {
    const first = parts[0]; const second = parts.find((candidate) => candidate.group.id !== first.group.id) ?? parts[1];
    project.exclusions.push({ id: uid('rule'), partA: first.part.id, partB: second.part.id }); touch();
  });
  container.append(add); return container;
}

function exclusionRow(rule: ExclusionRule, parts: Array<{ group: PartGroup; part: Part }>): HTMLElement {
  const row = document.createElement('div'); row.className = 'rule-row';
  const makeSelect = (selected: string, update: (id: string) => void) => {
    const select = document.createElement('select');
    for (const item of parts) select.add(new Option(`${item.group.name} / ${item.part.name}`, item.part.id));
    select.value = selected; select.addEventListener('change', () => { update(select.value); touch(); }); return select;
  };
  const a = makeSelect(rule.partA, (id) => { rule.partA = id; });
  const mark = document.createElement('span'); mark.textContent = '×';
  const b = makeSelect(rule.partB, (id) => { rule.partB = id; });
  const remove = button('削除', 'mini-button danger'); remove.addEventListener('click', () => { project.exclusions = project.exclusions.filter((candidate) => candidate.id !== rule.id); touch(); });
  row.append(a, mark, b, remove); return row;
}

function renderStatus(): void {
  required<HTMLElement>('status-text').textContent = statusMessage;
  required<HTMLElement>('status-dot').className = statusTone;
  const counts = combinationCounts(project);
  required<HTMLElement>('counts').textContent = `理論 ${counts.theoretical.toLocaleString()} － 除外 ${counts.excluded.toLocaleString()} ＝ 出力 ${counts.final.toLocaleString()}`;
  const validation = validateProject(project);
  const summary = required<HTMLElement>('validation-summary');
  summary.className = `validation-summary ${validation.errors.length ? 'has-error' : validation.warnings.length ? 'has-warning' : 'valid'}`;
  summary.textContent = validation.errors.length ? `エラー ${validation.errors.length}` : validation.warnings.length ? `警告 ${validation.warnings.length}` : '検証OK';
  summary.title = [...validation.errors, ...validation.warnings].join('\n');
}

async function renderPreview(): Promise<void> {
  const combo = { id: 'preview', selections: { ...currentSelections } };
  const hasCanvas = project.width > 0 && project.height > 0;
  emptyStage.hidden = hasCanvas;
  canvas.hidden = !hasCanvas;
  required<HTMLElement>('canvas-size').textContent = hasCanvas ? `${project.width} × ${project.height}px` : '未設定';
  if (!hasCanvas) { required<HTMLElement>('combination-name').textContent = 'プレビューなし'; return; }
  canvas.width = project.width; canvas.height = project.height;
  const context = canvas.getContext('2d');
  if (!context) return;
  await drawCombination(context, project, combo);
  applyZoom();
  required<HTMLElement>('combination-name').textContent = combinationLabel(project, combo);
  const list = combinations();
  const position = combinationIndexForSelections();
  required<HTMLElement>('combination-position').textContent = `${position >= 0 ? position + 1 : 0} / ${list.length}`;
}

function applyZoom(): void {
  if (!project.width || !project.height) return;
  const availableWidth = Math.max(100, stage.clientWidth - 80);
  const availableHeight = Math.max(100, stage.clientHeight - 80);
  let scale = 1;
  if (zoom === 'fit') scale = Math.min(availableWidth / project.width, availableHeight / project.height, 1);
  else if (zoom === 'actual') scale = 1;
  else scale = zoom;
  canvas.style.width = `${project.width * scale}px`;
  canvas.style.height = `${project.height * scale}px`;
}

function combinationIndexForSelections(): number {
  return combinations().findIndex((combo) => Object.entries(combo.selections).every(([group, part]) => currentSelections[group] === part));
}

function moveGroup(id: string, direction: number): void {
  const index = project.groups.findIndex((group) => group.id === id);
  const target = index + direction;
  if (target < 0 || target >= project.groups.length) return;
  [project.groups[index], project.groups[target]] = [project.groups[target], project.groups[index]]; touch('合成順を変更しました。');
}

function movePart(group: PartGroup, id: string, direction: number): void {
  const index = group.parts.findIndex((part) => part.id === id); const target = index + direction;
  if (target < 0 || target >= group.parts.length) return;
  [group.parts[index], group.parts[target]] = [group.parts[target], group.parts[index]]; touch('パーツ順を変更しました。');
}

function removeGroup(group: PartGroup): void {
  if (!confirm(`グループ「${group.name}」と登録PNGを削除しますか？ 元ファイルは変更されません。`)) return;
  for (const part of group.parts) releasePartBitmap(part.id);
  const partIds = new Set(group.parts.map((part) => part.id));
  project.groups = project.groups.filter((candidate) => candidate.id !== group.id);
  project.exclusions = project.exclusions.filter((rule) => !partIds.has(rule.partA) && !partIds.has(rule.partB));
  selectedGroupId = project.groups[0]?.id ?? ''; selectedPartId = null; touch('グループを削除しました。');
}

function removePart(group: PartGroup, part: Part): void {
  if (!confirm(`パーツ「${part.name}」を登録解除しますか？ 元ファイルは変更されません。`)) return;
  releasePartBitmap(part.id); group.parts = group.parts.filter((candidate) => candidate.id !== part.id);
  project.exclusions = project.exclusions.filter((rule) => rule.partA !== part.id && rule.partB !== part.id);
  selectedPartId = null; touch('パーツを登録解除しました。');
}

async function registerFiles(files: File[]): Promise<void> {
  const group = currentGroup();
  if (!group) { setStatus('登録先のグループを選択してください。', 'error'); return; }
  let added = 0;
  const errors: string[] = [];
  for (const file of files) {
    try {
      const info = await inspectPng(file);
      if (!project.width) { project.width = info.width; project.height = info.height; }
      if (info.width !== project.width || info.height !== project.height) {
        throw new Error(`${info.width}×${info.height}px（必要: ${project.width}×${project.height}px）`);
      }
      const hash = await hashBlob(file);
      const duplicateName = project.groups.some((candidate) => candidate.parts.some((part) => part.originalName === file.name));
      const duplicateHash = project.groups.some((candidate) => candidate.parts.some((part) => part.hash === hash));
      const part: Part = {
        id: uid('part'), groupId: group.id, name: file.name.replace(/\.png$/i, ''), originalName: file.name,
        width: info.width, height: info.height, hash, enabled: true, hasTransparency: info.hasTransparency, image: file,
      };
      group.parts.push(part); currentSelections[group.id] = part.id; selectedPartId = part.id; added += 1;
      if (duplicateName || duplicateHash) errors.push(`${file.name}: ${duplicateHash ? '同一内容' : '同一ファイル名'}の登録があります（警告）。`);
    } catch (error) { errors.push(`${file.name}: ${messageOf(error)}`); }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  touch(errors.length ? `${added}件登録。${errors.join(' / ')}` : `${added}件のPNGを「${group.name}」へ登録しました。`, errors.some((item) => !item.includes('警告')) ? 'error' : 'success');
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function saveProjectFile(): Promise<void> {
  try {
    const serialized = await serializeProject(project);
    download(new Blob([JSON.stringify(serialized)], { type: 'application/json' }), `${project.character}.standee.json`);
    setStatus('画像を含むプロジェクト定義を保存しました。', 'success');
  } catch (error) { setStatus(`保存に失敗しました: ${messageOf(error)}`, 'error'); }
}

async function loadProjectFile(file: File): Promise<void> {
  try {
    const parsed = JSON.parse(await file.text()) as Parameters<typeof deserializeProject>[0];
    project = deserializeProject(parsed); selectedGroupId = project.groups[0]?.id ?? ''; selectedPartId = null; currentSelections = {}; currentCombinationIndex = 0;
    touch('プロジェクトを読み込みました。', 'success');
  } catch (error) { setStatus(`プロジェクトを読み込めません: ${messageOf(error)}`, 'error'); }
}

async function startExport(): Promise<void> {
  const validation = validateProject(project);
  if (validation.errors.length) { setStatus(validation.errors.join(' / '), 'error'); return; }
  const count = combinationCounts(project).final;
  if (count > 1000 && !confirm(`${count.toLocaleString()}件のPNGを生成します。処理時間と容量が大きくなる可能性があります。続行しますか？`)) return;
  exportController = new AbortController(); exportProgress = { completed: 0, total: count, fileName: '準備中' }; renderExportOverlay();
  try {
    const zip = await exportProjectZip(project, exportController.signal, (progress) => { exportProgress = progress; renderExportOverlay(); });
    download(zip, `${project.character}_patterns.zip`); setStatus(`${count.toLocaleString()}件のPNGをZIPへ書き出しました。`, 'success');
  } catch (error) {
    setStatus(error instanceof DOMException && error.name === 'AbortError' ? '書き出しをキャンセルしました。' : `書き出しに失敗しました: ${messageOf(error)}`, 'error');
  } finally { exportController = null; exportProgress = null; renderExportOverlay(); }
}

function renderExportOverlay(): void {
  const overlay = required<HTMLDivElement>('export-overlay'); overlay.hidden = !exportController;
  if (!exportProgress) return;
  required<HTMLElement>('export-file').textContent = exportProgress.fileName;
  const progress = required<HTMLProgressElement>('export-progress'); progress.max = exportProgress.total; progress.value = exportProgress.completed;
  required<HTMLElement>('export-count').textContent = `${exportProgress.completed.toLocaleString()} / ${exportProgress.total.toLocaleString()}`;
}

required('new-project').addEventListener('click', () => {
  if (!confirm('現在の作業を閉じて新しいプロジェクトを作成しますか？ 自動保存済みの内容はブラウザーに残ります。')) return;
  project = createProject(); selectedGroupId = project.groups[0].id; selectedPartId = null; currentSelections = {}; touch('新しいプロジェクトを作成しました。');
});
required('load-project').addEventListener('click', () => projectInput.click());
required('save-project').addEventListener('click', () => void saveProjectFile());
required('add-png').addEventListener('click', () => pngInput.click());
required('export-zip').addEventListener('click', () => void startExport());
required('add-group').addEventListener('click', () => {
  const name = prompt('新しいグループ名', '装飾'); if (!name?.trim()) return;
  const group: PartGroup = { id: uid('group'), name: name.trim(), category: 'other', required: false, enabled: true, parts: [] };
  project.groups.push(group); selectedGroupId = group.id; selectedPartId = null; touch('グループを追加しました。');
});
required('cancel-export').addEventListener('click', () => exportController?.abort());
pngInput.addEventListener('change', () => { void registerFiles([...pngInput.files ?? []]); pngInput.value = ''; });
projectInput.addEventListener('change', () => { const file = projectInput.files?.[0]; if (file) void loadProjectFile(file); projectInput.value = ''; });
required('prev-combination').addEventListener('click', () => navigateCombination(-1));
required('next-combination').addEventListener('click', () => navigateCombination(1));
document.querySelectorAll<HTMLButtonElement>('[data-zoom]').forEach((control) => control.addEventListener('click', () => {
  const value = control.dataset.zoom;
  if (value === 'fit' || value === 'actual') zoom = value;
  else { const current = typeof zoom === 'number' ? zoom : 1; zoom = Math.min(4, Math.max(0.1, current * (value === 'in' ? 1.25 : 0.8))); }
  document.querySelectorAll('[data-zoom]').forEach((item) => item.classList.toggle('active', item === control)); applyZoom();
}));

function navigateCombination(delta: number): void {
  const list = combinations(); if (!list.length) return;
  const found = combinationIndexForSelections(); currentCombinationIndex = found >= 0 ? found : currentCombinationIndex;
  currentCombinationIndex = (currentCombinationIndex + delta + list.length) % list.length;
  currentSelections = { ...list[currentCombinationIndex].selections }; render();
}

for (const target of [required('drop-zone'), stage]) {
  target.addEventListener('dragover', (event) => { event.preventDefault(); target.classList.add('dragging'); });
  target.addEventListener('dragleave', () => target.classList.remove('dragging'));
  target.addEventListener('drop', (event) => {
    event.preventDefault(); target.classList.remove('dragging');
    const files = [...(event as DragEvent).dataTransfer?.files ?? []].filter((file) => file.name.toLowerCase().endsWith('.png'));
    if (files.length) void registerFiles(files); else setStatus('PNGファイルをドロップしてください。', 'error');
  });
}

window.addEventListener('resize', applyZoom);
window.addEventListener('beforeunload', (event) => {
  if (project.groups.some((group) => group.parts.length)) { event.preventDefault(); }
});

void (async () => {
  try {
    const saved = await loadLatestProject();
    if (saved) { project = saved; selectedGroupId = project.groups[0]?.id ?? ''; statusMessage = 'ブラウザーに自動保存されたプロジェクトを復元しました。'; statusTone = 'success'; }
  } catch (error) { statusMessage = `自動保存データを復元できません: ${messageOf(error)}`; statusTone = 'error'; }
  render();
})();
