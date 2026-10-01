#!/usr/bin/env python3
"""
Generate a license summary report from a CycloneDX SBOM.

Usage:
    python generate-license-report.py --input sbom.cyclonedx.json --output license-report.json
"""

import argparse
import json
from collections import Counter


def generate_report(input_file: str, output_file: str) -> dict:
    """Generate license coverage report from CycloneDX SBOM."""
    with open(input_file, encoding="utf-8") as f:
        sbom = json.load(f)

    components = sbom.get("components", [])
    total = len(components)
    with_license = 0
    license_counter = Counter()

    for comp in components:
        licenses = comp.get("licenses", [])
        if licenses:
            with_license += 1
            for lic in licenses:
                # CycloneDX supports both {"license": {...}} and {"expression": "..."}
                if "expression" in lic:
                    lic_id = lic["expression"]
                else:
                    lic_obj = lic.get("license", {})
                    lic_id = lic_obj.get("id") or lic_obj.get("name") or "Unknown"
                license_counter[lic_id] += 1

    report = {
        "summary": {
            "total_components": total,
            "components_with_license": with_license,
            "license_coverage_percent": round(with_license / total * 100, 1) if total > 0 else 0,
        },
        "license_distribution": dict(license_counter.most_common()),
        "components_without_license": [
            {"name": c.get("name"), "version": c.get("version"), "purl": c.get("purl")}
            for c in components
            if not c.get("licenses")
        ],
    }

    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    return report


def main():
    parser = argparse.ArgumentParser(description="Generate license report from CycloneDX SBOM")
    parser.add_argument("--input", required=True, help="Input CycloneDX SBOM file")
    parser.add_argument("--output", required=True, help="Output license report file")

    args = parser.parse_args()
    report = generate_report(args.input, args.output)

    # Print summary
    summary = report["summary"]
    print(
        f"License Coverage: {summary['components_with_license']}/{summary['total_components']} "
        f"({summary['license_coverage_percent']}%)"
    )

    print("\nTop licenses:")
    for lic, count in list(report["license_distribution"].items())[:10]:
        print(f"  {lic}: {count}")

    missing = report["components_without_license"]
    if missing:
        print(f"\nComponents missing licenses ({len(missing)}):")
        for comp in missing[:10]:
            print(f"  - {comp['name']} {comp.get('version', '')}")
        if len(missing) > 10:
            print(f"  ... and {len(missing) - 10} more")


if __name__ == "__main__":
    main()
