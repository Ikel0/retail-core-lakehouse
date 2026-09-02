"""Build the standalone portfolio edition of the dashboard."""

import json
from hashlib import sha256
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
    styles = (dashboard / "styles.css").read_text(encoding="utf-8")
    application = (dashboard / "app.js").read_text(encoding="utf-8")
    payload = json.dumps(build_static_payload(), ensure_ascii=False, separators=(",", ":"))
    static_data = f"window.RETAIL_CORE_STATIC = {payload};\n"
    asset_version = sha256(
        (styles + application + static_data).encode("utf-8")
    ).hexdigest()[:12]

    stylesheet_tag = '    <link rel="stylesheet" href="./styles.css" />'
    if stylesheet_tag not in html:
        raise RuntimeError("Dashboard stylesheet tag not found")
    html = html.replace(
        stylesheet_tag,
        f'    <link rel="stylesheet" href="./styles.css?v={asset_version}" />',
    )

    script_tag = '    <script src="./app.js" defer></script>'
    if script_tag not in html:
        raise RuntimeError("Dashboard script tag not found")
    html = html.replace(
        script_tag,
        f'    <script src="./static-data.js?v={asset_version}" defer></script>\n'
        f'    <script src="./app.js?v={asset_version}" defer></script>',
    )

    (OUTPUT / "index.html").write_text(html, encoding="utf-8")
    (OUTPUT / "styles.css").write_text(styles, encoding="utf-8")
    (OUTPUT / "app.js").write_text(application, encoding="utf-8")
    (OUTPUT / "static-data.js").write_text(static_data, encoding="utf-8")
    (OUTPUT / ".nojekyll").write_text("", encoding="utf-8")
    print(f"Built standalone portfolio in {OUTPUT}")


if __name__ == "__main__":
    main()
