import { Zip, ZipPassThrough, strToU8 } from 'fflate';
import { combinationLabel, combinationParts, iterateCombinations, validateProject } from './combinations';
import { renderPng } from './image';
import { normalizedOutputPath, outputFileName, type StandeeProject } from './model';
import { serializeProject } from './project-file';

export interface ExportProgress { completed: number; total: number; fileName: string }

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export async function exportProjectZip(
  project: StandeeProject,
  signal: AbortSignal,
  onProgress: (progress: ExportProgress) => void,
): Promise<Blob> {
  const validation = validateProject(project);
  if (validation.errors.length) throw new Error(validation.errors.join('\n'));
  const combinations = [...iterateCombinations(project)];
  const archiveChunks: Uint8Array[] = [];
  let archiveError: Error | null = null;
  const zip = new Zip((error, chunk) => {
    if (error) archiveError = error;
    else archiveChunks.push(chunk);
  });
  const addFile = (name: string, data: Uint8Array) => {
    const entry = new ZipPassThrough(name);
    zip.add(entry);
    entry.push(data, true);
  };
  const rows: string[] = ['Pattern,FileName,Parts'];
  const jsonRows = [];
  const outputPath = normalizedOutputPath(project);

  for (let index = 0; index < combinations.length; index += 1) {
    if (signal.aborted) throw new DOMException('書き出しをキャンセルしました。', 'AbortError');
    const combination = combinations[index];
    const name = outputFileName(project, index + 1);
    const relativeName = `${outputPath}/${name}`;
    const png = await renderPng(project, combination);
    addFile(relativeName, new Uint8Array(await png.arrayBuffer()));
    const withoutExtension = relativeName.replace(/\.png$/i, '');
    const pattern = combinationLabel(project, combination);
    const parts = combinationParts(project, combination);
    rows.push([pattern, withoutExtension, parts].map(csvCell).join(','));
    jsonRows.push({
      combinationId: combination.id,
      pattern,
      fileName: withoutExtension,
      parts: combination.selections,
      width: project.width,
      height: project.height,
      order: index + 1,
    });
    onProgress({ completed: index + 1, total: combinations.length, fileName: name });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  addFile('character_patterns.csv', strToU8(`\uFEFF${rows.join('\r\n')}`));
  addFile('character_patterns.json', strToU8(JSON.stringify(jsonRows, null, 2)));
  addFile('project.standee.json', strToU8(JSON.stringify(await serializeProject(project))));
  zip.end();
  if (archiveError) throw archiveError;
  return new Blob(archiveChunks as BlobPart[], { type: 'application/zip' });
}
