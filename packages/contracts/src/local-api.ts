import type { ThemeState } from "./features/theme.js";
import type { Todo } from "./features/todos.js";
import type { IpcError } from "./result.js";

/**
 * Host-facing facade for the React app. Input/output shapes match ipcMethods so
 * Electron and browser adapters stay projections of the same contract.
 */
export interface LocalApi {
	todos: {
		list(): Promise<Todo[]>;
		add(input: { title: string }): Promise<Todo>;
		toggle(input: { id: string }): Promise<Todo>;
	};
	theme: {
		/** One-way push of the renderer-owned theme state so the host can paint matching native chrome. */
		sync(input: ThemeState): Promise<void>;
	};
	shell: {
		openExternal(input: { url: string }): Promise<{ opened: boolean }>;
		copyText(input: { text: string }): Promise<void>;
	};
}

/** Thrown by LocalApi adapters; codes match ipcErrorCodes. */
export class LocalApiError extends Error {
	override readonly name = "LocalApiError";

	constructor(
		readonly code: IpcError["code"],
		message: string,
	) {
		super(message);
	}
}
