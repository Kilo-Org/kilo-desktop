import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import type { MainSdkLogger } from "@kilo-desktop/feature-sdk/main";
import { FeatureError } from "@kilo-desktop/feature-sdk/main";

import { REPODATA_FIND_MAX_LIMIT } from "../../../contracts/providers/conda.js";
import { SidecarCondaBackend } from "./SidecarCondaBackend.js";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("node:child_process", () => ({
	spawn: vi.fn(),
}));

vi.mock("vscode-jsonrpc/node", () => ({
	createMessageConnection: vi.fn(),
	StreamMessageReader: vi.fn(),
	StreamMessageWriter: vi.fn(),
	CancellationTokenSource: class {
		token = {
			isCancellationRequested: false,
			onCancellationRequested: () => ({ dispose() {} }),
		};
		cancel() {}
		dispose() {}
	},
	ResponseError: class ResponseError extends Error {
		code: number;
		data: unknown;
		constructor(code: number, message: string, data?: unknown) {
			super(message);
			this.code = code;
			this.data = data;
		}
	},
}));

import { spawn } from "node:child_process";
import { createMessageConnection, ResponseError } from "vscode-jsonrpc/node";

/**
 * The startup probe is `bridge.ping` (with a `conda.info` fallback for older
 * payloads); mocks answer both so each test only scripts the call under test.
 */
function isHealthCheck(method: string): boolean {
	return method === "bridge.ping" || method === "conda.info";
}

const silentLogger: MainSdkLogger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
};

function createMockProcess() {
	const proc = new EventEmitter() as EventEmitter & {
		stdin: Writable;
		stdout: Readable;
		stderr: Readable;
		killed: boolean;
		exitCode: number | null;
		signalCode: NodeJS.Signals | null;
		kill: ReturnType<typeof vi.fn>;
	};
	proc.stdin = new Writable({ write: (_chunk, _enc, cb) => cb() });
	proc.stdout = new Readable({ read() {} });
	proc.stderr = new Readable({ read() {} });
	proc.killed = false;
	proc.exitCode = null;
	proc.signalCode = null;
	proc.kill = vi.fn(() => {
		proc.killed = true;
	});
	return proc;
}

function createMockConnection() {
	return {
		listen: vi.fn(),
		sendRequest: vi.fn(),
		dispose: vi.fn(),
		onClose: vi.fn(),
		onError: vi.fn(),
	};
}

