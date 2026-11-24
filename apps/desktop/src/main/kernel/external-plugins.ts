import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { satisfies, validRange } from "semver";

import {
	KernelError,
	manifestSchema,
	type ExternalPluginRecord,
	type ExternalPluginsState,
	type HostPermission,
	type KvStore,
	type PluginDefinitions,
	type PluginEntry,
	type PluginManifest,
	type PluginRegistration,
	type WindowExternalPlugin,
} from "@kilo-desktop/kernel";
import type { ExternalPluginsHost } from "@kilo-desktop/kernel/main";

/**
 * The user's local plugins: trusted code they wrote or chose, loaded from
 * `<userData>/local-plugins/<folder>/` into the packaged app (not `plugins/`,
 * which holds every plugin's data).
 *
 * Trust model (decision 76 in docs/plugin-architecture.md): a local plugin
 * runs with the app's privileges — its main entry in Electron main, its web
 * entry in every window's realm — exactly like a bundled plugin. Nothing
 * sandboxes it, so what keeps a stranger's code out is consent:
 * - local plugins are off until the user turns them on;
 * - each plugin is approved in a native dialog (the host's UI, not a window
 *   a plugin could draw in) for the digest of its files, so any change to
 *   them — a rebuild, or something else writing there — asks again;
 * - windows are served the bytes that were hashed (held in memory), not
 *   whatever is on disk later. Main imports from disk right after hashing,
 *   so only a write racing launch could slip past; anything that can do that
 *   can already change what the user runs.
 *
 * Everything applies from the next launch, as for turning bundled plugins on
 * or off: `load()` runs once before the kernels are created, and the rest of
 * the session only rescans and records approvals. A plugin is never
 * hot-swapped, so the main and window kernels always agree on the set.
 *
 * Validation here is what the host decides (where plugins live, which engine
 * and permissions it allows, ids it reserves); the kernel's discovery still
 * validates contracts and contributions like any plugin's.
 */

export interface ExternalPluginsSettings extends Record<string, unknown> {
	enabled: boolean;
	/** Plugin id → digest of the files the user approved. */
	approvals: Record<string, string>;
}

export interface ApprovalRequest {
	readonly id: string;
	readonly displayName: string;
	readonly version: string;
	readonly description?: string;
	/** Absolute path of its folder. */
	readonly folder: string;
	readonly hash: string;
}

export interface ExternalPluginsOptions {
	readonly directory: string;
	readonly store: KvStore<ExternalPluginsSettings>;
	/** Bundled plugin ids, which a local plugin may not take. */
	readonly reservedIds: ReadonlySet<string>;
	/** The kernel's plugin API version, checked against `engines["kilo-desktop"]`. */
	readonly apiVersion: string;
	/** Asks the user, in the host's own UI, whether this plugin may run. */
	confirmApproval(request: ApprovalRequest): Promise<boolean>;
	readonly logger: {
		warn(message: string, ...details: unknown[]): void;
		error(message: string, ...details: unknown[]): void;
	};
	/** Runs before a plugin's modules are imported from `root` (main shares its modules with them). */
	readonly beforeImport?: (root: string) => void;
	/** Loads an ES module by URL; tests inject it. */
	readonly importModule?: (url: string) => Promise<unknown>;
}

/** Path prefix on the app origin under which loaded plugins' files are served. */
export const EXTERNAL_PLUGINS_PATH = "/external-plugins/";

const RESERVED_PUBLISHER = "kilo";
const MANIFEST_FILE = "plugin.json";
const MAX_FILES = 2_000;
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_DEPTH = 12;
/** What main and windows can import as-is: built ES modules, not TypeScript or JSX source. */
const MODULE_EXTENSIONS = new Set([".js", ".mjs"]);
/** Host permissions a local plugin may hold; the rest govern the app itself or other plugins. */
const ALLOWED_HOST_PERMISSIONS: ReadonlySet<HostPermission> = new Set([
	"windows",
	"dialogs",
	"clipboard",
	"os",
	"notifications",
]);

interface ScannedPlugin {
	readonly folder: string;
	readonly root: string;
	readonly manifest?: PluginManifest;
	readonly hash?: string;
	readonly files?: ReadonlyMap<string, Uint8Array>;
	readonly error?: string;
}

