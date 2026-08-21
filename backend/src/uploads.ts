import { mkdir, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Self-hosted deployments get local-disk storage with zero extra
// infrastructure — no S3/bucket setup needed. Files live under
// uploads/<treeId>/<individualId>/ and are served back at the same
// /uploads/... path by @fastify/static (see server.ts).
const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");

export function uploadsRoot(): string {
  return UPLOADS_ROOT;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
}

export async function saveUpload(
  treeId: string,
  individualId: string,
  filename: string,
  buffer: Buffer,
): Promise<{ url: string }> {
  const dir = path.join(UPLOADS_ROOT, treeId, individualId);
  await mkdir(dir, { recursive: true });
  const storedFilename = `${randomUUID()}-${sanitizeFilename(filename)}`;
  await writeFile(path.join(dir, storedFilename), buffer);
  return { url: `/uploads/${treeId}/${individualId}/${storedFilename}` };
}

// Account-level uploads (avatars) aren't scoped to any tree — stored under
// their own uploads/users/<userId>/ subtree instead, served by a separate
// route gated by plain requireAuth (see routes/user-uploads.ts), not
// requireTreeMembership.
export async function saveUserUpload(userId: string, filename: string, buffer: Buffer): Promise<{ url: string }> {
  const dir = path.join(UPLOADS_ROOT, "users", userId);
  await mkdir(dir, { recursive: true });
  const storedFilename = `${randomUUID()}-${sanitizeFilename(filename)}`;
  await writeFile(path.join(dir, storedFilename), buffer);
  return { url: `/uploads/users/${userId}/${storedFilename}` };
}

export async function deleteUploadByUrl(url: string): Promise<void> {
  const relative = url.replace(/^\/uploads\//, "");
  const filePath = path.join(UPLOADS_ROOT, relative);
  await unlink(filePath).catch(() => {
    // Already gone / never existed — deleting the DB row still succeeds.
  });
}

// Deleting a tree cascades every row referencing it away in the database,
// but the uploaded files on disk under uploads/<treeId>/ are only ever
// tracked by those rows — without this they'd be orphaned forever.
export async function deleteTreeUploads(treeId: string): Promise<void> {
  await rm(path.join(UPLOADS_ROOT, treeId), { recursive: true, force: true });
}
