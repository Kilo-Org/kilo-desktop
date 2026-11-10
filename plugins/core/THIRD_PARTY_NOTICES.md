# Third-party notices

## Kilo CLI

The app runs the Kilo CLI (`kilo`), staged into the app's `kilo/` resources from
the `@kilocode/cli-<platform>` npm packages, built from
[Kilo Code](https://github.com/Kilo-Org/kilocode) (`packages/opencode`). Its
license is the Kilo Code license below. The CLI is a single compiled executable;
the npm packages carry no notices for the libraries compiled into it.

## Ported code

This plugin contains code ported or adapted from Kilo Code. Each entry lists the
local file and the upstream file it derives from (`local ← upstream`).

- `src/web/onboarding/work-style-presets.ts` ← `packages/kilo-vscode/src/shared/work-style-presets.ts`
- `src/web/onboarding/WorkStyleStep.tsx` and `src/web/onboarding/work-style-step.tsx` (UI copy) ← `packages/kilo-vscode/webview-ui/src/i18n/en.ts`
- `src/web/providers/custom-provider.ts` ← `packages/kilo-vscode/src/shared/{custom-provider,provider-model}.ts`

License: MIT. Copyright (c) 2026 Kilo Code. Copyright (c) 2025 opencode.

```text
MIT License

Copyright (c) 2026 Kilo Code
Copyright (c) 2025 opencode

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
