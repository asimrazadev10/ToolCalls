import type {
  AgentToolPart,
  AirToolPart,
  PollenToolPart,
  SunToolPart,
  WeatherToolPart,
} from '@/lib/ai/types';
import {
  AQI_STOPS,
  GUIDELINE_FULL_SCALE,
  GUIDELINE_STOPS,
  MIN_BAR_PERCENT,
  POLLEN_FULL_SCALE,
  POLLEN_STOPS,
  RADAR_STOPS,
  type Stop,
  UV_FULL_SCALE,
  UV_STOPS,
  WEEKDAYS,
} from '@/lib/ui/constants';

type Ok<P extends AgentToolPart> = Extract<
  NonNullable<Extract<P, { state: 'output-available' }>['output']>,
  { status: 'ok' }
>;
type Report = Ok<WeatherToolPart>;
type Reading = Ok<AirToolPart>;
type Sun = Ok<SunToolPart>;
type Pollen = Ok<PollenToolPart>;

/**
 * Stops are ordered high to low, so the first match wins. A value below the
 * last stop (or NaN) takes the calmest colour rather than crashing the render.
 */
const pick = (stops: readonly Stop[], value: number) =>
  stops.find((stop) => value >= stop.from)?.color ?? stops.at(-1)?.color ?? 'var(--r0)';

