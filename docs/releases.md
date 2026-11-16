# Releases, signing, and CI reference

Reference material for packaging, publishing, and signing Kilo Desktop. See
the [README](../README.md) for the development workflow and repository architecture.

Implementation lives in `apps/desktop/config/`: `release.ts` (channels, artifact keys,
feed URLs), `signing.ts` (credential resolution), `windows-sign.ts` (post-make Windows
signing), and `preflight-publish.ts` (publish validation).

## Release tracks

`RELEASE_TRACK` accepts only publishable values. Local `pnpm start` / `pnpm dev` is
unpackaged development - not a track - and is never published. Packaged builds default
to `preview` when `RELEASE_TRACK` is unset, and any other value throws during
configuration.

| Channel   | What it is                         | Who uses it              | How it ships                              |
| --------- | ---------------------------------- | ------------------------ | ----------------------------------------- |
| `preview` | Continuously consumable prerelease | Early adopters / testers | Scheduled cadence or manual `Release` run |
| `stable`  | Stable customer release            | Customers                | Manual `Release` run from `main`          |

Development has an isolated identity. Preview and Stable intentionally share one durable
packaged identity so the About settings update-track selector (gated by the `update-track-switcher`
feature flag) can move the installed app between tracks:

| Environment       | Product name | Identity suffix |
| ----------------- | ------------ | --------------- |
| Local development | Kilo Dev     | `dev`           |
| `preview`         | Kilo Preview | none            |
| `stable`          | Kilo         | none            |

The development suffix is applied consistently to macOS bundle IDs, Windows Squirrel identities,
Linux package and executable names, and Electron's application name. Preview and Stable share the
same bundle ID, Squirrel identity, executable, protocol registration, single-instance scope, and
default user-data directory. Installing one replaces the other. Track selection repoints the
native update feed immediately and persists across restarts. Electron's native updater does not
force downgrades, so a newer Preview installation returns to Stable only when the Stable channel
publishes a version that sorts newer than the installed Preview.

## Distribution matrix

Forge uses only official makers:

| Platform | Architectures | Maker output                                   | Update behavior                                                        |
| -------- | ------------- | ---------------------------------------------- | ---------------------------------------------------------------------- |
| macOS    | arm64         | DMG, ZIP, and `RELEASES.json`                  | `update-electron-app` consumes the ZIP manifest                        |
| Windows  | x64, arm64    | Squirrel Setup EXE, full NUPKG, and `RELEASES` | `update-electron-app` uses the Squirrel feed                           |
| Linux    | x64, arm64    | DEB                                            | The app checks `latest.json` and links the DEB; installation is manual |

Each architecture builds on a native runner: Windows ARM64 on `windows-11-vs2026-arm` and
Linux ARM64 on `blacksmith-4vcpu-ubuntu-2404-arm`, with the same plugins as their x64 counterparts. The pinned
`@runtimed/node` nightly includes native bindings for every release target. The explicit
`@runtimed/node-win32-arm64-msvc` optional dependency in `apps/desktop` uses the same version
as the wrapper. PR and nightly E2E remain on Windows x64.

Automatic Electron updates run only in packaged Windows and macOS builds. Packaged Linux
builds never touch Electron's updater and never install anything: they read the selected
track's `latest.json` on the same schedule, and when it names a newer version with a DEB
for the running architecture on that track's update host, About and the sidebar offer a
**Download** link to it. A newer release without such a DEB is reported as a failed check
rather than "up to date", and never withdraws a download already on offer. Update checks on every platform are disabled when the selected
track has no update host compiled in. Squirrel install, update, and uninstall launches are
handled before normal application startup.

Preview packaging stamps the desktop `package.json` version (then restores it) so every
Forge maker — DMG, ZIP, `RELEASES.json`, Squirrel nupkg/`RELEASES`, and DEB — names
artifacts `{nextPatch}-preview-{YYMMDD}-{HHmmS}` from the committed desktop version and
a UTC timestamp at ten-second resolution (shared via `PREVIEW_BUILD_TIME` in CI so all
legs publish the same version). The packaged app `package.json` is stamped to the same value. The patch
increment makes each Preview sort above the committed version, so already-installed
`0.1.0` builds update. Electron packager native metadata (`FileVersion` /
`ProductVersion` / `CFBundleShortVersionString`) uses only the `{nextPatch}` numeric
prefix because Windows PE versions allow at most four integer components. Stable packaging uses
the committed `apps/desktop/package.json` version, which is bumped on `main` through a normal
pull request before release; the workflow never writes back to `main`.

