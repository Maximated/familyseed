import type { FastifyInstance } from "fastify";
import fastifyOauth2 from "@fastify/oauth2";
import { prisma } from "../db.js";

const SESSION_COOKIE = "session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days, same as email/password login

export function googleOAuthEnabled(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

// Registered under the /auth prefix, alongside — not inside — auth.ts's
// email/password routes, so "Sign in with Google" is entirely opt-in: a
// self-hosted install with no GOOGLE_CLIENT_ID/SECRET set just never
// registers these routes, and GET /auth/config tells the frontend not to
// render the button at all.
export default async function googleOAuthRoutes(fastify: FastifyInstance) {
  if (!googleOAuthEnabled()) return;

  // The origin this backend itself is reachable at — must exactly match
  // what's configured as the redirect URI in the Google Cloud OAuth
  // client, since Google rejects a callback to anywhere else.
  const appOrigin = process.env.APP_ORIGIN ?? "http://localhost:3001";

  // GOOGLE_CONFIGURATION is a runtime property on the plugin function
  // (see the package's own JS examples) that its `export =` typings don't
  // expose on the default import — cast just for this one access.
  const googleConfiguration = (fastifyOauth2 as unknown as { GOOGLE_CONFIGURATION: fastifyOauth2.ProviderConfiguration })
    .GOOGLE_CONFIGURATION;

  await fastify.register(fastifyOauth2, {
    name: "googleOAuth2",
    scope: ["profile", "email"],
    credentials: {
      client: {
        id: process.env.GOOGLE_CLIENT_ID!,
        secret: process.env.GOOGLE_CLIENT_SECRET!,
      },
      auth: googleConfiguration,
    },
    startRedirectPath: "/google",
    callbackUri: `${appOrigin}/auth/google/callback`,
  });

  fastify.get("/google/callback", async (request, reply) => {
    // Where the browser ends up after login — the frontend's own origin.
    // Defaults to "/" (same-origin, correct for the combined production
    // image); dev overrides it to the Vite server since frontend/backend
    // run on different ports there.
    const successRedirect = process.env.OAUTH_SUCCESS_REDIRECT ?? "/";
    const errorRedirect = process.env.OAUTH_ERROR_REDIRECT ?? "/login?error=google";

    let accessToken: string;
    try {
      const token = await fastify.googleOAuth2!.getAccessTokenFromAuthorizationCodeFlow(request);
      accessToken = token.token.access_token;
    } catch (error) {
      request.log.error(error);
      return reply.redirect(errorRedirect);
    }

    const userinfoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!userinfoRes.ok) {
      request.log.error(`Google userinfo request failed: ${userinfoRes.status}`);
      return reply.redirect(errorRedirect);
    }
    const profile = (await userinfoRes.json()) as { sub: string; email?: string; name?: string };

    // Returning Google user first; then an existing email/password account
    // with the same address gets Google linked onto it (so "forgot my
    // password" can also just mean "log in with Google instead" for
    // anyone who registered with a matching email); otherwise a fresh
    // account is created — same self-service behavior as /auth/register,
    // just without a password.
    let user = await prisma.user.findUnique({ where: { googleId: profile.sub } });
    if (!user && profile.email) {
      const byEmail = await prisma.user.findUnique({ where: { email: profile.email } });
      if (byEmail) {
        user = await prisma.user.update({ where: { id: byEmail.id }, data: { googleId: profile.sub } });
      }
    }
    if (!user) {
      user = await prisma.user.create({
        data: { googleId: profile.sub, email: profile.email ?? null, name: profile.name ?? null },
      });
    }

    reply.setCookie(SESSION_COOKIE, user.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
      signed: true,
    });
    return reply.redirect(successRedirect);
  });
}
