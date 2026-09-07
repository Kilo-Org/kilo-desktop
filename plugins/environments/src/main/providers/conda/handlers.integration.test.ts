import { describe, expect, it, vi } from "vitest";

import { createLinkedFakeSdkPair } from "@anaconda-agentic-desktop/testing";

import { ENVIRONMENTS_EVENT_NAMES, type JobProgressEvent } from "../../../contracts/common.js";
import {
	REPODATA_FIND_DEFAULT_LIMIT,
	type CondaRepodataPackage,
	type CondaService,
} from "../../../contracts/providers/conda.js";
import { JobQueue } from "../../JobQueue.js";
import { registerCondaHandlers } from "./handlers.js";
import type { CondaBackend } from "./CondaBackend.js";

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
		create: overrides.create ?? notImpl,
		clone: overrides.clone ?? notImpl,
		createFromFile: overrides.createFromFile ?? notImpl,
		remove: overrides.remove ?? notImpl,
		listPackages: overrides.listPackages ?? notImpl,
		install: overrides.install ?? notImpl,
		uninstall: overrides.uninstall ?? notImpl,
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

describe("conda handlers → sdk.invoke round-trip", () => {
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

	it("conda.envs.createFromFile returns { jobId, environment } and emits terminal succeeded", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const events: JobProgressEvent[] = [];
		const queue = new JobQueue({ emit: (event) => events.push(event) });
		const createFromFile = vi
			.fn()
			.mockResolvedValue({ name: "fromfile", prefix: "/tmp/envs/fromfile" });
		registerCondaHandlers(mainSdk, makeBackend({ createFromFile }), queue);

		const client = rendererSdk.client as unknown as CondaService;
		const result = await client["conda.envs.createFromFile"]({ file: "/tmp/env.yml" });

		expect(result.environment).toEqual({ name: "fromfile", prefix: "/tmp/envs/fromfile" });
		expect(result.jobId).toMatch(/^conda-/);
		expect(createFromFile).toHaveBeenCalledWith(
			{ file: "/tmp/env.yml" },
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
		// The exact-name filter is forwarded to the backend as-is.
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
		// The cap is applied before the response crosses the contract boundary,
		// so the renderer never receives the full match set.
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

		// Proves the contract's Zod default reaches the handler — without it the
		// slice would be unbounded and the cap silently ineffective.
		expect(result.packages).toHaveLength(REPODATA_FIND_DEFAULT_LIMIT);
		expect(result.truncated).toBe(true);

		queue.dispose();
		mainSdk.dispose();
	});

	it("conda.channels.list returns the backend's channel list through the renderer client", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		const listChannels = vi
			.fn()
			.mockResolvedValue(["defaults", "conda-forge", "https://my.repo/channel"]);
		registerCondaHandlers(mainSdk, makeBackend({ listChannels }), queue);

		const client = rendererSdk.client as unknown as CondaService;
		const channels = await client["conda.channels.list"]();

		expect(channels).toEqual(["defaults", "conda-forge", "https://my.repo/channel"]);
		expect(listChannels).toHaveBeenCalledOnce();
		queue.dispose();
		mainSdk.dispose();
	});

	it("memoises channel-list results within the read-cache TTL — a second call skips the backend", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		const listChannels = vi.fn().mockResolvedValue(["defaults"]);
		registerCondaHandlers(mainSdk, makeBackend({ listChannels }), queue);

		const client = rendererSdk.client as unknown as CondaService;
		await client["conda.channels.list"]();
		await client["conda.channels.list"]();
		expect(listChannels).toHaveBeenCalledOnce();

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

	it("plugin-scoped job-progress events surface on the fully-qualified environments.job-progress name", async () => {
		// Sanity check: the constant we advertise to renderer subscribers
		// matches the featureId + local event name path.
		expect(ENVIRONMENTS_EVENT_NAMES.JOB_PROGRESS).toBe("environments.job-progress");
	});
});
