import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/*
 * Small, dependency-free SVG charts for the console (air-gapped build: no
 * chart library to vendor). They follow the dataviz rules the design system
 * adopted: thin marks, 2px lines, 4px rounded data-ends anchored to the
 * baseline, 2px surface gaps, a recessive grid, one y-axis, text in ink
 * tokens (never the series colour), a legend for ≥ 2 series, and a hover
 * tooltip on every plotted form.
 *
 * Colours are passed as CSS values (normally `var(--color-chart-n)` or a
 * status token) so every chart stays on the theme.
 */

export interface Series {
  key: string;
  label: string;
  color: string;
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry!.contentRect.width)));
    ro.observe(el);
    setWidth(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** Round a max up to a "nice" axis ceiling and return evenly spaced ticks. */
function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / count;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough) ?? rough;
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => +(i * step).toFixed(6));
}

export function ChartLegend({ items }: { items: Array<{ label: string; color: string; value?: ReactNode }> }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-2 text-muted-foreground">
          <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: i.color }} aria-hidden />
          {i.label}
          {i.value !== undefined && <span className="font-semibold text-foreground tabular-nums">{i.value}</span>}
        </li>
      ))}
    </ul>
  );
}

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  // Flip to the left of the pointer when it would overflow the plot.
  const flip = x > width - 170;
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 min-w-36 rounded-control border border-hairline bg-card px-3 py-2 text-xs text-foreground"
      style={{ left: flip ? undefined : x + 12, right: flip ? width - x + 12 : undefined, top: Math.max(0, y - 12) }}
    >
      {children}
    </div>
  );
}

