import type { FastifyInstance } from "fastify";
import { findIntegrityIssues } from "../tree-integrity.js";

// Read-only diagnostic, surfaced in the app's own "Estadísticas y gestión"
// panel — see tree-integrity.ts for why this never auto-fixes anything.
export default async function integrityRoutes(fastify: FastifyInstance) {
  fastify.get("/integrity-issues", async (request) => {
    const treeId = request.treeId!;
    return findIntegrityIssues(treeId);
  });
}
