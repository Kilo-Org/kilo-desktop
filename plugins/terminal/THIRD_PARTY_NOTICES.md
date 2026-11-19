# Third-party notices

This plugin contains code ported or adapted from the projects below. Each entry
lists the local file and the upstream file it derives from
(`local ← upstream`, upstream paths relative to that project's root).

## t3code

Ported or adapted from [t3code](https://github.com/pingdotgg/t3code).

- The `PtyExitEvent` and `PtyProcess` interfaces in `src/main/sessions/pty.ts` ← `apps/server/src/terminal/PtyAdapter.ts`

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

## Visual Studio Code

Ported or adapted from [Visual Studio Code](https://github.com/microsoft/vscode).

- `src/main/profiles/detect-profiles.ts` ← `src/vs/platform/terminal/node/terminalProfiles.ts`
- `src/main/profiles/wsl.ts` ← `src/vs/platform/terminal/node/terminalProfiles.ts` (`getWslProfiles`)
- `src/main/profiles/powershell.ts` ← `src/vs/base/node/powershell.ts`
- `src/main/profiles/find-executable.ts` ← `src/vs/base/node/processes.ts` (`findExecutable`)
- `src/main/profiles/detect-profiles.test.ts` ← `src/vs/workbench/contrib/terminal/test/node/terminalProfiles.test.ts`

License: MIT. Copyright (c) 2015 - present Microsoft Corporation.

```text
MIT License

Copyright (c) 2015 - present Microsoft Corporation

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
