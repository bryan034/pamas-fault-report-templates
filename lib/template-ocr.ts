/** Literal photo labels, optional measurement qualifiers, and ambiguity handling. */
export function extractQuotedReading(
  text: string,
  label: string,
  qualifier = "",
): number | null {
  const escape = (value: string) =>
    value
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .trim()
      .replace(/\s+/g, "\\s+");
  if (!label.trim()) return null;
  const lines = text.replace(/[−–]/g, "-").replace(/,/g, ".").split(/\r?\n/);
  const labelPattern = new RegExp(
    `(?:^|[^a-z0-9])${escape(label)}(?=$|[^a-z0-9])`,
    "ig",
  );
  const readings: number[] = [];
  for (let index = 0; index < lines.length; index++) {
    const matches = [...lines[index].matchAll(labelPattern)];
    for (const match of matches) {
      let tail = lines[index].slice((match.index ?? 0) + match[0].length);
      if (!tail.trim()) tail = lines.slice(index + 1, index + 3).join(" ");
      if (qualifier.trim()) {
        const measurement = tail.match(
          new RegExp(`(?:^|[^a-z0-9])${escape(qualifier)}(?=$|[^a-z0-9])`, "i"),
        );
        if (!measurement) continue;
        tail = tail.slice((measurement.index ?? 0) + measurement[0].length);
      }
      // Do not jump over another label or heading to reach a distant number.
      const number = tail.match(/^\s*[:=|]?\s*(-?\d{1,6}(?:\.\d+)?)(?!\d)/);
      if (number) readings.push(Number(number[1]));
    }
  }
  const unique = [...new Set(readings)];
  return unique.length === 1 ? unique[0] : null;
}
