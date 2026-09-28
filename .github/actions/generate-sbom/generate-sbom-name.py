#!/usr/bin/env python3
"""
Generate SBOM naming based on scan type and context.

Naming conventions:
- Repos: <repo-name>_<git-ref-tag-or-sha>_<timestamp>.sbom.<format>.json
- Images: <image-name>_<tag-or-digest>_<arch>_<timestamp>.sbom.<format>.json

Usage:
    # For repo scans
    python generate-sbom-name.py --scan-type repo \
        --repo-name my-repo --git-ref v1.0.0

    # For image scans
    python generate-sbom-name.py --scan-type image \
        --image-ref ghcr.io/org/image:latest

Outputs (to stdout, one per line):
    SBOM_BASE=<base-name>
    ARTIFACT_NAME=sbom-<base-name>
"""

import argparse
import platform
import re
import sys
import time


# Regex for validating image references
# Allows: registry:port/namespace/image:tag or image@sha256:digest
IMAGE_REF_PATTERN = re.compile(
    r"^[a-zA-Z0-9][a-zA-Z0-9._-]*"  # First component (registry or image name)
    r"(:[0-9]+)?"  # Optional port
    r"(/[a-zA-Z0-9][a-zA-Z0-9._-]*)*"  # Optional path components
    r"(:[a-zA-Z0-9][a-zA-Z0-9._-]*|@sha256:[a-f0-9]+)?$"  # Optional tag or digest
)


def validate_image_ref(image_ref: str) -> bool:
    """Validate image reference format to prevent injection."""
    if not image_ref:
        return False
    return bool(IMAGE_REF_PATTERN.match(image_ref))


def sanitize_for_filename(value: str) -> str:
    """Sanitize a string for use in filenames."""
    # Replace / with -
    value = value.replace("/", "-")
    # Remove any other problematic characters
    value = re.sub(r"[^a-zA-Z0-9._-]", "-", value)
    # Collapse multiple dashes
    value = re.sub(r"-+", "-", value)
    # Strip leading/trailing dashes
    value = value.strip("-")
    return value


def parse_image_ref(image_ref: str) -> tuple[str, str]:
    """
    Parse image reference into (image_name, tag_or_digest).

    Examples:
        nginx -> (nginx, latest)
        nginx:1.25 -> (nginx, 1.25)
        ghcr.io/org/image:v1 -> (ghcr.io/org/image, v1)
        localhost:5000/image:tag -> (localhost:5000/image, tag)
        image@sha256:abc123... -> (image, sha256-abc123) [truncated]
    """
    if "@" in image_ref:
        # Digest reference: image@sha256:digest
        image_name, digest = image_ref.split("@", 1)
        # Shorten digest for filename (sha256:abc123... -> sha256-abc123)
        tag_or_digest = digest.replace(":", "-")[:19]  # "sha256-" + 12 chars
    elif ":" in image_ref:
        # Could be registry:port/image:tag or just image:tag
        # Find the last : that's after any /
        last_slash = image_ref.rfind("/")
        last_colon = image_ref.rfind(":")

        if last_colon > last_slash:
            # The last : is a tag separator
            image_name = image_ref[:last_colon]
            tag_or_digest = image_ref[last_colon + 1 :]
        else:
            # The : is part of registry:port, no tag specified
            image_name = image_ref
            tag_or_digest = "latest"
    else:
        # No tag or digest
        image_name = image_ref
        tag_or_digest = "latest"

    return image_name, tag_or_digest


def get_architecture() -> str:
    """Get current architecture in Docker-style naming."""
    machine = platform.machine().lower()
    arch_map = {
        "x86_64": "amd64",
        "amd64": "amd64",
        "aarch64": "arm64",
        "arm64": "arm64",
    }
    return arch_map.get(machine, machine)


