import { access, mkdir, readFile, rmdir, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createLinkedFakeSdkPair } from "@kilo-desktop/testing";

import { ENVIRONMENTS_EVENT_NAMES, type JobProgressEvent } from "../../../contracts/common.js";
import {
	REPODATA_FIND_DEFAULT_LIMIT,
	type CondaRepodataPackage,
	type CondaService,
} from "../../../contracts/providers/conda.js";
import { JobQueue } from "../../JobQueue.js";
import { registerCondaHandlers } from "./handlers.js";
import type { CondaBackend, CondaCreateFromFileRequest } from "./CondaBackend.js";

/**
 * Full-pipeline integration test: bind the conda handlers via the same
 * `mainSdk.channels(condaContract).handle(...)` calls used in production,
 * then invoke them through the renderer-side SDK. `createLinkedFakeSdkPair`
 * shares one event bus + FeatureRouter across both sides, mirroring how
 * `sdk.invoke` reaches the main handler in browser mode.
 *
 * Sub-issue 4 proved `list` end-to-end; sub-issue 6 extends the same
 * pattern to `create` and `delete`, plus the JobQueue progress-event
 * side channel that the renderer live-progress banner subscribes to.
 */
function makeBackend(overrides: Partial<CondaBackend> = {}): CondaBackend {
	const notImpl = () => {
		throw new Error("not used in this test");
	};
	return {
		list: overrides.list ?? (() => Promise.resolve([])),
		findDistributions: overrides.findDistributions ?? (() => Promise.resolve([])),
		prefixOptions:
			overrides.prefixOptions ?? (() => Promise.resolve({ envsDirs: [], channels: [] })),
		create: overrides.create ?? notImpl,
		clone: overrides.clone ?? notImpl,
		createFromFile: overrides.createFromFile ?? notImpl,
		remove: overrides.remove ?? notImpl,
		listPackages: overrides.listPackages ?? notImpl,
		install: overrides.install ?? notImpl,
		uninstall: overrides.uninstall ?? notImpl,
		update: overrides.update ?? notImpl,
		previewUpdate: overrides.previewUpdate ?? notImpl,
		previewInstall: overrides.previewInstall ?? notImpl,
		listChannels: overrides.listChannels ?? notImpl,
		addChannel: overrides.addChannel ?? notImpl,
		removeChannel: overrides.removeChannel ?? notImpl,
		findRepodata: overrides.findRepodata ?? notImpl,
	};
}

/** `count` distinct aggregated packages, named `pkg-0`, `pkg-1`, ... for ordering assertions. */
function makeRepodataMatches(count: number): CondaRepodataPackage[] {
	return Array.from({ length: count }, (_unused, index) => ({
		name: `pkg-${index}`,
		version: "1.0.0",
		build: 0,
		channel: "https://conda.anaconda.org/conda-forge",
		summary: "",
		home: "",
		versions: [{ version: "1.0.0", size: 1000 }],
	}));
}

/** Temp file paths created during tests — cleaned up by the afterEach hook. */
const tmpFiles: string[] = [];

