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

// The stored name ends up inside Individual.photoUrl / PersonMedia.url,
// so it has to stay short: the path prefix alone (/uploads/<cuid>/<cuid>/
// <uuid>-) is ~98 chars. Accents fold to plain letters (as in filename.ts)
// and the base is capped at 40 chars — Wikipedia/Commons downloads often
// come with 100+ char names, which used to overflow the URL column and
// make the whole upload fail.
const MAX_BASENAME = 40;

function sanitizeFilename(name: string): string {
  const cleaned = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const dot = cleaned.lastIndexOf(".");
  const hasExt = dot > 0 && cleaned.length - dot <= 6;
  const ext = hasExt ? cleaned.slice(dot).toLowerCase() : "";
  const base = (hasExt ? cleaned.slice(0, dot) : cleaned).slice(0, MAX_BASENAME).replace(/[._-]+$/g, "");
  return `${base || "archivo"}${ext}`;
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
