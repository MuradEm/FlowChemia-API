// Versioned first application model. No reviewer calibration or outlier suppression.
export const MODEL_VERSION = "baseline-70-v1";
export const STAR_POINTS = [0, 30, 50, 65, 80, 100] as const;
const DAY = 86400000;
export type Observation = {
  author: string;
  subject: string;
  key: string;
  time: number;
  points: number;
  weight: number;
};
export type Estimate = {
  score: number;
  reports: number;
  reviewers: number;
  firstAt: string | null;
  lastAt: string | null;
};
export type Indicator = {
  state: "UNKNOWN" | "EARLY" | "OLDER" | "POSITIVE" | "MIXED" | "DIFFICULT";
  label: string;
  tone: "UNKNOWN" | "POSITIVE" | "MIXED" | "DIFFICULT";
  reports: number;
  reviewers: number;
  firstAt: string | null;
  lastAt: string | null;
};

export function estimate(observations: Observation[], now: number): Estimate {
  const units = new Map<
    string,
    { total: number; weight: number; time: number; author: string }
  >();
  for (const row of observations) {
    if (row.time > now || row.weight <= 0) continue;
    // Monday-based UTC weeks cap repeated reporting by the same person/metric.
    const week = Math.floor((row.time + 3 * DAY) / (7 * DAY));
    const key = JSON.stringify([row.author, row.subject, row.key, week]);
    const unit = units.get(key) ?? {
      total: 0,
      weight: 0,
      time: row.time,
      author: row.author,
    };
    unit.total += row.points * row.weight;
    unit.weight += row.weight;
    unit.time = Math.max(unit.time, row.time);
    units.set(key, unit);
  }
  const rows = [...units.values()];
  if (!rows.length)
    return { score: 70, reports: 0, reviewers: 0, firstAt: null, lastAt: null };
  const first = rows.reduce((n, r) => Math.min(n, r.time), Infinity),
    latest = rows.reduce((n, r) => Math.max(n, r.time), -Infinity);
  // Anchor at newest evidence: equivalent exponential weighting without all
  // weights underflowing for old histories. The prior ages from first evidence.
  const decay = (time: number) => 2 ** (-(latest - time) / DAY / 42);
  let weight = 5 * decay(first),
    total = 70 * weight;
  for (const row of rows) {
    const w = Math.min(1, row.weight) * decay(row.time);
    total += (row.total / row.weight) * w;
    weight += w;
  }
  return {
    score: total / weight,
    reports: rows.length,
    reviewers: new Set(rows.map((r) => r.author)).size,
    firstAt: new Date(first).toISOString(),
    lastAt: new Date(latest).toISOString(),
  };
}
export function indicator(
  value: Estimate,
  now: number,
  direction = false,
  skills = false,
): Indicator {
  let state: Indicator["state"];
  if (!value.reports) state = "UNKNOWN";
  else if (now - Date.parse(value.lastAt!) > 126 * DAY) state = "OLDER";
  else if (
    value.reports < (direction ? 3 : 5) ||
    (!direction && value.reviewers < 2)
  )
    state = "EARLY";
  else
    state =
      value.score >= 80
        ? "POSITIVE"
        : value.score >= 65
          ? "MIXED"
          : "DIFFICULT";
  const tone = !value.reports
    ? "UNKNOWN"
    : value.score >= 80
      ? "POSITIVE"
      : value.score >= 65
        ? "MIXED"
        : "DIFFICULT";
  const labels = {
    UNKNOWN: "Not observed",
    EARLY: "Early feedback",
    OLDER: "Older feedback",
    POSITIVE: skills ? "Often demonstrated" : "Positive experience",
    MIXED: "Mixed observations",
    DIFFICULT: skills ? "May need support" : "Difficult experience",
  };
  // Explicit allow-list: numerical scores and source identities never leave the API.
  return {
    state,
    label: labels[tone],
    tone,
    reports: value.reports,
    reviewers: value.reviewers,
    firstAt: value.firstAt,
    lastAt: value.lastAt,
  };
}

export type SkillBand = "RED" | "ORANGE" | "YELLOW" | "LIGHT_GREEN" | "GREEN";
export function skillIndicator(
  value: Estimate,
  now: number,
): Indicator & { band: SkillBand | null } {
  const result = indicator(value, now, false, true);
  if (result.state === "UNKNOWN") return { ...result, band: null };
  // Shared boundaries belong to the next band: 20 is orange, 80 is green.
  const band: SkillBand =
    value.score < 20
      ? "RED"
      : value.score < 40
        ? "ORANGE"
        : value.score < 60
          ? "YELLOW"
          : value.score < 80
            ? "LIGHT_GREEN"
            : "GREEN";
  const label =
    band === "RED" || band === "ORANGE"
      ? "Room for improvement"
      : band === "YELLOW"
        ? "On the way"
        : "Doing well";
  return { ...result, label, band };
}