Squirrel.Windows uses a legacy NuGet comparator that parses a prerelease's trailing
numeric suffix as a 32-bit integer, while its bundled NuGet limits that suffix to 20
characters. The two-digit year keeps the suffix within that limit, and hyphens keep the
fixed-width date and time separate, so Windows packages and the app can share a version
such as `0.1.2-preview-260818-14305` without overflowing the comparator.

Squirrel.Windows packs with a bundled `nuget.exe` that still enforces the 260-character
`MAX_PATH` limit, and `--releasify` extracts each nupkg entry to `{TEMP}\{guid}\{entry}`
using the same limit. Windows `make`/`publish` therefore points `TEMP`/`TMP` and Electron
Packager `tmpdir` at `<drive>\\t` (override with `WINDOWS_PACKAGING_TEMP`) so nuget pack and
Squirrel extract roots stay short.

Some prebuilt native binaries (`@runtimed/node`, the `runtimed` daemon) link the Visual C++
runtime (`VCRUNTIME140.dll`) dynamically, and clean Windows installs don't have it. Build machines
always do, so a boot test on CI cannot catch the gap. The Forge `postPackage` hook
(`config/windows-vc-runtime.ts`) therefore copies each missing redistributable DLL from Visual
Studio's `VC\Redist\MSVC` folder beside the binary that imports it. It then fails the build if any
packaged binary still imports a runtime DLL that isn't bundled next to it. `release:smoke` repeats
that audit on the extracted full nupkg.

Maker artifacts are written to `apps/desktop/out/make/`.

## Artifact layout

Artifacts are published under updater namespaces:

```text
kilo-desktop/<update-channel>/<platform>/<arch>/<artifact>
```

Preview uses update channel `preview`; Stable uses `latest`. The runtime update feed URL uses the same `update-channel/platform/arch` path,
so a build always looks for updates where its own artifacts were uploaded.
Each track publishes from its own GitHub Environment to its own host, so packaged builds
compile in every track's host (`UPDATE_PUBLISH_URL_PREVIEW`, `UPDATE_PUBLISH_URL_STABLE`)
and the track selector repoints both host and channel path. A track whose host is missing
falls back to `UPDATE_PUBLISH_URL` for the build's own track and is otherwise refused.
All update URLs must use HTTPS.

After the publish matrix completes without cancellation, the workflow gathers the
artifacts from successful platform jobs and creates or updates a GitHub Release
tagged with the exact packaged version: `vX.Y.Z-preview-YYMMDD-HHmmS` for Preview or
`vX.Y.Z[-prerelease]` for Stable. The finalizer still runs when another platform job
fails so release notes remain available for native update feeds that were already
published. Generated notes are grouped by pull-request title prefix into Features
(`feat`), Fixes (`fix`), Dependencies (`deps` scope or Renovate/Dependabot), and Other
(everything else, including `e2e`/`test`/`ci` scopes), then sanitized to remove
pull-request numbers, links, and tracker ids such as `[ABC-123]` before the same body is used by GitHub and the public
in-app release-note document. Preview the result for any tag without publishing with
`pnpm --filter @kilo-desktop/desktop release:notes <tag>`.

Hand-written highlights (for example a milestone or a change users must know about) lead the notes when
`apps/desktop/release-highlights/<version>.md` exists for the exact published version.
Add it in the Stable version-bump pull request so the wording is reviewed with the release;
Preview versions are stamped at build time, so the file effectively applies to Stable. The
file is Markdown, but the app lists only its list items (`- …`), in order and as plain text
(links and emphasis are stripped), so write anything users must see, including URLs, as
list items; publishing fails if it has none. `release:notes` includes the highlights for the
tag's version (or `--version`). Release notes are immutable once published, so preview them
before dispatching the release.

