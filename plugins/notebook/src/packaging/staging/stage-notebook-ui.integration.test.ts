import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { create as createTar } from "tar";

import {
	NOTEBOOK_THEME_MESSAGE_TYPE,
	NOTEBOOK_THEME_READY_MESSAGE_TYPE,
} from "../../contracts/notebook-theme";
import { NTERACT_RELEASE } from "../artifacts";
import {
	KILO_EMBED_CHROME_CSS,
	KILO_EMBED_CHROME_STYLE_ATTR,
	KILO_EMBED_THEME_SCRIPT_ATTR,
	injectKiloEmbedChromeHtml,
	NTERACT_LICENSE_FILE,
	NOTEBOOK_STAGE_MANIFEST,
	stageNotebookUi,
	validateNotebookUiBundle,
	validateStagedNotebookBundle,
} from "./stage-notebook-ui";

const directories: string[] = [];

const NIGHTLY_RELEASE = {
	tag: "v2.9.0-nightly.202610292131",
	version: "2.9.0-nightly.202610292131",
	channel: "nightly",
	commit: "cea400364a391f6aee5753bf2a5ef6ea79d2991d",
	repository: "https://github.com/nteract/nteract.git",
} as const;

async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(path.join(os.tmpdir(), "notebook-ui-stage-"));
	directories.push(directory);
	return directory;
}

async function writePublishedBundle(
	directory: string,
	options: { includeWasm?: boolean; channel?: "stable" | "nightly" } = {},
): Promise<void> {
	await mkdir(path.join(directory, "assets"), { recursive: true });
	await writeFile(
		path.join(directory, "index.html"),
		'<html><head><script type="module" src="/assets/main-abcdef12.js"></script></head></html>',
	);
	await writeFile(path.join(directory, "assets/main-abcdef12.js"), "console.log('notebook')");
	if (options.includeWasm ?? true) {
		await writeFile(path.join(directory, "assets/runtimed_wasm_bg-abcdef12.wasm"), "wasm");
	}
	await writeFile(path.join(directory, "output-frame.html"), "<!doctype html><html></html>");
	await writeFile(path.join(directory, NTERACT_LICENSE_FILE), "BSD 3-Clause License");
	await writeFile(
		path.join(directory, "nteract-notebook-ui.json"),
		`${JSON.stringify({
			channel: options.channel ?? NIGHTLY_RELEASE.channel,
			commit: NIGHTLY_RELEASE.commit,
			entrypoint: "index.html",
			outputDocument: "output-frame.html",
			schemaVersion: 1,
			version: NIGHTLY_RELEASE.version,
		})}\n`,
	);
}

async function publishedArchive(
	root: string,
	options: Parameters<typeof writePublishedBundle>[1] = {},
): Promise<Buffer> {
	const bundleDirectory = path.join(root, "nteract-notebook-ui");
	await mkdir(bundleDirectory);
	await writePublishedBundle(bundleDirectory, options);
	const archivePath = path.join(root, "notebook-ui.tar.gz");
	await createTar({ cwd: root, file: archivePath, gzip: true }, ["nteract-notebook-ui"]);
	return readFile(archivePath);
}

async function stageFixture(root: string, destinationDirectory: string): Promise<void> {
	await mkdir(root, { recursive: true });
	const archive = await publishedArchive(root);
	await stageNotebookUi({
		destinationDirectory,
		release: NIGHTLY_RELEASE,
		artifact: {
			assetName: "nteract-nightly-notebook-ui.tar.gz",
			bytes: archive.byteLength,
			sha256: createHash("sha256").update(archive).digest("hex"),
		},
		fetch: async () => new Response(new Uint8Array(archive)),
	});
}

afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("stageNotebookUi", () => {
	it("stages the pinned published notebook bundle", async () => {
		const root = await temporaryDirectory();
		const destinationDirectory = path.join(root, "build/notebook");
		const archive = Buffer.from("published nightly notebook archive");
		const artifact = {
			assetName: "nteract-nightly-notebook-ui.tar.gz",
			bytes: archive.byteLength,
			sha256: createHash("sha256").update(archive).digest("hex"),
		};
		const fetchArchive = vi.fn(async () => new Response(new Uint8Array(archive)));

		const result = await stageNotebookUi({
			destinationDirectory,
			release: NIGHTLY_RELEASE,
			artifact,
			fetch: fetchArchive,
			extract: async (_archivePath, extractedDirectory) => {
				await writePublishedBundle(extractedDirectory);
			},
		});

		expect(result.staged).toBe(true);
		expect(fetchArchive).toHaveBeenCalledWith(
			`https://github.com/nteract/nteract/releases/download/${NIGHTLY_RELEASE.tag}/${artifact.assetName}`,
			expect.objectContaining({ redirect: "follow" }),
		);
		expect(await readFile(path.join(destinationDirectory, NTERACT_LICENSE_FILE), "utf8")).toContain(
			"BSD 3-Clause",
		);
		expect(await readFile(path.join(destinationDirectory, "index.html"), "utf8")).toContain(
			KILO_EMBED_CHROME_CSS,
		);
		expect(
			JSON.parse(await readFile(path.join(destinationDirectory, NOTEBOOK_STAGE_MANIFEST), "utf8")),
		).toMatchObject({
			releaseTag: NIGHTLY_RELEASE.tag,
			sourceCommit: NIGHTLY_RELEASE.commit,
		});
	});

	it("extracts the published archive without a source checkout", { timeout: 30_000 }, async () => {
		const root = await temporaryDirectory();
		const archive = await publishedArchive(root);
		const artifact = {
			assetName: "nteract-nightly-notebook-ui.tar.gz",
			bytes: archive.byteLength,
			sha256: createHash("sha256").update(archive).digest("hex"),
		};

		await expect(
			stageNotebookUi({
				destinationDirectory: path.join(root, "build/notebook"),
				release: NIGHTLY_RELEASE,
				artifact,
				fetch: async () => new Response(new Uint8Array(archive)),
			}),
		).resolves.toMatchObject({ staged: true });
	});

	it(
		"reuses or patches a current staged bundle without downloading it again",
		{ timeout: 30_000 },
		async () => {
			const root = await temporaryDirectory();
			const archive = await publishedArchive(root);
			const fetchArchive = vi.fn(async () => new Response(new Uint8Array(archive)));
			const options = {
				destinationDirectory: path.join(root, "build/notebook"),
				release: NIGHTLY_RELEASE,
				artifact: {
					assetName: "nteract-nightly-notebook-ui.tar.gz",
					bytes: archive.byteLength,
					sha256: createHash("sha256").update(archive).digest("hex"),
				},
				fetch: fetchArchive,
			};
			await stageNotebookUi(options);

			await expect(stageNotebookUi(options)).resolves.toMatchObject({ staged: false });
			const indexPath = path.join(options.destinationDirectory, "index.html");
			await writeFile(
				indexPath,
				(await readFile(indexPath, "utf8")).replace(KILO_EMBED_CHROME_CSS, "old{}"),
			);
			await expect(stageNotebookUi(options)).resolves.toMatchObject({ staged: true });
			expect(await readFile(indexPath, "utf8")).toContain(KILO_EMBED_CHROME_CSS);
			expect(fetchArchive).toHaveBeenCalledOnce();
		},
	);

	it(
		"downloads a fresh bundle when staged bytes no longer match",
		{ timeout: 30_000 },
		async () => {
			const root = await temporaryDirectory();
			const archive = Buffer.from("published nightly notebook archive");
			const fetchArchive = vi.fn(async () => new Response(new Uint8Array(archive)));
			const options = {
				destinationDirectory: path.join(root, "build/notebook"),
				release: NIGHTLY_RELEASE,
				artifact: {
					assetName: "nteract-nightly-notebook-ui.tar.gz",
					bytes: archive.byteLength,
					sha256: createHash("sha256").update(archive).digest("hex"),
				},
				fetch: fetchArchive,
				extract: async (_archivePath: string, extractedDirectory: string) => {
					await writePublishedBundle(extractedDirectory);
				},
			};
			await stageNotebookUi(options);
			await writeFile(
				path.join(options.destinationDirectory, "assets/main-abcdef12.js"),
				"corrupt",
			);

			await expect(stageNotebookUi(options)).resolves.toMatchObject({ staged: true });
			expect(fetchArchive).toHaveBeenCalledTimes(2);
		},
	);

	it("retries a 504 download and stages the bundle", async () => {
		const root = await temporaryDirectory();
		const destinationDirectory = path.join(root, "build/notebook");
		const archive = Buffer.from("published nightly notebook archive");
		const artifact = {
			assetName: "nteract-nightly-notebook-ui.tar.gz",
			bytes: archive.byteLength,
			sha256: createHash("sha256").update(archive).digest("hex"),
		};
		const fetchArchive = vi
			.fn()
			.mockResolvedValueOnce(new Response(null, { status: 504 }))
			.mockResolvedValueOnce(new Response(new Uint8Array(archive)));

		await expect(
			stageNotebookUi({
				destinationDirectory,
				release: NIGHTLY_RELEASE,
				artifact,
				fetch: fetchArchive,
				extract: async (_archivePath, extractedDirectory) => {
					await writePublishedBundle(extractedDirectory);
				},
			}),
		).resolves.toMatchObject({ staged: true });
		expect(fetchArchive).toHaveBeenCalledTimes(2);
	});

	it("does not retry a 404 download", async () => {
		const root = await temporaryDirectory();
		const fetchArchive = vi.fn(async () => new Response(null, { status: 404 }));

		await expect(
			stageNotebookUi({
				destinationDirectory: path.join(root, "build/notebook"),
				release: NIGHTLY_RELEASE,
				artifact: {
					assetName: "nteract-nightly-notebook-ui.tar.gz",
					bytes: 1,
					sha256: "0".repeat(64),
				},
				fetch: fetchArchive,
			}),
		).rejects.toThrow(/HTTP 404/);
		expect(fetchArchive).toHaveBeenCalledOnce();
	});

	it("rejects a release archive whose checksum does not match the pin", async () => {
		const root = await temporaryDirectory();
		const archive = await publishedArchive(root);
		await expect(
			stageNotebookUi({
				destinationDirectory: path.join(root, "build/notebook"),
				release: NIGHTLY_RELEASE,
				artifact: {
					assetName: "nteract-nightly-notebook-ui.tar.gz",
					bytes: archive.byteLength,
					sha256: "0".repeat(64),
				},
				fetch: async () => new Response(new Uint8Array(archive)),
			}),
		).rejects.toThrow(/SHA-256 mismatch/);
	});

	it("rejects a release archive with no WASM runtime", async () => {
		const root = await temporaryDirectory();
		const archive = await publishedArchive(root, { includeWasm: false });
		await expect(
			stageNotebookUi({
				destinationDirectory: path.join(root, "build/notebook"),
				release: NIGHTLY_RELEASE,
				artifact: {
					assetName: "nteract-nightly-notebook-ui.tar.gz",
					bytes: archive.byteLength,
					sha256: createHash("sha256").update(archive).digest("hex"),
				},
				fetch: async () => new Response(new Uint8Array(archive)),
			}),
		).rejects.toThrow(/no WASM runtime asset/);
	});

	it("rejects an archive manifest from another release channel", async () => {
		const root = await temporaryDirectory();
		const archive = await publishedArchive(root, { channel: "stable" });
		await expect(
			stageNotebookUi({
				destinationDirectory: path.join(root, "build/notebook"),
				release: NIGHTLY_RELEASE,
				artifact: {
					assetName: "nteract-nightly-notebook-ui.tar.gz",
					bytes: archive.byteLength,
					sha256: createHash("sha256").update(archive).digest("hex"),
				},
				fetch: async () => new Response(new Uint8Array(archive)),
			}),
		).rejects.toThrow(/manifest does not match/);
	});
});