interface LoadedPlugin {
	readonly scanned: ScannedPlugin & {
		readonly manifest: PluginManifest;
		readonly hash: string;
		readonly files: ReadonlyMap<string, Uint8Array>;
	};
	readonly definitions: PluginDefinitions;
	readonly entry?: PluginEntry;
}

const defaultImport = (url: string): Promise<unknown> => import(/* @vite-ignore */ url);

export function externalPluginUrl(pluginId: string, entryPath: string, hash: string): string {
	const relative = path.posix.normalize(entryPath.replaceAll("\\", "/")).replace(/^\.\//, "");
	return `${EXTERNAL_PLUGINS_PATH}${pluginId}/${relative}?v=${hash.slice(0, 12)}`;
}

export class ExternalPlugins implements ExternalPluginsHost {
	readonly #options: ExternalPluginsOptions;
	readonly #listeners = new Set<() => void>();
	#scanned: readonly ScannedPlugin[] = [];
	#loaded = new Map<string, LoadedPlugin>();
	#failures = new Map<string, string>();

	constructor(options: ExternalPluginsOptions) {
		this.#options = options;
	}

	/** At launch, before the kernels exist: scans and imports approved plugins, when local plugins are on. */
	async load(): Promise<void> {
		// Always there, so Settings can reveal it before local plugins are turned on.
		await mkdir(this.#options.directory, { recursive: true }).catch((error: unknown) =>
			this.#options.logger.warn("Couldn't create the local plugins directory", error),
		);
		if (!this.#enabled()) return;
		await this.#scan();
		for (const scanned of this.#scanned) {
			if (!isReady(scanned) || !this.#isApproved(scanned)) continue;
			try {
				// Sequential, in folder order, so a plugin's import never races another's.
				// react-doctor-disable-next-line react-doctor/async-await-in-loop
				this.#loaded.set(scanned.manifest.id, await this.#import(scanned));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				this.#failures.set(scanned.manifest.id, message);
				this.#options.logger.error(`Local plugin "${scanned.manifest.id}" failed to load`, error);
			}
		}
	}

	registrations(): PluginRegistration[] {
		return [...this.#loaded.values()].map(({ scanned, definitions, entry }) => ({
			manifest: scanned.manifest,
			definitions,
			source: "external" as const,
			...(entry ? { entry } : {}),
		}));
	}

	/** Loaded plugins with a window entry: the only local plugins a window may call main as. */
	webPluginIds(): string[] {
		return [...this.#loaded.values()]
			.filter(({ scanned }) => scanned.manifest.web !== undefined)
			.map(({ scanned }) => scanned.manifest.id);
	}

	/** Every loaded plugin, since a window's discovery must know them all, even main-only ones. */
	windowPlugins(): WindowExternalPlugin[] {
		return [...this.#loaded.values()].map(({ scanned: { manifest, hash } }) => ({
			manifest,
			...(manifest.contracts
				? { contracts: externalPluginUrl(manifest.id, manifest.contracts, hash) }
				: {}),
			...(manifest.web ? { web: externalPluginUrl(manifest.id, manifest.web, hash) } : {}),
		}));
	}

	/** A loaded plugin's file for a request path under {@link EXTERNAL_PLUGINS_PATH}, as approved. */
	file(pathname: string): { readonly body: Uint8Array; readonly filePath: string } | undefined {
		if (!pathname.startsWith(EXTERNAL_PLUGINS_PATH)) return undefined;
		let rest: string;
		try {
			rest = decodeURIComponent(pathname.slice(EXTERNAL_PLUGINS_PATH.length));
		} catch {
			return undefined;
		}
		const slash = rest.indexOf("/");
		if (slash < 0) return undefined;
		const loaded = this.#loaded.get(rest.slice(0, slash));
		const relative = rest.slice(slash + 1);
		// Keys are normalised relative paths, so `..` or a leading `/` never match one.
		const body = loaded?.scanned.files.get(relative);
		return body ? { body, filePath: relative } : undefined;
	}

	state(): ExternalPluginsState {
		const records = this.#scanned.map((scanned) => this.#record(scanned));
		const loadable = new Set(
			this.#enabled()
				? records
						.filter((record) => record.status !== "invalid" && record.approved)
						.map((record) => record.id)
				: [],
		);
		const loaded = new Set(this.#loaded.keys());
		return {
			enabled: this.#enabled(),
			directory: this.#options.directory,
			plugins: records,
			restartNeeded: loaded.size !== loadable.size || [...loaded].some((id) => !loadable.has(id)),
		};
	}

	onChange(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	setEnabled(enabled: boolean): void {
		this.#options.store.set({ enabled });
		this.#notify();
		// Lists what is already there.
		if (enabled) {
			this.refresh().catch((error: unknown) =>
				this.#options.logger.error("Couldn't scan the local plugins directory", error),
			);
		}
	}

	async approve(pluginId: string, hash: string): Promise<boolean> {
		const scanned = this.#scanned.find(
			(candidate) => candidate.manifest?.id === pluginId && !candidate.error,
		);
		if (!scanned?.manifest || !scanned.hash) {
			throw new KernelError("NOT_FOUND", `No local plugin "${pluginId}" can be approved.`);
		}
		if (scanned.hash !== hash) {
			throw new KernelError("CONFLICT", "The plugin's files changed. Refresh and review it again.");
		}
		const approved = await this.#options.confirmApproval({
			id: pluginId,
			displayName: scanned.manifest.displayName,
			version: scanned.manifest.version,
			...(scanned.manifest.description ? { description: scanned.manifest.description } : {}),
			folder: scanned.root,
			hash,
		});
		if (!approved) return false;
		this.#options.store.set({ approvals: { ...this.#approvals(), [pluginId]: hash } });
		this.#notify();
		return true;
	}

	revoke(pluginId: string): void {
		const { [pluginId]: _revoked, ...rest } = this.#approvals();
		this.#options.store.set({ approvals: rest });
		this.#notify();
	}

	async refresh(): Promise<void> {
		await mkdir(this.#options.directory, { recursive: true });
		await this.#scan();
		this.#notify();
	}

	#enabled(): boolean {
		return this.#options.store.get("enabled") === true;
	}

	#approvals(): Record<string, string> {
		const approvals: unknown = this.#options.store.get("approvals");
		return approvals && typeof approvals === "object" ? (approvals as Record<string, string>) : {};
	}

	#isApproved(scanned: ScannedPlugin): boolean {
		return (
			scanned.manifest !== undefined &&
			scanned.hash !== undefined &&
			this.#approvals()[scanned.manifest.id] === scanned.hash
		);
	}

	#record(scanned: ScannedPlugin): ExternalPluginRecord {
		const { manifest } = scanned;
		const failure = manifest ? this.#failures.get(manifest.id) : undefined;
		const message = scanned.error ?? failure;
		return {
			folder: scanned.folder,
			...(manifest
				? {
						id: manifest.id,
						displayName: manifest.displayName,
						version: manifest.version,
						...(manifest.description ? { description: manifest.description } : {}),
					}
				: {}),
			...(scanned.hash ? { hash: scanned.hash } : {}),
			status: scanned.error ? "invalid" : failure ? "failed" : "ready",
			...(message ? { message } : {}),
			approved: !scanned.error && this.#isApproved(scanned),
			loaded: manifest !== undefined && this.#loaded.has(manifest.id),
		};
	}

	async #scan(): Promise<void> {
		const scanned = await scanDirectory(this.#options);
		this.#scanned = rejectDuplicateIds(scanned);
	}

	async #import(scanned: LoadedPlugin["scanned"]): Promise<LoadedPlugin> {
		const importModule = this.#options.importModule ?? defaultImport;
		const urlOf = (entryPath: string) =>
			`${pathToFileURL(path.resolve(scanned.root, entryPath)).href}?v=${scanned.hash.slice(0, 12)}`;
		const { manifest } = scanned;
		this.#options.beforeImport?.(scanned.root);
		const definitions = manifest.contracts
			? definitionsOf(await importModule(urlOf(manifest.contracts)))
			: {};
		const entry = manifest.main ? entryOf(await importModule(urlOf(manifest.main))) : undefined;
		return { scanned, definitions, ...(entry ? { entry } : {}) };
	}

	#notify(): void {
		for (const listener of [...this.#listeners]) listener();
	}
}

