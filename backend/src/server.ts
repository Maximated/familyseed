import Fastify from "fastify";
import cors from "@fastify/cors";
import individualRoutes from "./routes/individuals.js";
import familyRoutes from "./routes/families.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(individualRoutes, { prefix: "/individuals" });
await app.register(familyRoutes, { prefix: "/families" });

app.get("/health", async () => ({ status: "ok" }));

const port = Number(process.env.PORT ?? 3001);

app.listen({ port, host: "0.0.0.0" }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
