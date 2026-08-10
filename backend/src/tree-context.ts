import { prisma } from "./db.js";

// treeId/userId are now resolved per-request (auth cookie -> request.userId,
// the /trees/:treeId membership preHandler -> request.treeId) instead of
// through a single process-lifetime default — see routes/auth.ts and the
// treeScopedRoutes plugin in server.ts.
export async function logChange(params: {
  treeId: string;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  summary?: string;
}): Promise<void> {
  await prisma.changeLogEntry.create({
    data: {
      treeId: params.treeId,
      userId: params.userId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      summary: params.summary,
    },
  });
}
