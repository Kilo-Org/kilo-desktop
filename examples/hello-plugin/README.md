# example.hello

A minimal plugin to copy when writing your own
([docs/plugins](../../docs/plugins/README.md)). It is a workspace package but
never bundled into the app.

| File                             | Shows                                                             |
| -------------------------------- | ----------------------------------------------------------------- |
| `plugin.json`                    | A v1 manifest: a domain object, a settings section, a command     |
| `src/contracts/index.ts`         | The `example.hello/greetings` domain object other plugins may use |
| `src/main/index.ts`              | Providing it in main, saved in the plugin's own kv store          |
| `src/web/index.ts`               | Binding the settings section and the command in each window       |
| `src/web/HelloSettings.tsx`      | Reading and calling a domain object from React                    |
| `src/main/greetings.test.ts`     | A node test with `createPluginHost` and `invoke`                  |
| `src/web/hello.browser.test.tsx` | A browser test with `renderSlot` and a command                    |

```bash
pnpm --filter @kilo-desktop/example-hello test
node scripts/check-plugin-isolation.mjs --build hello-plugin   # builds it outside the monorepo
```
