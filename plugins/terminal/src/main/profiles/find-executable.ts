import path from "node:path";

export interface FindExecutableOptions {
	readonly platform: NodeJS.Platform;
	readonly env: NodeJS.ProcessEnv;
	/** Where relative paths and PATH-less lookups resolve. */
	readonly cwd: string;
	readonly isExecutableFile: (path: string) => Promise<boolean>;
}

export function pathModuleFor(platform: NodeJS.Platform): typeof path.posix {
	return platform === "win32" ? path.win32 : path.posix;
}

/** An environment variable by name, ignoring case (Windows spells PATH `Path`). */
export function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
	const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name.toUpperCase());
	return key === undefined ? undefined : env[key];
}

/**
 * The absolute path `command` launches, or undefined. A bare name is looked up
 * on the given environment's PATH (every entry, including the last), with
 * PATHEXT applied on Windows; so main never leaves PATH lookup to node-pty.
 * Ported from VS Code's `findExecutable` (src/vs/base/node/processes.ts).
 */
export async function findExecutable(
	command: string,
	options: FindExecutableOptions,
): Promise<string | undefined> {
	const paths = pathModuleFor(options.platform);
	const exists = options.isExecutableFile;
	if (paths.isAbsolute(command)) return (await exists(command)) ? command : undefined;
	if (paths.dirname(command) !== ".") {
		const full = paths.join(options.cwd, command);
		return (await exists(full)) ? full : undefined;
	}
	const pathEntries = (envValue(options.env, "PATH") ?? "")
		.split(paths.delimiter)
		.filter((entry) => entry.length > 0);
	if (pathEntries.length === 0) {
		const full = paths.join(options.cwd, command);
		return (await exists(full)) ? full : undefined;
	}
	// Windows paths are case-insensitive; lower case reads as the file is usually named (pwsh.exe).
	const extensions =
		options.platform === "win32"
			? (envValue(options.env, "PATHEXT") || ".COM;.EXE;.BAT;.CMD")
					.split(";")
					.filter(Boolean)
					.map((extension) => extension.toLowerCase())
			: [];
	for (const entry of pathEntries) {
		const full = paths.isAbsolute(entry)
			? paths.join(entry, command)
			: paths.join(options.cwd, entry, command);
		for (const extension of extensions) {
			if (await exists(full + extension)) return full + extension;
		}
		if (await exists(full)) return full;
	}
	return undefined;
}
