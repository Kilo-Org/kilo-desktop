import { copyFile, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Writes the app-wide THIRD_PARTY_NOTICES from what actually ships:
 *
 * - JavaScript packages: every package Vite bundled into a shipped bundle (its
 *   `build.license` JSON) plus every production package packed into app.asar.
 *   A package's own files (license, NOTICE) are read from its directory, so a
 *   bundled package gets the same entry as a packed one.
 * - Notices of packed workspace packages (`THIRD_PARTY_NOTICES.md`): ported code
 *   and the programs a plugin ships, reproduced verbatim.
 * - Notices a shipped component carries in its own right (the conda bridge
 *   payload), reproduced verbatim.
 * - Electron, whose LICENSE covers the runtime and which ships Chromium's
 *   credits as LICENSES.chromium.html.
 *
 * Workspace packages are first-party and never listed as third-party
 * packages. The output is deterministic: sorted, LF endings.
 */

export interface ThirdPartyNoticesOptions {
	readonly productName: string;
	/** Vite `build.license` JSON files of the bundles that ship. */
	readonly bundleLicenseFiles: readonly string[];
	/** node_modules trees searched for a bundled package's own files. */
	readonly packageSearchRoots: readonly string[];
	/** The production node_modules packed into app.asar. */
	readonly shippedNodeModules: string;
	/** Workspace packages: first-party, but their `THIRD_PARTY_NOTICES.md` is reproduced. */
	readonly workspacePackageNames: readonly string[];
	/** Notices files a shipped component carries, reproduced verbatim after a preamble. */
	readonly componentNotices: readonly {
		readonly title: string;
		readonly preamble: string;
		readonly file: string;
	}[];
	readonly electron: { readonly version: string; readonly licenseFile: string };
}

export const THIRD_PARTY_NOTICES_FILE = "THIRD_PARTY_NOTICES.txt";
const CHROMIUM_CREDITS_FILE = "LICENSES.chromium.html";

export interface AppLegalFilesOptions extends Omit<
	ThirdPartyNoticesOptions,
	"shippedNodeModules" | "electron"
> {
	/** Forge's `beforeAsar` build path: the app folder that becomes app.asar. */
	readonly buildPath: string;
	/** The target platform, as Forge names it (`mas` is the Mac App Store build). */
	readonly platform: string;
}

/**
 * Writes THIRD_PARTY_NOTICES.txt and Chromium's credits into the
 * app's resources folder, beside app.asar, where kilo.shell (`kilo.shell/legal`) reads them.
 * Runs in `beforeAsar`, once the production node_modules are staged.
 *
 * @electron/packager extracts Electron's LICENSE, LICENSES.chromium.html and
 * version at the root of its staging folder, which ends up outside the app
 * bundle on macOS (and unlisted in the DMG); the copies here are the ones that ship.
 */
export async function writeAppLegalFiles(options: AppLegalFilesOptions): Promise<void> {
	const { buildPath, platform, ...noticesOptions } = options;
	const resources = path.dirname(buildPath);
	const electronRoot =
		platform === "darwin" || platform === "mas"
			? path.resolve(buildPath, "../../../..")
			: path.resolve(buildPath, "../..");
	const electronVersion = (await readFile(path.join(electronRoot, "version"), "utf8")).trim();

	const notices = await renderThirdPartyNotices({
		...noticesOptions,
		shippedNodeModules: path.join(buildPath, "node_modules"),
		electron: { version: electronVersion, licenseFile: path.join(electronRoot, "LICENSE") },
	});
	await writeFile(path.join(resources, THIRD_PARTY_NOTICES_FILE), notices);
	await copyFile(
		path.join(electronRoot, CHROMIUM_CREDITS_FILE),
		path.join(resources, CHROMIUM_CREDITS_FILE),
	);
}

interface PackageNotice {
	readonly name: string;
	readonly version: string;
	readonly license: string;
	readonly source: string;
	readonly texts: readonly { readonly label: string; readonly text: string }[];
}

interface PackageManifest {
	name?: unknown;
	version?: unknown;
	license?: unknown;
	licenses?: unknown;
	repository?: unknown;
	homepage?: unknown;
}

const RULE = "=".repeat(80);
const WORKSPACE_NOTICES_FILE = "THIRD_PARTY_NOTICES.md";
// LICENSE, COPYING, NOTICE and the third-party notices a package keeps for what
// it bundles (THIRD_PARTY_LICENSES.md, ThirdPartyNotices.txt).
const LEGAL_FILE =
	/^(third[-_ ]?party[-_ ]?(notices?|licen[cs]es?)|licen[cs]es?|copying|notices?)([._-].*)?$/i;
// license.js, notice.d.ts and friends are code that happens to share the name.
const CODE_FILE = /\.([cm]?[jt]sx?|json|map|html?|css)$/i;

export async function renderThirdPartyNotices(options: ThirdPartyNoticesOptions): Promise<string> {
	const workspacePackages = new Set(options.workspacePackageNames);
	const packages = new Map<string, PackageNotice>();
	const workspaceNotices: { packageName: string; file: string }[] = [];
	const add = (notice: PackageNotice) => {
		if (!workspacePackages.has(notice.name))
			packages.set(`${notice.name}@${notice.version}`, notice);
	};
	for (const directory of await listPackageDirectories(options.shippedNodeModules)) {
		const notice = await readPackageNotice(directory);
		if (!notice) continue;
		if (workspacePackages.has(notice.name)) {
			const file = path.join(directory, WORKSPACE_NOTICES_FILE);
			if (await isFile(file)) workspaceNotices.push({ packageName: notice.name, file });
		}
		add(notice);
	}
	const searchIndex = await indexPackages(options.packageSearchRoots);
	for (const file of options.bundleLicenseFiles) {
		for (const bundled of await readBundleLicenses(file)) {
			const key = `${bundled.name}@${bundled.version}`;
			if (packages.has(key)) continue;
			const directory = searchIndex.get(key);
			const notice = directory ? await readPackageNotice(directory) : bundledNotice(bundled);
			if (notice) add(notice);
		}
	}

	const sorted = [...packages.values()].sort(
		(left, right) => compareText(left.name, right.name) || compareText(left.version, right.version),
	);
	const electron: PackageNotice = {
		name: "Electron",
		version: options.electron.version,
		license: "MIT",
		source: "https://github.com/electron/electron",
		texts: [
			{
				label: "LICENSE",
				text: normalizeText(await readFile(options.electron.licenseFile, "utf8")),
			},
			{
				label: "Chromium",
				text: "Electron embeds Chromium and its dependencies. Their notices are in\nLICENSES.chromium.html, next to this file.",
			},
		],
	};
	workspaceNotices.sort((left, right) => compareText(left.packageName, right.packageName));

	const sections: { title: string; notices: PackageNotice[] }[] = [
		{ title: "Runtime", notices: [electron] },
		{ title: "JavaScript packages", notices: sorted },
	];
	const lines = [
		"THIRD-PARTY SOFTWARE NOTICES",
		options.productName,
		"",
		`${options.productName} includes the third-party software listed below. Each entry gives the`,
		"license the component declares, where its source is published, and the license",
		"texts it ships with.",
		"",
		"CONTENTS",
		...renderContents(sections),
	];
	if (workspaceNotices.length > 0) {
		lines.push("", "Ported source code");
		lines.push(...workspaceNotices.map(({ packageName }) => `  ${packageName}`));
	}
	if (options.componentNotices.length > 0) {
		lines.push("", "Bundled components");
		lines.push(...options.componentNotices.map(({ title }) => `  ${title}`));
	}

	for (const notice of [electron, ...sorted]) lines.push(...renderPackage(notice));
	for (const { packageName, file } of workspaceNotices) {
		lines.push("", RULE, `Ported source code: ${packageName}`, RULE, "");
		lines.push(normalizeText(await readFile(file, "utf8")).trimEnd());
	}
	for (const { title, preamble, file } of options.componentNotices) {
		lines.push("", RULE, title, RULE, "", preamble, "");
		lines.push(normalizeText(await readFile(file, "utf8")).trimEnd());
	}
	return `${lines.join("\n")}\n`;
}

function renderContents(
	sections: readonly { title: string; notices: PackageNotice[] }[],
): string[] {
	const all = sections.flatMap(({ notices }) => notices);
	const nameWidth = Math.max(...all.map(({ name }) => name.length));
	const versionWidth = Math.max(...all.map(({ version }) => version.length));
	return sections.flatMap(({ title, notices }) =>
		notices.length === 0
			? []
			: [
					"",
					title,
					...notices.map(
						({ name, version, license }) =>
							`  ${name.padEnd(nameWidth)}  ${version.padEnd(versionWidth)}  ${license}`,
					),
				],
	);
}

function renderPackage(notice: PackageNotice): string[] {
	const lines = ["", RULE, `${notice.name} ${notice.version}`, RULE];
	lines.push(`License: ${notice.license}`, `Source: ${notice.source}`);
	if (notice.texts.length === 0) {
		lines.push("License text: not included in the package; see its source.");
	}
	for (const { label, text } of notice.texts) {
		lines.push("", `---- ${label} ----`, "", text.trimEnd());
	}
	return lines;
}

/** One entry of a Vite `build.license` JSON file. */
interface BundledPackage {
	readonly name: string;
	readonly version: string;
	readonly identifier?: string;
	readonly text?: string;
}

async function readBundleLicenses(file: string): Promise<BundledPackage[]> {
	let entries: unknown;
	try {
		entries = JSON.parse(await readFile(file, "utf8"));
	} catch (cause) {
		throw new Error(`Cannot read the bundle license list ${file}; build the bundle first.`, {
			cause,
		});
	}
	if (!Array.isArray(entries)) throw new Error(`${file} is not a Vite license list.`);
	return entries.filter(
		(entry): entry is BundledPackage =>
			isRecord(entry) &&
			typeof entry.name === "string" &&
			typeof entry.version === "string" &&
			// Vite reads the nearest package.json with a name, so a manifest a
			// package keeps in a subfolder (preact/hooks) shows up as a versionless
			// "0.0.0" package. Its enclosing package is listed in its own right.
			entry.version !== "0.0.0",
	);
}

function bundledNotice(bundled: BundledPackage): PackageNotice {
	return {
		name: bundled.name,
		version: bundled.version,
		license: bundled.identifier ?? "not declared",
		source: `https://www.npmjs.com/package/${bundled.name}/v/${bundled.version}`,
		texts: bundled.text ? [{ label: "LICENSE", text: normalizeText(bundled.text) }] : [],
	};
}

/** Package directory by `name@version`, first root wins. */
async function indexPackages(roots: readonly string[]): Promise<Map<string, string>> {
	const index = new Map<string, string>();
	for (const root of roots) {
		for (const directory of await listPackageDirectories(root)) {
			const manifest = await readManifest(directory);
			if (typeof manifest?.name !== "string" || typeof manifest.version !== "string") continue;
			const key = `${manifest.name}@${manifest.version}`;
			if (!index.has(key)) index.set(key, directory);
		}
	}
	return index;
}

async function readPackageNotice(directory: string): Promise<PackageNotice | undefined> {
	const manifest = await readManifest(directory);
	if (typeof manifest?.name !== "string" || typeof manifest.version !== "string") return undefined;
	return {
		name: manifest.name,
		version: manifest.version,
		license: declaredLicense(manifest) ?? "not declared",
		source: sourceUrl(manifest),
		texts: await readLegalFiles(directory),
	};
}

async function readManifest(directory: string): Promise<PackageManifest | undefined> {
	try {
		return JSON.parse(
			await readFile(path.join(directory, "package.json"), "utf8"),
		) as PackageManifest;
	} catch {
		return undefined;
	}
}

function declaredLicense(manifest: PackageManifest): string | undefined {
	if (typeof manifest.license === "string") return manifest.license.trim();
	if (isRecord(manifest.license) && typeof manifest.license.type === "string") {
		return manifest.license.type;
	}
	if (Array.isArray(manifest.licenses)) {
		const types = manifest.licenses.flatMap((entry) =>
			isRecord(entry) && typeof entry.type === "string" ? [entry.type] : [],
		);
		if (types.length > 0) return types.join(" OR ");
	}
	return undefined;
}

function sourceUrl(manifest: PackageManifest): string {
	const repository = isRecord(manifest.repository) ? manifest.repository.url : manifest.repository;
	if (typeof repository === "string" && repository.trim()) return normalizeRepository(repository);
	if (typeof manifest.homepage === "string" && manifest.homepage.trim()) return manifest.homepage;
	return `https://www.npmjs.com/package/${String(manifest.name)}/v/${String(manifest.version)}`;
}

function normalizeRepository(repository: string): string {
	const url = repository
		.trim()
		.replace(/^git\+/, "")
		.replace(/^git:\/\//, "https://")
		.replace(/^ssh:\/\/git@/, "https://")
		.replace(/^git@([^:]+):/, "https://$1/")
		.replace(/\.git$/, "");
	if (/^[\w.-]+\/[\w.-]+$/.test(url)) return `https://github.com/${url}`;
	const shorthand = /^(github|gitlab|bitbucket):(.+)$/.exec(url);
	if (shorthand)
		return `https://${shorthand[1]}.${shorthand[1] === "bitbucket" ? "org" : "com"}/${shorthand[2]}`;
	return url;
}

async function readLegalFiles(
	directory: string,
): Promise<{ readonly label: string; readonly text: string }[]> {
	// Some packages keep their license next to the published build instead of
	// at the package root (@nteract/sift: lib/LICENSE).
	for (const folder of ["", "lib", "dist"]) {
		const files = (await listLegalFiles(path.join(directory, folder))).map((file) =>
			path.posix.join(folder, file),
		);
		if (files.length === 0) continue;
		return Promise.all(
			files.map(async (file) => ({
				label: file,
				text: normalizeText(await readFile(path.join(directory, file), "utf8")),
			})),
		);
	}
	return [];
}

async function listLegalFiles(directory: string): Promise<string[]> {
	try {
		const entries = await readdir(directory, { withFileTypes: true });
		return entries
			.filter(
				(entry) => entry.isFile() && LEGAL_FILE.test(entry.name) && !CODE_FILE.test(entry.name),
			)
			.map((entry) => entry.name)
			.sort(compareText);
	} catch {
		return [];
	}
}

/** Package directories in a node_modules tree, nested node_modules included. */
async function listPackageDirectories(nodeModules: string): Promise<string[]> {
	const directories: string[] = [];
	for (const entry of await readDirectoryNames(nodeModules)) {
		if (entry.startsWith(".")) continue;
		const candidates = entry.startsWith("@")
			? (await readDirectoryNames(path.join(nodeModules, entry))).map((name) =>
					path.join(nodeModules, entry, name),
				)
			: [path.join(nodeModules, entry)];
		for (const candidate of candidates) {
			if (!(await isDirectory(candidate))) continue;
			directories.push(
				candidate,
				...(await listPackageDirectories(path.join(candidate, "node_modules"))),
			);
		}
	}
	return directories;
}

async function readDirectoryNames(directory: string): Promise<string[]> {
	try {
		return (await readdir(directory)).sort(compareText);
	} catch {
		return [];
	}
}

async function isFile(candidate: string): Promise<boolean> {
	try {
		return (await stat(candidate)).isFile();
	} catch {
		return false;
	}
}

async function isDirectory(candidate: string): Promise<boolean> {
	try {
		return (await stat(candidate)).isDirectory();
	} catch {
		return false;
	}
}

function normalizeText(text: string): string {
	return text.replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "");
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
