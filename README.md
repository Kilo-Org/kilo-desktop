# Kilo Desktop

Kilo Desktop is built with Electron, React, and Electron Forge.

Docs:

- [Writing a plugin](docs/plugins/README.md) — how-to for plugin authors: manifest, extension
  points, domain objects, commands, panes, agent tools, testing; an
  [example plugin](examples/hello-plugin); [llms.txt](llms.txt) for coding agents
- [Plugin architecture](docs/plugin-architecture.md) — the kernel, the plugins, their extension
  points and domain objects, and the build-up plan
- [Releases, signing, and CI reference](docs/releases.md) — channels, artifacts,
  environments, credentials
- [Notebook integration](plugins/notebook/docs/README.md) — embedding nteract's notebook UI with a
  bundled `runtimed` fallback that preserves the user's running singleton

## Tech stack

| Layer           | Choice                                  | Notes                                                                                 |
| --------------- | --------------------------------------- | ------------------------------------------------------------------------------------- |
| Shell           | Electron 43 + Electron Forge 8 alpha    | Forge owns main/preload builds, packaging, makers, and S3 publishing                  |
| Plugins         | `packages/kernel`                       | Every feature is a plugin on a product-agnostic kernel (main + one kernel per window) |
| Renderer        | React 19 + TanStack Router              | Standalone Vite app under `apps/web`, loaded through the custom application protocol  |
| Styling         | Tailwind CSS 4 + shadcn Nova/Base UI    | Uses the Anaconda theme and Inter                                                     |
| State           | Kernel domain objects + TanStack Query  | Plugins publish state and methods as typed domain objects shared across processes     |
| Validation      | Zod 4                                   | Domain-object and command contracts are Zod schemas in each plugin's `./contracts`    |
| Package manager | pnpm 11, hoisted linker                 | Workspace catalog pins shared versions; Forge receives a frozen production deployment |
| Testing         | Vitest 5 + Testing Library + Playwright | Unit tests, real-browser React tests, and packaged Electron smoke tests               |
| Git hooks       | Husky + lint-staged                     | Linting and formatting run before commit                                              |

## Getting started

Use Node 24 or newer (`.nvmrc` pins the version CI uses) and the pnpm version declared
in `packageManager`.

The web app depends on `@anaconda/shadcn-theme`, and `pnpm-workspace.yaml` maps the
`@anaconda` scope to GitHub Packages, so install needs a token with `read:packages`. pnpm
ignores env-expanded credentials in a project-level `.npmrc`, so store the token in user
config. CI uses `actions/setup-node` with `NODE_AUTH_TOKEN` from the
`ANACONDA_PACKAGES_TOKEN` secret.

```bash
corepack enable
pnpm config set "//npm.pkg.github.com/:_authToken" <token-with-read:packages>
pnpm install --frozen-lockfile
pnpm start
```

`pnpm start` / `pnpm dev` run the web Vite server and Electron together. Electron proxies
the renderer through `kilo-desktop-dev://app/#/` using
`KILO_WEB_DEV_SERVER_URL`. Use `pnpm dev:web` for the React app alone (the kernel boots
with a main kernel in the page, no Electron).

On first launch after the Kilo rename, Desktop atomically moves a matching pre-rename
profile into the canonical `Kilo Desktop Dev`, `Kilo Desktop Preview`, or `Kilo Desktop`
directory when that target does not already exist. Existing canonical profiles are never
overwritten or merged. Chat reads also recognize the pre-rename ownership key so existing
sessions remain visible; newly created sessions write only `kilo-desktop` metadata.

Browser-mode web tests drive real Chromium, so install the browser once before
`pnpm test`:

```bash
pnpm --filter @kilo-desktop/web exec playwright install chromium
```

The pinned Forge alpha publishes its POSIX CLI file without an executable mode, so the
root postinstall script normalizes that mode after pnpm links the hoisted dependency.

## Commands

Every command runs from the repository root; each one fans out to the relevant workspace
package with `pnpm --filter` or `pnpm -r`.

