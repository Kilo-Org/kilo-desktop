#!/usr/bin/env node
// Architectural boundaries that oxlint cannot express without dropping the
// shared no-restricted-imports config:
//  1. The kernel knows nothing about the product: no imports of product
//     packages, plugins or Electron.
//  2. No plugin ids below the plugin line: kernel code and the kernel boot
//     paths never name a plugin.
//  3. Plugins only reach other plugins through `./contracts` (or plugin.json),
//     and never import the apps — by package name or by a relative path that
//     leaves the plugin. Tests may also use a host plugin's `./testing`
//     fixture to boot it around the plugin under test.
// Specifiers come from import/export, import(), require() and vi.mock()-style
// calls, so a test cannot reach past a boundary by mocking it.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const SOURCE = /\.(?:ts|tsx|mts|cts|js|mjs)$/;
const TEST = /\.(?:test|spec)\.(?:ts|tsx)$|test-fixtures\.ts$|\/src\/test\//;
const SPECIFIERS = [
	/(?:import|export)\s[^'"`]*?from\s*["']([^"']+)["']/g,
	/import\(\s*["']([^"']+)["']\s*\)/g,
	/import\s*["']([^"']+)["']/g,
	/\brequire\(\s*["']([^"']+)["']\s*\)/g,
	/\bvi\.(?:mock|doMock|unmock|doUnmock|importActual|importMock)\(\s*["']([^"']+)["']/g,
];

/** Paths as forward-slash strings, so the patterns hold on Windows too. */
const toPosix = (file) => file.split(path.sep).join("/");
const isTest = (file) => TEST.test(toPosix(file));

function walk(dir) {
	const files = [];
	let entries;
	try {
		entries = readdirSync(dir);
	} catch {
		return files;
	}
	for (const entry of entries) {
		if (entry === "node_modules" || entry.startsWith(".")) continue;
		const full = path.join(dir, entry);
		if (statSync(full).isDirectory()) files.push(...walk(full));
		else if (SOURCE.test(entry)) files.push(full);
	}
	return files;
}

function importsOf(source) {
	return [
		...new Set(
			SPECIFIERS.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[1])),
		),
	];
}

const isInside = (dir, file) => {
	const relative = path.relative(dir, file);
	return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
};

const problems = [];
const report = (file, message) => problems.push(`${path.relative(root, file)}: ${message}`);

// 1. Kernel independence.
const KERNEL_FORBIDDEN = [
	/^electron(?:\/|$)/,
	/^@kilo-desktop\/(?:bundled-plugins|git-client|pane-layout)(?:\/|$)/,
	/^@kilo-desktop\/plugin-/,
];
for (const file of walk(path.join(root, "packages/kernel/src"))) {
	for (const specifier of importsOf(readFileSync(file, "utf8"))) {
		if (KERNEL_FORBIDDEN.some((pattern) => pattern.test(specifier))) {
			report(file, `the kernel must not import "${specifier}"`);
		}
	}
}

// 2. No plugin ids below the plugin line.
const BELOW_PLUGIN_LINE = [
	"packages/kernel/src",
	"apps/desktop/src/main/kernel",
	"apps/web/src/kernel",
	"apps/desktop/src/preload/preload.ts",
	"apps/desktop/src/preload/window-arguments.ts",
];
const PLUGIN_ID = /["'`](kilo\.[a-z][\w-]*)/;
for (const target of BELOW_PLUGIN_LINE) {
	const full = path.join(root, target);
	const files = SOURCE.test(full) ? [full] : walk(full);
	for (const file of files) {
		if (isTest(file)) continue;
		const match = PLUGIN_ID.exec(readFileSync(file, "utf8"));
		if (match) report(file, `names plugin "${match[1]}" below the plugin line`);
	}
}

// 3. Plugins (bundled and examples) reach each other only through contracts.
const pluginRoots = ["plugins", "examples"].flatMap((folder) => {
	const dir = path.join(root, folder);
	try {
		return readdirSync(dir).map((entry) => path.join(dir, entry));
	} catch {
		return [];
	}
});
// A folder without a package.json (a stray tool cache) is not a plugin.
const pluginDirs = pluginRoots.filter((pluginRoot) =>
	existsSync(path.join(pluginRoot, "package.json")),
);
const appsDir = path.join(root, "apps");
for (const pluginRoot of pluginDirs) {
	const own = JSON.parse(readFileSync(path.join(pluginRoot, "package.json"), "utf8")).name;
	for (const file of walk(path.join(pluginRoot, "src"))) {
		const allowed = isTest(file)
			? ["/contracts", "/plugin.json", "/testing"]
			: ["/contracts", "/plugin.json"];
		for (const specifier of importsOf(readFileSync(file, "utf8"))) {
			if (specifier.startsWith(".")) {
				const target = path.resolve(path.dirname(file), specifier);
				const other = pluginDirs.find((dir) => dir !== pluginRoot && isInside(dir, target));
				if (other) {
					report(
						file,
						`imports "${specifier}", inside ${toPosix(path.relative(root, other))}; plugins may only use another plugin's ./contracts`,
					);
				} else if (isInside(appsDir, target)) {
					report(file, `imports the app ("${specifier}")`);
				}
				continue;
			}
			const foreign = /^(@kilo-desktop\/plugin-[^/]+)(\/.*)?$/.exec(specifier);
			if (foreign && foreign[1] !== own && !allowed.includes(foreign[2] ?? "")) {
				report(file, `imports "${specifier}"; plugins may only use another plugin's ./contracts`);
			}
			if (/^@kilo-desktop\/(?:web|desktop)(?:\/|$)/.test(specifier)) {
				report(file, `imports the app ("${specifier}")`);
			}
		}
	}
}

if (problems.length > 0) {
	console.error(`Boundary check failed:\n  ${problems.join("\n  ")}`);
	process.exit(1);
}
console.log("Boundary check passed.");
