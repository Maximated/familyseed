import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { resolveOptionalUserId } from "../session.js";

// Public, top-level (not nested under /trees/:treeId — the caller isn't a
// tree member yet, which is the whole point) — reachable while logged out,
// since /invite/:id must be visitable that way for the frontend to show
// "log in to accept" before redeeming. Mirrors copy.ts's precedent of a
// top-level route doing its own auth/authorization inline instead of
// inheriting a parent plugin's hooks.
export default async function inviteRedeemRoutes(fastify: FastifyInstance) {
  // Unlike requireTreeMembership's deliberate "404 for everything, member
  // or not, so as not to leak whether a tree exists" — there's no
  // membership secret to protect here, the link id itself already IS the
  // credential. Distinguishing "expired" from "never existed" tells a
  // link-holder nothing they don't already have reason to know.
  fastify.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const link = await prisma.treeInviteLink.findUnique({
      where: { id },
      include: { tree: true, _count: { select: { redemptions: true } } },
    });
    if (!link) {
      return reply.code(404).send({ error: `No existe el enlace ${id}` });
    }

    let reason: "revoked" | "expired" | "maxed_out" | undefined;
    if (link.revokedAt) reason = "revoked";
    else if (link.expiresAt && link.expiresAt < new Date()) reason = "expired";
    else if (link.maxUses !== null && link._count.redemptions >= link.maxUses) reason = "maxed_out";

    return { treeName: link.tree.name, role: link.role, valid: !reason, reason };
  });

  fastify.post("/:id/redeem", async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = await resolveOptionalUserId(request);
    if (!userId) {
      return reply.code(401).send({ error: "not_authenticated" });
    }

    const link = await prisma.treeInviteLink.findUnique({
      where: { id },
      include: { _count: { select: { redemptions: true } } },
    });
    if (!link) {
      return reply.code(404).send({ error: `No existe el enlace ${id}` });
    }
    if (link.revokedAt || (link.expiresAt && link.expiresAt < new Date())) {
      return reply.code(410).send({ error: "Este enlace ya no es válido" });
    }

    const alreadyRedeemedByMe = await prisma.treeInviteLinkRedemption.findUnique({
      where: { inviteLinkId_userId: { inviteLinkId: id, userId } },
    });
    if (!alreadyRedeemedByMe && link.maxUses !== null && link._count.redemptions >= link.maxUses) {
      return reply.code(409).send({ error: "Este enlace ya ha alcanzado su límite de usos" });
    }

    // A returning member (already has access, e.g. from a previous invite
    // or being added by email) keeps whatever role they already have —
    // redeeming a VIEWER link never downgrades an existing EDITOR/OWNER,
    // and redeeming again is otherwise a no-op besides the redemption
    // record itself.
    const existingMembership = await prisma.treeMember.findUnique({
      where: { treeId_userId: { treeId: link.treeId, userId } },
    });

    await prisma.$transaction(async (tx) => {
      if (!existingMembership) {
        await tx.treeMember.create({ data: { treeId: link.treeId, userId, role: link.role } });
      }
      await tx.treeInviteLinkRedemption.upsert({
        where: { inviteLinkId_userId: { inviteLinkId: id, userId } },
        create: { inviteLinkId: id, userId },
        update: {},
      });
    });

    return { treeId: link.treeId };
  });
}
