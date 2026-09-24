import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";

import type { TestInfo } from "@playwright/test";
import type { ElectronApplication } from "playwright";

import { profileKiloLogDirectory } from "./app-launcher.js";

const MAX_BUFFERED_LINES = 20_000;
const TRIM_BATCH_LINES = 2_000;
const STARTUP_FAILURE_TAIL_LINES = 150;
const KILO_LOG_TAIL_CHARS = 200_000;

/**
 * Buffers the packaged app's main-process stdout/stderr for one worker.
 *
 * `electron-log`'s console transport is active in packaged builds, so this is
 * where main-process and sidecar lifecycle messages (including Kilo CLI
 * startup stderr) appear. Renderer console output alone could not explain
 * why a sidecar failed to start.
 */
export class MainProcessLog {
	readonly #lines: string[] = [];
	#dropped = 0;

	constructor(app: ElectronApplication) {
		const child = app.process();
		this.#listen(child.stdout, "out");
		this.#listen(child.stderr, "err");
	}

	/** Position to pass to `since()` for the lines written after this call. */
	mark(): number {
		return this.#dropped + this.#lines.length;
	}

	since(mark: number): string {
		return this.#lines.slice(Math.max(0, mark - this.#dropped)).join("\n");
	}

	tail(lineCount: number): string {
		return this.#lines.slice(-lineCount).join("\n");
	}

	// Playwright reads these streams too, so decode chunks here instead of
	// calling setEncoding() and changing what its own listeners receive.
	#listen(stream: Readable | null, label: "out" | "err"): void {
		if (!stream) return;
		const decoder = new StringDecoder("utf8");
		let partial = "";
		stream.on("data", (chunk: Buffer | string) => {
			const text = partial + (typeof chunk === "string" ? chunk : decoder.write(chunk));
			const lines = text.split(/\r?\n/);
			partial = lines.pop() ?? "";
			for (const line of lines) this.#push(`[${label}] ${line}`);
		});
		// A crashing process often dies mid-line; keep that last line.
		stream.once("end", () => {
			const rest = partial + decoder.end();
			partial = "";
			if (rest) this.#push(`[${label}] ${rest}`);
		});
	}

	#push(line: string): void {
		this.#lines.push(line);
		if (this.#lines.length > MAX_BUFFERED_LINES + TRIM_BATCH_LINES) {
			this.#lines.splice(0, TRIM_BATCH_LINES);
			this.#dropped += TRIM_BATCH_LINES;
		}
	}
}

/**
 * Contents of the most recently written Kilo CLI log file for a profile,
 * trimmed to its tail.
 *
 * Never throws: callers run it on failure paths before stopping the app and
 * removing its profile, and the CLI may rotate logs while this reads them.
 */
export async function readLatestKiloCliLog(userDataDir: string): Promise<string | undefined> {
	try {
		const directory = profileKiloLogDirectory(userDataDir);
		const names = (await readdir(directory)).filter((name) => name.endsWith(".log"));
		const files = await Promise.all(
			names.map(async (name) => {
				const file = path.join(directory, name);
				return { file, modified: (await stat(file)).mtimeMs };
			}),
		);
		const latest = files.sort((left, right) => right.modified - left.modified)[0];
		if (!latest) return undefined;
		const text = await readFile(latest.file, "utf8");
		return text.length > KILO_LOG_TAIL_CHARS ? text.slice(-KILO_LOG_TAIL_CHARS) : text;
	} catch {
		return undefined;
	}
}

/**
 * Worker-fixture failures (app launch, sidecar readiness) happen before any
 * test-scoped fixture can attach files, so the evidence rides on the error
 * message itself and lands in the CI log and the report.
 */
export async function withStartupDiagnostics(
	error: unknown,
	log: MainProcessLog,
	userDataDir: string,
): Promise<Error> {
	const original = error instanceof Error ? error : new Error(String(error));
	const kiloLog = await readLatestKiloCliLog(userDataDir);
	const sections = [
		original.message,
		`--- main process (last ${STARTUP_FAILURE_TAIL_LINES} lines) ---`,
		log.tail(STARTUP_FAILURE_TAIL_LINES) || "(no output)",
	];
	if (kiloLog) {
		const lines = kiloLog.split("\n");
		sections.push(
			`--- kilo cli log (last ${STARTUP_FAILURE_TAIL_LINES} lines) ---`,
			lines.slice(-STARTUP_FAILURE_TAIL_LINES).join("\n"),
		);
	}
	const enriched = new Error(sections.join("\n"), { cause: original });
	if (original.stack)
		enriched.stack = `${enriched.message}\n${original.stack.split("\n").slice(1).join("\n")}`;
	return enriched;
}

/** Attach the main-process output written during a failed test plus the Kilo CLI log. */
export async function attachProcessLogs(
	testInfo: Pick<TestInfo, "attach">,
	log: MainProcessLog,
	mark: number,
	userDataDir: string,
): Promise<void> {
	const mainOutput =
		log.since(mark) ||
		`(no main-process output during this test; last ${STARTUP_FAILURE_TAIL_LINES} lines before it)\n${log.tail(STARTUP_FAILURE_TAIL_LINES)}`;
	await testInfo.attach("main-process.log", { body: mainOutput, contentType: "text/plain" });
	const kiloLog = await readLatestKiloCliLog(userDataDir);
	if (kiloLog) {
		await testInfo.attach("kilo-cli.log", { body: kiloLog, contentType: "text/plain" });
	}
}