def generate_image_sbom_name(image_ref: str, timestamp: int) -> str:
    """Generate SBOM base name for container image scan."""
    if not validate_image_ref(image_ref):
        print(f"::error::Invalid image reference format: {image_ref}", file=sys.stderr)
        sys.exit(1)

    image_name, tag_or_digest = parse_image_ref(image_ref)
    arch = get_architecture()

    image_name_safe = sanitize_for_filename(image_name)
    tag_or_digest_safe = sanitize_for_filename(tag_or_digest)

    return f"{image_name_safe}_{tag_or_digest_safe}_{arch}_{timestamp}"


def generate_repo_sbom_name(
    repo_name: str,
    event_name: str,
    release_tag: str | None,
    ref_type: str,
    ref_name: str,
    git_sha: str,
    timestamp: int,
) -> str:
    """Generate SBOM base name for repository scan."""
    # Determine git ref: use tag for releases, short SHA otherwise
    if event_name == "release" and release_tag:
        git_ref = release_tag
    elif ref_type == "tag":
        git_ref = ref_name
    else:
        git_ref = git_sha

    repo_name_safe = sanitize_for_filename(repo_name)
    git_ref_safe = sanitize_for_filename(git_ref)

    return f"{repo_name_safe}_{git_ref_safe}_{timestamp}"


def main():
    parser = argparse.ArgumentParser(description="Generate SBOM naming")
    parser.add_argument(
        "--scan-type",
        choices=["repo", "image"],
        required=False,
        help="Type of scan",
    )
    parser.add_argument(
        "--name",
        help="Explicit SBOM base name (bypasses scan-type-derived naming; for artifact scans, e.g. 'my-app_1.2.3_darwin-arm64')",
    )
    parser.add_argument("--image-ref", help="Container image reference (for image scan)")
    parser.add_argument("--repo-name", help="Repository name (for repo scan)")
    parser.add_argument("--event-name", help="GitHub event name")
    parser.add_argument("--release-tag", help="Release tag (if release event)")
    parser.add_argument("--ref-type", help="Git ref type (branch/tag)")
    parser.add_argument("--ref-name", help="Git ref name")
    parser.add_argument("--git-sha", help="Git commit SHA")
    parser.add_argument("--sbom-dir", default="sbom-output", help="SBOM output directory")
    parser.add_argument(
        "--timestamp",
        type=int,
        help="Unix timestamp (defaults to current time)",
    )

    args = parser.parse_args()
    timestamp = args.timestamp if args.timestamp is not None else int(time.time())

    if args.name:
        sbom_base = sanitize_for_filename(args.name)
    elif args.scan_type == "image":
        if not args.image_ref:
            print("::error::--image-ref is required for image scans", file=sys.stderr)
            sys.exit(1)
        sbom_base = generate_image_sbom_name(args.image_ref, timestamp)
    elif args.scan_type == "repo":
        if not args.repo_name:
            print("::error::--repo-name is required for repo scans", file=sys.stderr)
            sys.exit(1)
        sbom_base = generate_repo_sbom_name(
            repo_name=args.repo_name,
            event_name=args.event_name or "",
            release_tag=args.release_tag,
            ref_type=args.ref_type or "",
            ref_name=args.ref_name or "",
            git_sha=args.git_sha or "",
            timestamp=timestamp,
        )
    else:
        print("::error::provide --name or --scan-type", file=sys.stderr)
        sys.exit(1)

    # Output in GitHub Actions format
    print(f"SBOM_BASE={sbom_base}")
    print(f"ARTIFACT_NAME=sbom-{sbom_base}")
    print(f"CYCLONEDX_PATH={args.sbom_dir}/{sbom_base}.sbom.cyclonedx.json")
    print(f"SPDX_PATH={args.sbom_dir}/{sbom_base}.sbom.spdx.json")

    # Also print human-readable message to stderr
    print(f"SBOM naming base: {sbom_base}", file=sys.stderr)


if __name__ == "__main__":
    main()
