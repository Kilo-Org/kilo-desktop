import {
	access,
	mkdir,
	mkdtemp,
	readFile,
	rmdir,
	symlink,
	unlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { definePlugin, KernelError, type DomainObjectMethods } from "@kilo-desktop/kernel";
import { createTestKernelPair } from "@kilo-desktop/kernel/testing";

import manifest from "../../plugin.json";
import {
	Conda,
	ENVIRONMENTS_DEFINITIONS,
	REPODATA_FIND_DEFAULT_LIMIT,
	type CondaRepodataPackage,
	type JobProgressEvent,
} from "../contracts/index";
import { createCondaService, type CondaService } from "./conda-service";
import { JobQueue } from "./job-queue";
import type { CondaBackend, CondaCreateFromFileRequest } from "./providers/conda/CondaBackend";

/**
 * Full-pipeline integration test: the conda service provided as
 * `kilo.environments/conda` on a real kernel, called through the domain
 * object (its input and output schemas validated at the boundary), with a
 * fake bridge backend.
 */
async function createServiceHost() {
	const storageDir = await mkdtemp(join(tmpdir(), "conda-service-"));
	let service: CondaService | undefined;
	let client: DomainObjectMethods<typeof Conda> | undefined;
	let stop: (() => Promise<void>) | undefined;
	return {
		storageDir,
		client: () => {
			if (!client) throw new Error("register a backend first");
			return client;
		},
		async register(backend: CondaBackend, queue: JobQueue) {
			const entry = definePlugin({
				activate(sdk) {
					service = createCondaService({
						backend,
						queue,
						storageDir: () => storageDir,
						pickFile: async () => null,
					});
					const { dispose: _dispose, ...methods } = service;
					sdk.domainObjects.provide(Conda, { initialState: { status: "ready" }, methods });
				},
			});
			const { main } = await createTestKernelPair({
				main: [{ manifest, definitions: ENVIRONMENTS_DEFINITIONS, entry }],
				renderer: [],
			});
			client = main.kernelSdk.domainObjects.get(Conda)!.methods;
			stop = () => main.stop();
		},
		dispose() {
			service?.dispose();
			void stop?.();
		},
	};
}
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
		resolveChannel: overrides.resolveChannel ?? notImpl,
		channelPolicies: overrides.channelPolicies ?? notImpl,
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

describe("conda service through the domain object", () => {
	afterEach(async () => {
		for (const f of tmpFiles) {
			await unlink(f).catch(() => rmdir(f).catch(() => {}));
		}
		tmpFiles.length = 0;
	});

	it("returns the backend's env list through the renderer client", async () => {
		const service = await createServiceHost();
		const queue = new JobQueue({ emit: () => {} });
		const list = vi.fn().mockResolvedValue([
			{ name: "", prefix: "/opt/conda" },
			{ name: "dev", prefix: "/opt/conda/envs/dev" },
		]);
		await service.register(makeBackend({ list }), queue);

		const client = service.client();
		const envs = await client.listEnvironments(undefined);

		expect(envs).toEqual([
			{ name: "", prefix: "/opt/conda" },
			{ name: "dev", prefix: "/opt/conda/envs/dev" },
		]);
		expect(list).toHaveBeenCalledOnce();
		queue.dispose();
		service.dispose();
	});

	it("memoises env-list results within the read-cache TTL — a second call skips the backend", async () => {
		const service = await createServiceHost();
		const queue = new JobQueue({ emit: () => {} });
		const list = vi.fn().mockResolvedValue([{ name: "", prefix: "/opt/conda" }]);
		await service.register(makeBackend({ list }), queue);

		const client = service.client();
		await client.listEnvironments(undefined);
		await client.listEnvironments(undefined);
		expect(list).toHaveBeenCalledOnce();

		queue.dispose();
		service.dispose();
	});

	it("validates the response against the contract — malformed backend output rejects", async () => {
		const service = await createServiceHost();
		const queue = new JobQueue({ emit: () => {} });
		await service.register(
			makeBackend({
				// oxlint-disable-next-line no-explicit-any -- deliberately breaking the contract
				list: (async () => [{ prefix: "" }]) as any,
			}),
			queue,
		);

		const client = service.client();
		await expect(client.listEnvironments(undefined)).rejects.toThrow();
		queue.dispose();
		service.dispose();
	});

	it("conda.envs.create returns { jobId, environment } and emits queued → running → succeeded on job-progress", async () => {
		const service = await createServiceHost();
		const events: JobProgressEvent[] = [];
		const queue = new JobQueue({
			emit: (event) => {
				events.push(event);
			},
		});
		const create = vi.fn().mockResolvedValue({
			name: "dev",
			prefix: "/tmp/conda-root/envs/dev",
		});
		await service.register(makeBackend({ create }), queue);

		const client = service.client();
		const result = await client.createEnvironment({ name: "dev" });

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
		service.dispose();
	});

	it("conda.envs.delete returns { jobId, name } and emits terminal succeeded on job-progress", async () => {
		const service = await createServiceHost();
		const events: JobProgressEvent[] = [];
		const queue = new JobQueue({ emit: (event) => events.push(event) });
		const remove = vi.fn().mockResolvedValue(undefined);
		await service.register(makeBackend({ remove }), queue);

		const client = service.client();
		const result = await client.deleteEnvironment({ name: "dev" });

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
		service.dispose();
	});

	it("conda.envs.distributions returns { distributions } and memoises within the read-cache TTL", async () => {
		const service = await createServiceHost();
		const queue = new JobQueue({ emit: () => {} });
		const findDistributions = vi.fn().mockResolvedValue([
			{ prefix: "/opt/miniconda3", priority: 10 },
			{ prefix: "/home/user/anaconda3", priority: 5 },
		]);
		await service.register(makeBackend({ findDistributions }), queue);

		const client = service.client();
		const result = await client.distributions(undefined);

		expect(result).toEqual({
			distributions: [
				{ prefix: "/opt/miniconda3", priority: 10 },
				{ prefix: "/home/user/anaconda3", priority: 5 },
			],
		});
		// Reads bypass the queue and cache, so a second call skips the backend.
		await client.distributions(undefined);
		expect(findDistributions).toHaveBeenCalledOnce();

		queue.dispose();
		service.dispose();
	});

	it("conda.envs.clone returns { jobId, environment } and emits queued → running → succeeded", async () => {
		const service = await createServiceHost();
		const events: JobProgressEvent[] = [];
		const queue = new JobQueue({ emit: (event) => events.push(event) });
		const clone = vi.fn().mockResolvedValue({ name: "cloned", prefix: "/tmp/envs/cloned" });
		await service.register(makeBackend({ clone }), queue);

		const client = service.client();
		const result = await client.cloneEnvironment({ sourceName: "source", name: "cloned" });

		expect(result.environment).toEqual({ name: "cloned", prefix: "/tmp/envs/cloned" });
		expect(result.jobId).toMatch(/^conda-/);
		expect(clone).toHaveBeenCalledWith(
			{ sourceName: "source", name: "cloned" },
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
		expect(events.map((e) => e.status)).toEqual(["queued", "running", "succeeded"]);
		expect(events.every((e) => e.kind === "envs.clone")).toBe(true);

		queue.dispose();
		service.dispose();
	});

	it("conda.envs.createFromFile imports the staged copy and emits terminal succeeded", async () => {
		const service = await createServiceHost();
		const events: JobProgressEvent[] = [];
		const queue = new JobQueue({ emit: (event) => events.push(event) });
		const createFromFile = vi
			.fn()
			.mockResolvedValue({ name: "fromfile", prefix: "/tmp/envs/fromfile" });
		await service.register(makeBackend({ createFromFile }), queue);

		const tmpDir = join(tmpdir(), "conda-handlers-test");
		await mkdir(tmpDir, { recursive: true });
		const tmpPath = join(tmpDir, "create-from-file.yml");
		await writeFile(tmpPath, "name: fromfile\n", "utf-8");
		tmpFiles.push(tmpPath);

		const client = service.client();
		const preview = await client.readEnvironmentFile({ filePath: tmpPath });
		const result = await client.createEnvironmentFromFile({
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
		service.dispose();
	});

	it("conda.envs.clone write invalidates the distributions read cache", async () => {
		const service = await createServiceHost();
		const queue = new JobQueue({ emit: () => {} });
		const findDistributions = vi.fn().mockResolvedValue([]);
		const clone = vi.fn().mockResolvedValue({ name: "cloned", prefix: "/tmp/envs/cloned" });
		await service.register(makeBackend({ findDistributions, clone }), queue);

		const client = service.client();
		await client.distributions(undefined);
		expect(findDistributions).toHaveBeenCalledTimes(1);
		await client.cloneEnvironment({ sourceName: "source", name: "cloned" });
		await client.distributions(undefined);
		expect(findDistributions).toHaveBeenCalledTimes(2);

		queue.dispose();
		service.dispose();
	});

	it("conda.envs.delete accepts a prefix-only target for base/nameless envs", async () => {
		const service = await createServiceHost();
		const events: JobProgressEvent[] = [];
		const queue = new JobQueue({ emit: (event) => events.push(event) });
		const remove = vi.fn().mockResolvedValue(undefined);
		await service.register(makeBackend({ remove }), queue);

		const client = service.client();
		const result = await client.deleteEnvironment({ prefix: "/opt/conda/envs/custom" });

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
		service.dispose();
	});

	it("conda.envs.create write invalidates the read cache — the next envs.list re-runs the backend", async () => {
		const service = await createServiceHost();
		const queue = new JobQueue({ emit: () => {} });
		const list = vi.fn().mockResolvedValue([]);
		const create = vi.fn().mockResolvedValue({ name: "dev", prefix: "/tmp/envs/dev" });
		await service.register(makeBackend({ list, create }), queue);

		const client = service.client();
		await client.listEnvironments(undefined);
		expect(list).toHaveBeenCalledTimes(1);
		await client.createEnvironment({ name: "dev" });
		await client.listEnvironments(undefined);
		expect(list).toHaveBeenCalledTimes(2);

		queue.dispose();
		service.dispose();
	});

	it("conda.repodata.find returns matching packages through the renderer client", async () => {
		const service = await createServiceHost();
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
		await service.register(makeBackend({ findRepodata }), queue);

		const client = service.client();
		const result = await client.findRepodata({ names: ["numpy"] });

		expect(result).toEqual({ packages: [numpy], truncated: false });
		expect(findRepodata).toHaveBeenCalledWith(
			{ names: ["numpy"] },
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
		queue.dispose();
		service.dispose();
	});

	it("caps repodata.find at the requested limit and flags truncation", async () => {
		const service = await createServiceHost();
		const queue = new JobQueue({ emit: () => {} });
		const findRepodata = vi.fn().mockResolvedValue(makeRepodataMatches(12));
		await service.register(makeBackend({ findRepodata }), queue);

		const client = service.client();
		const result = await client.findRepodata({ names: ["numpy"], limit: 5 });

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
		service.dispose();
	});

	it("reports truncated=false when the match set fits inside the limit", async () => {
		const service = await createServiceHost();
		const queue = new JobQueue({ emit: () => {} });
		const findRepodata = vi.fn().mockResolvedValue(makeRepodataMatches(3));
		await service.register(makeBackend({ findRepodata }), queue);

		const client = service.client();
		const result = await client.findRepodata({ names: ["numpy"], limit: 3 });

		expect(result.packages).toHaveLength(3);
		expect(result.truncated).toBe(false);

		queue.dispose();
		service.dispose();
	});

	it("applies the default limit when the caller omits it", async () => {
		const service = await createServiceHost();
		const queue = new JobQueue({ emit: () => {} });
		const findRepodata = vi
			.fn()
			.mockResolvedValue(makeRepodataMatches(REPODATA_FIND_DEFAULT_LIMIT + 25));
		await service.register(makeBackend({ findRepodata }), queue);

		const client = service.client();
		const result = await client.findRepodata({ names: ["numpy"] });

		expect(result.packages).toHaveLength(REPODATA_FIND_DEFAULT_LIMIT);
		expect(result.truncated).toBe(true);

		queue.dispose();
		service.dispose();
	});

	it("conda.packages.preview forwards to backend.previewUpdate through the read queue", async () => {
		const service = await createServiceHost();
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
		await service.register(makeBackend({ previewUpdate }), queue);

		const client = service.client();
		const result = await client.previewUpdate({
			name: "dev",
			packages: ["numpy"],
		});

		expect(result.upgraded).toHaveLength(1);
		expect(result.upgraded[0]!.name).toBe("numpy");
		expect(previewUpdate).toHaveBeenCalledOnce();

		queue.dispose();
		service.dispose();
	});

	it("conda.packages.previewInstall forwards to backend.previewInstall through the read queue", async () => {
		const service = await createServiceHost();
		const queue = new JobQueue({ emit: () => {} });
		const previewInstall = vi.fn().mockResolvedValue({
			upgraded: [],
			downgraded: [],
			added: [{ name: "requests", fromVersion: null, toVersion: "2.32.0", channel: "conda-forge" }],
			removed: [],
			rebuilt: [],
			nothingToDo: false,
		});
		await service.register(makeBackend({ previewInstall }), queue);

		const client = service.client();
		const result = await client.previewInstall({
			name: "dev",
			packages: ["requests"],
		});

		expect(result.added).toHaveLength(1);
		expect(result.added[0]!.name).toBe("requests");
		expect(previewInstall).toHaveBeenCalledOnce();

		queue.dispose();
		service.dispose();
	});

	it("conda.repodata.find forwards optional name/channel/subdir filters to the backend", async () => {
		const service = await createServiceHost();
		const queue = new JobQueue({ emit: () => {} });
		const findRepodata = vi.fn().mockResolvedValue([]);
		await service.register(makeBackend({ findRepodata }), queue);

		const client = service.client();
		await client.findRepodata({
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
		service.dispose();
	});

	it("conda.envs.create honours an explicit prefix by threading it through to the backend", async () => {
		const service = await createServiceHost();
		const queue = new JobQueue({ emit: () => {} });
		const create = vi.fn().mockResolvedValue({
			name: "dev",
			prefix: "/tmp/custom/dev",
		});
		await service.register(makeBackend({ create }), queue);

		const client = service.client();
		const result = await client.createEnvironment({
			name: "dev",
			prefix: "/tmp/custom/dev",
		});

		expect(result.environment.prefix).toBe("/tmp/custom/dev");
		expect(create).toHaveBeenCalledOnce();
		// The third argument to backend.create is the options bag, which should
		// carry the explicit prefix when the caller provided one.
		expect(create.mock.calls[0]![2]).toEqual({ prefix: "/tmp/custom/dev" });

		queue.dispose();
		service.dispose();
	});

	it("conda.envs.checkPrefix reports a free prefix, then an existing env, without touching the backend", async () => {
		const service = await createServiceHost();
		const queue = new JobQueue({ emit: () => {} });
		const backend = makeBackend();
		await service.register(backend, queue);
		const prefix = join(tmpdir(), `conda-check-prefix-${process.pid}-${Date.now()}`);
		tmpFiles.push(join(prefix, "conda-meta"), prefix);

		const client = service.client();
		await expect(client.checkPrefix({ prefix })).resolves.toEqual({
			available: true,
		});

		await mkdir(join(prefix, "conda-meta"), { recursive: true });
		// Not read-cached: the second call sees the env created since the first.
		await expect(client.checkPrefix({ prefix })).resolves.toEqual({
			available: false,
			reason: "exists-environment",
		});

		queue.dispose();
		service.dispose();
	});

	it("conda.envs.create rejects with ENV_EXISTS before calling the bridge when the prefix is already an env", async () => {
		const service = await createServiceHost();
		const events: JobProgressEvent[] = [];
		const queue = new JobQueue({ emit: (event) => events.push(event) });
		const create = vi.fn();
		await service.register(makeBackend({ create }), queue);
		const prefix = join(tmpdir(), `conda-create-exists-${process.pid}-${Date.now()}`);
		await mkdir(join(prefix, "conda-meta"), { recursive: true });
		tmpFiles.push(join(prefix, "conda-meta"), prefix);

		const client = service.client();
		await expect(client.createEnvironment({ name: "dev", prefix })).rejects.toThrow(
			`ENV_EXISTS: ${prefix}`,
		);

		expect(create).not.toHaveBeenCalled();
		expect(events.map((e) => e.status)).toEqual(["queued", "running", "failed"]);

		queue.dispose();
		service.dispose();
	});

	it("conda.channels.list returns the backend's channel list and caches within TTL", async () => {
		const service = await createServiceHost();
		const queue = new JobQueue({ emit: () => {} });
		const listChannels = vi.fn().mockResolvedValue(["defaults", "conda-forge"]);
		await service.register(makeBackend({ listChannels }), queue);

		const client = service.client();
		const channels = await client.listChannels(undefined);

		expect(channels).toEqual(["defaults", "conda-forge"]);
		expect(listChannels).toHaveBeenCalledOnce();

		// Second call within TTL should hit cache
		await client.listChannels(undefined);
		expect(listChannels).toHaveBeenCalledOnce();

		queue.dispose();
		service.dispose();
	});

	it("reports channel policies, cached per channel set until a write", async () => {
		const service = await createServiceHost();
		const queue = new JobQueue({ emit: () => {} });
		const channelPolicies = vi.fn(async (channels: readonly string[] | undefined) => ({
			channels: (channels ?? ["defaults"]).map((channel) => ({
				channel,
				entries: [
					{
						baseUrl: "https://repo.anaconda.cloud/repo/main",
						org: "acme",
						policyId: "0b7c3c1e-2f4e-4a5b-9a51-3f6c9e1d2a10",
						policyName: "No critical CVEs",
						lookupFailed: false,
					},
				],
			})),
		}));
		const addChannel = vi.fn().mockResolvedValue(["defaults", "bioconda"]);
		await service.register(makeBackend({ channelPolicies, addChannel }), queue);
		const client = service.client();

		expect(await client.channelPolicies({ channels: ["defaults"] })).toMatchObject({
			channels: [
				{ channel: "defaults", entries: [{ org: "acme", policyName: "No critical CVEs" }] },
			],
		});
		await client.channelPolicies({ channels: ["defaults"] });
		expect(channelPolicies).toHaveBeenCalledOnce();

		await client.channelPolicies({});
		expect(channelPolicies.mock.calls.map(([channels]) => channels)).toEqual([
			["defaults"],
			undefined,
		]);

		await client.addChannel({ channel: "bioconda" });
		await client.channelPolicies({ channels: ["defaults"] });
		expect(channelPolicies).toHaveBeenCalledTimes(3);

		queue.dispose();
		service.dispose();
	});

	it("conda.channels.resolve caches per channel until a channel write", async () => {
		const service = await createServiceHost();
		const queue = new JobQueue({ emit: () => {} });
		const resolveChannel = vi.fn(async (channel: string) => ({
			channel,
			name: channel,
			isMultichannel: false,
			baseUrls: [`https://conda.anaconda.org/${channel}`],
			configured: false,
			configuredBy: [],
			exact: true,
		}));
		const addChannel = vi.fn().mockResolvedValue(["defaults", "bioconda"]);
		await service.register(makeBackend({ resolveChannel, addChannel }), queue);

		const client = service.client();
		expect(await client.resolveChannel({ channel: "bioconda" })).toMatchObject({
			channel: "bioconda",
			configured: false,
			exact: true,
		});
		await client.resolveChannel({ channel: "bioconda" });
		expect(resolveChannel).toHaveBeenCalledOnce();

		await client.resolveChannel({ channel: "conda-forge" });
		expect(resolveChannel).toHaveBeenCalledTimes(2);

		await client.addChannel({ channel: "bioconda" });
		await client.resolveChannel({ channel: "bioconda" });
		expect(resolveChannel).toHaveBeenCalledTimes(3);
		expect(resolveChannel.mock.calls.map(([channel]) => channel)).toEqual([
			"bioconda",
			"conda-forge",
			"bioconda",
		]);

		queue.dispose();
		service.dispose();
	});

	it("conda.channels.resolve rejects a flag-like channel before reaching the backend", async () => {
		const service = await createServiceHost();
		const queue = new JobQueue({ emit: () => {} });
		const resolveChannel = vi.fn();
		await service.register(makeBackend({ resolveChannel }), queue);

		await expect(
			service.client().resolveChannel({ channel: "--override-channels" }),
		).rejects.toBeInstanceOf(KernelError);
		expect(resolveChannel).not.toHaveBeenCalled();

		queue.dispose();
		service.dispose();
	});

	it("conda.jobs.cancel returns { cancelled: false } for an unknown job id", async () => {
		const service = await createServiceHost();
		const queue = new JobQueue({ emit: () => {} });
		await service.register(makeBackend(), queue);

		const client = service.client();
		const result = await client.cancelJob({ jobId: "nonexistent-99" });
		expect(result.cancelled).toBe(false);

		queue.dispose();
		service.dispose();
	});

	it("conda.packages.install write invalidates the read cache — next packages.list re-runs the backend", async () => {
		const service = await createServiceHost();
		const queue = new JobQueue({ emit: () => {} });
		const listPackages = vi.fn().mockResolvedValue([]);
		const install = vi.fn().mockResolvedValue({
			jobId: "",
			envName: "dev",
			installed: [],
		});
		await service.register(makeBackend({ listPackages, install }), queue);

		const client = service.client();
		await client.listPackages({ name: "dev" });
		expect(listPackages).toHaveBeenCalledTimes(1);

		await client.installPackages({ name: "dev", packages: ["numpy"] });
		await client.listPackages({ name: "dev" });
		expect(listPackages).toHaveBeenCalledTimes(2);

		queue.dispose();
		service.dispose();
	});

	it("serves different limits for one query from a single backend call", async () => {
		const service = await createServiceHost();
		const queue = new JobQueue({ emit: () => {} });
		const findRepodata = vi.fn().mockResolvedValue(makeRepodataMatches(20));
		await service.register(makeBackend({ findRepodata }), queue);

		const client = service.client();
		const narrow = await client.findRepodata({ names: ["numpy"], limit: 2 });
		const wide = await client.findRepodata({ names: ["numpy"], limit: 10 });

		// `limit` is deliberately absent from the read-cache key, so widening it
		// within the TTL re-slices the cached match set instead of re-querying.
		expect(narrow.packages).toHaveLength(2);
		expect(wide.packages).toHaveLength(10);
		expect(findRepodata).toHaveBeenCalledOnce();

		queue.dispose();
		service.dispose();
	});

	it("forwards a partial-match query to the backend and truncates its ranked result", async () => {
		const service = await createServiceHost();
		const queue = new JobQueue({ emit: () => {} });
		const findRepodata = vi.fn().mockResolvedValue(makeRepodataMatches(5));
		await service.register(makeBackend({ findRepodata }), queue);

		const client = service.client();
		const result = await client.findRepodata({ query: "pkg", limit: 3 });

		// The backend (bridge) filters and ranks; the handler only slices.
		expect(findRepodata).toHaveBeenCalledWith(
			{ query: "pkg" },
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
		expect(result.packages.map((pkg) => pkg.name)).toEqual(["pkg-0", "pkg-1", "pkg-2"]);
		expect(result.truncated).toBe(true);

		queue.dispose();
		service.dispose();
	});

	it("caches each query separately — a repeated keystroke is served from the read cache", async () => {
		const service = await createServiceHost();
		const queue = new JobQueue({ emit: () => {} });
		const findRepodata = vi.fn().mockResolvedValue(makeRepodataMatches(2));
		await service.register(makeBackend({ findRepodata }), queue);

		const client = service.client();
		await client.findRepodata({ query: "pkg-1" });
		await client.findRepodata({ query: "pkg-2" });
		await client.findRepodata({ query: "pkg-1" });

		expect(findRepodata).toHaveBeenCalledTimes(2);

		queue.dispose();
		service.dispose();
	});

	it("conda.packages.install enqueues, stamps the queue jobId, and emits queued → running → succeeded", async () => {
		const service = await createServiceHost();
		const events: JobProgressEvent[] = [];
		const queue = new JobQueue({ emit: (event) => events.push(event) });
		const installed = [
			{ name: "faker", version: "40.38.0", build: "pyhd8ed1ab_0", channel: "conda-forge" },
		];
		const install = vi.fn().mockResolvedValue({ jobId: "", envName: "dev", installed });
		await service.register(makeBackend({ install }), queue);

		const client = service.client();
		const result = await client.installPackages({ name: "dev", packages: ["faker"] });

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
		service.dispose();
	});

	it("conda.packages.install forwards optional channels to the backend", async () => {
		const service = await createServiceHost();
		const queue = new JobQueue({ emit: () => {} });
		const install = vi.fn().mockResolvedValue({ jobId: "", envName: "dev", installed: [] });
		await service.register(makeBackend({ install }), queue);

		const client = service.client();
		await client.installPackages({
			name: "dev",
			packages: ["faker>=30"],
			channels: ["conda-forge"],
		});

		expect(install).toHaveBeenCalledWith(
			{ name: "dev", packages: ["faker>=30"], channels: ["conda-forge"] },
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);

		queue.dispose();
		service.dispose();
	});

	it("conda.packages.remove enqueues, stamps the queue jobId, and emits queued → running → succeeded", async () => {
		const service = await createServiceHost();
		const events: JobProgressEvent[] = [];
		const queue = new JobQueue({ emit: (event) => events.push(event) });
		const uninstall = vi.fn().mockResolvedValue({ jobId: "", envName: "dev", removed: ["faker"] });
		await service.register(makeBackend({ uninstall }), queue);

		const client = service.client();
		const result = await client.removePackages({ name: "dev", packages: ["faker"] });

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
		service.dispose();
	});

	it("conda.packages.remove write clears the read cache — the next packages.list re-runs the backend", async () => {
		const service = await createServiceHost();
		const queue = new JobQueue({ emit: () => {} });
		const listPackages = vi.fn().mockResolvedValue([]);
		const uninstall = vi.fn().mockResolvedValue({ jobId: "", envName: "dev", removed: ["faker"] });
		await service.register(makeBackend({ listPackages, uninstall }), queue);

		const client = service.client();
		await client.listPackages({ name: "dev" });
		expect(listPackages).toHaveBeenCalledOnce();
		await client.removePackages({ name: "dev", packages: ["faker"] });
		await client.listPackages({ name: "dev" });
		expect(listPackages).toHaveBeenCalledTimes(2);

		queue.dispose();
		service.dispose();
	});

	it("conda.packages.update enqueues, stamps the queue jobId, and emits queued → running → succeeded", async () => {
		const service = await createServiceHost();
		const events: JobProgressEvent[] = [];
		const queue = new JobQueue({ emit: (event) => events.push(event) });
		const updated = [
			{ name: "numpy", version: "1.26.4", build: "py311_0", channel: "conda-forge" },
		];
		const update = vi.fn().mockResolvedValue({ jobId: "", envName: "dev", updated });
		await service.register(makeBackend({ update }), queue);

		const client = service.client();
		const result = await client.updatePackages({ name: "dev", packages: ["numpy"] });

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
		service.dispose();
	});

	it("conda.packages.update forwards updateAll and optional channels to the backend", async () => {
		const service = await createServiceHost();
		const queue = new JobQueue({ emit: () => {} });
		const update = vi.fn().mockResolvedValue({ jobId: "", envName: "dev", updated: [] });
		await service.register(makeBackend({ update }), queue);

		const client = service.client();
		await client.updatePackages({
			name: "dev",
			updateAll: true,
			channels: ["conda-forge"],
		});

		expect(update).toHaveBeenCalledWith(
			{ name: "dev", updateAll: true, channels: ["conda-forge"] },
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);

		queue.dispose();
		service.dispose();
	});

	it("conda.packages.update write clears the read cache — the next packages.list re-runs the backend", async () => {
		const service = await createServiceHost();
		const queue = new JobQueue({ emit: () => {} });
		const listPackages = vi.fn().mockResolvedValue([]);
		const update = vi.fn().mockResolvedValue({ jobId: "", envName: "dev", updated: [] });
		await service.register(makeBackend({ listPackages, update }), queue);

		const client = service.client();
		await client.listPackages({ name: "dev" });
		expect(listPackages).toHaveBeenCalledOnce();
		await client.updatePackages({ name: "dev", packages: ["numpy"] });
		await client.listPackages({ name: "dev" });
		expect(listPackages).toHaveBeenCalledTimes(2);

		queue.dispose();
		service.dispose();
	});

	it("conda.envs.readFile returns the file content for a valid YAML file", async () => {
		const service = await createServiceHost();
		const queue = new JobQueue({ emit: () => {} });
		await service.register(makeBackend(), queue);

		const tmpDir = join(tmpdir(), "conda-handlers-test");
		await mkdir(tmpDir, { recursive: true });
		const tmpPath = join(tmpDir, "env.yml");
		const yamlContent = "name: test-env\ndependencies:\n  - numpy\n";
		await writeFile(tmpPath, yamlContent, "utf-8");
		tmpFiles.push(tmpPath);

		const client = service.client();
		const result = await client.readEnvironmentFile({ filePath: tmpPath });

		expect(result.content).toBe(yamlContent);
		expect(result.stagedHandle).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
		);

		queue.dispose();
		service.dispose();
	});

	it("conda.envs.readFile rejects with VALIDATION for non-YAML extension", async () => {
		const service = await createServiceHost();
		const queue = new JobQueue({ emit: () => {} });
		await service.register(makeBackend(), queue);

		const client = service.client();
		await expect(client.readEnvironmentFile({ filePath: "/tmp/env.txt" })).rejects.toMatchObject({
			code: "VALIDATION",
		});

		queue.dispose();
		service.dispose();
	});

	it("conda.envs.readFile rejects a symlink whose target is not a YAML file", async () => {
		const service = await createServiceHost();
		const queue = new JobQueue({ emit: () => {} });
		await service.register(makeBackend(), queue);

		const tmpDir = join(tmpdir(), "conda-handlers-test");
		await mkdir(tmpDir, { recursive: true });
		// Create a non-YAML target and a .yml symlink pointing to it.
		const targetPath = join(tmpDir, "secret.txt");
		await writeFile(targetPath, "not yaml", "utf-8");
		tmpFiles.push(targetPath);
		const symlinkPath = join(tmpDir, "sneaky.yml");
		await symlink(targetPath, symlinkPath);
		tmpFiles.push(symlinkPath);

		const client = service.client();
		await expect(client.readEnvironmentFile({ filePath: symlinkPath })).rejects.toThrow(/YAML/);

		queue.dispose();
		service.dispose();
	});

	it("conda.envs.readFile follows a symlink whose target IS a YAML file", async () => {
		const service = await createServiceHost();
		const queue = new JobQueue({ emit: () => {} });
		await service.register(makeBackend(), queue);

		const tmpDir = join(tmpdir(), "conda-handlers-test");
		await mkdir(tmpDir, { recursive: true });
		const targetPath = join(tmpDir, "real-env.yaml");
		const yamlContent = "name: linked-env\ndependencies:\n  - scipy\n";
		await writeFile(targetPath, yamlContent, "utf-8");
		tmpFiles.push(targetPath);
		const symlinkPath = join(tmpDir, "link.yml");
		await symlink(targetPath, symlinkPath);
		tmpFiles.push(symlinkPath);

		const client = service.client();
		const result = await client.readEnvironmentFile({ filePath: symlinkPath });
		expect(result.content).toBe(yamlContent);
		expect(result.stagedHandle).toBeTruthy();

		queue.dispose();
		service.dispose();
	});

	it("conda.envs.readFile rejects a directory path", async () => {
		const service = await createServiceHost();
		const queue = new JobQueue({ emit: () => {} });
		await service.register(makeBackend(), queue);

		const tmpDir = join(tmpdir(), "conda-handlers-test", "fake-env.yml");
		await mkdir(tmpDir, { recursive: true });
		tmpFiles.push(tmpDir);

		const client = service.client();
		await expect(client.readEnvironmentFile({ filePath: tmpDir })).rejects.toThrow(/regular file/);

		queue.dispose();
		service.dispose();
	});

	it("conda.envs.readFile rejects a symlink to a directory", async () => {
		const service = await createServiceHost();
		const queue = new JobQueue({ emit: () => {} });
		await service.register(makeBackend(), queue);

		// The target keeps a .yml name so the extension guard passes and the
		// regular-file guard is what rejects it.
		const targetDir = join(tmpdir(), "conda-handlers-test", "target-dir.yml");
		await mkdir(targetDir, { recursive: true });
		const linkPath = join(tmpdir(), "conda-handlers-test", "dir-link.yml");
		await symlink(targetDir, linkPath);
		tmpFiles.push(linkPath, targetDir);

		const client = service.client();
		await expect(client.readEnvironmentFile({ filePath: linkPath })).rejects.toThrow(
			/regular file/,
		);

		queue.dispose();
		service.dispose();
	});

	it("conda.envs.readFile rejects files exceeding the size limit", async () => {
		const service = await createServiceHost();
		const queue = new JobQueue({ emit: () => {} });
		await service.register(makeBackend(), queue);

		const tmpDir = join(tmpdir(), "conda-handlers-test");
		await mkdir(tmpDir, { recursive: true });
		const tmpPath = join(tmpDir, "huge.yml");
		// Write just over 1 MB to trigger the size guard.
		await writeFile(tmpPath, "a".repeat(1024 * 1024 + 1), "utf-8");
		tmpFiles.push(tmpPath);

		const client = service.client();
		await expect(client.readEnvironmentFile({ filePath: tmpPath })).rejects.toThrow(/too large/);

		queue.dispose();
		service.dispose();
	});

	it("conda.envs.createFromFile imports the reviewed bytes even if the source file is swapped", async () => {
		const service = await createServiceHost();
		const queue = new JobQueue({ emit: () => {} });
		let stagedFile: string | undefined;
		let stagedContent: string | undefined;
		const createFromFile = vi.fn(async (request: CondaCreateFromFileRequest) => {
			stagedFile = request.file;
			stagedContent = await readFile(request.file, "utf-8");
			return { name: "reviewed", prefix: "/tmp/envs/reviewed" };
		});
		await service.register(makeBackend({ createFromFile }), queue);

		const tmpDir = join(tmpdir(), "conda-handlers-test");
		await mkdir(tmpDir, { recursive: true });
		const tmpPath = join(tmpDir, "swap.yml");
		const reviewed = "name: reviewed\ndependencies:\n  - safe-pkg\n";
		await writeFile(tmpPath, reviewed, "utf-8");
		tmpFiles.push(tmpPath);

		const client = service.client();
		const preview = await client.readEnvironmentFile({ filePath: tmpPath });
		expect(preview.content).toBe(reviewed);

		// A collaborator swaps the source file between review and import.
		await writeFile(tmpPath, "name: reviewed\ndependencies:\n  - evil-pkg\n", "utf-8");

		await client.createEnvironmentFromFile({ stagedHandle: preview.stagedHandle });

		expect(stagedFile).toContain("import-staging");
		expect(stagedContent).toBe(reviewed);

		queue.dispose();
		service.dispose();
	});

	it("conda.envs.createFromFile uses the reviewed bytes when the source symlink is repointed", async () => {
		const service = await createServiceHost();
		const queue = new JobQueue({ emit: () => {} });
		let stagedContent: string | undefined;
		const createFromFile = vi.fn(async (request: CondaCreateFromFileRequest) => {
			stagedContent = await readFile(request.file, "utf-8");
			return { name: "linked", prefix: "/tmp/envs/linked" };
		});
		await service.register(makeBackend({ createFromFile }), queue);

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

		const client = service.client();
		const preview = await client.readEnvironmentFile({ filePath: linkPath });
		expect(preview.content).toBe(reviewed);

		// Repoint the symlink after review.
		await unlink(linkPath);
		await symlink(second, linkPath);

		await client.createEnvironmentFromFile({ stagedHandle: preview.stagedHandle });
		expect(stagedContent).toBe(reviewed);

		queue.dispose();
		service.dispose();
	});

	it("conda.envs.createFromFile rejects an unknown staged handle with VALIDATION", async () => {
		const service = await createServiceHost();
		const queue = new JobQueue({ emit: () => {} });
		const createFromFile = vi.fn();
		await service.register(makeBackend({ createFromFile }), queue);

		const client = service.client();
		await expect(
			client.createEnvironmentFromFile({
				stagedHandle: "123e4567-e89b-12d3-a456-426614174000",
			}),
		).rejects.toThrow(/staged file not found/i);
		expect(createFromFile).not.toHaveBeenCalled();

		queue.dispose();
		service.dispose();
	});

	it("conda.envs.createFromFile removes the staged copy after a successful job", async () => {
		const service = await createServiceHost();
		const queue = new JobQueue({ emit: () => {} });
		const createFromFile = vi
			.fn()
			.mockResolvedValue({ name: "cleanup", prefix: "/tmp/envs/cleanup" });
		await service.register(makeBackend({ createFromFile }), queue);

		const tmpDir = join(tmpdir(), "conda-handlers-test");
		await mkdir(tmpDir, { recursive: true });
		const tmpPath = join(tmpDir, "cleanup.yml");
		await writeFile(tmpPath, "name: cleanup\n", "utf-8");
		tmpFiles.push(tmpPath);

		const client = service.client();
		const preview = await client.readEnvironmentFile({ filePath: tmpPath });
		const stagedDir = join(service.storageDir, "import-staging", preview.stagedHandle);
		await expect(access(stagedDir)).resolves.toBeUndefined();

		await client.createEnvironmentFromFile({ stagedHandle: preview.stagedHandle });
		await expect(access(stagedDir)).rejects.toThrow();

		queue.dispose();
		service.dispose();
	});

	it("conda.envs.createFromFile removes the staged copy after a failed job", async () => {
		const service = await createServiceHost();
		const queue = new JobQueue({ emit: () => {} });
		const createFromFile = vi
			.fn()
			.mockRejectedValue(new KernelError("BUSINESS", "SOLVE_FAILED: conda failed"));
		await service.register(makeBackend({ createFromFile }), queue);

		const tmpDir = join(tmpdir(), "conda-handlers-test");
		await mkdir(tmpDir, { recursive: true });
		const tmpPath = join(tmpDir, "cleanup-fail.yml");
		await writeFile(tmpPath, "name: cleanup\n", "utf-8");
		tmpFiles.push(tmpPath);

		const client = service.client();
		const preview = await client.readEnvironmentFile({ filePath: tmpPath });
		const stagedDir = join(service.storageDir, "import-staging", preview.stagedHandle);

		await expect(
			client.createEnvironmentFromFile({ stagedHandle: preview.stagedHandle }),
		).rejects.toThrow(/conda failed/);
		await expect(access(stagedDir)).rejects.toThrow();

		queue.dispose();
		service.dispose();
	});

	it("conda.envs.prefixOptions returns envsDirs and channels from the backend", async () => {
		const service = await createServiceHost();
		const queue = new JobQueue({ emit: () => {} });
		const prefixOptions = vi.fn().mockResolvedValue({
			envsDirs: ["/opt/anaconda3/envs", "/home/user/.conda/envs"],
			channels: ["defaults", "conda-forge"],
		});
		await service.register(makeBackend({ prefixOptions }), queue);

		const client = service.client();
		const result = await client.prefixOptions(undefined);

		expect(result).toEqual({
			envsDirs: ["/opt/anaconda3/envs", "/home/user/.conda/envs"],
			channels: ["defaults", "conda-forge"],
		});
		expect(prefixOptions).toHaveBeenCalledOnce();

		queue.dispose();
		service.dispose();
	});

	it("conda.envs.prefixOptions puts highest-priority distribution dir first", async () => {
		const service = await createServiceHost();
		const queue = new JobQueue({ emit: () => {} });
		const prefixOptions = vi.fn().mockResolvedValue({
			envsDirs: ["/bridge/payload/envs", "/home/user/.conda/envs"],
			channels: ["defaults"],
		});
		const findDistributions = vi.fn().mockResolvedValue([
			{ prefix: "/opt/miniconda3", priority: 1 },
			{ prefix: "/opt/anaconda3", priority: 10 },
		]);
		await service.register(makeBackend({ prefixOptions, findDistributions }), queue);

		const client = service.client();
		const result = await client.prefixOptions(undefined);

		expect(result.envsDirs).toEqual([
			"/opt/anaconda3/envs",
			"/opt/miniconda3/envs",
			"/bridge/payload/envs",
			"/home/user/.conda/envs",
		]);
		expect(result.channels).toEqual(["defaults"]);

		queue.dispose();
		service.dispose();
	});

	it("conda.envs.prefixOptions degrades gracefully when findDistributions fails", async () => {
		const service = await createServiceHost();
		const queue = new JobQueue({ emit: () => {} });
		const prefixOptions = vi.fn().mockResolvedValue({
			envsDirs: ["/bridge/payload/envs"],
			channels: ["defaults"],
		});
		const findDistributions = vi.fn().mockRejectedValue(new Error("bridge unavailable"));
		await service.register(makeBackend({ prefixOptions, findDistributions }), queue);

		const client = service.client();
		const result = await client.prefixOptions(undefined);

		expect(result.envsDirs).toEqual(["/bridge/payload/envs"]);
		expect(result.channels).toEqual(["defaults"]);

		queue.dispose();
		service.dispose();
	});
});
