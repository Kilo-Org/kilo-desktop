# ADR-002: Conda Environment Isolation

**Status:** Accepted

## Context

PR #301 (DESK-2721) deleted `CondaService` and its `#isolationEnv` block, which
set `CONDA_ENVS_PATH`, `CONDA_PKGS_DIRS`, `CONDARC`, and
`CONDA_PLUGINS_AUTO_ACCEPT_TOS` to scope all conda operations into
`~/.anaconda-agentic-desktop/conda`. The replacement `SidecarCondaBackend`
communicates with the bridge sidecar over JSON-RPC and passes only
`BRIDGE_PROTECT_STDIO=1`. No isolation config is set.

Two code paths create environments:

- **User environments** (UI / MCP): name-addressed, land in the bridge's
  `envs_dirs` — which is the user's real conda config.
- **Plugin environments** (headless): prefix-addressed via `CondaRuntime`, land
  at `~/.anaconda-agentic-desktop/conda/envs/<name>`.

## Decision

User environments are **unscoped**: the bridge inherits the user's real
`~/.condarc`, `envs_dirs`, and `pkgs_dirs`. No app-level isolation env vars are
set.

Plugin environments remain **prefix-isolated** at
`~/.anaconda-agentic-desktop/conda/envs/`. They are created with explicit
`prefix` paths, bypassing the bridge's `envs_dirs` — intentionally invisible
from `conda env list` in the user's terminal.

The bridge handles ToS acceptance internally — no
`CONDA_PLUGINS_AUTO_ACCEPT_TOS` env var is needed from the app.

The package cache is **shared** with the user's system conda via conda's default
`pkgs_dirs`.

## Rejected Alternative

Scoped isolation (app-controlled `envs_dirs`, `pkgs_dirs`, `.condarc`) was
considered and rejected:

- Adds complexity: synthetic `.condarc` management, ToS forwarding, package
  cache duplication.
- Environments created in isolation are invisible from the user's terminal, VS
  Code, and Jupyter — defeating the purpose of a user-facing environment
  manager.
- Scoping later would orphan user-created environments. Unscoping later would
  not.

## Consequences

- **ToS**: The `conda-anaconda-tos` plugin (conda ≥ 25.7) requires a one-time
  ToS acceptance for default channels. With unscoped, the bridge reads the
  user's real acceptance state — no env var override is needed.
- **Package cache**: Shared with the user's system conda. No duplicate
  downloads, but the app's operations contribute to cache size. Cache management
  can be added later without breaking environments.
- **Environment listing**: `SidecarCondaBackend.list()` returns all environments
  the bridge discovers, including the user's pre-existing environments. Plugin
  environments at `~/.anaconda-agentic-desktop/conda/envs/` are not registered
  in any `envs_dirs` and do not appear in list results.
- **Name collisions**: If a user creates an environment whose name already
  exists in their system conda, the bridge's `envs_dirs` resolution determines
  the outcome. The `"conda:environment:already-exists"` error code surfaces this
  to the user.