function isReady(scanned: ScannedPlugin): scanned is LoadedPlugin["scanned"] {
	return !scanned.error && !!scanned.manifest && !!scanned.hash && !!scanned.files;
}

function definitionsOf(module: unknown): PluginDefinitions {
	const exports = module as { definitions?: unknown; default?: unknown } | null;
	const definitions = exports?.definitions ?? exports?.default;
	if (definitions === undefined) return {};
	if (typeof definitions !== "object" || definitions === null) {
		throw new Error("Its contracts module must export `definitions`.");
	}
	return definitions as PluginDefinitions;
}

function entryOf(module: unknown): PluginEntry {
	const entry = (module as { default?: unknown } | null)?.default;
	if (typeof (entry as PluginEntry | undefined)?.activate !== "function") {
		throw new Error("Its main entry must default-export a plugin entry with `activate`.");
	}
	return entry as PluginEntry;
}

function rejectDuplicateIds(scanned: readonly ScannedPlugin[]): ScannedPlugin[] {
	const folders = new Map<string, string[]>();
	for (const plugin of scanned) {
		if (plugin.error || !plugin.manifest) continue;
		folders.set(plugin.manifest.id, [...(folders.get(plugin.manifest.id) ?? []), plugin.folder]);
	}
	return scanned.map((plugin) => {
		const sharing = plugin.manifest && !plugin.error ? folders.get(plugin.manifest.id) : undefined;
		if (!sharing || sharing.length < 2) return plugin;
		const others = sharing.filter((folder) => folder !== plugin.folder).join(", ");
		return { ...plugin, error: `Another local plugin (${others}) has the same id.` };
	});
}

