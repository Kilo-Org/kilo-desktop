#!/usr/bin/env node
/**
 * Prepares a freshly created git worktree: `pnpm install`, then links the main
 * checkout's gitignored env files in.
 *
 * `.husky/post-checkout` runs this with `--background` for every new worktree
 * (Agent Manager, Kilo Desktop's work sessions, plain `git worktree add`), so
 * creating a worktree returns in under a second and the install continues
 * detached, logging to `.kilo/worktree-setup/log`. Run it without flags to set
 * up a worktree in the foreground.
 *
 * Agents may start before the install ends, so `.kilo/worktree-setup/` carries
 * the state they wait on (see AGENTS.md):
 * - `running` holds the setup PID while setup runs;
 * - setup ends by replacing it with `done`, or with `failed` holding the error
 *   tail. Every exit path (failure, crash, SIGINT/SIGTERM/SIGHUP) writes one of
 *   the two, so nothing waits on a setup that is gone.
 */
import { execFileSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const INSTALL = ["pnpm", ["install", "--frozen-lockfile", "--prefer-offline"]];
const FAILURE_TAIL_LINES = 30;

// The background launcher resolves both paths and hands them down, so the detached
// child runs nothing that can fail before its exit handler guarantees a final marker.
const RESOLVED_PATHS = "KILO_WORKTREE_SETUP_PATHS";
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const [worktree, mainCheckout] = process.env[RESOLVED_PATHS]
	? JSON.parse(process.env[RESOLVED_PATHS])
	: [
			git("rev-parse", "--show-toplevel"),
			path.dirname(git("rev-parse", "--path-format=absolute", "--git-common-dir")),
		];

const markerDir = path.join(worktree, ".kilo", "worktree-setup");
const marker = {
	running: path.join(markerDir, "running"),
	done: path.join(markerDir, "done"),
	failed: path.join(markerDir, "failed"),
	log: path.join(markerDir, "log"),
};

function resetMarkers() {
	fs.mkdirSync(markerDir, { recursive: true });
	fs.rmSync(marker.done, { force: true });
	fs.rmSync(marker.failed, { force: true });
}

function launchInBackground() {
	resetMarkers();
	const log = fs.openSync(marker.log, "w");
	const child = spawn(process.execPath, [import.meta.filename], {
		cwd: worktree,
		env: { ...process.env, [RESOLVED_PATHS]: JSON.stringify([worktree, mainCheckout]) },
		detached: true,
		stdio: ["ignore", log, log],
		windowsHide: true,
	});
	if (child.pid === undefined) {
		// spawn reports the cause through "error"; record it so no agent waits on an unknown PID.
		child.on("error", (error) =>
			fs.writeFileSync(marker.failed, `Could not start setup: ${error.message}\n`),
		);
		process.exitCode = 1;
		return;
	}
	// Written before returning so an agent that starts right after `git worktree add` sees it.
	fs.writeFileSync(marker.running, `${child.pid}\n`);
	child.unref();
}

async function setUp() {
	resetMarkers();
	fs.writeFileSync(marker.running, `${process.pid}\n`);
	let failureDetail = "";
	process.on("uncaughtExceptionMonitor", (error) => {
		failureDetail = error.stack ?? String(error);
	});
	process.on("exit", (code) => {
		if (code === 0) fs.writeFileSync(marker.done, "");
		else fs.writeFileSync(marker.failed, `Setup exited with code ${code}.\n${failureDetail}\n`);
		fs.rmSync(marker.running, { force: true });
	});

	const { status, signal, outputTail } = await install();
	if (status !== 0 || signal) {
		failureDetail = signal ? `Cancelled by ${signal}.` : outputTail;
		process.exit(status || 1);
	}
	warnIfStoreOnAnotherFilesystem();
	if (worktree !== mainCheckout) linkEnvFiles();
}

/** Runs the install unattended: closed stdin makes prompts fail, and a stale lockfile fails instead of being rewritten. */
async function install() {
	const [command, args] = INSTALL;
	console.log(`setup-worktree: running ${command} ${args.join(" ")} in ${worktree}`);
	const child = spawn(command, args, {
		cwd: worktree,
		stdio: ["ignore", "pipe", "pipe"],
		shell: process.platform === "win32",
	});
	let signal;
	for (const name of ["SIGINT", "SIGTERM", "SIGHUP"]) {
		process.on(name, () => {
			signal = name;
			child.kill(name);
		});
	}
	let output = "";
	for (const [source, target] of [
		[child.stdout, process.stdout],
		[child.stderr, process.stderr],
	]) {
		source.setEncoding("utf8");
		source.on("data", (chunk) => {
			target.write(chunk);
			output = (output + chunk).slice(-8_000);
		});
	}
	const status = await new Promise((resolve) => {
		child.on("error", (error) => {
			output += `\n${error.message}`;
			resolve(1);
		});
		child.on("close", resolve);
	});
	const outputTail = output.trimEnd().split("\n").slice(-FAILURE_TAIL_LINES).join("\n");
	return { status, signal, outputTail };
}

/** pnpm cannot hardlink or clone across filesystems, so a store on another device silently turns every install into a full copy. */
function warnIfStoreOnAnotherFilesystem() {
	const modules = path.join(worktree, "node_modules");
	const storeDir = readStoreDir(path.join(modules, ".modules.yaml"));
	if (typeof storeDir !== "string" || !fs.existsSync(storeDir)) return;
	if (fs.statSync(storeDir).dev === fs.statSync(modules).dev) return;
	console.warn(
		[
			"",
			"WARNING: the pnpm store is on a different filesystem than this worktree.",
			`  store:    ${storeDir}`,
			`  worktree: ${worktree}`,
			"pnpm cannot hardlink or clone across filesystems, so it copied every package into node_modules.",
			"Fix: put the store on the worktree's filesystem, for example:",
			`  pnpm config set store-dir ${JSON.stringify(path.join(path.dirname(mainCheckout), ".pnpm-store"))} --global`,
			"",
		].join("\n"),
	);
}

/** pnpm 10+ writes `.modules.yaml` as JSON; older versions wrote YAML, so read `storeDir` from either. */
function readStoreDir(modulesYaml) {
	let text;
	try {
		text = fs.readFileSync(modulesYaml, "utf8");
	} catch {
		return undefined;
	}
	try {
		return JSON.parse(text).storeDir;
	} catch {
		return text.match(/^storeDir:\s*['"]?(.+?)['"]?\s*$/m)?.[1];
	}
}

/**
 * Links every gitignored `.env*` file of the main checkout, nested ones included; only symlinks are replaced so real files survive.
 * Where symlinks are not permitted (Windows without Developer Mode) the file is copied instead.
 */
function linkEnvFiles() {
	const ignored = execFileSync(
		"git",
		["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"],
		{ cwd: mainCheckout, encoding: "utf8" },
	)
		.split("\0")
		.filter((entry) => entry && !entry.endsWith("/") && path.basename(entry).startsWith(".env"));
	for (const file of ignored) {
		const source = path.join(mainCheckout, file);
		// statSync follows links, so an env file that points at a shared secrets file is included.
		if (!fs.statSync(source, { throwIfNoEntry: false })?.isFile()) continue;
		const target = path.join(worktree, file);
		const existing = fs.lstatSync(target, { throwIfNoEntry: false });
		if (existing && !existing.isSymbolicLink()) continue;
		if (existing) fs.rmSync(target);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		try {
			fs.symlinkSync(source, target);
			console.log(`setup-worktree: linked ${file}`);
		} catch (error) {
			if (error.code !== "EPERM") throw error;
			fs.copyFileSync(source, target);
			console.log(`setup-worktree: copied ${file} (symlinks not permitted)`);
		}
	}
}

if (process.argv.includes("--background")) launchInBackground();
else await setUp();