| Command             | Purpose                                                                |
| ------------------- | ---------------------------------------------------------------------- |
| `pnpm start`        | Start web + Electron (`dev:desktop`)                                   |
| `pnpm dev:web`      | Start the standalone React/Vite app                                    |
| `pnpm dev:desktop`  | Start web and Electron with the custom development protocol            |
| `pnpm run package`  | Build web, then package Electron into `apps/desktop/out/`              |
| `pnpm run make`     | Package the app and create the current platform’s distributables       |
| `pnpm run publish`  | Run release preflight, then make and upload with Forge’s S3 publisher  |
| `pnpm check`        | Type-check every workspace package, including E2E                      |
| `pnpm lint`         | Run oxlint and the plugin boundary check                               |
| `pnpm format:check` | Verify formatting                                                      |
| `pnpm test`         | Run package tests recursively (does not include E2E)                   |
| `pnpm test:web`     | Web unit + browser tests                                               |
| `pnpm test:desktop` | Desktop unit tests                                                     |
| `pnpm test:e2e`     | Package the app and exercise the hardened executable through typed IPC |

A plugin that persists data owns its storage (its kv namespaces or files under its own
storage directory); nothing shares a database.

## Monorepo layout

```text
/
├── apps/
│   ├── desktop/                # Electron main + preload: kernel host, platform services, Forge
│   └── web/                    # Renderer entry: boots a window kernel with the bundled plugins
├── packages/
│   ├── kernel/                 # Plugin kernel: registries, lifecycle, commands, React root
│   ├── bundled-plugins/        # The one list of plugins that ship
│   ├── ui/                     # Design-system primitives shared by every plugin
│   ├── git-client/             # Node-only git client
│   └── pane-layout/            # Pane layout model
├── plugins/                    # Bundled plugins (kilo.shell, kilo.agent, kilo.chat, …)
├── examples/                   # Example plugins for authors (never bundled)
├── e2e/                        # Playwright/Electron e2e
├── pnpm-workspace.yaml         # Workspace globs, dependency catalog, pnpm settings
└── tsconfig.base.json          # Compiler options every package extends
```

[CONTEXT.md](CONTEXT.md) lists every package and plugin;
[docs/plugin-architecture.md](docs/plugin-architecture.md) is the design and
[docs/plugins](docs/plugins/README.md) the authoring guide.

- The host (`apps/*`) provides only `kernel/*` primitives (windows, storage, notifications,
  protocols…); product features live in plugins, which reach each other through the kernel
  and import only another plugin's `./contracts`. `pnpm lint` checks these boundaries.
- `apps/desktop` gets the renderer as a built artifact: its `prepare:web` script runs the
  web build and asserts `apps/web/dist/index.html` exists. That script is hooked into
  `prepackage`, `premake`, and `prepublish`, and `config/stage-web-renderer.ts` copies the
  output into the packaged app.
- Shared dependency versions live in the pnpm catalog and are referenced as `catalog:`.
- `nodeLinker: hoisted` exists for Electron and Forge; packaging deploys a frozen
  production dependency tree instead of relying on symlinks (`pnpm deploy` no longer needs
  `injectWorkspacePackages`).
- Internal workspace deps always use the `workspace:*` protocol, consumed as TypeScript
  source. `link:` is reserved for the `overrides` section of `pnpm-workspace.yaml`.
- There are no TypeScript project references. Each package owns a `tsconfig.json` that
  extends `tsconfig.base.json` with `noEmit`, and `pnpm check` type-checks them
  independently.

## Running the web app standalone

```bash
pnpm dev:web   # http://127.0.0.1:5173, strict port
```

Without the preload bridge, the page boots the main kernel in-process next to the window
kernel; plugins whose main entry needs Node are skipped. `pnpm test:web` follows the same
split with two Vitest projects: `unit` runs `src/**/*.test.ts` in Node, and `browser` runs
`src/**/*.browser.test.tsx` in real headless Chromium via Playwright.

## Local Sentry via Spotlight

