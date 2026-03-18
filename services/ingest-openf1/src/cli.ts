#!/usr/bin/env node
/**
 * OpenF1 Import CLI
 * Example: npx tsx services/ingest-openf1/src/cli.ts --session 9159 --output ./data
 */

import fs from "fs/promises";
import path from "path";
import type { SessionManifest } from "@f1-insights/schemas";
import { backfillOpenF1Manifests, importOpenF1Session, listOpenF1Meetings, listOpenF1Sessions, type ImportProfile } from "./importer";
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
    return "full";
  }
  if (value === "lite" || value === "standard" || value === "full") {
    return value;
  }
  throw new Error(`Invalid profile '${value}'. Use lite|standard|full.`);
}

function normalizeSessionType(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "sprint qualifying" || trimmed === "sprint shootout") return "Sprint Qualifying";
  if (trimmed === "practice") return "Practice";
  if (trimmed === "qualifying") return "Qualifying";
  if (trimmed === "race") return "Race";
  if (trimmed === "sprint") return "Sprint";
  return raw.trim();
}

function parseYear(value: string | undefined, label: string): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = parseInt(value, 10);
  if (!parsed || Number.isNaN(parsed)) {
    throw new Error(`Invalid ${label}`);
  }
  return parsed;
}

function parseYearList(value: string | undefined): number[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((part) => parseInt(part.trim(), 10))
    .filter((year) => Number.isInteger(year) && year > 2000);
}

function collectTargetYears(options: {
  yearRaw?: string;
  yearsRaw?: string;
  fromYearRaw?: string;
  toYearRaw?: string;
}): number[] {
  const directYears = parseYearList(options.yearsRaw);
  if (directYears.length > 0) {
    return Array.from(new Set(directYears)).sort((a, b) => a - b);
  }

  const singleYear = parseYear(options.yearRaw, "year");
  if (singleYear) {
    return [singleYear];
  }

  const fromYear = parseYear(options.fromYearRaw, "from-year");
  const toYear = parseYear(options.toYearRaw, "to-year");
  if (fromYear && toYear) {
    if (fromYear > toYear) {
      throw new Error("from-year must be less than or equal to to-year");
    }
    const years: number[] = [];
    for (let year = fromYear; year <= toYear; year += 1) {
      years.push(year);
    }
    return years;
  }

  return [];
}

async function datasetExists(outputDir: string, sessionKey: number): Promise<boolean> {
  const manifestPath = path.join(outputDir, `manifest_${sessionKey}.json`);
  const eventsPath = path.join(outputDir, `events_${sessionKey}.jsonl`);
  try {
    await fs.access(manifestPath);
    await fs.access(eventsPath);
    return true;
  } catch {
    return false;
  }
}

function isFormula1Meeting(meeting: any): boolean {
  const descriptor = [meeting?.meeting_official_name, meeting?.meeting_name, meeting?.location, meeting?.country_name]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();
  return descriptor.includes("formula 1");
}

function sessionMatchesType(session: any, allowedTypes: Set<string>): boolean {
  const typeCandidates = [session?.session_name, session?.session_type]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => normalizeSessionType(value));

  return typeCandidates.some((value) => allowedTypes.has(value));
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
  const yearsRaw = getArgValue(args, "--years");
  const fromYearRaw = getArgValue(args, "--from-year");
  const toYearRaw = getArgValue(args, "--to-year");
  const outputDir = getArgValue(args, "--output") || "./data";
  const profile = parseProfile(getArgValue(args, "--profile"));
  const typesRaw = getArgValue(args, "--types") || "Practice,Qualifying,Sprint,Sprint Qualifying,Race";
  const backfillManifests = args.includes("--backfill-manifests");
  const force = args.includes("--force");
  const skipExisting = args.includes("--skip-existing");
  const allSeries = args.includes("--all-series");
  const failFast = args.includes("--fail-fast");

  const targetYears = collectTargetYears({ yearRaw, yearsRaw, fromYearRaw, toYearRaw });

  if (!sessionRaw && targetYears.length === 0 && !backfillManifests) {
    console.error("Usage:");
    console.error("  npx tsx cli.ts --session <sessionKey> [--output <dir>] [--profile lite|standard|full]");
    console.error("  npx tsx cli.ts --year <year> [--types Race,Qualifying,Sprint] [--output <dir>] [--profile lite|standard|full]");
    console.error("  npx tsx cli.ts --years 2023,2024,2025,2026 [--types ...] [--skip-existing] [--all-series] [--profile lite|standard|full]");
    console.error("  npx tsx cli.ts --from-year 2023 --to-year 2026 [--types ...] [--skip-existing] [--all-series] [--profile lite|standard|full]");
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

    const allowedTypes = new Set(typesRaw.split(",").map((t) => normalizeSessionType(t)).filter(Boolean));
    let totalImported = 0;
    let totalSkipped = 0;
    let totalFailed = 0;

    for (const year of targetYears) {
      const sessions = await listOpenF1Sessions(year);
      const f1MeetingKeys = allSeries
        ? null
        : new Set(
            (await listOpenF1Meetings(year))
              .filter((meeting) => isFormula1Meeting(meeting))
              .map((meeting) => Number(meeting.meeting_key))
              .filter((meetingKey) => Number.isInteger(meetingKey) && meetingKey > 0)
          );

      const filtered = sessions
        .filter((session) => {
          const meetingKey = Number(session.meeting_key);
          if (f1MeetingKeys && !f1MeetingKeys.has(meetingKey)) {
            return false;
          }
          return sessionMatchesType(session, allowedTypes);
        })
        .sort((a, b) => {
          const da = new Date(String(a.date_start || "")).getTime();
          const db = new Date(String(b.date_start || "")).getTime();
          return da - db;
        });

      console.log(`\n[IMPORT] Year ${year}`);
      console.log(`  Profile: ${profile}`);
      console.log(`  Session types: ${Array.from(allowedTypes).join(", ")}`);
      console.log(`  Series filter: ${allSeries ? "all series" : "Formula 1 meetings only"}`);
      console.log(`  Matched sessions: ${filtered.length}`);

      let imported = 0;
      let skipped = 0;
      let failed = 0;
      for (const session of filtered) {
        const sessionKey = Number(session.session_key);
        if (!sessionKey) {
          continue;
        }

        if (!force && skipExisting && (await datasetExists(outputDir, sessionKey))) {
          skipped += 1;
          console.log(`[IMPORT] Skipping existing session ${sessionKey}`);
          continue;
        }

        try {
          const { events, manifest } = await importOpenF1Session(sessionKey, { profile });
          await writeImportedSession(outputDir, sessionKey, events, manifest);
          imported += 1;
        } catch (err) {
          failed += 1;
          console.error(`[IMPORT] Failed session ${sessionKey}:`, err);
          if (failFast) {
            throw err;
          }
        }
      }

      totalImported += imported;
      totalSkipped += skipped;
      totalFailed += failed;

      console.log(`\n✓ Year ${year} import complete`);
      console.log(`  Imported: ${imported}`);
      console.log(`  Skipped: ${skipped}`);
      console.log(`  Failed: ${failed}`);
    }

    console.log(`\n✓ Archive import complete`);
    console.log(`  Years: ${targetYears.join(", ")}`);
    console.log(`  Imported: ${totalImported}`);
    console.log(`  Skipped: ${totalSkipped}`);
    console.log(`  Failed: ${totalFailed}`);
  } catch (err) {
    console.error(`Failed to import session: ${err}`);
    process.exit(1);
  }
}

main();
