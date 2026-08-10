import { mkdir } from "node:fs/promises";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import individualRoutes from "./routes/individuals.js";
import familyRoutes from "./routes/families.js";
import treeRoutes from "./routes/tree.js";
import lineageRoutes from "./routes/lineages.js";
import meRoutes from "./routes/me.js";
import gedcomRoutes from "./routes/gedcom.js";
import { uploadsRoot } from "./uploads.js";

const app = Fastify({ logger: true });

await mkdir(uploadsRoot(), { recursive: true });

await app.register(cors, { origin: true });
await app.register(multipart, { limits: { fileSize: 15 * 1024 * 1024 } });
await app.register(fastifyStatic, { root: uploadsRoot(), prefix: "/uploads/", decorateReply: false });
await app.register(individualRoutes, { prefix: "/individuals" });
await app.register(familyRoutes, { prefix: "/families" });
await app.register(treeRoutes, { prefix: "/tree" });
await app.register(lineageRoutes, { prefix: "/lineages" });
await app.register(meRoutes, { prefix: "/me" });
await app.register(gedcomRoutes, { prefix: "/gedcom" });

app.get("/health", async () => ({ status: "ok" }));

const port = Number(process.env.PORT ?? 3001);

app.listen({ port, host: "0.0.0.0" }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
