# Anaconda Agentic Desktop

Next-generation Anaconda Desktop built with Electron, React, and Electron Forge.

## Background

This repository implements the architecture described in
[Anaconda Desktop — Next-Gen Architecture](https://docs.google.com/document/d/1vx3IZwUsHUfjDWnI7Fhh05gLiRLBIV4WM4PxznHWpTY).

## Tech stack

| Layer           | Choice                                  | Notes                                                                                     |
| --------------- | --------------------------------------- | ----------------------------------------------------------------------------------------- |
| Shell           | Electron 43 + Electron Forge 8 alpha    | Forge owns main/preload builds, packaging, makers, and S3 publishing                      |
| Renderer        | React 19 + TanStack Router              | Standalone Vite app under `apps/web`, loaded through the custom application protocol      |
| Styling         | Tailwind CSS 4 + shadcn Nova/Base UI    | Uses the Anaconda theme and Inter                                                         |
| State           | TanStack React Query                    | Query factories call a web-owned `LocalApi`; Electron or in-browser adapters implement it |
| Persistence     | better-sqlite3 13 + Drizzle ORM         | SQL migrations live in the desktop package                                                |
| Validation      | Zod 4                                   | Shared schemas in `packages/contracts` define the IPC boundary                            |
| Package manager | pnpm 11, hoisted linker                 | Forge receives a frozen production dependency deployment during packaging                 |
| Testing         | Vitest 5 + Testing Library + Playwright | Unit tests, real-browser React tests, and packaged Electron smoke tests                   |
| Git hooks       | Husky + lint-staged                     | Linting and formatting run before commit                                                  |

## Getting started

Use Node 22.12 or newer and the pnpm version declared in `package.json`.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm start
```

`pnpm start` / `pnpm dev` run the web Vite server and Electron together. Electron proxies
the renderer through `anaconda-agentic-desktop-dev://app/#/` using
`ANACONDA_WEB_DEV_SERVER_URL`. Use `pnpm dev:web` for the React app alone (in-memory
`LocalApi`, no Electron).

The pinned Forge alpha publishes its POSIX CLI file without an executable mode, so the
root postinstall script normalizes that mode after pnpm links the hoisted dependency.

## Commands

| Command               | Purpose                                                                |
| --------------------- | ---------------------------------------------------------------------- |
| `pnpm start`          | Start web + Electron (`dev:desktop`)                                   |
| `pnpm dev:web`        | Start the standalone React/Vite app                                    |
| `pnpm dev:desktop`    | Start web and Electron with the custom development protocol            |
| `pnpm run package`    | Build web, then package Electron into `apps/desktop/out/`              |
| `pnpm run make`       | Package the app and create the current platform’s distributables       |
| `pnpm run publish`    | Run release preflight, then make and upload with Forge’s S3 publisher  |
| `pnpm check`          | Type-check contracts, web, desktop, and E2E projects                   |
| `pnpm lint`           | Run oxlint                                                             |
| `pnpm format:check`   | Verify formatting                                                      |
| `pnpm test`           | Run package tests recursively                                          |
| `pnpm test:web`       | Web unit + browser tests                                               |
| `pnpm test:desktop`   | Desktop unit tests                                                     |
| `pnpm test:contracts` | Contracts registry tests                                               |
| `pnpm test:e2e`       | Package the app and exercise the hardened executable through typed IPC |

## Structure

```text
/
├── apps/
│   ├── desktop/                # Electron main, preload, Forge, SQLite, E2E
│   │   ├── config/
│   │   ├── drizzle/
│   │   ├── e2e/
│   │   ├── resources/
│   │   └── src/{main,preload}/
│   └── web/                    # Standalone React/Vite application
│       └── src/
│           ├── components/
│           ├── features/
│           ├── platform/       # LocalApi + Electron/browser adapters
│           └── routes/
├── packages/
│   └── contracts/              # Shared Zod schemas and typed IPC contracts
├── .github/
│   ├── actions/                # Shared CI setup (node, macOS/Windows codesign)
│   └── workflows/              # Build + canary/staging/prod publish
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

Package names: `@anaconda-agentic-desktop/desktop`, `@anaconda-agentic-desktop/web`,
`@anaconda-agentic-desktop/contracts`.

## Electron architecture and security

The renderer is sandboxed and has no Node.js access. The preload exposes only the
schema-validated `window.desktopApi` surface. React code depends on `LocalApi` and never
imports Electron or IPC channel names (except the Electron adapter).

Production navigation uses `anaconda-agentic-desktop://app/#/`; development uses
`anaconda-agentic-desktop-dev://app/#/`. The custom protocol serves the independently
built web `dist` (or proxies the web Vite server in development) with a strict Content
Security Policy.

Forge creates an ASAR, includes `.vite`, migrations, package metadata, and required
production dependencies, and unpacks `better-sqlite3`. The fuses plugin disables
RunAsNode, `NODE_OPTIONS`, and CLI inspector arguments while enabling cookie encryption,
ASAR integrity validation, and loading only from ASAR.

## Distribution matrix

Forge uses only official makers:

| Platform | Maker output                                   | Update behavior                                                       |
| -------- | ---------------------------------------------- | --------------------------------------------------------------------- |
| macOS    | DMG, ZIP, and `RELEASES.json`                  | `update-electron-app` consumes the ZIP manifest                       |
| Windows  | Squirrel Setup EXE, full NUPKG, and `RELEASES` | `update-electron-app` uses the Squirrel feed                          |
| Linux    | DEB and RPM                                    | Updates are provided by the package repository or manual installation |

Automatic Electron update checks run only in packaged Windows and macOS builds. They
are disabled when `UPDATE_PUBLISH_URL` was not supplied at build time and never start on
Linux. Squirrel install, update, and uninstall launches are handled before normal
application startup.

## Release channels

`RELEASE_CHANNEL` accepts only publishable values: `canary`, `staging`, and `prod`.
Local `pnpm start` / `pnpm dev` is unpackaged development — not a channel — and is not
published. Packaged builds default to `canary` when `RELEASE_CHANNEL` is unset.

| Channel   | What it is                                | Who uses it                | How it ships                      |
| --------- | ----------------------------------------- | -------------------------- | --------------------------------- |
| `canary`  | Latest packaged build off `main`          | Engineers                  | Auto-publish on push to `main`    |
| `staging` | Release candidate for internal validation | QA / internal stakeholders | Manual `Staging Publish` workflow |
| `prod`    | Stable customer release                   | Customers                  | Manual `Prod Publish` workflow    |

## Release configuration

Artifacts are published under:

```text
anaconda-agentic-desktop/<channel>/<platform>/<arch>/<artifact>
```

Publishable channels are `canary`, `staging`, and `prod`. The Forge compile-time contract
uses:

| Variable                 | Meaning                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------- |
| `RELEASE_CHANNEL`        | Channel compiled into the app; defaults to `canary`                                     |
| `UPDATE_PUBLISH_URL`     | Public HTTPS S3/CDN base URL compiled into packaged builds                              |
| `UPDATE_S3_BUCKET`       | Bucket required by `electron-forge publish`                                             |
| `AWS_REGION`             | S3 region (defaults to `us-east-1` in CI when unset)                                    |
| `UPDATE_REMOTE_RELEASES` | Set to `true` on Windows when an existing Squirrel feed is available for delta creation |

CI publish jobs assume GitHub Environments named `canary`, `staging`, and `prod`, each with
repository/environment variables:

| Environment variable | Meaning                                       |
| -------------------- | --------------------------------------------- |
| `UPDATE_PUBLISH_URL` | Public HTTPS update base URL for that channel |
| `UPDATE_S3_BUCKET`   | S3 bucket for Forge publish                   |
| `AWS_ROLE_ARN`       | IAM role assumed via GitHub OIDC              |
| `AWS_REGION`         | Optional; defaults to `us-east-1`             |

`electron-forge publish --dry-run` runs the complete package/make lifecycle and records
publisher metadata without uploading. The shared release module and its tests ensure
the S3 key and runtime feed URL use the same channel/platform/architecture path.

## Signing and CI

Workflows:

| Workflow          | Trigger                      | Behavior                                                                   |
| ----------------- | ---------------------------- | -------------------------------------------------------------------------- |
| `Build`           | Manual (`workflow_dispatch`) | `pnpm run make` only; uses `canary` env for optional signing; GH artifacts |
| `Canary Publish`  | Push to `main`               | Publishes to the `canary` environment                                      |
| `Staging Publish` | Manual                       | Publishes to the `staging` environment                                     |
| `Prod Publish`    | Manual                       | Publishes to the `prod` environment                                        |

Signing secrets and update vars live on the GitHub Environments above. `Build` attaches
the `canary` environment so the same optional codesign material is available for manual
makes; it does not publish to S3.

CI reuses the same GitHub secret names as Anaconda Desktop (Agent Studio):

| Secret                         | Usage                                                                  |
| ------------------------------ | ---------------------------------------------------------------------- |
| `OSX_BUILD_CERTIFICATE_BASE64` | macOS Developer ID `.p12` (base64); imported into a temporary keychain |
| `OSX_P12_PASSWORD`             | Password for the macOS signing certificate                             |
| `OSX_NOTARIZATION_KEY`         | App Store Connect API `.p8` key material                               |
| `OSX_NOTARIZATION_KEY_ID`      | App Store Connect API key ID                                           |
| `OSX_NOTARIZATION_KEY_ISSUER`  | App Store Connect API issuer ID                                        |
| `AZURE_CLIENT_ID`              | Azure OIDC app for Windows signing                                     |
| `AZURE_TENANT_ID`              | Azure tenant                                                           |
| `AZURE_SUBSCRIPTION_ID`        | Azure subscription                                                     |
| `AZURE_KEY_VAULT_URI`          | Key Vault URI for `AzureSignTool`                                      |
| `AZURE_CERT_NAME`              | Certificate name in Key Vault                                          |

Forge still accepts local/optional fallbacks:

- macOS: `APPLE_SIGNING_IDENTITY` plus either App Store Connect API key env
  (`APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`) or Apple ID
  (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`)
- Windows: `WINDOWS_CERTIFICATE_FILE` + `WINDOWS_CERTIFICATE_PASSWORD` when Azure
  Key Vault signing is not configured

Staging and prod publishes require signing credentials for macOS and Windows. Canary may
publish unsigned. Unsigned local `make` runs remain supported. The Linux CI job installs
`fakeroot` and RPM tooling and uploads maker artifacts from `apps/desktop/out/make/`.

## Not yet implemented

- Plugin system runtime
- Kilo chat integration
- Authentication
- Telemetry and analytics
- Data migration from legacy Desktop
