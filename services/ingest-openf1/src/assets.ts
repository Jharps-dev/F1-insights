import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import type { SessionManifest } from "@f1-insights/schemas";

const ASSET_ROUTE_PREFIX = "/api/assets";
const ASSET_DIR_NAME = "assets";
const DEFAULT_ASSET_STALE_MS = 1000 * 60 * 60 * 24 * 7;

interface AssetMirrorOptions {
  force?: boolean;
  staleAfterMs?: number;
}

interface AssetMeta {
  sourceUrl: string;
  localFileName: string;
  syncedUtc: string;
  year?: number;
  meetingKey?: number;
  sessionKey?: number;
  driverNumber?: number;
  kind: string;
}

function isRemoteUrl(value: string | undefined): value is string {
  return Boolean(value && /^https?:\/\//i.test(value));
}

function isLocalAssetUrl(value: string | undefined): value is string {
  return Boolean(value && value.startsWith(`${ASSET_ROUTE_PREFIX}/`));
}

function sanitizeSegment(value: string | number | undefined): string {
  if (value === undefined || value === null || value === "") {
    return "na";
  }
  return String(value).replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "na";
}

function versionedAssetUrl(fileName: string, syncedUtc: string): string {
  const version = syncedUtc.replace(/[^0-9]/g, "").slice(0, 14) || Date.now().toString();
  return `${ASSET_ROUTE_PREFIX}/${fileName}?v=${version}`;
}

function assetFileName(args: {
  sourceUrl: string;
  kind: string;
  year?: number;
  meetingKey?: number;
  sessionKey?: number;
  driverNumber?: number;
  ext: string;
}): string {
  const hash = crypto.createHash("sha1").update(args.sourceUrl).digest("hex").slice(0, 10);
  const parts = [
    sanitizeSegment(args.kind),
    sanitizeSegment(args.year),
    sanitizeSegment(args.meetingKey),
    sanitizeSegment(args.sessionKey),
    sanitizeSegment(args.driverNumber),
    hash,
  ];
  return `${parts.join("_")}${args.ext}`;
}

function inferExtension(sourceUrl: string, contentType?: string | null): string {
  const pathname = sourceUrl.split("?")[0] || "";
  const parsed = path.extname(pathname).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif", ".avif"].includes(parsed)) {
    return parsed === ".jpeg" ? ".jpg" : parsed;
  }

  const normalized = (contentType || "").toLowerCase();
  if (normalized.includes("svg")) return ".svg";
  if (normalized.includes("webp")) return ".webp";
  if (normalized.includes("avif")) return ".avif";
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return ".jpg";
  if (normalized.includes("gif")) return ".gif";
  return ".png";
}

