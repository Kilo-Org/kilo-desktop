import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { KernelServices } from "@kilo-desktop/kernel";

import {
	LOCAL_AI_PROVIDER_ID,
	LOCAL_MODEL_SERVER_SETTINGS_SECTION,
	OPEN_SETTINGS_TOOL,
	ROUTER_SERVICE_KEY,
} from "../contracts";
import { catalogModel, catalogStandIn } from "./test-catalog";
import {
	bootLocalInferenceMain as boot,
	gguf,
	recordingLogger,
	runtimeStandIn,
	stopLocalInferenceMains,
	temporaryDirectory,
	WAIT,
} from "./test-boot";

afterEach(stopLocalInferenceMains);

/** The kernel reports kilo.local-inference's manifest contributions to absent plugins; the entry says nothing. */
const ownMessages = (messages: unknown[][]) =>
	messages.filter(
		([message]) => !String(message).startsWith("[kilo.local-inference] Contribution"),
	);

describe("kilo.local-inference in main", () => {
	it("publishes registered models as Kilo's provider before the router runs", async () => {
		const storageDir = await temporaryDirectory();
		const modelsDir = await temporaryDirectory();
		const file = await gguf(modelsDir, "tiny.gguf");
		const host = await boot({ storageDir, windowShown: false });

		await host.models.methods.addModel({ path: file });

		await vi.waitFor(() => {
			const config = host.provider()!.implementation!.read()!;
			const entry = config.entry as {
				options: { baseURL: string };
				models: Record<string, unknown>;
			};
			expect(entry.options.baseURL).toBe("http://127.0.0.1:42000/v1");
			expect(Object.keys(entry.models)).toHaveLength(1);
			expect(config.env).toEqual({ ANACONDA_LOCAL_LLAMA_API_KEY: "router-secret" });
		}, WAIT);
		expect(host.provider()!.metadata.aiProviderId).toBe(LOCAL_AI_PROVIDER_ID);
		expect(host.router.ensureRunning).not.toHaveBeenCalledWith(
			expect.arrayContaining([expect.anything()]),
			expect.anything(),
		);
		expect(host.models.getState().models.map((model) => model.name)).toEqual(["tiny"]);
	});

	it("starts the router through its kernel service and loads a model on prepare", async () => {
		const modelsDir = await temporaryDirectory();
		const host = await boot();
		const model = await host.models.methods.addModel({ path: await gguf(modelsDir, "a.gguf") });

		await host.server.methods.prepare({ modelId: model.id });

		expect(host.router.prepareModel).toHaveBeenCalledWith(model.id, expect.any(Array));
		await vi.waitFor(
			() =>
				expect(host.server.getState().status).toMatchObject({
					status: "ready",
					loadedModelId: model.id,
				}),
			WAIT,
		);
		const services = host.main.kernelSdk.domainObjects.get(KernelServices)!;
		expect(services.getState().services[ROUTER_SERVICE_KEY]?.status).toBe("ready");
	});

	it("reports a model that cannot be prepared", async () => {
		const host = await boot();
		host.router.prepareModel.mockRejectedValueOnce(new Error("boom"));
		const model = await host.models.methods.addModel({
			path: await gguf(await temporaryDirectory(), "b.gguf"),
		});

		await expect(host.server.methods.prepare({ modelId: model.id })).rejects.toMatchObject({
			code: "BUSINESS",
			message: "The local model could not be prepared.",
		});
	});

	it("stops the router and the proxy when its service restarts, then serves again", async () => {
		const host = await boot();
		const model = await host.models.methods.addModel({
			path: await gguf(await temporaryDirectory(), "c.gguf"),
		});
		await host.server.methods.prepare({ modelId: model.id });
		const services = host.main.kernelSdk.domainObjects.get(KernelServices)!;

		host.router.ensureRunning.mockClear();

		await services.methods.restart({ key: ROUTER_SERVICE_KEY });

		expect(host.proxy.close).toHaveBeenCalled();
		expect(host.router.ensureRunning).toHaveBeenCalledWith([]);
		await vi.waitFor(
			() =>
				expect(host.router.ensureRunning).toHaveBeenLastCalledWith(
					[expect.objectContaining({ id: model.id })],
					expect.anything(),
				),
			WAIT,
		);
	});

	it("turns removal, update and server settings into the domain objects' answers", async () => {
		const host = await boot();
		const model = await host.models.methods.addModel({
			path: await gguf(await temporaryDirectory(), "d.gguf"),
		});

		await expect(
			host.models.methods.updateModel({ id: "missing", settings: { temperature: 0.2 } }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			host.models.methods.updateModel({ id: model.id, settings: { temperature: 0.2 } }),
		).resolves.toMatchObject({ settings: { temperature: 0.2 } });
		await expect(
			host.models.methods.removeModel({ id: "missing", mode: "registry-only" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(host.server.methods.updateSettings({ port: 8124 })).resolves.toMatchObject({
			port: 8124,
		});
		await expect(host.server.methods.settings(undefined)).resolves.toMatchObject({ port: 8124 });
		await expect(host.models.methods.listModels(undefined)).resolves.toHaveLength(1);
		await expect(host.server.methods.usage(undefined)).resolves.toMatchObject({
			system: { cpuPercent: 1 },
		});
		await expect(host.server.methods.hardwareProfile(undefined)).resolves.toMatchObject({
			name: "Test machine",
		});
		await expect(host.server.methods.listDownloads(undefined)).resolves.toEqual([]);
		await expect(host.server.methods.listCatalog(undefined)).rejects.toMatchObject({
			code: "UNAVAILABLE",
			message: "No model catalog is available.",
		});
		await expect(
			host.models.methods.removeModel({ id: model.id, mode: "registry-only" }),
		).resolves.toEqual({ ok: true });
		await vi.waitFor(() => expect(host.models.getState().models).toEqual([]), WAIT);
		await vi.waitFor(() => expect(host.provider()!.implementation!.read()).toBeUndefined(), WAIT);
	});

	it("disconnects, connects and retries the server", async () => {
		const host = await boot();
		await host.models.methods.addModel({
			path: await gguf(await temporaryDirectory(), "e.gguf"),
		});

		await host.server.methods.disconnect(undefined);
		await vi.waitFor(
			() => expect(host.server.getState().status).toEqual({ status: "disconnected" }),
			WAIT,
		);
		await host.server.methods.connect(undefined);
		await expect(host.server.methods.status(undefined)).resolves.not.toEqual({
			status: "disconnected",
		});
		await expect(host.server.methods.retry(undefined)).resolves.toEqual({ ok: true });
	});

	it("imports Anaconda Desktop models once the window shows", async () => {
		const host = await boot();
		await vi.waitFor(() => expect(host.importModels).toHaveBeenCalledOnce(), WAIT);
		expect(host.storage.saved.get("models")).toMatchObject({ anacondaDesktopModelsImported: true });
	});

	it("opens its settings section when the agent calls its tool", async () => {
		const host = await boot();

		await expect(host.callTool(OPEN_SETTINGS_TOOL)).resolves.toEqual({ opened: true });

		expect(host.openSettings).toHaveBeenCalledWith(LOCAL_MODEL_SERVER_SETTINGS_SECTION);
	});

	it("takes over origin's registry and downloaded models once", async () => {
		const root = await temporaryDirectory();
		const originDir = path.join(root, "local-inference");
		const storageDir = path.join(root, "kilo.local-inference");
		await mkdir(path.join(originDir, "models"), { recursive: true });
		await mkdir(storageDir, { recursive: true });
		const downloaded = path.join(originDir, "models", "qwen.gguf");
		await writeFile(downloaded, "GGUF");
		await writeFile(
			path.join(originDir, "models.json"),
			JSON.stringify({
				models: [
					{
						id: "qwen-1",
						name: "Qwen",
						path: downloaded,
						available: true,
						addedAt: 1,
						managedFile: true,
					},
				],
				enabled: false,
				settings: { port: 8123 },
				anacondaDesktopModelsImported: true,
			}),
		);

		const host = await boot({
			storageDir,
			originStorageDir: (dir) => path.join(dir, "..", "local-inference"),
		});

		expect(host.models.getState().models).toEqual([
			expect.objectContaining({
				id: "qwen-1",
				path: path.join(storageDir, "models", "qwen.gguf"),
				available: true,
			}),
		]);
		await expect(host.server.methods.settings(undefined)).resolves.toMatchObject({ port: 8123 });
		expect(host.storage.saved.get("models")).toMatchObject({ importedFromOrigin: true });
	});

	describe("the model catalog", () => {
		it("shows no catalog while none is contributed", async () => {
			const host = await boot();

			expect(host.server.getState().catalog).toBeNull();
			await expect(host.server.methods.signInToCatalog(undefined)).resolves.toEqual({
				ok: false,
				reason: "Sign-in is unavailable.",
			});
			await expect(host.server.methods.cancelCatalogSignIn(undefined)).resolves.toBeUndefined();
			await expect(host.server.methods.resolveCatalogAccess(undefined)).resolves.toBeUndefined();
		});

		it("asks the catalog to work out its access", async () => {
			const catalog = catalogStandIn({ access: { status: "resolving" } });
			const host = await boot({ plugins: [catalog.registration] });

			await expect(host.server.methods.resolveCatalogAccess(undefined)).resolves.toBeUndefined();

			expect(catalog.source.resolveAccess).toHaveBeenCalledOnce();
		});

		it("lists the contributed catalog and shows its title and access", async () => {
			const catalog = catalogStandIn();
			const host = await boot({ plugins: [catalog.registration] });

			expect(host.server.getState().catalog).toEqual({
				title: "Anaconda",
				access: { status: "signed-in", accountKey: "account" },
			});
			await expect(host.server.methods.listCatalog(undefined)).resolves.toEqual({
				models: [expect.objectContaining({ id: "llama" })],
				total: 1,
			});
		});

		it("follows the catalog's access and drops its cached catalog when it changes", async () => {
			const catalog = catalogStandIn({ access: { status: "signed-out" } });
			const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("", { status: 500 }));
			const host = await boot({ fetch, plugins: [catalog.registration] });
			expect(host.server.getState().catalog?.access).toEqual({ status: "signed-out" });
			await host.server.methods.listCatalog(undefined);

			catalog.setAccess({ status: "signed-in", accountKey: "other" });

			await vi.waitFor(
				() =>
					expect(host.server.getState().catalog?.access).toEqual({
						status: "signed-in",
						accountKey: "other",
					}),
				WAIT,
			);
			catalog.source.list.mockClear();
			await host.server.methods
				.startDownload({ modelId: "llama", quantizationId: "llama-q4" })
				.catch(() => undefined);
			expect(catalog.source.list).toHaveBeenCalledOnce();
		});

		it("reports a catalog whose access cannot be read as an error", async () => {
			const catalog = catalogStandIn();
			catalog.source.access = () => {
				throw new Error("broken");
			};
			const host = await boot({ plugins: [catalog.registration] });

			expect(host.server.getState().catalog?.access).toEqual({
				status: "error",
				reason: "broken",
			});
		});

		it("uses the highest-priority catalog", async () => {
			const low = catalogStandIn({ pluginId: "test.low", title: "Low", priority: 1 });
			const high = catalogStandIn({
				pluginId: "test.high",
				title: "High",
				priority: 10,
				models: [catalogModel({ id: "high" })],
			});
			const host = await boot({ plugins: [low.registration, high.registration] });

			expect(host.server.getState().catalog?.title).toBe("High");
			await expect(host.server.methods.listCatalog(undefined)).resolves.toMatchObject({
				models: [{ id: "high" }],
			});
			expect(low.source.list).not.toHaveBeenCalled();
		});

		it("signs in to the catalog and cancels a sign-in", async () => {
			const catalog = catalogStandIn({ access: { status: "signed-out" } });
			const host = await boot({ plugins: [catalog.registration] });

			await expect(host.server.methods.signInToCatalog(undefined)).resolves.toEqual({ ok: true });
			await host.server.methods.cancelCatalogSignIn(undefined);

			expect(catalog.source.signIn).toHaveBeenCalledOnce();
			expect(catalog.source.cancelSignIn).toHaveBeenCalledOnce();
		});

		it("says sign-in is unavailable when the catalog has none", async () => {
			const catalog = catalogStandIn({ withoutSignIn: true });
			const host = await boot({ plugins: [catalog.registration] });

			await expect(host.server.methods.signInToCatalog(undefined)).resolves.toEqual({
				ok: false,
				reason: "Sign-in is unavailable.",
			});
			await expect(host.server.methods.cancelCatalogSignIn(undefined)).resolves.toBeUndefined();
		});

		it("downloads a catalog model from the catalog's URL into the registry", async () => {
			const catalog = catalogStandIn();
			const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("", { status: 500 }));
			const host = await boot({ fetch, plugins: [catalog.registration] });

			await host.server.methods.startDownload({ modelId: "llama", quantizationId: "llama-q4" });

			await vi.waitFor(
				() =>
					expect(host.server.getState().downloads).toEqual([
						expect.objectContaining({ modelId: "llama", status: "failed" }),
					]),
				WAIT,
			);
			expect(catalog.source.downloadUrl).toHaveBeenCalledWith(
				{ modelId: "llama", quantizationId: "llama-q4" },
				expect.any(AbortSignal),
			);
			expect(fetch).toHaveBeenCalledWith("https://downloads.test/model.gguf", expect.anything());
		});
	});

	describe("llama.cpp", () => {
		const env = process.env["LOCAL_LLAMA_SERVER_PATH"];
		afterEach(() => {
			if (env === undefined) delete process.env["LOCAL_LLAMA_SERVER_PATH"];
			else process.env["LOCAL_LLAMA_SERVER_PATH"] = env;
		});

		async function executable(name: string) {
			const file = path.join(await temporaryDirectory(), name);
			await writeFile(file, "");
			await chmod(file, 0o755);
			return file;
		}

		it("comes from the highest-priority runtime that provides it", async () => {
			delete process.env["LOCAL_LLAMA_SERVER_PATH"];
			const working = await executable("llama-server");
			const failing = vi.fn(async (): Promise<string> => {
				throw new Error("no conda");
			});
			const fallback = vi.fn(async () => working);
			const { logger, warnings } = recordingLogger();
			const host = await boot({
				logger,
				plugins: [
					runtimeStandIn("test.fallback", fallback, { title: "Fallback", priority: 1 }),
					runtimeStandIn("test.conda", failing, { title: "Conda", priority: 10 }),
				],
			});

			await expect(host.router.resolveExecutable()).resolves.toBe(working);
			expect(failing).toHaveBeenCalledOnce();
			expect(warnings.flat().join("\n")).toContain("Could not get llama.cpp from Conda: no conda");
		});

		it("comes from LOCAL_LLAMA_SERVER_PATH first", async () => {
			const override = await executable("custom-llama-server");
			process.env["LOCAL_LLAMA_SERVER_PATH"] = override;
			const runtime = vi.fn(async () => "/never");
			const host = await boot({ plugins: [runtimeStandIn("test.conda", runtime)] });

			await expect(host.router.resolveExecutable()).resolves.toBe(override);
			expect(runtime).not.toHaveBeenCalled();
		});

		it("is unavailable without a runtime", async () => {
			delete process.env["LOCAL_LLAMA_SERVER_PATH"];
			const host = await boot();

			await expect(host.router.resolveExecutable()).rejects.toThrow(
				"The local inference runtime is unavailable.",
			);
		});
	});

	describe("without the plugins it works with", () => {
		it("activates without kilo.core, kilo.shell, kilo.chat, catalogs or runtimes, saying nothing", async () => {
			const { logger, warnings, errors } = recordingLogger();
			const host = await boot({ withoutCore: true, withoutShell: true, logger });
			const model = await host.models.methods.addModel({
				path: await gguf(await temporaryDirectory(), "f.gguf"),
			});

			await host.server.methods.prepare({ modelId: model.id });

			expect(host.provider()).toBeUndefined();
			expect(host.tool(OPEN_SETTINGS_TOOL)).toBeUndefined();
			expect(host.server.getState().catalog).toBeNull();
			expect(ownMessages(warnings)).toEqual([]);
			expect(ownMessages(errors)).toEqual([]);
		});

		it("opens nothing from its tool without kilo.shell", async () => {
			const host = await boot({ withoutShell: true });

			await expect(host.callTool(OPEN_SETTINGS_TOOL)).resolves.toEqual({ opened: true });
			expect(host.openSettings).not.toHaveBeenCalled();
		});
	});
});
