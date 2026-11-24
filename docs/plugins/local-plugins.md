# Local plugins

A local plugin is your own plugin, run by the installed app (Stable or
Preview) from your plugins folder. It is the same kind of plugin as a bundled
one — a `plugin.json`, a main and/or web entry, contracts — loaded from disk
at launch instead of compiled in. The design is decision 76 in
[plugin-architecture.md](../plugin-architecture.md#decision-log).

## Trust

A local plugin runs with the app's own access: its main entry in Electron's
main process (full Node: your files, the network, child processes), its web
entry inside every window, next to the app's own code. Nothing sandboxes it.
So:

- The whole feature sits behind kilo.shell's `local-plugins` feature flag.
  While it's off, Settings → Plugins is hidden and nothing is scanned or
  loaded, whatever was enabled before. Plugins load before LaunchDarkly
  answers, so with LaunchDarkly configured the app uses the flag's last value
  and a change applies from the next launch. A build override
  (`VITE_FEATURE_FLAG_OVERRIDES`), or a build without LaunchDarkly (where the
  flag is its default, off), applies at once.
- Local plugins are **off** until you turn them on in **Settings → Plugins**.
- Each plugin runs only once you **approve** it. The app asks in a native
  dialog and pins the approval to a digest of the plugin's files: change any
  file (a rebuild included) and it asks again.
- Main and windows run only the exact bytes you approved, held in memory:
  a plugin can import its own approved files, Node's built-ins (main) and
  the shared modules below — nothing else.
- Everything applies **from the next launch**; the page offers a restart.
- Safe mode (`--safe-mode`) loads no local plugins.

## Where plugins live

One folder per plugin in `<userData>/local-plugins/` (Settings → Plugins shows the
path and opens it). A folder may be a symlink to your project, so you can
develop in place: dot entries (`.git`) and `node_modules` are ignored, and
are neither approved nor loadable — **bundle your dependencies**.

```
plugins/
└── my-plugin/
    ├── plugin.json
    ├── contracts.js   ← export const definitions = { domainObjects, extensionPoints, objectTypes }
    ├── main.js        ← export default definePlugin({ activate(sdk) { … } })
    └── web.js         ← export default definePlugin({ activate(sdk) { … } })
```

## The manifest

A v1 manifest, as for any plugin ([README.md](./README.md#the-manifest)), plus:

- `engines["kilo-desktop"]` — **required**: the plugin API versions it works
  with, as a semver range (`"^1.0"`). The app offers `KERNEL_API_VERSION`
  (`1.0.0`) and refuses plugins outside the range.
- `main`, `web`, `contracts` — paths of **built** ES modules (`.js`/`.mjs`),
  relative to the manifest; TypeScript or JSX source is refused. At least one
  of `main` and `web`. `contracts` exports `definitions`; the entries
  default-export a plugin entry. The workspace examples point at source, so
  build one first (`examples/right-panel-plugin` has `build:local-plugin`).

Not allowed: ids under the `kilo.` publisher or a bundled plugin's id, URL
schemes (`permissions.protocols`), embedded hosts, and host permissions
other than `windows`, `dialogs`, `clipboard`, `os` and `notifications`.

## Shared modules

Your code runs against the app's own copies of these — keep them external
when you bundle (`external: [...]` in Vite/esbuild/rolldown), never bundle
them:

| Where   | Modules                                                                                                                                                                                                                                                                                                                                                                                            |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main    | `zod`, `@kilo-desktop/kernel`                                                                                                                                                                                                                                                                                                                                                                      |
| Windows | `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`, `zod`, `@kilo-desktop/kernel`, `@kilo-desktop/kernel/web`, `@kilo-desktop/ui/lib/utils`, and `@kilo-desktop/ui/components/` `alert`, `badge`, `button`, `card`, `checkbox`, `empty`, `field`, `input`, `item`, `kbd`, `label`, `scroll-area`, `select`, `separator`, `skeleton`, `spinner`, `switch`, `tabs`, `textarea`, `tooltip` |

Anything else (icons, your own libraries) you bundle. The app's Tailwind
classes exist only where the app itself uses them: style your own markup with
your own CSS (load it from `new URL("./web.css", import.meta.url)`), or with
the shared components and the theme's CSS variables.

To contribute to another plugin's extension point, pass `{ id: "<point id>" }`
— the kernel matches points by id — or bundle that plugin's contracts.

## Try it

1. Copy [`examples/local-plugin`](../../examples/local-plugin) into your
   plugins folder.
2. Settings → Plugins → turn on **Enable local plugins**, turn on "Local
   Hello"'s switch (confirm with **Enable**), then **Restart**.
3. Settings → **Local Hello**: the button counts in main and survives a
   restart. The command palette has **Local Hello: Count one more**.

## When something goes wrong

Settings → Plugins says why a plugin can't load (its manifest, engine,
permissions, a missing entry) or that loading its code failed. Activation
problems show in Settings → Developer → Diagnostics like any plugin's, marked
external; main's log has the details.
