import { prisma } from "./db.js";

// v1 has no auth/session yet — self-hosted mode runs as a single implicit
// user on a single implicit tree (both created by the seed). Every route
// resolves "the current tree/user" through here instead of hardcoding an
// id, so swapping this for real request-scoped resolution (once hosted
// mode adds Google OAuth) doesn't require touching the routes themselves.
let cachedTreeId: string | null = null;
let cachedUserId: string | null = null;

export async function getDefaultTreeId(): Promise<string> {
  if (cachedTreeId) return cachedTreeId;
  const tree = await prisma.tree.findFirst({ orderBy: { createdAt: "asc" } });
  if (!tree) throw new Error("No hay ningún árbol todavía — ejecuta `prisma db seed`.");
  cachedTreeId = tree.id;
  return cachedTreeId;
}

export async function getDefaultUserId(): Promise<string | null> {
  if (cachedUserId) return cachedUserId;
  const treeId = await getDefaultTreeId();
  const owner = await prisma.treeMember.findFirst({ where: { treeId, role: "OWNER" } });
  cachedUserId = owner?.userId ?? null;
  return cachedUserId;
}

export async function logChange(params: {
  action: string;
  entityType: string;
  entityId: string;
  summary?: string;
}): Promise<void> {
  const treeId = await getDefaultTreeId();
  const userId = await getDefaultUserId();
  await prisma.changeLogEntry.create({
    data: {
      treeId,
      userId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      summary: params.summary,
    },
  });
}
