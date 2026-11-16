---
name: write-plugin
description: >-
  Build or extend a kernel plugin in Kilo Desktop: manifest (plugin.json),
  contracts, main/web entries, extension points, domain objects, commands,
  panes, agent tools, and their tests. Use when creating a new plugin, adding
  a contribution or extension point to a plugin, or when the user says "new
  plugin", "add a pane / command / settings section / tool", or "make this a
  plugin".
---

# Write a Plugin

The how-to lives in [docs/plugins](../../../docs/plugins/README.md); the
design in [docs/plugin-architecture.md](../../../docs/plugin-architecture.md).
Start from [examples/hello-plugin](../../../examples/hello-plugin). Read
`CONTEXT.md` first.

## Workflow

1. **Find the owner.** Decide which plugin owns the concept (§4 "split by
   domain"). Extend that plugin rather than creating a new one unless the
   feature is its own domain. Check the catalog
   (`docs/plugins/extension-points.md`) for an existing point before
   inventing one.
2. **Scaffold** (new plugin): copy `examples/hello-plugin` to
   `plugins/<dir>`; rename the package (`@kilo-desktop/plugin-<dir>`), the
   manifest id (`kilo.<name>` for bundled plugins) and every qualified id.
3. **Contracts first.** Define domain objects (`defineDomainObject`) and any
   points you own (`defineExtensionPoint`) in `src/contracts`, export a
   `*_DEFINITIONS`, and declare them in `plugin.json` (`domainObjects`,
   `extensionPoints`, `contextKeys`).
4. **Declare contributions** in `plugin.json` `contributes.extensions`
   (metadata only), with `requires` entries (`"optional"`) for every point
   and domain object you use.
5. **Implement** in `src/main` (domain providers, services, agent tools) and
   `src/web` (components, commands acting on the window) with
   `sdk.extensions.implement(Point, localId, impl)`. Keep `activate` fast;
   slow work is a `kernel/service`.
6. **Handle absence.** `sdk.domainObjects.get(X)` / `useDomainObject(X)` may be null;
   render a sensible fallback. Throw `KernelError` for expected failures.
7. **Test test-first** (the `tdd` skill) with real kernels:
   `createPluginHost` for contributions and domain methods, `renderShell` for
   the full window. No `vi.mock` in browser tests, no dynamic imports,
   retrying assertions only. See `docs/plugins/testing.md` and the
   `write-vitest` skill.
8. **Register** (bundled): `packages/bundled-plugins` (`package.json`,
   `src/plugins.ts`), `apps/desktop/src/main/kernel/plugins.ts`,
   `apps/web/src/kernel/plugins.ts`; add an `@smoke` e2e spec (the
   `write-e2e-test` skill) and map it in `e2e/utils/registered-specs.ts`;
   add one line to `CONTEXT.md`.
9. **Record extensibility.** New or changed surfaces get rows in the
   extensibility map (plugin-architecture.md §7). New points: run
   `pnpm docs:extension-points`.

## Rules

- Import another plugin only through `@kilo-desktop/plugin-<x>/contracts`
  (and `/plugin.json`; `/testing` in tests). Never import `apps/*` or
  Electron.
- Use local names in manifests; contributions reference fully qualified
  point ids (`kilo.shell/settings-section`).
- Each plugin owns its storage (`mainHost(sdk).storage`); never share it.
- UI from `@kilo-desktop/ui`; stable `data-qa-id` on interactive elements.
- Declare every import in `package.json`; `react`, `react-dom` and
  `@kilo-desktop/ui` as peers.
- Ship your own built-ins through your own points.

## Verify

```bash
pnpm check && pnpm lint && pnpm format:check
pnpm --filter <package> coverage          # 80% gate
pnpm check:plugin-isolation --build <dir>  # when imports or package.json change
cd e2e && npx tsc --noEmit -p tsconfig.json
```
