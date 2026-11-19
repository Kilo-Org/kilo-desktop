#!/usr/bin/env node
// Prints the plugin schema of the kernel and the bundled plugins as Markdown
// (docs/plugins/schema.md), so the docs follow the code: every plugin, extension
// point, domain object, object type and context key. Owners, purposes, homes and
// scopes come from each manifest; kinds, processes, methods, events and lookups
// from the definitions in the owner's contracts; contributors and dependents
// from every manifest's `contributes.extensions` and `requires` (runtime-only
// contributions are not listed).
//
// Usage: node scripts/plugin-schema.mjs [--write | --check]
//   --write  replace the generated region of the doc (then oxfmt it)
//   --check  fail when the doc is out of date (`pnpm lint` runs this)
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { tsImport } from "tsx/esm/api";

const root = path.resolve(import.meta.dirname, "..");
const DOC = path.join(root, "docs/plugins/schema.md");
const START = "<!-- schema:start (pnpm docs:schema) -->";
const END = "<!-- schema:end -->";
const KIND = { additive: "A", exclusive: "X", decision: "D" };

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

// pnpm and node_modules/.bin tools are .cmd shims on Windows, which Node only
// runs through a shell; the shell joins arguments unquoted, so quote them.
const SHELL = process.platform === "win32";
const shellArgs = (args) =>
	SHELL ? args.map((arg) => (/[\s"&|<>^]/.test(arg) ? `"${arg}"` : arg)) : args;

/** Bundled plugins in plugin-list order: { folder, manifest, contracts module path }. */
function bundledPlugins() {
	const names = Object.keys(
		readJson(path.join(root, "packages/bundled-plugins/package.json")).dependencies ?? {},
	).filter((name) => name.startsWith("@kilo-desktop/plugin-"));
	const pluginsDir = path.join(root, "plugins");
	const byName = new Map(
		(existsSync(pluginsDir) ? readdirSync(pluginsDir) : []).flatMap((folder) => {
			try {
				return [[readJson(path.join(pluginsDir, folder, "package.json")).name, folder]];
			} catch {
				return [];
			}
		}),
	);
	return names.map((name) => {
		const folder = byName.get(name);
		const dir = path.join(pluginsDir, folder);
		const pkg = readJson(path.join(dir, "package.json"));
		return {
			folder,
			manifest: readJson(path.join(dir, "plugin.json")),
			contracts: path.join(dir, pkg.exports["./contracts"]),
		};
	});
}

const isObject = (value) => typeof value === "object" && value !== null;
const isPoint = (value) =>
	isObject(value) && typeof value.id === "string" && value.kind in KIND && "metadata" in value;
const isDomainObject = (value) =>
	isObject(value) &&
	typeof value.id === "string" &&
	(value.home === "main" || value.home === "renderer") &&
	isObject(value.methods) &&
	isObject(value.events);

const short = (pluginId) => pluginId.replace(/^kilo\./, "");
const ownerOf = (id) => id.slice(0, id.indexOf("/"));
const code = (text) => `\`${text}\``;
const list = (values) => [...values].sort().join(", ") || "—";

/** Where implementations bind; "data" for points whose entries carry no code. */
const processOf = (point) => point?.implementation?.process ?? "data";

function find(exported, id, what, owner) {
	const found = exported.find((candidate) => candidate.id === id);
	if (!found) throw new Error(`${owner}'s contracts do not export the ${what} "${id}".`);
	return found;
}

function table(header, rows) {
	const escape = (cell) => String(cell).replaceAll("|", "\\|").replaceAll("\n", " ");
	return [
		`| ${header.join(" | ")} |`,
		`| ${header.map(() => "---").join(" | ")} |`,
		...rows.map((row) => `| ${row.map(escape).join(" | ")} |`),
	].join("\n");
}

async function schema() {
	const plugins = bundledPlugins();
	const kernel = await tsImport("@kilo-desktop/kernel", import.meta.url);

	const contributors = new Map();
	const dependents = new Map();
	const add = (map, key, value) => {
		if (!map.has(key)) map.set(key, new Set());
		map.get(key).add(value);
	};
	for (const { manifest } of plugins) {
		for (const point of Object.keys(manifest.contributes?.extensions ?? {})) {
			add(contributors, point, short(manifest.id));
		}
		for (const id of Object.keys(manifest.requires ?? {})) add(dependents, id, short(manifest.id));
	}

	const points = kernel.KERNEL_DEFINITIONS.extensionPoints.map((point) => ({
		owner: "kernel",
		point,
		purpose: point.description ?? "",
	}));
	const domainObjects = kernel.KERNEL_DEFINITIONS.domainObjects.map((domainObject) => ({
		owner: "kernel",
		domainObject,
		purpose: domainObject.description ?? "",
	}));
	const objectTypes = kernel.KERNEL_DEFINITIONS.objectTypes.map((objectType) => ({
		owner: "kernel",
		id: objectType.id,
		purpose: objectType.description ?? "",
	}));
	const contextKeys = kernel.KERNEL_CONTEXT_KEYS.map((key) => ({
		owner: "kernel",
		id: key.id,
		scope: key.scope,
		purpose: key.description ?? "",
	}));

	for (const { manifest, contracts } of plugins) {
		const exported = Object.values(await tsImport(pathToFileURL(contracts).href, import.meta.url));
		for (const entry of manifest.extensionPoints ?? []) {
			const id = `${manifest.id}/${entry.id}`;
			const point = find(exported.filter(isPoint), id, "extension point", manifest.id);
			points.push({ owner: manifest.id, point, purpose: entry.description ?? point.description });
		}
		for (const entry of manifest.domainObjects ?? []) {
			const id = `${manifest.id}/${entry.id}`;
			const domainObject = find(exported.filter(isDomainObject), id, "domain object", manifest.id);
			domainObjects.push({
				owner: manifest.id,
				domainObject,
				purpose: entry.description ?? domainObject.description,
			});
		}
		for (const entry of manifest.objectTypes ?? []) {
			objectTypes.push({
				owner: manifest.id,
				id: `${manifest.id}/${entry.id}`,
				purpose: entry.description ?? "",
			});
		}
		for (const entry of manifest.contextKeys ?? []) {
			contextKeys.push({
				owner: manifest.id,
				id: `${manifest.id}/${entry.id}`,
				scope: entry.scope ?? "global",
				purpose: entry.description ?? "",
			});
		}
	}

	const resolvedBy = new Map(
		domainObjects
			.filter(({ domainObject }) => domainObject.objectType)
			.map(({ domainObject }) => [domainObject.objectType.id, domainObject.id]),
	);

	const sections = [
		"## Plugins",
		table(
			["Plugin", "Folder", "What it is", "Runs when", "Requires (plugins)"],
			plugins.map(({ folder, manifest }) => [
				code(manifest.id),
				code(`plugins/${folder}`),
				manifest.description ?? "",
				manifest.when ? code(JSON.stringify(manifest.when)) : "always",
				list(
					new Set(
						Object.keys(manifest.requires ?? {})
							.map(ownerOf)
							.filter((owner) => owner !== manifest.id && owner !== "kernel")
							.map(short),
					),
				),
			]),
		),
		"## Extension points",
		"Kinds: **A** additive, **X** exclusive, **D** decision. Process: where implementations bind (`data` takes manifest entries only).",
		table(
			["Extension point", "Owner", "Kind", "Process", "Purpose", "Contributors (manifests)"],
			points.map(({ owner, point, purpose }) => [
				code(point.id),
				owner,
				KIND[point.kind],
				processOf(point),
				purpose,
				list(contributors.get(point.id) ?? []),
			]),
		),
		"## Domain objects",
		"Home: the process that provides it (`renderer` objects are per window). A collection names the object type it resolves.",
		table(
			[
				"Domain object",
				"Owner",
				"Home",
				"Collection of",
				"Purpose",
				"Methods",
				"Events",
				"Required by",
			],
			domainObjects.map(({ owner, domainObject, purpose }) => [
				code(domainObject.id),
				owner,
				domainObject.home,
				domainObject.objectType ? code(domainObject.objectType.id) : "—",
				purpose,
				Object.keys(domainObject.methods).map(code).join(", ") || "—",
				Object.keys(domainObject.events).map(code).join(", ") || "—",
				list(dependents.get(domainObject.id) ?? []),
			]),
		),
		"## Object types",
		table(
			["Object type", "Owner", "Resolved by", "Purpose"],
			objectTypes.map(({ owner, id, purpose }) => [
				code(id),
				owner,
				resolvedBy.has(id) ? code(resolvedBy.get(id)) : "— (no collection)",
				purpose,
			]),
		),
		"## Context keys",
		"Scope: `global` keys hold one value app-wide; `window` keys hold one per window.",
		table(
			["Context key", "Owner", "Scope", "Purpose"],
			contextKeys.map(({ owner, id, scope, purpose }) => [code(id), owner, scope, purpose]),
		),
	];
	return sections.join("\n\n");
}

function generatedRegion(doc) {
	const start = doc.indexOf(START);
	const end = doc.indexOf(END);
	if (start < 0 || end < start) throw new Error(`${DOC} has no schema markers.`);
	return {
		before: doc.slice(0, start + START.length),
		body: doc.slice(start + START.length, end),
		after: doc.slice(end),
	};
}

/** The region without the padding and blank lines oxfmt adds, so formatting never reads as a change. */
function normalize(markdown) {
	return markdown
		.split("\n")
		.map((line) =>
			line.trimStart().startsWith("|")
				? line
						.trim()
						.split(/(?<!\\)\|/)
						.map((cell) => cell.trim().replace(/^:?-+:?$/, "---"))
						.join("|")
				: line.trim(),
		)
		.filter((line) => line !== "")
		.join("\n");
}

const body = await schema();
const mode = process.argv[2];
if (mode === "--write" || mode === "--check") {
	const doc = readFileSync(DOC, "utf8");
	const region = generatedRegion(doc);
	if (mode === "--write") {
		writeFileSync(DOC, `${region.before}\n\n${body}\n\n${region.after}`);
		const [oxfmt, file] = shellArgs([path.join(root, "node_modules/.bin/oxfmt"), DOC]);
		execFileSync(oxfmt, [file], { cwd: root, shell: SHELL });
		console.log(`Updated ${path.relative(root, DOC)}.`);
	} else if (normalize(region.body) !== normalize(body)) {
		console.error(`${path.relative(root, DOC)} is out of date: run \`pnpm docs:schema\`.`);
		process.exit(1);
	} else {
		console.log("The plugin schema doc is up to date.");
	}
} else {
	console.log(body);
}
