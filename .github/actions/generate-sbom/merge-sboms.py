#!/usr/bin/env python3
"""
Merge SBOMs from multiple sources (Syft + Trivy) with PURL-based deduplication.

Supports both CycloneDX and SPDX formats.

Usage:
    python merge-sboms.py --format cyclonedx --inputs a.json b.json --output merged.json
    python merge-sboms.py --format spdx --inputs a.json b.json --output merged.json
"""

import argparse
import json
import os
import sys
import uuid
from datetime import datetime, timezone


def load_purl_exclusions() -> list[str]:
    """Optional comma-separated purl prefixes to drop entirely (e.g. 'pkg:github/'
    for CI-workflow YAML vendored inside shipped npm packages). Env var so it can be
    tuned without code changes; empty means no filtering (upstream behavior)."""
    raw = os.environ.get("SBOM_EXCLUDE_PURL_PREFIXES", "")
    return [p.strip() for p in raw.split(",") if p.strip()]


def is_excluded_purl(purl: str | None, excluded_prefixes: list[str]) -> bool:
    return bool(purl) and any(purl.startswith(prefix) for prefix in excluded_prefixes)


def get_purl_cyclonedx(comp: dict) -> str | None:
    """Extract PURL from CycloneDX component."""
    return comp.get("purl")


def get_purl_spdx(pkg: dict) -> str | None:
    """Extract PURL from SPDX package externalRefs."""
    for ref in pkg.get("externalRefs", []):
        if ref.get("referenceType") == "purl":
            return ref.get("referenceLocator")
    return None


def get_fallback_key_cyclonedx(comp: dict) -> str | None:
    """Fallback dedup key for components without PURL (e.g., OS packages)."""
    name = comp.get("name", "").strip()
    version = comp.get("version", "").strip()
    comp_type = comp.get("type", "").strip()
    if name and version:
        return f"{comp_type}:{name}@{version}"
    return None


def get_fallback_key_spdx(pkg: dict) -> str | None:
    """Fallback dedup key for packages without PURL (e.g., OS packages)."""
    name = pkg.get("name", "").strip()
    version = pkg.get("versionInfo", "").strip()
    if name and version and name not in (".", "NOASSERTION") and version != "NOASSERTION":
        return f"{name}@{version}"
    return None