async function scanDirectory(
	options: Pick<ExternalPluginsOptions, "directory" | "reservedIds" | "apiVersion">,
): Promise<ScannedPlugin[]> {
	let entries: string[];
	try {
		entries = await readdir(options.directory);
	} catch {
		return [];
	}
	const folders = entries.filter((name) => !name.startsWith(".")).sort();
	const scanned = await Promise.all(
		folders.map(async (folder): Promise<ScannedPlugin | undefined> => {
			const location = path.join(options.directory, folder);
			try {
				if (!(await stat(location)).isDirectory()) return undefined;
				return await scanPlugin(folder, await realpath(location), options);
			} catch (error) {
				return { folder, root: location, error: `Couldn't read it: ${errorText(error)}` };
			}
		}),
	);
	return scanned.filter((plugin): plugin is ScannedPlugin => plugin !== undefined);
}

async function scanPlugin(
	folder: string,
	root: string,
	options: Pick<ExternalPluginsOptions, "reservedIds" | "apiVersion">,
): Promise<ScannedPlugin> {
	const invalid = (error: string, manifest?: PluginManifest): ScannedPlugin => ({
		folder,
		root,
		...(manifest ? { manifest } : {}),
		error,
	});

	let raw: string;
	try {
		raw = await readFile(path.join(root, MANIFEST_FILE), "utf8");
	} catch {
		return invalid(`No ${MANIFEST_FILE} in this folder.`);
	}
	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch (error) {
		return invalid(`Invalid ${MANIFEST_FILE}: ${errorText(error)}`);
	}
	const parsed = manifestSchema.safeParse(json);
	if (!parsed.success) {
		return invalid(
			`Invalid ${MANIFEST_FILE}: ${parsed.error.issues
				.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
				.join("; ")}`,
		);
	}
	const manifest = parsed.data;
	const problem = manifestProblem(manifest, options);
	if (problem) return invalid(problem, manifest);

	const source = [manifest.contracts, manifest.main, manifest.web].find(
		(entry) => entry !== undefined && !MODULE_EXTENSIONS.has(path.extname(entry).toLowerCase()),
	);
	if (source !== undefined) {
		return invalid(
			`Entry "${source}" isn't JavaScript. Build the plugin to ES modules (.js) and point plugin.json at them.`,
			manifest,
		);
	}

	const collected = await collectFiles(root);
	if (typeof collected === "string") return invalid(collected, manifest);

	const missing = [manifest.contracts, manifest.main, manifest.web].find(
		(entry) => entry !== undefined && !collected.has(normalizeEntry(entry) ?? ""),
	);
	if (missing !== undefined) {
		return invalid(
			normalizeEntry(missing) === undefined
				? `Entry "${missing}" is outside the plugin's folder.`
				: `Entry "${missing}" doesn't exist (build the plugin first?).`,
			manifest,
		);
	}
	return { folder, root, manifest, hash: digest(collected), files: collected };
}

