import {
	LocalApiError,
	todoMethods,
	type AuthSession,
	type LocalApi,
	type ThemeSource,
	type ThemeState,
	type Todo,
} from "@anaconda-agentic-desktop/contracts";

function createId(): string {
	return globalThis.crypto?.randomUUID?.() ?? `todo-${Date.now()}-${Math.random()}`;
}

function resolveShouldUseDarkColors(source: ThemeSource): boolean {
	if (source === "dark") return true;
	if (source === "light") return false;
	return globalThis.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function createBrowserLocalApi(options?: { readonly todos?: readonly Todo[] }): LocalApi {
	const todos: Todo[] = [...(options?.todos ?? [])];
	let themeSource: ThemeSource = "system";
	const themeListeners = new Set<(state: ThemeState) => void>();
	let mediaQuery: MediaQueryList | undefined;
	let mediaListener: ((event: MediaQueryListEvent) => void) | undefined;

	const currentTheme = (): ThemeState => ({
		source: themeSource,
		shouldUseDarkColors: resolveShouldUseDarkColors(themeSource),
	});

	const emitTheme = (): void => {
		const state = currentTheme();
		for (const listener of themeListeners) listener(state);
	};

	const syncMediaListener = (): void => {
		if (themeSource !== "system" || themeListeners.size === 0) {
			if (mediaQuery && mediaListener) {
				mediaQuery.removeEventListener("change", mediaListener);
			}
			mediaQuery = undefined;
			mediaListener = undefined;
			return;
		}

		if (mediaQuery && mediaListener) return;

		mediaQuery = globalThis.matchMedia("(prefers-color-scheme: dark)");
		mediaListener = (event) => {
			const state: ThemeState = {
				source: "system",
				shouldUseDarkColors: event.matches,
			};
			for (const listener of themeListeners) listener(state);
		};
		mediaQuery.addEventListener("change", mediaListener);
	};

	return {
		todos: {
			async list() {
				return [...todos];
			},
			async add(input) {
				const parsed = todoMethods["todos:add"].input.safeParse(input);
				if (!parsed.success) {
					throw new LocalApiError("VALIDATION", "The request payload is invalid.");
				}
				const todo: Todo = {
					id: createId(),
					title: parsed.data.title,
					completed: false,
				};
				todos.push(todo);
				return todo;
			},
			async toggle(input) {
				const index = todos.findIndex((todo) => todo.id === input.id);
				const current = todos[index];
				if (!current) {
					throw new LocalApiError("BUSINESS", "Todo not found.");
				}
				const todo = { ...current, completed: !current.completed };
				todos[index] = todo;
				return todo;
			},
		},
		theme: {
			async get() {
				return currentTheme();
			},
			async set(input) {
				themeSource = input.source;
				syncMediaListener();
				const state = currentTheme();
				emitTheme();
				return state;
			},
			onChanged(listener) {
				themeListeners.add(listener);
				syncMediaListener();
				return () => {
					themeListeners.delete(listener);
					syncMediaListener();
				};
			},
		},
		shell: {
			async openExternal(input) {
				const opened = globalThis.open(input.url, "_blank", "noopener,noreferrer");
				if (!opened) {
					throw new LocalApiError("TRANSPORT", "Could not open the external URL.");
				}
				return { opened: true };
			},
			async copyText(input) {
				try {
					await navigator.clipboard.writeText(input.text);
				} catch {
					throw new LocalApiError("TRANSPORT", "Could not copy text to the clipboard.");
				}
			},
		},
		auth: {
			async getSession(): Promise<AuthSession> {
				// No keyring in the browser — always anonymous.
				return { status: "anonymous" };
			},
			async refresh(): Promise<AuthSession> {
				return { status: "anonymous" };
			},
			async login(): Promise<AuthSession> {
				// No keyring/OAuth in browser mode — stay anonymous.
				return { status: "anonymous" };
			},
			async logout(): Promise<AuthSession> {
				return { status: "anonymous" };
			},
			onChanged() {
				// Session never changes in browser mode.
				return () => {};
			},
		},
	};
}
