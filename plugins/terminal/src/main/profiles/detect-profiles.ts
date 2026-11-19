// Ported from VS Code's src/vs/platform/terminal/node/terminalProfiles.ts
// (`detectAvailableProfiles`, `validateProfilePaths`), with the platform and
// every system boundary passed in. Cygwin, MSYS2 and Cmder (VS Code's "unsafe
// path" profiles) are not detected; people can add them as custom profiles.
import path from "node:path";

import type {
	CustomTerminalProfile,
	TerminalProfile,
	TerminalProfileEnv,
	TerminalProfileSource,
} from "../../contracts/profiles";
import { envValue, findExecutable, pathModuleFor } from "./find-executable";
import { enumeratePowerShellInstallations, windowsDirectory } from "./powershell";
import { listWslProfiles } from "./wsl";

/** The file system as detection sees it. */
export interface DetectFs {
	/** True for a file that can be launched (follows symlinks; on POSIX, needs the execute bit). */
	isExecutableFile(path: string): Promise<boolean>;
	isDirectory(path: string): Promise<boolean>;
	readdir(path: string): Promise<string[]>;
	readFile(path: string): Promise<string>;
}

export type DetectExecFile = (
	file: string,
	args: readonly string[],
	options: { readonly timeout: number; readonly env: NodeJS.ProcessEnv },
) => Promise<Buffer>;

export interface DetectDeps {
	readonly platform: NodeJS.Platform;
	readonly env: NodeJS.ProcessEnv;
	readonly fs: DetectFs;
	readonly execFile: DetectExecFile;
	/** `process.arch`. */
	readonly arch: string;
	readonly homedir: string;
	/** Where bare names resolve when PATH is empty. */
	readonly cwd: string;
	/** The Windows build, when known (WSL needs 19041). */
	readonly windowsBuild?: number | undefined;
	/** Absolute paths of the person's login shell ($SHELL, the user database). */
	readonly loginShells: readonly string[];
	readonly customProfiles?: readonly CustomTerminalProfile[];
	/** Adds the shells found on the machine (default true). */
	readonly includeDetected?: boolean;
}

/** A profile before its executable is found: candidate paths, first launchable wins. */
interface UnresolvedProfile {
	readonly id: string;
	readonly label: string;
	readonly paths: readonly string[] | { readonly source: TerminalProfileSource };
	readonly args: readonly string[];
	readonly env?: TerminalProfileEnv;
	readonly source: TerminalProfile["source"];
}

const UNIX_SHELLS_FILE = "/etc/shells";

const SOURCE_DEFAULT_ARGS: Record<TerminalProfileSource, readonly string[]> = {
	pwsh: [],
	"git-bash": ["--login", "-i"],
};

