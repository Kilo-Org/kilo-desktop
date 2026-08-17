import { describe, expect, it, vi } from "vitest";

import { createLinkedFakeSdkPair } from "@anaconda-agentic-desktop/testing";

import { condaContract, type CondaService } from "../../../contracts/providers/conda.js";
import { JobQueue } from "../../JobQueue.js";
import { registerCondaHandlers } from "./handlers.js";
import type { CondaBackend } from "./CondaBackend.js";

/**
 * Full-pipeline integration test: bind `conda.envs.list` via the same
 * `mainSdk.channels(condaContract).handle(...)` call used in production,
 * then invoke it through the renderer-side SDK. The `createLinkedFakeSdkPair`
 * shares one event bus + FeatureRouter across both sides, mirroring how
 * `sdk.invoke` reaches the main handler in browser mode.
 *
 * This is where sub-issue 4 proves the end-to-end wire: renderer client
 * -> validated router boundary -> handler -> backend method -> parsed
 * response back through the same schema. If the contract, handler, or
 * backend disagree on shape, this test fails.
 */
function makeBackend(overrides: Partial<CondaBackend> = {}): CondaBackend {
	const notImpl = () => {
		throw new Error("not used in this test");
	};
	return {
		list: overrides.list ?? (() => Promise.resolve([])),
		create: overrides.create ?? notImpl,
		remove: overrides.remove ?? notImpl,
		listPackages: overrides.listPackages ?? notImpl,
		install: overrides.install ?? notImpl,
		uninstall: overrides.uninstall ?? notImpl,
		listChannels: overrides.listChannels ?? notImpl,
		addChannel: overrides.addChannel ?? notImpl,
		removeChannel: overrides.removeChannel ?? notImpl,
	};
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

	it("does not bind write ops in this slice — invoking one throws NOT_FOUND at the router", async () => {
		const { rendererSdk, mainSdk } = createLinkedFakeSdkPair({ featureId: "environments" });
		const queue = new JobQueue({ emit: () => {} });
		registerCondaHandlers(mainSdk, makeBackend(), queue);

		// The router reports an unregistered channel as an error; the exact
		// message is shell-owned but must exist and mention the channel.
		await expect(rendererSdk.invoke("conda.envs.create", { name: "x" })).rejects.toThrow(
			/conda\.envs\.create/,
		);
		// Silence the "channel undefined at compile-time" concern — the
		// contract knows about `conda.envs.create` so an accidental typo
		// would still surface as a router error, not a silent no-op.
		void condaContract;
		queue.dispose();
		mainSdk.dispose();
	});
});
