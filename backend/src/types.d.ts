import "fastify";
import type { OAuth2Namespace } from "@fastify/oauth2";

// Set by requireAuth (routes/auth.ts) and, from phase 2 onward, by the
// /trees/:treeId membership preHandler.
declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
    sessionId?: string;
    treeId?: string;
    treeRole?: "OWNER" | "EDITOR" | "VIEWER";
  }

  // Decorated by @fastify/oauth2 when googleOAuthRoutes registers it
  // (name: "googleOAuth2") — only present when Google OAuth is configured.
  interface FastifyInstance {
    googleOAuth2?: OAuth2Namespace;
  }
}
