# Contributing to Kilo Desktop

Thanks for your interest in Kilo Desktop. Please read this guide before you open an issue
or a pull request.

## How we work with the community

Kilo Desktop is built by the Kilo team. The source is public so you can read it, build it,
and tell us what you find, but community contributions are not our focus right now.

- **Issues are welcome.** Bug reports and feature requests help us the most. The team
  reviews every issue. See [Reporting issues](#reporting-issues).
- **Pull requests are welcome, but they might not be merged.** We may close a pull request
  without merging it, even if it is correct, when it doesn't fit our roadmap or we don't
  have the capacity to review it. If you want to propose a change, open an issue first so
  we can tell you whether we would take it.
- **Security vulnerabilities** never go in a public issue. Follow
  [SECURITY.md](SECURITY.md).

Everyone who takes part follows our [Code of Conduct](CODE_OF_CONDUCT.md). For support,
how-to questions, and discussion, join the [Kilo Discord](https://kilo.ai/discord).

## Reporting issues

1. Search [existing issues](https://github.com/Kilo-Org/kilo-desktop/issues) first, including closed ones. If your problem is
   already reported, add a 👍 reaction or a comment with new information instead of
   opening a duplicate.
2. Use the issue template. Include your Kilo Desktop version, update track (Stable or
   Preview), and operating system.
3. Attach the application log when it helps: **Settings → About → Support** shows where the
   log file is. Copy it, trim the copy to the lines around the problem, and attach the
   trimmed file to the issue instead of pasting the log inline. Issues are public and the log
   is not redacted: it contains your OS username and file and project paths, and can include
   model and provider names, account details, environment details, and parts of your
   project's contents. Replace your username and remove anything private before you attach
   it.
4. Keep each issue to one problem.

Do not mass-create issues through automation or agents. Open an issue only when you have
enough context for someone to act on it. We may close duplicate, low-signal, or automated
issues without action.

## Prerequisites

- **Node.js 24 or newer.** `.nvmrc` pins the version CI uses.
- **pnpm**, at the version in the `packageManager` field of `package.json`. Use Corepack so
  the active version matches:

  ```bash
  corepack enable
  ```

- **Git** and the platform build tools for native modules (Xcode Command Line Tools on
  macOS, Visual Studio Build Tools on Windows, `build-essential` on Linux). Windows has
  its own guide: [docs/windows-setup.md](docs/windows-setup.md).

## Developing Kilo Desktop

### 1. Install dependencies

`@anaconda/playwright-utils` comes from the `@anaconda` scope, which `pnpm-workspace.yaml`
maps to GitHub Packages, so install needs a token with `read:packages`. (The desktop bridge
payloads share the scope but are pinned to the public npm registry with `npmjs:`.) pnpm
ignores env-expanded credentials in a project-level `.npmrc`, so store the token in user
config.

```bash
pnpm config set "//npm.pkg.github.com/:_authToken" <token-with-read:packages>
pnpm install --frozen-lockfile
```

The Forge CLI is published without an executable mode on its POSIX entry file, so the
root `postinstall` script normalizes that mode after pnpm links the hoisted dependency.

### 2. Start the app

```bash
pnpm dev
```

`pnpm dev` (or `pnpm start`) runs the web Vite server on port 5173 and then launches
Electron pointed at it through `KILO_WEB_DEV_SERVER_URL`. Electron proxies the renderer
through `kilo-desktop-dev://app/#/`. Don't run `electron-forge start` directly: without the
web dev server, the window loads empty.

Use `pnpm dev:web` for the React app alone: the page boots the main kernel in-process and
skips plugins whose main entry needs Node. [docs/architecture.md](docs/architecture.md#running-the-web-app-standalone)
explains what works in that mode.

### 3. Run the tests

Browser-mode web tests drive real Chromium, so install the browser once:

```bash
pnpm --filter @kilo-desktop/web exec playwright install chromium
pnpm test
```

[docs/TESTING.md](docs/TESTING.md) describes every test tier, including the packaged
Electron e2e suite.

## Common commands

Every command runs from the repository root and fans out to the relevant workspace
packages.

| Command                       | Purpose                                                                                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                    | Start web + Electron                                                                                                                               |
| `pnpm dev:web`                | Start the standalone React/Vite app                                                                                                                |
| `pnpm check`                  | Type-check every workspace package, including e2e                                                                                                  |
| `pnpm check:fast`             | Type-check every tsconfig in one process with Oxlint's tsrs backend (what the pre-push hook runs; CI still gates on `pnpm check`)                  |
| `pnpm lint`                   | Run oxlint, the plugin boundary check, and the extension-point catalog check                                                                       |
| `pnpm check:plugin-isolation` | Check plugin manifests and imports, and build a representative set of plugins outside the monorepo (`--build all` builds every plugin, as CI does) |
| `pnpm docs:extension-points`  | Regenerate the extension-point catalog after changing a point                                                                                      |
| `pnpm format`                 | Format with oxfmt                                                                                                                                  |
| `pnpm format:check`           | Verify formatting                                                                                                                                  |
| `pnpm test`                   | Run package tests (does not include e2e)                                                                                                           |
| `pnpm test:changed`           | Run only the tests a change since `origin/main` can reach                                                                                          |
| `pnpm coverage`               | Run tests with the 80% coverage gate                                                                                                               |
| `pnpm test:e2e`               | Package the app and exercise the hardened executable                                                                                               |
| `pnpm run package`            | Build web, then package Electron into `apps/desktop/out/`                                                                                          |
| `pnpm run make`               | Package the app and create the current platform's distributables                                                                                   |

Local builds are unsigned and don't check for updates. [docs/releases.md](docs/releases.md)
covers signing, release tracks, and publishing.

## Writing a plugin

Every feature of Kilo Desktop is a plugin, the shell included. To add or change one, read
[docs/plugins](docs/plugins/README.md) and start from
[examples/hello-plugin](examples/hello-plugin). A plugin reaches other plugins only through
the kernel and imports nothing from them except their `./contracts` export; `pnpm lint`
enforces this. Every bundled plugin ships at least one `@smoke` e2e spec.

## Debugging

### Log verbosity

Main-process logs (electron-log, console + file transports) default to `info`. Levels are
`error`, `warn`, `info`, `verbose`, `debug`, `silly`; anything below the configured level
is dropped. The environment variable wins over the saved preference:

```bash
KILO_LOG_LEVEL=debug pnpm dev
```

To persist a level across launches, set `"logLevel": "debug"` in `preferences.json` inside
the app's userData directory (for example,
`~/Library/Application Support/Kilo Desktop Dev/` on macOS).

### Local Sentry via Spotlight

Local development never reports to a remote Sentry project: in dev, `initSentry()` passes
no DSN and only `spotlightIntegration` is active. To inspect errors, traces, and logs
locally, run [Spotlight](https://spotlightjs.com) and then start the app:

```bash
npx @spotlightjs/spotlight   # sidecar + UI on http://localhost:8969
pnpm dev                     # in another terminal
```

Renderer events route through the main process, so they show up too. Spotlight is gated
on `!app.isPackaged`, so none of this runs in packaged builds and no `@spotlightjs/*`
package ships in the app bundle.

## Where to find things

- [CONTEXT.md](CONTEXT.md): every package and plugin, terminology, and conventions.
- [docs/architecture.md](docs/architecture.md): tech stack, repository layout, and Electron
  hardening.
- [docs/plugin-architecture.md](docs/plugin-architecture.md): the kernel and plugin design.
- [docs/plugins](docs/plugins/README.md): how to write a plugin. [llms.txt](llms.txt) is
  the same guide for coding agents.
- [plugins/notebook/docs](plugins/notebook/docs/README.md): how the notebook UI is embedded,
  with a bundled `runtimed` fallback.
- [docs/TESTING.md](docs/TESTING.md): test tiers and how to run them.
- [docs/releases.md](docs/releases.md): release tracks, signing, and CI.
- [docs/security-architecture-overview.md](docs/security-architecture-overview.md): trust
  boundaries and how the app protects them.
- [AGENTS.md](AGENTS.md): rules for AI coding agents working in this repository.

## Pull requests

If you open a pull request, keep in mind that it might not be merged (see
[How we work with the community](#how-we-work-with-the-community)). To give it the best
chance:

- Link the issue it addresses, and get agreement on the approach there first.
- Keep it small and focused on one change.
- Use a conventional commit title, for example `fix(git): handle detached HEAD`.
- Make sure `pnpm check`, `pnpm lint`, `pnpm format:check`, and `pnpm test` pass.
- Add or update tests for behavior changes, and include screenshots for visual changes.
- Fill in the pull request template.

### Contribution ownership and AI assistance

AI and coding agents are allowed, but you own the work you submit. Before you open a pull
request, make sure you understand the change, have tested it, and can explain the diff.

Do not submit batches of agent-generated, untested, or weakly reviewed pull requests. We
may close pull requests that appear to be submitted without credible ownership, and we may
block accounts that repeatedly disregard this guide.
