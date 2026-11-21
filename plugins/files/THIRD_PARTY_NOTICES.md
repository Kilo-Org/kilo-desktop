# Third-party notices

## t3code

Ported or adapted from [t3code](https://github.com/pingdotgg/t3code).

- `src/web/external-editors/ExternalEditorIcons.tsx` (the editor icon components) ← `apps/web/src/components/Icons.tsx` and `JetBrainsIcons.tsx`
- `src/web/markdown/markdown-file-links.ts` and the test cases in `markdown-file-links.test.ts` ← `packages/shared/src/markdownLinks.ts` and `apps/web/src/markdown-links.test.ts`
- `ensurePierreIconSprite` in `src/web/file-icons/PierreFileIcon.tsx` ← `apps/web/src/pierre-icons.ts`

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

## @nteract/sift and @nteract/sift-csv

The table viewer uses `@nteract/sift` (Parquet and Arrow decoding, the table)
and `@nteract/sift-csv` (CSV and TSV to Arrow), both BSD-3-Clause
(`lib/LICENSE` in each package). Each package compiles Rust crates into its
WebAssembly module (Apache Arrow and Parquet, Zstandard, and others) and lists
them with their license texts in its own `lib/THIRD_PARTY_NOTICES.md`.
