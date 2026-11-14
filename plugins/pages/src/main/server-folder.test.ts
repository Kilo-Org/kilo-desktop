import { lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { devVarsText, prepareServerFolder, type PagesServerVars } from "./server-folder";

const VARS: PagesServerVars = {
	port: 9899,
	kiloAppUrl: "http://127.0.0.1:9898",
	audience: "pages-desktop",
	exchangeSecret: "e".repeat(64),
	sessionSecret: "s".repeat(64),
};

const folders: string[] = [];
afterEach(async () => {
	await Promise.all(folders.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir() {
	const dir = await mkdtemp(path.join(os.tmpdir(), "pages-folder-"));
	folders.push(dir);
	return dir;
}

async function build(receipt = { build_id: "one" }) {
	const dir = await tempDir();
	await writeFile(path.join(dir, "index.js"), "export default {}");
	await writeFile(path.join(dir, "sift.wasm"), "wasm");
	await mkdir(path.join(dir, "public", "assets"), { recursive: true });
	await writeFile(path.join(dir, "public", "index.html"), "<html>");
	await writeFile(path.join(dir, "public", "assets", "app.js"), "app");
	await writeFile(
		path.join(dir, "wrangler.json"),
		JSON.stringify({ main: "index.js", triggers: { crons: ["* * * * *"] }, vars: { A: "1" } }),
	);
	await writeFile(path.join(dir, "build-receipt.json"), JSON.stringify(receipt));
	return dir;
}

const read = (...parts: string[]) => readFile(path.join(...parts), "utf8");

describe("prepareServerFolder", () => {
	it("copies the build in as real files, with wrangler.json minus its cron triggers", async () => {
		const buildDir = await build();
		const serverDir = path.join(await tempDir(), "server");

		const result = await prepareServerFolder({ buildDir, serverDir, vars: VARS });

		expect(result).toEqual({ copied: true });
		await expect(read(serverDir, "index.js")).resolves.toBe("export default {}");
		await expect(read(serverDir, "public", "assets", "app.js")).resolves.toBe("app");
		expect(JSON.parse(await read(serverDir, "wrangler.json"))).toEqual({
			main: "index.js",
			vars: { A: "1" },
		});
		await expect(read(serverDir, ".dev.vars")).resolves.toBe(devVarsText(VARS));
	});

	it("keeps the copy, and the server's data, while the build receipt is unchanged", async () => {
		const buildDir = await build();
		const serverDir = path.join(await tempDir(), "server");
		await prepareServerFolder({ buildDir, serverDir, vars: VARS });
		await mkdir(path.join(serverDir, ".celld", "dev"), { recursive: true });
		await writeFile(path.join(serverDir, ".celld", "dev", "data"), "pages");
		await writeFile(path.join(buildDir, "index.js"), "changed without a new receipt");

		const result = await prepareServerFolder({
			buildDir,
			serverDir,
			vars: { ...VARS, port: 1234 },
		});

		expect(result).toEqual({ copied: false });
		await expect(read(serverDir, "index.js")).resolves.toBe("export default {}");
		await expect(read(serverDir, ".celld", "dev", "data")).resolves.toBe("pages");
		await expect(read(serverDir, ".dev.vars")).resolves.toContain("localhost:1234");
	});

	it("copies a new build in, dropping files the old one had, and keeps the data", async () => {
		const buildDir = await build();
		const serverDir = path.join(await tempDir(), "server");
		await prepareServerFolder({ buildDir, serverDir, vars: VARS });
		await mkdir(path.join(serverDir, ".celld", "dev"), { recursive: true });
		await writeFile(path.join(serverDir, ".celld", "dev", "data"), "pages");
		await rm(path.join(buildDir, "public", "assets", "app.js"));
		await writeFile(path.join(buildDir, "public", "assets", "app2.js"), "app2");
		await writeFile(path.join(buildDir, "build-receipt.json"), JSON.stringify({ build_id: "two" }));

		const result = await prepareServerFolder({ buildDir, serverDir, vars: VARS });

		expect(result).toEqual({ copied: true });
		await expect(read(serverDir, "public", "assets", "app2.js")).resolves.toBe("app2");
		await expect(stat(path.join(serverDir, "public", "assets", "app.js"))).rejects.toThrow();
		await expect(read(serverDir, ".celld", "dev", "data")).resolves.toBe("pages");
		await expect(read(serverDir, "build-receipt.json")).resolves.toContain("two");
	});

	it("copies through symlinks in the build, which celld refuses", async () => {
		const real = await build();
		const buildDir = await tempDir();
		for (const name of ["index.js", "sift.wasm", "public", "wrangler.json", "build-receipt.json"]) {
			await symlink(path.join(real, name), path.join(buildDir, name));
		}
		const serverDir = path.join(await tempDir(), "server");

		await prepareServerFolder({ buildDir, serverDir, vars: VARS });

		expect((await lstat(path.join(serverDir, "index.js"))).isSymbolicLink()).toBe(false);
		expect((await lstat(path.join(serverDir, "public"))).isDirectory()).toBe(true);
	});

	it("keeps the server's environment file private", async () => {
		const buildDir = await build();
		const serverDir = path.join(await tempDir(), "server");

		await prepareServerFolder({ buildDir, serverDir, vars: VARS });

		expect((await stat(path.join(serverDir, ".dev.vars"))).mode & 0o077).toBe(0);
	});

	it("refuses a build without a receipt", async () => {
		const buildDir = await build();
		await rm(path.join(buildDir, "build-receipt.json"));

		await expect(
			prepareServerFolder({ buildDir, serverDir: path.join(buildDir, "s"), vars: VARS }),
		).rejects.toThrow(/build-receipt\.json/);
	});
});

describe("devVarsText", () => {
	it("serves Pages at localhost, signing in through the bridge with local OIDC on", () => {
		const lines = devVarsText(VARS).trim().split("\n");

		expect(Object.fromEntries(lines.map((line) => line.split(/=(.*)/s).slice(0, 2)))).toEqual({
			NOTEBOOK_CLOUD_APP_SESSION_SECRET: VARS.sessionSecret,
			NOTEBOOK_CLOUD_LOCAL_OIDC: "true",
			PAGES_CATALOG_INDEX: "1",
			NOTEBOOK_CLOUD_OIDC_FLOW: "server",
			NOTEBOOK_CLOUD_PUBLIC_ORIGIN: "http://localhost:9899",
			NOTEBOOK_CLOUD_OIDC_ISSUER: "http://localhost:9899/dev/oidc",
			NOTEBOOK_CLOUD_OIDC_CLIENT_ID: "pages-next-local",
			NOTEBOOK_CLOUD_OIDC_AUDIENCE: "pages-next-local",
			NOTEBOOK_CLOUD_OIDC_PRINCIPAL_NAMESPACE: "pages-next-local",
			PAGES_KILO_APP_URL: VARS.kiloAppUrl,
			PAGES_KILO_AUDIENCE: VARS.audience,
			PAGES_KILO_EXCHANGE_SECRET: VARS.exchangeSecret,
		});
	});
});
