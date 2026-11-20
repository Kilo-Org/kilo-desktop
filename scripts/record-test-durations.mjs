/**
 * Refresh the recorded durations CI shards are balanced by.
 *
 *   node scripts/record-test-durations.mjs e2e <junit.xml>...
 *     Per-test seconds from Playwright JUnit reports (CI uploads them in the
 *     e2e report artifacts) -> scripts/test-durations/e2e.json
 *
 *   node scripts/record-test-durations.mjs coverage <turbo-run-summary.json>...
 *     Per-package seconds of the `coverage` task from `turbo run coverage
 *     --summarize` (.turbo/runs/*.json) -> scripts/test-durations/coverage.json
 *
 * Several inputs are averaged. Stale data only skews the balance: the planner
 * still places every spec and package (see scripts/shard-plan.mjs).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT_DIR = path.join(import.meta.dirname, "test-durations");

const round = (seconds) => Math.round(seconds * 10) / 10;
const decodeXml = (text) =>
	text
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"')
		.replaceAll("&apos;", "'")
		.replaceAll("&amp;", "&");

/** Collects samples per key, then averages them into a key-sorted object. */
function averaged(samples) {
	return Object.fromEntries(
		[...samples]
			.sort(([a], [b]) => (a < b ? -1 : 1))
			.map(([key, values]) => [key, round(values.reduce((a, b) => a + b, 0) / values.length)]),
	);
}

function addSample(samples, key, value) {
	samples.set(key, [...(samples.get(key) ?? []), value]);
}

/** @returns {Record<string, Record<string, number>>} seconds per title, per spec file */
export function e2eDurations(junitReports) {
	const byFile = new Map();
	for (const xml of junitReports) {
		for (const [, attributes] of xml.matchAll(/<testcase\s([^>]*)>/g)) {
			const attribute = (name) => new RegExp(`\\b${name}="([^"]*)"`).exec(attributes)?.[1];
			const [title, file, time] = [attribute("name"), attribute("classname"), attribute("time")];
			if (title === undefined || file === undefined || time === undefined) continue;
			const posixFile = decodeXml(file).replaceAll("\\", "/");
			if (!byFile.has(posixFile)) byFile.set(posixFile, new Map());
			addSample(byFile.get(posixFile), decodeXml(title), Number(time));
		}
	}
	return Object.fromEntries(
		[...byFile]
			.sort(([a], [b]) => (a < b ? -1 : 1))
			.map(([file, samples]) => [file, averaged(samples)]),
	);
}

/** @returns {Record<string, number>} seconds of `task` per package */
export function taskDurations(turboSummaries, task) {
	const samples = new Map();
	for (const summary of turboSummaries) {
		for (const entry of summary.tasks ?? []) {
			if (entry.task !== task || entry.execution?.exitCode !== 0) continue;
			if (entry.cache?.status === "HIT") continue;
			const { startTime, endTime } = entry.execution;
			addSample(samples, entry.package, (endTime - startTime) / 1000);
		}
	}
	return averaged(samples);
}

function write(name, data) {
	mkdirSync(OUT_DIR, { recursive: true });
	const file = path.join(OUT_DIR, `${name}.json`);
	writeFileSync(file, `${JSON.stringify(data, null, "\t")}\n`);
	console.log(`Wrote ${path.relative(process.cwd(), file)} (${Object.keys(data).length} entries)`);
}

if (import.meta.main) {
	const [kind, ...inputs] = process.argv.slice(2);
	if (inputs.length === 0 || !["e2e", "coverage"].includes(kind)) {
		console.error("Usage: record-test-durations.mjs <e2e|coverage> <report>...");
		process.exit(2);
	}
	const contents = inputs.map((input) => readFileSync(input, "utf8"));
	if (kind === "e2e") write("e2e", e2eDurations(contents));
	else
		write(
			"coverage",
			taskDurations(
				contents.map((text) => JSON.parse(text)),
				"coverage",
			),
		);
}
