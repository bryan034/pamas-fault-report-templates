"""Vector symbols shared by the built-in and uploaded-template renderers."""

from reportlab.lib.colors import HexColor


def draw_tick(pdf, x, y, width, height, color):
    """Curved, tapered checkmark; coordinates below are measured from the top-left."""
    def point(px, py):
        return x + px * width, y + (1 - py) * height

    pdf.saveState()
    pdf.setFillColor(HexColor(color))
    path = pdf.beginPath()
    path.moveTo(*point(0.04, 0.48))
    for segment in [
        (0.11, 0.36, 0.18, 0.40, 0.24, 0.63),
        (0.32, 0.44, 0.60, 0.10, 0.94, 0.02),
        (0.69, 0.20, 0.45, 0.57, 0.28, 0.98),
        (0.23, 0.99, 0.19, 0.96, 0.17, 0.89),
        (0.14, 0.70, 0.10, 0.48, 0.04, 0.48),
    ]:
        path.curveTo(*point(*segment[:2]), *point(*segment[2:4]), *point(*segment[4:]))
    path.close()
    pdf.drawPath(path, fill=1, stroke=0)
    pdf.restoreState()
