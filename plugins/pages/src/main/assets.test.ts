import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createMemoryStorage } from "@kilo-desktop/kernel/testing";
import type { MainHostServices } from "@kilo-desktop/kernel";

import { defaultCelld, defaultServerBuild, localUser } from "./assets";

const folders: string[] = [];
afterEach(async () => {
	await Promise.all(folders.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A plugin folder with resources/ staged as prepare-assets stages it. */
async function pluginRoot(staged: { celld?: string; build?: boolean } = {}) {
	const root = await mkdtemp(path.join(os.tmpdir(), "pages-assets-"));
	folders.push(root);
	if (staged.celld) {
		await mkdir(path.join(root, "resources", "celld"), { recursive: true });
		await writeFile(path.join(root, "resources", "celld", staged.celld), "");
	}
	if (staged.build) {
		await mkdir(path.join(root, "resources", "pages-server"), { recursive: true });
		await writeFile(path.join(root, "resources", "pages-server", "build-receipt.json"), "{}");
	}
	return root;
}

const hostAt = (root: string | undefined): MainHostServices =>
	({
		storage: createMemoryStorage(),
		...(root ? { assets: { resolve: (subpath: string) => path.join(root, subpath) } } : {}),
	}) as unknown as MainHostServices;

describe("defaultCelld", () => {
	it("finds the staged celld, celld.exe on Windows", async () => {
		const unix = await pluginRoot({ celld: "celld" });
		const windows = await pluginRoot({ celld: "celld.exe" });

		expect(defaultCelld(hostAt(unix), {}, "darwin")).toBe(path.join(unix, "resources/celld/celld"));
		expect(defaultCelld(hostAt(windows), {}, "win32")).toBe(
			path.join(windows, "resources/celld/celld.exe"),
		);
	});

	it("prefers PAGES_CELLD_PATH when it exists", async () => {
		const root = await pluginRoot({ celld: "celld" });
		const override = path.join(root, "resources/celld/celld");

		expect(defaultCelld(hostAt(undefined), { PAGES_CELLD_PATH: ` ${override} ` })).toBe(override);
		expect(defaultCelld(hostAt(root), { PAGES_CELLD_PATH: "/nowhere/celld" }, "darwin")).toBe(
			override,
		);
	});

	it("finds nothing without assets or an override", async () => {
		expect(defaultCelld(hostAt(undefined), {})).toBeUndefined();
		expect(defaultCelld(hostAt(await pluginRoot()), {}, "darwin")).toBeUndefined();
		const throwing = {
			assets: {
				resolve: () => {
					throw new Error("no assets");
				},
			},
		} as unknown as MainHostServices;
		expect(defaultCelld(throwing, {})).toBeUndefined();
	});
});

describe("defaultServerBuild", () => {
	it("finds the staged build, or PAGES_SERVER_DIR first", async () => {
		const staged = await pluginRoot({ build: true });
		const other = await pluginRoot({ build: true });
		const otherBuild = path.join(other, "resources/pages-server");

		expect(defaultServerBuild(hostAt(staged), {})).toBe(
			path.join(staged, "resources/pages-server"),
		);
		expect(defaultServerBuild(hostAt(staged), { PAGES_SERVER_DIR: otherBuild })).toBe(otherBuild);
	});

	it("ignores a folder without a build receipt", async () => {
		const root = await pluginRoot();
		await mkdir(path.join(root, "resources/pages-server"), { recursive: true });

		expect(defaultServerBuild(hostAt(root), {})).toBeUndefined();
		expect(defaultServerBuild(hostAt(undefined), {})).toBeUndefined();
	});
});

describe("localUser", () => {
	it("is the one local user, named after the OS account when there is one", () => {
		expect(localUser(() => "ada")).toEqual({ id: "local-user", name: "ada" });
		expect(localUser(() => "")).toEqual({ id: "local-user", name: "Local User" });
		expect(
			localUser(() => {
				throw new Error("no account");
			}),
		).toEqual({ id: "local-user", name: "Local User" });
	});
});
