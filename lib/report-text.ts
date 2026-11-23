/** Browser counterpart of PDF report explicit-line shrink-to-fit. Dimensions are points. */
export const reportFontFamily: Record<string, string> = {
  "Times-Roman": '"Times New Roman",serif',
  "Times-Bold": '"Times New Roman",serif',
  Helvetica: "Arial,sans-serif", "Helvetica-Bold": "Arial,sans-serif",
  Courier: '"Courier New",monospace',
};
export function fitReportText(context: CanvasRenderingContext2D, text: string, font: string, maximum: number, width: number, height: number) {
  const available = Math.max(.01, width - 2), vertical = Math.max(.01, height - 2);
  const setFont = (size: number) => { context.font = `${font.includes("Bold") ? "bold " : ""}${size}px ${reportFontFamily[font] || reportFontFamily["Times-Roman"]}`; };
  // Only explicit line breaks create another line. Width overflow shrinks text.
  const wrap = (size: number) => {
    setFont(size);
    return text.split("\n");
  };
  const fits = (size: number) => {
    const lines = wrap(size);
    return lines.length * size * 1.15 <= vertical && lines.every(line => context.measureText(line).width <= available + .00001);
  };
  let size = maximum;
  if (!fits(size)) {
    let low = 0, high = maximum;
    for (let i = 0; i < 32; i++) { const mid = (low + high) / 2; if (fits(mid)) low = mid; else high = mid; }
    size = low;
  }
  return { size, lines: wrap(size) };
}
