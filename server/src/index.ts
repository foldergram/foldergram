/*
    Foldergram - Local-only photo and video gallery
    Copyright (C) 2026 Sajjad Ali

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { createServer } from "node:http";

import { appConfig } from "./config/env.js";
import { createApp } from "./app.js";
import { collectionRepository } from "./db/repositories.js";
import { deletionJobService } from "./services/deletion-job-service.js";
import { log } from "./services/log-service.js";
import { permanentDeletionService } from "./services/permanent-deletion-service.js";
import { scannerService } from "./services/scanner-service.js";
import { watcherService } from "./services/watcher-service.js";

function logServerReady(): void {
  if (!appConfig.isDevelopment) {
    log.info(`HTTP server listening on http://localhost:${appConfig.port}`);
    return;
  }

  const firstClientPort = appConfig.devClientPorts[0] ?? appConfig.devClientPort;
  const lastClientPort = appConfig.devClientPorts.at(-1) ?? appConfig.devClientPort;
  const clientPortRange =
    firstClientPort === lastClientPort ? String(firstClientPort) : `${firstClientPort}-${lastClientPort}`;

  log.table(
    "Development server ready",
    [
      ["API", `http://localhost:${appConfig.port}`],
      ["Health", `http://localhost:${appConfig.port}/api/health`],
      ["Client ports", clientPortRange]
    ],
    "success"
  );
}

async function bootstrap(): Promise<void> {
  await permanentDeletionService.recoverPendingDeletions();
  // A batch deletion that was interrupted by a restart continues on its own.
  deletionJobService.resumePendingJob();
  const app = createApp();
  const server = createServer(app);
  const portVariableName = appConfig.nodeEnv === "production" ? "SERVER_PORT" : "DEV_SERVER_PORT";
  collectionRepository.ensureDefaultCollection();
  const repairedCollectionMemberships = collectionRepository.repairDefaultMemberships();
  if (repairedCollectionMemberships > 0) {
    log.info(`Repaired ${repairedCollectionMemberships} saved collection memberships`);
  }

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      log.error(
        `Port ${appConfig.port} is already in use`,
        `Another server is already listening on that port. Stop it first or change ${portVariableName} for this runtime.`,
      );
    } else {
      log.error("HTTP server failed to start", error.message);
    }

    process.exitCode = 1;
  });

  server.listen(appConfig.port, () => {
    logServerReady();
    const startupAction = scannerService.handleStartup("startup");
    if (startupAction === "blocked") {
      log.info("Gallery watcher deferred until the library rebuild completes");
      return;
    }

    void watcherService.start().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      log.error("Gallery watcher failed to start", message);
    });
  });

  async function shutdown(signal: string): Promise<void> {
    log.info(`Received ${signal}, shutting down`);
    await watcherService.stop();
    server.close(() => process.exit(0));
  }

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

void bootstrap().catch((error: unknown) => {
  log.error("Server startup failed", error);
  process.exitCode = 1;
});
