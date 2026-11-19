#!/usr/bin/env node
// Fails when React Compiler skips a component or hook in renderer code.
//
// The compiler skips a function silently whenever it hits a rule violation
// (refs read during render, a dynamic hook, …) or syntax it cannot lower yet
// (`try/finally`, `??=`, …), so a skipped component loses its memoization
// without any build error. This runs the same compiler the app uses
// (`oxc-transform-react`, as `react({ compiler: true })` does) over every
// renderer source file with diagnostics on and reports each finding.
//
// oxlint's react/* compiler rules cover rule violations in the editor, but not
// the syntax the compiler cannot lower yet, which only the compiler reports.
// Components declared inside factories are caught by kilo/no-component-in-factory.
//
// A function that cannot be compiled on purpose (it calls a hook chosen at
// runtime, or a library the compiler cannot memoize around) opts out with a
// `"use no memo"` directive and a comment saying why; findings inside it are
// not reported.
//
// Usage: node scripts/check-react-compiler.mjs [path-prefix…]   (`pnpm lint` runs this)
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
// Resolve from the app so the check runs the compiler version the build runs.
const requireFromApp = createRequire(path.join(root, "apps/web/package.json"));
const { transformSync } = requireFromApp("oxc-transform-react");
const { parseSync } = createRequire(import.meta.url)("oxc-parser");

const SOURCES = [
	"apps/web/src",
	"packages/kernel/src",
	"packages/pane-layout/src",
	"packages/ui/src",
	"plugins/*/src",
];
const NOT_RENDERER =
	/(^|\/)(main|test|e2e)\/|\.(test|spec)\.tsx?$|test-(harness|helpers)\.tsx?$|\.d\.ts$/;
// The filter @vitejs/plugin-react applies before handing a file to the compiler.
const MAY_HOLD_COMPONENTS = /forwardRef|memo|\b(?:[A-Z]|use[A-Z0-9])/;
const OPT_OUT = new Set(["use no memo", "use no forget"]);

function rendererFiles(prefixes) {
	// Untracked files too (still honouring .gitignore), so a component that is
	// not `git add`ed yet is checked; deleted ones are still listed as cached.
	const files = execFileSync(
		"git",
		[
			"ls-files",
			"--cached",
			"--others",
			"--exclude-standard",
			"--deduplicate",
			"--",
			...SOURCES.flatMap((dir) => [`${dir}/**/*.ts`, `${dir}/**/*.tsx`]),
		],
		{ cwd: root, encoding: "utf8" },
	)
		.split("\n")
		.filter((file) => file && !NOT_RENDERER.test(file) && existsSync(path.join(root, file)));
	if (files.length === 0) throw new Error("No renderer sources matched; check SOURCES.");
	return prefixes.length
		? files.filter((file) => prefixes.some((prefix) => file.startsWith(prefix)))
		: files;
}

/** 1-based line ranges of every function body that opts out with a directive. */
function optedOutRanges(file, source) {
	const lineAt = lineIndex(source);
	const ranges = [];
	const visit = (node) => {
		if (!node || typeof node !== "object") return;
		if (Array.isArray(node)) return node.forEach(visit);
		if (
			/Function|ArrowFunctionExpression/.test(node.type ?? "") &&
			node.body?.type === "BlockStatement" &&
			node.body.body.some((statement) => OPT_OUT.has(statement.directive))
		) {
			ranges.push([lineAt(node.start), lineAt(node.end)]);
		}
		for (const key in node) if (key !== "parent") visit(node[key]);
	};
	visit(parseSync(file, source).program);
	return ranges;
}

function lineIndex(source) {
	const starts = [0];
	for (let i = 0; i < source.length; i++) if (source[i] === "\n") starts.push(i + 1);
	return (offset) => {
		let low = 0;
		let high = starts.length - 1;
		while (low < high) {
			const mid = (low + high + 1) >> 1;
			if (starts[mid] <= offset) low = mid;
			else high = mid - 1;
		}
		return low + 1;
	};
}

const findings = [];
for (const file of rendererFiles(process.argv.slice(2))) {
	const source = readFileSync(path.join(root, file), "utf8");
	if (!MAY_HOLD_COMPONENTS.test(source)) continue;
	const result = transformSync(file, source, {
		jsx: { runtime: "automatic" },
		reactCompiler: { reportDiagnostics: true },
	});
	const optedOut = optedOutRanges(file, source);
	for (const error of result.errors) {
		const line = Number(error.codeframe?.match(/:(\d+):\d+\]/)?.[1]);
		if (optedOut.some(([start, end]) => line >= start && line <= end)) continue;
		findings.push({ file, line, error });
	}
}

if (findings.length) {
	for (const { file, line, error } of findings) {
		console.error(`${file}:${line || "?"}  ${error.message}\n${error.codeframe ?? ""}\n`);
	}
	console.error(
		`React Compiler skips ${findings.length} finding(s) above. Fix the code so it compiles, or opt the function out with "use no memo" and a comment saying why.`,
	);
	process.exit(1);
}
