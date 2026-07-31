import type { ThemeSource, ThemeState } from "./features/theme.js";
import type { IpcError } from "./result.js";

/**
 * Host-facing facade for the React app — SHELL-LEVEL services only (theme,
 * shell, ...). Features never add methods here; feature-scoped backend calls
 * go through `sdk.invoke`. Input/output shapes match ipcMethods so Electron
 * and browser adapters stay projections of the same contract.
 */
export interface LocalApi {
	theme: {
		get(): Promise<ThemeState>;
		set(input: { source: ThemeSource }): Promise<ThemeState>;
		onChanged(listener: (state: ThemeState) => void): () => void;
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