def merge_cyclonedx(input_files: list[str], output_file: str, sbom_name: str) -> dict:
    """Merge CycloneDX SBOMs with PURL-based deduplication.

    Deduplication strategy:
    1. If component has PURL: deduplicate by PURL (most reliable)
    2. If no PURL: deduplicate by (type, name, version) as fallback for OS packages
    3. If no fallback key possible: keep the component (can't reliably deduplicate)
    """
    sboms = []
    for f in input_files:
        with open(f, encoding="utf-8") as fp:
            sboms.append(json.load(fp))

    seen_purls = {}  # purl -> surviving bom-ref
    seen_fallback_keys = {}  # fallback_key -> surviving bom-ref
    merged_components = []
    bom_ref_aliases = {}  # old bom-ref -> surviving bom-ref (for dependency rewriting)
    excluded_prefixes = load_purl_exclusions()
    stats = {"inputs": [], "skipped": 0, "excluded": 0}

    for i, sbom in enumerate(sboms):
        components = sbom.get("components", [])
        added = 0
        skipped = 0
        excluded = 0

        for comp in components:
            if is_excluded_purl(get_purl_cyclonedx(comp), excluded_prefixes):
                excluded += 1
                continue
            comp_ref = comp.get("bom-ref")
            purl = get_purl_cyclonedx(comp)
            if purl:
                if purl not in seen_purls:
                    seen_purls[purl] = comp_ref
                    merged_components.append(comp)
                    added += 1
                else:
                    # Map this duplicate's bom-ref to the surviving one
                    if comp_ref:
                        bom_ref_aliases[comp_ref] = seen_purls[purl]
                    skipped += 1
            else:
                # No PURL - try fallback dedup by (type, name, version)
                fallback_key = get_fallback_key_cyclonedx(comp)
                if fallback_key:
                    if fallback_key not in seen_fallback_keys:
                        seen_fallback_keys[fallback_key] = comp_ref
                        merged_components.append(comp)
                        added += 1
                    else:
                        if comp_ref:
                            bom_ref_aliases[comp_ref] = seen_fallback_keys[fallback_key]
                        skipped += 1
                else:
                    # Can't deduplicate - keep it
                    merged_components.append(comp)
                    added += 1

        stats["inputs"].append(
            {"file": input_files[i], "total": len(components), "added": added, "skipped": skipped, "excluded": excluded}
        )
        stats["skipped"] += skipped
        stats["excluded"] += excluded

    # Build merged document using CycloneDX 1.6 format
    merged = {
        "bomFormat": "CycloneDX",
        "specVersion": "1.6",
        "serialNumber": f"urn:uuid:{uuid.uuid4()}",
        "version": 1,
        "metadata": {
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "tools": {"components": []},
        },
        "components": merged_components,
    }

    # Merge tool metadata from all inputs using 1.6 tools.components format
    seen_tools = set()
    for sbom in sboms:
        tools = sbom.get("metadata", {}).get("tools", [])
        if isinstance(tools, dict):
            tools = tools.get("components", [])
        for tool in tools:
            tool_key = (tool.get("group", ""), tool.get("name", ""), tool.get("version", ""))
            if tool_key not in seen_tools and tool.get("name"):
                seen_tools.add(tool_key)
                merged["metadata"]["tools"]["components"].append(tool)

    merged["metadata"]["tools"]["components"].append(
        {"type": "application", "group": "anaconda", "name": "sbom-merge-workflow", "version": "1.0.0"}
    )

    # Copy component metadata from first input if present
    if "component" in sboms[0].get("metadata", {}):
        merged["metadata"]["component"] = sboms[0]["metadata"]["component"]

    # Merge dependencies, rewriting aliased bom-refs to surviving refs
    kept_refs = {comp.get("bom-ref") for comp in merged_components if comp.get("bom-ref")}
    root_ref = merged.get("metadata", {}).get("component", {}).get("bom-ref")

    # Every input's own root component is a valid ref for its top-level edges;
    # without this, a second scanner's root-level dependsOn entries resolve to
    # None and are silently dropped (its root is never in `components`).
    root_aliases = set()
    for sbom in sboms:
        sbom_root = sbom.get("metadata", {}).get("component", {}).get("bom-ref")
        if sbom_root:
            root_aliases.add(sbom_root)
    if root_ref:
        for alias in root_aliases:
            if alias != root_ref:
                bom_ref_aliases[alias] = root_ref
    deps_by_ref = {}  # ref -> dep_entry; dependsOn/provides are unioned across inputs

    def resolve_ref(ref: str) -> str | None:
        """Resolve a bom-ref to surviving ref, or None if not kept."""
        if ref in kept_refs or ref == root_ref:
            return ref
        if ref in bom_ref_aliases:
            return bom_ref_aliases[ref]
        return None

    for sbom in sboms:
        for dep in sbom.get("dependencies", []):
            ref = dep.get("ref", "")
            resolved_ref = resolve_ref(ref)
            if resolved_ref is None:
                continue

            # Resolve all dependsOn refs through aliases
            resolved_depends = []
            for d in dep.get("dependsOn", []):
                resolved_d = resolve_ref(d)
                if resolved_d:
                    resolved_depends.append(resolved_d)

            # Resolve 'provides' field (CycloneDX 1.6)
            resolved_provides = []
            if "provides" in dep:
                resolved_provides = [p for p in (resolve_ref(p) for p in dep["provides"]) if p]

            # Key on the surviving ref only: two scanners may report different
            # dependsOn sets for the same component; union them so neither
            # scanner's edges are lost and `ref` stays unique in the output.
            if resolved_ref not in deps_by_ref:
                deps_by_ref[resolved_ref] = {
                    "ref": resolved_ref,
                    "dependsOn": set(resolved_depends),
                    "provides": set(resolved_provides),
                }
            else:
                existing = deps_by_ref[resolved_ref]
                existing["dependsOn"].update(resolved_depends)
                existing["provides"].update(resolved_provides)

    merged_deps = []
    for dep in deps_by_ref.values():
        entry = {"ref": dep["ref"], "dependsOn": sorted(dep["dependsOn"])}
        if dep["provides"]:
            entry["provides"] = sorted(dep["provides"])
        merged_deps.append(entry)

    if merged_deps:
        merged["dependencies"] = merged_deps

    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(merged, f, indent=2)

    stats["total"] = len(merged_components)
    return stats


