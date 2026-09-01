"""Build the standalone portfolio edition of the dashboard."""

import json
from pathlib import Path

from serve import build_dashboard, simulate_black_friday


ROOT = Path(__file__).parent
OUTPUT = ROOT / "site"
CHANNELS = ("all", "web", "store", "marketplace")
PERIODS = (7, 14, 30)


def build_static_payload() -> dict:
    dashboards = {
        f"{channel}-{period}": build_dashboard(channel, period)
        for channel in CHANNELS
        for period in PERIODS
    }
    simulations = {
        f"{half_step / 2:.1f}": simulate_black_friday(half_step / 2)
        for half_step in range(4, 25)
    }
    return {"dashboards": dashboards, "simulations": simulations}


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    dashboard = ROOT / "dashboard"
    html = (dashboard / "index.html").read_text(encoding="utf-8")
    script_tag = '    <script src="./app.js" defer></script>'
    if script_tag not in html:
        raise RuntimeError("Dashboard script tag not found")
    html = html.replace(
        script_tag,
        '    <script src="./static-data.js" defer></script>\n' + script_tag,
    )

    (OUTPUT / "index.html").write_text(html, encoding="utf-8")
    (OUTPUT / "styles.css").write_text(
        (dashboard / "styles.css").read_text(encoding="utf-8"),
        encoding="utf-8",
    )
    (OUTPUT / "app.js").write_text(
        (dashboard / "app.js").read_text(encoding="utf-8"),
        encoding="utf-8",
    )
    payload = json.dumps(build_static_payload(), ensure_ascii=False, separators=(",", ":"))
    (OUTPUT / "static-data.js").write_text(
        f"window.RETAIL_CORE_STATIC = {payload};\n",
        encoding="utf-8",
    )
    (OUTPUT / ".nojekyll").write_text("", encoding="utf-8")
    print(f"Built standalone portfolio in {OUTPUT}")


if __name__ == "__main__":
    main()
