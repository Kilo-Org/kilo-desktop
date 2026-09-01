# Releases, signing, and CI reference

Reference material for packaging, publishing, and signing Anaconda Agentic Desktop. See
the [README](../README.md) for the development workflow and repository architecture.

Implementation lives in `apps/desktop/config/`: `release.ts` (channels, artifact keys,
feed URLs), `signing.ts` (credential resolution), `windows-sign.ts` (post-make Windows
signing), and `preflight-publish.ts` (publish validation).

## Release channels

`RELEASE_CHANNEL` accepts only publishable values. Local `pnpm start` / `pnpm dev` is
unpackaged development — not a channel — and is never published. Packaged builds default
to `canary` when `RELEASE_CHANNEL` is unset, and any other value throws during
configuration.

| Channel   | What it is                                | Who uses it                | How it ships                      |
| --------- | ----------------------------------------- | -------------------------- | --------------------------------- |
| `canary`  | Latest packaged build off `main`          | Engineers                  | Auto-publish on push to `main`    |
| `staging` | Release candidate for internal validation | QA / internal stakeholders | Manual `Staging Publish` workflow |
| `prod`    | Stable customer release                   | Customers                  | Manual `Prod Publish` workflow    |

Each environment has a distinct app identity so local development, Canary, Staging, and
Production can coexist without sharing installers or application data:

| Environment       | Product name                     | Identity suffix |
| ----------------- | -------------------------------- | --------------- |
| Local development | Anaconda Agentic Desktop Dev     | `dev`           |
| `canary`          | Anaconda Agentic Desktop Canary  | `canary`        |
| `staging`         | Anaconda Agentic Desktop Staging | `staging`       |
| `prod`            | Anaconda Agentic Desktop         | none            |

The suffix is applied consistently to macOS bundle IDs, Windows Squirrel identities,
Linux package and executable names, and Electron's application name (which separates
the default user-data directory). Production retains the existing unsuffixed identity.

## Distribution matrix

Forge uses only official makers:

| Platform | Maker output                                   | Update behavior                                                       |
| -------- | ---------------------------------------------- | --------------------------------------------------------------------- |
| macOS    | DMG, ZIP, and `RELEASES.json`                  | `update-electron-app` consumes the ZIP manifest                       |
| Windows  | Squirrel Setup EXE, full NUPKG, and `RELEASES` | `update-electron-app` uses the Squirrel feed                          |
| Linux    | DEB                                            | Updates are provided by the package repository or manual installation |

Automatic Electron update checks run only in packaged Windows and macOS builds. They are
disabled when `UPDATE_PUBLISH_URL` was not supplied at build time and never start on
Linux. Squirrel install, update, and uninstall launches are handled before normal
application startup.

Canary packaging stamps the desktop `package.json` version (then restores it) so every
Forge maker — DMG, ZIP, `RELEASES.json`, Squirrel nupkg/`RELEASES`, and DEB — names
artifacts `{nextPatch}-canary-{YYMMDD}-{HHmmss}` from the committed desktop version and
a UTC timestamp (shared via `CANARY_BUILD_TIME` in CI so macOS/Windows/Linux publish the
same version). The packaged app `package.json` is stamped to the same value. The patch
increment makes each canary sort above the committed version, so already-installed
`0.1.0` builds update. Electron packager native metadata (`FileVersion` /
`ProductVersion` / `CFBundleShortVersionString`) uses only the `{nextPatch}` numeric
prefix because Windows PE versions allow at most four integer components. Staging and
prod keep the committed version and still require an explicit bump.

Squirrel.Windows uses a legacy NuGet comparator that parses a prerelease's trailing
numeric suffix as a 32-bit integer, while its bundled NuGet limits that suffix to 20
characters. The two-digit year keeps the suffix within that limit, and hyphens keep the
fixed-width date and time separate, so Windows packages and the app can share a version
such as `0.1.1-canary-260818-143052` without overflowing the comparator.

Squirrel.Windows packs with a bundled `nuget.exe` that still enforces the 260-character
`MAX_PATH` limit, and `--releasify` extracts each nupkg entry to `{TEMP}\{guid}\{entry}`
using the same limit. Windows `make`/`publish` therefore:

1. Points `TEMP`/`TMP` and Electron Packager `tmpdir` at `<drive>\\t` (override with
   `WINDOWS_PACKAGING_TEMP`) so nuget pack and Squirrel extract roots stay short.
2. Stages the WebMCP relay as `resources/webmcp-relay` instead of unpacking
   `app.asar.unpacked/node_modules/@anaconda-agentic-desktop/plugin-kilo-server/relay-runtime`,
   so nupkg-relative paths themselves stay under the remaining budget.

Maker artifacts are written to `apps/desktop/out/make/`.

## Artifact layout

Artifacts are published under:

```text
anaconda-agentic-desktop/<channel>/<platform>/<arch>/<artifact>
```

The runtime update feed URL uses the same `channel/platform/arch` path, so a build always
looks for updates where its own artifacts were uploaded. `UPDATE_PUBLISH_URL` must use
HTTPS.

After the publish matrix completes without cancellation, the workflow gathers the
artifacts from successful platform jobs and creates or updates a private GitHub Release
tagged `desktop/<channel>/v<version>`. The finalizer still runs when another platform job
fails so release notes remain available for native update feeds that were already
published. Generated notes are sanitized to remove pull-request numbers and links before
the same body is used by GitHub and the public in-app release-note document.

