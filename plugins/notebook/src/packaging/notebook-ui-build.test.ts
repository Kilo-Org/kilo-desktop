import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { NTERACT_NOTEBOOK_SOURCE } from "./artifacts.js";
import {
	AGENTIC_EMBED_CHROME_CSS,
	AGENTIC_EMBED_CHROME_STYLE_ATTR,
	buildNotebookUi,
	injectAgenticEmbedChromeHtml,
	NOTEBOOK_BUILD_MANIFEST,
	NTERACT_LICENSE_FILE,
	validateNotebookBuildOutput,
	validateStagedNotebookBundle,
	type CommandRunner,
} from "./notebook-ui-build.js";

const directories: string[] = [];

async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(path.join(os.tmpdir(), "notebook-ui-build-"));
	directories.push(directory);
	return directory;
}

async function writeDist(checkoutDirectory: string, includeWasm = true): Promise<void> {
	const dist = path.join(checkoutDirectory, "apps/notebook/dist");
	await mkdir(path.join(dist, "assets"), { recursive: true });
	await writeFile(
		path.join(dist, "index.html"),
		[
			"<!doctype html>",
			"<html><head>",
			'<script type="module" src="/assets/main-abcdef12.js"></script>',
			'</head><body><div id="root"></div></body></html>',
		].join(""),
	);
	await writeFile(path.join(dist, "assets/main-abcdef12.js"), "console.log('notebook')");
	await writeFile(path.join(dist, "output-frame.html"), "<!doctype html><html></html>");
	if (includeWasm)
		await writeFile(path.join(dist, "assets/runtimed_wasm_bg-abcdef12.wasm"), "wasm");
}

function fakeRunner(
	options: { includeWasm?: boolean } = {},
): CommandRunner & ReturnType<typeof vi.fn> {
	return vi.fn(
		async (
			command: string,
			args: readonly string[],
			runOptions: { cwd?: string; capture?: boolean },
		) => {
			if (command === "git" && args[0] === "clone") {
				const checkoutDirectory = args.at(-1)!;
				await mkdir(checkoutDirectory, { recursive: true });
				await writeFile(path.join(checkoutDirectory, "LICENSE"), "BSD 3-Clause License");
			}
			if (command === "pnpm" && args.includes("build")) {
				await writeDist(runOptions.cwd!, options.includeWasm ?? true);
			}
			const isClang = command === "clang" || /(?:^|\/)clang(?:-\d+)?$/.test(command);
			if (isClang && args.includes("--target=wasm32-unknown-unknown")) {
				await writeFile(args.at(-1)!, "wasm object");
			}
			if (runOptions.capture) {
				if (isClang) return { stdout: "clang version 21.1.0" };
				const versions: Record<string, string> = {
					git: args[0] === "lfs" ? "git-lfs/3.7.0" : "git version 2.51.0",
					cargo: "cargo 1.94.0",
					"wasm-pack": "wasm-pack 0.15.0",
				};
				return { stdout: versions[command] ?? "" };
			}
		},
	) as CommandRunner & ReturnType<typeof vi.fn>;
}

afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("buildNotebookUi", () => {
	it("fetches the pin, builds upstream artifacts, and stages a verified bundle", async () => {
		const root = await temporaryDirectory();
		const destinationDirectory = path.join(root, "build/notebook");
		const run = fakeRunner();

		const result = await buildNotebookUi({
			cacheDirectory: path.join(root, "cache"),
			destinationDirectory,
			run,
		});

		expect(result.built).toBe(true);
		expect(await readFile(path.join(destinationDirectory, NTERACT_LICENSE_FILE), "utf8")).toContain(
			"BSD 3-Clause",
		);
		const stagedIndex = await readFile(path.join(destinationDirectory, "index.html"), "utf8");
		expect(stagedIndex).toContain(AGENTIC_EMBED_CHROME_STYLE_ATTR);
		expect(stagedIndex).toContain(AGENTIC_EMBED_CHROME_CSS);
		await expect(validateStagedNotebookBundle(destinationDirectory)).resolves.toMatchObject({
			releaseTag: NTERACT_NOTEBOOK_SOURCE.tag,
			sourceCommit: NTERACT_NOTEBOOK_SOURCE.commit,
		});
		expect(run).toHaveBeenCalledWith(
			"cargo",
			["xtask", "artifacts", "ensure", "runtime,sift,renderer"],
			expect.objectContaining({ cwd: expect.stringContaining(path.join("cache", "nteract")) }),
		);
		expect(run).toHaveBeenCalledWith(
			"pnpm",
			["--dir", "apps/notebook", "build"],
			expect.any(Object),
		);
	});

	it("rebuilds when staged index.html lacks embed chrome CSS", async () => {
		const root = await temporaryDirectory();
		const options = {
			cacheDirectory: path.join(root, "cache"),
			destinationDirectory: path.join(root, "build/notebook"),
			run: fakeRunner(),
		};
		await buildNotebookUi(options);
		await writeFile(
			path.join(options.destinationDirectory, "index.html"),
			[
				"<!doctype html>",
				"<html><head>",
				'<script type="module" src="/assets/main-abcdef12.js"></script>',
				"</head><body></body></html>",
			].join(""),
		);
		options.run.mockClear();

		await expect(buildNotebookUi(options)).resolves.toMatchObject({ built: true });
		// Cheap path: inject CSS into the existing stage; no tool invocations.
		expect(options.run).not.toHaveBeenCalled();
		expect(await readFile(path.join(options.destinationDirectory, "index.html"), "utf8")).toContain(
			AGENTIC_EMBED_CHROME_CSS,
		);
		await expect(validateStagedNotebookBundle(options.destinationDirectory)).resolves.toBeTruthy();
	});

	it("patches staged index.html when embed chrome CSS is outdated", async () => {
		const root = await temporaryDirectory();
		const options = {
			cacheDirectory: path.join(root, "cache"),
			destinationDirectory: path.join(root, "build/notebook"),
			run: fakeRunner(),
		};
		await buildNotebookUi(options);
		const indexPath = path.join(options.destinationDirectory, "index.html");
		const staleHtml = (await readFile(indexPath, "utf8")).replace(
			AGENTIC_EMBED_CHROME_CSS,
			"old-embed-chrome{}",
		);
		await writeFile(indexPath, staleHtml);
		options.run.mockClear();

		await expect(buildNotebookUi(options)).resolves.toMatchObject({ built: true });
		expect(options.run).not.toHaveBeenCalled();
		expect(await readFile(indexPath, "utf8")).toContain(AGENTIC_EMBED_CHROME_CSS);
		await expect(validateStagedNotebookBundle(options.destinationDirectory)).resolves.toBeTruthy();
	});

	it("skips every tool invocation when the staged bundle is current", async () => {
		const root = await temporaryDirectory();
		const options = {
			cacheDirectory: path.join(root, "cache"),
			destinationDirectory: path.join(root, "build/notebook"),
			run: fakeRunner(),
		};
		await buildNotebookUi(options);
		options.run.mockClear();

		await expect(buildNotebookUi(options)).resolves.toMatchObject({ built: false });
		expect(options.run).not.toHaveBeenCalled();
	});

	it("rebuilds when a staged file no longer matches its manifest", async () => {
		const root = await temporaryDirectory();
		const options = {
			cacheDirectory: path.join(root, "cache"),
			destinationDirectory: path.join(root, "build/notebook"),
			run: fakeRunner(),
		};
		await buildNotebookUi(options);
		await writeFile(path.join(options.destinationDirectory, "assets/main-abcdef12.js"), "corrupt");
		options.run.mockClear();

		await expect(buildNotebookUi(options)).resolves.toMatchObject({ built: true });
		expect(options.run).toHaveBeenCalledWith("git", ["--version"], { capture: true });
	});

	it("rejects an upstream build with no WASM runtime", async () => {
		const root = await temporaryDirectory();
		await expect(
			buildNotebookUi({
				cacheDirectory: path.join(root, "cache"),
				destinationDirectory: path.join(root, "build/notebook"),
				run: fakeRunner({ includeWasm: false }),
			}),
		).rejects.toThrow(/no WASM runtime asset/);
	});

	it("rejects a checkout whose HEAD is not the pinned source revision", async () => {
		const root = await temporaryDirectory();
		const base = fakeRunner();
		const run = vi.fn(async (...args: Parameters<CommandRunner>) => {
			if (
				args[0] === "git" &&
				args[1][0] === "merge-base" &&
				args[1][3] === NTERACT_NOTEBOOK_SOURCE.commit
			) {
				throw new Error("not the pinned commit");
			}
			return base(...args);
		}) as CommandRunner;

		await expect(
			buildNotebookUi({
				cacheDirectory: path.join(root, "cache"),
				destinationDirectory: path.join(root, "build/notebook"),
				run,
			}),
		).rejects.toThrow(/not the pinned commit/);
	});

	it("fails preflight when clang cannot target wasm32", async () => {
		const root = await temporaryDirectory();
		const base = fakeRunner();
		const run = vi.fn(async (...args: Parameters<CommandRunner>) => {
			if (args[1].includes("--target=wasm32-unknown-unknown")) {
				throw new Error("No available targets");
			}
			return base(...args);
		}) as CommandRunner;

		await expect(
			buildNotebookUi({
				cacheDirectory: path.join(root, "cache"),
				destinationDirectory: path.join(root, "build/notebook"),
				run,
			}),
		).rejects.toThrow(/brew install llvm/);
	});
});

