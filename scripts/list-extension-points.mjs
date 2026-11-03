#!/usr/bin/env node
// Prints the catalog of extension points in the kernel and the bundled
// plugins as a Markdown table (docs/plugins/extension-points.md), so the docs
// follow the code: owner and purpose from each manifest, the kind and the
// process implementations bind in from the point's definition in the owner's
// contracts, contributors from every manifest's `contributes.extensions`
// (runtime-only contributions are not listed).
//
// Usage: node scripts/list-extension-points.mjs [--write | --check]
//   --write  replace the table between the catalog markers in the doc (then oxfmt it)
//   --check  fail when the doc's table is out of date (`pnpm lint` runs this)
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { tsImport } from "tsx/esm/api";

const root = path.resolve(import.meta.dirname, "..");
const DOC = path.join(root, "docs/plugins/extension-points.md");
const START = "<!-- catalog:start (pnpm docs:extension-points) -->";
const END = "<!-- catalog:end -->";
const KIND = { additive: "A", exclusive: "X", decision: "D" };

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

// pnpm and node_modules/.bin tools are .cmd shims on Windows, which Node only
// runs through a shell; the shell joins arguments unquoted, so quote them.
const SHELL = process.platform === "win32";
const shellArgs = (args) =>
	SHELL ? args.map((arg) => (/[\s"&|<>^]/.test(arg) ? `"${arg}"` : arg)) : args;

/** Bundled plugins in plugin-list order: { dir, manifest, contracts module path }. */
function bundledPlugins() {
	const names = Object.keys(
		readJson(path.join(root, "packages/bundled-plugins/package.json")).dependencies,
	).filter((name) => name.startsWith("@kilo-desktop/plugin-"));
	const byName = new Map(
		readdirSync(path.join(root, "plugins")).flatMap((folder) => {
			const dir = path.join(root, "plugins", folder);
			try {
				return [[readJson(path.join(dir, "package.json")).name, dir]];
			} catch {
				return [];
			}
		}),
	);
	return names.map((name) => {
		const dir = byName.get(name);
		const pkg = readJson(path.join(dir, "package.json"));
		return {
			manifest: readJson(path.join(dir, "plugin.json")),
			contracts: path.join(dir, pkg.exports["./contracts"]),
		};
	});
}

const isPoint = (value) =>
	typeof value === "object" &&
	value !== null &&
	typeof value.id === "string" &&
	value.kind in KIND &&
	"metadata" in value;

const short = (pluginId) => pluginId.replace(/^kilo\./, "");

/** Where implementations bind; "data" for points whose entries carry no code. */
const processOf = (point) => point?.implementation?.process ?? "data";

async function catalog() {
	const plugins = bundledPlugins();
	const contributors = new Map();
	for (const { manifest } of plugins) {
		for (const point of Object.keys(manifest.contributes?.extensions ?? {})) {
			if (!contributors.has(point)) contributors.set(point, new Set());
			contributors.get(point).add(short(manifest.id));
		}
	}

	const rows = [];
	const kernel = await tsImport("@kilo-desktop/kernel", import.meta.url);
	for (const point of kernel.KERNEL_POINTS) {
		rows.push({ owner: "kernel", point, purpose: point.description ?? "" });
	}
	for (const { manifest, contracts } of plugins) {
		const declared = manifest.extensionPoints ?? [];
		if (declared.length === 0) continue;
		const exported = Object.values(await tsImport(contracts, import.meta.url)).filter(isPoint);
		for (const entry of declared) {
			const id = `${manifest.id}/${entry.id}`;
			const point = exported.find((candidate) => candidate.id === id);
			if (!point) throw new Error(`${manifest.id}'s contracts do not export the point "${id}".`);
			rows.push({ owner: manifest.id, point, purpose: entry.description ?? point.description });
		}
	}

	const lines = [
		"| Extension point | Owner | Kind | Process | Purpose | Contributors (manifests) |",
		"| --- | --- | --- | --- | --- | --- |",
		...rows.map(({ owner, point, purpose }) => {
			const by = [...(contributors.get(point.id) ?? [])].sort().join(", ") || "—";
			const cells = [`\`${point.id}\``, owner, KIND[point.kind], processOf(point), purpose, by];
			return `| ${cells.map((cell) => String(cell).replaceAll("|", "\\|")).join(" | ")} |`;
		}),
	];
	return lines.join("\n");
}

function catalogRegion(doc) {
	const start = doc.indexOf(START);
	const end = doc.indexOf(END);
	if (start < 0 || end < start) throw new Error(`${DOC} has no catalog markers.`);
	return {
		before: doc.slice(0, start + START.length),
		table: doc.slice(start + START.length, end),
		after: doc.slice(end),
	};
}

/** A table without the column padding oxfmt adds, so formatting never reads as a change. */
function normalize(table) {
	return table
		.trim()
		.split("\n")
		.map((row) =>
			row
				.split(/(?<!\\)\|/)
				.map((cell) => cell.trim().replace(/^:?-+:?$/, "---"))
				.join("|"),
		)
		.join("\n");
}

const table = await catalog();
const mode = process.argv[2];
if (mode === "--write" || mode === "--check") {
	const doc = readFileSync(DOC, "utf8");
	const region = catalogRegion(doc);
	if (mode === "--write") {
		writeFileSync(DOC, `${region.before}\n\n${table}\n\n${region.after}`);
		const [oxfmt, doc] = shellArgs([path.join(root, "node_modules/.bin/oxfmt"), DOC]);
		execFileSync(oxfmt, [doc], { cwd: root, shell: SHELL });
		console.log(`Updated the catalog in ${path.relative(root, DOC)}.`);
	} else if (normalize(region.table) !== normalize(table)) {
		console.error(
			`${path.relative(root, DOC)} is out of date: run \`pnpm docs:extension-points\`.`,
		);
		process.exit(1);
	} else {
		console.log("The extension point catalog is up to date.");
	}
} else {
	console.log(table);
}
