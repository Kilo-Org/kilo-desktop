# apps/desktop — agent notes

## Networking

All network requests from the main process **must** use Electron's `net`
(`net.fetch`), never Node `fetch`/`http`/`https` or a bundled client like axios.
`net` routes through Chromium's network stack, which honors OS/corporate proxy
settings and system certificate stores. Reuse the existing `electronFetch`
(`src/main/features/auth/electron-oauth.ts`) or `HttpClient`
(`src/main/platform/HttpClient.ts`) rather than calling `net.fetch` ad hoc.

Modules that perform HTTP (e.g. `features/auth/actions.ts`) take an injected
`OAuthFetch` (backed by `electronFetch`) so they stay testable and never reach
for global `fetch`.

## Logging

Main-process logging **must** go through `electron-log` via a scoped logger
(sink), never raw `console.*` or hand-written `[subject]` string prefixes.
`electron-log` routes to the console (dev: the `pnpm dev` terminal) and the
on-disk log file (packaged), and its scope is the subject tag.

Create a scoped logger with `createLogger("<subject>")`
(`src/main/platform/logger.ts`); the scope is rendered automatically, so log
messages without a manual prefix:

```ts
const logger = createLogger("auth");
logger.info("login started"); // → tagged with the "auth" scope
logger.error("login failed", cause);
```

For testability, code paths that log accept an injected logger (a structural
`{ info; warn; error }`) defaulting to `createLogger(...)`, so tests pass a
no-op logger instead of initializing `electron-log` against a mocked `electron`.

## Utilities / lodash

Use `lodash` for deep-equality and collection helpers (e.g. `isEqual`,
`isEmpty`) rather than hand-rolling field-by-field comparisons or
`Object.keys(...).length` checks. Import per method via deep paths — never
the barrel import, which pulls in the whole library:

```ts
import isEqual from "lodash/isEqual.js";
import isEmpty from "lodash/isEmpty.js";
```

Only `lodash` (CJS) is in the dependency tree, not `lodash-es`.
