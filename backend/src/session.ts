import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "./db.js";

export const SESSION_COOKIE = "session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

// The cookie holds this session's own id (signed), not the userId
// directly — see the Session model's schema comment for why: it's what
// makes logout, or revoking one specific device, actually take effect
// immediately, instead of a signed cookie just staying valid on its own
// for the rest of its 30-day life regardless of what the server does.
export async function startSession(reply: FastifyReply, userId: string): Promise<void> {
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  const session = await prisma.session.create({ data: { userId, expiresAt } });
  reply.setCookie(SESSION_COOKIE, session.id, {
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

// Every authenticated route uses this — reads the signed session cookie,
// looks the session up, 401s if it's missing, tampered with, or expired,
// and decorates request.userId/sessionId for downstream handlers.
export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const raw = request.cookies[SESSION_COOKIE];
  const unsigned = raw ? request.unsignCookie(raw) : null;
  if (!unsigned?.valid || !unsigned.value) {
    return reply.code(401).send({ error: "No has iniciado sesión" });
  }

  const session = await prisma.session.findUnique({ where: { id: unsigned.value } });
  if (!session || session.expiresAt < new Date()) {
    return reply.code(401).send({ error: "No has iniciado sesión" });
  }

  request.userId = session.userId;
  request.sessionId = session.id;
}

// Same lookup as requireAuth, but returns null instead of 401ing — for a
// route that behaves differently for a logged-out visitor rather than just
// rejecting them outright (e.g. redeeming an invite link: a logged-out
// visitor gets told to log in first, not a bare 401).
export async function resolveOptionalUserId(request: FastifyRequest): Promise<string | null> {
  const raw = request.cookies[SESSION_COOKIE];
  const unsigned = raw ? request.unsignCookie(raw) : null;
  if (!unsigned?.valid || !unsigned.value) return null;

  const session = await prisma.session.findUnique({ where: { id: unsigned.value } });
  if (!session || session.expiresAt < new Date()) return null;

  return session.userId;
}

// Deletes the session row (not just the client-side cookie) so a copy of
// the cookie made before logout — already sent somewhere, cached, etc. —
// stops working immediately rather than staying valid until it expires.
// Reads the cookie itself (rather than requiring `requireAuth` to have
// run first) so logout always succeeds and clears the cookie even for an
// already-expired or otherwise-invalid session.
export async function endSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const raw = request.cookies[SESSION_COOKIE];
  const unsigned = raw ? request.unsignCookie(raw) : null;
  if (unsigned?.valid && unsigned.value) {
    await prisma.session.delete({ where: { id: unsigned.value } }).catch(() => {
      // Already gone (expired cleanup, double logout) — fine, the cookie
      // still gets cleared below either way.
    });
  }
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}
