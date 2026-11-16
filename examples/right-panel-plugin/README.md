# example.right-panel

An example plugin that contributes panels to the shell's right sidebar
(`kilo.shell/right-sidebar-panel`): each panel gets an icon in the rail along
the window's right edge, and opens beside the main area when clicked. See
[docs/plugins](../../docs/plugins/README.md) and the
[extension point catalog](../../docs/plugins/extension-points.md). It is a
workspace package but never bundled into the app.

| File                                   | Shows                                                                                    |
| -------------------------------------- | ---------------------------------------------------------------------------------------- |
| `plugin.json`                          | Contributing to another plugin's extension point: each panel's title, order and width    |
| `src/contracts/index.ts`               | A plugin that declares nothing for others                                                |
| `src/web/index.tsx`                    | Binding each panel's component and rail icon; a panel that persists, one with live state |
| `src/web/right-panel.browser.test.tsx` | A browser test that boots the real shell with `renderShell` and opens the panels         |

```bash
pnpm --filter @kilo-desktop/example-right-panel test
node scripts/check-plugin-isolation.mjs --build right-panel-plugin   # builds it outside the monorepo
```

To try it in the app, register it like a bundled plugin (in
`packages/bundled-plugins` and `apps/web/src/kernel/plugins.ts`) on a local
branch; don't commit that.
