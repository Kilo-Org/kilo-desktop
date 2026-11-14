// Stages what kilo.pages ships in resources/ (both gitignored):
//   resources/pages-server/  nteract Pages' build (`npm run setup && npm run build`
//                            in nteract's apps/pages → dist/)
//   resources/celld/celld    the celld runtime (https://celld.dev, Apache-2.0)
// Sources: PAGES_BUILD_DIR (default: a sibling nteract checkout's
// apps/pages/dist) and PAGES_CELLD_PATH (default: celld on PATH, then
// ~/.local/bin/celld). Either may be set in .env.local. A missing source is
// skipped with a note, so the workspace-wide prepare-assets never fails on it;
// the plugin then reports Pages as unavailable.
import { execFileSync } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { chmod, copyFile, cp, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(pluginRoot, "../..");
const resources = path.join(pluginRoot, "resources");

function defaultBuildDir(): string {
	// A worktree under .kilo/worktrees sits deeper than the main checkout.
	const roots = [workspaceRoot, path.resolve(workspaceRoot, "../../..")];
	const candidates = roots.map((root) => path.resolve(root, "../nteract/apps/pages/dist"));
	return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

function defaultCelld(): string | undefined {
	try {
		const found = execFileSync("which", ["celld"], { encoding: "utf8" }).trim();
		if (found) return found;
	} catch {
		// Not on PATH.
	}
	const local = path.join(os.homedir(), ".local/bin/celld");
	return existsSync(local) ? local : undefined;
}

async function readText(file: string): Promise<string | undefined> {
	try {
		return await readFile(file, "utf8");
	} catch {
		return undefined;
	}
}

async function stageBuild(): Promise<void> {
	const source = process.env["PAGES_BUILD_DIR"]?.trim() || defaultBuildDir();
	const receipt = await readText(path.join(source, "build-receipt.json"));
	if (receipt === undefined) {
		console.warn(
			`[kilo.pages] Skipping the Pages build: no build-receipt.json in ${source}. ` +
				"Build nteract's apps/pages (npm run setup && npm run build) or set PAGES_BUILD_DIR.",
		);
		return;
	}
	const target = path.join(resources, "pages-server");
	if ((await readText(path.join(target, "build-receipt.json"))) === receipt) {
		console.log(`[kilo.pages] The Pages build in ${target} is current.`);
		return;
	}
	await rm(target, { recursive: true, force: true });
	await cp(source, target, {
		recursive: true,
		dereference: true,
		mode: constants.COPYFILE_FICLONE,
	});
	console.log(`[kilo.pages] Staged the Pages build from ${source}.`);
}

async function stageCelld(): Promise<void> {
	const source = process.env["PAGES_CELLD_PATH"]?.trim() || defaultCelld();
	if (!source || !existsSync(source)) {
		console.warn(
			"[kilo.pages] Skipping celld: not found. Install it " +
				"(curl -fsSL https://celld.dev/install.sh | CELLD_VERSION=v0.6.3 sh) or set PAGES_CELLD_PATH.",
		);
		return;
	}
	const target = path.join(
		resources,
		"celld",
		process.platform === "win32" ? "celld.exe" : "celld",
	);
	await mkdir(path.dirname(target), { recursive: true });
	await copyFile(source, target, constants.COPYFILE_FICLONE);
	await chmod(target, 0o755);
	console.log(`[kilo.pages] Staged celld from ${source}.`);
}

await stageBuild();
await stageCelld();
