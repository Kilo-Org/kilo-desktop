# ADR-001: Bridge Payload Delivery

**Status:** Accepted

## Context

PR #301 removed the `CondaService` execa fallback and the Miniconda staging
pipeline. The bridge sidecar is now the sole conda backend. The payload
(Python interpreter + bridge module + manifest) must be present at runtime.

## Decision

The payload is bundled at build time via `@anaconda/desktop-bridge-payload-<os>-<cpu>`
npm packages, staged by `stage-bridge.ts` into
`plugins/environments/resources/bridge/`, and packaged into the app via Electron
Forge `extraResources`.

## Rejected Alternative

Runtime-fetch with version pinning was considered and rejected. It adds download
progress UI, retry logic, offline handling, and signature verification for no
near-term benefit given the original single-platform (darwin-arm64) scope. The
matrix now also includes win32-x64, win32-arm64, and linux-x64. This decision should
be reconsidered if the payload size or platform matrix grows significantly.

## Consequences

- A missing payload is expected to be caught during build/packaging, but the
  app handles it gracefully at runtime: it hides the environments UI, logs the
  absolute paths that were searched, and keeps the `condaRuntime` capability
  alive for headless consumers. It cannot self-heal (no runtime fetch).
- `resolveBridge()` returns a discriminated `BridgeResolutionResult` so callers
  can log searched paths when the payload is not found.
