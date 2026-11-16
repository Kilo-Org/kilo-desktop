import { execFile } from "node:child_process";

const INSPECTION_TIMEOUT_MS = 1_500;
const MAX_OUTPUT_BYTES = 256 * 1_024;

export async function inspectForegroundProcess(
	terminalPid: number,
	platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
	if (!Number.isInteger(terminalPid) || terminalPid <= 0) return null;
	return platform === "win32"
		? inspectWindowsForegroundProcess(terminalPid)
		: inspectPosixForegroundProcess(terminalPid, platform);
}

export function normalizeProcessLabel(raw: string, platform: NodeJS.Platform): string | null {
	let value = raw.trim();
	if (
		(value.startsWith("[") && value.endsWith("]")) ||
		(value.startsWith("(") && value.endsWith(")"))
	) {
		value = value.slice(1, -1).trim();
	}
	const executable = value.split(/\s+/)[0]?.trim();
	if (!executable) return null;
	const base = executable.split(platform === "win32" ? /[\\/]/ : /\//).at(-1) ?? executable;
	const label =
		platform === "win32" && base.toLowerCase().endsWith(".exe") ? base.slice(0, -4) : base;
	return label || null;
}

async function inspectPosixForegroundProcess(
	terminalPid: number,
	platform: NodeJS.Platform,
): Promise<string | null> {
	const stdout = await run("ps", ["-eo", "pid=,ppid=,comm="]);
	if (stdout === null) return null;
	for (const line of stdout.split(/\r?\n/)) {
		const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
		if (!match || Number(match[2]) !== terminalPid) continue;
		return normalizeProcessLabel(match[3] ?? "", platform);
	}
	return null;
}

async function inspectWindowsForegroundProcess(terminalPid: number): Promise<string | null> {
	const command =
		'Get-CimInstance Win32_Process -ErrorAction Stop | ForEach-Object { Write-Output "$($_.ProcessId)|$($_.ParentProcessId)|$($_.Name)" }';
	const stdout = await run("powershell.exe", [
		"-NoProfile",
		"-NonInteractive",
		"-Command",
		command,
	]);
	if (stdout === null) return null;
	for (const line of stdout.split(/\r?\n/)) {
		const [pidText, parentPidText, name = ""] = line.trim().split("|", 3);
		if (!Number.isInteger(Number(pidText)) || Number(parentPidText) !== terminalPid) continue;
		return normalizeProcessLabel(name, "win32");
	}
	return null;
}

function run(command: string, args: readonly string[]): Promise<string | null> {
	return new Promise((resolve) => {
		execFile(
			command,
			[...args],
			{ timeout: INSPECTION_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, encoding: "utf8" },
			(error, stdout) => resolve(error ? null : stdout),
		);
	});
}
