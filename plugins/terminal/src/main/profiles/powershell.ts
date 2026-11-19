// Ported from VS Code's src/vs/base/node/powershell.ts, with the process
// architecture, environment and file system passed in instead of read at load.
import path from "node:path";

import type { DetectFs } from "./detect-profiles";
import { envValue } from "./find-executable";

type Arch = "x64" | "x86" | "arm";

export interface PowerShellSearch {
	readonly env: NodeJS.ProcessEnv;
	/** `process.arch`. */
	readonly arch: string;
	readonly homedir: string;
	readonly fs: Pick<DetectFs, "isDirectory" | "isExecutableFile" | "readdir">;
}

const winPath = path.win32;
const INTEGER = /^\d+$/;
const PWSH_MSIX = /^Microsoft.PowerShell_.*/;
const PWSH_PREVIEW_MSIX = /^Microsoft.PowerShellPreview_.*/;

function processArchOf(arch: string): Arch {
	if (arch === "ia32") return "x86";
	if (arch === "arm" || arch === "arm64") return "arm";
	return "x64";
}

function osArchOf(env: NodeJS.ProcessEnv): Arch {
	const wow64 = envValue(env, "PROCESSOR_ARCHITEW6432");
	if (wow64) return wow64 === "ARM64" ? "arm" : "x64";
	const arch = envValue(env, "PROCESSOR_ARCHITECTURE");
	if (arch === "ARM64") return "arm";
	if (arch === "X86") return "x86";
	return "x64";
}

function programFilesPath(search: PowerShellSearch, alternateBitness: boolean): string | null {
	if (!alternateBitness) return envValue(search.env, "ProgramFiles") || null;
	// A 64-bit process looks for 32-bit installs, a 32-bit one for 64-bit installs.
	if (processArchOf(search.arch) === "x64")
		return envValue(search.env, "ProgramFiles(x86)") || null;
	if (osArchOf(search.env) === "x64") return envValue(search.env, "ProgramW6432") || null;
	return null;
}

/** The pwsh.exe of the highest-numbered `PowerShell\<n>` (or `<n>-preview`) install. */
async function findProgramFilesInstall(
	search: PowerShellSearch,
	{ alternateBitness = false, preview = false } = {},
): Promise<string | null> {
	const programFiles = programFilesPath(search, alternateBitness);
	if (!programFiles) return null;
	const baseDir = winPath.join(programFiles, "PowerShell");
	if (!(await search.fs.isDirectory(baseDir))) return null;

	let highestVersion = -1;
	let found: string | null = null;
	for (const item of await search.fs.readdir(baseDir)) {
		const versionText = preview
			? item.endsWith("-preview")
				? item.slice(0, -"-preview".length)
				: null
			: item;
		if (versionText === null || !INTEGER.test(versionText)) continue;
		const version = Number(versionText);
		if (version <= highestVersion) continue;
		const exePath = winPath.join(baseDir, item, "pwsh.exe");
		if (!(await search.fs.isExecutableFile(exePath))) continue;
		found = exePath;
		highestVersion = version;
	}
	return found;
}

async function findMsixInstall(search: PowerShellSearch, preview: boolean): Promise<string | null> {
	const localAppData = envValue(search.env, "LOCALAPPDATA");
	if (!localAppData) return null;
	const appsDir = winPath.join(localAppData, "Microsoft", "WindowsApps");
	if (!(await search.fs.isDirectory(appsDir))) return null;
	const pattern = preview ? PWSH_PREVIEW_MSIX : PWSH_MSIX;
	const subdir = (await search.fs.readdir(appsDir)).find((entry) => pattern.test(entry));
	return subdir ? winPath.join(appsDir, subdir, "pwsh.exe") : null;
}

export function windowsDirectory(env: NodeJS.ProcessEnv): string {
	return envValue(env, "windir") ?? envValue(env, "SystemRoot") ?? "C:\\Windows";
}

function windowsPowerShellPath(search: PowerShellSearch): string {
	const windir = windowsDirectory(search.env);
	const sysnative = processArchOf(search.arch) === "x86" && osArchOf(search.env) !== "x86";
	return winPath.join(
		windir,
		sysnative ? "Sysnative" : "System32",
		"WindowsPowerShell",
		"v1.0",
		"powershell.exe",
	);
}

/** One candidate's lookup, failing soft: an unreadable folder yields nothing. */
async function attempt(find: () => Promise<string | null>): Promise<string | null> {
	try {
		return await find();
	} catch {
		return null;
	}
}

/**
 * Every PowerShell installed, best first: stable, the other bitness, the
 * Store, the .NET global tool, previews, Scoop, and Windows PowerShell last.
 */
export async function enumeratePowerShellInstallations(
	search: PowerShellSearch,
): Promise<string[]> {
	const candidates = [
		await attempt(() => findProgramFilesInstall(search)),
		await attempt(() => findProgramFilesInstall(search, { alternateBitness: true })),
		await attempt(() => findMsixInstall(search, false)),
		winPath.join(search.homedir, ".dotnet", "tools", "pwsh.exe"),
		await attempt(() => findProgramFilesInstall(search, { preview: true })),
		await attempt(() => findMsixInstall(search, true)),
		await attempt(() => findProgramFilesInstall(search, { alternateBitness: true, preview: true })),
		winPath.join(search.homedir, "scoop", "apps", "pwsh", "current", "pwsh.exe"),
		windowsPowerShellPath(search),
	];
	const found: string[] = [];
	for (const candidate of candidates) {
		if (candidate && !found.includes(candidate) && (await search.fs.isExecutableFile(candidate))) {
			found.push(candidate);
		}
	}
	return found;
}
