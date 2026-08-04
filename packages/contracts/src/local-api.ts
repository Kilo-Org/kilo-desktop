import type { AuthSession } from "./features/auth.js";
import type { ThemeState } from "./features/theme.js";
import type { IpcError } from "./result.js";

/**
 * Host-facing facade for the React app — SHELL-LEVEL services only (theme,
 * shell, ...). Features never add methods here; feature-scoped backend calls
 * go through `sdk.invoke`. Input/output shapes match ipcMethods so Electron
 * and browser adapters stay projections of the same contract.
 */
export interface LocalApi {
	theme: {
		/** One-way push of the renderer-owned theme state so the host can paint matching native chrome. */
		sync(input: ThemeState): Promise<void>;
	};
	shell: {
		openExternal(input: { url: string }): Promise<{ opened: boolean }>;
		copyText(input: { text: string }): Promise<void>;
		showOpenDialog(input: {
			kind: "directory";
			multiple?: boolean;
		}): Promise<{ canceled: boolean; paths: string[] }>;
		getPathForFile(file: File): string | null;
	};
	auth: {
		getSession(): Promise<AuthSession>;
		refresh(): Promise<AuthSession>;
		login(): Promise<AuthSession>;
		logout(): Promise<AuthSession>;
		onChanged(listener: (session: AuthSession) => void): () => void;
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
