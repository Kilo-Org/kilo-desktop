import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, describe, it } from "node:test";

const SCRIPT = path.join(import.meta.dirname, "setup-worktree.mjs");

/**
 * A main checkout plus a linked worktree, with a stub `pnpm` first on PATH whose
 * behavior each test picks through STUB_MODE.
 */
function createFixture() {
	const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "setup-worktree-")));
	const main = path.join(root, "main");
	const worktree = path.join(root, "wt");
	const bin = path.join(root, "bin");
	fs.mkdirSync(main);
	fs.mkdirSync(bin);
	const git = (...args) => execFileSync("git", args, { cwd: main, stdio: "pipe" });
	git("init", "-q");
	fs.writeFileSync(path.join(main, ".gitignore"), ".env\n.env.*\nnode_modules\n.kilo\n");
	fs.writeFileSync(path.join(main, "README.md"), "fixture\n");
	git("add", ".");
	git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
	git("-c", "core.hooksPath=/dev/null", "worktree", "add", "-q", "--detach", worktree);

	fs.writeFileSync(
		path.join(bin, "pnpm"),
		[
			"#!/bin/sh",
			'case "$STUB_MODE" in',
			"  fail) echo 'ERR_PNPM_OUTDATED_LOCKFILE stub failure' >&2; exit 1 ;;",
			'  wait) while [ ! -f "$STUB_RELEASE" ]; do sleep 0.05; done ;;',
			"esac",
			"mkdir -p node_modules",
			`printf '{"storeDir":"%s"}' "$PWD" > node_modules/.modules.yaml`,
			"",
		].join("\n"),
		{ mode: 0o755 },
	);

	const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
	const markers = path.join(worktree, ".kilo", "worktree-setup");
	return { root, main, worktree, env, markers };
}

function runSetup(fixture, { args = [], mode = "ok", extraEnv = {} } = {}) {
	return spawnSync(process.execPath, [SCRIPT, ...args], {
		cwd: fixture.worktree,
		env: { ...fixture.env, STUB_MODE: mode, ...extraEnv },
		encoding: "utf8",
	});
}

/** Resolves with whichever final marker (`done` or `failed`) setup writes, so a failed run fails the test instead of hanging it. */
function waitForFinalMarker(dir) {
	const final = () => ["done", "failed"].find((name) => fs.existsSync(path.join(dir, name)));
	return new Promise((resolve) => {
		const check = () => {
			const name = final();
			if (!name) return;
			watcher.close();
			resolve(name);
		};
		const watcher = fs.watch(dir, check);
		check();
	});
}

describe("setup-worktree", () => {
	let fixture;
	before(() => {
		fixture = createFixture();
	});
	after(() => {
		fs.rmSync(fixture.root, { recursive: true, force: true });
	});

	it("installs, marks setup done, and links ignored env files from the main checkout", () => {
		fs.mkdirSync(path.join(fixture.main, "apps", "web"), { recursive: true });
		fs.writeFileSync(path.join(fixture.main, ".env"), "ROOT=1\n");
		fs.writeFileSync(path.join(fixture.main, "apps", "web", ".env.local"), "NESTED=1\n");
		fs.writeFileSync(path.join(fixture.root, "shared-secrets"), "SHARED=1\n");
		fs.symlinkSync(
			path.join(fixture.root, "shared-secrets"),
			path.join(fixture.main, ".env.shared"),
		);

		const result = runSetup(fixture);

		assert.equal(result.status, 0, result.stderr);
		assert.ok(fs.existsSync(path.join(fixture.markers, "done")));
		assert.ok(!fs.existsSync(path.join(fixture.markers, "running")));
		assert.equal(
			fs.readlinkSync(path.join(fixture.worktree, ".env")),
			path.join(fixture.main, ".env"),
		);
		assert.equal(
			fs.readFileSync(path.join(fixture.worktree, "apps", "web", ".env.local"), "utf8"),
			"NESTED=1\n",
		);
		assert.equal(fs.readFileSync(path.join(fixture.worktree, ".env.shared"), "utf8"), "SHARED=1\n");
	});

	it("never replaces a real env file the worktree already has", () => {
		fs.writeFileSync(path.join(fixture.main, ".env.keep"), "MAIN\n");
		fs.writeFileSync(path.join(fixture.worktree, ".env.keep"), "WORKTREE\n");

		assert.equal(runSetup(fixture).status, 0);

		assert.ok(!fs.lstatSync(path.join(fixture.worktree, ".env.keep")).isSymbolicLink());
		assert.equal(fs.readFileSync(path.join(fixture.worktree, ".env.keep"), "utf8"), "WORKTREE\n");
	});

	it("marks setup failed with the install error tail", () => {
		const result = runSetup(fixture, { mode: "fail" });

		assert.notEqual(result.status, 0);
		assert.ok(!fs.existsSync(path.join(fixture.markers, "done")));
		assert.ok(!fs.existsSync(path.join(fixture.markers, "running")));
		assert.match(
			fs.readFileSync(path.join(fixture.markers, "failed"), "utf8"),
			/ERR_PNPM_OUTDATED_LOCKFILE stub failure/,
		);
	});

	it("returns at once in --background with a live PID in the running marker", async () => {
		const release = path.join(fixture.root, "release");

		const result = runSetup(fixture, {
			args: ["--background"],
			mode: "wait",
			extraEnv: { STUB_RELEASE: release },
		});

		try {
			assert.equal(result.status, 0, result.stderr);
			assert.ok(
				!fs.existsSync(path.join(fixture.markers, "failed")),
				"a new run clears the old failure",
			);
			const pid = Number(fs.readFileSync(path.join(fixture.markers, "running"), "utf8"));
			assert.doesNotThrow(
				() => process.kill(pid, 0),
				"the running marker names a live setup process",
			);
		} finally {
			// Always let the stub install finish so the detached setup exits.
			fs.writeFileSync(release, "");
		}

		assert.equal(await waitForFinalMarker(fixture.markers), "done");
		assert.match(fs.readFileSync(path.join(fixture.markers, "log"), "utf8"), /pnpm install/);
	});
});
