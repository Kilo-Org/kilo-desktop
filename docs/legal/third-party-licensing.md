# Third-party notices

Kilo Desktop ships third-party software: Electron and Chromium, npm packages,
code ported from other projects and bundled programs. This page describes how
their notices reach users and records the audit of what ships.

## What ships, and how

Packaging (`writeAppLegalFiles` in `apps/desktop/config/third-party-notices.ts`,
run in Forge's `beforeAsar`) writes two files beside `app.asar`:

| File                      | Content                                                                                                                                                                                                                                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `THIRD_PARTY_NOTICES.txt` | Generated from what ships: Electron; every npm package packed into `app.asar` or bundled by Vite into a shipped bundle (each bundle's `build.license` list), with its license, NOTICE and third-party-notices files; every packed workspace package's `THIRD_PARTY_NOTICES.md`; the conda bridge payload's own notices |
| `LICENSES.chromium.html`  | Chromium's credits, from the Electron distribution                                                                                                                                                                                                                                                                     |

Settings → About → Legal shows the notices, and reveals
Chromium's credits in the file manager (kilo.updates, `kilo.updates/legal`).

Code ported from other projects is credited in the `THIRD_PARTY_NOTICES.md` of
the workspace package that contains it (`local file ← upstream file`, with the
upstream license text). Packaging keeps that file in `app.asar` and reproduces
it in the app's notices. **When you port or copy code, add it to that file in
the same change.**

## Audit (November 2026)

Measured on a macOS arm64 package built from this change (base `b0da8da0c`).

### npm production dependencies

543 packages ship in the app (packed or bundled):

| License                                           | Packages |
| ------------------------------------------------- | -------- |
| MIT                                               | 470      |
| ISC                                               | 18       |
| Apache-2.0                                        | 22       |
| BSD-3-Clause / BSD-2-Clause / 0BSD                | 14       |
| BlueOak-1.0.0 (permissive)                        | 6        |
| Unlicense / CC0-1.0 / MIT OR CC0-1.0              | 8        |
| CC-BY-4.0 (`caniuse-lite`, data; credited here)   | 1        |
| MPL-2.0 OR Apache-2.0 (`dompurify`; Apache-2.0)   | 1        |
| FSL-1.1-Apache-2.0 (`sentry`, see flag 1)         | 1        |
| Not declared (Unlicense per their `LICENSE` file) | 2        |

No copyleft license. Nine packages publish no license file (`@kilocode/sdk`,
`@koromix/koffi-darwin-arm64`, `@oxc-parser/binding-darwin-arm64`,
`@sentry/server-runtime-injection`, `@sentry/server-utils`, `lru_map`,
`react-remove-scroll-bar`, `toggle-selection`, `use-composed-ref`); their entries
give the declared license and the source URL.

### Ported code

All ported code found is MIT, BSD-3-Clause or Apache-2.0 and is now credited:
dugite and GitHub Desktop (`packages/git-client`, kilo.git, kilo.workbench),
Visual Studio Code (kilo.git, kilo.workspaces), Kilo Code (kilo.git, kilo.agent,
kilo.chat, kilo.marketplace), Pierre diffshub (kilo.git), assistant-ui
(kilo.chat), nteract (kilo.notebook), shadcn/ui (`packages/ui`) and t3code.

**t3code.** More than the editor icons was copied. A line, token and prose
comparison against t3code's history found verbatim or near-verbatim code in the
plan markdown helpers and the HTML render bootstrap and guidance (kilo.chat), the
markdown file-link detection (kilo.files) and the page loading progress
(kilo.browser), plus smaller borrowings in kilo.files, kilo.workbench,
kilo.terminal and kilo.updates. All are credited under t3code's MIT license in
the packages' notices. Shared shadcn/ui stock components are shadcn's, not
t3code's.

### Bundled programs

| Component                                                                    | License                                                                             | Notice                                                                                                                                              |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Electron and Chromium                                                        | MIT; Chromium's credits                                                             | `THIRD_PARTY_NOTICES.txt`, `LICENSES.chromium.html`                                                                                                 |
| Kilo CLI (`kilo/`)                                                           | MIT (Kilo Code)                                                                     | kilo.agent's notices; see flag 3                                                                                                                    |
| nteract `runtimed` daemon and notebook UI                                    | BSD-3-Clause                                                                        | kilo.notebook's notices and `notebook/LICENSE.nteract`; see flag 3                                                                                  |
| Conda bridge payload (`bridge/`): CPython and ~130 Python and conda packages | Per component: PSF-2.0, permissive, MPL-2.0, LGPL-3.0, GPL with exceptions (flag 2) | The payload's `THIRD_PARTY_NOTICES` and `licenses/`, merged into the app's notices once the installed payload carries them (manifest `notices` key) |

## Open flags

| #   | Flag                                                                                                                                                                                                                                                                                                                                       | Needs                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| 1   | `sentry` 0.45.0 (the Sentry CLI, FSL-1.1-Apache-2.0, 15 MB) ships in `app.asar` through `@sentry/electron` → `@sentry/node` → `@sentry/bundler-plugins`. The app never runs it. FSL allows redistribution for non-competing use.                                                                                                           | Legal sign-off, or engineering prunes it               |
| 2   | Bridge payload: frozendict (LGPL-3.0), certifi and tqdm (MPL-2.0), menuinst (no SPDX id), GPL native libraries on macOS that are never loaded (readline, gettext), packages redistributed from Anaconda `defaults`, and the license texts of libraries statically linked into CPython. The bridge repo's legal review lists each decision. | Legal decisions; a payload release with notices        |
| 3   | The Kilo CLI binary, the nteract notebook UI (about 230 bundled npm packages) and the `runtimed` daemon (Rust crates) ship without notices for the libraries compiled into them. Their own licenses are credited; the bundled libraries' texts can only come from upstream.                                                                | Upstream to publish notices with their artifacts       |
| 4   | `plugins/account/src/web/onboarding/DotGrid.tsx` ports a shader from Kilo Code's private, unlicensed `kilocode-landing` repository.                                                                                                                                                                                                        | Kilo Code Inc., which owns that repository, to confirm |