describe("injectKiloEmbedChromeHtml", () => {
	it("injects before </head> and is idempotent", () => {
		const html = "<html><head><title>n</title></head><body></body></html>";
		const once = injectKiloEmbedChromeHtml(html);
		expect(once).toContain(
			`<style ${KILO_EMBED_CHROME_STYLE_ATTR}>${KILO_EMBED_CHROME_CSS}</style>`,
		);
		expect(once).toContain(`<script ${KILO_EMBED_THEME_SCRIPT_ATTR}>`);
		expect(injectKiloEmbedChromeHtml(once)).toBe(once);
	});

	it("refreshes outdated embed chrome CSS in place", () => {
		const stale = `<html><head><style ${KILO_EMBED_CHROME_STYLE_ATTR}>old{}</style></head><body></body></html>`;
		const refreshed = injectKiloEmbedChromeHtml(stale);
		expect(refreshed).toContain(KILO_EMBED_CHROME_CSS);
		expect(refreshed).toContain(`<script ${KILO_EMBED_THEME_SCRIPT_ATTR}>`);
		expect(refreshed).not.toContain("old{}");
		expect(injectKiloEmbedChromeHtml(refreshed)).toBe(refreshed);
	});

	it("hides embedded rail branding without hiding the rail or overriding its side", () => {
		expect(KILO_EMBED_CHROME_CSS).toContain(
			'#root [data-testid="notebook-rail"] [data-slot="rail-leading-slot"]{display:none}',
		);
		expect(KILO_EMBED_CHROME_CSS).toContain(
			'#root [data-testid="notebook-rail"] [data-slot="rail-strip-grid"]{grid-template-rows:minmax(0,1fr)}',
		);
		expect(KILO_EMBED_CHROME_CSS).toContain(
			'#root [data-testid="notebook-rail"] [data-slot="rail-body"]{padding-top:0.5rem}',
		);
		expect(KILO_EMBED_CHROME_CSS).not.toContain('[data-testid="notebook-rail"]{display:none}');
		expect(KILO_EMBED_CHROME_CSS).not.toContain("data-rail-side");
	});

	it("leaves the palette to the host", () => {
		expect(KILO_EMBED_CHROME_CSS).not.toContain("--background");
	});

	it("matches the host tab font size without scaling rem-based chrome", () => {
		expect(KILO_EMBED_CHROME_CSS).toContain("#root{font-size:12px}");
		expect(KILO_EMBED_CHROME_CSS).toContain("#root .cm-editor");
		expect(KILO_EMBED_CHROME_CSS).not.toContain("html{font-size:");
	});

	it("injects a parent-origin theme bridge", () => {
		const html = injectKiloEmbedChromeHtml("<html><head></head><body></body></html>");
		expect(html).toContain(NOTEBOOK_THEME_MESSAGE_TYPE);
		expect(html).toContain(NOTEBOOK_THEME_READY_MESSAGE_TYPE);
		expect(html).toContain("nteract-parent-origin");
	});

	it("rejects HTML without a head close tag", () => {
		expect(() => injectKiloEmbedChromeHtml("<html><body></body></html>")).toThrow(/no <\/head>/);
	});
});

