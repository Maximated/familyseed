import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "./db.js";

const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

function resolveMembership(request: FastifyRequest) {
  const { treeId } = request.params as { treeId: string };
  return prisma.treeMember.findUnique({
    where: { treeId_userId: { treeId, userId: request.userId! } },
  });
}

// Applied once, on the parent plugin every tree-scoped route (individuals,
// families, lineages, gedcom, the tree itself) is nested under at
// /trees/:treeId — resolves and validates membership once per request
// instead of every handler re-deriving "the tree" itself.
export async function requireTreeMembership(request: FastifyRequest, reply: FastifyReply) {
  const { treeId } = request.params as { treeId: string };
  const membership = await resolveMembership(request);

  if (!membership) {
    return reply.code(404).send({ error: `No existe el árbol ${treeId}` });
  }

  if (WRITE_METHODS.has(request.method) && membership.role === "VIEWER") {
    return reply.code(403).send({ error: "No tienes permiso de edición en este árbol" });
  }

  request.treeId = treeId;
  request.treeRole = membership.role;
}

// Same membership resolution as requireTreeMembership, minus the
// write-method/VIEWER block — for routes that write a personal preference
// rather than tree data itself (currently only "this is me", see
// routes/my-identity.ts). Any tree member, any role, may write through a
// route guarded by this.
export async function requireTreeMembershipAnyRole(request: FastifyRequest, reply: FastifyReply) {
  const { treeId } = request.params as { treeId: string };
  const membership = await resolveMembership(request);

  if (!membership) {
    return reply.code(404).send({ error: `No existe el árbol ${treeId}` });
  }

  request.treeId = treeId;
  request.treeRole = membership.role;
}
