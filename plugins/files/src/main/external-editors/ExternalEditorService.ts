import spawn from "cross-spawn";
import which from "which";

import { FeatureError } from "@anaconda-agentic-desktop/feature-sdk";

import { EXTERNAL_EDITORS, type ExternalEditorId } from "../../contracts/schemas.js";

export interface ExternalEditorServiceOptions {
	readonly resolveCommand?: (
		commands: readonly string[],
		searchPath: string | undefined,
	) => Promise<string | null>;
	readonly launchDetached?: (command: string, args: readonly string[]) => Promise<void>;
}

async function resolveFirstCommand(
	commands: readonly string[],
	searchPath: string | undefined,
): Promise<string | null> {
	for (const command of commands) {
		const resolved = await which(command, { nothrow: true, path: searchPath });
		if (resolved) return resolved;
	}
	return null;
}

function launchDetached(command: string, args: readonly string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, [...args], {
			detached: true,
			stdio: "ignore",
			windowsHide: true,
		});
		child.once("error", reject);
		child.once("spawn", () => {
			child.removeListener("error", reject);
			child.unref();
			resolve();
		});
	});
}

/**
 * Owns discovery and detached launching for supported external editors. PATH
 * is read from `process.env`, which the app bootstrap syncs from the login
 * shell in packaged builds (dev inherits the terminal env via `pnpm dev`).
 */
export class ExternalEditorService {
	private readonly resolveCommand: (
		commands: readonly string[],
		searchPath: string | undefined,
	) => Promise<string | null>;
	private readonly launchDetached: (command: string, args: readonly string[]) => Promise<void>;

	constructor(options: ExternalEditorServiceOptions = {}) {
		this.resolveCommand = options.resolveCommand ?? resolveFirstCommand;
		this.launchDetached = options.launchDetached ?? launchDetached;
	}

	async listAvailable(): Promise<ExternalEditorId[]> {
		const searchPath = process.env["PATH"];
		const availability = await Promise.all(
			EXTERNAL_EDITORS.map(async ({ id, commands }) => ({
				id,
				available: (await this.resolveCommand(commands, searchPath)) !== null,
			})),
		);
		return availability.filter(({ available }) => available).map(({ id }) => id);
	}

	async open(editor: ExternalEditorId, targetPath: string): Promise<void> {
		const definition = EXTERNAL_EDITORS.find(({ id }) => id === editor);
		if (!definition) {
			throw new FeatureError("Unknown external editor.", "VALIDATION");
		}
		const command = await this.resolveCommand(definition.commands, process.env["PATH"]);
		if (!command) {
			throw new FeatureError(`${definition.label} is not available.`, "BUSINESS");
		}
		const baseArgs = "baseArgs" in definition ? definition.baseArgs : [];
		try {
			await this.launchDetached(command, [...baseArgs, targetPath]);
		} catch {
			throw new FeatureError(`Could not open the file in ${definition.label}.`, "BUSINESS");
		}
	}
}
