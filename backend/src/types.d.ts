import "fastify";

// Set by requireAuth (routes/auth.ts) and, from phase 2 onward, by the
// /trees/:treeId membership preHandler.
declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
    treeId?: string;
    treeRole?: "OWNER" | "EDITOR" | "VIEWER";
  }
}
