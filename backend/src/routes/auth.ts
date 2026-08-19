import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { hashPassword, verifyPassword } from "../auth.js";
import { googleOAuthEnabled } from "./google-oauth.js";
import { endSession, requireAuth, startSession } from "../session.js";

// Re-exported so every other route file's `import { requireAuth } from
// "./auth.js"` keeps working — the actual session logic (and the
// signed-cookie ↔ Session-row lookup it depends on) lives in session.ts,
// shared with google-oauth.ts instead of each duplicating it.
export { requireAuth };

const registerBodySchema = {
  type: "object",
  required: ["email", "password"],
  properties: {
    email: { type: "string", format: "email" },
    password: { type: "string", minLength: 8 },
    name: { type: "string" },
  },
  additionalProperties: false,
};

const loginBodySchema = {
  type: "object",
  required: ["email", "password"],
  properties: {
    email: { type: "string" },
    password: { type: "string" },
  },
  additionalProperties: false,
};

function publicUser(user: { id: string; email: string | null; name: string | null }) {
  return { id: user.id, email: user.email, name: user.name };
}

export default async function authRoutes(fastify: FastifyInstance) {
  // Lets the frontend decide whether to render "Sign in with Google" at
  // all — self-hosted installs with no Google Cloud project configured
  // simply get googleEnabled: false.
  fastify.get("/config", async () => ({ googleEnabled: googleOAuthEnabled() }));

  fastify.post(
    "/register",
    { schema: { body: registerBodySchema }, config: { rateLimit: { max: 5, timeWindow: "1 hour" } } },
    async (request, reply) => {
      const { email, password, name } = request.body as { email: string; password: string; name?: string };

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        return reply.code(409).send({ error: "Ya existe una cuenta con ese email" });
      }

      const passwordHash = await hashPassword(password);
      const user = await prisma.user.create({ data: { email, name, passwordHash } });

      await startSession(reply, user.id);
      return reply.code(201).send(publicUser(user));
    },
  );

  fastify.post(
    "/login",
    // Generous enough for a mistyped password, tight enough to make
    // credential-stuffing / brute-forcing impractical.
    { schema: { body: loginBodySchema }, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { email, password } = request.body as { email: string; password: string };

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
        return reply.code(401).send({ error: "Email o contraseña incorrectos" });
      }

      await startSession(reply, user.id);
      return publicUser(user);
    },
  );

  fastify.post("/logout", async (request, reply) => {
    await endSession(request, reply);
    return reply.code(204).send();
  });

  fastify.get("/me", { preHandler: requireAuth }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.userId } });
    if (!user) {
      return reply.code(401).send({ error: "No has iniciado sesión" });
    }
    return publicUser(user);
  });
}