async function readAssetMeta(metaPath: string): Promise<AssetMeta | null> {
  try {
    const raw = await fs.readFile(metaPath, "utf8");
    return JSON.parse(raw) as AssetMeta;
  } catch {
    return null;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function mirrorRemoteAsset(args: {
  outputDir: string;
  sourceUrl?: string;
  kind: string;
  year?: number;
  meetingKey?: number;
  sessionKey?: number;
  driverNumber?: number;
  force?: boolean;
  staleAfterMs?: number;
}): Promise<string | undefined> {
  if (!isRemoteUrl(args.sourceUrl)) {
    return isLocalAssetUrl(args.sourceUrl) ? args.sourceUrl : undefined;
  }

  const assetsDir = path.join(args.outputDir, ASSET_DIR_NAME);
  await fs.mkdir(assetsDir, { recursive: true });

  const staleAfterMs = args.staleAfterMs ?? DEFAULT_ASSET_STALE_MS;
  const provisionalName = assetFileName({
    sourceUrl: args.sourceUrl,
    kind: args.kind,
    year: args.year,
    meetingKey: args.meetingKey,
    sessionKey: args.sessionKey,
    driverNumber: args.driverNumber,
    ext: ".png",
  });
  const provisionalMetaPath = path.join(assetsDir, `${provisionalName}.meta.json`);
  const existingMeta = await readAssetMeta(provisionalMetaPath);

  if (existingMeta) {
    const existingAssetPath = path.join(assetsDir, existingMeta.localFileName);
    const isFresh = Date.now() - Date.parse(existingMeta.syncedUtc) < staleAfterMs;
    if (!args.force && existingMeta.sourceUrl === args.sourceUrl && isFresh && await fileExists(existingAssetPath)) {
      return versionedAssetUrl(existingMeta.localFileName, existingMeta.syncedUtc);
    }
  }

  try {
    const response = await fetch(args.sourceUrl, { signal: AbortSignal.timeout(45_000) });
    if (!response.ok) {
      if (existingMeta) {
        return versionedAssetUrl(existingMeta.localFileName, existingMeta.syncedUtc);
      }
      return undefined;
    }

    const arrayBuffer = await response.arrayBuffer();
    const ext = inferExtension(response.url || args.sourceUrl, response.headers.get("content-type"));
    const fileName = assetFileName({
      sourceUrl: args.sourceUrl,
      kind: args.kind,
      year: args.year,
      meetingKey: args.meetingKey,
      sessionKey: args.sessionKey,
      driverNumber: args.driverNumber,
      ext,
    });
    const filePath = path.join(assetsDir, fileName);
    const syncedUtc = new Date().toISOString();
    const meta: AssetMeta = {
      sourceUrl: args.sourceUrl,
      localFileName: fileName,
      syncedUtc,
      year: args.year,
      meetingKey: args.meetingKey,
      sessionKey: args.sessionKey,
      driverNumber: args.driverNumber,
      kind: args.kind,
    };

    await fs.writeFile(filePath, Buffer.from(arrayBuffer));
    await fs.writeFile(path.join(assetsDir, `${fileName}.meta.json`), JSON.stringify(meta, null, 2), "utf8");
    if (fileName !== provisionalName) {
      await fs.writeFile(provisionalMetaPath, JSON.stringify(meta, null, 2), "utf8");
    }
    return versionedAssetUrl(fileName, syncedUtc);
  } catch {
    if (existingMeta) {
      return versionedAssetUrl(existingMeta.localFileName, existingMeta.syncedUtc);
    }
    return undefined;
  }
}

export async function mirrorSessionManifestAssets(
  manifest: SessionManifest,
  outputDir: string,
  options: AssetMirrorOptions = {}
): Promise<SessionManifest> {
  const next: SessionManifest = {
    ...manifest,
    meeting_context: manifest.meeting_context ? { ...manifest.meeting_context } : undefined,
    drivers: manifest.drivers.map((driver) => ({ ...driver })),
  };

  if (next.meeting_context) {
    const countryFlagSource = next.meeting_context.country_flag_source_url || next.meeting_context.country_flag;
    const mirroredCountryFlag = await mirrorRemoteAsset({
      outputDir,
      sourceUrl: countryFlagSource,
      kind: "country-flag",
      year: next.year,
      meetingKey: next.meeting_key,
      force: options.force,
      staleAfterMs: options.staleAfterMs,
    });
    if (mirroredCountryFlag) {
      next.meeting_context.country_flag = mirroredCountryFlag;
      if (isRemoteUrl(countryFlagSource)) {
        next.meeting_context.country_flag_source_url = countryFlagSource;
      }
    }

    const circuitImageSource = next.meeting_context.circuit_image_source_url || next.meeting_context.circuit_image;
    const mirroredCircuitImage = await mirrorRemoteAsset({
      outputDir,
      sourceUrl: circuitImageSource,
      kind: "circuit-image",
      year: next.year,
      meetingKey: next.meeting_key,
      force: options.force,
      staleAfterMs: options.staleAfterMs,
    });
    if (mirroredCircuitImage) {
      next.meeting_context.circuit_image = mirroredCircuitImage;
      if (isRemoteUrl(circuitImageSource)) {
        next.meeting_context.circuit_image_source_url = circuitImageSource;
      }
    }
  }

  next.drivers = await Promise.all(next.drivers.map(async (driver) => {
    const headshotSource = driver.headshot_source_url || driver.headshot_url;
    const mirroredHeadshot = await mirrorRemoteAsset({
      outputDir,
      sourceUrl: headshotSource,
      kind: "driver-headshot",
      year: next.year,
      meetingKey: next.meeting_key,
      driverNumber: driver.number,
      force: options.force,
      staleAfterMs: options.staleAfterMs,
    });

    if (!mirroredHeadshot) {
      return driver;
    }

    return {
      ...driver,
      headshot_url: mirroredHeadshot,
      headshot_source_url: isRemoteUrl(headshotSource) ? headshotSource : driver.headshot_source_url,
    };
  }));

  return next;
}

export { ASSET_DIR_NAME, ASSET_ROUTE_PREFIX, DEFAULT_ASSET_STALE_MS };