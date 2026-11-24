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
 * - main and windows run only the bytes that were hashed, held in memory:
 *   windows are served them from the app origin, and main's loader hooks
 *   (external-plugin-modules.ts) load a plugin's modules from them and refuse
 *   any other file — so nothing the digest skipped (`node_modules`, dot
 *   entries, symlinks) or wrote later can run under an approval.
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
	/**
	 * The `local-plugins` flag's last known value. Plugins load before the flag
	 * source answers, so launch decides from this; a change applies next launch.
	 */
	featureAvailable: boolean;
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
	/** The build's override of the `local-plugins` flag, which decides at launch ahead of the remembered value. */
	readonly featureOverride?: boolean;
	/** Asks the user, in the host's own UI, whether this plugin may run. */
	confirmApproval(request: ApprovalRequest): Promise<boolean>;
	readonly logger: {
		warn(message: string, ...details: unknown[]): void;
		error(message: string, ...details: unknown[]): void;
	};
	/**
	 * Runs before a plugin's modules are imported from `root`: main then loads
	 * them only from `files`, the approved bytes (external-plugin-modules.ts).
	 */
	readonly beforeImport?: (root: string, files: ReadonlyMap<string, Uint8Array>) => void;
	/** Loads an ES module by URL; tests inject it. */
	readonly importModule?: (url: string) => Promise<unknown>;
}

/**
 * The feature flag that gates local plugins as a whole. kilo.shell declares it
 * (and gates Settings → Plugins on it); the host only reads its value.
 */
export const LOCAL_PLUGINS_FLAG = "local-plugins";

/** Path prefix on the app origin under which loaded plugins' files are served. */
export const EXTERNAL_PLUGINS_PATH = "/external-plugins/";

const RESERVED_PUBLISHER = "kilo";
const MANIFEST_FILE = "plugin.json";
const MAX_FILES = 2_000;
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_DEPTH = 12;
const NODE_MODULES_HINT =
	"Its node_modules folder isn't loaded. Bundle its dependencies into its JavaScript.";
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
	readonly hint?: string;
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
	/** Plugin id → why its files (by digest) failed to load this launch. */
	#available: boolean;
	#failures = new Map<string, { readonly hash: string; readonly message: string }>();

	constructor(options: ExternalPluginsOptions) {
		this.#options = options;
		this.#available = options.featureOverride ?? options.store.get("featureAvailable") === true;
	}

	/**
	 * Records the `local-plugins` flag's value. While it is off nothing loads,
	 * nothing is scanned and `state()` is null; like every change here, it
	 * applies to loading from the next launch.
	 */
	setFeatureAvailable(available: boolean): void {
		if (this.#options.store.get("featureAvailable") !== available) {
			this.#options.store.set({ featureAvailable: available });
		}
		if (this.#available === available) return;
		this.#available = available;
		this.#notify();
	}

	/** At launch, before the kernels exist: scans and imports approved plugins, when local plugins are on. */
	async load(): Promise<void> {
		if (!this.#available) return;
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
				this.#failures.set(scanned.manifest.id, { hash: scanned.hash, message });
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

	state(): ExternalPluginsState | null {
		if (!this.#available) return null;
		const records = this.#scanned.map((scanned) => this.#record(scanned));
		const loadable = new Set(
			this.#enabled()
				? records
						// Files that failed this launch would fail again, so they don't call for a restart.
						.filter((record) => record.status === "ready" && record.approved)
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
		this.#requireAvailable();
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
		this.#requireAvailable();
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
		this.#requireAvailable();
		const { [pluginId]: _revoked, ...rest } = this.#approvals();
		this.#options.store.set({ approvals: rest });
		this.#notify();
	}

	async refresh(): Promise<void> {
		this.#requireAvailable();
		await mkdir(this.#options.directory, { recursive: true });
		await this.#scan();
		this.#notify();
	}

	#requireAvailable(): void {
		if (!this.#available) {
			throw new KernelError("UNAVAILABLE", "Local plugins are not available.");
		}
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
		// A failure belongs to the files that failed: a rebuilt plugin is judged afresh.
		const failed = manifest ? this.#failures.get(manifest.id) : undefined;
		const failure = failed && failed.hash === scanned.hash ? failed.message : undefined;
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
			...(scanned.hint ? { hint: scanned.hint } : {}),
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
		this.#options.beforeImport?.(scanned.root, scanned.files);
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

	const scan = await collectFiles(root);
	if (typeof scan === "string") return invalid(scan, manifest);
	const collected = scan.files;

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
	return {
		folder,
		root,
		manifest,
		hash: digest(collected),
		files: collected,
		...(scan.hasNodeModules ? { hint: NODE_MODULES_HINT } : {}),
	};
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
 * what isn't collected is neither approved nor loadable. Notes whether it
 * skipped a `node_modules`, so Settings can say to bundle instead.
 */
async function collectFiles(
	root: string,
): Promise<{ readonly files: Map<string, Uint8Array>; readonly hasNodeModules: boolean } | string> {
	const files = new Map<string, Uint8Array>();
	let bytes = 0;
	let hasNodeModules = false;
	const walk = async (relative: string, depth: number): Promise<string | undefined> => {
		if (depth > MAX_DEPTH) return "Its folders are nested too deeply.";
		const entries = await readdir(path.join(root, relative), { withFileTypes: true });
		for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
			if (entry.name === "node_modules") {
				hasNodeModules = true;
				continue;
			}
			if (entry.name.startsWith(".")) continue;
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
	return problem ?? { files, hasNodeModules };
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
