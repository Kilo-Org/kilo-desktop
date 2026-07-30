# Add a feature across every layer

In this tutorial you will add a "remove a todo" feature to Anaconda Agentic Desktop. By
the end, a todo can be deleted from the UI, the deletion persists in SQLite, and the same
UI still works in a plain browser with no Electron running.

You will touch every layer of the architecture in the order the type system asks for it:
the shared contract, the main process, both `LocalApi` adapters, the query layer, the UI,
and the tests. No prior knowledge of this codebase is needed beyond a working install.

The feature is deliberately small. What matters is the path through the layers, which is
identical for any real feature.

## Prerequisites

- A working install: `pnpm install --frozen-lockfile` succeeds (see the
  [README](../README.md#getting-started) if the `@anaconda` registry token is not set up)
- Chromium for browser tests: `pnpm --filter @anaconda-agentic-desktop/web exec playwright install chromium`
- A clean working tree, so you can inspect your own diff at the end

Every command below runs from the repository root.

## Step 1 — Define the channel in the shared contract

Nothing exists until the contract exists. Add the channel to
`packages/contracts/src/features/todos.ts`:

```ts
export const todoMethods = {
	"todos:list": defineIpcMethod(z.undefined(), z.array(todoSchema)),
	"todos:add": defineIpcMethod(z.object({ title: z.string().trim().min(1).max(120) }), todoSchema),
	"todos:toggle": defineIpcMethod(z.object({ id: z.string().min(1) }), todoSchema),
	"todos:remove": defineIpcMethod(
		z.object({ id: z.string().min(1) }),
		z.object({ id: z.string() }),
	),
} as const;
```

The channel is now part of `ipcMethods`, because `registry.ts` already merges
`todoMethods`. Verify:

```bash
pnpm check
```

**Expected result:** contracts and web pass, and desktop fails with exactly the error you
want to see:

```text
src/main/Application.ts(100,5): error TS2741: Property '"todos:remove"' is missing in
type '{ ... }' but required in type 'IpcHandlers'.
```

That failure is the point. Adding a channel to the registry makes the main process
structurally incomplete until it handles the channel. You never edit the preload — it
forwards any channel present in `ipcMethods` and validates against the same registry.

## Step 2 — Extend the host-facing facade

The renderer does not use channels; it uses `LocalApi`. Add the method to
`packages/contracts/src/local-api.ts`:

```ts
export interface LocalApi {
	todos: {
		list(): Promise<Todo[]>;
		add(input: { title: string }): Promise<Todo>;
		toggle(input: { id: string }): Promise<Todo>;
		remove(input: { id: string }): Promise<{ id: string }>;
	};
	// theme and shell unchanged
}
```

Verify:

```bash
pnpm check
```

**Expected result:** web now fails too, and the errors are a precise checklist of the
remaining work — `src/platform/electronLocalApi.ts`, `src/platform/browserLocalApi.ts`,
and the `LocalApi` test doubles in the browser tests.

## Step 3 — Implement the behavior in the main process

Add the database operation to `apps/desktop/src/main/features/todos/TodoService.ts`:

```ts
	remove(id: string): { id: string } {
		const result = this.db.delete(todos).where(eq(todos.id, id)).run();
		if (result.changes === 0) throw new BusinessError("Todo not found.");
		return { id };
	}
```

`BusinessError` is meaningful: `IpcServer` converts it into a `BUSINESS` error code the UI
can display, while any other thrown error becomes an opaque `INTERNAL`.

Then map the channel to the service in
`apps/desktop/src/main/features/todos/handlers.ts`:

```ts
export function createTodoHandlers(
	service: TodoService,
): Pick<IpcHandlers, "todos:list" | "todos:add" | "todos:toggle" | "todos:remove"> {
	return {
		"todos:list": () => service.list(),
		"todos:add": ({ title }) => service.add(title),
		"todos:toggle": ({ id }) => service.toggle(id),
		"todos:remove": ({ id }) => service.remove(id),
	};
}
```

`Application.ts` needs no change — it spreads the handler factories it already calls.

Verify:

```bash
pnpm --filter @anaconda-agentic-desktop/desktop check
```

**Expected result:** no output, meaning the main process now satisfies `IpcHandlers`.

This feature reuses the existing `todos` table. If yours needs a schema change, edit
`apps/desktop/src/main/features/<feature>/schema.ts` and generate a migration with
`pnpm --filter @anaconda-agentic-desktop/desktop db:generate` before continuing.

## Step 4 — Implement both adapters

Electron adapter, in `apps/web/src/platform/electronLocalApi.ts` — one line, because
`invoke` is typed by the contract:

```ts
			remove: (input) => invoke("todos:remove", input),
```

Browser adapter, in `apps/web/src/platform/browserLocalApi.ts` — the same behavior against
the in-memory array, including the equivalent error:

```ts
			async remove(input) {
				const index = todos.findIndex((todo) => todo.id === input.id);
				if (index === -1) {
					throw new LocalApiError("BUSINESS", "Todo not found.");
				}
				todos.splice(index, 1);
				return { id: input.id };
			},
```

Implement both, always. If the adapters diverge, the app behaves differently in the
browser than in Electron and the browser tests stop being meaningful.

Verify:

```bash
pnpm --filter @anaconda-agentic-desktop/web check
```

**Expected result:** only the test-double errors remain — you will fix those in step 7.

## Step 5 — Add the query layer

Append to `apps/web/src/features/todos/todos.ts`, mirroring the existing mutations:

```ts
export function removeTodoMutationOptions(api: LocalApi, queryClient: QueryClient) {
	return mutationOptions({
		mutationKey: ["todos", "remove"] as const,
		mutationFn: (id: string) => api.todos.remove({ id }),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: todosQueryKey });
		},
	});
}
```

The factory takes `api` as an argument rather than importing it, which is what lets tests
pass a fake `LocalApi`.

## Step 6 — Wire the UI

In `apps/web/src/features/todos/TodoList.tsx`, import `removeTodoMutationOptions`, add the
mutation, include its error in `mutationError`, and add the button to each list item:

```tsx
const removeTodo = useMutation(removeTodoMutationOptions(api, queryClient));
const mutationError = addTodo.error ?? toggleTodo.error ?? removeTodo.error;
```

```tsx
<li key={todo.id} className="flex items-center justify-between gap-3">
	{/* existing Label + Checkbox */}
	<Button
		type="button"
		variant="ghost"
		size="sm"
		aria-label={`Remove ${todo.title}`}
		disabled={removeTodo.isPending}
		onClick={() => removeTodo.mutate(todo.id)}
	>
		Remove
	</Button>
</li>
```

The `aria-label` is not decoration: it is how the browser test will find the button.

Now see it work with no Electron involved:

```bash
pnpm dev:web
```

**Expected result:** at http://127.0.0.1:5173 you can add a todo and remove it again. The
list is empty after a reload, because the browser adapter holds state in memory.

## Step 7 — Update the test doubles and add tests

`pnpm check` still fails, because every hand-written `LocalApi` fake is now incomplete.
Add `remove` to the doubles in `apps/web/src/features/todos/TodoList.browser.test.tsx`
(both `createFakeLocalApi` and `pendingLocalApi`) and in
`apps/web/src/features/theme/ThemeSync.browser.test.tsx`:

```ts
			remove: async ({ id }) => ({ id }),
```

Then cover the new behavior. A main-process test in
`apps/desktop/src/main/features/todos/TodoService.test.ts` against real SQLite:

```ts
it("removes a todo and throws when it is missing", () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "todos-db-"));
	directories.push(directory);
	const service = new TodoService(createDatabase(path.join(directory, "app.db"), migrationsFolder));

	const created = service.add("Buy milk");
	expect(service.remove(created.id)).toEqual({ id: created.id });
	expect(service.list()).toEqual([]);
	expect(() => service.remove(created.id)).toThrow(BusinessError);
});
```

And a UI test in `apps/web/src/features/todos/TodoList.browser.test.tsx`, which runs in
real Chromium:

```tsx
it("removes a todo", async () => {
	const { baseElement } = renderTodoList(
		createFakeLocalApi([{ id: "1", title: "Buy milk", completed: false }]),
	);
	const screen = page.elementLocator(baseElement);

	await screen.getByRole("button", { name: "Remove Buy milk" }).click();
	await expect.element(screen.getByText("No todos yet.")).toBeVisible();
});
```

Verify:

```bash
pnpm test:desktop
pnpm test:web
```

**Expected result:** both suites pass, including your two new tests.

## Step 8 — Verify the real desktop path

Everything so far proved the contract, the service, and the UI. It has not yet proved that
a click in Electron reaches SQLite.

```bash
pnpm start
```

**Expected result:** add two todos, remove one, quit the app, and start it again. The
removed todo is gone and the other one is still there — the deletion went through typed
IPC, was validated twice, and was written to `app.db` in the Electron `userData`
directory.

## Step 9 — Run the full gate

The same checks CI runs:

```bash
pnpm check && pnpm lint && pnpm format:check && pnpm test
```

Run `pnpm format` first if `format:check` complains; formatting is not negotiable and
`lint-staged` will run it on commit anyway.

`pnpm test:e2e` packages the app and drives the real binary. It is slower and not part of
`pnpm test`, so run it when you changed anything about IPC transport, the preload, the
protocol handler, or packaging. It is optional for a feature like this one.

## What you built

One feature, added in the only order the architecture allows:

| Layer               | File                                       | What it owns                   |
| ------------------- | ------------------------------------------ | ------------------------------ |
| Contract            | `packages/contracts/src/features/todos.ts` | Channel name, input/output Zod |
| Facade              | `packages/contracts/src/local-api.ts`      | What the renderer may call     |
| Persistence + rules | `apps/desktop/src/main/features/todos/`    | SQLite access, `BusinessError` |
| Transport adapters  | `apps/web/src/platform/*LocalApi.ts`       | Electron bridge, browser fake  |
| Data fetching       | `apps/web/src/features/todos/todos.ts`     | Query keys, invalidation       |
| UI                  | `apps/web/src/features/todos/TodoList.tsx` | Rendering and interaction      |

Two properties made this safe rather than lucky: the contract lives in one place, so both
sides fail to compile together; and the renderer talks to an interface, so the same UI
runs with or without Electron.

## Where to go next

- [README: Web and Electron decoupling](../README.md#web-and-electron-decoupling) —
  the rules this tutorial followed, and why they exist
- [README: Shared code](../README.md#shared-code) — what belongs in `packages/contracts`
- [docs/releases.md](releases.md) — shipping the change once it is merged

Adding a whole new feature domain rather than a method follows the same path with two
extra moves: create `packages/contracts/src/features/<feature>.ts`, export it from
`src/index.ts`, merge its channel map in `src/registry.ts`, and add a matching
`features/<feature>/` folder in both apps.
