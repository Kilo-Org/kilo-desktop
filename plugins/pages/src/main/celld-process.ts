/**
 * One `celld dev` process serving a Pages build folder on a loopback port.
 *
 * The child is spawned detached so celld and the worker process it starts
 * share a process group, and every stop signals the whole group: the worker
 * otherwise outlives `celld dev`. celld drains slowly on SIGTERM, so stop
 * escalates to SIGKILL after `stopTimeoutMs`. Start resolves once the server
 * answers any HTTP request, and rejects if the child exits first, the
 * deadline passes or the caller cancels (the child is stopped in each case).
 * An exit after start that nobody asked for goes to `onUnexpectedExit`, for
 * the kernel service's restart policy. Output is logged line by line.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";

export interface CelldLogger {
	debug(message: string): void;
	warn(message: string): void;
}

export interface CelldProcessOptions {
	readonly executable: string;
	/** Arguments before celld's own (tests run a Node script). */
	readonly executableArgs?: readonly string[];
	readonly serverDir: string;
	readonly port: number;
	readonly logger: CelldLogger;
	readonly onUnexpectedExit?: (error: Error) => void;
	readonly readyTimeoutMs?: number;
	readonly stopTimeoutMs?: number;
	readonly env?: NodeJS.ProcessEnv;
}

const READY_POLL_MS = 200;
const ERROR_LINE = /\b(error|fatal|panic|failed)\b/i;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
	if (child.pid && process.platform !== "win32") {
		try {
			process.kill(-child.pid, signal);
			return;
		} catch {
			// The group is gone; fall through to the child itself.
		}
	}
	child.kill(signal);
}

export class CelldProcess {
	readonly #options: CelldProcessOptions;
	#child: ChildProcess | undefined;
	#exited: Promise<void> = Promise.resolve();
	#stopping = false;
	#started = false;

	constructor(options: CelldProcessOptions) {
		this.#options = options;
	}

	get running(): boolean {
		return this.#started && this.#child !== undefined;
	}

	async start(signal?: AbortSignal): Promise<void> {
		const { executable, executableArgs = [], serverDir, port } = this.#options;
		const args = [
			...executableArgs,
			"dev",
			serverDir,
			"--host",
			"127.0.0.1",
			"--port",
			String(port),
			"--no-watch",
		];
		const child = spawn(executable, args, {
			cwd: serverDir,
			detached: process.platform !== "win32",
			env: this.#options.env ?? process.env,
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		this.#child = child;
		this.#stopping = false;
		this.#started = false;
		this.#logOutput(child.stdout);
		this.#logOutput(child.stderr);
		let exitCode: number | null | undefined;
		this.#exited = new Promise((resolve) => {
			child.once("exit", (code) => {
				exitCode = code;
				if (this.#child === child) this.#child = undefined;
				if (this.#started && !this.#stopping) {
					this.#options.onUnexpectedExit?.(
						new Error(`The Pages server exited unexpectedly (code ${String(code)}).`),
					);
				}
				resolve();
			});
			child.once("error", (error) => {
				this.#options.logger.warn(`celld: ${error.message}`);
				if (this.#child === child) this.#child = undefined;
				resolve();
			});
		});

		const deadline = Date.now() + (this.#options.readyTimeoutMs ?? 60_000);
		try {
			for (;;) {
				if (signal?.aborted) throw new Error("Starting the Pages server was cancelled.");
				if (this.#child !== child) {
					throw new Error(`The Pages server exited before it answered (code ${String(exitCode)}).`);
				}
				if (await this.#answers(port)) break;
				if (Date.now() > deadline) throw new Error("The Pages server did not answer in time.");
				await delay(READY_POLL_MS);
			}
		} catch (error) {
			await this.stop();
			throw error;
		}
		this.#started = true;
	}

	async stop(): Promise<void> {
		const child = this.#child;
		if (!child) return;
		this.#stopping = true;
		signalGroup(child, "SIGTERM");
		const timer = setTimeout(
			() => signalGroup(child, "SIGKILL"),
			this.#options.stopTimeoutMs ?? 5_000,
		);
		await this.#exited;
		clearTimeout(timer);
		// The worker can outlast `celld dev` itself; make sure the group is gone.
		signalGroup(child, "SIGKILL");
		this.#started = false;
	}

	async #answers(port: number): Promise<boolean> {
		try {
			const response = await fetch(`http://127.0.0.1:${port}/`, {
				signal: AbortSignal.timeout(2_000),
			});
			await response.body?.cancel();
			return true;
		} catch {
			return false;
		}
	}

	#logOutput(stream: Readable | null): void {
		if (!stream) return;
		createInterface({ input: stream }).on("line", (line) => {
			const text = line.trim();
			if (!text) return;
			if (ERROR_LINE.test(text)) this.#options.logger.warn(`celld: ${text}`);
			else this.#options.logger.debug(`celld: ${text}`);
		});
	}
}
