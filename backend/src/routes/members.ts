import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "../db.js";
import { HttpError } from "../http-error.js";
import { logChange } from "../tree-context.js";

const SHARE_ROLE_VALUES = ["EDITOR", "VIEWER"] as const;

const addMemberBodySchema = {
  type: "object",
  required: ["email", "role"],
  properties: {
    email: { type: "string", format: "email" },
    role: { type: "string", enum: SHARE_ROLE_VALUES },
  },
  additionalProperties: false,
};

type AddMemberBody = {
  email: string;
  role: (typeof SHARE_ROLE_VALUES)[number];
};

const updateMemberBodySchema = {
  type: "object",
  required: ["role"],
  properties: {
    role: { type: "string", enum: SHARE_ROLE_VALUES },
  },
  additionalProperties: false,
};

type UpdateMemberBody = {
  role: (typeof SHARE_ROLE_VALUES)[number];
};

// Only the tree's owner can decide who else gets in — an editor granting
// themselves or a friend more access (or revoking the owner) would be an
// odd thing for a "can edit content" permission to also imply. Exported
// for reuse by invite-links.ts, the other "who gets into this tree" route.
export function requireOwner(request: FastifyRequest) {
  if (request.treeRole !== "OWNER") {
    throw new HttpError(403, "Solo el propietario del árbol puede gestionar quién tiene acceso");
  }
}

export default async function memberRoutes(fastify: FastifyInstance) {
  fastify.get("/", async (request) => {
    const treeId = request.treeId!;
    const members = await prisma.treeMember.findMany({
      where: { treeId },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    });
    return members.map((m) => ({ userId: m.userId, email: m.user.email, name: m.user.name, role: m.role }));
  });

  // Adds an *existing* account by email — there's no invitation/mail system
  // here, so sharing means "this person already has an account and you're
  // granting it access," not "send them a link to sign up."
  fastify.post("/", { schema: { body: addMemberBodySchema } }, async (request, reply) => {
    const treeId = request.treeId!;
    try {
      requireOwner(request);
      const { email, role } = request.body as AddMemberBody;

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        throw new HttpError(404, "No hay ninguna cuenta registrada con ese email todavía");
      }

      const existing = await prisma.treeMember.findUnique({ where: { treeId_userId: { treeId, userId: user.id } } });
      if (existing) {
        throw new HttpError(400, "Esa persona ya tiene acceso a este árbol");
      }

      const member = await prisma.treeMember.create({ data: { treeId, userId: user.id, role } });
      await logChange({
        treeId,
        userId: request.userId ?? null,
        action: "tree.addMember",
        entityType: "TreeMember",
        entityId: member.id,
        summary: `${email} (${role})`,
      });

      return reply.code(201).send({ userId: user.id, email: user.email, name: user.name, role: member.role });
    } catch (error) {
      if (error instanceof HttpError) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      throw error;
    }
  });

  fastify.patch("/:userId", { schema: { body: updateMemberBodySchema } }, async (request, reply) => {
    const treeId = request.treeId!;
    try {
      requireOwner(request);
      const { userId } = request.params as { userId: string };
      const { role } = request.body as UpdateMemberBody;

      const existing = await prisma.treeMember.findUnique({ where: { treeId_userId: { treeId, userId } } });
      if (!existing) {
        throw new HttpError(404, "Esa persona no tiene acceso a este árbol");
      }
      if (existing.role === "OWNER") {
        throw new HttpError(400, "No se puede cambiar el rol del propietario");
      }

      const updated = await prisma.treeMember.update({ where: { id: existing.id }, data: { role } });
      return reply.send({ userId, role: updated.role });
    } catch (error) {
      if (error instanceof HttpError) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      throw error;
    }
  });

  fastify.delete("/:userId", async (request, reply) => {
    const treeId = request.treeId!;
    try {
      requireOwner(request);
      const { userId } = request.params as { userId: string };

      const existing = await prisma.treeMember.findUnique({ where: { treeId_userId: { treeId, userId } } });
      if (!existing) {
        throw new HttpError(404, "Esa persona no tiene acceso a este árbol");
      }
      if (existing.role === "OWNER") {
        throw new HttpError(400, "No se puede quitar al propietario del árbol");
      }

      await prisma.treeMember.delete({ where: { id: existing.id } });
      await logChange({
        treeId,
        userId: request.userId ?? null,
        action: "tree.removeMember",
        entityType: "TreeMember",
        entityId: existing.id,
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
