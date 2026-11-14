import { execFile } from "node:child_process";
import { createServer } from "node:net";

/** A port nothing on loopback is listening on right now. */
export function allocateLoopbackPort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.unref();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const port = address && typeof address === "object" ? address.port : 0;
			server.close(() => (port ? resolve(port) : reject(new Error("No loopback port."))));
		});
	});
}

/** Whether `port` can be listened on at 127.0.0.1. */
export function isLoopbackPortFree(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const server = createServer();
		server.unref();
		server.once("error", () => resolve(false));
		server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
	});
}

function run(file: string, args: readonly string[]): Promise<string> {
	return new Promise((resolve) => {
		execFile(file, [...args], { windowsHide: true, timeout: 5_000 }, (error, stdout) =>
			resolve(error ? "" : stdout),
		);
	});
}

/**
 * Stops a celld left listening on `port` by a run that didn't shut down
 * (a crash, a force quit): only a process named celld is touched. Unix only.
 */
export async function reclaimStaleCelld(port: number): Promise<void> {
	if (process.platform === "win32") return;
	const pids = (await run("lsof", ["-t", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]))
		.split("\n")
		.map((line) => Number.parseInt(line.trim(), 10))
		.filter((pid) => Number.isInteger(pid) && pid > 0);
	for (const pid of pids) {
		const name = (await run("ps", ["-p", String(pid), "-o", "comm="])).trim();
		if (!name.endsWith("celld")) continue;
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			// Already gone.
		}
	}
}

export interface PortChoice {
	readonly saved: number | null;
	readonly isFree: (port: number) => Promise<boolean>;
	readonly allocate: () => Promise<number>;
	readonly reclaim: (port: number) => Promise<void>;
}

/**
 * The port to serve Pages on: the saved one whenever it can be had (page
 * links and the agent's MCP URL carry it), after clearing a stale celld off
 * it; a new one only when it can't.
 */
export async function choosePort(choice: PortChoice): Promise<number> {
	const { saved } = choice;
	if (saved !== null) {
		if (await choice.isFree(saved)) return saved;
		await choice.reclaim(saved);
		if (await choice.isFree(saved)) return saved;
	}
	return choice.allocate();
}
