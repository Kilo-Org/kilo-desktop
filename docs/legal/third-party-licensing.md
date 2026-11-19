# Licensing and third-party notices

Kilo Desktop's source code is available under the Open Core Ventures Source
Available License (OCVSAL) v1.0, copyright Anaconda, Inc.
([LICENSE.md](../../LICENSE.md)). The license covers the source code, not the
built app, so packaging does not ship it.
Every workspace `package.json` declares `"author": "Anaconda, Inc."` and points
`license` at that file (`SEE LICENSE IN …`); a test in
`apps/desktop/config/workspace-packages.test.ts` keeps new packages in line. The
packaged app's copyright string (macOS `NSHumanReadableCopyright`, Windows
`LegalCopyright`) comes from `getAppCopyright` in `apps/desktop/config/app-identity.ts`.

## What ships, and how

Packaging (`writeAppLegalFiles` in `apps/desktop/config/third-party-notices.ts`,
run in Forge's `beforeAsar`) writes two files beside `app.asar`:

| File                      | Content                                                                                                                                                                                                                                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `THIRD_PARTY_NOTICES.txt` | Generated from what ships: Electron; every npm package packed into `app.asar` or bundled by Vite into a shipped bundle (each bundle's `build.license` list), with its license, NOTICE and third-party-notices files; every packed workspace package's `THIRD_PARTY_NOTICES.md`; the conda bridge payload's own notices |
| `LICENSES.chromium.html`  | Chromium's credits, from the Electron distribution                                                                                                                                                                                                                                                                     |

Settings → About → Legal links to Kilo's terms of service, shows the notices,
and reveals Chromium's credits in the file manager (kilo.shell, `kilo.shell/legal`).

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

### Fonts

The renderer self-hosts three typefaces. `apps/web/src/globals.css` imports them,
and their `.woff2` subsets ship in the renderer's `assets/`. They are not in the
counts above: see flag 5.

| Package                                      | License | Role                        |
| -------------------------------------------- | ------- | --------------------------- |
| `@fontsource-variable/inter` 5.3.0           | OFL-1.1 | UI text (`--font-sans`)     |
| `@fontsource-variable/manrope` 5.3.0         | OFL-1.1 | Headings (`--font-heading`) |
| `@fontsource-variable/source-code-pro` 5.3.0 | OFL-1.1 | Code (`--font-mono`)        |

The SIL Open Font License is permissive and does not extend to the software that
uses the fonts. Redistributing the fonts unmodified only requires shipping their
copyright notice and the license text with them.

### Scanner findings on packages that do not ship

Supply-chain scanners (Socket) read every file in a package tarball, so they
report licenses of material a package vendors in addition to its declared one. These
findings were reviewed and accepted, because none of the material ships:

| Package                             | Declared   | Reported                                    | Source of the finding                                                                                                                                      |
| ----------------------------------- | ---------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `polished` 4.3.1                    | MIT        | OFL-1.1                                     | Source Code Pro in its `docs/assets/fonts/`. Dependency of `@lobehub/icons`, whose deep icon imports do not bundle `polished`.                             |
| `@vitest/istanbul-lib-report` 2.1.0 | MIT        | OFL-1.1                                     | Readex Pro, used by its HTML coverage report. Development only (`@vitest/coverage-v8`).                                                                    |
| `typescript` 5.9.3                  | Apache-2.0 | W3C Community Final Specification Agreement | One block of its `ThirdPartyNoticeText.txt`, for the Web Background Synchronization specification behind its `lib.*.d.ts` types. Development only (`tsc`). |

### Ported code

All ported code found is MIT, BSD-3-Clause or Apache-2.0 and is now credited:
dugite and GitHub Desktop (`packages/git-client`, kilo.git, kilo.work-sessions),
Visual Studio Code (kilo.git, kilo.work-sessions), Kilo Code (kilo.git, kilo.core,
kilo.chat, kilo.marketplace), Pierre diffshub (kilo.git), assistant-ui
(kilo.chat), nteract (kilo.notebook), shadcn/ui (`packages/ui`) and t3code.

**t3code.** More than the editor icons was copied. A line, token and prose
comparison against t3code's history found verbatim or near-verbatim code in the
plan markdown helpers and the HTML render bootstrap and guidance (kilo.chat), the
markdown file-link detection (kilo.files) and the page loading progress
(kilo.browser), plus smaller borrowings in kilo.files, kilo.work-sessions,
kilo.terminal and kilo.shell. All are credited under t3code's MIT license in
the packages' notices. Shared shadcn/ui stock components are shadcn's, not
t3code's.
