# Anaconda Agentic Desktop

Next-generation Anaconda Desktop, rebuilt on Electron + SvelteKit.

## Background

This repo implements the architecture described in [Anaconda Desktop — Next-Gen Architecture](https://docs.google.com/document/d/1vx3IZwUsHUfjDWnI7Fhh05gLiRLBIV4WM4PxznHWpTY) by @dgramlich. The Agentic Desktop Core Team aligned on the key decisions via Slack on July 27, 2026.

## Tech stack

| Layer           | Choice                               | Notes                                                        |
| --------------- | ------------------------------------ | ------------------------------------------------------------ |
| Shell           | Electron 43 + electron-forge 8 alpha | Forge for dev orchestration, electron-builder for packaging  |
| Renderer        | SvelteKit + adapter-static           | File-based routing, SPA fallback, no Node server in renderer |
| Styling         | Tailwind CSS 4 + shadcn-svelte       | Configured to match Anaconda's design-system-shadcn tokens   |
| State           | TanStack svelte-query                | IPC calls wrapped as queryFns; push events invalidate cache  |
| Persistence     | better-sqlite3 13 + drizzle-orm      | Drizzle's node:sqlite driver as future migration path        |
| Validation      | Zod 4                                | Shared schemas in `app/src/shared/` for main ↔ renderer      |
| Package manager | pnpm 11 (isolated linker)            | Selective hoisting for electron + vite only                  |
| Testing         | Vitest 5 beta + Playwright           | Unit via vitest, E2E via playwright                          |
| Git hooks       | Husky + lint-staged                  | Lint + format on pre-commit, lint on pre-push                |

## Getting started

```bash
npm install -g pnpm    # if you don't have pnpm
pnpm install
pnpm dev
```

## Structure

```
/
├── app/                        # Main Electron application
│   ├── src/
│   │   ├── main/               # Main process (Application class, IPC handlers, services)
│   │   ├── preload/            # Context bridge
│   │   ├── renderer/           # SvelteKit app
│   │   │   ├── routes/         # File-based routing
│   │   │   └── lib/            # Components (shadcn-svelte), hooks, utils
│   │   └── shared/             # Channel defs, Zod schemas, types (main ↔ renderer)
│   ├── drizzle/                # DB migrations
│   ├── e2e/                    # Playwright E2E tests
│   ├── forge.config.ts         # Electron Forge (dev only)
│   ├── svelte.config.js        # SvelteKit with adapter-static
│   └── vite.*.config.ts        # Separate vite configs for main/preload/renderer
├── packages/                   # Reusable libraries (future)
├── plugins/                    # First-party extensions (future)
├── electron-builder.config.js  # Packaging + publishing (canary/staging/prod channels)
├── pnpm-workspace.yaml         # Monorepo config with pnpm catalogs
└── tsconfig.base.json          # Shared TS compiler options
```

## Key architecture decisions

**IPC**: Vanilla `ipcMain`/`ipcRenderer`/`contextBridge` with services decoupled from handlers. Services are plain classes with no Electron awareness — testable without mocks.

**Packaging**: Forge handles dev experience (`electron-forge start`). electron-builder handles `make`/`publish` — Forge's makers don't cover AppImage + pacman. `better-sqlite3` is asar-unpacked.

**Electron fuses**: Security-hardened — `runAsNode: false`, cookie encryption, no `NODE_OPTIONS`, embedded asar integrity validation, only load from asar.

**Release channels**: Configurable via `RELEASE_CHANNEL` env var (canary/staging/prod). Update URL via `UPDATE_PUBLISH_URL`.

## Not yet implemented

- Plugin system runtime (parallel track, per team agreement)
- Kilo chat integration (pending SDK evaluation)
- Auth (anaconda-auth TS port, per architecture doc)
- Telemetry / analytics (port as-is from current Desktop)
- Data migration from legacy Desktop
- CI/CD workflows (to be ported from labs-anaconda-agent-studio)

## Open questions

1. **CI workflows** — port from Agent Studio or write fresh?
2. **Linter tooling** — current setup is ESLint + Prettier; Mark suggested evaluating Biome/oxlint
3. **Release channel naming** — doc proposes Dev/Canary/Staging/Prod; builder config uses canary as default
4. **Plugin route mounting** — wildcard route exists conceptually; implementation depends on module federation spike
