import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { requireAuth } from "./auth.js";
import { requireTreeMembership } from "../tree-membership.js";
import { uploadsRoot } from "../uploads.js";

// Covers every type the upload routes actually accept (photo: image/*,
// gallery media: image/* or application/pdf, per individuals.ts) — an
// unrecognized extension falls back to a generic download rather than a
// guess, which is also the safer default for anything unexpected.
const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};

// Photos and documents are personal — served only to someone who's
// actually a member of the tree they belong to, the same check every
// other /trees/:treeId/* route already enforces. A bare @fastify/static
// mount (the previous approach) served every file to anyone with the
// URL, logged in or not, with no way to revoke access after the fact.
export default async function uploadsRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", requireAuth);
  fastify.addHook("preHandler", requireTreeMembership);

  fastify.get("/:treeId/:individualId/:filename", async (request, reply) => {
    const { treeId, individualId, filename } = request.params as {
      treeId: string;
      individualId: string;
      filename: string;
    };

    // treeId is already verified real by requireTreeMembership above.
    // individualId/filename come straight off the URL — nothing this app
    // writes ever puts a `..` in either, but this keeps that true
    // structurally too, in case a path segment is ever crafted by hand.
    const filePath = path.join(uploadsRoot(), treeId, individualId, filename);
    if (!filePath.startsWith(uploadsRoot() + path.sep)) {
      return reply.code(404).send({ error: "Not found" });
    }

    try {
      await stat(filePath);
    } catch {
      return reply.code(404).send({ error: "Not found" });
    }

    const contentType = CONTENT_TYPES[path.extname(filename).toLowerCase()] ?? "application/octet-stream";
    reply.header("Content-Type", contentType);
    return reply.send(createReadStream(filePath));
  });
}
