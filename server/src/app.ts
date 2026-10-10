import { existsSync } from "node:fs";
import { join } from "node:path";
import cookieParser from "cookie-parser";
import express, { type Express } from "express";
import helmet from "helmet";
import { loadSession } from "./auth.js";
import type { Db } from "./db/index.js";
import { HttpError, errorHandler } from "./errors.js";
import { authRoutes } from "./routes/auth.js";
import { incidentRoutes } from "./routes/incidents.js";
import { insightRoutes } from "./routes/insights.js";

/** Builds the Express app around a database. Tests pass in an in-memory one. */
export function createApp(db: Db, options: { staticDir?: string } = {}): Express {
  const app = express();
  app.disable("x-powered-by");
  const production = process.env.NODE_ENV === "production";
  app.use(
    helmet({
      // HTTPS-only headers would break a plain-http local run, so they are production-only.
      hsts: production,
      contentSecurityPolicy: {
        directives: { upgradeInsecureRequests: production ? [] : null },
      },
    }),
  );
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());
  app.use(loadSession);

  app.get("/api/health", async (_req, res) => {
    await db.query("SELECT 1");
    res.json({ status: "ok" });
  });
  app.use("/api/auth", authRoutes(db));
  app.use("/api/incidents", incidentRoutes(db));
  app.use("/api", insightRoutes(db));
  app.use("/api", () => {
    throw new HttpError(404, "not_found", "No such endpoint.");
  });

  // In production the API also serves the built front end.
  const staticDir = options.staticDir;
  if (staticDir && existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get(/.*/, (_req, res) => res.sendFile(join(staticDir, "index.html")));
  }

  app.use(errorHandler);
  return app;
}
