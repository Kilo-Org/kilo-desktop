import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import type { MainSdkLogger } from "@anaconda-agentic-desktop/feature-sdk/main";

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

const silentLogger: MainSdkLogger = {
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
		kill: ReturnType<typeof vi.fn>;
	};
	proc.stdin = new Writable({ write: (_chunk, _enc, cb) => cb() });
	proc.stdout = new Readable({ read() {} });
	proc.stderr = new Readable({ read() {} });
	proc.killed = false;
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
				if (method === "conda.info") return Promise.resolve({});
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
				if (method === "conda.info") return Promise.resolve({});
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

	describe("create()", () => {
		it("sends conda.create with skip_preview=true", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (method === "conda.info") return Promise.resolve({});
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
	});

	describe("remove()", () => {
		it("sends conda.remove with all=true", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (method === "conda.info") return Promise.resolve({});
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

	describe("listPackages()", () => {
		it("maps conda.list response to CondaPackage[]", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (method === "conda.info") return Promise.resolve({});
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
			const result = await backend.listPackages("myenv");

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
		it("maps list_channels response to Channel[]", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (method === "conda.info") return Promise.resolve({});
				if (method === "conda_tools.list_channels") {
					return Promise.resolve({
						channels: [
							{ name: "conda-forge", url: "https://conda.anaconda.org/conda-forge" },
							{ name: "defaults", url: "https://repo.anaconda.com/pkgs/main" },
						],
					});
				}
				return Promise.resolve({});
			});

			const backend = createBackend();
			const result = await backend.listChannels();

			expect(result).toEqual(["conda-forge", "defaults"]);
		});
	});

	describe("addChannel()", () => {
		it("sends conda_config.add then returns updated channels", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (method === "conda.info") return Promise.resolve({});
				if (method === "conda_config.add") {
					return Promise.resolve({ success: true });
				}
				if (method === "conda_tools.list_channels") {
					return Promise.resolve({
						channels: [{ name: "my-channel" }, { name: "conda-forge" }],
					});
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

	describe("removeChannel()", () => {
		it("throws PROVIDER_NOT_READY", async () => {
			const backend = createBackend();
			await expect(backend.removeChannel("conda-forge")).rejects.toThrow("PROVIDER_NOT_READY");
		});
	});

	describe("error handling", () => {
		it("maps ResponseError with known domain_code to granular EnvironmentsErrorCode", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (method === "conda.info") return Promise.resolve({});
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
				if (method === "conda.info") return Promise.resolve({});
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
				if (method === "conda.info") return Promise.resolve({});
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
				if (method === "conda.info") return Promise.resolve({});
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

		it("falls back to PROVIDER_NOT_READY for ResponseError without data", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (method === "conda.info") return Promise.resolve({});
				throw new ResponseError(-32601, "method not found");
			});

			const backend = createBackend();
			await expect(backend.list()).rejects.toThrow("PROVIDER_NOT_READY");
			await expect(backend.list()).rejects.toThrow("anaconda-bridge-sidecar error");
		});

		it("wraps non-ResponseError exceptions as PROVIDER_NOT_READY", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (method === "conda.info") return Promise.resolve({});
				return Promise.reject(new Error("connection reset"));
			});

			const backend = createBackend();
			await expect(backend.list()).rejects.toThrow("PROVIDER_NOT_READY");
			await expect(backend.list()).rejects.toThrow("anaconda-bridge-sidecar error");
		});

		it("throws SOLVE_FAILED when bridge returns success=false on create", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (method === "conda.info") return Promise.resolve({});
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
				if (method === "conda.info") return Promise.resolve({});
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
			await expect(backend.install({ envName: "myenv", packages: ["numpy>=99"] })).rejects.toThrow(
				"SOLVE_FAILED",
			);
		});

		it("throws SOLVE_FAILED when bridge returns success=false on uninstall", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (method === "conda.info") return Promise.resolve({});
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
			await expect(backend.uninstall({ envName: "myenv", packages: ["numpy"] })).rejects.toThrow(
				"SOLVE_FAILED",
			);
		});

		it("includes bridge error message in SOLVE_FAILED detail", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (method === "conda.info") return Promise.resolve({});
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

		it("uses bridge data.message over error.message for detail", async () => {
			mockConnection.sendRequest.mockImplementation((method: string) => {
				if (method === "conda.info") return Promise.resolve({});
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
				if (method === "conda.info") return Promise.resolve({});
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
});
