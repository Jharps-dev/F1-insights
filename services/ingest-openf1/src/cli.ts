#!/usr/bin/env node
/**
 * OpenF1 Import CLI
 * Example: npx tsx services/ingest-openf1/src/cli.ts --session 9159 --output ./data
 */

import fs from "fs/promises";
import path from "path";
import type { SessionManifest } from "@f1-insights/schemas";
import { backfillOpenF1Manifests, importOpenF1Session, listOpenF1Sessions, type ImportProfile } from "./importer";
import { mirrorSessionManifestAssets } from "./assets";

function getArgValue(args: string[], key: string): string | undefined {
  const idx = args.indexOf(key);
  if (idx === -1 || idx + 1 >= args.length) {
    return undefined;
  }
  return args[idx + 1];
}

function parseProfile(value: string | undefined): ImportProfile {
  if (!value) {
    return "standard";
  }
  if (value === "lite" || value === "standard" || value === "full") {
    return value;
  }
  throw new Error(`Invalid profile '${value}'. Use lite|standard|full.`);
}

function normalizeSessionType(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "practice") return "Practice";
  if (trimmed === "qualifying") return "Qualifying";
  if (trimmed === "race") return "Race";
  if (trimmed === "sprint") return "Sprint";
  return raw.trim();
}

async function writeImportedSession(outputDir: string, sessionKey: number, events: unknown[], manifest: unknown) {
  const eventsPath = path.join(outputDir, `events_${sessionKey}.jsonl`);
  const eventsJsonl = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  await fs.writeFile(eventsPath, eventsJsonl, "utf8");

  const mirroredManifest = await mirrorSessionManifestAssets(manifest as SessionManifest, outputDir);
  const manifestPath = path.join(outputDir, `manifest_${sessionKey}.json`);
  await fs.writeFile(manifestPath, JSON.stringify(mirroredManifest, null, 2), "utf8");

  return { eventsPath, manifestPath };
}

async function main() {
  const args = process.argv.slice(2);
  const sessionRaw = getArgValue(args, "--session");
  const yearRaw = getArgValue(args, "--year");
  const outputDir = getArgValue(args, "--output") || "./data";
  const profile = parseProfile(getArgValue(args, "--profile"));
  const typesRaw = getArgValue(args, "--types") || "Practice,Qualifying,Race,Sprint";
  const backfillManifests = args.includes("--backfill-manifests");
  const force = args.includes("--force");

  if (!sessionRaw && !yearRaw && !backfillManifests) {
    console.error("Usage:");
    console.error("  npx tsx cli.ts --session <sessionKey> [--output <dir>] [--profile lite|standard|full]");
    console.error("  npx tsx cli.ts --year <year> [--types Race,Qualifying,Sprint] [--output <dir>] [--profile lite|standard|full]");
    console.error("  npx tsx cli.ts --backfill-manifests [--output <dir>] [--force]");
    process.exit(1);
  }

  try {
    // Ensure output directory exists
    await fs.mkdir(outputDir, { recursive: true });

    if (backfillManifests) {
      const sessionKeys = sessionRaw ? [parseInt(sessionRaw, 10)] : undefined;
      const result = await backfillOpenF1Manifests(outputDir, { force, sessionKeys });
      console.log(`\n✓ Manifest backfill complete`);
      console.log(`  Updated: ${result.updated}`);
      console.log(`  Skipped: ${result.skipped}`);
      console.log(`  Failed: ${result.failed}`);
      return;
    }

    if (sessionRaw) {
      const sessionKey = parseInt(sessionRaw, 10);
      if (!sessionKey || isNaN(sessionKey)) {
        throw new Error("Invalid session key");
      }

      const { events, manifest } = await importOpenF1Session(sessionKey, { profile });
      const { eventsPath, manifestPath } = await writeImportedSession(outputDir, sessionKey, events, manifest);

      console.log(`\n✓ Session ${sessionKey} imported successfully!`);
      console.log(`  Profile: ${profile}`);
      console.log(`  Events: ${eventsPath} (${events.length} events)`);
      console.log(`  Manifest: ${manifestPath}`);
      return;
    }

    const year = parseInt(yearRaw || "", 10);
    if (!year || isNaN(year)) {
      throw new Error("Invalid year");
    }

    const allowedTypes = new Set(typesRaw.split(",").map((t) => normalizeSessionType(t)).filter(Boolean));
    const sessions = await listOpenF1Sessions(year);
    const filtered = sessions
      .filter((s) => allowedTypes.has(normalizeSessionType(String(s.session_type || ""))))
      .sort((a, b) => {
        const da = new Date(String(a.date_start || "")).getTime();
        const db = new Date(String(b.date_start || "")).getTime();
        return da - db;
      });

    console.log(`\n[IMPORT] Year ${year}`);
    console.log(`  Profile: ${profile}`);
    console.log(`  Session types: ${Array.from(allowedTypes).join(", ")}`);
    console.log(`  Matched sessions: ${filtered.length}`);

    let ok = 0;
    let failed = 0;
    for (const session of filtered) {
      const sessionKey = Number(session.session_key);
      if (!sessionKey) {
        continue;
      }

      try {
        const { events, manifest } = await importOpenF1Session(sessionKey, { profile });
        await writeImportedSession(outputDir, sessionKey, events, manifest);
        ok += 1;
      } catch (err) {
        failed += 1;
        console.error(`[IMPORT] Failed session ${sessionKey}:`, err);
      }
    }

    console.log(`\n✓ Year import complete`);
    console.log(`  Imported: ${ok}`);
    console.log(`  Failed: ${failed}`);
  } catch (err) {
    console.error(`Failed to import session: ${err}`);
    process.exit(1);
  }
}

main();