describe("injectAgenticEmbedChromeHtml", () => {
	it("injects before </head> and is idempotent", () => {
		const html = "<html><head><title>n</title></head><body></body></html>";
		const once = injectAgenticEmbedChromeHtml(html);
		expect(once).toContain(
			`<style ${AGENTIC_EMBED_CHROME_STYLE_ATTR}>${AGENTIC_EMBED_CHROME_CSS}</style></head>`,
		);
		expect(injectAgenticEmbedChromeHtml(once)).toBe(once);
	});

	it("refreshes outdated embed chrome CSS in place", () => {
		const stale = `<html><head><style ${AGENTIC_EMBED_CHROME_STYLE_ATTR}>old{}</style></head><body></body></html>`;
		const refreshed = injectAgenticEmbedChromeHtml(stale);
		expect(refreshed).toContain(AGENTIC_EMBED_CHROME_CSS);
		expect(refreshed).not.toContain("old{}");
		expect(injectAgenticEmbedChromeHtml(refreshed)).toBe(refreshed);
	});

	it("rejects HTML without a head close tag", () => {
		expect(() => injectAgenticEmbedChromeHtml("<html><body></body></html>")).toThrow(/no <\/head>/);
	});
});

describe("notebook bundle validation", () => {
	it("rejects source shells, missing WASM, and extra unlisted files", async () => {
		const root = await temporaryDirectory();
		await mkdir(root, { recursive: true });
		await writeFile(path.join(root, "index.html"), "<html>source</html>");
		await expect(validateNotebookBuildOutput(root)).rejects.toThrow(/built \/assets/);

		await writeDist(root, false);
		await expect(
			validateNotebookBuildOutput(path.join(root, "apps/notebook/dist")),
		).rejects.toThrow(/no WASM/);

		const destination = path.join(root, "staged");
		await buildNotebookUi({
			cacheDirectory: path.join(root, "cache"),
			destinationDirectory: destination,
			run: fakeRunner(),
		});
		await writeFile(path.join(destination, "orphan.js"), "unexpected");
		await expect(validateStagedNotebookBundle(destination)).rejects.toThrow(
			/does not exactly cover/,
		);
		expect(await readFile(path.join(destination, NOTEBOOK_BUILD_MANIFEST), "utf8")).toContain(
			NTERACT_NOTEBOOK_SOURCE.commit,
		);
	});

	it("rejects a staged bundle whose index.html lacks embed chrome CSS", async () => {
		const root = await temporaryDirectory();
		const destination = path.join(root, "staged");
		await buildNotebookUi({
			cacheDirectory: path.join(root, "cache"),
			destinationDirectory: destination,
			run: fakeRunner(),
		});
		await writeFile(
			path.join(destination, "index.html"),
			[
				"<!doctype html>",
				"<html><head>",
				'<script type="module" src="/assets/main-abcdef12.js"></script>',
				"</head><body></body></html>",
			].join(""),
		);
		await expect(validateStagedNotebookBundle(destination)).rejects.toThrow(
			/missing agentic embed chrome CSS/,
		);
	});
});
