import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { requireAuth } from "./auth.js";
import { uploadsRoot } from "../uploads.js";

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

// Account avatars, unlike tree-scoped uploads (routes/uploads.ts), aren't
// gated by requireTreeMembership — there's no tree to be a member of.
// Any logged-in user can view any other user's avatar (the same as they'd
// see it in a shared tree's member list), so plain requireAuth is enough.
export default async function userUploadsRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", requireAuth);

  fastify.get("/users/:userId/:filename", async (request, reply) => {
    const { userId, filename } = request.params as { userId: string; filename: string };

    const filePath = path.join(uploadsRoot(), "users", userId, filename);
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
