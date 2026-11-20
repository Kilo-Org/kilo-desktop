import { existsSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { KiloAccountClient } from "./account-service.js";

import { getKiloCliArtifact } from "../agent/cli-distribution/artifacts.js";
import { KiloServerManager } from "../agent/KiloServerManager.js";
import { createKiloAccountClient } from "./kilo-client.js";

function bundledKiloExecutable(): string | undefined {
	try {
		const artifact = getKiloCliArtifact();
		const packageJson = createRequire(import.meta.url).resolve(
			`${artifact.packageName}/package.json`,
		);
		const executable = path.join(path.dirname(packageJson), "bin", artifact.executable);
		return existsSync(executable) ? executable : undefined;
	} catch {
		return undefined;
	}
}

const kiloExecutable = bundledKiloExecutable();

const PROFILE = {
	user: { email: "person@example.test", name: "Person" },
	organizations: [
		{ id: "first", name: "First", role: "member" },
		{ id: "second", name: "Second", role: "owner" },
	],
	selectedOrganizationId: null,
	hasPersonalAccount: true,
};

/**
 * A stand-in for the Kilo API with the routes a device sign-in and an account
 * read use, in the deployed shapes (kilocode's `kilo-gateway-core` testing
 * fixture). The poll answers "pending" once, then approves.
 */
async function startKiloApi(): Promise<{ readonly url: string; readonly server: Server }> {
	let pending = 1;
	const server = createServer((request, response) => {
		const url = new URL(request.url ?? "/", "http://kilo.test");
		const json = (body: unknown, status = 200) => {
			response.writeHead(status, { "content-type": "application/json" });
			response.end(JSON.stringify(body));
		};
		switch (url.pathname) {
			case "/api/device-auth/codes":
				return json({
					code: "ABCD-1234",
					verificationUrl: `http://${request.headers.host}/device-auth?code=ABCD-1234`,
					expiresIn: 60,
				});
			case "/api/device-auth/codes/ABCD-1234":
				if (pending-- > 0) {
					response.writeHead(202);
					return response.end();
				}
				return json({ status: "approved", token: "fixture-token", userEmail: PROFILE.user.email });
			case "/api/profile":
				return json(PROFILE);
			case "/api/profile/balance":
				return json({ balance: 42.5, isDepleted: false });
			case "/api/trpc/kiloPass.getState":
				return json([{ result: { data: { json: { subscription: null } } } }]);
			default:
				response.writeHead(404);
				return response.end();
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}

describe.skipIf(!kiloExecutable)("the Kilo account on the bundled kilo2", () => {
	let home: string;
	let api: { readonly url: string; readonly server: Server };
	let manager: KiloServerManager;
	let account: KiloAccountClient;

	beforeEach(async () => {
		home = await realpath(await mkdtemp(path.join(tmpdir(), "kilo2-account-")));
		api = await startKiloApi();
		const runtimeDirectory = path.join(home, "storage", "agent-v2", "runtime");
		manager = new KiloServerManager({
			installation: {
				executablePath: kiloExecutable!,
				treeSitterWasmDirectory: path.join(path.dirname(kiloExecutable!), "tree-sitter"),
			},
			runtimeDirectory,
			configDirectory: path.join(runtimeDirectory, "config", "kilo2"),
			stateDirectory: path.join(home, "storage", "agent-v2"),
			corsOrigins: [],
			environment: {
				PATH: process.env.PATH,
				SystemRoot: process.env.SystemRoot,
				HOME: home,
				USERPROFILE: home,
				XDG_CONFIG_HOME: path.join(home, ".config"),
				XDG_DATA_HOME: path.join(home, "data"),
				XDG_CACHE_HOME: path.join(home, "cache"),
				KILO_API_URL: api.url,
				KILO_DISABLE_AUTOUPDATE: "true",
				KILO_DISABLE_MODELS_FETCH: "true",
			},
			fetch: globalThis.fetch,
			logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
		});
		const connection = await manager.ensureRunning();
		account = createKiloAccountClient({ ...connection, globalDirectory: home });
	});

	afterEach(async () => {
		manager.dispose();
		api.server.close();
		await rm(home, { recursive: true, force: true });
	});

	it("starts signed out, with no profile to read", async () => {
		await expect(account.authStatus()).resolves.toEqual({ authenticated: false });
		await expect(account.profile()).rejects.toThrow("Not signed in to Kilo Gateway");
	});

	it("signs in with a device code, reads the profile, switches organization and signs out", async () => {
		const attempt = await account.authorize();
		expect(new URL(attempt.url).searchParams.get("code")).toBe("ABCD-1234");

		await account.callback(AbortSignal.timeout(20_000));
		await account.dispose();

		await expect(account.authStatus()).resolves.toEqual({ authenticated: true });
		await expect(account.profile()).resolves.toEqual({
			profile: {
				email: "person@example.test",
				name: "Person",
				organizations: [
					{ id: "first", name: "First", role: "member" },
					{ id: "second", name: "Second", role: "owner" },
				],
				selectedOrganizationId: null,
				hasPersonalAccount: true,
			},
			balance: { balance: 42.5 },
			kiloPass: null,
			currentOrgId: null,
		});

		// The stand-in has no team model catalog: the switch still lands.
		await account.setOrganization("second");
		await expect(account.profile()).resolves.toMatchObject({ currentOrgId: "second" });

		await account.signOut();
		await account.dispose();
		await expect(account.authStatus()).resolves.toEqual({ authenticated: false });
	});

	it("cancels a sign-in that is abandoned", async () => {
		await account.authorize();
		const abandon = new AbortController();
		const waiting = account.callback(abandon.signal);
		abandon.abort(new Error("cancelled"));

		await expect(waiting).rejects.toThrow("cancelled");
		await expect(account.authStatus()).resolves.toEqual({ authenticated: false });
	});
});
