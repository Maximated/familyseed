import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { HttpError } from "../http-error.js";
import { logChange } from "../tree-context.js";
import { requireOwner } from "./members.js";

const SHARE_ROLE_VALUES = ["EDITOR", "VIEWER"] as const;

const createInviteLinkBodySchema = {
  type: "object",
  required: ["role"],
  properties: {
    role: { type: "string", enum: SHARE_ROLE_VALUES },
    expiresAt: { type: "string", format: "date-time" },
    maxUses: { type: "integer", minimum: 1 },
  },
  additionalProperties: false,
};

type CreateInviteLinkBody = {
  role: (typeof SHARE_ROLE_VALUES)[number];
  expiresAt?: string;
  maxUses?: number;
};

// Owner-facing CRUD for a tree's invite links — mounted under
// /trees/:treeId/invite-links, so it inherits requireAuth +
// requireTreeMembership from the parent treeScopedRoutes plugin. The
// public "peek + redeem" side lives in invite-redeem.ts instead, since
// that one can't require tree membership (the whole point is granting it).
export default async function inviteLinkRoutes(fastify: FastifyInstance) {
  fastify.get("/", async (request) => {
    const treeId = request.treeId!;
    requireOwner(request);
    const links = await prisma.treeInviteLink.findMany({
      where: { treeId },
      include: { _count: { select: { redemptions: true } } },
      orderBy: { createdAt: "desc" },
    });
    return links.map((link) => ({
      id: link.id,
      role: link.role,
      createdAt: link.createdAt,
      expiresAt: link.expiresAt,
      revokedAt: link.revokedAt,
      maxUses: link.maxUses,
      useCount: link._count.redemptions,
    }));
  });

  fastify.post("/", { schema: { body: createInviteLinkBodySchema } }, async (request, reply) => {
    const treeId = request.treeId!;
    try {
      requireOwner(request);
      const { role, expiresAt, maxUses } = request.body as CreateInviteLinkBody;

      const link = await prisma.treeInviteLink.create({
        data: {
          treeId,
          role,
          expiresAt: expiresAt ? new Date(expiresAt) : null,
          maxUses: maxUses ?? null,
          createdByUserId: request.userId ?? null,
        },
      });
      await logChange({
        treeId,
        userId: request.userId ?? null,
        action: "tree.createInviteLink",
        entityType: "TreeInviteLink",
        entityId: link.id,
        summary: `role=${role}`,
      });

      return reply.code(201).send({
        id: link.id,
        role: link.role,
        createdAt: link.createdAt,
        expiresAt: link.expiresAt,
        revokedAt: link.revokedAt,
        maxUses: link.maxUses,
        useCount: 0,
      });
    } catch (error) {
      if (error instanceof HttpError) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      throw error;
    }
  });

  fastify.delete("/:id", async (request, reply) => {
    const treeId = request.treeId!;
    try {
      requireOwner(request);
      const { id } = request.params as { id: string };

      const existing = await prisma.treeInviteLink.findFirst({ where: { id, treeId } });
      if (!existing) {
        throw new HttpError(404, `No existe el enlace ${id}`);
      }
      if (existing.revokedAt) {
        throw new HttpError(400, "Ese enlace ya estaba revocado");
      }

      await prisma.treeInviteLink.update({ where: { id }, data: { revokedAt: new Date() } });
      await logChange({
        treeId,
        userId: request.userId ?? null,
        action: "tree.revokeInviteLink",
        entityType: "TreeInviteLink",
        entityId: id,
      });

      return reply.code(204).send();
    } catch (error) {
      if (error instanceof HttpError) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      throw error;
    }
  });
}
