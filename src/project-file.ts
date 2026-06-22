import { FORMAT_VERSION, migrateProject, type ProjectFile, type StandeeProject } from './model';

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, encoded] = dataUrl.split(',');
  const mime = header.match(/data:([^;]+)/)?.[1] ?? 'image/png';
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export async function serializeProject(project: StandeeProject): Promise<ProjectFile> {
  return {
    ...project,
    version: FORMAT_VERSION,
    groups: await Promise.all(project.groups.map(async (group) => ({
      ...group,
      parts: await Promise.all(group.parts.map(async (part) => ({
        ...part,
        imageBase64: await blobToDataUrl(part.image),
        image: undefined,
      }))).then((parts) => parts.map(({ image: _image, ...part }) => part)),
    }))),
  };
}

export function deserializeProject(file: ProjectFile): StandeeProject {
  return migrateProject({
    ...file,
    groups: file.groups.map((group) => ({
      ...group,
      parts: group.parts.map(({ imageBase64, ...part }) => ({ ...part, image: dataUrlToBlob(imageBase64) })),
    })),
  });
}