function TooltipRow({ color, label, value }: { color: string; label: string; value: ReactNode }) {
  return (
    <div className="mt-1 flex items-center justify-between gap-4">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <span className="h-2 w-2 rounded-[2px]" style={{ background: color }} aria-hidden />
        {label}
      </span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

export function ChartEmpty({ children, height }: { children: ReactNode; height: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-control border border-dashed border-input px-6 text-center text-xs text-muted-foreground"
      style={{ height }}
    >
      {children}
    </div>
  );
}

const M = { top: 10, right: 12, bottom: 24, left: 34 };

/* ------------------------------------------------------------------ */
/* Line chart — change over time, one shared y-axis, crosshair tooltip */
/* ------------------------------------------------------------------ */

export function LineChart({
  data,
  series,
  height = 220,
  yMax,
  formatX,
  formatY = (v) => String(v),
  empty,
  ariaLabel,
}: {
  data: Array<{ x: number } & Record<string, number>>;
  series: Series[];
  height?: number;
  /** Fixed ceiling (e.g. seat capacity) instead of fitting the data. */
  yMax?: number;
  formatX: (x: number) => string;
  formatY?: (y: number) => string;
  empty: ReactNode;
  ariaLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  if (data.length < 2) {
    return (
      <div ref={ref}>
        <ChartEmpty height={height}>{empty}</ChartEmpty>
      </div>
    );
  }

  const dataMax = Math.max(1, ...data.flatMap((d) => series.map((s) => d[s.key] ?? 0)));
  // A fixed ceiling (capacity) is the top of the scale exactly; gridlines
  // stay on round steps below it rather than overshooting to the next one.
  const ticks = yMax ? niceTicks(yMax, 4).filter((t) => t <= yMax) : niceTicks(dataMax);
  const top = yMax ?? ticks[ticks.length - 1]!;
  const x0 = data[0]!.x;
  const x1 = data[data.length - 1]!.x;
  const plotW = Math.max(0, width - M.left - M.right);
  const plotH = height - M.top - M.bottom;
  const sx = (x: number) => M.left + (x1 === x0 ? plotW / 2 : ((x - x0) / (x1 - x0)) * plotW);
  const sy = (y: number) => M.top + plotH - (y / top) * plotH;
  const xTickCount = Math.min(5, data.length);
  const xTicks = Array.from({ length: xTickCount }, (_, i) => data[Math.round((i / Math.max(1, xTickCount - 1)) * (data.length - 1))]!.x);

  function onMove(e: React.PointerEvent<SVGRectElement>): void {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left + M.left;
    let best = 0;
    for (let i = 1; i < data.length; i++) if (Math.abs(sx(data[i]!.x) - px) < Math.abs(sx(data[best]!.x) - px)) best = i;
    setHover(best);
  }

  const h = hover !== null ? data[hover] : undefined;

  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block overflow-visible">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={width - M.right} y1={sy(t)} y2={sy(t)} stroke="var(--color-chart-grid)" />
              <text x={M.left - 8} y={sy(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
                {formatY(t)}
              </text>
            </g>
          ))}
          {xTicks.map((x, i) => (
            <text
              key={`${x}-${i}`}
              x={sx(x)}
              y={height - 6}
              textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
              className="fill-muted-foreground text-[10px] tabular-nums"
            >
              {formatX(x)}
            </text>
          ))}
          {series.map((s) => (
            <path
              key={s.key}
              d={data.map((d, i) => `${i === 0 ? 'M' : 'L'}${sx(d.x).toFixed(1)},${sy(d[s.key] ?? 0).toFixed(1)}`).join('')}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {h && (
            <g>
              <line x1={sx(h.x)} x2={sx(h.x)} y1={M.top} y2={M.top + plotH} stroke="var(--color-muted-foreground)" strokeOpacity={0.4} />
              {series.map((s) => (
                <circle key={s.key} cx={sx(h.x)} cy={sy(h[s.key] ?? 0)} r={4} fill={s.color} stroke="var(--color-card)" strokeWidth={2} />
              ))}
            </g>
          )}
          <rect
            x={M.left}
            y={M.top}
            width={plotW}
            height={plotH}
            fill="transparent"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
      )}
      {h && (
        <Tooltip x={sx(h.x)} y={M.top} width={width}>
          <div className="font-semibold">{formatX(h.x)}</div>
          {series.map((s) => (
            <TooltipRow key={s.key} color={s.color} label={s.label} value={formatY(h[s.key] ?? 0)} />
          ))}
        </Tooltip>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Column chart — magnitude per category (e.g. per day)               */
/* ------------------------------------------------------------------ */

export function ColumnChart({
  data,
  color,
  label,
  height = 220,
  empty,
  ariaLabel,
  showValues = false,
}: {
  data: Array<{ key: string; label: string; value: number; detail?: string }>;
  color: string;
  /** What one unit is, for the tooltip ("submissions"). */
  label: string;
  height?: number;
  empty: ReactNode;
  ariaLabel: string;
  /** Print each value above its column (and drop the y-axis labels). */
  showValues?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  if (data.every((d) => d.value === 0)) {
    return (
      <div ref={ref}>
        <ChartEmpty height={height}>{empty}</ChartEmpty>
      </div>
    );
  }

  const ML = showValues ? 6 : M.left;
  const ticks = niceTicks(Math.max(1, ...data.map((d) => d.value)));
  const top = ticks[ticks.length - 1]!;
  const plotW = Math.max(0, width - ML - M.right);
  const plotH = height - M.top - M.bottom;
  const band = plotW / data.length;
  const barW = Math.max(4, Math.min(28, band * 0.6));
  const sy = (y: number) => M.top + plotH - (y / top) * plotH;
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(plotW / 44)));

  // A column with a 4px-rounded top, square at the baseline.
  function barPath(x: number, y: number, w: number, h: number): string {
    const r = Math.min(4, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }

  const h = hover !== null ? data[hover] : undefined;

  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block overflow-visible">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={ML} x2={width - M.right} y1={sy(t)} y2={sy(t)} stroke="var(--color-chart-grid)" />
              {!showValues && (
                <text x={ML - 8} y={sy(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
                  {t}
                </text>
              )}
            </g>
          ))}
          {data.map((d, i) => {
            const cx = ML + band * i + band / 2;
            const barH = (d.value / top) * plotH;
            return (
              <g key={d.key} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
                {/* Hit target spans the whole band, not just the bar. */}
                <rect x={ML + band * i} y={M.top} width={band} height={plotH} fill="transparent" />
                {d.value > 0 && (
                  <path
                    d={barPath(cx - barW / 2, sy(d.value), barW, barH)}
                    fill={color}
                    fillOpacity={hover === null || hover === i ? 1 : 0.45}
                  />
                )}
                {showValues && d.value > 0 && (
                  <text x={cx} y={sy(d.value) - 6} textAnchor="middle" className="fill-foreground text-[10px] font-semibold tabular-nums">
                    {d.value}
                  </text>
                )}
                {i % labelEvery === 0 && (
                  <text x={cx} y={height - 6} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                    {d.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {h && hover !== null && (
        <Tooltip x={ML + band * hover + band / 2} y={M.top} width={width}>
          <div className="font-semibold">{h.detail ?? h.label}</div>
          <TooltipRow color={color} label={label} value={h.value} />
        </Tooltip>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bar list — ranked horizontal bars, every value labelled            */
/* ------------------------------------------------------------------ */

export function BarList({
  data,
  color,
  max,
  formatValue = (v) => String(v),
  empty,
  height = 220,
}: {
  data: Array<{ key: string; label: string; value: number; note?: string }>;
  color: string;
  /** Fixed scale (e.g. 100 for percentages) instead of the largest value. */
  max?: number;
  formatValue?: (v: number) => string;
  empty: ReactNode;
  height?: number;
}) {
  if (data.length === 0) return <ChartEmpty height={height}>{empty}</ChartEmpty>;
  const scale = max ?? Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="space-y-3.5">
      {data.map((d) => (
        <li key={d.key}>
          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate font-medium text-foreground">{d.label}</span>
            <span className="shrink-0 tabular-nums">
              <span className="font-semibold text-foreground">{formatValue(d.value)}</span>
              {d.note && <span className="ml-1.5 text-muted-foreground">{d.note}</span>}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-pill bg-muted" title={`${d.label}: ${formatValue(d.value)}`}>
            <div className="h-full rounded-pill" style={{ width: `${Math.max(2, (d.value / scale) * 100)}%`, background: color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Donut — parts of a whole (state mix), total in the centre          */
/* ------------------------------------------------------------------ */

export function DonutChart({
  data,
  size = 180,
  thickness = 22,
  centerLabel,
  ariaLabel,
  className,
}: {
  data: Array<{ key: string; label: string; value: number; color: string }>;
  size?: number;
  thickness?: number;
  centerLabel: string;
  ariaLabel: string;
  className?: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const total = data.reduce((n, d) => n + d.value, 0);
  const r = size / 2 - 2;
  const inner = r - thickness;
  const c = size / 2;
  const visible = data.filter((d) => d.value > 0);

  function arc(start: number, end: number): string {
    const a0 = start * 2 * Math.PI - Math.PI / 2;
    const a1 = end * 2 * Math.PI - Math.PI / 2;
    const large = end - start > 0.5 ? 1 : 0;
    const p = (rad: number, a: number) => `${(c + rad * Math.cos(a)).toFixed(2)},${(c + rad * Math.sin(a)).toFixed(2)}`;
    return `M${p(r, a0)}A${r},${r} 0 ${large} 1 ${p(r, a1)}L${p(inner, a1)}A${inner},${inner} 0 ${large} 0 ${p(inner, a0)}Z`;
  }

  let acc = 0;
  const active = hover ? data.find((d) => d.key === hover) : undefined;

  return (
    <div className={cn('relative shrink-0', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} role="img" aria-label={ariaLabel}>
        {total === 0 ? (
          <circle cx={c} cy={c} r={r - thickness / 2} fill="none" stroke="var(--color-muted)" strokeWidth={thickness} />
        ) : visible.length === 1 ? (
          <circle cx={c} cy={c} r={r - thickness / 2} fill="none" stroke={visible[0]!.color} strokeWidth={thickness} />
        ) : (
          visible.map((d) => {
            const start = acc / total;
            acc += d.value;
            const end = acc / total;
            return (
              <path
                key={d.key}
                d={arc(start, end)}
                fill={d.color}
                // 2px surface gap between segments.
                stroke="var(--color-card)"
                strokeWidth={2}
                opacity={hover === null || hover === d.key ? 1 : 0.4}
                onPointerEnter={() => setHover(d.key)}
                onPointerLeave={() => setHover(null)}
              >
                <title>{`${d.label}: ${d.value}`}</title>
              </path>
            );
          })
        )}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-2xl font-bold leading-none text-foreground tabular-nums">{active ? active.value : total}</span>
        <span className="mt-1 max-w-[70%] text-[11px] leading-tight text-muted-foreground">{active ? active.label : centerLabel}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sparklines — the trend inside a stat card (no axes)                */
/* ------------------------------------------------------------------ */

export function SparkLine({
  values,
  color,
  width = 132,
  height = 48,
  ariaLabel,
}: {
  values: number[];
  color: string;
  width?: number;
  height?: number;
  ariaLabel: string;
}) {
  if (values.length < 2) return <div style={{ width, height }} aria-hidden />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 4;
  const pts = values.map((v, i): [number, number] => [
    pad + (i / (values.length - 1)) * (width - pad * 2),
    pad + (1 - (v - min) / span) * (height - pad * 2),
  ]);
  // Smooth with a Catmull-Rom to cubic Bezier pass.
  let d = `M${pts[0]![0].toFixed(1)},${pts[0]![1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  const last = pts[pts.length - 1]!;
  return (
    <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block shrink-0 overflow-visible">
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={3.5} fill={color} stroke="var(--color-card)" strokeWidth={2} />
    </svg>
  );
}

export function SparkBars({
  values,
  labels,
  color,
  width = 132,
  height = 48,
  ariaLabel,
}: {
  values: number[];
  /** Per-bar hover text. */
  labels?: string[];
  color: string;
  width?: number;
  height?: number;
  ariaLabel: string;
}) {
  const max = Math.max(1, ...values);
  const gap = 3;
  const barW = Math.max(3, (width - gap * (values.length - 1)) / values.length);
  return (
    <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block shrink-0">
      {values.map((v, i) => {
        const h = Math.max(v > 0 ? 3 : 2, (v / max) * height);
        const x = i * (barW + gap);
        const r = Math.min(2, barW / 2, h);
        return (
          <path
            key={i}
            d={`M${x},${height}V${height - h + r}Q${x},${height - h} ${x + r},${height - h}H${x + barW - r}Q${x + barW},${height - h} ${x + barW},${height - h + r}V${height}Z`}
            fill={v > 0 ? color : 'var(--color-muted)'}
          >
            {labels?.[i] && <title>{labels[i]}</title>}
          </path>
        );
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Radar — one measure across 3+ comparable categories                */
/* ------------------------------------------------------------------ */

export function RadarChart({
  axes,
  color,
  max = 100,
  size = 300,
  formatValue = (v) => String(v),
  ariaLabel,
}: {
  /** `value: null` = no data for that axis (drawn at the centre, tagged "—"). */
  axes: Array<{ key: string; label: string; value: number | null }>;
  color: string;
  max?: number;
  size?: number;
  formatValue?: (v: number) => string;
  ariaLabel: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const c = size / 2;
  const r = size / 2 - 46; // room for axis labels
  const n = axes.length;
  const angle = (i: number) => (i / n) * 2 * Math.PI - Math.PI / 2;
  const pt = (i: number, frac: number): [number, number] => [c + r * frac * Math.cos(angle(i)), c + r * frac * Math.sin(angle(i))];
  const rings = [0.25, 0.5, 0.75, 1];
  const shape = axes.map((a, i) => pt(i, Math.max(0, Math.min(1, (a.value ?? 0) / max))));

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto block w-full max-w-[320px] overflow-visible" role="img" aria-label={ariaLabel}>
      {rings.map((f) => (
        <polygon key={f} points={axes.map((_, i) => pt(i, f).join(',')).join(' ')} fill="none" stroke="var(--color-chart-grid)" strokeWidth={1} />
      ))}
      {axes.map((_, i) => {
        const [x, y] = pt(i, 1);
        return <line key={i} x1={c} y1={c} x2={x} y2={y} stroke="var(--color-chart-grid)" />;
      })}
      {/* Scale labels sit on the bisector between the first two axes, so
          they never collide with a value tag (tags always sit on an axis). */}
      {rings.map((f) => {
        const mid = Math.PI / n - Math.PI / 2;
        // Distance of the ring's edge from the centre along the bisector.
        const d = r * f * Math.cos(Math.PI / n);
        return (
          <text
            key={`t${f}`}
            x={c + d * Math.cos(mid)}
            y={c + d * Math.sin(mid)}
            dx={3}
            dy="-0.25em"
            className="fill-muted-foreground text-[9px] tabular-nums"
          >
            {formatValue(Math.round(max * f))}
          </text>
        );
      })}
      <polygon
        points={shape.map((p) => p.join(',')).join(' ')}
        fill={color}
        fillOpacity={0.14}
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {axes.map((a, i) => {
        const [px, py] = shape[i]!;
        const [lx, ly] = pt(i, 1.22);
        const anchor = Math.abs(lx - c) < 4 ? 'middle' : lx > c ? 'start' : 'end';
        const label = a.value === null ? '—' : formatValue(a.value);
        const w = label.length * 6.4 + 12;
        return (
          <g key={a.key} onPointerEnter={() => setHover(a.key)} onPointerLeave={() => setHover(null)}>
            <text x={lx} y={ly} textAnchor={anchor} dy="0.35em" className="fill-muted-foreground text-[11px]">
              {a.label}
            </text>
            {/* Value tag at the vertex: ink text on a card chip, outlined in the series colour. */}
            <rect x={px - w / 2} y={py - 9} width={w} height={18} rx={4} fill="var(--color-card)" stroke={color} strokeWidth={hover === a.key ? 2 : 1.25} />
            <text x={px} y={py} textAnchor="middle" dy="0.35em" className="fill-foreground text-[10px] font-semibold tabular-nums">
              {label}
            </text>
            <title>{`${a.label}: ${a.value === null ? 'no scored work yet' : formatValue(a.value)}`}</title>
          </g>
        );
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Radial rings — a few "x of capacity" measures, concentric          */
/* ------------------------------------------------------------------ */

export function RadialRings({
  rings,
  size = 240,
  thickness = 12,
  centerValue,
  centerLabel,
  ariaLabel,
}: {
  /** Outermost first. `value / max` sets the sweep. */
  rings: Array<{ key: string; label: string; value: number; max: number; color: string }>;
  size?: number;
  thickness?: number;
  centerValue: ReactNode;
  centerLabel: string;
  ariaLabel: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const c = size / 2;
  const gap = 6;
  const active = hover ? rings.find((r) => r.key === hover) : undefined;

  return (
    <div className="relative mx-auto shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} role="img" aria-label={ariaLabel} className="-rotate-90">
        {rings.map((ring, i) => {
          const rad = c - thickness / 2 - 2 - i * (thickness + gap);
          const circ = 2 * Math.PI * rad;
          const frac = ring.max > 0 ? Math.min(1, ring.value / ring.max) : 0;
          return (
            <g key={ring.key} onPointerEnter={() => setHover(ring.key)} onPointerLeave={() => setHover(null)}>
              <circle cx={c} cy={c} r={rad} fill="none" stroke="var(--color-muted)" strokeWidth={thickness} />
              {frac > 0 && (
                <circle
                  cx={c}
                  cy={c}
                  r={rad}
                  fill="none"
                  stroke={ring.color}
                  strokeWidth={thickness}
                  strokeLinecap="round"
                  strokeDasharray={`${frac * circ} ${circ}`}
                  opacity={hover === null || hover === ring.key ? 1 : 0.35}
                />
              )}
              <title>{`${ring.label}: ${ring.value} of ${ring.max}`}</title>
            </g>
          );
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="max-w-[60%] text-xs font-semibold text-muted-foreground">{active ? active.label : centerLabel}</span>
        <span className="mt-1 text-2xl font-bold leading-none text-foreground tabular-nums">{active ? `${active.value}/${active.max}` : centerValue}</span>
      </div>
    </div>
  );
}
