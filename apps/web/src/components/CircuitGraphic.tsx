import React from "react";
import type { LayoutPoint } from "../types";

export interface CircuitGeometryPoint {
  x: number;
  y: number;
}

interface CircuitGeometrySamplePoint extends CircuitGeometryPoint {
  tx: number;
  ty: number;
}

export interface CircuitGeometry {
  path: string;
  points: CircuitGeometryPoint[];
  hasRealLayout: boolean;
  pointAtProgress: (progress: number) => CircuitGeometrySamplePoint;
  nearestProgressForPoint: (point: CircuitGeometryPoint) => number;
  toSvgPoint: (point: LayoutPoint) => CircuitGeometryPoint;
  startPoint: CircuitGeometryPoint;
  startNormal: { x: number; y: number };
}

export interface CircuitMarkerTrailPoint {
  x: number;
  y: number;
  opacity: number;
  radius?: number;
}

export interface CircuitMarker {
  key: number | string;
  x: number;
  y: number;
  color: string;
  trail?: CircuitMarkerTrailPoint[];
  glow?: boolean;
  badge?: string;
  badgeX?: number;
  badgeY?: number;
  label?: string;
  labelX?: number;
  labelY?: number;
  labelColor?: string;
}

interface CircuitGraphicProps {
  geometry: CircuitGeometry | null;
  width: number;
  height: number;
  title: string;
  className?: string;
  variant?: "card" | "hero" | "map";
  markers?: CircuitMarker[];
  showCenterLine?: boolean;
}

interface BuildCircuitGeometryOptions {
  width: number;
  height: number;
  pad: number;
  maxPoints?: number;
  fallbackSeed?: string;
}

const DEFAULT_SAMPLE_COUNT = 480;

export function sampleLayoutPoints(points: LayoutPoint[], targetPoints = 240): LayoutPoint[] {
  if (!Array.isArray(points) || points.length === 0) {
    return [];
  }
  const sampleStep = Math.max(1, Math.floor(points.length / targetPoints));
  return points
    .filter((_, index) => index % sampleStep === 0)
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

export function isUsableLayout(points: LayoutPoint[]): boolean {
  const sampled = sampleLayoutPoints(points, 320);
  if (sampled.length < 20) {
    return false;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of sampled) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }

  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  if (spanX < 80 || spanY < 80) {
    return false;
  }

  const major = Math.max(spanX, spanY);
  const minor = Math.max(1, Math.min(spanX, spanY));
  if (major / minor > 12) {
    return false;
  }

  let pathLength = 0;
  const buckets = new Set<string>();
  for (let index = 1; index < sampled.length; index += 1) {
    const previous = sampled[index - 1];
    const point = sampled[index];
    pathLength += Math.hypot(point.x - previous.x, point.y - previous.y);
  }
  for (const point of sampled) {
    buckets.add(`${Math.round((point.x - minX) / 20)}:${Math.round((point.y - minY) / 20)}`);
  }

  return pathLength >= major * 4 && buckets.size >= 18;
}

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

export function mod1(value: number): number {
  return ((value % 1) + 1) % 1;
}

function hashSeed(seedText: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seedText.length; index += 1) {
    hash ^= seedText.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function buildFallbackLayout(sampleCount = DEFAULT_SAMPLE_COUNT, seedText = "default"): LayoutPoint[] {
  const seed = hashSeed(seedText);
  const phaseA = ((seed & 255) / 255) * Math.PI * 2;
  const phaseB = (((seed >> 8) & 255) / 255) * Math.PI * 2;
  const phaseC = (((seed >> 16) & 255) / 255) * Math.PI * 2;
  const warpA = 0.18 + (((seed >> 24) & 15) / 100);
  const warpB = 0.06 + (((seed >> 20) & 15) / 200);

  const points: LayoutPoint[] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const t = (index / sampleCount) * Math.PI * 2;
    const radius = 1 + warpA * Math.sin(3 * t + phaseA) + warpB * Math.sin(7 * t + phaseB);
    points.push({
      x: Math.cos(t) * radius * (900 + (seed % 160)) + 150 * Math.sin(2 * t + phaseC),
      y: Math.sin(t) * radius * (660 + ((seed >> 4) % 180)) + 120 * Math.sin(5 * t + phaseA),
    });
  }
  return points;
}

