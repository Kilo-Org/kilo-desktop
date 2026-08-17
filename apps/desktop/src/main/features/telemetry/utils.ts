import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { hostname } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const HOSTNAME_SALT = "hostname/v1";
const MACHINE_SALT = "machine_id/v1";
const MACHINE_ID_TIMEOUT_MS = 3000;

/** Rolling ~65-day install cohort bucket: `floor(now_seconds / (86400 * 65))`. */
export function calculatePeriodId(timestamp: number = Date.now(), periodOffset = 0): number {
	const secondsPerDay = 60 * 60 * 24;
	const daysInPeriod = 65;
	return Math.floor(timestamp / 1000 / (secondsPerDay * daysInPeriod)) + periodOffset;
}

/** Raw hostname; the fallback machine id. */
export function hostnameId(): string {
	return hostname();
}

/** Salted-sha256 hash of the raw machine id so the raw value never leaves the device. */
export function hashMachineId(raw: string): string {
	return createHash("sha256")
		.update(`${MACHINE_SALT}\n`)
		.update(process.platform)
		.update("\n")
		.update(raw)
		.digest("hex");
}

/** Salted-sha256 hash of the hostname. */
export function hashHostname(): string {
	return createHash("sha256")
		.update(`${HOSTNAME_SALT}\n`)
		.update(`${process.platform}\n`)
		.update(hostname())
		.digest("hex");
}

interface MachineIdProbe {
	command: string;
	args: readonly string[];
	parse: (stdout: string) => string | undefined;
}

const MACHINE_ID_PROBES: Partial<Record<NodeJS.Platform, MachineIdProbe>> = {
	linux: {
		command: "cat",
		args: ["/etc/machine-id"],
		parse: (stdout) => stdout.trim() || undefined,
	},
	darwin: {
		command: "ioreg",
		args: ["-rd1", "-c", "IOPlatformExpertDevice"],
		parse: (stdout) => stdout.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)?.[1],
	},
	win32: {
		command: "reg",
		args: ["query", "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"],
		parse: (stdout) => stdout.match(/MachineGuid\s+REG_SZ\s+([A-Fa-f0-9-]+)/)?.[1],
	},
};

export type ExecFileRunner = (
	command: string,
	args: readonly string[],
	options: { timeout: number; windowsHide: boolean },
) => Promise<{ stdout: string }>;

/**
 * Reads a stable per-machine id from the platform-native source, hostname as a
 * fallback. Async with a timeout — never `execSync`.
 */
export async function readMachineIdFromOs(
	exec: ExecFileRunner = execFileAsync,
	currentPlatform: NodeJS.Platform = process.platform,
): Promise<string> {
	const probe = MACHINE_ID_PROBES[currentPlatform];
	if (probe) {
		try {
			const { stdout } = await exec(probe.command, probe.args, {
				timeout: MACHINE_ID_TIMEOUT_MS,
				windowsHide: true,
			});
			const id = probe.parse(stdout);
			if (id) return id;
		} catch {
			/* fall through to hostname */
		}
	}
	return hostname();
}
