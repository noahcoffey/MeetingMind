import * as fs from 'fs';

// Write JSON via a temp file + rename so a crash mid-write can never leave a
// truncated file behind. rename() is atomic on the same filesystem, and the
// temp file lives next to the target so they're always on the same volume.
export function writeJsonAtomic(filePath: string, value: unknown): void {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2));
  fs.renameSync(tmpPath, filePath);
}