Each channel exposes stable public download pointers in addition to its immutable maker
artifacts:

```text
anaconda-agentic-desktop/<channel>/latest.json
anaconda-agentic-desktop/<channel>/latest/<platform>/<arch>/<installer>
anaconda-agentic-desktop/<channel>/release-notes/<version>.json
anaconda-agentic-desktop/<channel>/release-notes/latest.json
```

`latest.json` contains the version, publication time, immutable release-note URL, and
download records with platform, architecture, artifact type, size, SHA-256, and the
immutable Forge artifact URL for that release. Stable installer aliases and moving JSON
pointers use short-lived cache headers; versioned artifacts and release notes are
immutable. The workflow uploads aliases before `latest.json`, whose immutable download
URLs make the manifest the final atomic publication pointer. Native auto-update feeds
remain at their existing `channel/platform/arch` paths.

Each immutable release-note document includes the previous release version for its
channel. Canary clients follow that chain back to their installed version and display up
to six release groups, so skipping Canary builds does not hide their changes. Staging and
Production show only the target release. Missing or legacy documents simply stop the
history lookup and never block the binary update.

## Build-time variables

The desktop main bundle loads committed Vite variables from
`apps/desktop/.env.<environment>`. Local development uses `.env.development`; packaged
builds select `.env.canary`, `.env.staging`, or `.env.prod` from `RELEASE_CHANNEL`.
Existing process variables override the committed value, and machine-specific overrides
can use an ignored `.env.<environment>.local` file. Only public build-time values belong
in the committed files; secrets remain in GitHub Environments.

The Forge compile-time contract uses:

| Variable                 | Meaning                                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `VITE_AUTH_CLIENT_ID`    | Public OAuth client ID loaded from the selected committed desktop environment file                                      |
| `RELEASE_CHANNEL`        | Channel compiled into the app; defaults to `canary`                                                                     |
| `CANARY_BUILD_TIME`      | Optional ISO timestamp shared across canary matrix legs; defaults to now                                                |
| `UPDATE_PUBLISH_URL`     | Public HTTPS S3/CDN base URL compiled into packaged builds                                                              |
| `UPDATE_S3_BUCKET`       | Bucket required by `electron-forge publish`                                                                             |
| `AWS_REGION`             | S3 region (defaults to `us-east-1` in CI when unset)                                                                    |
| `UPDATE_REMOTE_RELEASES` | Set to `true` on Windows when an existing Squirrel feed is available for delta creation                                 |
| `WINDOWS_PACKAGING_TEMP` | Optional short Windows temp directory; defaults to `<drive>\\t` so nuget.exe and Squirrel extract stay under `MAX_PATH` |

## GitHub Environments

CI publish jobs assume GitHub Environments named `canary`, `staging`, and `prod`, each
with repository/environment variables:

| Environment variable | Meaning                                       |
| -------------------- | --------------------------------------------- |
| `UPDATE_PUBLISH_URL` | Public HTTPS update base URL for that channel |
| `UPDATE_S3_BUCKET`   | S3 bucket for Forge publish                   |
| `AWS_ROLE_ARN`       | IAM role assumed via GitHub OIDC              |
| `AWS_REGION`         | Optional; defaults to `us-east-1`             |

## Workflows

| Workflow          | Trigger                      | Behavior                                                                   |
| ----------------- | ---------------------------- | -------------------------------------------------------------------------- |
| `CI`              | Push/PR on `main`            | Lint, format check, `pnpm check`, and package tests (no E2E)               |
| `Build`           | Manual (`workflow_dispatch`) | `pnpm run make` only; uses `canary` env for optional signing; GH artifacts |
| `Canary Publish`  | Push to `main`               | Publishes to the `canary` environment                                      |
| `Staging Publish` | Manual                       | Publishes to the `staging` environment                                     |
| `Prod Publish`    | Manual                       | Publishes to the `prod` environment                                        |

Signing secrets and update variables live on the GitHub Environments above. `Build`
attaches the `canary` environment so the same optional codesign material is available for
manual makes; it does not publish to S3. Linux jobs install `fakeroot` for DEB packaging
and the `pkg-config`/`libsecret` development packages required to rebuild keytar.

## Signing credentials

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

Forge also accepts local/optional fallbacks:

- macOS: `APPLE_SIGNING_IDENTITY` plus either App Store Connect API key env
  (`APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`) or Apple ID
  (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`)
- Windows: `WINDOWS_CERTIFICATE_FILE` + `WINDOWS_CERTIFICATE_PASSWORD` when Azure Key
  Vault signing is not configured

## Publish validation

`pnpm run publish` runs `preflight-publish.ts` before Forge. It requires
`UPDATE_S3_BUCKET`, and for `staging` and `prod` it additionally requires:

- macOS: a signing identity **and** notarization credentials
- Windows: Azure Key Vault credentials or a certificate file

Canary may publish unsigned, and unsigned local `make` runs are always supported.

`electron-forge publish --dry-run` runs the complete package/make lifecycle and records
publisher metadata without uploading. Unit tests in `apps/desktop/config/release.test.ts`
pin the S3 key and runtime feed URL to the same channel/platform/architecture path.