describe("SidecarCondaBackend", () => {
	let mockProcess: ReturnType<typeof createMockProcess>;
	let mockConnection: ReturnType<typeof createMockConnection>;

	beforeEach(() => {
		mockProcess = createMockProcess();
		mockConnection = createMockConnection();
		vi.mocked(spawn).mockReturnValue(mockProcess as never);
		vi.mocked(createMessageConnection).mockReturnValue(mockConnection as never);
		// Make the initial health check succeed
		mockConnection.sendRequest.mockResolvedValue({});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	function createBackend() {
		return new SidecarCondaBackend({
			bridgeBinaryPath: "/path/to/anaconda-desktop-bridge",
			logger: silentLogger,
		});
	}

	describe("list()", () => {
		it("maps describe_environments response to CondaEnv[]", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "conda_tools.describe_environments") {
					return Promise.resolve({
						environments: [
							{ name: "base", prefix: "/home/user/miniconda3" },
							{ name: "myenv", prefix: "/home/user/miniconda3/envs/myenv" },
							{ name: null, prefix: "/opt/conda/envs/anonymous" },
						],
					});
				}
				return Promise.resolve({});
			});

			const backend = createBackend();
			const result = await backend.list();

			expect(result).toEqual([
				{ name: "base", prefix: "/home/user/miniconda3" },
				{ name: "myenv", prefix: "/home/user/miniconda3/envs/myenv" },
				{ name: "", prefix: "/opt/conda/envs/anonymous" },
			]);
		});

		it("handles bare array response from bridge", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "conda_tools.describe_environments") {
					return Promise.resolve([
						{ name: "base", prefix: "/opt/anaconda3" },
						{ name: "dev", prefix: "/opt/anaconda3/envs/dev" },
					]);
				}
				return Promise.resolve({});
			});

			const backend = createBackend();
			const result = await backend.list();

			expect(result).toEqual([
				{ name: "base", prefix: "/opt/anaconda3" },
				{ name: "dev", prefix: "/opt/anaconda3/envs/dev" },
			]);
		});
	});

	describe("findDistributions()", () => {
		it("sends conda_tools.find_distributions with no params and maps prefix + priority", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "conda_tools.find_distributions") {
					return Promise.resolve([
						{ prefix: "/opt/miniconda3", details: { priority: 10, conda_root: true, depth: 0 } },
						{ prefix: "/home/user/anaconda3", details: { priority: 5 } },
					]);
				}
				return Promise.resolve({});
			});

			const backend = createBackend();
			const result = await backend.findDistributions();

			expect(result).toEqual([
				{ prefix: "/opt/miniconda3", priority: 10 },
				{ prefix: "/home/user/anaconda3", priority: 5 },
			]);
			expect(mockConnection.sendRequest).toHaveBeenCalledWith(
				"conda_tools.find_distributions",
				{},
				expect.anything(),
			);
		});

		it("defaults priority to 0 when details or priority is absent", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "conda_tools.find_distributions") {
					return Promise.resolve([
						{ prefix: "/opt/no-details" },
						{ prefix: "/opt/empty-details", details: {} },
					]);
				}
				return Promise.resolve({});
			});

			const backend = createBackend();
			expect(await backend.findDistributions()).toEqual([
				{ prefix: "/opt/no-details", priority: 0 },
				{ prefix: "/opt/empty-details", priority: 0 },
			]);
		});

		it("skips malformed rows instead of throwing so one bad entry cannot fail discovery", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "conda_tools.find_distributions") {
					return Promise.resolve([
						null,
						{ details: { priority: 3 } },
						{ prefix: "", details: { priority: 4 } },
						{ prefix: "/opt/good", details: { priority: 7 } },
					]);
				}
				return Promise.resolve({});
			});

			const backend = createBackend();
			expect(await backend.findDistributions()).toEqual([{ prefix: "/opt/good", priority: 7 }]);
		});

		it("tolerates an object envelope the way list() does for describe_environments", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "conda_tools.find_distributions") {
					return Promise.resolve({
						distributions: [{ prefix: "/opt/enveloped", details: { priority: 2 } }],
					});
				}
				return Promise.resolve({});
			});

			const backend = createBackend();
			expect(await backend.findDistributions()).toEqual([
				{ prefix: "/opt/enveloped", priority: 2 },
			]);
		});

		it("returns an empty list when the bridge returns neither an array nor distributions", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "conda_tools.find_distributions") return Promise.resolve({});
				return Promise.resolve({});
			});

			const backend = createBackend();
			expect(await backend.findDistributions()).toEqual([]);
		});
	});

	describe("clone()", () => {
		// The bridge's conda.clone model uses a to_camel alias generator with
		// extra="forbid", so a snake_case key here is a hard RPC error. These
		// assertions pin the exact camelCase wire shape.
		it("sends conda.clone with camelCase destinationName + source name", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "conda.clone") {
					return Promise.resolve({
						success: true,
						srcPrefix: "/home/user/miniconda3/envs/source",
						dstPrefix: "/home/user/miniconda3/envs/cloned",
					});
				}
				return Promise.resolve({});
			});

			const backend = createBackend();
			const result = await backend.clone({ sourceName: "source", name: "cloned" });

			expect(result).toEqual({
				name: "cloned",
				prefix: "/home/user/miniconda3/envs/cloned",
			});
			expect(mockConnection.sendRequest).toHaveBeenCalledWith(
				"conda.clone",
				{ destinationName: "cloned", name: "source" },
				expect.anything(),
			);
		});

		it("derives destinationPrefix from sourcePrefix to preserve the root location", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "conda.clone") {
					return Promise.resolve({
						success: true,
						srcPrefix: "/home/user/miniconda3/envs/myenv",
						dstPrefix: "/home/user/miniconda3/envs/myenv-backup",
					});
				}
				return Promise.resolve({});
			});

			const backend = createBackend();
			const result = await backend.clone({
				sourceName: "myenv",
				sourcePrefix: "/home/user/miniconda3/envs/myenv",
				name: "myenv-backup",
			});

			expect(result).toEqual({
				name: "myenv-backup",
				prefix: "/home/user/miniconda3/envs/myenv-backup",
			});
			// Should send destinationPrefix (not destinationName) derived from
			// the source's parent directory to keep the clone co-located.
			expect(mockConnection.sendRequest).toHaveBeenCalledWith(
				"conda.clone",
				{
					destinationPrefix: "/home/user/miniconda3/envs/myenv-backup",
					prefix: "/home/user/miniconda3/envs/myenv",
				},
				expect.anything(),
			);
		});

		it("clones the base env into the distribution's own envs directory", async () => {
			// A real distribution root carries envs/ (and pkgs/); an ordinary env
			// does not. Build one on disk so the filesystem check drives the
			// decision exactly as it will in production.
			const root = mkdtempSync(join(tmpdir(), "sidecar-clone-"));
			mkdirSync(join(root, "envs"));
			try {
				mockConnection.sendRequest.mockImplementation((method: string) => {
					if (isHealthCheck(method)) return Promise.resolve({});
					if (method === "conda.clone") {
						return Promise.resolve({
							success: true,
							srcPrefix: root,
							dstPrefix: join(root, "envs", "base-backup"),
						});
					}
					return Promise.resolve({});
				});

				const backend = createBackend();
				const result = await backend.clone({
					sourceName: "base",
					sourcePrefix: root,
					name: "base-backup",
				});

				expect(result).toEqual({ name: "base-backup", prefix: join(root, "envs", "base-backup") });
				// Not the parent-derived `<parent>/base-backup`, and not
				// destinationName (which the sidecar would resolve into its own
				// envs_dirs) — the clone stays inside the user's distribution.
				expect(mockConnection.sendRequest).toHaveBeenCalledWith(
					"conda.clone",
					{ destinationPrefix: join(root, "envs", "base-backup"), prefix: root },
					expect.anything(),
				);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		});

		it("falls back to destinationName for a -p env outside any envs directory", async () => {
			const prefix = mkdtempSync(join(tmpdir(), "sidecar-clone-p-"));
			mkdirSync(join(prefix, "conda-meta"));
			try {
				mockConnection.sendRequest.mockImplementation((method: string) => {
					if (isHealthCheck(method)) return Promise.resolve({});
					if (method === "conda.clone") {
						return Promise.resolve({
							success: true,
							srcPrefix: prefix,
							dstPrefix: "/home/user/.conda/envs/copy",
						});
					}
					return Promise.resolve({});
				});

				const backend = createBackend();
				await backend.clone({ sourceName: "", sourcePrefix: prefix, name: "copy" });

				expect(mockConnection.sendRequest).toHaveBeenCalledWith(
					"conda.clone",
					{ destinationName: "copy", prefix },
					expect.anything(),
				);
			} finally {
				rmSync(prefix, { recursive: true, force: true });
			}
		});

		it("throws SOLVE_FAILED when the bridge reports success=false", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "conda.clone") {
					return Promise.resolve({
						success: false,
						srcPrefix: "/path/to/source",
						dstPrefix: "/path/to/env",
					});
				}
				return Promise.resolve({});
			});

			const backend = createBackend();
			await expect(backend.clone({ sourceName: "source", name: "cloned" })).rejects.toThrow(
				"clone failed",
			);
		});
	});

	describe("createFromFile()", () => {
		it("sends conda.create_from_file with snake_case file and omits name when absent", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "conda.create_from_file") {
					return Promise.resolve({
						prefix: "/home/user/miniconda3/envs/fromfile",
						success: true,
					});
				}
				return Promise.resolve({});
			});

			const backend = createBackend();
			const result = await backend.createFromFile({ file: "/tmp/env.yml" });

			// No name override, so the env name is derived from the prefix.
			expect(result).toEqual({
				name: "fromfile",
				prefix: "/home/user/miniconda3/envs/fromfile",
			});
			// Exact-shape assertion: `name` must be absent, not undefined.
			expect(mockConnection.sendRequest).toHaveBeenCalledWith(
				"conda.create_from_file",
				{ file: "/tmp/env.yml" },
				expect.anything(),
			);
		});

		it("derives the name from a trailing-separator prefix instead of yielding an empty name", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "conda.create_from_file") {
					return Promise.resolve({ prefix: "/envs/fromfile/", success: true });
				}
				return Promise.resolve({});
			});

			const backend = createBackend();
			expect(await backend.createFromFile({ file: "/tmp/env.yml" })).toEqual({
				name: "fromfile",
				prefix: "/envs/fromfile/",
			});
		});

		it("derives the name from a Windows prefix", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "conda.create_from_file") {
					return Promise.resolve({ prefix: "C:\\Users\\me\\envs\\winenv", success: true });
				}
				return Promise.resolve({});
			});

			const backend = createBackend();
			expect(await backend.createFromFile({ file: "/tmp/env.yml" })).toEqual({
				name: "winenv",
				prefix: "C:\\Users\\me\\envs\\winenv",
			});
		});

		it("forwards the name override when provided", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "conda.create_from_file") {
					return Promise.resolve({ prefix: "/envs/override", success: true });
				}
				return Promise.resolve({});
			});

			const backend = createBackend();
			const result = await backend.createFromFile({ file: "/tmp/env.yml", name: "override" });

			expect(result).toEqual({ name: "override", prefix: "/envs/override" });
			expect(mockConnection.sendRequest).toHaveBeenCalledWith(
				"conda.create_from_file",
				{ file: "/tmp/env.yml", name: "override" },
				expect.anything(),
			);
		});

		it("throws SOLVE_FAILED when the bridge reports success=false", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "conda.create_from_file") {
					return Promise.resolve({
						prefix: "/path/to/env",
						success: false,
						message: "environment file is invalid",
					});
				}
				return Promise.resolve({});
			});

			const backend = createBackend();
			await expect(backend.createFromFile({ file: "/tmp/bad.yml" })).rejects.toThrow(
				"environment file is invalid",
			);
		});
	});

	describe("create()", () => {
		it("sends conda.create with skip_preview=true", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "conda.create") {
					return Promise.resolve({
						prefix: "/home/user/miniconda3/envs/newenv",
						success: true,
					});
				}
				return Promise.resolve({});
			});

			const backend = createBackend();
			const result = await backend.create({ name: "newenv", packages: ["numpy"] });

			expect(result).toEqual({
				name: "newenv",
				prefix: "/home/user/miniconda3/envs/newenv",
			});

			// Verify the call was made with correct params
			expect(mockConnection.sendRequest).toHaveBeenCalledWith(
				"conda.create",
				{
					name: "newenv",
					packages: ["numpy"],
					channels: undefined,
					skip_preview: true,
				},
				// Per-request cancellation token (see #call).
				expect.anything(),
			);
		});

		it("sends prefix instead of name when prefix option is provided", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "conda.create") {
					return Promise.resolve({
						prefix: "/custom/root/envs/newenv",
						success: true,
					});
				}
				return Promise.resolve({});
			});

			const backend = createBackend();
			const result = await backend.create({ name: "newenv", packages: ["numpy"] }, undefined, {
				prefix: "/custom/root/envs/newenv",
			});

			expect(result).toEqual({
				name: "newenv",
				prefix: "/custom/root/envs/newenv",
			});

			expect(mockConnection.sendRequest).toHaveBeenCalledWith(
				"conda.create",
				{
					prefix: "/custom/root/envs/newenv",
					packages: ["numpy"],
					channels: undefined,
					skip_preview: true,
				},
				expect.anything(),
			);
		});
	});

	describe("remove()", () => {
		it("sends conda.remove with all=true", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "conda.remove") {
					return Promise.resolve({ prefix: "", success: true });
				}
				return Promise.resolve({});
			});

			const backend = createBackend();
			await backend.remove({ name: "oldenv" });

			expect(mockConnection.sendRequest).toHaveBeenCalledWith(
				"conda.remove",
				{
					name: "oldenv",
					all: true,
					skip_preview: true,
				},
				expect.anything(),
			);
		});
	});

	describe("uninstall()", () => {
		it("sends conda.remove with the packages and skip_preview", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "conda.remove") {
					return Promise.resolve({ prefix: "/path/to/env", success: true });
				}
				return Promise.resolve({});
			});

			const backend = createBackend();
			await backend.uninstall({ name: "dev", packages: ["faker"] });

			expect(mockConnection.sendRequest).toHaveBeenCalledWith(
				"conda.remove",
				{ name: "dev", packages: ["faker"], skip_preview: true },
				expect.anything(),
			);
		});

		it("reports the actual unlinked set (requested + orphaned deps) from actions.UNLINK", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "conda.remove") {
					return Promise.resolve({
						prefix: "/path/to/env",
						success: true,
						actions: {
							UNLINK: [
								"conda-forge/noarch::faker==40.38.0=pyh5ded981_0",
								"conda-forge/noarch::python-tzdata==2026.3=pyhd8ed1ab_0",
							],
						},
					});
				}
				return Promise.resolve({});
			});

			const backend = createBackend();
			const result = await backend.uninstall({ name: "dev", packages: ["faker"] });

			expect(result).toEqual({
				jobId: "",
				envName: "dev",
				// faker plus the now-orphaned python-tzdata it pulled in.
				removed: ["faker", "python-tzdata"],
			});
		});

		it("falls back to the requested specs — normalized to bare names — when the bridge omits actions", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "conda.remove") {
					return Promise.resolve({ prefix: "/path/to/env", success: true });
				}
				return Promise.resolve({});
			});

			const backend = createBackend();
			const result = await backend.uninstall({
				name: "dev",
				// Qualified MatchSpecs must be reduced to bare names so the fallback
				// matches the UNLINK-derived shape of the primary path.
				packages: ["conda-forge::pandas=2.*", "numpy>=1.24"],
			});

			expect(result.removed).toEqual(["pandas", "numpy"]);
		});
	});

	describe("update()", () => {
		it("sends conda.update with packages, update_all=false, and skip_preview", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "conda.update") {
					return Promise.resolve({ prefix: "/path/to/env", success: true });
				}
				if (method === "conda.list")
					return Promise.resolve({ prefix: "/path/to/env", packages: [] });
				return Promise.resolve({});
			});

			const backend = createBackend();
			await backend.update({ name: "dev", packages: ["numpy"] });

			expect(mockConnection.sendRequest).toHaveBeenCalledWith(
				"conda.update",
				{
					name: "dev",
					packages: ["numpy"],
					channels: undefined,
					update_all: false,
					skip_preview: true,
				},
				expect.anything(),
			);
		});

		it("sends conda.update with update_all=true and no packages key", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "conda.update") {
					return Promise.resolve({ prefix: "/path/to/env", success: true });
				}
				if (method === "conda.list")
					return Promise.resolve({ prefix: "/path/to/env", packages: [] });
				return Promise.resolve({});
			});

			const backend = createBackend();
			await backend.update({ name: "dev", updateAll: true });

			expect(mockConnection.sendRequest).toHaveBeenCalledWith(
				"conda.update",
				{ name: "dev", channels: undefined, update_all: true, skip_preview: true },
				expect.anything(),
			);
		});

		it("reports the LINKed set, re-listed for full records, as `updated`", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "conda.update") {
					return Promise.resolve({
						prefix: "/path/to/env",
						success: true,
						actions: { LINK: ["conda-forge/noarch::numpy==1.26.4=py311_0"] },
					});
				}
				if (method === "conda.list") {
					return Promise.resolve({
						prefix: "/path/to/env",
						packages: [
							{
								name: "numpy",
								version: "1.26.4",
								build_string: "py311_0",
								build_number: 0,
								channel: "conda-forge",
							},
							{
								name: "pip",
								version: "24.0",
								build_string: "pyhd8ed1ab_0",
								build_number: 0,
								channel: "conda-forge",
							},
						],
					});
				}
				return Promise.resolve({});
			});

			const backend = createBackend();
			const result = await backend.update({ name: "dev", packages: ["numpy"] });

			expect(result).toEqual({
				jobId: "",
				envName: "dev",
				// only numpy was LINKed; pip is unchanged and excluded.
				updated: [{ name: "numpy", version: "1.26.4", build: "py311_0", channel: "conda-forge" }],
			});
		});

		it("throws SOLVE_FAILED when the bridge returns success=false", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "conda.update") {
					return Promise.resolve({ prefix: "/path/to/env", success: false, message: "conflict" });
				}
				return Promise.resolve({});
			});

			const backend = createBackend();
			await expect(backend.update({ name: "dev", updateAll: true })).rejects.toThrow(
				"SOLVE_FAILED",
			);
		});
	});

	describe("listPackages()", () => {
		it("maps conda.list response to CondaPackage[]", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "conda.list") {
					return Promise.resolve({
						prefix: "/home/user/miniconda3/envs/myenv",
						packages: [
							{
								name: "numpy",
								version: "1.26.0",
								build_string: "py311h123",
								build_number: 0,
								channel: "conda-forge",
							},
						],
					});
				}
				return Promise.resolve({});
			});

			const backend = createBackend();
			const result = await backend.listPackages({ name: "myenv" });

			expect(result).toEqual([
				{
					name: "numpy",
					version: "1.26.0",
					build: "py311h123",
					channel: "conda-forge",
				},
			]);
		});
	});

	describe("listChannels()", () => {
		it("maps wrapped list_channels response to Channel[]", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "conda_tools.list_channels") {
					// The bridge returns list[ChannelMetadata] directly (not
					// wrapped in { channels: [...] }).
					return Promise.resolve([
						{ name: "conda-forge", urls: ["https://conda.anaconda.org/conda-forge"] },
						{ name: "defaults", urls: ["https://repo.anaconda.com/pkgs/main"] },
					]);
				}
				return Promise.resolve({});
			});

			const backend = createBackend();
			const result = await backend.listChannels();

			expect(result).toEqual(["conda-forge", "defaults"]);
		});

		it("maps bare-array list_channels response to Channel[]", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "conda_tools.list_channels") {
					return Promise.resolve([
						{
							name: "defaults",
							urls: [
								"https://repo.anaconda.com/pkgs/main/osx-arm64",
								"https://repo.anaconda.com/pkgs/main/noarch",
							],
						},
					]);
				}
				return Promise.resolve({});
			});

			const backend = createBackend();
			const result = await backend.listChannels();

			expect(result).toEqual(["defaults"]);
		});
	});

	describe("addChannel()", () => {
		it("sends conda_config.add then returns updated channels", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "conda_config.add") {
					return Promise.resolve({ success: true });
				}
				if (method === "conda_tools.list_channels") {
					return Promise.resolve([{ name: "my-channel" }, { name: "conda-forge" }]);
				}
				return Promise.resolve({});
			});

			const backend = createBackend();
			const result = await backend.addChannel("my-channel");

			expect(mockConnection.sendRequest).toHaveBeenCalledWith(
				"conda_config.add",
				{
					key: "channels",
					value: "my-channel",
				},
				expect.anything(),
			);
			expect(result).toEqual(["my-channel", "conda-forge"]);
		});
	});

	describe("findRepodata()", () => {
		/**
		 * Shaped from the bridge's own `RepodataPackage` pydantic model: the
		 * response is keyed by package name, `build` is the newest version's
		 * build *number*, and `versions` maps version → { size }.
		 */
		function repodataResponse() {
			return {
				numpy: {
					home: "https://numpy.org",
					summary: "Array computing with Python",
					channel: "https://conda.anaconda.org/conda-forge",
					build: 2,
					version: "1.26.0",
					versions: {
						"1.26.0": { size: 7_000_000 },
						"1.25.0": { size: 6_500_000 },
					},
				},
				pip: {
					home: "https://pip.pypa.io",
					summary: "PyPA package installer",
					channel: "https://conda.anaconda.org/conda-forge",
					build: 0,
					version: "24.0",
					versions: { "24.0": { size: 1_200_000 } },
				},
			};
		}

		it("calls repodata.find — not conda.search — and takes the package name from the map key", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "repodata.find") return Promise.resolve(repodataResponse());
				return Promise.resolve({});
			});

			const backend = createBackend();
			const result = await backend.findRepodata({ names: ["numpy", "pip"] });

			expect(mockConnection.sendRequest).toHaveBeenCalledWith(
				"repodata.find",
				{ names: ["numpy", "pip"], limit: REPODATA_FIND_MAX_LIMIT + 1 },
				expect.anything(),
			);
			expect(result).toEqual([
				{
					name: "numpy",
					version: "1.26.0",
					build: 2,
					channel: "https://conda.anaconda.org/conda-forge",
					summary: "Array computing with Python",
					home: "https://numpy.org",
					versions: [
						{ version: "1.26.0", size: 7_000_000 },
						{ version: "1.25.0", size: 6_500_000 },
					],
				},
				{
					name: "pip",
					version: "24.0",
					build: 0,
					channel: "https://conda.anaconda.org/conda-forge",
					summary: "PyPA package installer",
					home: "https://pip.pypa.io",
					versions: [{ version: "24.0", size: 1_200_000 }],
				},
			]);
		});

		it("forwards channels and subdirs, and omits filters the caller left unset", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "repodata.find") return Promise.resolve({});
				return Promise.resolve({});
			});

			const backend = createBackend();
			await backend.findRepodata({
				names: ["numpy"],
				channels: ["conda-forge", "defaults"],
				subdirs: ["osx-arm64", "noarch"],
			});

			expect(mockConnection.sendRequest).toHaveBeenCalledWith(
				"repodata.find",
				{
					names: ["numpy"],
					channels: ["conda-forge", "defaults"],
					subdirs: ["osx-arm64", "noarch"],
					limit: REPODATA_FIND_MAX_LIMIT + 1,
				},
				expect.anything(),
			);
		});

		it("sends only the bounded limit for an unfiltered catalog walk", async () => {
			// The bridge reads a missing `names` as "no filter" and an empty array
			// as "return nothing", so an unset filter must be omitted, never sent
			// as `names: []`. The limit keeps the bridge from serialising the
			// whole channel index over stdio.
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "repodata.find") return Promise.resolve({});
				return Promise.resolve({});
			});

			const backend = createBackend();
			await backend.findRepodata({});

			expect(mockConnection.sendRequest).toHaveBeenCalledWith(
				"repodata.find",
				{ limit: REPODATA_FIND_MAX_LIMIT + 1 },
				expect.anything(),
			);
		});

		it("omits empty filter arrays so the bridge never receives names: []", async () => {
			// The IPC schema rejects empty arrays, but the CondaRepodataFilter
			// type permits them, so a direct in-process caller could pass
			// `names: []`. toRepodataFindParams is the single guard that keeps
			// that from reaching the bridge as "return nothing".
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "repodata.find") return Promise.resolve({});
				return Promise.resolve({});
			});

			const backend = createBackend();
			await backend.findRepodata({ names: [], channels: [], subdirs: [] });

			expect(mockConnection.sendRequest).toHaveBeenCalledWith(
				"repodata.find",
				{ limit: REPODATA_FIND_MAX_LIMIT + 1 },
				expect.anything(),
			);
		});

		it("bounds the materialised set at REPODATA_FIND_MAX_LIMIT + 1 to keep truncation exact", async () => {
			// An unfiltered walk can return the whole channel index. The backend
			// must not materialise, sort, and cache tens of thousands of records;
			// it retains one more than the max the handler can ask for, so the
			// handler's `matches.length > limit` truncation flag stays exact.
			const oversized: Record<string, unknown> = {};
			for (let i = 0; i < REPODATA_FIND_MAX_LIMIT + 500; i++) {
				oversized[`pkg-${i}`] = {
					home: "",
					summary: "",
					channel: "",
					build: 0,
					version: "1.0.0",
					versions: { "1.0.0": { size: 1 } },
				};
			}
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "repodata.find") return Promise.resolve(oversized);
				return Promise.resolve({});
			});

			const backend = createBackend();
			const result = await backend.findRepodata({});

			expect(result).toHaveLength(REPODATA_FIND_MAX_LIMIT + 1);
		});

		it("forwards a partial-match query so the bridge filters and ranks", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				return Promise.resolve({});
			});

			const backend = createBackend();
			await backend.findRepodata({ query: "numpy", channels: ["conda-forge"] });

			expect(mockConnection.sendRequest).toHaveBeenCalledWith(
				"repodata.find",
				{ query: "numpy", channels: ["conda-forge"], limit: REPODATA_FIND_MAX_LIMIT + 1 },
				expect.anything(),
			);
		});

		it("ranks query matches itself when an older bridge ignores query and returns the whole index", async () => {
			const record = {
				home: "",
				summary: "",
				channel: "",
				build: 0,
				version: "1.0.0",
				versions: { "1.0.0": { size: 1 } },
			};
			const unfilteredIndex = {
				unrelated: record,
				"scikit-numpy": record,
				numpydoc: record,
				NumPy: record,
				"also-numpy": record,
			};
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "repodata.find") return Promise.resolve(unfilteredIndex);
				return Promise.resolve({});
			});

			const backend = createBackend();
			const result = await backend.findRepodata({ query: "numpy" });

			// exact > prefix > substring (case-insensitive), stable within a rank;
			// non-matches are dropped.
			expect(result.map((pkg) => pkg.name)).toEqual([
				"NumPy",
				"numpydoc",
				"scikit-numpy",
				"also-numpy",
			]);
		});

		it("returns an empty array when the index has no matching packages", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "repodata.find") return Promise.resolve({});
				return Promise.resolve({});
			});

			const backend = createBackend();
			expect(await backend.findRepodata({ names: ["nonexistent"] })).toEqual([]);
		});

		it("tolerates a record with no usable version and defaulted metadata", async () => {
			// `RepodataPackage` defaults version to None and the string fields to
			// "", so the mapping must not assume they are populated.
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "repodata.find") {
					return Promise.resolve({
						weird: { home: "", summary: "", channel: "", build: 0, version: null, versions: {} },
					});
				}
				return Promise.resolve({});
			});

			const backend = createBackend();
			expect(await backend.findRepodata({ names: ["weird"] })).toEqual([
				{
					name: "weird",
					version: null,
					build: 0,
					channel: "",
					summary: "",
					home: "",
					versions: [],
				},
			]);
		});

		it("orders versions newest-first even when version strings are purely numeric keys", async () => {
			// The bridge sends `versions` as a JSON object keyed by version
			// string, in its own newest-first order. But `Object.entries`
			// enumerates integer-index-like keys (e.g. CalVer "20240101") in
			// ascending numeric order regardless of insertion order, so relying
			// on key order would silently flip such packages oldest-first.
			// The backend must impose the newest-first contract explicitly.
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "repodata.find") {
					return Promise.resolve({
						calver: {
							home: "",
							summary: "",
							channel: "https://conda.anaconda.org/conda-forge",
							build: 0,
							version: "20240301",
							// Deliberately provided oldest-first to prove the
							// backend sorts rather than trusting object order.
							versions: {
								"20220101": { size: 100 },
								"20230201": { size: 200 },
								"20240301": { size: 300 },
							},
						},
					});
				}
				return Promise.resolve({});
			});

			const backend = createBackend();
			const [pkg] = await backend.findRepodata({ names: ["calver"] });

			expect(pkg?.versions).toEqual([
				{ version: "20240301", size: 300 },
				{ version: "20230201", size: 200 },
				{ version: "20220101", size: 100 },
			]);
		});

		it("orders mixed numeric and dotted version strings newest-first", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "repodata.find") {
					return Promise.resolve({
						mixed: {
							home: "",
							summary: "",
							channel: "c",
							build: 0,
							version: "10",
							versions: {
								"2": { size: 2 },
								"10": { size: 10 },
								"1.5": { size: 15 },
							},
						},
					});
				}
				return Promise.resolve({});
			});

			const backend = createBackend();
			const [pkg] = await backend.findRepodata({ names: ["mixed"] });

			expect(pkg?.versions.map((v) => v.version)).toEqual(["10", "2", "1.5"]);
		});
	});

	describe("removeChannel()", () => {
		it("throws PROVIDER_NOT_READY", async () => {
			const backend = createBackend();
			await expect(backend.removeChannel("conda-forge")).rejects.toThrow("PROVIDER_NOT_READY");
		});
	});

	describe("error handling", () => {
		it("maps ResponseError with known domain_code to granular EnvironmentsErrorCode", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				throw new ResponseError(-32000, "env not found", {
					code: "conda:environment:not-found",
					message: "Requested conda environment not found",
				});
			});

			const backend = createBackend();
			await expect(backend.list()).rejects.toThrow("ENV_NOT_FOUND");
		});

		it("maps conda:environment:already-exists to ENV_EXISTS", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				throw new ResponseError(-32000, "already exists", {
					code: "conda:environment:already-exists",
					message: "Environment 'myenv' already exists",
				});
			});

			const backend = createBackend();
			await expect(backend.create({ name: "myenv", packages: [] })).rejects.toThrow("ENV_EXISTS");
		});

		it("maps conda:package:not-found to PACKAGE_NOT_FOUND", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				throw new ResponseError(-32000, "not found", {
					code: "conda:package:not-found",
					message: "Package 'foobar' not found",
				});
			});

			const backend = createBackend();
			await expect(backend.list()).rejects.toThrow("PACKAGE_NOT_FOUND");
		});

		it("falls back to PROVIDER_NOT_READY for unknown domain_code and logs warning", async () => {
			const warnSpy = vi.fn();
			const loggerWithSpy: MainSdkLogger = { ...silentLogger, warn: warnSpy };

			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				throw new ResponseError(-32000, "something novel", {
					code: "conda:unknown:thing",
					message: "Something unexpected",
				});
			});

			const backend = new SidecarCondaBackend({
				bridgeBinaryPath: "/path/to/anaconda-desktop-bridge",
				logger: loggerWithSpy,
			});
			await expect(backend.list()).rejects.toThrow("PROVIDER_NOT_READY");
			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringContaining("Unmapped domain_code: conda:unknown:thing"),
			);
		});

		it("maps a 'prefix already exists' conda exception (no domain code) to ENV_EXISTS", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				// The bridge relays raw conda exceptions without a domain code.
				throw new ResponseError(
					-32000,
					"conda.exceptions.CondaValueError: prefix already exists: /Users/x/.conda/envs/faker",
				);
			});

			const backend = createBackend();
			await expect(backend.create({ name: "faker", packages: [] })).rejects.toThrow("ENV_EXISTS");
		});

		it("falls back to PROVIDER_NOT_READY for ResponseError without data", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				throw new ResponseError(-32601, "method not found");
			});

			const backend = createBackend();
			await expect(backend.list()).rejects.toThrow("PROVIDER_NOT_READY");
			await expect(backend.list()).rejects.toThrow("anaconda-bridge-sidecar error");
		});

		it("wraps non-ResponseError exceptions as PROVIDER_NOT_READY", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				return Promise.reject(new Error("connection reset"));
			});

			const backend = createBackend();
			await expect(backend.list()).rejects.toThrow("PROVIDER_NOT_READY");
			await expect(backend.list()).rejects.toThrow("anaconda-bridge-sidecar error");
		});

		it("throws SOLVE_FAILED when bridge returns success=false on create", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "conda.create") {
					return Promise.resolve({
						prefix: "/path/to/env",
						success: false,
						message: "UnsatisfiableError: conflict for numpy",
					});
				}
				return Promise.resolve({});
			});

			const backend = createBackend();
			await expect(backend.create({ name: "test", packages: ["numpy>=99"] })).rejects.toThrow(
				"SOLVE_FAILED",
			);
		});

		it("throws SOLVE_FAILED when bridge returns success=false on install", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "conda.install") {
					return Promise.resolve({
						prefix: "/path/to/env",
						success: false,
						message: "UnsatisfiableError: conflict",
					});
				}
				return Promise.resolve({});
			});

			const backend = createBackend();
			await expect(backend.install({ name: "myenv", packages: ["numpy>=99"] })).rejects.toThrow(
				"SOLVE_FAILED",
			);
		});

		it("throws SOLVE_FAILED when bridge returns success=false on uninstall", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "conda.remove") {
					return Promise.resolve({
						prefix: "/path/to/env",
						success: false,
						message: "removal failed",
					});
				}
				return Promise.resolve({});
			});

			const backend = createBackend();
			await expect(backend.uninstall({ name: "myenv", packages: ["numpy"] })).rejects.toThrow(
				"SOLVE_FAILED",
			);
		});

		it("includes bridge error message in SOLVE_FAILED detail", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "conda.create") {
					return Promise.resolve({
						prefix: "/path/to/env",
						success: false,
						message: "UnsatisfiableError: conflict for numpy",
					});
				}
				return Promise.resolve({});
			});

			const backend = createBackend();
			await expect(backend.create({ name: "test", packages: ["numpy>=99"] })).rejects.toThrow(
				"UnsatisfiableError: conflict for numpy",
			);
		});

		it("strips ANSI colors and keeps the solver conflict tree in SOLVE_FAILED detail", async () => {
			const solverReport = [
				"Encountered problems while solving:",
				"  - package \u001b[32mcffi =2.1.1 \u001b[0mrequires \u001b[31mlibffi >=3.4.8 \u001b[0m",
				"",
				"The following packages are incompatible",
				"└─ \u001b[31mpin on python =3.11 \u001b[0mis not installable",
			].join("\n");
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "conda.install") {
					return Promise.resolve({
						prefix: "/path/to/env",
						success: false,
						message: solverReport,
					});
				}
				return Promise.resolve({});
			});

			const backend = createBackend();
			const failure = await backend
				.install({ name: "myenv", packages: ["cffi=2.1.1"] })
				.catch((error: unknown) => error);
			expect(failure).toBeInstanceOf(FeatureError);
			expect((failure as FeatureError).message).toBe(
				"SOLVE_FAILED: Encountered problems while solving:\n" +
					"  - package cffi =2.1.1 requires libffi >=3.4.8\n" +
					"\n" +
					"The following packages are incompatible\n" +
					"└─ pin on python =3.11 is not installable",
			);
		});

		it("uses bridge data.message over error.message for detail", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				throw new ResponseError(-32000, "generic rpc message", {
					code: "conda:environment:not-found",
					message: "Detailed: environment 'foo' not found at /path",
				});
			});

			const backend = createBackend();
			await expect(backend.list()).rejects.toThrow(
				"Detailed: environment 'foo' not found at /path",
			);
		});
	});

	describe("abort handling", () => {
		it("throws CANCELLED if signal is already aborted", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				return Promise.resolve({ environments: [] });
			});

			const backend = createBackend();
			const controller = new AbortController();
			controller.abort();

			// Assert on the granular error CODE, not just an incidental
			// substring, so a wrong code with a "cancelled" message wouldn't pass.
			await expect(backend.list({ signal: controller.signal })).rejects.toThrow("JOB_CANCELLED");
		});
	});

	describe("dispose()", () => {
		it("kills the child process", async () => {
			mockConnection.sendRequest.mockResolvedValue({});

			const backend = createBackend();
			// Trigger process start
			await backend.list().catch(() => {});

			backend.dispose();
			expect(mockProcess.kill).toHaveBeenCalledWith("SIGTERM");
		});
	});

	describe("warmUp()", () => {
		it("starts the bridge process ahead of the first call, which then reuses the connection", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return Promise.resolve({});
				if (method === "conda_tools.describe_environments") {
					return Promise.resolve({ environments: [{ name: "base", prefix: "/opt/conda" }] });
				}
				return Promise.resolve({});
			});

			const backend = createBackend();
			await backend.warmUp();
			expect(spawn).toHaveBeenCalledTimes(1);

			// The first real call finds the warmed-up connection — no respawn.
			await backend.list();
			expect(spawn).toHaveBeenCalledTimes(1);
		});

		it("shares one in-flight spawn when a real call races the warm-up", async () => {
			// Gate the health check so warmUp() and list() overlap mid-startup;
			// both must ride the same spawn instead of launching two processes.
			let releaseHealthCheck!: (value: unknown) => void;
			const healthCheckGate = new Promise((resolve) => {
				releaseHealthCheck = resolve;
			});
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (isHealthCheck(method)) return healthCheckGate;
				if (method === "conda_tools.describe_environments") {
					return Promise.resolve({ environments: [{ name: "base", prefix: "/opt/conda" }] });
				}
				return Promise.resolve({});
			});

			const backend = createBackend();
			const warmUp = backend.warmUp();
			const list = backend.list();
			releaseHealthCheck({});
			await Promise.all([warmUp, list]);

			expect(spawn).toHaveBeenCalledTimes(1);
		});
	});

	describe("startup health check", () => {
		it("probes liveness with bridge.ping instead of conda.info", async () => {
			const backend = createBackend();
			await backend.warmUp();

			expect(mockConnection.sendRequest.mock.calls.map(([method]) => method)).toEqual([
				"bridge.ping",
			]);
			backend.dispose();
		});

		it("falls back to conda.info when an older bridge does not know bridge.ping", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (method === "bridge.ping") {
					return Promise.reject(new ResponseError(-32601, "Method Not Found: bridge.ping"));
				}
				return Promise.resolve({});
			});

			const backend = createBackend();
			await expect(backend.warmUp()).resolves.toBeUndefined();

			expect(mockConnection.sendRequest.mock.calls.map(([method]) => method)).toEqual([
				"bridge.ping",
				"conda.info",
			]);
			backend.dispose();
		});

		it("fails startup when bridge.ping fails for a reason other than an unknown method", async () => {
			mockConnection.sendRequest.mockRejectedValue(new ResponseError(-32000, "boom"));

			const backend = createBackend();

			await expect(backend.warmUp()).rejects.toThrow("PROVIDER_NOT_READY");
			backend.dispose();
		});
	});

	describe("automatic restart after an unexpected exit", () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it("does not hand callers the restarted bridge before its health check passes", async () => {
			const first = createMockProcess();
			const restarted = createMockProcess();
			const firstConnection = createMockConnection();
			firstConnection.sendRequest.mockResolvedValue({});
			let releasePing!: (value: unknown) => void;
			const pingGate = new Promise((resolve) => {
				releasePing = resolve;
			});
			const restartedConnection = createMockConnection();
			restartedConnection.sendRequest.mockImplementation((method: string) =>
				isHealthCheck(method) ? pingGate : Promise.resolve({ environments: [] }),
			);
			vi.mocked(spawn)
				.mockReturnValueOnce(first as never)
				.mockReturnValueOnce(restarted as never);
			vi.mocked(createMessageConnection)
				.mockReturnValueOnce(firstConnection as never)
				.mockReturnValueOnce(restartedConnection as never);

			const backend = createBackend();
			await backend.warmUp();
			first.exitCode = 1;
			first.emit("exit", 1, null);
			await vi.advanceTimersByTimeAsync(1_000);
			expect(spawn).toHaveBeenCalledTimes(2);

			const listing = backend.list();
			await vi.advanceTimersByTimeAsync(0);
			const sentBeforeHealthy = restartedConnection.sendRequest.mock.calls.map(
				([method]) => method,
			);
			releasePing({});

			await expect(listing).resolves.toEqual([]);
			expect(sentBeforeHealthy).toEqual(["bridge.ping"]);
			expect(spawn).toHaveBeenCalledTimes(2);
			backend.dispose();
		});
	});

	describe("shutdown of a bridge that failed its health check", () => {
		/** Mirrors Node: `killed` flips when a signal is sent, not when the child exits. */
		function createBridgeProcess(exitsOn: readonly NodeJS.Signals[]) {
			const proc = createMockProcess();
			proc.kill = vi.fn((signal: NodeJS.Signals) => {
				proc.killed = true;
				if (!exitsOn.includes(signal)) return;
				queueMicrotask(() => {
					proc.signalCode = signal;
					proc.emit("exit", null, signal);
				});
			});
			return proc;
		}

		function createBridgeConnection(respond: (method: string) => Promise<unknown>) {
			const connection = createMockConnection();
			connection.sendRequest.mockImplementation(respond);
			return connection;
		}

		const failingHealthCheck = () => Promise.reject(new Error("bridge not ready"));
		const pendingHealthCheck = () => new Promise(() => {});
		const healthyBridge = (method: string) =>
			Promise.resolve(method === "conda_tools.describe_environments" ? { environments: [] } : {});

		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it("does not force-kill the replacement bridge spawned while the failed one shuts down", async () => {
			const failed = createBridgeProcess(["SIGTERM"]);
			const replacement = createBridgeProcess(["SIGTERM"]);
			vi.mocked(spawn)
				.mockReturnValueOnce(failed as never)
				.mockReturnValueOnce(replacement as never);
			vi.mocked(createMessageConnection)
				.mockReturnValueOnce(createBridgeConnection(failingHealthCheck) as never)
				.mockReturnValueOnce(createBridgeConnection(pendingHealthCheck) as never);

			const backend = createBackend();
			await expect(backend.warmUp()).rejects.toThrow("PROVIDER_NOT_READY");
			await vi.advanceTimersByTimeAsync(1_000);
			expect(spawn).toHaveBeenCalledTimes(2);

			await vi.advanceTimersByTimeAsync(5_000);

			expect(replacement.kill).not.toHaveBeenCalled();
			backend.dispose();
		});

		it("force-kills a bridge that ignores SIGTERM", async () => {
			const stubborn = createBridgeProcess(["SIGKILL"]);
			vi.mocked(spawn).mockReturnValueOnce(stubborn as never);
			vi.mocked(createMessageConnection).mockReturnValueOnce(
				createBridgeConnection(failingHealthCheck) as never,
			);

			const backend = createBackend();
			await expect(backend.warmUp()).rejects.toThrow("PROVIDER_NOT_READY");
			await vi.advanceTimersByTimeAsync(5_000);

			expect(stubborn.kill).toHaveBeenCalledWith("SIGKILL");
			backend.dispose();
		});

		it("keeps serving from the replacement bridge when the failed one exits late", async () => {
			const stubborn = createBridgeProcess(["SIGKILL"]);
			const replacement = createBridgeProcess(["SIGTERM"]);
			const replacementConnection = createBridgeConnection(healthyBridge);
			vi.mocked(spawn)
				.mockReturnValueOnce(stubborn as never)
				.mockReturnValueOnce(replacement as never);
			vi.mocked(createMessageConnection)
				.mockReturnValueOnce(createBridgeConnection(failingHealthCheck) as never)
				.mockReturnValueOnce(replacementConnection as never);

			const backend = createBackend();
			await expect(backend.warmUp()).rejects.toThrow("PROVIDER_NOT_READY");
			await expect(backend.list()).resolves.toEqual([]);
			await vi.advanceTimersByTimeAsync(5_000);
			expect(stubborn.kill).toHaveBeenCalledWith("SIGKILL");

			await expect(backend.list()).resolves.toEqual([]);
			expect(spawn).toHaveBeenCalledTimes(2);
			expect(replacementConnection.dispose).not.toHaveBeenCalled();
			backend.dispose();
		});
	});

	describe("bridge telemetry env vars", () => {
		it("passes BRIDGE_TELEMETRY_ENABLED and BRIDGE_TELEMETRY_ENV when telemetry is configured", async () => {
			mockConnection.sendRequest.mockResolvedValue({});

			const backend = new SidecarCondaBackend({
				command: ["/path/to/bridge"],
				logger: silentLogger,
				telemetry: { enabled: () => "1", env: "development" },
			});
			await backend.warmUp();

			const spawnEnv = vi.mocked(spawn).mock.calls[0]?.[2]?.env as Record<string, string>;
			expect(spawnEnv.BRIDGE_TELEMETRY_ENABLED).toBe("1");
			expect(spawnEnv.BRIDGE_TELEMETRY_ENV).toBe("development");
			expect(spawnEnv.BRIDGE_PROTECT_STDIO).toBe("1");
		});

		it("omits BRIDGE_TELEMETRY_* when telemetry is not configured", async () => {
			mockConnection.sendRequest.mockResolvedValue({});

			const backend = new SidecarCondaBackend({
				command: ["/path/to/bridge"],
				logger: silentLogger,
			});
			await backend.warmUp();

			const spawnEnv = vi.mocked(spawn).mock.calls[0]?.[2]?.env as Record<string, string>;
			expect(spawnEnv.BRIDGE_TELEMETRY_ENABLED).toBeUndefined();
			expect(spawnEnv.BRIDGE_TELEMETRY_ENV).toBeUndefined();
			expect(spawnEnv.BRIDGE_PROTECT_STDIO).toBe("1");
		});

		it("evaluates the enabled getter at spawn time so a runtime preference toggle takes effect on restart", async () => {
			mockConnection.sendRequest.mockResolvedValue({});

			let allowed = true;
			const backend = new SidecarCondaBackend({
				command: ["/path/to/bridge"],
				logger: silentLogger,
				telemetry: { enabled: () => (allowed ? "1" : "0"), env: "production" },
			});

			await backend.warmUp();
			const firstEnv = vi.mocked(spawn).mock.calls[0]?.[2]?.env as Record<string, string>;
			expect(firstEnv.BRIDGE_TELEMETRY_ENABLED).toBe("1");

			// Simulate the user disabling data collection
			allowed = false;

			// Force a new spawn by simulating process exit + re-connect
			backend.dispose();
			vi.mocked(spawn).mockClear();
			mockProcess = createMockProcess();
			vi.mocked(spawn).mockReturnValue(mockProcess as never);
			mockConnection = createMockConnection();
			mockConnection.sendRequest.mockResolvedValue({});
			vi.mocked(createMessageConnection).mockReturnValue(mockConnection as never);

			const backend2 = new SidecarCondaBackend({
				command: ["/path/to/bridge"],
				logger: silentLogger,
				telemetry: { enabled: () => (allowed ? "1" : "0"), env: "production" },
			});
			await backend2.warmUp();

			const secondEnv = vi.mocked(spawn).mock.calls[0]?.[2]?.env as Record<string, string>;
			expect(secondEnv.BRIDGE_TELEMETRY_ENABLED).toBe("0");
		});
	});
});
