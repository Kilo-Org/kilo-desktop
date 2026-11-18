/**
 * Run only the tests a change can reach — locally before pushing, and on PRs
 * in CI. The merge queue runs everything with `--all`.
 *
 * Turbo's `--affected` picks the packages changed since the base (plus their
 * dependents), and Vitest's `--changed` then runs only the test files that
 * import a changed file. Inputs the import graph cannot see — the lockfile,
 * manifests, tsconfigs, test configs and setup files — force every affected
 * package's full suite instead.
 *
 * `--shard i/n` runs one CI shard's share of those packages, split by the
 * recorded `coverage` durations (scripts/test-durations/coverage.json).
 *
 * Usage:
 *   pnpm test:changed [base-ref]           (default base: merge base with origin/main)
 *   node scripts/test-changed.mjs <base-ref> [--shard i/n] [--concurrency n]
 *   node scripts/test-changed.mjs --all --task coverage [--shard i/n]
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { idsForShard, parseShard } from "./shard-plan.mjs";

const FULL_RUN_TRIGGERS = [
	/(^|\/)package\.json$/,
	/^pnpm-(lock|workspace)\.yaml$/,
	/^turbo\.json$/,
	/^\.nvmrc$/,
	/(^|\/)tsconfig[^/]*\.json$/,
	/(^|\/)(vite|vitest)\.config\.[cm]?[jt]s$/,
	/^vitest\.coverage\.shared\.mjs$/,
	/(^|\/)src\/test\/setup\.tsx?$/,
];

/**
 * How to narrow the run: Vitest arguments plus a line explaining the choice.
 *
 * @param {{ changed: readonly string[], base: string }} change
 * @returns {{ vitestArgs: string[], reason: string } | undefined} undefined: nothing changed
 */
export function planSelection({ changed, base }) {
	if (changed.length === 0) return undefined;
	const trigger = changed.find((file) => FULL_RUN_TRIGGERS.some((re) => re.test(file)));
	if (trigger) {
		return {
			vitestArgs: [],
			reason: `${trigger} changed; running the full suite of affected packages`,
		};
	}
	return {
		vitestArgs: ["--changed", base, "--passWithNoTests"],
		reason: `running tests that import the ${changed.length} changed file(s)`,
	};
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const lines = (output) => output.split("\n").filter(Boolean);

// pnpm is a .cmd shim on Windows, which Node only runs through a shell; the
// shell joins arguments unquoted, so quote them.
const SHELL = process.platform === "win32";
const shellArgs = (args) =>
	SHELL ? args.map((arg) => (/[\s"&|<>^]/.test(arg) ? `"${arg}"` : arg)) : args;

function resolveBase(requested) {
	if (requested) return git("rev-parse", "--verify", requested);
	for (const ref of ["origin/main", "main"]) {
		try {
			return git("merge-base", "HEAD", ref);
		} catch {
			// Try the next candidate.
		}
	}
	throw new Error("No base ref found; pass one: pnpm test:changed <ref>");
}

/** Packages with `task`: every one, or only those affected since `base`. */
function packagesWithTask(task, { affected, env }) {
	const output = execFileSync(
		"pnpm",
		shellArgs(["exec", "turbo", "run", task, "--dry=json", ...(affected ? ["--affected"] : [])]),
		{ encoding: "utf8", shell: SHELL, env, maxBuffer: 64 * 1024 * 1024 },
	);
	const plan = JSON.parse(output.slice(output.indexOf("{")));
	return [
		...new Set(
			plan.tasks
				.filter((entry) => entry.task === task && entry.command !== "<NONEXISTENT>")
				.map((entry) => entry.package),
		),
	].sort();
}

function readDurations() {
	try {
		const file = path.join(import.meta.dirname, "test-durations", "coverage.json");
		return JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return {};
	}
}

function main() {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			all: { type: "boolean", default: false },
			task: { type: "string", default: "test" },
			shard: { type: "string" },
			concurrency: { type: "string", default: "50%" },
		},
	});
	const log = (message) => console.log(`test:changed: ${message}`);
	const shard = parseShard(values.shard);
	const env = { ...process.env };

	let vitestArgs = [];
	if (!values.all) {
		const base = resolveBase(positionals[0]);
		env.TURBO_SCM_BASE = base;
		const selection = planSelection({
			base,
			changed: [
				...lines(git("diff", "--name-only", base)),
				...lines(git("ls-files", "--others", "--exclude-standard")),
			],
		});
		if (!selection) {
			log(`nothing changed since ${base.slice(0, 12)}`);
			return 0;
		}
		log(selection.reason);
		vitestArgs = selection.vitestArgs;
	}

	let packages = packagesWithTask(values.task, { affected: !values.all, env });
	if (shard) {
		packages = idsForShard(packages, readDurations(), shard);
		log(`shard ${shard.current}/${shard.total}: ${packages.join(", ") || "(none)"}`);
	}
	if (packages.length === 0) {
		log(`no packages to ${values.task}`);
		return 0;
	}

	const result = spawnSync(
		"pnpm",
		shellArgs([
			"exec",
			"turbo",
			"run",
			values.task,
			...packages.map((name) => `--filter=${name}`),
			`--concurrency=${values.concurrency}`,
			"--output-logs=errors-only",
			...(vitestArgs.length ? ["--", ...vitestArgs] : []),
		]),
		{ stdio: "inherit", shell: SHELL, env },
	);
	if (result.error) {
		console.error(`test:changed: could not start pnpm: ${result.error.message}`);
	}
	return result.status ?? 1;
}

if (import.meta.main) process.exit(main());
