import type { CMSFormField } from '@/lib/api-types';

/**
 * Form field helpers for the field-driven forms (download-gate dialog), mirroring
 * the ep-api contract (API-108) as implemented by ep-website's PublicForm.
 *
 * - `heading` / `paragraph` are display-only: the text is the field's label, they
 *   never hold a value, are never required and are never submitted.
 * - `datetime` is an ISO local `YYYY-MM-DDTHH:mm` string (`<input type="datetime-local">`).
 * - `file` travels INSIDE the JSON submit body as base64 `{ name, type, size, data }`;
 *   ep-api validates it again and emails it to admins (never stored).
 */

export function isDisplayOnlyField(field: CMSFormField): boolean {
  return field.type === 'heading' || field.type === 'paragraph';
}

const MB = 1024 * 1024;

export const FILE_TOTAL_LIMIT_BYTES = 3 * MB;
const DEFAULT_MAX_SIZE_MB = 3;

export const FILE_TYPE_PRESETS = {
  documents: ['pdf', 'doc', 'docx', 'odt', 'rtf', 'txt'],
  images: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
  spreadsheets: ['xls', 'xlsx', 'ods', 'csv'],
} as const;

type FileGroup = keyof typeof FILE_TYPE_PRESETS;
const ALL_GROUPS = Object.keys(FILE_TYPE_PRESETS) as FileGroup[];

/** The value held in form state and sent as `submission_data[name]`. */
export type FormFileValue = { name: string; type: string; size: number; data: string };

export function fileMaxSizeMB(field: CMSFormField): number {
  const raw = field.settings?.maxSizeMB;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_MAX_SIZE_MB;
  // Same rule as ep-api: whole MB, clamped 1–3.
  return Math.min(3, Math.max(1, Math.floor(raw)));
}

/** Allowed extensions (lowercase, no dot). Missing/empty/unknown `fileTypes` = all. */
export function fileAllowedExtensions(field: CMSFormField): string[] {
  const groups = field.settings?.fileTypes;
  const known = Array.isArray(groups)
    ? groups.filter((g): g is FileGroup => (ALL_GROUPS as string[]).includes(g))
    : [];
  const chosen = known.length > 0 ? known : ALL_GROUPS;
  return [...new Set(chosen.flatMap((g) => [...FILE_TYPE_PRESETS[g]]))];
}

export function fileAcceptAttribute(field: CMSFormField): string {
  return fileAllowedExtensions(field)
    .map((ext) => `.${ext}`)
    .join(',');
}

export function fileTypesSummary(field: CMSFormField): string {
  return fileAllowedExtensions(field)
    .map((e) => e.toUpperCase())
    .join(', ');
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase();
}

export type FileCheck = { ok: true } | { ok: false; reason: 'type' | 'size' | 'total' };

/** Checks one picked file against the field's limits and the running total of the
 * OTHER file fields. The extension is authoritative; the browser MIME type is ignored. */
export function checkPickedFile(opts: {
  field: CMSFormField;
  file: { name: string; size: number };
  otherFilesBytes: number;
}): FileCheck {
  const { field, file, otherFilesBytes } = opts;
  if (!fileAllowedExtensions(field).includes(extensionOf(file.name))) return { ok: false, reason: 'type' };
  if (file.size > fileMaxSizeMB(field) * MB) return { ok: false, reason: 'size' };
  if (otherFilesBytes + file.size > FILE_TOTAL_LIMIT_BYTES) return { ok: false, reason: 'total' };
  return { ok: true };
}

export function totalFileBytes(files: Record<string, FormFileValue | null>, exceptName?: string): number {
  let total = 0;
  for (const [name, value] of Object.entries(files)) {
    if (name !== exceptName) total += value?.size ?? 0;
  }
  return total;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / MB).toFixed(1)} MB`;
}

/** Reads a File as base64 (no `data:...;base64,` prefix). Rejects on failure. */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      if (comma === -1) {
        reject(new Error('unexpected result'));
        return;
      }
      resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}
