import { createHash } from "node:crypto";
import {
	cp,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import path from "node:path";

import { execa } from "execa";

import { NTERACT_NOTEBOOK_SOURCE } from "../src/main/distribution/artifacts.js";

export const NOTEBOOK_BUILD_MANIFEST = "agentic-notebook-build.json";
export const NTERACT_LICENSE_FILE = "LICENSE.nteract";

/** Marker on the style tag we inject into staged `index.html`. */
export const AGENTIC_EMBED_CHROME_STYLE_ATTR = "data-agentic-embed-chrome";

/**
 * Host-side chrome overrides for the embedded notebook SPA. nteract has no
 * embed flag to hide the rail; we own the staged bytes, so we inject CSS.
 *
 * `--background` matches chat `bg-muted` (storm-50 / storm-850) so the iframe
 * page shares the same surface as the surrounding thread.
 */
export const AGENTIC_EMBED_CHROME_CSS = [
	":root,.light{--background:oklch(0.985 0 0)}",
	".dark,[data-theme=dark]{--background:oklch(0.243 0.015 261.655)}",
	"@media (prefers-color-scheme:dark){:root:not(.light){--background:oklch(0.243 0.015 261.655)}}",
	'[data-testid="notebook-rail"]{display:none!important}',
].join("");

interface NotebookBuildFile {
	readonly path: string;
	readonly bytes: number;
	readonly sha256: string;
}

export interface NotebookBuildManifest {
	readonly schemaVersion: 1;
	readonly releaseTag: string;
	readonly sourceCommit: string;
	readonly files: readonly NotebookBuildFile[];
}

export interface CommandRunner {
	(
		command: string,
		args: readonly string[],
		options: { cwd?: string; capture?: boolean },
	): Promise<void | { readonly stdout: string }>;
}

export interface BuildNotebookUiOptions {
	readonly cacheDirectory: string;
	readonly destinationDirectory: string;
	readonly run?: CommandRunner;
}

export interface BuildNotebookUiResult {
	readonly built: boolean;
	readonly checkoutDirectory: string;
	readonly destinationDirectory: string;
}

const defaultRun: CommandRunner = async (command, args, options) => {
	const result = await execa(command, [...args], {
		...(options.cwd ? { cwd: options.cwd } : {}),
		stderr: "inherit",
		stdout: options.capture ? "pipe" : "inherit",
	});
	if (options.capture) return { stdout: result.stdout ?? "" };
};

async function requireVersion(
	run: CommandRunner,
	command: string,
	args: readonly string[],
	expected: RegExp,
	guidance: string,
): Promise<void> {
	let result: void | { readonly stdout: string };
	try {
		result = await run(command, args, { capture: true });
	} catch (error) {
		throw new Error(`${guidance}: ${error instanceof Error ? error.message : String(error)}`, {
			cause: error,
		});
	}
	if (result && !expected.test(result.stdout)) {
		throw new Error(`${guidance}; found ${result.stdout.trim() || "an unknown version"}`);
	}
}

async function requireWasmClang(run: CommandRunner, cacheDirectory: string): Promise<void> {
	const compiler = process.env["CC_wasm32_unknown_unknown"]?.trim() || "clang";
	await requireVersion(
		run,
		compiler,
		["--version"],
		/clang version/i,
		"Install a WASM-capable clang to build the notebook UI",
	);
	await mkdir(cacheDirectory, { recursive: true });
	const probeDirectory = await mkdtemp(path.join(cacheDirectory, ".wasm-clang-probe-"));
	const source = path.join(probeDirectory, "probe.c");
	const output = path.join(probeDirectory, "probe.o");
	try {
		await writeFile(source, "int notebook_wasm_probe(void) { return 0; }\n");
		try {
			await run(compiler, ["--target=wasm32-unknown-unknown", "-c", source, "-o", output], {});
		} catch (error) {
			throw new Error(
				"The configured clang has no wasm32 backend. On macOS run `brew install llvm`, then set CC_wasm32_unknown_unknown and AR_wasm32_unknown_unknown to Homebrew LLVM.",
				{ cause: error },
			);
		}
		if (!(await stat(output)).isFile()) {
			throw new Error("The configured clang did not produce a wasm32 object file.");
		}
	} finally {
		await rm(probeDirectory, { recursive: true, force: true });
	}
}

function digest(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function safeRelativePath(relativePath: string): void {
	if (
		!relativePath ||
		relativePath.includes("\\") ||
		relativePath.includes("\0") ||
		path.posix.isAbsolute(relativePath) ||
		relativePath.split("/").some((part) => part === "." || part === "..")
	) {
		throw new Error(`unsafe notebook bundle path: ${relativePath}`);
	}
}

async function collectFiles(root: string, relativeDirectory = ""): Promise<string[]> {
	const entries = await readdir(path.join(root, relativeDirectory), { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
		safeRelativePath(relativePath);
		const absolutePath = path.join(root, relativePath);
		const info = await lstat(absolutePath);
		if (info.isSymbolicLink()) {
			throw new Error(`notebook bundle contains a symbolic link: ${relativePath}`);
		}
		if (info.isDirectory()) files.push(...(await collectFiles(root, relativePath)));
		else if (info.isFile()) files.push(relativePath);
		else throw new Error(`notebook bundle contains an unsupported entry: ${relativePath}`);
	}
	return files.sort();
}

export async function validateNotebookBuildOutput(directory: string): Promise<void> {
	const indexPath = path.join(directory, "index.html");
	if (!(await stat(indexPath)).isFile()) throw new Error("notebook dist has no index.html");
	if (!(await readFile(indexPath, "utf8")).includes("/assets/")) {
		throw new Error("notebook index.html does not reference built /assets/");
	}
	const outputFrame = await stat(path.join(directory, "output-frame.html")).catch(() => undefined);
	if (!outputFrame?.isFile()) {
		throw new Error("notebook dist has no output-frame.html");
	}
	const files = await collectFiles(directory);
	if (
		!files.some(
			(file) => file.startsWith("assets/") && /(?:^|\/)[^/]+[-.][A-Za-z0-9_-]{6,}\.js$/.test(file),
		)
	) {
		throw new Error("notebook dist has no hashed JavaScript entry asset");
	}
	if (!files.some((file) => file.endsWith(".wasm"))) {
		throw new Error("notebook dist has no WASM runtime asset");
	}
}

const AGENTIC_EMBED_CHROME_STYLE_TAG = `<style ${AGENTIC_EMBED_CHROME_STYLE_ATTR}>${AGENTIC_EMBED_CHROME_CSS}</style>`;
const AGENTIC_EMBED_CHROME_STYLE_RE = new RegExp(
	`<style\\s+${AGENTIC_EMBED_CHROME_STYLE_ATTR}>[\\s\\S]*?</style>`,
);

/** Pure HTML transform: inject or refresh the embed-chrome style before `</head>`. */
export function injectAgenticEmbedChromeHtml(html: string): string {
	if (html.includes(AGENTIC_EMBED_CHROME_STYLE_ATTR)) {
		return html.replace(AGENTIC_EMBED_CHROME_STYLE_RE, AGENTIC_EMBED_CHROME_STYLE_TAG);
	}
	if (!html.includes("</head>")) {
		throw new Error("notebook index.html has no </head> to inject embed chrome CSS");
	}
	return html.replace("</head>", `${AGENTIC_EMBED_CHROME_STYLE_TAG}</head>`);
}

async function applyAgenticEmbedChrome(directory: string): Promise<void> {
	const indexPath = path.join(directory, "index.html");
	const html = await readFile(indexPath, "utf8");
	const next = injectAgenticEmbedChromeHtml(html);
	if (next !== html) await writeFile(indexPath, next);
}

async function writeBuildManifest(directory: string): Promise<void> {
	const files = (await collectFiles(directory)).filter((file) => file !== NOTEBOOK_BUILD_MANIFEST);
	const records = await Promise.all(
		files.map(async (relativePath): Promise<NotebookBuildFile> => {
			const bytes = await readFile(path.join(directory, relativePath));
			return { path: relativePath, bytes: bytes.byteLength, sha256: digest(bytes) };
		}),
	);
	const manifest: NotebookBuildManifest = {
		schemaVersion: 1,
		releaseTag: NTERACT_NOTEBOOK_SOURCE.tag,
		sourceCommit: NTERACT_NOTEBOOK_SOURCE.commit,
		files: records,
	};
	await writeFile(
		path.join(directory, NOTEBOOK_BUILD_MANIFEST),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);
}

export async function validateStagedNotebookBundle(
	directory: string,
): Promise<NotebookBuildManifest> {
	await validateNotebookBuildOutput(directory);
	const indexHtml = await readFile(path.join(directory, "index.html"), "utf8");
	if (!indexHtml.includes(AGENTIC_EMBED_CHROME_STYLE_TAG)) {
		throw new Error("staged notebook index.html is missing agentic embed chrome CSS");
	}
	const manifest = JSON.parse(
		await readFile(path.join(directory, NOTEBOOK_BUILD_MANIFEST), "utf8"),
	) as NotebookBuildManifest;
	if (
		manifest.schemaVersion !== 1 ||
		manifest.releaseTag !== NTERACT_NOTEBOOK_SOURCE.tag ||
		manifest.sourceCommit !== NTERACT_NOTEBOOK_SOURCE.commit ||
		!Array.isArray(manifest.files)
	) {
		throw new Error("notebook build manifest does not match the pinned nteract release");
	}
	const actualFiles = (await collectFiles(directory)).filter(
		(file) => file !== NOTEBOOK_BUILD_MANIFEST,
	);
	if (
		actualFiles.length !== manifest.files.length ||
		actualFiles.some((file, index) => manifest.files[index]?.path !== file)
	) {
		throw new Error("notebook build manifest does not exactly cover the staged bundle");
	}
	for (const record of manifest.files) {
		safeRelativePath(record.path);
		if (
			!Number.isSafeInteger(record.bytes) ||
			record.bytes < 0 ||
			!/^[a-f0-9]{64}$/.test(record.sha256)
		) {
			throw new Error(`invalid notebook build manifest record: ${record.path}`);
		}
		const bytes = await readFile(path.join(directory, record.path));
		if (bytes.byteLength !== record.bytes || digest(bytes) !== record.sha256) {
			throw new Error(`notebook bundle checksum mismatch: ${record.path}`);
		}
	}
	return manifest;
}

async function currentBundleIsValid(destinationDirectory: string): Promise<boolean> {
	try {
		await validateStagedNotebookBundle(destinationDirectory);
		return true;
	} catch {
		return false;
	}
}

/**
 * When a prior stage is otherwise sound but missing or outdated embed-chrome
 * CSS, refresh and re-hash `index.html` only — avoid a full upstream rebuild
 * for a style tag.
 */
async function tryPatchEmbedChrome(directory: string): Promise<boolean> {
	try {
		const indexPath = path.join(directory, "index.html");
		const html = await readFile(indexPath, "utf8");
		const nextHtml = injectAgenticEmbedChromeHtml(html);
		if (nextHtml === html) return false;
		await writeFile(indexPath, nextHtml);
		const manifestPath = path.join(directory, NOTEBOOK_BUILD_MANIFEST);
		const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as NotebookBuildManifest;
		const indexBytes = await readFile(indexPath);
		const files = manifest.files.map((record) =>
			record.path === "index.html"
				? {
						path: "index.html",
						bytes: indexBytes.byteLength,
						sha256: digest(indexBytes),
					}
				: record,
		);
		const next: NotebookBuildManifest = { ...manifest, files };
		await writeFile(manifestPath, `${JSON.stringify(next, null, 2)}\n`);
		await validateStagedNotebookBundle(directory);
		return true;
	} catch {
		return false;
	}
}

async function checkoutPinnedSource(
	checkoutDirectory: string,
	cacheDirectory: string,
	run: CommandRunner,
): Promise<void> {
	let currentCommit: string | undefined;
	try {
		currentCommit = (
			await readFile(path.join(checkoutDirectory, ".agentic-source-commit"), "utf8")
		).trim();
	} catch {
		currentCommit = undefined;
	}
	if (currentCommit !== NTERACT_NOTEBOOK_SOURCE.commit) {
		await rm(checkoutDirectory, { recursive: true, force: true });
		await mkdir(cacheDirectory, { recursive: true });
		await run(
			"git",
			[
				"clone",
				"--depth",
				"1",
				"--branch",
				NTERACT_NOTEBOOK_SOURCE.tag,
				NTERACT_NOTEBOOK_SOURCE.repository,
				checkoutDirectory,
			],
			{},
		);
	}
	await run("git", ["lfs", "pull"], { cwd: checkoutDirectory });
	await run("git", ["merge-base", "--is-ancestor", NTERACT_NOTEBOOK_SOURCE.commit, "HEAD"], {
		cwd: checkoutDirectory,
	});
	await run("git", ["merge-base", "--is-ancestor", "HEAD", NTERACT_NOTEBOOK_SOURCE.commit], {
		cwd: checkoutDirectory,
	});
	await writeFile(
		path.join(checkoutDirectory, ".agentic-source-commit"),
		`${NTERACT_NOTEBOOK_SOURCE.commit}\n`,
	);
}

async function replaceDirectory(targetDirectory: string, stagedDirectory: string): Promise<void> {
	const backupDirectory = `${targetDirectory}.previous`;
	await rm(backupDirectory, { recursive: true, force: true });
	try {
		await rename(targetDirectory, backupDirectory);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	try {
		await rename(stagedDirectory, targetDirectory);
		await rm(backupDirectory, { recursive: true, force: true });
	} catch (error) {
		try {
			await rename(backupDirectory, targetDirectory);
		} catch {
			// Preserve the original replacement error if there was no backup.
		}
		throw error;
	}
}

export async function buildNotebookUi(
	options: BuildNotebookUiOptions,
): Promise<BuildNotebookUiResult> {
	const checkoutDirectory = path.join(options.cacheDirectory, "nteract");
	if (await currentBundleIsValid(options.destinationDirectory)) {
		return { built: false, checkoutDirectory, destinationDirectory: options.destinationDirectory };
	}
	if (await tryPatchEmbedChrome(options.destinationDirectory)) {
		return { built: true, checkoutDirectory, destinationDirectory: options.destinationDirectory };
	}

	const run = options.run ?? defaultRun;
	await requireVersion(
		run,
		"git",
		["--version"],
		/git version/i,
		"Install Git to build the notebook UI",
	);
	await requireVersion(
		run,
		"git",
		["lfs", "version"],
		/git-lfs/i,
		"Install Git LFS to build the notebook UI",
	);
	await requireVersion(
		run,
		"cargo",
		["--version"],
		/cargo 1\.94\.0\b/,
		"Install Rust 1.94.0 to build the notebook UI",
	);
	await requireVersion(
		run,
		"wasm-pack",
		["--version"],
		/wasm-pack 0\.15\.0\b/,
		"Install wasm-pack 0.15.0 to build the notebook UI",
	);
	await requireWasmClang(run, options.cacheDirectory);
	await checkoutPinnedSource(checkoutDirectory, options.cacheDirectory, run);
	await run("pnpm", ["install", "--frozen-lockfile"], { cwd: checkoutDirectory });
	await run("cargo", ["xtask", "artifacts", "ensure", "runtime,sift,renderer"], {
		cwd: checkoutDirectory,
	});
	await run("pnpm", ["--dir", "apps/notebook", "build"], { cwd: checkoutDirectory });

	const distDirectory = path.join(checkoutDirectory, "apps/notebook/dist");
	await validateNotebookBuildOutput(distDirectory);
	await mkdir(path.dirname(options.destinationDirectory), { recursive: true });
	const stagedDirectory = await mkdtemp(
		path.join(path.dirname(options.destinationDirectory), ".notebook-staging-"),
	);
	try {
		await cp(distDirectory, stagedDirectory, { recursive: true });
		await cp(
			path.join(checkoutDirectory, "LICENSE"),
			path.join(stagedDirectory, NTERACT_LICENSE_FILE),
		);
		await applyAgenticEmbedChrome(stagedDirectory);
		await writeBuildManifest(stagedDirectory);
		await validateStagedNotebookBundle(stagedDirectory);
		await replaceDirectory(options.destinationDirectory, stagedDirectory);
	} finally {
		await rm(stagedDirectory, { recursive: true, force: true });
	}
	return { built: true, checkoutDirectory, destinationDirectory: options.destinationDirectory };
}
