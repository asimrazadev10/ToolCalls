import { BAROGRAPH } from '@/lib/ui/constants';

/**
 * A barograph writes atmospheric pressure onto paper wrapped around a turning
 * drum. Here the drum scrolls left under a fixed "now" cursor, and the trace
 * lifts and turns radar-teal while a briefing is being built — which is why
 * there is no spinner anywhere else in the app.
 */

const { tile: TILE, height: H } = BAROGRAPH;
const MID = H / 2;

/** Seeded LCG: the path must match on server and client or hydration flags it. */
function lcg(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/**
 * An AR(1) walk, so pressure drifts rather than jumping. Detrended at the end so
 * the last point equals the first, which is what lets the tile repeat seamlessly.
 */
function trace(seed: number, amplitude: number, steps = BAROGRAPH.steps) {
  const rnd = lcg(seed);
  const ys: number[] = [];
  let v = 0;

  for (let i = 0; i <= steps; i++) {
    v = v * 0.78 + (rnd() - 0.5) * amplitude;
    ys.push(v);
  }

  const drift = (ys[steps] - ys[0]) / steps;
  return ys.map((y, i) => MID + (y - drift * i));
}

/** Smooths through midpoints so the line reads as ink from a pen, not a chart. */
function toPath(ys: number[]) {
  const step = TILE / (ys.length - 1);
  const pts = [...ys, ...ys.slice(1)].map((y, i) => [i * step, y] as const);

  let d = `M ${pts[0][0]} ${pts[0][1].toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    d += ` Q ${px.toFixed(1)} ${py.toFixed(2)} ${((px + cx) / 2).toFixed(1)} ${(
      (py + cy) / 2
    ).toFixed(2)}`;
  }
  return d;
}

const INK_PATH = toPath(trace(BAROGRAPH.inkSeed, BAROGRAPH.inkAmplitude));
const GHOST_PATH = toPath(trace(BAROGRAPH.ghostSeed, BAROGRAPH.ghostAmplitude));
const RULES = Array.from({ length: BAROGRAPH.ruleCount }, (_, i) => i * BAROGRAPH.rulePitch);
const CURSOR_X = TILE - BAROGRAPH.cursorInset;

export function Barograph({ active }: { active: boolean }) {
  return (
    <svg
      className="baro"
      viewBox={`0 0 ${TILE} ${H}`}
      preserveAspectRatio="none"
      data-active={active}
      aria-hidden="true"
    >
      <g className="baro__drum">
        {RULES.map((x) => (
          <line
            key={x}
            className="baro__grid"
            x1={x}
            y1={10}
            x2={x}
            y2={H - 10}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>

      <g className="baro__drum baro__drum--slow">
        <path className="baro__ghost" d={GHOST_PATH} vectorEffect="non-scaling-stroke" />
      </g>

      {/* Outer group scrolls, inner group scales amplitude, so the two transforms
          never overwrite each other. */}
      <g className="baro__drum">
        <g className="baro__amp">
          <path className="baro__trace" d={INK_PATH} vectorEffect="non-scaling-stroke" />
        </g>
      </g>

      <line
        className="baro__cursor"
        x1={CURSOR_X}
        y1={6}
        x2={CURSOR_X}
        y2={H - 6}
        vectorEffect="non-scaling-stroke"
      />
      <rect className="baro__cursor-cap" x={CURSOR_X - 3} y={6} width={6} height={2} />
      <rect className="baro__cursor-cap" x={CURSOR_X - 3} y={H - 8} width={6} height={2} />
    </svg>
  );
}
