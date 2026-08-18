import { createHash } from "node:crypto";
import {
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

import { extract as extractTar } from "tar";

import { NTERACT_NOTEBOOK_UI, NTERACT_RELEASE, type ReleaseAsset } from "./artifacts.js";

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

export interface BuildNotebookUiOptions {
	readonly destinationDirectory: string;
	readonly release?: NotebookUiRelease;
	readonly artifact?: ReleaseAsset;
	readonly fetch?: typeof fetch;
	readonly extract?: (archivePath: string, destinationDirectory: string) => Promise<void>;
}

export interface BuildNotebookUiResult {
	readonly built: boolean;
	readonly destinationDirectory: string;
}

export interface NotebookUiRelease {
	readonly tag: string;
	readonly version: string;
	readonly channel: "stable" | "nightly";
	readonly commit: string;
	readonly repository: string;
}

const DOWNLOAD_TIMEOUT_MS = 120_000;
const PUBLISHED_BUNDLE_ROOT = "nteract-notebook-ui";

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

async function writeBuildManifest(
	directory: string,
	release: Pick<NotebookUiRelease, "tag" | "commit"> = NTERACT_RELEASE,
): Promise<void> {
	const files = (await collectFiles(directory)).filter((file) => file !== NOTEBOOK_BUILD_MANIFEST);
	const records = await Promise.all(
		files.map(async (relativePath): Promise<NotebookBuildFile> => {
			const bytes = await readFile(path.join(directory, relativePath));
			return { path: relativePath, bytes: bytes.byteLength, sha256: digest(bytes) };
		}),
	);
	const manifest: NotebookBuildManifest = {
		schemaVersion: 1,
		releaseTag: release.tag,
		sourceCommit: release.commit,
		files: records,
	};
	await writeFile(
		path.join(directory, NOTEBOOK_BUILD_MANIFEST),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);
}

export async function validateStagedNotebookBundle(
	directory: string,
	release: Pick<NotebookUiRelease, "tag" | "commit"> = NTERACT_RELEASE,
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
		manifest.releaseTag !== release.tag ||
		manifest.sourceCommit !== release.commit ||
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

async function stagePublishedNotebookUi(
	options: BuildNotebookUiOptions,
	release: NotebookUiRelease,
	artifact: ReleaseAsset,
	extract: NonNullable<BuildNotebookUiOptions["extract"]>,
): Promise<BuildNotebookUiResult> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
	let archive: Buffer;
	try {
		const repositoryUrl = release.repository.replace(/\.git$/, "");
		const response = await (options.fetch ?? fetch)(
			`${repositoryUrl}/releases/download/${release.tag}/${artifact.assetName}`,
			{ redirect: "follow", signal: controller.signal },
		);
		if (!response.ok) {
			throw new Error(`could not download ${artifact.assetName}: HTTP ${response.status}`);
		}
		archive = Buffer.from(await response.arrayBuffer());
	} finally {
		clearTimeout(timer);
	}
	if (archive.byteLength !== artifact.bytes) {
		throw new Error(
			`notebook UI size mismatch for ${artifact.assetName}: expected ${artifact.bytes}, got ${archive.byteLength}`,
		);
	}
	const archiveDigest = digest(archive);
	if (archiveDigest !== artifact.sha256) {
		throw new Error(
			`notebook UI SHA-256 mismatch for ${artifact.assetName}: expected ${artifact.sha256}, got ${archiveDigest}`,
		);
	}

	await mkdir(path.dirname(options.destinationDirectory), { recursive: true });
	const workingDirectory = await mkdtemp(
		path.join(path.dirname(options.destinationDirectory), ".notebook-download-"),
	);
	const archivePath = path.join(workingDirectory, artifact.assetName);
	const stagedDirectory = path.join(workingDirectory, "notebook");
	try {
		await writeFile(archivePath, archive);
		await mkdir(stagedDirectory);
		await extract(archivePath, stagedDirectory);
		const publishedManifest = JSON.parse(
			await readFile(path.join(stagedDirectory, "nteract-notebook-ui.json"), "utf8"),
		) as Record<string, unknown>;
		if (
			publishedManifest["schemaVersion"] !== 1 ||
			publishedManifest["channel"] !== release.channel ||
			publishedManifest["version"] !== release.version ||
			publishedManifest["commit"] !== release.commit ||
			publishedManifest["entrypoint"] !== "index.html" ||
			publishedManifest["outputDocument"] !== "output-frame.html"
		) {
			throw new Error("published notebook UI manifest does not match the pinned nteract release");
		}
		await validateNotebookBuildOutput(stagedDirectory);
		await applyAgenticEmbedChrome(stagedDirectory);
		await writeBuildManifest(stagedDirectory, release);
		await validateStagedNotebookBundle(stagedDirectory, release);
		await replaceDirectory(options.destinationDirectory, stagedDirectory);
	} finally {
		await rm(workingDirectory, { recursive: true, force: true });
	}
	return { built: true, destinationDirectory: options.destinationDirectory };
}

async function extractPublishedNotebookUiArchive(
	archivePath: string,
	destinationDirectory: string,
): Promise<void> {
	await extractTar({
		cwd: destinationDirectory,
		file: archivePath,
		gzip: true,
		preservePaths: false,
		strict: true,
		strip: 1,
		unlink: true,
		filter(entryPath, entry) {
			const normalized = path.posix.normalize(entryPath);
			const insideBundle =
				normalized === PUBLISHED_BUNDLE_ROOT || normalized.startsWith(`${PUBLISHED_BUNDLE_ROOT}/`);
			if (
				!insideBundle ||
				path.posix.isAbsolute(entryPath) ||
				entryPath.includes("\\") ||
				entryPath.includes("\0") ||
				entryPath.split("/").some((part) => part === "..")
			) {
				throw new Error(`unsafe notebook UI archive path: ${entryPath}`);
			}
			if (!("type" in entry) || !["File", "OldFile", "Directory"].includes(entry.type)) {
				throw new Error(`unsupported notebook UI archive entry: ${entryPath}`);
			}
			return true;
		},
	});
}

async function currentBundleIsValid(
	destinationDirectory: string,
	release: Pick<NotebookUiRelease, "tag" | "commit">,
): Promise<boolean> {
	try {
		await validateStagedNotebookBundle(destinationDirectory, release);
		return true;
	} catch {
		return false;
	}
}

/**
 * When a prior stage is otherwise sound but missing or outdated embed-chrome
 * CSS, refresh and re-hash `index.html` only — avoid another release download.
 */
async function tryPatchEmbedChrome(
	directory: string,
	release: Pick<NotebookUiRelease, "tag" | "commit">,
): Promise<boolean> {
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
		await validateStagedNotebookBundle(directory, release);
		return true;
	} catch {
		return false;
	}
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
	const release = options.release ?? NTERACT_RELEASE;
	const artifact = options.artifact ?? NTERACT_NOTEBOOK_UI;
	const uiIsCurrent = await currentBundleIsValid(options.destinationDirectory, release);
	let uiPatched = false;
	if (!uiIsCurrent) uiPatched = await tryPatchEmbedChrome(options.destinationDirectory, release);
	const uiReady = uiIsCurrent || uiPatched;
	if (uiReady) {
		return {
			built: uiPatched,
			destinationDirectory: options.destinationDirectory,
		};
	}
	return stagePublishedNotebookUi(
		options,
		release,
		artifact,
		options.extract ?? extractPublishedNotebookUiArchive,
	);
}
