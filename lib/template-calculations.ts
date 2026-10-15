import type { Definition, TemplateReport } from "./template-api";

export type CalculationProblem = { message: string; fieldIds: string[] };
export function calculationProblems(
  definition: Definition,
  values?: TemplateReport["values"],
): CalculationProblem[] {
  const fields = new Map(definition.fields.map((field) => [field.id, field]));
  const problems: CalculationProblem[] = [];
  for (const field of definition.fields) {
    if (field.kind !== "calculated") continue;
    const calc = field.calculation;
    const refs = calc?.fields || [];
    const involved = [field.id, ...refs.filter((id) => fields.has(id))];
    if (
      !calc ||
      refs.length === 0 ||
      (calc.operation !== "sum" && refs.length !== 2) ||
      refs.some((id) => fields.get(id)?.kind !== "number")
    ) {
      problems.push({
        message: `${field.label}: choose valid source number fields${refs.length ? ` (check ${refs.map((id) => fields.get(id)?.label || id || "unselected source").join(", ")})` : " for both operands"}.`,
        fieldIds: involved,
      });
      continue;
    }
    if (
      !values ||
      refs.some((id) => values[id] === undefined || values[id] === "")
    )
      continue;
    const numbers = refs.map((id) => Number(values[id]));
    if (numbers.some((n) => !Number.isFinite(n))) {
      problems.push({
        message: `${field.label}: check ${refs.map((id) => fields.get(id)!.label).join(", ")} — values must be finite numbers.`,
        fieldIds: involved,
      });
    } else if (calc.operation === "percentage" && numbers[1] === 0) {
      problems.push({
        message: `${field.label}: ${fields.get(refs[1])!.label} (denominator) cannot be zero.`,
        fieldIds: [field.id, refs[1]],
      });
    } else {
      const result =
        calc.operation === "sum"
          ? numbers.reduce((a, b) => a + b, 0)
          : calc.operation === "difference"
            ? numbers[0] - numbers[1]
            : (numbers[0] / numbers[1]) * 100;
      if (!Number.isFinite(result))
        problems.push({
          message: `${field.label}: calculation overflow; check ${refs.map((id) => fields.get(id)!.label).join(", ")}.`,
          fieldIds: involved,
        });
    }
  }
  return problems;
}