def merge_spdx(input_files: list[str], output_file: str, sbom_name: str) -> dict:
    """Merge SPDX SBOMs with PURL-based deduplication.

    Deduplication strategy:
    1. If package has PURL: deduplicate by PURL (most reliable)
    2. If no PURL: deduplicate by (name, version) as fallback for OS packages
    3. If no fallback key possible: keep the package (can't reliably deduplicate)
    """
    sboms = []
    for f in input_files:
        with open(f, encoding="utf-8") as fp:
            sboms.append(json.load(fp))

    seen_purls = set()
    seen_fallback_keys = set()
    surviving_ids = {}  # dedup key (purl or fb:fallback_key) -> surviving SPDXID
    merged_packages = []
    kept_spdxids = set()  # All valid SPDXIDs (packages + files + snippets)
    spdxid_aliases = {}  # skipped SPDXID -> surviving SPDXID (for relationship rewriting)
    excluded_prefixes = load_purl_exclusions()
    stats = {"inputs": [], "skipped": 0, "excluded": 0}

    # First pass: collect all file and snippet SPDXIDs from all inputs
    merged_files = []
    seen_file_ids = set()
    for sbom in sboms:
        for f in sbom.get("files", []):
            fid = f.get("SPDXID")
            if fid and fid not in seen_file_ids:
                seen_file_ids.add(fid)
                merged_files.append(f)
                kept_spdxids.add(fid)

    for i, sbom in enumerate(sboms):
        packages = sbom.get("packages", [])
        added = 0
        skipped = 0
        excluded = 0

        for pkg in packages:
            purl = get_purl_spdx(pkg)
            if is_excluded_purl(purl, excluded_prefixes):
                excluded += 1
                continue
            if purl:
                if purl not in seen_purls:
                    seen_purls.add(purl)
                    surviving_ids[purl] = pkg.get("SPDXID")
                    merged_packages.append(pkg)
                    kept_spdxids.add(pkg.get("SPDXID"))
                    added += 1
                else:
                    skipped_id = pkg.get("SPDXID")
                    survivor = surviving_ids.get(purl)
                    if skipped_id and survivor:
                        spdxid_aliases[skipped_id] = survivor
                    skipped += 1
            else:
                # No PURL - try fallback dedup by (name, version)
                fallback_key = get_fallback_key_spdx(pkg)
                if fallback_key:
                    if fallback_key not in seen_fallback_keys:
                        seen_fallback_keys.add(fallback_key)
                        surviving_ids[f"fb:{fallback_key}"] = pkg.get("SPDXID")
                        merged_packages.append(pkg)
                        kept_spdxids.add(pkg.get("SPDXID"))
                        added += 1
                    else:
                        skipped_id = pkg.get("SPDXID")
                        survivor = surviving_ids.get(f"fb:{fallback_key}")
                        if skipped_id and survivor:
                            spdxid_aliases[skipped_id] = survivor
                        skipped += 1
                else:
                    # Can't deduplicate - keep it
                    merged_packages.append(pkg)
                    kept_spdxids.add(pkg.get("SPDXID"))
                    added += 1

        stats["inputs"].append(
            {"file": input_files[i], "total": len(packages), "added": added, "skipped": skipped, "excluded": excluded}
        )
        stats["skipped"] += skipped
        stats["excluded"] += excluded

    # Merge creators from all inputs
    all_creators = []
    for sbom in sboms:
        all_creators.extend(sbom.get("creationInfo", {}).get("creators", []))
    all_creators.append("Tool: anaconda-sbom-workflow")

    # Merge hasExtractedLicensingInfos (LicenseRef-* definitions)
    merged_license_infos = []
    seen_license_ids = set()
    for sbom in sboms:
        for lic_info in sbom.get("hasExtractedLicensingInfos", []):
            lic_id = lic_info.get("licenseId")
            if lic_id and lic_id not in seen_license_ids:
                seen_license_ids.add(lic_id)
                merged_license_infos.append(lic_info)

    # Build merged document
    merged = {
        "spdxVersion": sboms[0].get("spdxVersion", "SPDX-2.3"),
        "dataLicense": sboms[0].get("dataLicense", "CC0-1.0"),
        "SPDXID": "SPDXRef-DOCUMENT",
        "name": f"{sbom_name}-merged",
        "documentNamespace": f"https://spdx.org/spdxdocs/{sbom_name}-{uuid.uuid4()}",
        "creationInfo": {
            "created": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "creators": sorted(set(all_creators)),
        },
        "packages": merged_packages,
    }

    # Add merged files if any
    if merged_files:
        merged["files"] = merged_files

    # Add extracted licensing info if any (required for LicenseRef-* references)
    if merged_license_infos:
        merged["hasExtractedLicensingInfos"] = merged_license_infos

    # Merge relationships
    merged_rels = []
    seen_rels = set()

    for sbom in sboms:
        for rel in sbom.get("relationships", []):
            # Rewrite refs pointing at skipped duplicates to their survivors,
            # mirroring the CycloneDX merge path, so the losing scanner's
            # dependency edges aren't dropped with the duplicate package.
            elem_id = spdxid_aliases.get(rel.get("spdxElementId", ""), rel.get("spdxElementId", ""))
            related_id = spdxid_aliases.get(rel.get("relatedSpdxElement", ""), rel.get("relatedSpdxElement", ""))
            rel_type = rel.get("relationshipType", "")

            is_doc_rel = elem_id == "SPDXRef-DOCUMENT" or related_id == "SPDXRef-DOCUMENT"
            is_valid = is_doc_rel or (elem_id in kept_spdxids and related_id in kept_spdxids)

            if is_valid:
                rel_key = (elem_id, related_id, rel_type)
                if rel_key not in seen_rels:
                    merged_rels.append({**rel, "spdxElementId": elem_id, "relatedSpdxElement": related_id})
                    seen_rels.add(rel_key)

    merged["relationships"] = merged_rels

    # Copy other top-level fields from first input if present.
    # Note: files and hasExtractedLicensingInfos are merged above; these remaining
    # fields are only copied from the first SBOM.
    for field in ["documentDescribes", "snippets", "annotations", "externalDocumentRefs"]:
        if field in sboms[0]:
            merged[field] = sboms[0][field]

    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(merged, f, indent=2)

    stats["total"] = len(merged_packages)
    stats["relationships"] = len(merged_rels)
    return stats


def main():
    parser = argparse.ArgumentParser(description="Merge SBOMs with PURL-based deduplication")
    parser.add_argument("--format", choices=["cyclonedx", "spdx"], required=True, help="SBOM format")
    parser.add_argument("--inputs", nargs="+", required=True, help="Input SBOM files")
    parser.add_argument("--output", required=True, help="Output merged SBOM file")
    parser.add_argument("--name", default="merged-sbom", help="Name for the merged SBOM")

    args = parser.parse_args()

    if args.format == "cyclonedx":
        stats = merge_cyclonedx(args.inputs, args.output, args.name)
    else:
        stats = merge_spdx(args.inputs, args.output, args.name)

    # Print summary
    print(f"{args.format.upper()} Merge Summary:")
    for inp in stats["inputs"]:
        print(f"  {inp['file']}: {inp['total']} total, {inp['added']} added, {inp['skipped']} skipped (dup PURL)")
    print(f"  Merged total: {stats['total']}")
    if stats.get("excluded"):
        print(f"  Excluded by purl prefix filter: {stats['excluded']}")
    if "relationships" in stats:
        print(f"  Relationships: {stats['relationships']}")


if __name__ == "__main__":
    main()
