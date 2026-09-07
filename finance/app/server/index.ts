import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { authFromEnv, mayBindPublic } from "./auth.ts";
import { maybeBackupOnStart } from "./db/backup.ts";
import { openDatabase } from "./db/client.ts";
import { defaultBackupDir } from "./db/paths.ts";
import { ensureCatalog } from "./db/seed.ts";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";
const serveUi =
  process.env.SERVE_UI === "1" || process.env.NODE_ENV === "production";
const auth = authFromEnv();

if (!mayBindPublic(host, auth)) {
  console.error(
    `Refusing to bind ${host} without Tailscale auth. Set FINANCE_TAILNET_USER, FINANCE_REQUIRE_TAILSCALE=1, or FINANCE_ALLOW_UNAUTH=1.`,
  );
  process.exit(1);
}

const opened = openDatabase();
ensureCatalog(opened.db);
const backupFile = maybeBackupOnStart(opened, defaultBackupDir());
if (backupFile) {
  console.log(`backup ${backupFile}`);
}

const app = createApp({ ...opened, serveUi, auth });

serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  console.log(`Finance OS API http://${info.address}:${info.port}`);
});
