import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../db.js";
import { hashPassword, verifyPassword } from "../auth.js";
import { googleOAuthEnabled } from "./google-oauth.js";

const SESSION_COOKIE = "session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

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

function setSessionCookie(reply: FastifyReply, userId: string) {
  reply.setCookie(SESSION_COOKIE, userId, {
    httpOnly: true,
    // Dev serves the frontend over plain http://localhost, where a
    // secure-only cookie would never come back — production (behind the
    // real domain) is always https, per APP_ORIGIN.
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
    signed: true,
  });
}

function publicUser(user: { id: string; email: string | null; name: string | null }) {
  return { id: user.id, email: user.email, name: user.name };
}

// Every tree-scoped route (from phase 2 onward) and GET /auth/me itself
// use this — reads the signed session cookie, decorates `request.userId`,
// 401s otherwise. Exported so other route files can attach it too.
export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const raw = request.cookies[SESSION_COOKIE];
  const unsigned = raw ? request.unsignCookie(raw) : null;
  if (!unsigned?.valid || !unsigned.value) {
    return reply.code(401).send({ error: "No has iniciado sesión" });
  }
  request.userId = unsigned.value;
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

      setSessionCookie(reply, user.id);
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

      setSessionCookie(reply, user.id);
      return publicUser(user);
    },
  );

  fastify.post("/logout", async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
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