Local development **never** reports to the shared remote Sentry project: `initSentry()`
passes no DSN in dev, and `apps/desktop/.env.development` intentionally omits
`VITE_SENTRY_DSN`. To inspect errors, traces, and logs locally, use
[Spotlight](https://spotlightjs.com). In dev the Electron **main** process adds
`spotlightIntegration`, which forwards events to a local Spotlight sidecar (renderer
events route through the main process, so they show up too).

Run the standalone Spotlight app, then start the desktop app:

```bash
npx @spotlightjs/spotlight   # sidecar + UI on http://localhost:8969
pn dev                        # in another terminal
```

The SDK forwards to the default sidecar at `http://localhost:8969/stream`. Optionally
wire Spotlight into an MCP-capable editor (Claude/Cursor) with
`npx -y @spotlightjs/spotlight mcp`.

Notes:

- Spotlight is gated on `!app.isPackaged`, so none of the dev-only config runs in
  packaged builds, and no `@spotlightjs/*` package ships in the app bundle.
- In dev the SDK is initialized without a DSN and with `defaultIntegrations: false`
  (the native minidump reporter requires a DSN); only `spotlightIntegration` is
  active, so local events go to Spotlight and nowhere else.

## Log verbosity

Main-process logs (electron-log, console + file transports) default to `info`.
Levels are `error`, `warn`, `info`, `verbose`, `debug`, `silly` — anything below
the configured level is dropped. Two ways to change it, env var wins:

```bash
KILO_LOG_LEVEL=debug pnpm dev   # one-off, e.g. to see notebook sidecar debug logs
```

or set `"logLevel": "debug"` in `preferences.json` inside the app's userData
directory (e.g. `~/Library/Application Support/Kilo Desktop Preview/` on macOS) to
persist it across launches.

## Electron architecture and security

The renderer is sandboxed and has no Node.js access. The preload exposes only the kernel
bridge (`kernelBridge`); every request crosses one kernel transport in main, which checks
the sender and validates payloads against the target's declared contract.

Production navigation uses `kilo-desktop://app/#/`; development uses
`kilo-desktop-dev://app/#/`. OS deep links use the same scheme with a dedicated
host: `kilo-desktop://model-catalog/{modelId}` opens the Local Model Catalog on
that Anaconda model UUID (`kilo-desktop-dev://` in development). The custom
protocol serves the independently built web `dist` — staged into
`.vite/renderer/main_window` during packaging — or proxies the web Vite server
in development, with a strict Content Security Policy.

Forge creates an ASAR, includes `.vite`, package metadata, and required production
dependencies, and unpacks native modules (`better-sqlite3`, `node-pty`, keytar, …). The fuses plugin disables
RunAsNode, `NODE_OPTIONS`, and CLI inspector arguments while enabling cookie encryption,
ASAR integrity validation, and loading only from ASAR.

## Releases and distribution

`RELEASE_TRACK` accepts only publishable values. Local `pnpm start` / `pnpm dev` is
unpackaged development - not a track - and is never published. Packaged builds default
to `preview`.

| Channel   | What it is                         | Who uses it                | How it ships                              |
| --------- | ---------------------------------- | -------------------------- | ----------------------------------------- |
| `preview` | Continuously consumable prerelease | Engineers / internal users | Scheduled cadence or manual `Release` run |
| `stable`  | Stable customer release            | Customers                  | `vX.Y.Z` tag or manual `Release` run      |

Development is isolated, while Preview and Stable share one packaged identity:

| Environment       | App name     |
| ----------------- | ------------ |
| Local development | Kilo Dev     |
| `preview`         | Kilo Preview |
| `stable`          | Kilo         |

Preview and Stable replace one another rather than install side by side. Sharing identity lets the
About settings update-track switcher (behind the `update-track-switcher` feature flag) move an
installed app between tracks.

Forge uses only official makers (DMG/ZIP on macOS, Squirrel on Windows, DEB on Linux)
and publishes Preview to the `preview` update namespace and Stable to `latest`. Automatic update
checks run only in packaged macOS and Windows builds that were given an update host for the
selected track (`UPDATE_PUBLISH_URL_PREVIEW` / `UPDATE_PUBLISH_URL_STABLE`, falling back to
`UPDATE_PUBLISH_URL` for the build's own track).
Preview builds stamp a UTC timestamp onto the next patch (`0.1.2-preview-260818-14305`)
so every publication is a newer version. Stable uses the tag or dispatch version, then records that
version across the release-coupled desktop and web packages and lockfile on `main`.
Forge makers read that stamped version, so macOS DMG/ZIP/`RELEASES.json`, Windows nupkg,
and Linux DEB all publish a unique Preview version.

See [docs/releases.md](docs/releases.md) for the full reference: the distribution matrix,
build-time variables, GitHub Environments, workflows, signing credentials, and publish
validation rules.
