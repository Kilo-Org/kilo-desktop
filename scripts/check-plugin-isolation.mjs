#!/usr/bin/env node
// Proves bundled plugins build outside the monorepo (docs/plugins/testing.md),
// i.e. they only lean on what their package.json declares and on
// published-shape packages: @kilo-desktop/kernel, @kilo-desktop/ui, other
// plugins' exports, and the few private libraries listed below.
//
// For every bundled plugin (the plugin-* dependencies of packages/bundled-plugins)
// and every example plugin (examples/*, never bundled):
//  1. plugin.json passes the kernel's manifest schema; package.json exports
//     `./plugin.json` and `./contracts`, and every export target exists.
//  2. Every bare import in src/ is declared: dependencies or peerDependencies
//     for shipped code, devDependencies too for tests, `./testing` and
//     build tooling (packaging scripts, vite configs).
//  3. Every import into a workspace package names one of its exports, and
//     workspace dependencies are published-shape.
// Then, for the plugins given to --build (default: the representative
// kilo.workspace-board, a third-party-style plugin, and the example plugins authors
// copy; CI passes `all`), `pnpm deploy`
// copies the plugin with its locked dependencies (workspace packages copied
// as they would be packed) into a temporary folder outside the workspace, and
// its sources, tests included, are type-checked there with its own TypeScript.
//
// Usage: node scripts/check-plugin-isolation.mjs [--build workspace-board,hello-plugin | all | none]
import { execFile, execFileSync } from "node:child_process";
import {
	existsSync,
	lstatSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { builtinModules } from "node:module";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { tsImport } from "tsx/esm/api";

const root = path.resolve(import.meta.dirname, "..");
const REPRESENTATIVE = ["workspace-board"];
const EXAMPLES_DIR = path.join(root, "examples");
const SOURCE = /\.(?:ts|tsx|mts|cts|js|mjs)$/;
/** Tests, the `./testing` fixture and build tooling may use devDependencies. */
const DEV_ONLY =
	/\.(?:test|spec)\.tsx?$|[\\/]test-[\w-]+\.tsx?$|[\\/]src[\\/](?:test|testing|packaging)[\\/]|vite\.config\.ts$/;
const IMPORT =
	/^\s*(?:import|export)\s+(?:type\s+)?(?:[\w$*{}\s,]+?\s+from\s+)?["']([^"'\n]+)["']|\bimport\(\s*["']([^"'\n]+)["']\s*\)/gm;
const PUBLISHED_SHAPE = /^@kilo-desktop\/(?:kernel|ui|plugin-[\w-]+)$/;
/** Workspace libraries that one plugin owns; its deploy carries them. */
const PRIVATE_LIBRARIES = {
	"@kilo-desktop/git-client": "@kilo-desktop/plugin-git",
	"@kilo-desktop/pane-layout": "@kilo-desktop/plugin-work-sessions",
	"@opencode-ai/sdk": "@kilo-desktop/plugin-chat",
};
const BUILTINS = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

// pnpm and node_modules/.bin tools are .cmd shims on Windows, which Node only
// runs through a shell; the shell joins arguments unquoted, so quote them.
const SHELL = process.platform === "win32";
const shellArgs = (args) =>
	SHELL ? args.map((arg) => (/[\s"&|<>^]/.test(arg) ? `"${arg}"` : arg)) : args;

const execFileAsync = promisify(execFile);
const run = (command, args, options) =>
	execFileAsync(command, args, { maxBuffer: 64 * 1024 * 1024, ...options });
/** Runs pnpm, through the shell on Windows (see SHELL). */
const runPnpm = (args, options) => run("pnpm", shellArgs(args), { ...options, shell: SHELL });
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

function walk(dir) {
	if (!existsSync(dir)) return [];
	return readdirSync(dir).flatMap((entry) => {
		if (entry === "node_modules" || entry.startsWith(".")) return [];
		const full = path.join(dir, entry);
		if (statSync(full).isDirectory()) return walk(full);
		return SOURCE.test(entry) ? [full] : [];
	});
}

/** Workspace packages by name → folder, from pnpm itself. */
function workspacePackages() {
	const listed = JSON.parse(
		execFileSync("pnpm", shellArgs(["ls", "-r", "--depth", "-1", "--json"]), {
			cwd: root,
			encoding: "utf8",
			shell: SHELL,
		}),
	);
	return new Map(listed.filter((pkg) => pkg.name).map((pkg) => [pkg.name, pkg.path]));
}

function packageNameOf(specifier) {
	const parts = specifier.split("/");
	return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/** The target of `subpath` ("." or "./x") in an exports map, honouring one `*`. */
function resolveExport(exports, subpath) {
	if (!exports) return undefined;
	if (typeof exports === "string") return subpath === "." ? exports : undefined;
	if (exports[subpath] !== undefined) return exports[subpath];
	for (const [key, target] of Object.entries(exports)) {
		const star = key.indexOf("*");
		if (star < 0 || typeof target !== "string") continue;
		const [prefix, suffix] = [key.slice(0, star), key.slice(star + 1)];
		if (subpath.startsWith(prefix) && subpath.endsWith(suffix)) {
			return target.replace("*", subpath.slice(prefix.length, subpath.length - suffix.length));
		}
	}
	return undefined;
}

const targetPath = (target) =>
	typeof target === "string" ? target : (target?.import ?? target?.default ?? target?.types);

async function checkStatically(plugins, workspace) {
	const { manifestSchema } = await tsImport("@kilo-desktop/kernel", import.meta.url);
	const problems = [];
	for (const [name, dir] of plugins) {
		const report = (message) => problems.push(`${path.relative(root, dir)}: ${message}`);
		const pkg = readJson(path.join(dir, "package.json"));

		const manifestFile = path.join(dir, "plugin.json");
		if (!existsSync(manifestFile)) report("has no plugin.json");
		else {
			const parsed = manifestSchema.safeParse(readJson(manifestFile));
			if (!parsed.success) report(`plugin.json is invalid: ${parsed.error.message}`);
		}
		for (const required of ["./plugin.json", "./contracts"]) {
			if (!pkg.exports?.[required]) report(`package.json does not export "${required}"`);
		}
		for (const [key, target] of Object.entries(pkg.exports ?? {})) {
			if (key.includes("*")) continue;
			const file = targetPath(target);
			if (!file || !existsSync(path.join(dir, file)))
				report(`export "${key}" → "${file}" does not exist`);
		}

		const runtime = { ...pkg.dependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies };
		const everything = { ...runtime, ...pkg.devDependencies };
		for (const [dep, version] of Object.entries(runtime)) {
			if (!String(version).startsWith("workspace:")) continue;
			if (PUBLISHED_SHAPE.test(dep) || PRIVATE_LIBRARIES[dep] === name) continue;
			report(`depends on the workspace package "${dep}", which is not published-shape`);
		}

		for (const file of walk(path.join(dir, "src"))) {
			const declared = DEV_ONLY.test(file) ? everything : runtime;
			const source = readFileSync(file, "utf8");
			for (const match of source.matchAll(IMPORT)) {
				const specifier = (match[1] ?? match[2]).split("?")[0];
				if (specifier.startsWith(".") || specifier.startsWith("/") || BUILTINS.has(specifier))
					continue;
				if (specifier.startsWith("virtual:")) continue;
				const dependency = packageNameOf(specifier);
				const where = path.relative(dir, file);
				if (dependency === name) continue;
				if (!(dependency in declared)) {
					report(`${where} imports "${specifier}" but "${dependency}" is not declared`);
					continue;
				}
				const depDir = workspace.get(dependency);
				if (!depDir) continue;
				const exports = readJson(path.join(depDir, "package.json")).exports;
				const target = targetPath(resolveExport(exports, `.${specifier.slice(dependency.length)}`));
				if (!target) {
					report(`${where} imports "${specifier}", which "${dependency}" does not export`);
				} else if (!existsSync(path.join(depDir, target))) {
					report(`${where} imports "${specifier}" → "${target}", which does not exist`);
				}
			}
		}
	}
	return problems;
}

/** Copies the plugin and its locked dependencies outside the workspace and type-checks it there. */
async function buildOutside(name, dir) {
	const temp = mkdtempSync(path.join(os.tmpdir(), "kilo-plugin-isolation-"));
	const target = path.join(temp, path.basename(dir));
	const started = Date.now();
	try {
		await runPnpm(
			[
				"--config.allowUnusedPatches=true",
				"--filter",
				name,
				"deploy",
				"--ignore-scripts",
				"--offline",
				"--frozen-lockfile",
				target,
			],
			{
				cwd: root,
				// See apps/desktop/forge.config.ts: deploy's offline re-verification needs metadata only online installs fetch.
				env: { ...process.env, HUSKY: "0", PNPM_CONFIG_TRUST_LOCKFILE: "true" },
			},
		);
		const scoped = path.join(target, "node_modules", "@kilo-desktop");
		for (const entry of existsSync(scoped) ? readdirSync(scoped) : []) {
			if (lstatSync(path.join(scoped, entry)).isSymbolicLink()) {
				throw new Error(`@kilo-desktop/${entry} is linked into the workspace, not copied`);
			}
		}
		const base = readJson(path.join(root, "tsconfig.base.json")).compilerOptions;
		const own = readJson(path.join(dir, "tsconfig.json")).compilerOptions ?? {};
		writeFileSync(
			path.join(target, "tsconfig.isolation.json"),
			JSON.stringify({
				compilerOptions: { ...base, ...own, incremental: false, noEmit: true },
				include: ["src/**/*.ts", "src/**/*.tsx"],
			}),
		);
		const tsc = path.join(target, "node_modules", "typescript", "bin", "tsc");
		if (!existsSync(tsc)) throw new Error("it declares no typescript devDependency");
		await run(process.execPath, [tsc, "-p", "tsconfig.isolation.json"], { cwd: target });
		console.log(
			`  ${name}: built outside the workspace in ${((Date.now() - started) / 1000).toFixed(1)} s`,
		);
		return undefined;
	} catch (error) {
		const output = [error.stdout, error.stderr].filter(Boolean).join("\n").trim();
		return `${name} does not build outside the workspace: ${output || error.message}`;
	} finally {
		rmSync(temp, { recursive: true, force: true, maxRetries: 5 });
	}
}

/** Runs `tasks` with at most `limit` in flight. */
async function inPool(tasks, limit) {
	const results = [];
	const queue = [...tasks];
	await Promise.all(
		Array.from({ length: Math.min(limit, queue.length) }, async () => {
			while (queue.length > 0) results.push(await queue.shift()());
		}),
	);
	return results;
}

function buildSelection(plugins, examples) {
	const flag = process.argv.indexOf("--build");
	const value = flag >= 0 ? process.argv[flag + 1] : undefined;
	if (value === "none") return [];
	const all = [...plugins, ...examples];
	if (value === "all") return all;
	if (!value) {
		// Representatives that are not bundled are skipped.
		const representatives = REPRESENTATIVE.flatMap((folder) => {
			const found = all.find(([, dir]) => path.basename(dir) === folder);
			if (!found) console.log(`  ${folder}: not bundled, skipping its build`);
			return found ? [found] : [];
		});
		return [...representatives, ...examples];
	}
	return value.split(",").map((folder) => {
		const found = all.find(([, dir]) => path.basename(dir) === folder);
		if (!found) throw new Error(`No bundled or example plugin in a folder named ${folder}.`);
		return found;
	});
}

const workspace = workspacePackages();
const bundled = Object.keys(
	readJson(path.join(root, "packages/bundled-plugins/package.json")).dependencies ?? {},
)
	.filter((name) => name.startsWith("@kilo-desktop/plugin-"))
	.map((name) => [name, workspace.get(name)]);
const missing = bundled.filter(([, dir]) => !dir);
if (missing.length > 0)
	throw new Error(`Not in the workspace: ${missing.map(([name]) => name).join(", ")}`);

const examples = [...workspace].filter(([, dir]) => path.dirname(dir) === EXAMPLES_DIR);

const problems = await checkStatically([...bundled, ...examples], workspace);
console.log(
	`Checked ${bundled.length} bundled and ${examples.length} example plugins' manifests, exports and imports.`,
);
const jobs = Math.max(1, Math.min(4, Math.floor(os.availableParallelism() / 2)));
const selected = buildSelection(bundled, examples);
if (selected.length === 0) console.log("No plugins to build outside the workspace.");
const builds = await inPool(
	selected.map(
		([name, dir]) =>
			() =>
				buildOutside(name, dir),
	),
	jobs,
);
problems.push(...builds.filter(Boolean));

if (problems.length > 0) {
	console.error(`Plugin isolation check failed:\n  ${problems.join("\n  ")}`);
	process.exit(1);
}
console.log("Plugin isolation check passed.");
