# Third-party notices

This plugin contains code ported or adapted from the projects below. Each entry
lists the local file and the upstream file it derives from
(`local ← upstream`, upstream paths relative to that project's root).

## Kilo Code

Ported or adapted from [Kilo Code](https://github.com/Kilo-Org/kilocode).

- `src/web/checkpoints/checkpoint-restore-controls.tsx` (UI copy) ← `packages/kilo-vscode/webview-ui/src/i18n/en.ts`
- `src/web/usage/session-model-usage.ts` ← `packages/kilo-vscode/webview-ui/src/context/model-usage.ts`

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

## assistant-ui

Adapted from the [assistant-ui](https://github.com/assistant-ui/assistant-ui)
component registry.

- `src/web/thread/attachment.tsx`, `markdown-text.tsx`, `tooltip-icon-button.tsx` and parts of `messages.tsx` ← the registry's `attachment`, `markdown-text`, `tooltip-icon-button` and `thread` components
- `react-opencode/src/*` (forked, then modified) ← `packages/react-opencode/src/*` at tag `@assistant-ui/react-opencode@0.2.17` (commit `c67168eef015da3885ee22d4f6aae4f624a681b5`); its licence is also in `react-opencode/LICENSE`

License: MIT. Copyright (c) 2026 AgentbaseAI Inc.

```text
MIT License

Copyright (c) 2026 AgentbaseAI Inc.

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

## t3code

Ported or adapted from [t3code](https://github.com/pingdotgg/t3code).

- `src/web/plan/plan-markdown.ts` and `plan-markdown.test.ts` ← `apps/web/src/proposedPlan.ts` and `proposedPlan.test.ts`
- `src/web/html-render/html-render-bootstrap.ts` ← `packages/shared/src/htmlRender.ts`
- The model-facing guidance in `src/contracts/html-render.ts` ← `packages/shared/src/htmlRender.ts`, `apps/server/src/mcp/toolkits/html/tools.ts` and `packages/provider-core/src/server/orchestrationInstructions.ts`
- The composer glass effect in `src/web/thread/composer.css` ← t3code's composer styles

License: MIT. Copyright (c) 2026 T3 Tools Inc.

```text
MIT License

Copyright (c) 2026 T3 Tools Inc.

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
