import type { AuthSession } from "./features/auth.js";
import type { NotificationDeliveryResult } from "./features/notifications.js";
import type { TelemetryTrackInput } from "./features/telemetry.js";
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
		readonly canPickDirectories: boolean;
		openExternal(input: { url: string }): Promise<{ opened: boolean }>;
		copyText(input: { text: string }): Promise<void>;
		showOpenDialog(input: {
			kind: "directory";
			multiple?: boolean;
		}): Promise<{ canceled: boolean; paths: string[] }>;
		getPathForFile(file: File): string | null;
	};
	notifications: {
		show(input: {
			title: string;
			message: string;
			type: "info" | "success" | "warning" | "error";
		}): Promise<NotificationDeliveryResult>;
		setBadge(input: { count: number }): Promise<NotificationDeliveryResult>;
	};
	/**
	 * Scoped filesystem backing `sdk.fs`. `featureId` selects the calling
	 * feature's sandbox dir (`${userData}/plugins/<featureId>/`); `path` is
	 * relative to it. See `features/fs.ts` for the full scoping model.
	 */
	fs: {
		readFile(input: { featureId: string; path: string }): Promise<{ content: string }>;
		writeFile(input: { featureId: string; path: string; content: string }): Promise<void>;
		exists(input: { featureId: string; path: string }): Promise<{ exists: boolean }>;
		mkdir(input: { featureId: string; path: string }): Promise<void>;
		readdir(input: { featureId: string; path: string }): Promise<{ entries: string[] }>;
		remove(input: { featureId: string; path: string }): Promise<void>;
	};
	auth: {
		getSession(): Promise<AuthSession>;
		refresh(): Promise<AuthSession>;
		login(): Promise<AuthSession>;
		logout(): Promise<AuthSession>;
		onChanged(listener: (session: AuthSession) => void): () => void;
	};
	featureFlags: {
		getAllFlags(): Promise<Record<string, unknown>>;
		onChanged(listener: (flags: Record<string, unknown>) => void): () => void;
	};
	telemetry: {
		/** Fire-and-forget product event; gated on `allowDataCollection` in the main process. */
		track(input: TelemetryTrackInput): Promise<void>;
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
