# Third-party notices

This package contains code ported or adapted from the projects below. Each entry
lists the local file and the upstream file it derives from
(`local ← upstream`, upstream paths relative to that project's root).

## dugite

Ported or adapted from [dugite](https://github.com/desktop/dugite).

- `src/exec/{exec,spawn,ignore-closed-input-stream,errors,env-map,parse-error,parse-bad-config-value-error-info}.ts` ← the same-named `lib/*.ts`
- `src/exec/{environment,resolve-git}.ts` ← `lib/git-environment.ts`
- The exec-layer tests (`src/exec/*.test.ts`) and the `src/test/util.ts` helpers ← `test/**`

License: MIT. Copyright (c) 2016 GitHub and contributors.

```text
MIT License

Copyright (c) 2016 GitHub and contributors

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

## GitHub Desktop

Ported or adapted from [GitHub Desktop](https://github.com/desktop/desktop).

- `src/git/{core,status,rev-parse,reflog,worktree,for-each-ref,branch,checkout,config,init,refs,remote,show,coerce-to-string,push-terminal-chunk}.ts` ← the same-named `app/src/lib/git/*.ts`
- `src/lib/{status-parser,split-buffer,directory-exists}.ts` ← the same-named `app/src/lib/*.ts`
- `src/lib/git-delimiter-parser.ts` ← `app/src/lib/git/git-delimiter-parser.ts`
- `src/models/{status,branch,worktree}.ts` ← the same-named `app/src/models/*.ts`
- The ported tests (`src/git/*.test.ts`, `src/lib/*.test.ts`) and `src/test/fixtures/**` ← `app/test/**`

License: MIT. Copyright (c) GitHub, Inc.

```text
Copyright (c) GitHub, Inc.

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

`src/git/diff.ts` is original work; its tests port GitHub Desktop's working-directory diff cases.
