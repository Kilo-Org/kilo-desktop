# Testing a plugin

Tests boot **real kernels** with the plugins under test — never a
hand-rolled fake kernel or sdk. Which tier to use (unit, integration,
browser, app, e2e) and how to run each is in
[docs/TESTING.md](../TESTING.md); this page is about the plugin test hosts.

| Helper                                  | Import                                     | Use it for                                                            |
| --------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------- |
| `createPluginHost`                      | `@kilo-desktop/kernel/testing/plugin-host` | One plugin's contributions and domain objects, without the owner's UI |
| `createTestKernelPair`                  | `@kilo-desktop/kernel/testing`             | A main and a window kernel with any registrations you choose          |
| `createTestHost`, `createMemoryStorage` | `@kilo-desktop/kernel/testing`             | Host primitives and in-memory kv for those kernels                    |
| `renderShell`                           | `@kilo-desktop/plugin-shell/testing`       | The real kilo.shell window around your plugin                         |

A plugin that hosts points may export its own `./testing` fixture (like
`renderShell`); tests — only tests — may import another plugin's
`./testing`.

## `createPluginHost`

Boots just the plugins you name. A point's owner needs only its manifest and
contract definitions, so you test a contribution on its own:

```tsx
import { createPluginHost } from "@kilo-desktop/kernel/testing/plugin-host";
import shellManifest from "@kilo-desktop/plugin-shell/plugin.json";
import {
	SettingsSection,
	SHELL_DOMAINS,
	SHELL_EXTENSION_POINTS,
} from "@kilo-desktop/plugin-shell/contracts";

const host = await createPluginHost([
	{
		manifest: shellManifest,
		definitions: { extensionPoints: SHELL_EXTENSION_POINTS, domains: SHELL_DOMAINS },
	},
	{ manifest, definitions: HELLO_DEFINITIONS, main: helloMainEntry, web: helloWebEntry },
]);

const slot = host.renderSlot(SettingsSection, {}, { select: (impl) => impl.component });
await expect.element(page.getByTestId("hello-count")).toHaveTextContent("No greetings yet.");
expect(slot.keys()).toEqual(["example.hello/hello"]);

await host.invoke(Greetings, "greet", { name: "Ada" }); // a domain method, as another plugin calls it
await host.renderer.commands.execute("example.hello/say-hello");
await host.dispose();
```

- `renderSlot(point, props?, { select })` renders every active contribution
  to the point, each in its own plugin's sdk. It renders with React DOM, so
  it needs a DOM (browser tests); `invoke` works in node tests too.
- Each plugin gets in-memory storage in main. Provide host primitives on
  `host.main.kernelSdk` (below); pass `{ host: { desktop: true } }` to set
  `kernel/desktop`.
- Always `dispose()` (an `afterEach` over the hosts you made).

See `examples/hello-plugin` for a node test (`src/main/greetings.test.ts`)
and a browser test (`src/web/hello.browser.test.tsx`).

## Faking what you depend on

- **A host primitive:** provide the kernel's domain object yourself:
  `host.main.kernelSdk.domains.provide(KernelUpdater, { initialState, methods })`.
- **Another plugin:** register a small fake with the owner's real manifest
  and definitions and an entry that provides only what you use. Fakes throw
  `KernelError`s, as the real plugin does — only those keep their message
  across processes.
- **The real owner:** give it its entries instead, or use its `./testing`
  fixture (`renderShell` for kilo.shell, with `beforeRender(main)` to
  provide host primitives before the window renders).

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
  internals or the apps, or if the extension point catalog is stale.
- **E2E.** Every plugin ships at least one `@smoke` Playwright spec in
  `e2e/specs/` (see `.agents/skills/write-e2e-test/SKILL.md`); map new spec
  folders to the plugin in `e2e/utils/registered-specs.ts`.