function slug(label: string): string {
	return label
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

const detected = (
	label: string,
	paths: UnresolvedProfile["paths"],
	args: readonly string[] = [],
): UnresolvedProfile => ({ id: `detected:${slug(label)}`, label, paths, args, source: "detected" });

function customProfile(profile: CustomTerminalProfile): UnresolvedProfile {
	return {
		id: profile.id,
		label: profile.label,
		paths: profile.source ? { source: profile.source } : [profile.path!],
		args: profile.args ?? (profile.source ? SOURCE_DEFAULT_ARGS[profile.source] : []),
		...(profile.env ? { env: profile.env } : {}),
		source: "custom",
	};
}

/**
 * The shells this machine can run: those detected (unless `includeDetected`
 * is false) with the custom profiles merged over them by label. Only profiles
 * whose executable was found are returned, each with an absolute path.
 */
export async function detectProfiles(deps: DetectDeps): Promise<TerminalProfile[]> {
	const includeDetected = deps.includeDetected ?? true;
	const isWindows = deps.platform === "win32";
	const system32 = path.win32.join(
		windowsDirectory(deps.env),
		envValue(deps.env, "PROCESSOR_ARCHITEW6432") ? "Sysnative" : "System32",
	);

	const unresolved = new Map<string, UnresolvedProfile>();
	if (includeDetected) {
		const found = isWindows ? windowsProfiles(system32) : await unixProfiles(deps.fs);
		for (const profile of found) unresolved.set(profile.label, profile);
	}
	const customs = deps.customProfiles ?? [];
	for (const profile of customs) unresolved.set(profile.label, customProfile(profile));

	const sourcePaths = memoizedSourcePaths(deps);
	const loginShells = isWindows ? [] : deps.loginShells;
	const resolved = await Promise.all(
		[...unresolved.values()].map((profile) =>
			resolveProfile(profile, deps, sourcePaths, loginShells),
		),
	);
	const profiles = resolved.filter((profile) => profile !== undefined);

	if (includeDetected && isWindows) {
		const customLabels = new Set(customs.map((profile) => profile.label));
		const wsl = await listWslProfiles({
			system32,
			env: deps.env,
			windowsBuild: deps.windowsBuild,
			execFile: deps.execFile,
		});
		for (const distro of wsl) {
			if (customLabels.has(distro.label)) continue;
			const { id, label, source } = detected(distro.label, []);
			profiles.push({ id, label, path: distro.path, args: distro.args, source });
		}
	}
	return profiles.map((profile) => ({ ...profile, available: true }));
}

/**
 * The person's login shells as absolute paths: $SHELL, then the user
 * database's, since $SHELL goes stale (an app opened from the Dock after `chsh`).
 */
export function loginShellsOf(
	env: NodeJS.ProcessEnv,
	userInfo: () => { readonly shell: string | null },
): string[] {
	const shells = [env["SHELL"]];
	try {
		shells.push(userInfo().shell ?? undefined);
	} catch {
		// userInfo throws when the user has no username or home directory.
	}
	return [
		...new Set(shells.filter((shell): shell is string => !!shell && path.posix.isAbsolute(shell))),
	];
}

function windowsProfiles(system32: string): UnresolvedProfile[] {
	return [
		detected("PowerShell", { source: "pwsh" }),
		detected("Windows PowerShell", [
			path.win32.join(system32, "WindowsPowerShell", "v1.0", "powershell.exe"),
		]),
		detected("Git Bash", { source: "git-bash" }, SOURCE_DEFAULT_ARGS["git-bash"]),
		detected("Command Prompt", [path.win32.join(system32, "cmd.exe")]),
	];
}

/** The shells /etc/shells lists, named by their file name (`bash`, `bash (2)`…). */
async function unixProfiles(fs: DetectFs): Promise<UnresolvedProfile[]> {
	let contents: string;
	try {
		contents = await fs.readFile(UNIX_SHELLS_FILE);
	} catch {
		return [];
	}
	const counts = new Map<string, number>();
	return contents
		.split("\n")
		.map((line) => line.split("#")[0]!.trim())
		.filter((shell) => shell.length > 0)
		.map((shell) => {
			const name = path.posix.basename(shell);
			const count = (counts.get(name) ?? 0) + 1;
			counts.set(name, count);
			return detected(count > 1 ? `${name} (${count})` : name, [shell]);
		});
}

type SourcePaths = (source: TerminalProfileSource) => Promise<readonly string[]>;

function memoizedSourcePaths(deps: DetectDeps): SourcePaths {
	const cache = new Map<TerminalProfileSource, Promise<readonly string[]>>();
	return (source) => {
		let paths = cache.get(source);
		if (!paths) {
			paths = (
				source === "pwsh" ? enumeratePowerShellInstallations(deps) : gitBashPaths(deps)
			).catch(() => []);
			cache.set(source, paths);
		}
		return paths;
	};
}

/** Where Git for Windows keeps bash.exe: beside git.exe on PATH, then the usual install folders. */
async function gitBashPaths(deps: DetectDeps): Promise<string[]> {
	const winPath = path.win32;
	const gitDirs = new Set<string>();
	const gitExe = await findExecutable("git.exe", {
		platform: "win32",
		env: deps.env,
		cwd: deps.cwd,
		isExecutableFile: deps.fs.isExecutableFile,
	});
	// git.exe lives in <install>/cmd/; PATH is controlled by the person or an admin, so it is safe.
	if (gitExe) gitDirs.add(winPath.resolve(winPath.dirname(gitExe), "../.."));
	for (const name of ["ProgramW6432", "ProgramFiles", "ProgramFiles(X86)"]) {
		const directory = envValue(deps.env, name);
		if (directory) gitDirs.add(directory);
	}
	const localAppData = envValue(deps.env, "LocalAppData");
	if (localAppData) gitDirs.add(winPath.join(localAppData, "Program"));

	const paths: string[] = [];
	for (const gitDir of gitDirs) {
		paths.push(
			winPath.join(gitDir, "Git", "bin", "bash.exe"),
			winPath.join(gitDir, "Git", "usr", "bin", "bash.exe"),
			// The Git for Windows SDK.
			winPath.join(gitDir, "usr", "bin", "bash.exe"),
		);
	}
	paths.push(
		winPath.join(deps.homedir, "scoop", "apps", "git", "current", "bin", "bash.exe"),
		winPath.join(deps.homedir, "scoop", "apps", "git-with-openssh", "current", "bin", "bash.exe"),
	);
	return paths;
}

async function resolveProfile(
	profile: UnresolvedProfile,
	deps: DetectDeps,
	sourcePaths: SourcePaths,
	loginShells: readonly string[],
): Promise<Omit<TerminalProfile, "available"> | undefined> {
	const paths = pathModuleFor(deps.platform);
	const candidates =
		"source" in profile.paths ? [...(await sourcePaths(profile.paths.source))] : [...profile.paths];
	// The login shell may be missing from PATH (a stale $SHELL, or the shell environment never resolved).
	const bareNames = candidates.filter((candidate) => paths.basename(candidate) === candidate);
	candidates.push(
		...bareNames.flatMap((name) => loginShells.filter((shell) => paths.basename(shell) === name)),
	);
	for (const candidate of candidates) {
		const executable = await findExecutable(candidate, {
			platform: deps.platform,
			env: deps.env,
			cwd: deps.cwd,
			isExecutableFile: deps.fs.isExecutableFile,
		});
		if (executable) {
			return {
				id: profile.id,
				label: profile.label,
				path: executable,
				args: [...profile.args],
				...(profile.env ? { env: profile.env } : {}),
				source: profile.source,
			};
		}
	}
	return undefined;
}
