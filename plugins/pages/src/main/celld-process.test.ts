import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { CelldProcess, type CelldProcessOptions } from "./celld-process";
import { allocateLoopbackPort } from "./ports";

const FAKE_CELLD = fileURLToPath(new URL("../test/fake-celld.mjs", import.meta.url));

const processes: CelldProcess[] = [];
const folders: string[] = [];

afterEach(async () => {
	await Promise.all(processes.splice(0).map((child) => child.stop()));
	await Promise.all(folders.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
	delete process.env["FAKE_CELLD_MODE"];
});

function recorder() {
	const lines: string[] = [];
	return {
		lines,
		logger: {
			debug: (message: string) => void lines.push(`debug ${message}`),
			warn: (message: string) => void lines.push(`warn ${message}`),
		},
	};
}

async function create(mode: string, options: Partial<CelldProcessOptions> = {}) {
	process.env["FAKE_CELLD_MODE"] = mode;
	const serverDir = await mkdtemp(path.join(os.tmpdir(), "pages-celld-"));
	folders.push(serverDir);
	const port = await allocateLoopbackPort();
	const log = recorder();
	const child = new CelldProcess({
		executable: process.execPath,
		executableArgs: [FAKE_CELLD],
		serverDir,
		port,
		logger: log.logger,
		readyTimeoutMs: 5_000,
		stopTimeoutMs: 500,
		...options,
	});
	processes.push(child);
	return { child, port, serverDir, log };
}

describe("CelldProcess", () => {
	it("runs `celld dev` on the folder at the loopback port and resolves once it answers", async () => {
		const { child, port, serverDir } = await create("slow");

		await child.start();

		const answer = (await (await fetch(`http://127.0.0.1:${port}/`)).json()) as {
			args: string[];
		};
		expect(answer.args).toEqual([
			"dev",
			serverDir,
			"--host",
			"127.0.0.1",
			"--port",
			String(port),
			"--no-watch",
		]);
		expect(child.running).toBe(true);
	});

	it("logs the server's output, warning on errors", async () => {
		const { child, log } = await create("crash");

		await expect(child.start()).rejects.toThrow(/exited before it answered/);

		await expect.poll(() => log.lines).toContain("warn celld: error: not a regular file: index.js");
		expect(log.lines.some((line) => line.startsWith("debug celld: celld dev"))).toBe(true);
	});

	it("tells its owner when it exits after starting", async () => {
		const exits: Error[] = [];
		const { child } = await create("exit-later", {
			onUnexpectedExit: (error) => exits.push(error),
		});

		await child.start();

		await expect.poll(() => exits.length).toBe(1);
		expect(child.running).toBe(false);
	});

	it("stops the server, and doesn't report that as a crash", async () => {
		const exits: Error[] = [];
		const { child, port } = await create("serve", {
			onUnexpectedExit: (error) => exits.push(error),
		});
		await child.start();

		await child.stop();

		await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
		expect(exits).toEqual([]);
	});

	it("kills a server that ignores SIGTERM", async () => {
		const { child, port } = await create("stubborn");
		await child.start();

		await child.stop();

		await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
	});

	it("gives up when the server doesn't answer in time", async () => {
		const { child } = await create("slow", { readyTimeoutMs: 200 });

		await expect(child.start()).rejects.toThrow(/did not answer/);
		expect(child.running).toBe(false);
	});

	it("stops starting when asked to", async () => {
		const { child } = await create("slow");
		const controller = new AbortController();

		const starting = child.start(controller.signal);
		controller.abort();

		await expect(starting).rejects.toThrow(/cancelled/);
	});
});
