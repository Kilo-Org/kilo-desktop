/**
 * Run only the tests a change can reach, for a fast local signal before CI.
 *
 * Turbo's `--affected` picks the packages changed since the merge base (plus
 * their dependents), and Vitest's `--changed` then runs only the test files
 * that import a changed file. Inputs the import graph cannot see — the
 * lockfile, manifests, tsconfigs, test configs and setup files — force every
 * affected package's full suite instead. CI still runs everything.
 *
 * Usage: pnpm test:changed [base-ref]   (default: merge base with origin/main)
 */
import { execFileSync, spawnSync } from "node:child_process";

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

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const lines = (output) => output.split("\n").filter(Boolean);

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

const base = resolveBase(process.argv[2]);
const changed = [
	...lines(git("diff", "--name-only", base)),
	...lines(git("ls-files", "--others", "--exclude-standard")),
];

if (changed.length === 0) {
	console.log(`test:changed: nothing changed since ${base.slice(0, 12)}`);
	process.exit(0);
}

const trigger = changed.find((file) => FULL_RUN_TRIGGERS.some((re) => re.test(file)));
const vitestArgs = trigger ? [] : ["--", "--changed", base, "--passWithNoTests"];
console.log(
	trigger
		? `test:changed: ${trigger} changed; running the full suite of affected packages`
		: `test:changed: running tests that import the ${changed.length} changed file(s)`,
);

// pnpm is a .cmd shim on Windows, which Node only runs through a shell; the
// shell joins arguments unquoted, so quote them.
const SHELL = process.platform === "win32";
const shellArgs = (args) =>
	SHELL ? args.map((arg) => (/[\s"&|<>^]/.test(arg) ? `"${arg}"` : arg)) : args;

const result = spawnSync(
	"pnpm",
	shellArgs([
		"exec",
		"turbo",
		"run",
		"test",
		"--affected",
		"--concurrency=50%",
		"--output-logs=errors-only",
		...vitestArgs,
	]),
	{ stdio: "inherit", shell: SHELL, env: { ...process.env, TURBO_SCM_BASE: base } },
);
if (result.error) {
	console.error(`test:changed: could not start pnpm: ${result.error.message}`);
}
process.exit(result.status ?? 1);