export function buildCircuitGeometry(
  layout: LayoutPoint[] | null,
  options: BuildCircuitGeometryOptions,
): CircuitGeometry | null {
  const sourceLayout = layout && layout.length > 8
    ? layout
    : buildFallbackLayout(DEFAULT_SAMPLE_COUNT, options.fallbackSeed);
  const sampled = sampleLayoutPoints(sourceLayout, options.maxPoints ?? DEFAULT_SAMPLE_COUNT);
  const hasRealLayout = Boolean(layout && layout.length > 8);

  if (sampled.length < 3) {
    return null;
  }

  const xs = sampled.map((point) => point.x);
  const ys = sampled.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;

  const scaleX = (options.width - options.pad * 2) / rangeX;
  const scaleY = (options.height - options.pad * 2) / rangeY;
  const scale = Math.min(scaleX, scaleY);
  const offsetX = options.pad + ((options.width - options.pad * 2) - rangeX * scale) / 2;
  const offsetY = options.pad + ((options.height - options.pad * 2) - rangeY * scale) / 2;

  const toSvgPoint = (point: LayoutPoint): CircuitGeometryPoint => ({
    x: offsetX + (point.x - minX) * scale,
    y: options.height - offsetY - (point.y - minY) * scale,
  });

  const points = sampled.map(toSvgPoint);
  const path = points
    .map(({ x, y }, index) => `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ") + " Z";

  const loopPoints = [...points, points[0]];
  const cumulative: number[] = [0];
  for (let index = 1; index < loopPoints.length; index += 1) {
    const dx = loopPoints[index].x - loopPoints[index - 1].x;
    const dy = loopPoints[index].y - loopPoints[index - 1].y;
    cumulative.push(cumulative[index - 1] + Math.hypot(dx, dy));
  }
  const totalLength = cumulative[cumulative.length - 1] || 1;

  const pointAtProgress = (progress: number): CircuitGeometrySamplePoint => {
    const target = clamp01(progress) * totalLength;
    let lo = 0;
    let hi = cumulative.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (cumulative[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    const index = Math.max(1, lo);
    const start = loopPoints[index - 1];
    const end = loopPoints[index] ?? start;
    const segmentLength = Math.max(1, cumulative[index] - cumulative[index - 1]);
    const segmentProgress = (target - cumulative[index - 1]) / segmentLength;
    return {
      x: start.x + (end.x - start.x) * segmentProgress,
      y: start.y + (end.y - start.y) * segmentProgress,
      tx: end.x - start.x,
      ty: end.y - start.y,
    };
  };

  const nearestProgressForPoint = (point: CircuitGeometryPoint): number => {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < points.length; index += 1) {
      const dx = points[index].x - point.x;
      const dy = points[index].y - point.y;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    return totalLength > 0 ? cumulative[bestIndex] / totalLength : 0;
  };

  const startPoint = points[0];
  const startVector = { x: loopPoints[1].x - loopPoints[0].x, y: loopPoints[1].y - loopPoints[0].y };
  const tangentLength = Math.max(1, Math.hypot(startVector.x, startVector.y));
  const startNormal = { x: -startVector.y / tangentLength, y: startVector.x / tangentLength };

  return {
    path,
    points,
    hasRealLayout,
    pointAtProgress,
    nearestProgressForPoint,
    toSvgPoint,
    startPoint,
    startNormal,
  };
}

function getRoadWidth(variant: "card" | "hero" | "map"): number {
  switch (variant) {
    case "card":
      return 5;
    case "hero":
      return 7;
    default:
      return 9;
  }
}

export function CircuitGraphic({
  geometry,
  width,
  height,
  title,
  className,
  variant = "card",
  markers = [],
  showCenterLine,
}: CircuitGraphicProps) {
  if (!geometry) {
    return null;
  }

  const roadWidth = getRoadWidth(variant);
  const centerLineVisible = showCenterLine ?? variant !== "card";
  const startLineHalf = roadWidth * 1.15;
  const startLineOffset = roadWidth * 0.45;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-label={title}
      role="img"
    >
      <path
        d={geometry.path}
        fill="none"
        stroke="rgba(180,190,220,0.05)"
        strokeWidth={roadWidth * 3.2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d={geometry.path}
        fill="none"
        stroke="rgba(235,240,255,0.82)"
        strokeWidth={roadWidth * 1.55}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d={geometry.path}
        fill="none"
        stroke="#171b23"
        strokeWidth={roadWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {centerLineVisible && (
        <path
          d={geometry.path}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={Math.max(1, roadWidth * 0.14)}
          strokeLinejoin="round"
          strokeLinecap="round"
          strokeDasharray={`${Math.max(4, roadWidth * 0.55)} ${Math.max(7, roadWidth)}`}
        />
      )}
      <line
        x1={geometry.startPoint.x - geometry.startNormal.x * startLineHalf}
        y1={geometry.startPoint.y - geometry.startNormal.y * startLineHalf}
        x2={geometry.startPoint.x + geometry.startNormal.x * startLineHalf}
        y2={geometry.startPoint.y + geometry.startNormal.y * startLineHalf}
        stroke="rgba(255,255,255,0.92)"
        strokeWidth={Math.max(1.4, roadWidth * 0.24)}
        strokeLinecap="round"
      />
      <line
        x1={geometry.startPoint.x - geometry.startNormal.x * startLineHalf + geometry.startNormal.x * startLineOffset}
        y1={geometry.startPoint.y - geometry.startNormal.y * startLineHalf + geometry.startNormal.y * startLineOffset}
        x2={geometry.startPoint.x + geometry.startNormal.x * startLineHalf + geometry.startNormal.x * startLineOffset}
        y2={geometry.startPoint.y + geometry.startNormal.y * startLineHalf + geometry.startNormal.y * startLineOffset}
        stroke="rgba(255,255,255,0.42)"
        strokeWidth={Math.max(1, roadWidth * 0.16)}
        strokeLinecap="round"
      />

      {markers.map((marker) => (
        <g key={marker.key} className="driver-dot-group">
          {(marker.trail ?? []).map((trailPoint, index) => (
            <circle
              key={`${marker.key}-trail-${index}`}
              cx={trailPoint.x}
              cy={trailPoint.y}
              r={trailPoint.radius ?? Math.max(2.2, roadWidth * 0.48 - index * 0.35)}
              fill={marker.color}
              opacity={trailPoint.opacity}
            />
          ))}
          {marker.glow && <circle cx={marker.x} cy={marker.y} r={roadWidth * 1.45} fill={marker.color} opacity={0.28} />}
          {marker.glow && <circle cx={marker.x} cy={marker.y} r={roadWidth * 0.9} fill={marker.color} opacity={0.18} />}
          <circle cx={marker.x} cy={marker.y} r={roadWidth * 0.72} fill={marker.color} stroke="#0a0c12" strokeWidth={2} />
          {marker.badge && typeof marker.badgeX === "number" && typeof marker.badgeY === "number" && (
            <text
              x={marker.badgeX}
              y={marker.badgeY}
              textAnchor="middle"
              fill="rgba(255,255,255,0.95)"
              fontSize={Math.max(8, roadWidth * 0.9)}
              fontFamily="ui-monospace, monospace"
              fontWeight="700"
            >
              {marker.badge}
            </text>
          )}
          {marker.label && typeof marker.labelX === "number" && typeof marker.labelY === "number" && (
            <g>
              <text
                x={marker.labelX}
                y={marker.labelY}
                textAnchor="middle"
                fill="rgba(0,0,0,0.76)"
                fontSize={Math.max(9, roadWidth * 0.98)}
                fontFamily="ui-monospace, monospace"
                fontWeight="700"
                strokeWidth={3}
                stroke="rgba(0,0,0,0.76)"
                paintOrder="stroke"
              >
                {marker.label}
              </text>
              <text
                x={marker.labelX}
                y={marker.labelY}
                textAnchor="middle"
                fill={marker.labelColor ?? marker.color}
                fontSize={Math.max(9, roadWidth * 0.98)}
                fontFamily="ui-monospace, monospace"
                fontWeight="700"
              >
                {marker.label}
              </text>
            </g>
          )}
        </g>
      ))}
    </svg>
  );
}