# Testing a plugin

Tests boot **real kernels** with the plugins under test — never a
hand-rolled fake kernel or sdk. Which tier to use (unit, integration,
browser, app, e2e) and how to run each is in
[docs/TESTING.md](../TESTING.md); this page is about the plugin test hosts.

| Helper                                  | Import                                       | Use it for                                                                                |
| --------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `createPluginHost`                      | `@kilo-desktop/kernel/testing/plugin-host`   | One plugin's contributions and domain objects, without the owner's UI                     |
| `createTestKernelPair`                  | `@kilo-desktop/kernel/testing`               | A main and a window kernel with any registrations you choose                              |
| `createTestHost`, `createMemoryStorage` | `@kilo-desktop/kernel/testing`               | Host primitives and in-memory kv for those kernels                                        |
| `renderShell`, `contributor`            | `@kilo-desktop/plugin-shell/testing`         | The real kilo.shell window around your plugin                                             |
| `renderWorkSessions`, `paneKindPlugin`  | `@kilo-desktop/plugin-work-sessions/testing` | The shell and kilo.work-sessions' real window (over an in-memory main) around your plugin |

A plugin that hosts points may export its own `./testing` fixture (like
`renderShell`); tests — only tests — may import another plugin's
`./testing`. Today kilo.shell and kilo.work-sessions export one.

## `createPluginHost`

Boots just the plugins you name. A point's owner needs only its manifest and
contract definitions, so you test a contribution on its own:

```tsx
import { createPluginHost } from "@kilo-desktop/kernel/testing/plugin-host";
import shellManifest from "@kilo-desktop/plugin-shell/plugin.json";
import { SHELL_DEFINITIONS, SettingsSection } from "@kilo-desktop/plugin-shell/contracts";

const host = await createPluginHost([
	{ manifest: shellManifest, definitions: SHELL_DEFINITIONS }, // the point's owner: contracts only
	{ manifest, definitions: ACME_DEFINITIONS, main: acmeMainEntry, web: acmeWebEntry },
]);

const slot = host.renderSlot(SettingsSection, {}, { select: (impl) => impl.component });
await expect.element(page.getByTestId("acme-settings")).toBeVisible();
expect(slot.keys()).toEqual(["acme.tools/settings"]);

await host.invoke(AcmeStatus, "refresh", {}); // a domain method, as the window calls it
await host.invoke(AcmeStatus, "refresh", {}, { as: "acme.other" }); // as another plugin, for caller checks
await host.renderer.commands.execute("acme.tools/refresh");
await host.dispose();
```

- `renderSlot(point, props?, { select })` renders every active contribution
  to the point, each in its own plugin's sdk; `select` picks the component
  out of an implementation object (leave it out when the implementation is
  the component). It renders with React DOM, so it needs a DOM (browser
  tests); `invoke` works in node tests too.
- Each plugin gets in-memory storage in main. Provide host primitives on
  `host.main.kernelSdk` (below); pass `{ host: { desktop: true } }` to set
  `kernel/desktop`.
- Always `dispose()` (an `afterEach` over the hosts you made).

See `examples/hello-plugin` for node tests (`src/main/greetings.test.ts`,
`src/web/hello.test.ts`), `plugins/shell/src/web/updates/updates.browser.test.tsx`
for `renderSlot`, and `examples/right-panel-plugin/src/web/right-panel.browser.test.tsx`
for `renderShell`.

## Faking what you depend on

- **A host primitive:** provide the kernel's domain object yourself:
  `host.main.kernelSdk.domainObjects.provide(KernelUpdater, { initialState, methods })`.
- **Another plugin:** register a small fake with the owner's real manifest
  and definitions and an entry that provides only what you use. Fakes throw
  `KernelError`s, as the real plugin does — only those keep their message
  across processes.
- **The real owner:** give it its entries instead, or use its `./testing`
  fixture: `renderShell` for kilo.shell (`core` stands in for kilo.core's
  domain objects, `beforeRender(main)` provides host primitives before the
  window renders); `renderWorkSessions` for kilo.work-sessions (with
  `paneKindPlugin` to contribute a pane kind).

## Rules that keep tests reliable

- **No module mocks in browser tests.** `vi.mock` fights Vite's dependency
  optimizer and hides real wiring; fake through the kernel instead (above).
- **No dynamic `import()`** in plugin code or tests. Entries load
  statically, and a late import makes Vite re-optimize mid-run ("failed to
  find the current suite"). List every dependency your browser tests load in
  the config's `optimizeDeps.include`.
- **Generous waits, no sleeps.** Use retrying assertions —
  `expect.element(…)`, `expect.poll(…)` — rather than fixed delays; CI
  machines are slower than yours. Assert what a person sees, located by
  `data-qa-id` (`page.getByTestId`).
- **Keep Node out of browser-loaded modules.** Code that imports Node
  built-ins belongs in `src/main`, not in modules a browser test imports.
- **Clean up.** Dispose hosts and close handles before deleting temp
  folders (Windows keeps them locked).

## App-wide checks

These run in CI for every bundled plugin; you get them by registering it.

- **Removability.** `apps/desktop/src/main/kernel/plugins.removability.test.ts`
  (main entries) and `apps/web/src/kernel/removability.app.test.tsx` (web
  entries, window rendered) boot the bundled set once without each plugin
  and fail on any plugin not `active`, any error issue or any error logged.
  Code for "the plugin I use is missing" paths, not just the happy path.
- **Isolation.** `pnpm check:plugin-isolation` validates every bundled and
  example plugin's manifest, exports and imports (every import declared in
  its `package.json`, workspace dependencies published-shape), then
  `pnpm deploy`s plugins outside the monorepo and type-checks them there.
  By default it builds kilo.workspace-board and the examples; `--build all` builds
  everything (CI), `--build terminal,git` picks folders.
- **Boundaries.** `pnpm lint` fails if a plugin imports another plugin's
  internals or the apps, or if the [plugin schema](./schema.md) is stale
  (`pnpm docs:schema` regenerates it).
- **E2E.** Every plugin ships at least one `@smoke` Playwright spec in
  `e2e/specs/` (see `.agents/skills/write-e2e-test/SKILL.md`); map new spec
  folders to the plugin in `e2e/utils/registered-specs.ts`.