describe("notebook bundle validation", () => {
	it(
		"rejects source shells, missing WASM, and extra unlisted files",
		{ timeout: 30_000 },
		async () => {
			const root = await temporaryDirectory();
			await mkdir(root, { recursive: true });
			await writeFile(path.join(root, "index.html"), "<html>source</html>");
			await expect(validateNotebookUiBundle(root)).rejects.toThrow(/built \/assets/);

			const noWasm = path.join(root, "no-wasm");
			await writePublishedBundle(noWasm, { includeWasm: false });
			await expect(validateNotebookUiBundle(noWasm)).rejects.toThrow(/no WASM/);

			const destination = path.join(root, "staged");
			await stageFixture(path.join(root, "archive"), destination);
			await writeFile(path.join(destination, "orphan.js"), "unexpected");
			await expect(validateStagedNotebookBundle(destination)).rejects.toThrow(
				/does not exactly cover/,
			);
			expect(await readFile(path.join(destination, NOTEBOOK_STAGE_MANIFEST), "utf8")).toContain(
				NTERACT_RELEASE.commit,
			);
		},
	);

	it(
		"rejects a staged bundle whose index.html lacks embed chrome CSS",
		{ timeout: 30_000 },
		async () => {
			const root = await temporaryDirectory();
			const destination = path.join(root, "staged");
			await stageFixture(path.join(root, "archive"), destination);
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
				/missing kilo embed chrome CSS/,
			);
		},
	);
});
