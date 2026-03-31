import { useMemo, useSyncExternalStore } from "react";
import type { DustParticle } from "@/lib/dust";

type ConstellationDustProps = {
  particles: DustParticle[];
  particleCount?: number;
  className?: string;
  constellationId?: string;
  status?: "active" | "finished";
  mode?: "page" | "background";
  maxDust?: number;
};

type NebulaLayout = {
  base: {
    cx: number;
    cy: number;
    rotation: number;
  };
  cloud: {
    x: number;
    y: number;
    rotation: number;
    scale: number;
  };
  accent: {
    x: number;
    y: number;
    rotation: number;
    scale: number;
  };
};

type NebulaSparkle = {
  x: number;
  y: number;
  radius: number;
  opacity: number;
  color: string;
  haloColor: string;
  duration: string;
  delay: string;
  rayLength: number;
  crossOpacity: number;
};

const LAYOUTS: NebulaLayout[] = [
  {
    base: { cx: 49, cy: 49, rotation: -10 },
    cloud: { x: 49, y: 50, rotation: -16, scale: 1.03 },
    accent: { x: 64, y: 42, rotation: 10, scale: 0.94 },
  },
  {
    base: { cx: 52, cy: 50, rotation: 12 },
    cloud: { x: 47, y: 53, rotation: 18, scale: 1 },
    accent: { x: 34, y: 40, rotation: -15, scale: 0.92 },
  },
  {
    base: { cx: 51, cy: 52, rotation: -18 },
    cloud: { x: 56, y: 48, rotation: -26, scale: 1.06 },
    accent: { x: 42, y: 64, rotation: 18, scale: 0.95 },
  },
  {
    base: { cx: 48, cy: 48, rotation: 6 },
    cloud: { x: 44, y: 47, rotation: 11, scale: 0.98 },
    accent: { x: 64, y: 58, rotation: -12, scale: 0.96 },
  },
];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function hashString(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function getPseudoRandomValue(seed: number) {
  const value = Math.sin(seed * 999.91) * 43758.5453123;
  return value - Math.floor(value);
}

function getLayout(constellationId: string) {
  const hash = hashString(constellationId || "default-constellation");

  return {
    hash,
    layout: LAYOUTS[hash % LAYOUTS.length] ?? LAYOUTS[0],
  };
}

function getNebulaOpacities(
  particleCount: number,
  maxDust: number,
  status: "active" | "finished",
  mode: "page" | "background"
) {
  const progress = clamp(maxDust > 0 ? particleCount / maxDust : 0, 0, 1);
  const statusMultiplier = status === "finished" ? 1.08 : 0.96;
  const modeMultiplier = mode === "background" ? 0.72 : 1;
  const multiplier = statusMultiplier * modeMultiplier;

  return {
    progress,
    base: clamp((0.08 + progress * 0.36) * multiplier, 0, 0.68),
    cloud: clamp((0.08 + progress * 0.62) * multiplier, 0, 0.9),
    highlights: clamp(((progress - 0.04) / 0.62) * 0.44 * multiplier, 0, 0.56),
    accent: clamp(((progress - 0.12) / 0.6) * 0.54 * multiplier, 0, 0.62),
  };
}

function getNebulaSparkles(
  hash: number,
  layout: NebulaLayout,
  progress: number,
  mode: "page" | "background"
): NebulaSparkle[] {
  const sparkleCount =
    mode === "background"
      ? Math.max(8, Math.round(8 + progress * 8))
      : Math.max(24, Math.round(24 + progress * 44));
  const sparkleOpacityScale = mode === "background" ? 0.72 : 1;
  const anchors = [
    { x: layout.base.cx - 30, y: layout.base.cy - 14, spreadX: 14, spreadY: 10 },
    { x: layout.base.cx - 22, y: layout.base.cy + 12, spreadX: 14, spreadY: 10 },
    { x: layout.base.cx - 4, y: layout.base.cy - 20, spreadX: 14, spreadY: 10 },
    { x: layout.base.cx + 4, y: layout.base.cy, spreadX: 16, spreadY: 12 },
    { x: layout.base.cx + 22, y: layout.base.cy - 10, spreadX: 14, spreadY: 10 },
    { x: layout.base.cx + 30, y: layout.base.cy + 12, spreadX: 14, spreadY: 10 },
    { x: layout.base.cx + 2, y: layout.base.cy + 22, spreadX: 14, spreadY: 10 },
  ];

  const colors = [
    {
      core: "rgba(255, 255, 255, 0.98)",
      halo: "rgba(226, 241, 255, 0.86)",
    },
    {
      core: "rgba(224, 238, 255, 0.96)",
      halo: "rgba(139, 190, 255, 0.72)",
    },
    {
      core: "rgba(241, 232, 255, 0.96)",
      halo: "rgba(188, 149, 255, 0.7)",
    },
  ];

  return Array.from({ length: sparkleCount }, (_, index) => {
    const anchor = anchors[index % anchors.length];
    const color = colors[index % colors.length];
    const seed = hash + index;
    const x = clamp(
      anchor.x + getPseudoRandomValue(seed) * anchor.spreadX,
      0,
      100
    );
    const y = clamp(
      anchor.y + getPseudoRandomValue(seed + 1) * anchor.spreadY,
      0,
      100
    );
    const radius =
      mode === "background"
        ? Math.max(0.28, getPseudoRandomValue(seed + 2) * 0.62)
        : Math.max(0.5, getPseudoRandomValue(seed + 2) * 1.05);
    const opacity = clamp(
      getPseudoRandomValue(seed + 3) * sparkleOpacityScale,
      0.16,
      0.34
    );
    const duration = `${Math.max(2.5, getPseudoRandomValue(seed + 4) * 3)}s`;
    const delay = `${getPseudoRandomValue(seed + 5) * 3}s`;

    return {
      x,
      y,
      radius,
      opacity,
      color: color.core,
      haloColor: color.halo,
      duration,
      delay,
      rayLength: Math.max(0.5, getPseudoRandomValue(seed + 6) * 1.5),
      crossOpacity: Math.max(0.1, getPseudoRandomValue(seed + 7) * 0.5),
    };
  });
}

export default function ConstellationDust({
  particles,
  particleCount,
  className = "",
  constellationId = "default-constellation",
  status = "active",
  mode = "page",
  maxDust = 400,
}: ConstellationDustProps) {
  const isClient = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  const TWINKLE_TARGET_PX = 1;
  const resolvedParticleCount = particleCount ?? particles.length;
  const isBackground = mode === "background";
  const { hash, layout } = useMemo(
    () => getLayout(constellationId),
    [constellationId]
  );
  const opacity = useMemo(
    () =>
      getNebulaOpacities(resolvedParticleCount, maxDust, status, mode),
    [maxDust, mode, resolvedParticleCount, status]
  );
  const sparkles = useMemo(
    () => getNebulaSparkles(hash, layout, opacity.progress, mode),
    [hash, layout, mode, opacity.progress]
  );
  const idPrefix = `nebula-${hash}-${mode}`;
  const baseScale = 0.98 + opacity.progress * 0.08;
  const cloudScale = 0.9 + opacity.progress * 0.15;
  const accentScale = 0.82 + opacity.progress * 0.2;
  const baseBlur = isBackground ? 7.2 : 9.8;
  const cloudBlur = isBackground ? 5.4 : 7.6;
  const highlightBlur = isBackground ? 2.6 : 4.2;
  const sparkleBlur = isBackground ? 0.08 : 0.42;

  if (!isClient) {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
    >
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full overflow-visible"
      >
        <defs>
          <radialGradient id={`${idPrefix}-base-gradient`}>
            <stop offset="0%" stopColor="#eef8ff" stopOpacity="0.96" />
            <stop offset="24%" stopColor="#9ec8ff" stopOpacity="0.86" />
            <stop offset="56%" stopColor="#5d99ff" stopOpacity="0.5" />
            <stop offset="82%" stopColor="#916fff" stopOpacity="0.24" />
            <stop offset="100%" stopColor="#050816" stopOpacity="0" />
          </radialGradient>

          <radialGradient id={`${idPrefix}-violet-gradient`}>
            <stop offset="0%" stopColor="#f9f3ff" stopOpacity="0.94" />
            <stop offset="30%" stopColor="#d0a8ff" stopOpacity="0.76" />
            <stop offset="62%" stopColor="#8a63ff" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#050816" stopOpacity="0" />
          </radialGradient>

          <radialGradient id={`${idPrefix}-cyan-gradient`}>
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.92" />
            <stop offset="28%" stopColor="#c9e7ff" stopOpacity="0.78" />
            <stop offset="58%" stopColor="#6fb7ff" stopOpacity="0.46" />
            <stop offset="100%" stopColor="#050816" stopOpacity="0" />
          </radialGradient>

          <linearGradient
            id={`${idPrefix}-mist-gradient`}
            x1="0%"
            y1="50%"
            x2="100%"
            y2="50%"
          >
            <stop offset="0%" stopColor="#4e7cff" stopOpacity="0" />
            <stop offset="22%" stopColor="#84c0ff" stopOpacity="0.42" />
            <stop offset="50%" stopColor="#f4fbff" stopOpacity="0.58" />
            <stop offset="76%" stopColor="#c58cff" stopOpacity="0.38" />
            <stop offset="100%" stopColor="#7b61ff" stopOpacity="0" />
          </linearGradient>

          <filter
            id={`${idPrefix}-base-blur`}
            x="-45%"
            y="-45%"
            width="190%"
            height="190%"
          >
            <feGaussianBlur stdDeviation={baseBlur} />
          </filter>

          <filter
            id={`${idPrefix}-cloud-blur`}
            x="-50%"
            y="-50%"
            width="200%"
            height="200%"
          >
            <feGaussianBlur stdDeviation={cloudBlur} />
          </filter>

          <filter
            id={`${idPrefix}-highlight-blur`}
            x="-40%"
            y="-40%"
            width="180%"
            height="180%"
          >
            <feGaussianBlur stdDeviation={highlightBlur} />
          </filter>

          <filter
            id={`${idPrefix}-sparkle-blur`}
            x="-80%"
            y="-80%"
            width="260%"
            height="260%"
          >
            <feGaussianBlur stdDeviation={sparkleBlur} />
          </filter>
        </defs>

        <g style={{ mixBlendMode: "screen" }}>
          <g
            opacity={opacity.base}
            transform={`translate(${layout.base.cx} ${layout.base.cy}) rotate(${layout.base.rotation}) scale(${baseScale}) translate(${-layout.base.cx} ${-layout.base.cy})`}
            filter={`url(#${idPrefix}-base-blur)`}
          >
            <ellipse cx="50" cy="50" rx="52" ry="37" fill={`url(#${idPrefix}-base-gradient)`} />
            <ellipse cx="20" cy="40" rx="18" ry="13" fill="rgba(124, 184, 255, 0.22)" />
            <ellipse cx="28" cy="64" rx="17" ry="12" fill="rgba(150, 204, 255, 0.24)" />
            <ellipse cx="50" cy="28" rx="20" ry="11" fill="rgba(166, 206, 255, 0.18)" />
            <ellipse cx="72" cy="40" rx="14" ry="9.5" fill="rgba(188, 149, 255, 0.14)" />
            <ellipse cx="79" cy="58" rx="12.5" ry="8.2" fill="rgba(128, 171, 255, 0.14)" />
            <ellipse cx="56" cy="74" rx="18" ry="10" fill="rgba(183, 144, 255, 0.18)" />
          </g>

          <g
            opacity={opacity.cloud}
            transform={`translate(${layout.cloud.x} ${layout.cloud.y}) rotate(${layout.cloud.rotation}) scale(${cloudScale}) translate(${-layout.cloud.x} ${-layout.cloud.y})`}
          >
            <g filter={`url(#${idPrefix}-cloud-blur)`}>
              <ellipse cx="17" cy="38" rx="13" ry="8.2" fill="rgba(113, 177, 255, 0.22)" />
              <ellipse cx="28" cy="60" rx="15" ry="9.4" fill="rgba(131, 194, 255, 0.26)" />
              <ellipse cx="48" cy="49" rx="19" ry="11" fill="rgba(238, 248, 255, 0.3)" />
              <ellipse cx="70" cy="42" rx="13" ry="8" fill="rgba(195, 150, 255, 0.18)" />
              <ellipse cx="78" cy="58" rx="11" ry="6.8" fill="rgba(120, 162, 255, 0.16)" />
              <ellipse cx="56" cy="72" rx="15.5" ry="9" fill="rgba(184, 145, 255, 0.22)" />
              <path
                d="M 7 54 C 21 46, 36 45, 51 49 C 65 53, 79 61, 93 68 C 78 67, 63 64, 49 59 C 35 54, 21 53, 7 54 Z"
                fill={`url(#${idPrefix}-mist-gradient)`}
              />
              <path
                d="M 9 44 C 24 37, 39 36, 53 40 C 66 43, 80 50, 92 60 C 76 56, 61 51, 48 47 C 35 43, 22 42, 9 44 Z"
                fill="rgba(162, 206, 255, 0.18)"
              />
            </g>

            <g opacity={opacity.highlights} filter={`url(#${idPrefix}-highlight-blur)`}>
              <ellipse cx="49" cy="49" rx="13" ry="4.8" fill="rgba(255, 255, 255, 0.18)" />
              <ellipse cx="31" cy="60" rx="8.8" ry="3.5" fill="rgba(171, 214, 255, 0.16)" />
              <ellipse cx="68" cy="42" rx="7.2" ry="2.8" fill="rgba(206, 182, 255, 0.1)" />
              <ellipse cx="18" cy="39" rx="7.2" ry="2.9" fill="rgba(181, 223, 255, 0.14)" />
            </g>
          </g>

          <g
            opacity={opacity.accent}
            transform={`translate(${layout.accent.x} ${layout.accent.y}) rotate(${layout.accent.rotation}) scale(${accentScale}) translate(${-layout.accent.x} ${-layout.accent.y})`}
          >
            <g filter={`url(#${idPrefix}-cloud-blur)`}>
              <ellipse cx={layout.base.cx + 17} cy={layout.base.cy - 8} rx="12.5" ry="7.8" fill={`url(#${idPrefix}-violet-gradient)`} />
              <ellipse cx={layout.base.cx - 24} cy={layout.base.cy + 8} rx="13" ry="7" fill="rgba(117, 171, 255, 0.18)" />
              <ellipse cx={layout.base.cx + 3} cy={layout.base.cy + 18} rx="12" ry="6.5" fill="rgba(176, 139, 255, 0.18)" />
              <ellipse cx={layout.base.cx + 2} cy={layout.base.cy - 13} rx="9" ry="5" fill={`url(#${idPrefix}-cyan-gradient)`} />
            </g>
            <g filter={`url(#${idPrefix}-highlight-blur)`}>
              <ellipse cx={layout.base.cx + 17} cy={layout.base.cy - 8} rx="4.6" ry="2.4" fill="rgba(255, 255, 255, 0.18)" />
            </g>
          </g>

          <g>
            {sparkles.map((sparkle, index) => {
              const lineLength = TWINKLE_TARGET_PX * 0.46;
              const lineThickness = Math.max(0.06, TWINKLE_TARGET_PX * 0.08);
              const coreRadius = Math.max(0.1, TWINKLE_TARGET_PX * 0.055);
              const mainOpacity = isBackground
                ? Math.min(0.58, sparkle.opacity * 1.8)
                : Math.min(0.28, sparkle.opacity * 0.85);
              const diagonalOpacity = isBackground
                ? Math.min(0.38, sparkle.opacity * 1.2)
                : Math.min(0.22, sparkle.opacity * 0.7);
              const coreOpacity = isBackground ? 0.98 : 0.94;
              const coreGlow = isBackground
                ? Math.max(0.85, lineThickness * 5.5)
                : Math.max(0.45, lineThickness * 2.5);
              const backgroundLineLength = Math.max(0.22, lineLength);
              const backgroundLineThickness = Math.max(0.08, lineThickness * 1.2);
              const backgroundCoreRadius = Math.max(0.14, coreRadius * 1.1);

              return (
                <g
                  key={`${idPrefix}-sparkle-${index}`}
                  transform={`translate(${sparkle.x} ${sparkle.y})`}
                >
                  {isBackground ? (
                    <g
                      style={{
                        animationName: "constellation-twinkle",
                        animationDuration: sparkle.duration,
                        animationDelay: sparkle.delay,
                        animationIterationCount: "infinite",
                        animationTimingFunction: "ease-in-out",
                        transformOrigin: "center",
                        transformBox: "fill-box",
                      }}
                    >
                      <line
                        x1={-backgroundLineLength}
                        y1="0"
                        x2={backgroundLineLength}
                        y2="0"
                        stroke={sparkle.color}
                        strokeWidth={backgroundLineThickness}
                        strokeLinecap="round"
                        opacity={Math.min(0.5, mainOpacity)}
                      />
                      <line
                        x1="0"
                        y1={-backgroundLineLength}
                        x2="0"
                        y2={backgroundLineLength}
                        stroke={sparkle.color}
                        strokeWidth={backgroundLineThickness}
                        strokeLinecap="round"
                        opacity={Math.min(0.5, mainOpacity)}
                      />
                      <circle
                        cx="0"
                        cy="0"
                        r={backgroundCoreRadius}
                        fill="#ffffff"
                        opacity={0.92}
                      />
                    </g>
                  ) : (
                    <g
                      filter={`url(#${idPrefix}-sparkle-blur)`}
                      style={{
                        animationName: "constellation-twinkle",
                        animationDuration: sparkle.duration,
                        animationDelay: sparkle.delay,
                        animationIterationCount: "infinite",
                        animationTimingFunction: "ease-in-out",
                        transformOrigin: "center",
                        transformBox: "fill-box",
                      }}
                    >
                      <line
                        x1={-lineLength}
                        y1="0"
                        x2={lineLength}
                        y2="0"
                        stroke={sparkle.haloColor}
                        strokeWidth={lineThickness}
                        strokeLinecap="round"
                        opacity={mainOpacity}
                        style={{
                          filter: `drop-shadow(0 0 ${Math.max(
                            0.3,
                            lineThickness * 1.3
                          )}px ${sparkle.haloColor})`,
                        }}
                      />
                      <line
                        x1="0"
                        y1={-lineLength}
                        x2="0"
                        y2={lineLength}
                        stroke={sparkle.haloColor}
                        strokeWidth={lineThickness}
                        strokeLinecap="round"
                        opacity={mainOpacity}
                        style={{
                          filter: `drop-shadow(0 0 ${Math.max(
                            0.3,
                            lineThickness * 1.3
                          )}px ${sparkle.haloColor})`,
                        }}
                      />
                      <line
                        x1={-lineLength * 0.6}
                        y1={-lineLength * 0.6}
                        x2={lineLength * 0.6}
                        y2={lineLength * 0.6}
                        stroke={sparkle.haloColor}
                        strokeWidth={lineThickness * 0.85}
                        strokeLinecap="round"
                        opacity={diagonalOpacity}
                        style={{
                          filter: `drop-shadow(0 0 ${Math.max(
                            0.3,
                            lineThickness * 1.15
                          )}px ${sparkle.haloColor})`,
                        }}
                      />
                      <line
                        x1={lineLength * 0.6}
                        y1={-lineLength * 0.6}
                        x2={-lineLength * 0.6}
                        y2={lineLength * 0.6}
                        stroke={sparkle.haloColor}
                        strokeWidth={lineThickness * 0.85}
                        strokeLinecap="round"
                        opacity={diagonalOpacity}
                        style={{
                          filter: `drop-shadow(0 0 ${Math.max(
                            0.3,
                            lineThickness * 1.15
                          )}px ${sparkle.haloColor})`,
                        }}
                      />
                      <circle
                        cx="0"
                        cy="0"
                        r={coreRadius}
                        fill="#ffffff"
                        opacity={coreOpacity}
                        style={{
                          filter: `drop-shadow(0 0 ${coreGlow}px ${sparkle.haloColor})`,
                        }}
                      />
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        </g>
      </svg>
    </div>
  );
}
