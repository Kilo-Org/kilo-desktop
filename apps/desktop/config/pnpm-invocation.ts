export interface PnpmInvocation {
	readonly file: string;
	readonly args: string[];
}

export function resolvePnpmInvocation(
	args: readonly string[],
	platform: NodeJS.Platform = process.platform,
	environment: NodeJS.ProcessEnv = process.env,
): PnpmInvocation {
	if (platform === "win32") {
		return {
			file: environment.ComSpec?.trim() || "cmd.exe",
			args: ["/d", "/s", "/c", "pnpm.cmd", ...args],
		};
	}

	return { file: "pnpm", args: [...args] };
}
