import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

const HTTP_BASE = process.env.DEV_HTTP_BASE || "http://localhost:3000";
const HEALTH_PATH = process.env.DEV_HEALTH_PATH || "/health";
const SERVER_START_TIMEOUT_MS = parsePositiveInt(process.env.DEV_SERVER_START_TIMEOUT_MS, 60000);
const HEALTH_POLL_MS = parsePositiveInt(process.env.DEV_HEALTH_POLL_MS, 500);
const HEALTH_PROBE_TIMEOUT_MS = parsePositiveInt(process.env.DEV_HEALTH_PROBE_TIMEOUT_MS, 1500);

function parsePositiveInt(rawValue, fallback) {
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function isWindows() {
  return process.platform === "win32";
}

function nodeCommand() {
  const localNode = path.join(repoRoot, ".tools", "node", isWindows() ? "node.exe" : "node");
  return fs.existsSync(localNode) ? localNode : "node";
}

async function isHealthyNow() {
  const url = `${HTTP_BASE}${HEALTH_PATH}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HEALTH_PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      return false;
    }
    const body = await response.json().catch(() => null);
    return !body || body.status === "ok";
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function waitForHealth() {
  const start = Date.now();
  while (Date.now() - start < SERVER_START_TIMEOUT_MS) {
    if (await isHealthyNow()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_MS));
  }
  throw new Error(`Timed out waiting for API gateway health at ${HTTP_BASE}${HEALTH_PATH}`);
}

function killProcessTree(child) {
  if (!child || child.killed) {
    return;
  }

  if (isWindows()) {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      shell: false,
    });
    killer.once("error", () => {
      child.kill("SIGTERM");
    });
    return;
  }

  child.kill("SIGTERM");
}

async function main() {
  const node = nodeCommand();
  const useExistingGateway = await isHealthyNow();
  let server = null;

  if (!useExistingGateway) {
    server = spawn(node, [path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs"), path.join(repoRoot, "services", "api-gateway", "src", "server.ts")], {
      stdio: "inherit",
      shell: false,
      env: { ...process.env },
    });

    let serverSpawnError = null;
    let serverExitedEarly = false;
    server.once("error", (err) => {
      serverSpawnError = err;
    });
    server.once("exit", () => {
      serverExitedEarly = true;
    });

    await waitForHealth();

    if (serverSpawnError) {
      throw serverSpawnError;
    }

    if (serverExitedEarly) {
      throw new Error("API gateway exited before the web app could start");
    }
  }

  const web = spawn(node, [path.join(repoRoot, "apps", "web", "node_modules", "vite", "bin", "vite.js")], {
    stdio: "inherit",
    shell: false,
    cwd: path.join(repoRoot, "apps", "web"),
    env: { ...process.env },
  });

  const shutdown = () => {
    killProcessTree(web);
    if (!useExistingGateway) {
      killProcessTree(server);
    }
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  await new Promise((resolve, reject) => {
    web.once("error", reject);
    web.once("exit", (code, signal) => {
      if (code === 0 || signal === "SIGTERM") {
        resolve();
      } else {
        reject(new Error(`Web dev server exited unexpectedly (code=${code}, signal=${signal || "none"})`));
      }
    });
  });

  if (!useExistingGateway) {
    killProcessTree(server);
  }
}

main().catch((err) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      null,
      2
    )
  );
  process.exit(1);
});