Each update channel exposes stable public download pointers in addition to its immutable maker
artifacts:

```text
kilo-desktop/<update-channel>/latest.json
kilo-desktop/<update-channel>/latest/<platform>/<arch>/<installer>
kilo-desktop/<update-channel>/release-notes/<version>.json
kilo-desktop/<update-channel>/release-notes/latest.json
```

`latest.json` contains the version, publication time, immutable release-note URL, and
download records with platform, architecture, artifact type, size, SHA-256, and the
immutable Forge artifact URL for that release. Stable installer aliases and moving JSON
pointers use short-lived cache headers; versioned artifacts and release notes are
immutable. The workflow uploads aliases before `latest.json`, whose immutable download
URLs make the manifest the final atomic publication pointer. Linux update checks read it
and link its immutable DEB URL. Native auto-update feeds
remain at their existing `channel/platform/arch` paths.

Each immutable release-note document includes the previous release version for its
track. Preview clients follow that chain back to their installed version and display up
to six release groups, so skipping Preview builds does not hide their changes. Stable
shows only the target release. Missing or legacy documents simply stop the
history lookup and never block the binary update.

## Build-time variables

The desktop main bundle loads committed Vite variables from
`apps/desktop/.env.<environment>`. Local development uses `.env.development`; packaged
builds select `.env.preview` or `.env.stable` from `RELEASE_TRACK`.
Existing process variables override the committed value, and machine-specific overrides
can use an ignored `.env.<environment>.local` file. Only public build-time values belong
in the committed files; secrets remain in GitHub Environments.

The Forge compile-time contract uses:

| Variable                     | Meaning                                                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `VITE_AUTH_CLIENT_ID`        | Public OAuth client ID loaded from the selected committed desktop environment file                                      |
| `RELEASE_TRACK`              | Product release track compiled into the app; defaults to `preview`                                                      |
| `RELEASE_VERSION`            | Explicit Stable version propagated to every packaging leg; empty for Preview                                            |
| `PREVIEW_BUILD_TIME`         | Optional ISO timestamp shared across Preview matrix legs; defaults to now                                               |
| `UPDATE_PUBLISH_URL`         | Public HTTPS S3/CDN base URL for the track being published; runtime fallback for that track                             |
| `UPDATE_PUBLISH_URL_PREVIEW` | Public HTTPS Preview update host compiled into every packaged build for track switching                                 |
| `UPDATE_PUBLISH_URL_STABLE`  | Public HTTPS Stable update host compiled into every packaged build for track switching                                  |
| `UPDATE_S3_BUCKET`           | Bucket required by `electron-forge publish`                                                                             |
| `AWS_REGION`                 | S3 region (defaults to `us-east-1` in CI when unset)                                                                    |
| `UPDATE_REMOTE_RELEASES`     | Set to `true` on Windows when an existing Squirrel feed is available for delta creation                                 |
| `WINDOWS_PACKAGING_TEMP`     | Optional short Windows temp directory; defaults to `<drive>\\t` so nuget.exe and Squirrel extract stay under `MAX_PATH` |
| `KILO_VC_REDIST_DIR`         | Optional `VC\Redist\MSVC\<version>` directory to bundle the VC++ runtime from; defaults to the one found with `vswhere` |

## GitHub Environments

CI publish jobs assume GitHub Environments named `preview` and `production`, each
with repository/environment variables:

| Environment variable | Meaning                                     |
| -------------------- | ------------------------------------------- |
| `UPDATE_PUBLISH_URL` | Public HTTPS update base URL for that track |
| `UPDATE_S3_BUCKET`   | S3 bucket for Forge publish                 |
| `AWS_ROLE_ARN`       | IAM role assumed via GitHub OIDC            |
| `AWS_REGION`         | Optional; defaults to `us-east-1`           |

Both environments must restrict deployments to `main` (deployment branch policy), and
`production` should require reviewer approval. Each IAM role trusts only the matching
`environment:<name>:ref:refs/heads/main` OIDC subject, which needs the repository's OIDC
subject template customized to include `environment` and `ref`. Jobs assume the role
immediately before publishing, after dependency install and build.

