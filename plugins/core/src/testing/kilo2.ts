import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ServerConnection } from "../contracts";
import { KiloServerManager } from "../main/agent/KiloServerManager.js";
import { bundledKiloExecutable } from "./kilo-executable.js";

/** The installed `kilo2`, or undefined where it isn't installed (the tests skip). */
export const kilo2Executable = bundledKiloExecutable();

export interface Kilo2 {
	readonly connection: ServerConnection;
	/** An isolated home: Kilo's config, data, state and cache live under it. */
	readonly home: string;
	stop(): Promise<void>;
}

/**
 * Starts the bundled `kilo2` the way Desktop does (`KiloServerManager`) in an
 * isolated home, so tests read and write only its own config and credentials.
 * `apiUrl` points the Kilo gateway at a stand-in Kilo API.
 */
export async function startKilo2(
	options: {
		readonly apiUrl?: string;
		/** Prepares the home before the server starts (Desktop's config directory is `<home>/runtime/config/kilo2`). */
		readonly before?: (home: string) => Promise<void>;
	} = {},
): Promise<Kilo2> {
	const home = await mkdtemp(path.join(tmpdir(), "kilo2-"));
	const runtimeDirectory = path.join(home, "runtime");
	await mkdir(path.join(home, ".config", "kilo2"), { recursive: true });
	await mkdir(path.join(runtimeDirectory, "config", "kilo2"), { recursive: true });
	await options.before?.(home);
	const manager = new KiloServerManager({
		installation: {
			executablePath: kilo2Executable!,
			treeSitterWasmDirectory: path.join(path.dirname(kilo2Executable!), "tree-sitter"),
		},
		runtimeDirectory,
		configDirectory: path.join(runtimeDirectory, "config", "kilo2"),
		managedPluginDirectory: path.join(runtimeDirectory, "kilo-plugins"),
		stateDirectory: path.join(home, "state"),
		corsOrigins: [],
		environment: {
			PATH: process.env.PATH,
			SystemRoot: process.env.SystemRoot,
			HOME: home,
			USERPROFILE: home,
			XDG_CONFIG_HOME: path.join(home, ".config"),
			XDG_DATA_HOME: path.join(home, "data"),
			XDG_CACHE_HOME: path.join(home, "cache"),
			KILO_DISABLE_AUTOUPDATE: "true",
			KILO_DISABLE_MODELS_FETCH: "true",
			...(options.apiUrl ? { KILO_API_URL: options.apiUrl } : {}),
		},
		fetch,
		logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
	});
	const connection = await manager.ensureRunning();
	return {
		connection,
		home,
		async stop() {
			manager.dispose();
			await rm(home, { recursive: true, force: true });
		},
	};
}

export interface StandInKiloApi {
	readonly url: string;
	/** Approves the pending device code, as the person would in their browser. */
	approve(): void;
	readonly organizationsSeen: string[];
	stop(): Promise<void>;
}

const TOKEN = "kilo-token-for-tests";

/** One gateway model, in the shape Kilo's gateway lists (`/api/gateway/models`). */
const MODEL = {
	id: "kilo-auto/free",
	name: "Kilo Auto Free",
	context_length: 128_000,
	max_completion_tokens: 16_384,
	supported_parameters: ["tools"],
	isFree: true,
	preferredIndex: 0,
};

/** Enough of Kilo's API for device sign-in, the profile, balance and an organisation switch. */
export async function startStandInKiloApi(): Promise<StandInKiloApi> {
	let approved = false;
	const organizationsSeen: string[] = [];
	const json = (response: ServerResponse, body: unknown, status = 200) => {
		response.writeHead(status, { "content-type": "application/json" });
		response.end(JSON.stringify(body));
	};
	const server: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
		const url = new URL(request.url ?? "/", "http://kilo.test");
		const organization = request.headers["x-kilocode-organizationid"];
		if (typeof organization === "string") organizationsSeen.push(organization);
		if (url.pathname === "/api/device-auth/codes" && request.method === "POST") {
			return json(response, {
				code: "ABCD-1234",
				verificationUrl: `http://${request.headers.host}/device-auth?code=ABCD-1234`,
				expiresIn: 600,
			});
		}
		if (url.pathname === "/api/device-auth/codes/ABCD-1234") {
			if (!approved) {
				response.writeHead(202);
				return response.end();
			}
			return json(response, { status: "approved", token: TOKEN, userEmail: "ada@example.com" });
		}
		if (url.pathname === "/api/profile") {
			if (request.headers.authorization !== `Bearer ${TOKEN}`) return json(response, {}, 401);
			return json(response, {
				user: { email: "ada@example.com", name: "Ada Lovelace" },
				organizations: [{ id: "org-1", name: "Analytical Engines", role: "owner" }],
			});
		}
		if (url.pathname === "/api/profile/balance") return json(response, { balance: 12.5 });
		if (/^\/api\/(?:gateway\/|openrouter\/|v1\/|gateway\/v1\/)?models$/.test(url.pathname)) {
			return json(response, { data: [MODEL] });
		}
		if (/^\/api\/(?:gateway\/v1\/|v1\/)?organizations\/[^/]+\/models$/.test(url.pathname)) {
			return json(response, { data: [MODEL] });
		}
		if (/^\/api\/(?:organizations\/[^/]+\/)?defaults$/.test(url.pathname)) {
			return json(response, { defaultModel: MODEL.id, defaultFreeModel: MODEL.id });
		}
		response.writeHead(404);
		response.end();
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}`,
		approve: () => {
			approved = true;
		},
		organizationsSeen,
		async stop() {
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}
