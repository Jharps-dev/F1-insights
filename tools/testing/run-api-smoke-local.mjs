import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

const HTTP_BASE = process.env.SMOKE_HTTP_BASE || "http://localhost:3000";
const HEALTH_PATH = process.env.SMOKE_HEALTH_PATH || "/health";
const SERVER_START_TIMEOUT_MS = parsePositiveInt(process.env.SMOKE_SERVER_START_TIMEOUT_MS, 60000);
const HEALTH_POLL_MS = parsePositiveInt(process.env.SMOKE_HEALTH_POLL_MS, 500);
const HEALTH_PROBE_TIMEOUT_MS = parsePositiveInt(process.env.SMOKE_HEALTH_PROBE_TIMEOUT_MS, 1500);

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

function pnpmCommand() {
  const localPnpm = path.join(repoRoot, ".tools", "node", isWindows() ? "pnpm.cmd" : "pnpm");
  return fs.existsSync(localPnpm) ? localPnpm : isWindows() ? "pnpm.cmd" : "pnpm";
}

function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      shell: isWindows(),
      ...options,
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve({ code, signal });
      } else {
        reject(new Error(`Command failed: ${cmd} ${args.join(" ")} (code=${code}, signal=${signal || "none"})`));
      }
    });
  });
}

async function waitForHealth() {
  const start = Date.now();
  const url = `${HTTP_BASE}${HEALTH_PATH}`;

  while (Date.now() - start < SERVER_START_TIMEOUT_MS) {
    if (await isHealthyNow()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_MS));
  }

  throw new Error(`Timed out waiting for API gateway health at ${url}`);
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
  const pnpm = pnpmCommand();
  const useExistingGateway = await isHealthyNow();

  if (useExistingGateway) {
    await run(pnpm, [
      "--filter",
      "@f1-insights/api-gateway",
      "exec",
      "node",
      "./tools/api-ws-smoke.mjs",
    ]);
    return;
  }

  const server = spawn(
    pnpm,
    ["--filter", "@f1-insights/api-gateway", "dev"],
    {
      stdio: "inherit",
      shell: isWindows(),
      env: { ...process.env },
    }
  );

  let serverExitedEarly = false;
  let serverSpawnError = null;
  server.once("exit", () => {
    serverExitedEarly = true;
  });
  server.once("error", (err) => {
    serverSpawnError = err;
  });

  try {
    await waitForHealth();

    if (serverSpawnError) {
      throw serverSpawnError;
    }

    if (serverExitedEarly) {
      throw new Error("API gateway exited before smoke test could start");
    }

    await run(pnpm, [
      "--filter",
      "@f1-insights/api-gateway",
      "exec",
      "node",
      "./tools/api-ws-smoke.mjs",
    ]);
  } finally {
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
