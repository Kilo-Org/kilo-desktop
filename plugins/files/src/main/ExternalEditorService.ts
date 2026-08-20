import spawn from "cross-spawn";
import { shellEnv } from "shell-env";
import which from "which";

import { FeatureError } from "@anaconda-agentic-desktop/feature-sdk";

import { EXTERNAL_EDITORS, type ExternalEditorId } from "../contracts/schemas.js";

export interface ExternalEditorServiceOptions {
	readonly resolveCommand?: (
		commands: readonly string[],
		searchPath: string | undefined,
	) => Promise<string | null>;
	readonly resolveShellPath?: () => Promise<string | undefined>;
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

async function resolveShellPath(): Promise<string | undefined> {
	try {
		return (await shellEnv()).PATH ?? process.env["PATH"];
	} catch {
		return process.env["PATH"];
	}
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
 * Owns discovery and detached launching for supported external editors. The
 * login-shell PATH is resolved lazily and cached because GUI-launched desktop
 * builds do not reliably inherit it, while repeated shell startup would make
 * every editor lookup unnecessarily expensive.
 */
export class ExternalEditorService {
	private readonly resolveCommand: (
		commands: readonly string[],
		searchPath: string | undefined,
	) => Promise<string | null>;
	private readonly resolveShellPath: () => Promise<string | undefined>;
	private readonly launchDetached: (command: string, args: readonly string[]) => Promise<void>;
	private shellPathPromise: Promise<string | undefined> | null = null;

	constructor(options: ExternalEditorServiceOptions = {}) {
		this.resolveCommand = options.resolveCommand ?? resolveFirstCommand;
		this.resolveShellPath =
			options.resolveShellPath ??
			(options.resolveCommand ? async () => process.env["PATH"] : resolveShellPath);
		this.launchDetached = options.launchDetached ?? launchDetached;
	}

	async listAvailable(): Promise<ExternalEditorId[]> {
		const searchPath = await this.searchPath();
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
		const command = await this.resolveCommand(definition.commands, await this.searchPath());
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

	private searchPath(): Promise<string | undefined> {
		this.shellPathPromise ??= this.resolveShellPath();
		return this.shellPathPromise;
	}
}
