import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import individualRoutes from "./routes/individuals.js";
import familyRoutes from "./routes/families.js";
import treeRoutes from "./routes/tree.js";
import lineageRoutes from "./routes/lineages.js";
import memberRoutes from "./routes/members.js";
import duplicateRoutes from "./routes/duplicates.js";
import gedcomRoutes from "./routes/gedcom.js";
import csvRoutes from "./routes/csv.js";
import treesRoutes from "./routes/trees.js";
import copyRoutes from "./routes/copy.js";
import authRoutes, { requireAuth } from "./routes/auth.js";
import googleOAuthRoutes from "./routes/google-oauth.js";
import { requireTreeMembership } from "./tree-membership.js";
import { uploadsRoot } from "./uploads.js";

const app = Fastify({ logger: true });

await mkdir(uploadsRoot(), { recursive: true });

// `credentials: true` (not `origin: "*"`-compatible) so the browser will
// actually send/accept the signed session cookie cross-origin in dev
// (frontend :5173 -> backend :3001).
await app.register(cors, { origin: true, credentials: true });
await app.register(cookie, {
  secret: process.env.COOKIE_SECRET ?? "dev-only-insecure-secret-change-me",
  hook: "onRequest",
});
await app.register(multipart, { limits: { fileSize: 15 * 1024 * 1024 } });
await app.register(fastifyStatic, { root: uploadsRoot(), prefix: "/uploads/", decorateReply: false });

await app.register(authRoutes, { prefix: "/auth" });
await app.register(googleOAuthRoutes, { prefix: "/auth" });
await app.register(treesRoutes, { prefix: "/trees" });
// Top-level (not nested under /trees/:treeId) — copying spans a source and
// a destination tree at once, so it does its own dual-membership check.
await app.register(copyRoutes, { prefix: "/individuals" });

// Everything genealogical lives under /trees/:treeId — one preHandler here
// resolves+validates the caller's membership on that specific tree once,
// instead of every nested route re-deriving "the tree" itself.
async function treeScopedRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", requireAuth);
  fastify.addHook("preHandler", requireTreeMembership);

  await fastify.register(treeRoutes);
  await fastify.register(individualRoutes, { prefix: "/individuals" });
  await fastify.register(familyRoutes, { prefix: "/families" });
  await fastify.register(lineageRoutes, { prefix: "/lineages" });
  await fastify.register(memberRoutes, { prefix: "/members" });
  await fastify.register(duplicateRoutes, { prefix: "/duplicates" });
  await fastify.register(gedcomRoutes, { prefix: "/gedcom" });
  await fastify.register(csvRoutes, { prefix: "/csv" });
}

await app.register(treeScopedRoutes, { prefix: "/trees/:treeId" });

app.get("/health", async () => ({ status: "ok" }));

// Only present in the Docker image (see the root Dockerfile, which builds
// the frontend and copies its dist/ in here as ./public) — local dev keeps
// running the frontend separately through the Vite dev server on :5173, so
// this whole block is a no-op there. Registered last: every API route
// above already claimed its own path, so this only ever catches a genuine
// frontend route (e.g. /login, /tree/:id) and serves it index.html for
// React Router to take over client-side.
const frontendDist = path.resolve(process.cwd(), "public");
if (existsSync(frontendDist)) {
  await app.register(fastifyStatic, { root: frontendDist, prefix: "/" });
  app.setNotFoundHandler((request, reply) => {
    if (request.method !== "GET") {
      return reply.code(404).send({ error: "Not found" });
    }
    return reply.sendFile("index.html");
  });
}

const port = Number(process.env.PORT ?? 3001);

app.listen({ port, host: "0.0.0.0" }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
