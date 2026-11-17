/**
 * Flag every e2e test that failed and then passed on retry, from Playwright's
 * JSON report. CI allows one retry so a flake does not block a merge, but each
 * one is a bug: this prints a GitHub warning per flaky test and lists them in
 * the job summary so they are seen and fixed, not silently retried.
 *
 * Report paths are relative to the Playwright testDir, which is the repo root.
 *
 * Usage: node e2e/scripts/report-flaky.ts [test-results/results.json]
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";

interface JsonTest {
	status: string;
	results: { error?: { message?: string } }[];
}
interface JsonSpec {
	title: string;
	file: string;
	line: number;
	tests: JsonTest[];
}
interface JsonSuite {
	title: string;
	specs?: JsonSpec[];
	suites?: JsonSuite[];
}

export interface Flake {
	file: string;
	line: number;
	title: string;
	firstError: string;
}

// oxlint-disable-next-line no-control-regex -- matching terminal colour codes
const stripAnsi = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, "");

export function findFlakes(report: { suites?: JsonSuite[] }): Flake[] {
	const flakes: Flake[] = [];
	const visit = (suite: JsonSuite, titles: string[]) => {
		const path = suite.title && !suite.title.endsWith(".ts") ? [...titles, suite.title] : titles;
		for (const spec of suite.specs ?? []) {
			for (const test of spec.tests) {
				if (test.status !== "flaky") continue;
				const message = stripAnsi(
					test.results.find((result) => result.error)?.error?.message ?? "",
				);
				flakes.push({
					file: spec.file,
					line: spec.line,
					title: [...path, spec.title].join(" › "),
					firstError: message.split("\n")[0] ?? "",
				});
			}
		}
		for (const child of suite.suites ?? []) visit(child, path);
	};
	for (const suite of report.suites ?? []) visit(suite, []);
	return flakes;
}

const escapeAnnotation = (text: string) =>
	text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");

if (import.meta.main) {
	const input = process.argv[2] ?? "test-results/results.json";
	if (!existsSync(input)) {
		console.log(`report-flaky: no report at ${input}`);
		process.exit(0);
	}
	const flakes = findFlakes(JSON.parse(readFileSync(input, "utf8")));
	for (const flake of flakes) {
		console.log(
			`::warning file=${flake.file},line=${flake.line},title=Flaky e2e test::${escapeAnnotation(
				`${flake.title} passed only on retry. ${flake.firstError}`,
			)}`,
		);
	}
	const summary = process.env.GITHUB_STEP_SUMMARY;
	if (summary && flakes.length > 0) {
		const rows = flakes.map((flake) => `| \`${flake.file}:${flake.line}\` | ${flake.title} |`);
		appendFileSync(
			summary,
			[
				`### ${flakes.length} flaky e2e test(s)`,
				"",
				"Passed only on retry. Each is a bug to fix, not a retry to keep.",
				"",
				"| Spec | Test |",
				"| --- | --- |",
				...rows,
				"",
			].join("\n"),
		);
	}
	console.log(`report-flaky: ${flakes.length} flaky test(s)`);
}