/** "2026-08-19" -> "wed 19". Parsed as UTC so the label never shifts by zone. */
function dayLabel(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}`;
}

/** "30.1°C" -> ["30.1", "°C"], so the unit can be set smaller than the numerals. */
function splitUnit(v: string): [string, string] {
  const m = v.match(/^(-?[\d.]+)(.*)$/);
  return m ? [m[1], m[2]] : [v, ''];
}

function Meter({ percent, color, label, delay }: {
  percent: number;
  color: string;
  label: string;
  delay: number;
}) {
  return (
    <span className="meter">
      <span className="meter__track">
        <span
          className="meter__fill"
          style={{
            width: `${Math.min(Math.max(percent, MIN_BAR_PERCENT), 100)}%`,
            ['--bar' as string]: color,
            animationDelay: `${delay}ms`,
          }}
        />
      </span>
      <span className="meter__v">{label}</span>
    </span>
  );
}

export function ToolCall({ part }: { part: AgentToolPart }) {
  const settled = part.state === 'output-available' || part.state === 'output-error';
  const failed =
    part.state === 'output-error' ||
    (part.state === 'output-available' && part.output.status === 'error');

  const state = !settled ? (
    <span className="tool__wait">reading station</span>
  ) : failed ? (
    'failed'
  ) : (
    'ok'
  );

  return (
    <div>
      <div className="tool">
        <span className="tool__name">▸ {part.type.slice('tool-'.length)}</span>
        {part.input?.location && (
          <span className="tool__arg">location &quot;{part.input.location}&quot;</span>
        )}
        {(part.type === 'tool-getWeather' || part.type === 'tool-getSunAndUV') &&
          part.input?.forecastDays && (
            <span className="tool__arg">{part.input.forecastDays}d</span>
          )}
        <span className="tool__state" data-ok={!failed}>
          {state}
        </span>
      </div>
      <ToolOutput part={part} />
    </div>
  );
}

/**
 * Switches on `part.type` rather than inspecting `part.output` first: the two
 * are correlated in the union, and narrowing the output alone loses that link.
 * A new tool added to the registry surfaces here as a missing case.
 */
function ToolOutput({ part }: { part: AgentToolPart }) {
  if (part.state === 'output-error') {
    return (
      <FaultCard
        error={part.errorText}
        suggestion="Ask again to retry the reading."
        retryable
      />
    );
  }

  if (part.state !== 'output-available') return null;

  switch (part.type) {
    case 'tool-getWeather':
      return part.output.status === 'ok' ? (
        <StationCard report={part.output} />
      ) : (
        <FaultCard {...part.output} />
      );

    case 'tool-getAirQuality':
      return part.output.status === 'ok' ? (
        <AirCard reading={part.output} />
      ) : (
        <FaultCard {...part.output} />
      );

    case 'tool-getSunAndUV':
      return part.output.status === 'ok' ? (
        <SunCard sun={part.output} />
      ) : (
        <FaultCard {...part.output} />
      );

    case 'tool-getPollen':
      return part.output.status === 'ok' ? (
        <PollenCard pollen={part.output} />
      ) : (
        <FaultCard {...part.output} />
      );
  }
}

function CardHead({ place, zone }: { place: string; zone: string }) {
  return (
    <div className="station__head">
      <h3 className="station__place">{place}</h3>
      <span className="station__zone">{zone}</span>
    </div>
  );
}

function StationCard({ report }: { report: Report }) {
  const [temp, unit] = splitUnit(report.current.temperature);

  return (
    <figure className="station">
      <CardHead place={report.location} zone={report.timezone} />

      <div className="station__now">
        <div className="station__temp">
          {temp}
          <span className="station__unit">{unit}</span>
        </div>
        <div>
          <div className="station__cond">{report.current.conditions}</div>
          <div className="station__stats">
            <Stat label="humidity" value={report.current.humidity} />
            <Stat label="wind" value={report.current.windSpeed} />
            <Stat label="observed" value={report.current.observedAt.split('T')[1]} />
          </div>
        </div>
      </div>

      <div className="rows">
        {report.forecast.map((day, i) => {
          const pct = Number.parseFloat(day.precipitationChance) || 0;

          return (
            // Rows arrive in sequence, like paper feeding out of a printer.
            <div className="row" key={day.date} style={{ animationDelay: `${240 + i * 55}ms` }}>
              <span className="row__key">{dayLabel(day.date)}</span>
              <span className="row__label">{day.conditions}</span>
              <Meter
                percent={pct}
                color={pick(RADAR_STOPS, pct)}
                label={day.precipitationChance}
                delay={420 + i * 55}
              />
              <span className="row__aside">
                {day.high} <span>/</span> {day.low}
              </span>
            </div>
          );
        })}
      </div>
    </figure>
  );
}

function AirCard({ reading }: { reading: Reading }) {
  const { value, band, scale } = reading.index;

  return (
    <figure className="station">
      <CardHead place={reading.location} zone={reading.timezone} />

      <div className="station__now">
        <div className="station__temp">{value ?? '—'}</div>
        <div>
          <div
            className="station__cond"
            style={value === null ? undefined : { color: pick(AQI_STOPS, value) }}
          >
            {band}
          </div>
          <div className="station__stats">
            <Stat label="scale" value={scale} />
            <Stat label="observed" value={reading.observedAt.split('T')[1]} />
          </div>
        </div>
      </div>

      <div className="rows">
        {reading.pollutants.map((p, i) => (
          <div className="row" key={p.name} style={{ animationDelay: `${240 + i * 55}ms` }}>
            <span className="row__key">{p.name}</span>
            <span className="row__label row__label--num">{p.value}</span>
            {p.ratio === null ? (
              <span className="meter" />
            ) : (
              <Meter
                percent={(p.ratio / GUIDELINE_FULL_SCALE) * 100}
                color={pick(GUIDELINE_STOPS, p.ratio)}
                label={`${p.ratio}×`}
                delay={420 + i * 55}
              />
            )}
            <span className="row__aside">
              <span className="u-label">who</span>
              {p.whoGuideline}
            </span>
          </div>
        ))}
      </div>
    </figure>
  );
}

function SunCard({ sun }: { sun: Sun }) {
  const { uvIndex, uvBand, daylight, observedAt } = sun.current;

  return (
    <figure className="station">
      <CardHead place={sun.location} zone={sun.timezone} />

      <div className="station__now">
        <div className="station__temp">{uvIndex ?? '—'}</div>
        <div>
          <div
            className="station__cond"
            style={uvIndex === null ? undefined : { color: pick(UV_STOPS, uvIndex) }}
          >
            {uvBand} uv
          </div>
          <div className="station__stats">
            <Stat label="right now" value={daylight} />
            <Stat label="observed" value={observedAt.split('T')[1] ?? observedAt} />
          </div>
        </div>
      </div>

      <div className="rows">
        {sun.days.map((day, i) => (
          <div className="row" key={day.date} style={{ animationDelay: `${240 + i * 55}ms` }}>
            <span className="row__key">{dayLabel(day.date)}</span>
            <span className="row__label row__label--num">
              {day.sunrise} – {day.sunset}
            </span>
            {day.peakUv === null ? (
              <span className="meter" />
            ) : (
              <Meter
                percent={(day.peakUv / UV_FULL_SCALE) * 100}
                color={pick(UV_STOPS, day.peakUv)}
                label={`uv ${day.peakUv}`}
                delay={420 + i * 55}
              />
            )}
            <span className="row__aside">{day.daylight}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}

function PollenCard({ pollen }: { pollen: Pollen }) {
  // No single pollen index exists, so the headline is whichever species is
  // closest to the level people react at — the one that will actually bother you.
  const worst = pollen.species.reduce<Pollen['species'][number] | null>(
    (peak, s) => (s.ratio !== null && (peak?.ratio ?? -1) < s.ratio ? s : peak),
    null,
  );

  return (
    <figure className="station">
      <CardHead place={pollen.location} zone={pollen.timezone} />

      <div className="station__now">
        <div className="station__temp">{worst ? splitUnit(worst.value)[0] : '—'}</div>
        <div>
          <div
            className="station__cond"
            style={
              worst?.ratio == null ? undefined : { color: pick(POLLEN_STOPS, worst.ratio) }
            }
          >
            {worst ? `${worst.name} leading` : 'no reading'}
          </div>
          <div className="station__stats">
            <Stat label="scale" value="grains/m³" />
            <Stat
              label="observed"
              value={pollen.observedAt.split('T')[1] ?? pollen.observedAt}
            />
          </div>
        </div>
      </div>

      <div className="rows">
        {pollen.species.map((s, i) => (
          <div className="row" key={s.name} style={{ animationDelay: `${240 + i * 55}ms` }}>
            <span className="row__key">{s.name}</span>
            <span className="row__label row__label--num">{s.value}</span>
            {s.ratio === null ? (
              <span className="meter" />
            ) : (
              <Meter
                percent={(s.ratio / POLLEN_FULL_SCALE) * 100}
                color={pick(POLLEN_STOPS, s.ratio)}
                label={`${s.ratio}×`}
                delay={420 + i * 55}
              />
            )}
            <span className="row__aside">
              <span className="u-label">high</span>
              {s.highThreshold}
            </span>
          </div>
        ))}
      </div>
    </figure>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="stat">
      <span className="u-label">{label}</span>
      <span className="stat__v">{value}</span>
    </span>
  );
}

/** A failed call is shown, not hidden: what broke, and what to do about it. */
function FaultCard({
  error,
  suggestion,
  retryable,
}: {
  error: string;
  suggestion: string;
  retryable: boolean;
}) {
  return (
    <div className="fault" role="status">
      <span className="u-label">{retryable ? 'station unreachable' : 'no reading'}</span>
      <p className="fault__what">{error}</p>
      <p className="fault__fix">{suggestion}</p>
    </div>
  );
}
