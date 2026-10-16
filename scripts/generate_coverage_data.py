"""Regenerates docs/data/coverage.json from the app's own airport catalog.

Run this after adding/removing airports so the website's coverage map
stays in sync with what's actually bundled in the app:

    python3 scripts/generate_coverage_data.py
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "crates", "atc-core", "data")

ISO = {
    "Denmark": 208, "Estonia": 233, "Finland": 246, "Germany": 276,
    "Ireland": 372, "Japan": 392, "Latvia": 428, "Lithuania": 440,
    "Norway": 578, "Sweden": 752, "Turkey": 792,
    "United Arab Emirates": 784, "United Kingdom": 826, "United States": 840,
}

# Countries whose bundled airports are essentially the whole country's
# commercial/general-aviation airport list, not just a sample.
FULL_COVERAGE = {"Estonia", "Latvia", "Lithuania"}

# Countries deliberately left out, with the reason shown on hover.
EXCLUDED = [
    {
        "name": "Russia", "iso": 643,
        "reason": "Excluded in protest of the full-scale invasion of Ukraine and the "
                   "hybrid war Russia is waging against Lithuania and its neighbors.",
    },
    {
        "name": "North Korea", "iso": 408,
        "reason": "Excluded over the North Korean government's human rights record.",
    },
    {
        "name": "Israel", "iso": 376,
        "reason": "Excluded in protest of the genocide in Gaza.",
    },
]


def main():
    catalog = json.load(open(os.path.join(DATA_DIR, "catalog.json")))
    by_region = {}
    for a in catalog:
        icao = a["icao"]
        airport = json.load(open(os.path.join(DATA_DIR, f"{icao.lower()}.json")))
        rp = airport.get("reference_point", {})
        by_region.setdefault(a["region"], []).append({
            "icao": icao,
            "name": a["name"],
            "lat": rp.get("lat"),
            "lon": rp.get("lon"),
        })

    countries = []
    for region in sorted(by_region):
        countries.append({
            "name": region,
            "iso": ISO[region],
            "status": "full" if region in FULL_COVERAGE else "partial",
            "airports": sorted(by_region[region], key=lambda a: a["icao"]),
        })

    out = {"countries": countries, "excluded": EXCLUDED}
    out_path = os.path.join(ROOT, "docs", "data", "coverage.json")
    with open(out_path, "w") as f:
        json.dump(out, f, indent=2)
    print(f"wrote {out_path}: {len(countries)} countries, "
          f"{sum(len(c['airports']) for c in countries)} airports")


if __name__ == "__main__":
    main()
