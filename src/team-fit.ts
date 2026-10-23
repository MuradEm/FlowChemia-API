// Presentation-only team analysis. This does not change stored employee/pair scores.
export type FitPair = {
  first: string;
  second: string;
  points: number;
  established: boolean;
  observed?: boolean;
};
export type FitPerson = {
  id: string;
  name: string;
  bands: number[];
  limitedSkills?: boolean;
};
export function analyzeTeam(
  people: FitPerson[],
  selectedIds: string[],
  pairs: FitPair[],
  readable: Set<string>,
  viewerId: string,
) {
  const selected = new Set(selectedIds),
    totalPairs = (selected.size * (selected.size - 1)) / 2;
  const permitted = (a: string, b: string) =>
    a !== viewerId && b !== viewerId && readable.has(a) && readable.has(b);
  let visiblePairs = 0;
  const ids = [...selected];
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++)
      if (permitted(ids[i]!, ids[j]!)) visiblePairs++;
  const known = pairs.filter(
    (p) =>
      (p.observed ?? p.established) &&
      selected.has(p.first) &&
      selected.has(p.second) &&
      permitted(p.first, p.second),
  );
  const restricted = visiblePairs < totalPairs;
  const chemistry =
    totalPairs && !restricted && known.length
      ? Math.max(
          0,
          Math.min(
            100,
            Math.round(
              known.reduce((n, p) => n + p.points, 0) / known.length / 5,
            ) * 5,
          ),
        )
      : null;
  const evidence = restricted
    ? "RESTRICTED"
    : !known.length
      ? "NONE"
      : known.length === totalPairs && known.every((p) => p.established)
        ? "ESTABLISHED"
        : "LIMITED";
  const label = restricted
    ? "Team chemistry is private in this view"
    : !totalPairs
      ? "Select at least two employees"
      : chemistry === null
        ? "Not enough chemistry feedback"
        : chemistry >= 80
          ? "Good chemistry"
          : chemistry >= 60
            ? "Mixed chemistry"
            : "Chemistry may need attention";
  const teamwork =
    chemistry === null
      ? "More visible feedback is needed to assess teamwork"
      : known.filter((p) => p.established).length / totalPairs < 0.6
        ? "More feedback is needed to assess teamwork"
        : chemistry >= 80
          ? "Strong teamwork potential"
          : chemistry >= 60
            ? "Teamwork may need some support"
            : "Low teamwork signal; plan extra support";
  const mean = (values: number[]) =>
    values.reduce((a, b) => a + b, 0) / values.length;
  const recommendations = people
    .filter((p) => !selected.has(p.id))
    .map((person) => {
      const links = pairs.filter(
        (p) =>
          (p.observed ?? p.established) &&
          permitted(p.first, p.second) &&
          ((p.first === person.id && selected.has(p.second)) ||
            (p.second === person.id && selected.has(p.first))),
      );
      // Use the same five coarse categories as employee cards for ordering, never exact individual scores.
      const categories = links.map((p) =>
        Math.min(5, Math.floor(p.points / 20) + 1),
      );
      const allowed = ids.filter((id) => permitted(person.id, id)).length;
      const skill = person.bands.length ? mean(person.bands) : null;
      const chemistryFit = categories.length
        ? (categories.reduce((a, b) => a + b, 0) +
            3 * (allowed - categories.length)) /
          Math.max(1, allowed)
        : null;
      const value =
        chemistryFit !== null && skill !== null
          ? 0.7 * chemistryFit + 0.3 * skill
          : (chemistryFit ?? skill);
      const fit =
        value === null
          ? "UNKNOWN"
          : value >= 4.5
            ? "STRONG"
            : value >= 3.6
              ? "GOOD"
              : value >= 2.6
                ? "MIXED"
                : "CAUTION";
      const label =
        value === null
          ? "Not enough evidence"
          : !links.length
            ? skill! >= 3.6
              ? "Positive skill feedback · chemistry unknown"
              : "Skill feedback only · chemistry unknown"
            : fit === "STRONG"
              ? "Strong fit"
              : fit === "GOOD"
                ? "Good fit"
                : fit === "MIXED"
                  ? "Mixed fit"
                  : "May need support";
      const reasons = [
        links.length
          ? `${links.length} reported working relationship${links.length === 1 ? "" : "s"} with the selected team.`
          : "No comparable chemistry in your view.",
        ...(person.bands.length
          ? [
              `Current feedback in ${person.bands.length} skill${person.bands.length === 1 ? "" : "s"}.`,
            ]
          : []),
      ];
      return {
        membershipId: person.id,
        fit,
        label,
        limitedEvidence:
          links.some((p) => !p.established) ||
          links.length < ids.length ||
          !!person.limitedSkills,
        knownLinks: links.length,
        possibleLinks: ids.length,
        reasons,
        _value: value,
        _coverage: allowed ? links.length / allowed : 0,
        _name: person.name,
      };
    })
    .sort(
      (a, b) =>
        (b._value ?? -1) - (a._value ?? -1) ||
        b._coverage - a._coverage ||
        a._name.localeCompare(b._name, "en") ||
        a.membershipId.localeCompare(b.membershipId),
    )
    .map(({ _value, _coverage, _name, ...publicValue }) => publicValue);
  return {
    teamAnalysis: {
      chemistry,
      label,
      teamwork,
      evidence,
      knownPairs: known.length,
      totalPairs,
      visiblePairs,
    },
    recommendations,
  };
}
