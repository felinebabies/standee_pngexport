import type { Combination, Part, StandeeProject } from './model';

const bitmapCache = new Map<string, ImageBitmap>();

export async function inspectPng(file: File): Promise<{ width: number; height: number; hasTransparency: boolean }> {
  if (file.type !== 'image/png' && !file.name.toLowerCase().endsWith('.png')) throw new Error('PNGファイルではありません。');
  const bitmap = await createImageBitmap(file);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('画像解析用Canvasを作成できません。');
  context.drawImage(bitmap, 0, 0);
  const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
  let hasTransparency = false;
  for (let offset = 3; offset < pixels.length; offset += 4) {
    if (pixels[offset] < 255) { hasTransparency = true; break; }
  }
  bitmap.close();
  return { width: canvas.width, height: canvas.height, hasTransparency };
}

export async function hashBlob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function bitmapFor(part: Part): Promise<ImageBitmap> {
  const existing = bitmapCache.get(part.id);
  if (existing) return existing;
  const bitmap = await createImageBitmap(part.image);
  bitmapCache.set(part.id, bitmap);
  return bitmap;
}

export function releasePartBitmap(partId: string): void {
  bitmapCache.get(partId)?.close();
  bitmapCache.delete(partId);
}

export async function drawCombination(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  project: StandeeProject,
  combination: Combination,
): Promise<void> {
  context.clearRect(0, 0, project.width, project.height);
  for (const group of project.groups.filter((candidate) => candidate.enabled)) {
    const partId = combination.selections[group.id];
    if (!partId) continue;
    const part = group.parts.find((candidate) => candidate.id === partId && candidate.enabled);
    if (part) context.drawImage(await bitmapFor(part), 0, 0);
  }
}

export async function renderPng(project: StandeeProject, combination: Combination): Promise<Blob> {
  const canvas = new OffscreenCanvas(project.width, project.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('出力用Canvasを作成できません。');
  await drawCombination(context, project, combination);
  return canvas.convertToBlob({ type: 'image/png' });
}
