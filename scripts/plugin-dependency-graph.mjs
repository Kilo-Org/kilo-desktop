#!/usr/bin/env node
// Regenerates the data in docs/plugins/dependency-graph.html from every
// plugins/*/plugin.json: one link per (plugin, required plugin) pair, weighted
// by how many of that plugin's domains / extension points it requires. All
// kernel/* requires collapse into a single "kernel" node. Tiers and styling
// stay hand-written in the page; a new plugin lands in the "feature" tier.
//
// Usage: node scripts/plugin-dependency-graph.mjs   (pnpm docs:plugin-graph)
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const PAGE = path.join(root, "docs/plugins/dependency-graph.html");
const START = "// links:start (pnpm docs:plugin-graph)";
const END = "// links:end";

const short = (id) => id.replace(/^kilo\./, "");

function manifests() {
	const pluginsDir = path.join(root, "plugins");
	if (!existsSync(pluginsDir)) return [];
	return readdirSync(pluginsDir).flatMap((folder) => {
		try {
			return [JSON.parse(readFileSync(path.join(root, "plugins", folder, "plugin.json"), "utf8"))];
		} catch {
			return [];
		}
	});
}

/** [[source, target, points]] sorted by source then target. */
function links() {
	const counts = new Map();
	for (const manifest of manifests()) {
		const source = short(manifest.id);
		for (const required of Object.keys(manifest.requires ?? {})) {
			const target = required.startsWith("kernel/") ? "kernel" : short(required.split("/")[0]);
			if (target === source) continue;
			const key = `${source}\0${target}`;
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
	}
	return [...counts]
		.map(([key, points]) => [...key.split("\0"), points])
		.sort(([a, b], [c, d]) => a.localeCompare(c) || b.localeCompare(d));
}

function render(rows) {
	const bySource = Map.groupBy(rows, ([source]) => source);
	const lines = [...bySource.values()].map(
		(group) => `\t${group.map((row) => JSON.stringify(row)).join(", ")},`,
	);
	return `const links = [\n${lines.join("\n")}\n]`;
}

const page = readFileSync(PAGE, "utf8");
const start = page.indexOf(START);
const end = page.indexOf(END);
if (start < 0 || end < start) throw new Error(`${PAGE} has no links markers.`);

const rows = links();
writeFileSync(PAGE, `${page.slice(0, start + START.length)}\n${render(rows)}\n${page.slice(end)}`);
// pnpm and node_modules/.bin tools are .cmd shims on Windows, which Node only runs through a shell
const windows = process.platform === "win32";
const quote = (arg) => (windows && /\s/.test(arg) ? `"${arg}"` : arg);
execFileSync(quote(path.join(root, "node_modules/.bin/oxfmt")), [quote(PAGE)], {
	cwd: root,
	shell: windows,
});
console.log(`Updated ${path.relative(root, PAGE)}: ${rows.length} links.`);