function manifestProblem(
	manifest: PluginManifest,
	options: Pick<ExternalPluginsOptions, "reservedIds" | "apiVersion">,
): string | undefined {
	if (manifest.id.split(".")[0] === RESERVED_PUBLISHER || options.reservedIds.has(manifest.id)) {
		return `The id "${manifest.id}" is reserved for plugins that ship with the app.`;
	}
	const range = manifest.engines?.["kilo-desktop"];
	if (range === undefined) {
		return 'Its manifest must name the plugin API versions it supports in engines["kilo-desktop"] (e.g. "^1.0").';
	}
	if (validRange(range) === null || !satisfies(options.apiVersion, range)) {
		return `Needs plugin API ${range}; this app offers ${options.apiVersion}.`;
	}
	if (manifest.main === undefined && manifest.web === undefined) {
		return "Declares neither a main nor a web entry.";
	}
	const { permissions } = manifest;
	if (permissions?.protocols?.length || permissions?.embeddedHosts?.length) {
		return "Local plugins can't register URL schemes or embedded hosts.";
	}
	const withheld = (permissions?.host ?? []).filter(
		(permission) => !ALLOWED_HOST_PERMISSIONS.has(permission),
	);
	if (withheld.length > 0) {
		return `Local plugins can't hold the ${withheld.join(", ")} permission${withheld.length > 1 ? "s" : ""}.`;
	}
	return undefined;
}

/** A manifest entry path as a key of the collected files, or undefined when it leaves the folder. */
function normalizeEntry(entry: string): string | undefined {
	const normalized = path.posix.normalize(entry.replaceAll("\\", "/"));
	if (normalized.startsWith("../") || normalized === ".." || path.posix.isAbsolute(normalized)) {
		return undefined;
	}
	return normalized.replace(/^\.\//, "");
}

/**
 * Every file of a plugin by normalised relative path, skipping dot entries
 * (`.git`, `.DS_Store`) and `node_modules`: a plugin ships bundled code, and
 * what isn't collected is neither approved nor served.
 */
async function collectFiles(root: string): Promise<Map<string, Uint8Array> | string> {
	const files = new Map<string, Uint8Array>();
	let bytes = 0;
	const walk = async (relative: string, depth: number): Promise<string | undefined> => {
		if (depth > MAX_DEPTH) return "Its folders are nested too deeply.";
		const entries = await readdir(path.join(root, relative), { withFileTypes: true });
		for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
			if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
			const child = relative ? `${relative}/${entry.name}` : entry.name;
			if (entry.isDirectory()) {
				// Depth-first, in name order, so the digest is stable.
				// react-doctor-disable-next-line react-doctor/async-await-in-loop
				const problem = await walk(child, depth + 1);
				if (problem) return problem;
			} else if (entry.isFile()) {
				// react-doctor-disable-next-line react-doctor/async-await-in-loop
				const content = Uint8Array.from(await readFile(path.join(root, child)));
				bytes += content.byteLength;
				files.set(child, content);
				if (files.size > MAX_FILES || bytes > MAX_BYTES) {
					return `It's too large for a local plugin (over ${MAX_FILES} files or ${MAX_BYTES / 1024 / 1024} MB).`;
				}
			}
		}
		return undefined;
	};
	const problem = await walk("", 0);
	return problem ?? files;
}

function digest(files: ReadonlyMap<string, Uint8Array>): string {
	const hash = createHash("sha256");
	for (const [file, content] of [...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
		hash.update(`${file}\0${createHash("sha256").update(content).digest("hex")}\n`);
	}
	return hash.digest("hex");
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