Official builds also need these service IDs. They are not committed, so source builds and
forks report nothing and resolve feature flags to their defaults. `Build` and `Release` fail
early when one is missing (`.github/actions/require-service-config`). Values shared by both
tracks are repository-level variables; only the LaunchDarkly ID differs per environment.

| Variable                           | Level                      | Meaning                                       |
| ---------------------------------- | -------------------------- | --------------------------------------------- |
| `VITE_SENTRY_DSN`                  | Repository                 | Sentry DSN for the desktop app                |
| `VITE_BRIDGE_SENTRY_DSN`           | Repository                 | Sentry DSN passed to the conda bridge sidecar |
| `VITE_POSTHOG_KEY`                 | Repository                 | PostHog project key for product telemetry     |
| `SENTRY_ORG`                       | Repository                 | Sentry org slug for source-map upload         |
| `VITE_LAUNCHDARKLY_CLIENT_SIDE_ID` | `production` and `preview` | LaunchDarkly client-side ID for that track    |

`UPDATE_PUBLISH_URL_PREVIEW` and `UPDATE_PUBLISH_URL_STABLE` are repository-level variables
(visible to both environments) because every build needs both hosts.

## Workflows

| Workflow         | Trigger                                  | Behavior                                                                                                              |
| ---------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `CI`             | Pull request / merge queue               | Lint, format check, `pnpm check`, and package tests                                                                   |
| `Build`          | Manual                                   | `pnpm run make -- --arch=<arch>` only; uses Preview signing configuration; GitHub artifacts named `<platform>-<arch>` |
| `Release`        | Every three hours, or manual from `main` | Scheduled/manual Preview or manual Stable publication                                                                 |
| `PR macOS Build` | `build:macos` PR label, or manual        | Unsigned macOS make for PR verification; never receives signing secrets                                               |
| `Nightly E2E`    | Daily or manual                          | Full cross-platform E2E; independent from Preview releases                                                            |

Scheduled `Release` runs compare `main` with the latest `v*-preview-*` tag and skip
publication when the commit has not changed. Manual Preview runs always publish.

Stable releases publish the version committed in `apps/desktop/package.json`
(`X.Y.Z` or `X.Y.Z-prerelease`):

1. Open a pull request that bumps the release-coupled manifests and lockfile:

   ```sh
   pnpm --filter @kilo-desktop/desktop exec tsx config/desktop-version.ts 1.2.3
   pnpm install --lockfile-only --ignore-scripts
   ```

2. After it merges, dispatch `Release` with track `stable` from `main`. Pushing a tag does
   not trigger a release; runs from any ref other than `main` are rejected.

Plain `X.Y.Z` is marked latest; suffixed Stable versions are GitHub prereleases.
Squirrel.Windows limits the prerelease portion to 20 characters. Fresh runs reject an existing
Stable release; retrying the original workflow run may overwrite it to recover a partial
publication. Stable workflows are serialized. The release uses only the default
`GITHUB_TOKEN` to create the tag and GitHub Release, so no branch-protection bypass is needed.

Signing secrets and update variables live on the GitHub Environments above. `Build`
attaches the `preview` environment so the same codesign material is available for
manual makes. Signed builds therefore run only from `main`, with the same reviewer approval
as a Preview release; `Build` never assumes the AWS role or publishes to S3. Linux jobs install `fakeroot` for DEB packaging
and the `pkg-config`/`libsecret` development packages required to rebuild keytar.

## Signing credentials

CI uses the following GitHub secret names. Define them on the `preview` and `production`
environments only, never at repository or organization level, so only reviewer-gated
`main` runs can read them. Jobs load signing material after `pnpm install`, so dependency
install scripts never run with it.

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
`UPDATE_S3_BUCKET`; both Preview and Stable additionally require:

- macOS: a signing identity **and** notarization credentials
- Windows: Azure Key Vault credentials or a certificate file

Unsigned local `make` runs remain supported because publish preflight is not invoked.

`electron-forge publish --dry-run` runs the complete package/make lifecycle and records
publisher metadata without uploading. Unit tests in `apps/desktop/config/release.test.ts`
pin the S3 key and runtime feed URL to the same update-channel/platform/architecture path.