describe("conda handlers → sdk.invoke round-trip", () => {
	afterEach(async () => {
		for (const f of tmpFiles) {
			await unlink(f).catch(() => rmdir(f).catch(() => {}));
		}
		tmpFiles.length = 0;
	});

	it("returns the backend's env list through the renderer client", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		const list = vi.fn().mockResolvedValue([
			{ name: "", prefix: "/opt/conda" },
			{ name: "dev", prefix: "/opt/conda/envs/dev" },
		]);
		registerCondaHandlers(mainSdk, makeBackend({ list }), queue);

		const client = rendererSdk.client as unknown as CondaService;
		const envs = await client["conda.envs.list"]();

		expect(envs).toEqual([
			{ name: "", prefix: "/opt/conda" },
			{ name: "dev", prefix: "/opt/conda/envs/dev" },
		]);
		expect(list).toHaveBeenCalledOnce();
		queue.dispose();
		mainSdk.dispose();
	});

	it("memoises env-list results within the read-cache TTL — a second call skips the backend", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		const list = vi.fn().mockResolvedValue([{ name: "", prefix: "/opt/conda" }]);
		registerCondaHandlers(mainSdk, makeBackend({ list }), queue);

		const client = rendererSdk.client as unknown as CondaService;
		await client["conda.envs.list"]();
		await client["conda.envs.list"]();
		expect(list).toHaveBeenCalledOnce();

		queue.dispose();
		mainSdk.dispose();
	});

	it("validates the response against the contract — malformed backend output rejects", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		registerCondaHandlers(
			mainSdk,
			makeBackend({
				// oxlint-disable-next-line no-explicit-any -- deliberately breaking the contract
				list: (async () => [{ prefix: "" }]) as any,
			}),
			queue,
		);

		const client = rendererSdk.client as unknown as CondaService;
		await expect(client["conda.envs.list"]()).rejects.toThrow();
		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.envs.create returns { jobId, environment } and emits queued → running → succeeded on job-progress", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const events: JobProgressEvent[] = [];
		const queue = new JobQueue({
			emit: (event) => {
				events.push(event);
				mainSdk.events.emit("job-progress", event);
			},
		});
		const create = vi.fn().mockResolvedValue({
			name: "dev",
			prefix: "/tmp/conda-root/envs/dev",
		});
		registerCondaHandlers(mainSdk, makeBackend({ create }), queue);

		const client = rendererSdk.client as unknown as CondaService;
		const result = await client["conda.envs.create"]({ name: "dev" });

		expect(result.environment).toEqual({ name: "dev", prefix: "/tmp/conda-root/envs/dev" });
		expect(typeof result.jobId).toBe("string");
		expect(result.jobId.startsWith("conda-")).toBe(true);
		expect(create).toHaveBeenCalledWith(
			{ name: "dev" },
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
			undefined,
		);

		// Every event carries the same jobId, and the ordering is the
		// documented state machine: queued → running → succeeded.
		expect(events.map((e) => e.status)).toEqual(["queued", "running", "succeeded"]);
		expect(events.every((e) => e.jobId === result.jobId)).toBe(true);
		expect(events.every((e) => e.provider === "conda" && e.kind === "envs.create")).toBe(true);

		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.envs.delete returns { jobId, name } and emits terminal succeeded on job-progress", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const events: JobProgressEvent[] = [];
		const queue = new JobQueue({ emit: (event) => events.push(event) });
		const remove = vi.fn().mockResolvedValue(undefined);
		registerCondaHandlers(mainSdk, makeBackend({ remove }), queue);

		const client = rendererSdk.client as unknown as CondaService;
		const result = await client["conda.envs.delete"]({ name: "dev" });

		expect(result).toEqual({
			jobId: expect.stringMatching(/^conda-/),
			name: "dev",
		});
		expect(remove).toHaveBeenCalledWith(
			{ name: "dev" },
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
		expect(events.map((e) => e.status)).toEqual(["queued", "running", "succeeded"]);
		expect(events.every((e) => e.kind === "envs.delete")).toBe(true);

		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.envs.distributions returns { distributions } and memoises within the read-cache TTL", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		const findDistributions = vi.fn().mockResolvedValue([
			{ prefix: "/opt/miniconda3", priority: 10 },
			{ prefix: "/home/user/anaconda3", priority: 5 },
		]);
		registerCondaHandlers(mainSdk, makeBackend({ findDistributions }), queue);

		const client = rendererSdk.client as unknown as CondaService;
		const result = await client["conda.envs.distributions"]();

		expect(result).toEqual({
			distributions: [
				{ prefix: "/opt/miniconda3", priority: 10 },
				{ prefix: "/home/user/anaconda3", priority: 5 },
			],
		});
		// Reads bypass the queue and cache, so a second call skips the backend.
		await client["conda.envs.distributions"]();
		expect(findDistributions).toHaveBeenCalledOnce();

		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.envs.clone returns { jobId, environment } and emits queued → running → succeeded", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const events: JobProgressEvent[] = [];
		const queue = new JobQueue({ emit: (event) => events.push(event) });
		const clone = vi.fn().mockResolvedValue({ name: "cloned", prefix: "/tmp/envs/cloned" });
		registerCondaHandlers(mainSdk, makeBackend({ clone }), queue);

		const client = rendererSdk.client as unknown as CondaService;
		const result = await client["conda.envs.clone"]({ sourceName: "source", name: "cloned" });

		expect(result.environment).toEqual({ name: "cloned", prefix: "/tmp/envs/cloned" });
		expect(result.jobId).toMatch(/^conda-/);
		expect(clone).toHaveBeenCalledWith(
			{ sourceName: "source", name: "cloned" },
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
		expect(events.map((e) => e.status)).toEqual(["queued", "running", "succeeded"]);
		expect(events.every((e) => e.kind === "envs.clone")).toBe(true);

		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.envs.createFromFile imports the staged copy and emits terminal succeeded", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const events: JobProgressEvent[] = [];
		const queue = new JobQueue({ emit: (event) => events.push(event) });
		const createFromFile = vi
			.fn()
			.mockResolvedValue({ name: "fromfile", prefix: "/tmp/envs/fromfile" });
		registerCondaHandlers(mainSdk, makeBackend({ createFromFile }), queue);

		const tmpDir = join(tmpdir(), "conda-handlers-test");
		await mkdir(tmpDir, { recursive: true });
		const tmpPath = join(tmpDir, "create-from-file.yml");
		await writeFile(tmpPath, "name: fromfile\n", "utf-8");
		tmpFiles.push(tmpPath);

		const client = rendererSdk.client as unknown as CondaService;
		const preview = await client["conda.envs.readFile"]({ filePath: tmpPath });
		const result = await client["conda.envs.createFromFile"]({
			stagedHandle: preview.stagedHandle,
		});

		expect(result.environment).toEqual({ name: "fromfile", prefix: "/tmp/envs/fromfile" });
		expect(result.jobId).toMatch(/^conda-/);
		expect(createFromFile).toHaveBeenCalledWith(
			{ file: expect.stringContaining("import-staging") },
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
		expect(events.map((e) => e.status)).toEqual(["queued", "running", "succeeded"]);
		expect(events.every((e) => e.kind === "envs.createFromFile")).toBe(true);

		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.envs.clone write invalidates the distributions read cache", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		const findDistributions = vi.fn().mockResolvedValue([]);
		const clone = vi.fn().mockResolvedValue({ name: "cloned", prefix: "/tmp/envs/cloned" });
		registerCondaHandlers(mainSdk, makeBackend({ findDistributions, clone }), queue);

		const client = rendererSdk.client as unknown as CondaService;
		await client["conda.envs.distributions"]();
		expect(findDistributions).toHaveBeenCalledTimes(1);
		await client["conda.envs.clone"]({ sourceName: "source", name: "cloned" });
		await client["conda.envs.distributions"]();
		expect(findDistributions).toHaveBeenCalledTimes(2);

		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.envs.delete accepts a prefix-only target for base/nameless envs", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const events: JobProgressEvent[] = [];
		const queue = new JobQueue({ emit: (event) => events.push(event) });
		const remove = vi.fn().mockResolvedValue(undefined);
		registerCondaHandlers(mainSdk, makeBackend({ remove }), queue);

		const client = rendererSdk.client as unknown as CondaService;
		const result = await client["conda.envs.delete"]({ prefix: "/opt/conda/envs/custom" });

		expect(result).toEqual({
			jobId: expect.stringMatching(/^conda-/),
			name: "/opt/conda/envs/custom",
			prefix: "/opt/conda/envs/custom",
		});
		expect(remove).toHaveBeenCalledWith(
			{ prefix: "/opt/conda/envs/custom" },
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
		expect(events.map((e) => e.status)).toEqual(["queued", "running", "succeeded"]);

		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.envs.create write invalidates the read cache — the next envs.list re-runs the backend", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		const list = vi.fn().mockResolvedValue([]);
		const create = vi.fn().mockResolvedValue({ name: "dev", prefix: "/tmp/envs/dev" });
		registerCondaHandlers(mainSdk, makeBackend({ list, create }), queue);

		const client = rendererSdk.client as unknown as CondaService;
		await client["conda.envs.list"]();
		expect(list).toHaveBeenCalledTimes(1);
		await client["conda.envs.create"]({ name: "dev" });
		await client["conda.envs.list"]();
		expect(list).toHaveBeenCalledTimes(2);

		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.repodata.find returns matching packages through the renderer client", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		const numpy = {
			name: "numpy",
			version: "1.26.4",
			build: 2,
			channel: "https://conda.anaconda.org/conda-forge",
			summary: "Array computing with Python",
			home: "https://numpy.org",
			versions: [
				{ version: "1.26.4", size: 7_000_000 },
				{ version: "1.25.0", size: 6_500_000 },
			],
		};
		const findRepodata = vi.fn().mockResolvedValue([numpy]);
		registerCondaHandlers(mainSdk, makeBackend({ findRepodata }), queue);

		const client = rendererSdk.client as unknown as CondaService;
		const result = await client["conda.repodata.find"]({ names: ["numpy"] });

		expect(result).toEqual({ packages: [numpy], truncated: false });
		expect(findRepodata).toHaveBeenCalledWith(
			{ names: ["numpy"] },
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
		queue.dispose();
		mainSdk.dispose();
	});

	it("caps repodata.find at the requested limit and flags truncation", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		const findRepodata = vi.fn().mockResolvedValue(makeRepodataMatches(12));
		registerCondaHandlers(mainSdk, makeBackend({ findRepodata }), queue);

		const client = rendererSdk.client as unknown as CondaService;
		const result = await client["conda.repodata.find"]({ names: ["numpy"], limit: 5 });

		expect(result.packages).toHaveLength(5);
		expect(result.truncated).toBe(true);
		expect(result.packages.map((pkg) => pkg.name)).toEqual([
			"pkg-0",
			"pkg-1",
			"pkg-2",
			"pkg-3",
			"pkg-4",
		]);

		queue.dispose();
		mainSdk.dispose();
	});

	it("reports truncated=false when the match set fits inside the limit", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		const findRepodata = vi.fn().mockResolvedValue(makeRepodataMatches(3));
		registerCondaHandlers(mainSdk, makeBackend({ findRepodata }), queue);

		const client = rendererSdk.client as unknown as CondaService;
		const result = await client["conda.repodata.find"]({ names: ["numpy"], limit: 3 });

		expect(result.packages).toHaveLength(3);
		expect(result.truncated).toBe(false);

		queue.dispose();
		mainSdk.dispose();
	});

	it("applies the default limit when the caller omits it", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		const findRepodata = vi
			.fn()
			.mockResolvedValue(makeRepodataMatches(REPODATA_FIND_DEFAULT_LIMIT + 25));
		registerCondaHandlers(mainSdk, makeBackend({ findRepodata }), queue);

		const client = rendererSdk.client as unknown as CondaService;
		const result = await client["conda.repodata.find"]({ names: ["numpy"] });

		expect(result.packages).toHaveLength(REPODATA_FIND_DEFAULT_LIMIT);
		expect(result.truncated).toBe(true);

		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.packages.install returns { jobId, envName, installed } and emits job-progress events", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const events: JobProgressEvent[] = [];
		const queue = new JobQueue({ emit: (event) => events.push(event) });
		const install = vi.fn().mockResolvedValue({
			jobId: "",
			envName: "dev",
			installed: [{ name: "numpy", version: "2.5.1", build: "py311_0", channel: "defaults" }],
		});
		registerCondaHandlers(mainSdk, makeBackend({ install }), queue);

		const client = rendererSdk.client as unknown as CondaService;
		const result = await client["conda.packages.install"]({
			name: "dev",
			packages: ["numpy>=2.0"],
		});

		expect(result.envName).toBe("dev");
		expect(result.installed).toHaveLength(1);
		expect(result.installed[0]!.name).toBe("numpy");
		expect(result.jobId.startsWith("conda-")).toBe(true);
		expect(events.map((e) => e.status)).toEqual(["queued", "running", "succeeded"]);
		expect(events.every((e) => e.kind === "packages.install")).toBe(true);

		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.packages.remove returns { jobId, envName, removed } and emits job-progress events", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const events: JobProgressEvent[] = [];
		const queue = new JobQueue({ emit: (event) => events.push(event) });
		const uninstall = vi.fn().mockResolvedValue({
			jobId: "",
			envName: "dev",
			removed: ["numpy"],
		});
		registerCondaHandlers(mainSdk, makeBackend({ uninstall }), queue);

		const client = rendererSdk.client as unknown as CondaService;
		const result = await client["conda.packages.remove"]({
			name: "dev",
			packages: ["numpy"],
		});

		expect(result.envName).toBe("dev");
		expect(result.removed).toEqual(["numpy"]);
		expect(result.jobId.startsWith("conda-")).toBe(true);
		expect(events.map((e) => e.status)).toEqual(["queued", "running", "succeeded"]);
		expect(events.every((e) => e.kind === "packages.remove")).toBe(true);

		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.packages.update returns { jobId, envName, updated } and emits job-progress events", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const events: JobProgressEvent[] = [];
		const queue = new JobQueue({ emit: (event) => events.push(event) });
		const update = vi.fn().mockResolvedValue({
			jobId: "",
			envName: "dev",
			updated: [{ name: "numpy", version: "2.6.0", build: "py311_0", channel: "defaults" }],
		});
		registerCondaHandlers(mainSdk, makeBackend({ update }), queue);

		const client = rendererSdk.client as unknown as CondaService;
		const result = await client["conda.packages.update"]({
			name: "dev",
			packages: ["numpy"],
		});

		expect(result.envName).toBe("dev");
		expect(result.updated).toHaveLength(1);
		expect(result.updated[0]!.name).toBe("numpy");
		expect(result.jobId.startsWith("conda-")).toBe(true);
		expect(events.map((e) => e.status)).toEqual(["queued", "running", "succeeded"]);
		expect(events.every((e) => e.kind === "packages.update")).toBe(true);

		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.packages.preview forwards to backend.previewUpdate through the read queue", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		const previewUpdate = vi.fn().mockResolvedValue({
			upgraded: [
				{ name: "numpy", fromVersion: "2.0.0", toVersion: "2.5.1", channel: "conda-forge" },
			],
			downgraded: [],
			added: [],
			removed: [],
			rebuilt: [],
			nothingToDo: false,
		});
		registerCondaHandlers(mainSdk, makeBackend({ previewUpdate }), queue);

		const client = rendererSdk.client as unknown as CondaService;
		const result = await client["conda.packages.preview"]({
			name: "dev",
			packages: ["numpy"],
		});

		expect(result.upgraded).toHaveLength(1);
		expect(result.upgraded[0]!.name).toBe("numpy");
		expect(previewUpdate).toHaveBeenCalledOnce();

		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.packages.previewInstall forwards to backend.previewInstall through the read queue", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		const previewInstall = vi.fn().mockResolvedValue({
			upgraded: [],
			downgraded: [],
			added: [{ name: "requests", fromVersion: null, toVersion: "2.32.0", channel: "conda-forge" }],
			removed: [],
			rebuilt: [],
			nothingToDo: false,
		});
		registerCondaHandlers(mainSdk, makeBackend({ previewInstall }), queue);

		const client = rendererSdk.client as unknown as CondaService;
		const result = await client["conda.packages.previewInstall"]({
			name: "dev",
			packages: ["requests"],
		});

		expect(result.added).toHaveLength(1);
		expect(result.added[0]!.name).toBe("requests");
		expect(previewInstall).toHaveBeenCalledOnce();

		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.repodata.find forwards optional name/channel/subdir filters to the backend", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		const findRepodata = vi.fn().mockResolvedValue([]);
		registerCondaHandlers(mainSdk, makeBackend({ findRepodata }), queue);

		const client = rendererSdk.client as unknown as CondaService;
		await client["conda.repodata.find"]({
			names: ["numpy"],
			channels: ["conda-forge"],
			subdirs: ["osx-arm64"],
			limit: 20,
		});

		expect(findRepodata).toHaveBeenCalledOnce();
		expect(findRepodata.mock.calls[0]![0]).toEqual({
			names: ["numpy"],
			channels: ["conda-forge"],
			subdirs: ["osx-arm64"],
		});

		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.envs.create honours an explicit prefix by threading it through to the backend", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		const create = vi.fn().mockResolvedValue({
			name: "dev",
			prefix: "/tmp/custom/dev",
		});
		registerCondaHandlers(mainSdk, makeBackend({ create }), queue);

		const client = rendererSdk.client as unknown as CondaService;
		const result = await client["conda.envs.create"]({
			name: "dev",
			prefix: "/tmp/custom/dev",
		});

		expect(result.environment.prefix).toBe("/tmp/custom/dev");
		expect(create).toHaveBeenCalledOnce();
		// The third argument to backend.create is the options bag, which should
		// carry the explicit prefix when the caller provided one.
		expect(create.mock.calls[0]![2]).toEqual({ prefix: "/tmp/custom/dev" });

		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.envs.checkPrefix reports a free prefix, then an existing env, without touching the backend", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		const backend = makeBackend();
		registerCondaHandlers(mainSdk, backend, queue);
		const prefix = join(tmpdir(), `conda-check-prefix-${process.pid}-${Date.now()}`);
		tmpFiles.push(join(prefix, "conda-meta"), prefix);

		const client = rendererSdk.client as unknown as CondaService;
		await expect(client["conda.envs.checkPrefix"]({ prefix })).resolves.toEqual({
			available: true,
		});

		await mkdir(join(prefix, "conda-meta"), { recursive: true });
		// Not read-cached: the second call sees the env created since the first.
		await expect(client["conda.envs.checkPrefix"]({ prefix })).resolves.toEqual({
			available: false,
			reason: "exists-environment",
		});

		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.envs.create rejects with ENV_EXISTS before calling the bridge when the prefix is already an env", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const events: JobProgressEvent[] = [];
		const queue = new JobQueue({ emit: (event) => events.push(event) });
		const create = vi.fn();
		registerCondaHandlers(mainSdk, makeBackend({ create }), queue);
		const prefix = join(tmpdir(), `conda-create-exists-${process.pid}-${Date.now()}`);
		await mkdir(join(prefix, "conda-meta"), { recursive: true });
		tmpFiles.push(join(prefix, "conda-meta"), prefix);

		const client = rendererSdk.client as unknown as CondaService;
		await expect(client["conda.envs.create"]({ name: "dev", prefix })).rejects.toThrow(
			`ENV_EXISTS: ${prefix}`,
		);

		expect(create).not.toHaveBeenCalled();
		expect(events.map((e) => e.status)).toEqual(["queued", "running", "failed"]);

		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.channels.list returns the backend's channel list and caches within TTL", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		const listChannels = vi.fn().mockResolvedValue(["defaults", "conda-forge"]);
		registerCondaHandlers(mainSdk, makeBackend({ listChannels }), queue);

		const client = rendererSdk.client as unknown as CondaService;
		const channels = await client["conda.channels.list"]();

		expect(channels).toEqual(["defaults", "conda-forge"]);
		expect(listChannels).toHaveBeenCalledOnce();

		// Second call within TTL should hit cache
		await client["conda.channels.list"]();
		expect(listChannels).toHaveBeenCalledOnce();

		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.jobs.cancel returns { cancelled: false } for an unknown job id", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		registerCondaHandlers(mainSdk, makeBackend(), queue);

		const client = rendererSdk.client as unknown as CondaService;
		const result = await client["conda.jobs.cancel"]({ jobId: "nonexistent-99" });
		expect(result.cancelled).toBe(false);

		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.packages.install write invalidates the read cache — next packages.list re-runs the backend", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		const listPackages = vi.fn().mockResolvedValue([]);
		const install = vi.fn().mockResolvedValue({
			jobId: "",
			envName: "dev",
			installed: [],
		});
		registerCondaHandlers(mainSdk, makeBackend({ listPackages, install }), queue);

		const client = rendererSdk.client as unknown as CondaService;
		await client["conda.packages.list"]({ name: "dev" });
		expect(listPackages).toHaveBeenCalledTimes(1);

		await client["conda.packages.install"]({ name: "dev", packages: ["numpy"] });
		await client["conda.packages.list"]({ name: "dev" });
		expect(listPackages).toHaveBeenCalledTimes(2);

		queue.dispose();
		mainSdk.dispose();
	});

	it("serves different limits for one query from a single backend call", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		const findRepodata = vi.fn().mockResolvedValue(makeRepodataMatches(20));
		registerCondaHandlers(mainSdk, makeBackend({ findRepodata }), queue);

		const client = rendererSdk.client as unknown as CondaService;
		const narrow = await client["conda.repodata.find"]({ names: ["numpy"], limit: 2 });
		const wide = await client["conda.repodata.find"]({ names: ["numpy"], limit: 10 });

		// `limit` is deliberately absent from the read-cache key, so widening it
		// within the TTL re-slices the cached match set instead of re-querying.
		expect(narrow.packages).toHaveLength(2);
		expect(wide.packages).toHaveLength(10);
		expect(findRepodata).toHaveBeenCalledOnce();

		queue.dispose();
		mainSdk.dispose();
	});

	it("forwards a partial-match query to the backend and truncates its ranked result", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		const findRepodata = vi.fn().mockResolvedValue(makeRepodataMatches(5));
		registerCondaHandlers(mainSdk, makeBackend({ findRepodata }), queue);

		const client = rendererSdk.client as unknown as CondaService;
		const result = await client["conda.repodata.find"]({ query: "pkg", limit: 3 });

		// The backend (bridge) filters and ranks; the handler only slices.
		expect(findRepodata).toHaveBeenCalledWith(
			{ query: "pkg" },
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
		expect(result.packages.map((pkg) => pkg.name)).toEqual(["pkg-0", "pkg-1", "pkg-2"]);
		expect(result.truncated).toBe(true);

		queue.dispose();
		mainSdk.dispose();
	});

	it("caches each query separately — a repeated keystroke is served from the read cache", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		const findRepodata = vi.fn().mockResolvedValue(makeRepodataMatches(2));
		registerCondaHandlers(mainSdk, makeBackend({ findRepodata }), queue);

		const client = rendererSdk.client as unknown as CondaService;
		await client["conda.repodata.find"]({ query: "pkg-1" });
		await client["conda.repodata.find"]({ query: "pkg-2" });
		await client["conda.repodata.find"]({ query: "pkg-1" });

		expect(findRepodata).toHaveBeenCalledTimes(2);

		queue.dispose();
		mainSdk.dispose();
	});

	it("names lookups forward the exact filter", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		const findRepodata = vi.fn().mockResolvedValue(makeRepodataMatches(3));
		registerCondaHandlers(mainSdk, makeBackend({ findRepodata }), queue);

		const client = rendererSdk.client as unknown as CondaService;
		await client["conda.repodata.find"]({ names: ["pkg-0"] });

		expect(findRepodata).toHaveBeenLastCalledWith(
			{ names: ["pkg-0"] },
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);

		queue.dispose();
		mainSdk.dispose();
	});

	it("memoises repodata.find results within the read-cache TTL", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		const findRepodata = vi.fn().mockResolvedValue([]);
		registerCondaHandlers(mainSdk, makeBackend({ findRepodata }), queue);

		const client = rendererSdk.client as unknown as CondaService;
		await client["conda.repodata.find"]({ names: ["numpy"] });
		await client["conda.repodata.find"]({ names: ["numpy"] });
		expect(findRepodata).toHaveBeenCalledOnce();

		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.packages.install enqueues, stamps the queue jobId, and emits queued → running → succeeded", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const events: JobProgressEvent[] = [];
		const queue = new JobQueue({ emit: (event) => events.push(event) });
		const installed = [
			{ name: "faker", version: "40.38.0", build: "pyhd8ed1ab_0", channel: "conda-forge" },
		];
		const install = vi.fn().mockResolvedValue({ jobId: "", envName: "dev", installed });
		registerCondaHandlers(mainSdk, makeBackend({ install }), queue);

		const client = rendererSdk.client as unknown as CondaService;
		const result = await client["conda.packages.install"]({ name: "dev", packages: ["faker"] });

		// The queue-assigned jobId replaces the backend's placeholder empty string.
		expect(result).toEqual({
			jobId: expect.stringMatching(/^conda-/),
			envName: "dev",
			installed,
		});
		expect(install).toHaveBeenCalledWith(
			{ name: "dev", packages: ["faker"] },
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
		expect(events.map((event) => event.status)).toEqual(["queued", "running", "succeeded"]);
		expect(events.every((event) => event.kind === "packages.install")).toBe(true);

		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.packages.install forwards optional channels to the backend", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		const install = vi.fn().mockResolvedValue({ jobId: "", envName: "dev", installed: [] });
		registerCondaHandlers(mainSdk, makeBackend({ install }), queue);

		const client = rendererSdk.client as unknown as CondaService;
		await client["conda.packages.install"]({
			name: "dev",
			packages: ["faker>=30"],
			channels: ["conda-forge"],
		});

		expect(install).toHaveBeenCalledWith(
			{ name: "dev", packages: ["faker>=30"], channels: ["conda-forge"] },
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);

		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.packages.install write clears the read cache — the next packages.list re-runs the backend", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		const listPackages = vi.fn().mockResolvedValue([]);
		const install = vi.fn().mockResolvedValue({ jobId: "", envName: "dev", installed: [] });
		registerCondaHandlers(mainSdk, makeBackend({ listPackages, install }), queue);

		const client = rendererSdk.client as unknown as CondaService;
		await client["conda.packages.list"]({ name: "dev" });
		expect(listPackages).toHaveBeenCalledOnce();
		await client["conda.packages.install"]({ name: "dev", packages: ["faker"] });
		await client["conda.packages.list"]({ name: "dev" });
		expect(listPackages).toHaveBeenCalledTimes(2);

		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.packages.remove enqueues, stamps the queue jobId, and emits queued → running → succeeded", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const events: JobProgressEvent[] = [];
		const queue = new JobQueue({ emit: (event) => events.push(event) });
		const uninstall = vi.fn().mockResolvedValue({ jobId: "", envName: "dev", removed: ["faker"] });
		registerCondaHandlers(mainSdk, makeBackend({ uninstall }), queue);

		const client = rendererSdk.client as unknown as CondaService;
		const result = await client["conda.packages.remove"]({ name: "dev", packages: ["faker"] });

		// The queue-assigned jobId replaces the backend's placeholder empty string.
		expect(result).toEqual({
			jobId: expect.stringMatching(/^conda-/),
			envName: "dev",
			removed: ["faker"],
		});
		expect(uninstall).toHaveBeenCalledWith(
			{ name: "dev", packages: ["faker"] },
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
		expect(events.map((event) => event.status)).toEqual(["queued", "running", "succeeded"]);
		expect(events.every((event) => event.kind === "packages.remove")).toBe(true);

		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.packages.remove write clears the read cache — the next packages.list re-runs the backend", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		const listPackages = vi.fn().mockResolvedValue([]);
		const uninstall = vi.fn().mockResolvedValue({ jobId: "", envName: "dev", removed: ["faker"] });
		registerCondaHandlers(mainSdk, makeBackend({ listPackages, uninstall }), queue);

		const client = rendererSdk.client as unknown as CondaService;
		await client["conda.packages.list"]({ name: "dev" });
		expect(listPackages).toHaveBeenCalledOnce();
		await client["conda.packages.remove"]({ name: "dev", packages: ["faker"] });
		await client["conda.packages.list"]({ name: "dev" });
		expect(listPackages).toHaveBeenCalledTimes(2);

		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.packages.update enqueues, stamps the queue jobId, and emits queued → running → succeeded", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const events: JobProgressEvent[] = [];
		const queue = new JobQueue({ emit: (event) => events.push(event) });
		const updated = [
			{ name: "numpy", version: "1.26.4", build: "py311_0", channel: "conda-forge" },
		];
		const update = vi.fn().mockResolvedValue({ jobId: "", envName: "dev", updated });
		registerCondaHandlers(mainSdk, makeBackend({ update }), queue);

		const client = rendererSdk.client as unknown as CondaService;
		const result = await client["conda.packages.update"]({ name: "dev", packages: ["numpy"] });

		// The queue-assigned jobId replaces the backend's placeholder empty string.
		expect(result).toEqual({
			jobId: expect.stringMatching(/^conda-/),
			envName: "dev",
			updated,
		});
		expect(update).toHaveBeenCalledWith(
			{ name: "dev", packages: ["numpy"] },
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
		expect(events.map((event) => event.status)).toEqual(["queued", "running", "succeeded"]);
		expect(events.every((event) => event.kind === "packages.update")).toBe(true);

		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.packages.update forwards updateAll and optional channels to the backend", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		const update = vi.fn().mockResolvedValue({ jobId: "", envName: "dev", updated: [] });
		registerCondaHandlers(mainSdk, makeBackend({ update }), queue);

		const client = rendererSdk.client as unknown as CondaService;
		await client["conda.packages.update"]({
			name: "dev",
			updateAll: true,
			channels: ["conda-forge"],
		});

		expect(update).toHaveBeenCalledWith(
			{ name: "dev", updateAll: true, channels: ["conda-forge"] },
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);

		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.packages.update write clears the read cache — the next packages.list re-runs the backend", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		const listPackages = vi.fn().mockResolvedValue([]);
		const update = vi.fn().mockResolvedValue({ jobId: "", envName: "dev", updated: [] });
		registerCondaHandlers(mainSdk, makeBackend({ listPackages, update }), queue);

		const client = rendererSdk.client as unknown as CondaService;
		await client["conda.packages.list"]({ name: "dev" });
		expect(listPackages).toHaveBeenCalledOnce();
		await client["conda.packages.update"]({ name: "dev", packages: ["numpy"] });
		await client["conda.packages.list"]({ name: "dev" });
		expect(listPackages).toHaveBeenCalledTimes(2);

		queue.dispose();
		mainSdk.dispose();
	});

	it("plugin-scoped job-progress events surface on the fully-qualified environments.job-progress name", async () => {
		// Sanity check: the constant we advertise to renderer subscribers
		// matches the featureId + local event name path.
		expect(ENVIRONMENTS_EVENT_NAMES.JOB_PROGRESS).toBe("environments.job-progress");
	});

	it("conda.envs.readFile returns the file content for a valid YAML file", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		registerCondaHandlers(mainSdk, makeBackend(), queue);

		const tmpDir = join(tmpdir(), "conda-handlers-test");
		await mkdir(tmpDir, { recursive: true });
		const tmpPath = join(tmpDir, "env.yml");
		const yamlContent = "name: test-env\ndependencies:\n  - numpy\n";
		await writeFile(tmpPath, yamlContent, "utf-8");
		tmpFiles.push(tmpPath);

		const client = rendererSdk.client as unknown as CondaService;
		const result = await client["conda.envs.readFile"]({ filePath: tmpPath });

		expect(result.content).toBe(yamlContent);
		expect(result.stagedHandle).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
		);

		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.envs.readFile rejects with VALIDATION for non-YAML extension", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		registerCondaHandlers(mainSdk, makeBackend(), queue);

		const client = rendererSdk.client as unknown as CondaService;
		await expect(client["conda.envs.readFile"]({ filePath: "/tmp/env.txt" })).rejects.toThrow();

		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.envs.readFile rejects a symlink whose target is not a YAML file", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		registerCondaHandlers(mainSdk, makeBackend(), queue);

		const tmpDir = join(tmpdir(), "conda-handlers-test");
		await mkdir(tmpDir, { recursive: true });
		// Create a non-YAML target and a .yml symlink pointing to it.
		const targetPath = join(tmpDir, "secret.txt");
		await writeFile(targetPath, "not yaml", "utf-8");
		tmpFiles.push(targetPath);
		const symlinkPath = join(tmpDir, "sneaky.yml");
		await symlink(targetPath, symlinkPath);
		tmpFiles.push(symlinkPath);

		const client = rendererSdk.client as unknown as CondaService;
		await expect(client["conda.envs.readFile"]({ filePath: symlinkPath })).rejects.toThrow(/YAML/);

		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.envs.readFile follows a symlink whose target IS a YAML file", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		registerCondaHandlers(mainSdk, makeBackend(), queue);

		const tmpDir = join(tmpdir(), "conda-handlers-test");
		await mkdir(tmpDir, { recursive: true });
		const targetPath = join(tmpDir, "real-env.yaml");
		const yamlContent = "name: linked-env\ndependencies:\n  - scipy\n";
		await writeFile(targetPath, yamlContent, "utf-8");
		tmpFiles.push(targetPath);
		const symlinkPath = join(tmpDir, "link.yml");
		await symlink(targetPath, symlinkPath);
		tmpFiles.push(symlinkPath);

		const client = rendererSdk.client as unknown as CondaService;
		const result = await client["conda.envs.readFile"]({ filePath: symlinkPath });
		expect(result.content).toBe(yamlContent);
		expect(result.stagedHandle).toBeTruthy();

		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.envs.readFile rejects a directory path", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		registerCondaHandlers(mainSdk, makeBackend(), queue);

		const tmpDir = join(tmpdir(), "conda-handlers-test", "fake-env.yml");
		await mkdir(tmpDir, { recursive: true });
		tmpFiles.push(tmpDir);

		const client = rendererSdk.client as unknown as CondaService;
		await expect(client["conda.envs.readFile"]({ filePath: tmpDir })).rejects.toThrow(
			/regular file/,
		);

		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.envs.readFile rejects a symlink to a directory", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		registerCondaHandlers(mainSdk, makeBackend(), queue);

		// The target keeps a .yml name so the extension guard passes and the
		// regular-file guard is what rejects it.
		const targetDir = join(tmpdir(), "conda-handlers-test", "target-dir.yml");
		await mkdir(targetDir, { recursive: true });
		const linkPath = join(tmpdir(), "conda-handlers-test", "dir-link.yml");
		await symlink(targetDir, linkPath);
		tmpFiles.push(linkPath, targetDir);

		const client = rendererSdk.client as unknown as CondaService;
		await expect(client["conda.envs.readFile"]({ filePath: linkPath })).rejects.toThrow(
			/regular file/,
		);

		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.envs.readFile rejects files exceeding the size limit", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		registerCondaHandlers(mainSdk, makeBackend(), queue);

		const tmpDir = join(tmpdir(), "conda-handlers-test");
		await mkdir(tmpDir, { recursive: true });
		const tmpPath = join(tmpDir, "huge.yml");
		// Write just over 1 MB to trigger the size guard.
		await writeFile(tmpPath, "a".repeat(1024 * 1024 + 1), "utf-8");
		tmpFiles.push(tmpPath);

		const client = rendererSdk.client as unknown as CondaService;
		await expect(client["conda.envs.readFile"]({ filePath: tmpPath })).rejects.toThrow(/too large/);

		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.envs.createFromFile imports the reviewed bytes even if the source file is swapped", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		let stagedFile: string | undefined;
		let stagedContent: string | undefined;
		const createFromFile = vi.fn(async (request: CondaCreateFromFileRequest) => {
			stagedFile = request.file;
			stagedContent = await readFile(request.file, "utf-8");
			return { name: "reviewed", prefix: "/tmp/envs/reviewed" };
		});
		registerCondaHandlers(mainSdk, makeBackend({ createFromFile }), queue);

		const tmpDir = join(tmpdir(), "conda-handlers-test");
		await mkdir(tmpDir, { recursive: true });
		const tmpPath = join(tmpDir, "swap.yml");
		const reviewed = "name: reviewed\ndependencies:\n  - safe-pkg\n";
		await writeFile(tmpPath, reviewed, "utf-8");
		tmpFiles.push(tmpPath);

		const client = rendererSdk.client as unknown as CondaService;
		const preview = await client["conda.envs.readFile"]({ filePath: tmpPath });
		expect(preview.content).toBe(reviewed);

		// A collaborator swaps the source file between review and import.
		await writeFile(tmpPath, "name: reviewed\ndependencies:\n  - evil-pkg\n", "utf-8");

		await client["conda.envs.createFromFile"]({ stagedHandle: preview.stagedHandle });

		expect(stagedFile).toContain("import-staging");
		expect(stagedContent).toBe(reviewed);

		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.envs.createFromFile uses the reviewed bytes when the source symlink is repointed", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		let stagedContent: string | undefined;
		const createFromFile = vi.fn(async (request: CondaCreateFromFileRequest) => {
			stagedContent = await readFile(request.file, "utf-8");
			return { name: "linked", prefix: "/tmp/envs/linked" };
		});
		registerCondaHandlers(mainSdk, makeBackend({ createFromFile }), queue);

		const tmpDir = join(tmpdir(), "conda-handlers-test");
		await mkdir(tmpDir, { recursive: true });
		const first = join(tmpDir, "first.yml");
		const second = join(tmpDir, "second.yml");
		const linkPath = join(tmpDir, "repoint.yml");
		const reviewed = "name: linked\ndependencies:\n  - scipy\n";
		await writeFile(first, reviewed, "utf-8");
		await writeFile(second, "name: linked\ndependencies:\n  - evil\n", "utf-8");
		await symlink(first, linkPath);
		tmpFiles.push(first, second, linkPath);

		const client = rendererSdk.client as unknown as CondaService;
		const preview = await client["conda.envs.readFile"]({ filePath: linkPath });
		expect(preview.content).toBe(reviewed);

		// Repoint the symlink after review.
		await unlink(linkPath);
		await symlink(second, linkPath);

		await client["conda.envs.createFromFile"]({ stagedHandle: preview.stagedHandle });
		expect(stagedContent).toBe(reviewed);

		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.envs.createFromFile rejects an unknown staged handle with VALIDATION", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		const createFromFile = vi.fn();
		registerCondaHandlers(mainSdk, makeBackend({ createFromFile }), queue);

		const client = rendererSdk.client as unknown as CondaService;
		await expect(
			client["conda.envs.createFromFile"]({
				stagedHandle: "123e4567-e89b-12d3-a456-426614174000",
			}),
		).rejects.toThrow(/staged file not found/i);
		expect(createFromFile).not.toHaveBeenCalled();

		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.envs.createFromFile removes the staged copy after a successful job", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		const createFromFile = vi
			.fn()
			.mockResolvedValue({ name: "cleanup", prefix: "/tmp/envs/cleanup" });
		registerCondaHandlers(mainSdk, makeBackend({ createFromFile }), queue);

		const tmpDir = join(tmpdir(), "conda-handlers-test");
		await mkdir(tmpDir, { recursive: true });
		const tmpPath = join(tmpDir, "cleanup.yml");
		await writeFile(tmpPath, "name: cleanup\n", "utf-8");
		tmpFiles.push(tmpPath);

		const client = rendererSdk.client as unknown as CondaService;
		const preview = await client["conda.envs.readFile"]({ filePath: tmpPath });
		const stagedDir = join(mainSdk.storageDir, "import-staging", preview.stagedHandle);
		await expect(access(stagedDir)).resolves.toBeUndefined();

		await client["conda.envs.createFromFile"]({ stagedHandle: preview.stagedHandle });
		await expect(access(stagedDir)).rejects.toThrow();

		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.envs.createFromFile removes the staged copy after a failed job", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		const createFromFile = vi.fn().mockRejectedValue(new Error("conda failed"));
		registerCondaHandlers(mainSdk, makeBackend({ createFromFile }), queue);

		const tmpDir = join(tmpdir(), "conda-handlers-test");
		await mkdir(tmpDir, { recursive: true });
		const tmpPath = join(tmpDir, "cleanup-fail.yml");
		await writeFile(tmpPath, "name: cleanup\n", "utf-8");
		tmpFiles.push(tmpPath);

		const client = rendererSdk.client as unknown as CondaService;
		const preview = await client["conda.envs.readFile"]({ filePath: tmpPath });
		const stagedDir = join(mainSdk.storageDir, "import-staging", preview.stagedHandle);

		await expect(
			client["conda.envs.createFromFile"]({ stagedHandle: preview.stagedHandle }),
		).rejects.toThrow(/conda failed/);
		await expect(access(stagedDir)).rejects.toThrow();

		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.envs.prefixOptions returns envsDirs and channels from the backend", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		const prefixOptions = vi.fn().mockResolvedValue({
			envsDirs: ["/opt/anaconda3/envs", "/home/user/.conda/envs"],
			channels: ["defaults", "conda-forge"],
		});
		registerCondaHandlers(mainSdk, makeBackend({ prefixOptions }), queue);

		const client = rendererSdk.client as unknown as CondaService;
		const result = await client["conda.envs.prefixOptions"]();

		expect(result).toEqual({
			envsDirs: ["/opt/anaconda3/envs", "/home/user/.conda/envs"],
			channels: ["defaults", "conda-forge"],
		});
		expect(prefixOptions).toHaveBeenCalledOnce();

		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.envs.prefixOptions puts highest-priority distribution dir first", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		const prefixOptions = vi.fn().mockResolvedValue({
			envsDirs: ["/bridge/payload/envs", "/home/user/.conda/envs"],
			channels: ["defaults"],
		});
		const findDistributions = vi.fn().mockResolvedValue([
			{ prefix: "/opt/miniconda3", priority: 1 },
			{ prefix: "/opt/anaconda3", priority: 10 },
		]);
		registerCondaHandlers(mainSdk, makeBackend({ prefixOptions, findDistributions }), queue);

		const client = rendererSdk.client as unknown as CondaService;
		const result = await client["conda.envs.prefixOptions"]();

		expect(result.envsDirs).toEqual([
			"/opt/anaconda3/envs",
			"/opt/miniconda3/envs",
			"/bridge/payload/envs",
			"/home/user/.conda/envs",
		]);
		expect(result.channels).toEqual(["defaults"]);

		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.envs.prefixOptions degrades gracefully when findDistributions fails", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		const prefixOptions = vi.fn().mockResolvedValue({
			envsDirs: ["/bridge/payload/envs"],
			channels: ["defaults"],
		});
		const findDistributions = vi.fn().mockRejectedValue(new Error("bridge unavailable"));
		registerCondaHandlers(mainSdk, makeBackend({ prefixOptions, findDistributions }), queue);

		const client = rendererSdk.client as unknown as CondaService;
		const result = await client["conda.envs.prefixOptions"]();

		expect(result.envsDirs).toEqual(["/bridge/payload/envs"]);
		expect(result.channels).toEqual(["defaults"]);

		queue.dispose();
		mainSdk.dispose();
	});
});
