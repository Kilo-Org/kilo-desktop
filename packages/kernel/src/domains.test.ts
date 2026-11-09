import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineDomain, method, ref } from "./domain";
import { DisposableScope } from "./disposables";
import type { DomainProvider } from "./domain-registry";
import { KernelError } from "./errors";
import { createKernel } from "./kernel";
import { createPluginSdk, SILENT_LOGGER, type PluginSdk } from "./sdk";
import { testPlugin } from "./test-fixtures";
import { createLinkedTransports } from "./transport";

const Counter = defineDomain({
	id: "acme.host/counter",
	home: "main",
	state: z.object({
		count: z.number(),
		items: z.record(z.string(), z.object({ name: z.string() })),
	}),
	methods: {
		increment: method(z.object({ by: z.number() }), z.object({ count: z.number() })),
		whoami: method(z.undefined(), z.string()),
		fail: method(z.object({ expected: z.boolean() }), z.undefined()),
	},
	events: { bumped: z.object({ count: z.number() }) },
	lookup: (state, id) => state.items[id],
});

const Guarded = defineDomain({
	id: "acme.host/guarded",
	home: "main",
	state: z.object({}),
	methods: { touch: method(z.undefined(), z.literal("ok")) },
	permission: "windows",
});

const Clipboard = defineDomain({
	id: "acme.host/clipboard",
	home: "main",
	state: z.object({}),
	methods: { read: method(z.undefined(), z.string()) },
	permission: "clipboard",
});

const Vault = defineDomain({
	id: "acme.host/vault",
	home: "main",
	state: z.object({}),
	methods: { reveal: method(z.undefined(), z.string()) },
	homeCallersOnly: true,
});

function provideCounter(sdk: PluginSdk): DomainProvider<typeof Counter> {
	const provider: DomainProvider<typeof Counter> = sdk.domains.provide(Counter, {
		initialState: { count: 0, items: { a: { name: "Alpha" } } },
		methods: {
			increment: ({ by }): { count: number } => {
				provider.update((state) => ({ ...state, count: state.count + by }));
				provider.emit("bumped", { count: provider.state.count });
				return { count: provider.state.count };
			},
			whoami: (_input, caller) => `${caller.pluginId} (${caller.process})`,
			fail: ({ expected }) => {
				if (expected) throw new KernelError("NOT_FOUND", "Nothing here.");
				throw new Error("secret internals");
			},
		},
	});
	sdk.domains.provide(Guarded, { initialState: {}, methods: { touch: () => "ok" as const } });
	sdk.domains.provide(Clipboard, { initialState: {}, methods: { read: () => "copied" } });
	sdk.domains.provide(Vault, { initialState: {}, methods: { reveal: () => "secret" } });
	return provider;
}

const hostManifest = {
	domains: [
		{ id: "counter", home: "main" },
		{ id: "guarded", home: "main" },
		{ id: "clipboard", home: "main" },
		{ id: "vault", home: "main" },
	],
};

function host(activate: (sdk: PluginSdk) => void = provideCounter) {
	return testPlugin("acme.host", {
		manifest: hostManifest,
		definitions: { domains: [Counter, Guarded, Clipboard, Vault] },
		entry: { activate },
	});
}

function guest(id: string, manifest: Record<string, unknown> = {}) {
	return testPlugin(id, { manifest, entry: { activate: () => {} } });
}

describe("domain registry — in process", () => {
	it("returns null until the domain is provided, then a live handle", async () => {
		const kernel = createKernel({
			process: "main",
			registrations: [host(() => {}), guest("acme.guest")],
		});
		await kernel.activate();
		const guestSdk = kernel.sdkFor("acme.guest");
		const added: string[] = [];
		guestSdk.domains.track(Counter, {
			added: (handle) => void added.push(handle.id),
			removed: () => {},
		});
		expect(guestSdk.domains.get(Counter)).toBeNull();

		provideCounter(kernel.sdkFor("acme.host"));

		expect(guestSdk.domains.get(Counter)?.getState().count).toBe(0);
		expect(added).toEqual(["acme.host/counter"]);
	});

	it("only lets the owner provide, and only once", async () => {
		const kernel = createKernel({ process: "main", registrations: [host(), guest("acme.guest")] });
		await kernel.activate();

		expect(() =>
			kernel.sdkFor("acme.guest").domains.provide(Counter, {
				initialState: { count: 0, items: {} },
				methods: {} as never,
			}),
		).toThrow(/owned by/);
		expect(() => provideCounter(kernel.sdkFor("acme.host"))).toThrow(/already provided/);
	});

	it("exposes state, methods with caller identity, events and lookup", async () => {
		const kernel = createKernel({ process: "main", registrations: [host(), guest("acme.guest")] });
		await kernel.activate();
		const counter = kernel.sdkFor("acme.guest").domains.get(Counter)!;
		const seen: number[] = [];
		const bumps: number[] = [];
		counter.subscribe((state) => void seen.push(state.count));
		counter.on("bumped", ({ count }) => void bumps.push(count));

		await expect(counter.methods.increment({ by: 2 })).resolves.toEqual({ count: 2 });
		await expect(counter.methods.whoami(undefined)).resolves.toBe("acme.guest (main)");

		expect(seen).toEqual([2]);
		expect(bumps).toEqual([2]);
		expect(counter.lookup(ref(Counter, "a"))).toEqual({ name: "Alpha" });
		expect(counter.lookup(ref(Counter, "zzz"))).toBeNull();
	});

	it("keeps notifying other listeners, and the provider's call succeeds, when a listener throws", async () => {
		const kernel = createKernel({
			process: "main",
			registrations: [host(), guest("acme.guest"), guest("acme.other")],
		});
		await kernel.activate();
		const broken = kernel.sdkFor("acme.guest").domains.get(Counter)!;
		const counter = kernel.sdkFor("acme.other").domains.get(Counter)!;
		const bumps: number[] = [];
		const seen: number[] = [];
		broken.on("bumped", () => {
			throw new Error("listener bug");
		});
		broken.subscribe(() => {
			throw new Error("listener bug");
		});
		counter.on("bumped", ({ count }) => void bumps.push(count));
		counter.subscribe((state) => void seen.push(state.count));

		await expect(counter.methods.increment({ by: 2 })).resolves.toEqual({ count: 2 });

		expect(bumps).toEqual([2]);
		expect(seen).toEqual([2]);
	});

	it("validates method input and keeps expected errors while scrubbing unexpected ones", async () => {
		const kernel = createKernel({ process: "main", registrations: [host(), guest("acme.guest")] });
		await kernel.activate();
		const counter = kernel.sdkFor("acme.guest").domains.get(Counter)!;

		await expect(
			counter.methods.increment({ by: "two" } as unknown as { by: number }),
		).rejects.toMatchObject({ code: "VALIDATION" });
		await expect(counter.methods.fail({ expected: true })).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "Nothing here.",
		});
		await expect(counter.methods.fail({ expected: false })).rejects.toMatchObject({
			code: "INTERNAL",
			message: expect.not.stringContaining("secret"),
		});
	});

	it("dispatches to method implementations built as a proxy", async () => {
		const kernel = createKernel({
			process: "main",
			registrations: [
				host((sdk) => {
					sdk.domains.provide(Counter, {
						initialState: { count: 0, items: {} },
						methods: new Proxy({} as Record<string, () => string>, {
							get: (_target, method) => () => `proxied ${String(method)}`,
						}) as never,
					});
				}),
				guest("acme.guest"),
			],
		});
		await kernel.activate();
		const counter = kernel.sdkFor("acme.guest").domains.get(Counter)!;

		await expect(counter.methods.whoami(undefined)).resolves.toBe("proxied whoami");
		await expect(
			(counter.methods as unknown as Record<string, (input: unknown) => Promise<unknown>>)[
				"constructor"
			]!(undefined),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("rejects state that does not match the schema", async () => {
		let provider: ReturnType<typeof provideCounter> | undefined;
		const kernel = createKernel({
			process: "main",
			registrations: [host((sdk) => void (provider = provideCounter(sdk)))],
		});
		await kernel.activate();

		expect(() => provider!.setState({ count: "x" } as never)).toThrow(/state/i);
	});

	it("forgets a subscription's cleanup once the plugin unsubscribes", async () => {
		const kernel = createKernel({ process: "main", registrations: [host()] });
		await kernel.activate();
		const scope = new DisposableScope();
		const sdk = createPluginSdk({
			pluginId: "acme.guest",
			process: "main",
			scope,
			isActive: () => true,
			extensions: kernel.extensions,
			domains: kernel.domains,
			contextKeys: kernel.contextKeys,
			logger: SILENT_LOGGER,
			host: {},
		});
		const counter = sdk.domains.get(Counter)!;
		const before = scope.size;

		for (let index = 0; index < 1000; index += 1) {
			counter.subscribe(() => {})();
			counter.on("bumped", () => {})();
		}

		expect(scope.size).toBe(before);
	});

	it("requires the domain's permission from callers other than the owner", async () => {
		const kernel = createKernel({
			process: "main",
			registrations: [
				host(),
				guest("acme.plain"),
				guest("acme.trusted", { permissions: { host: ["windows"] } }),
			],
		});
		await kernel.activate();

		await expect(
			kernel.sdkFor("acme.plain").domains.get(Guarded)!.methods.touch(undefined),
		).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
		await expect(
			kernel.sdkFor("acme.trusted").domains.get(Guarded)!.methods.touch(undefined),
		).resolves.toBe("ok");
	});
});

describe("domain registry — across processes", () => {
	const DOMAIN_CALL = "kernel:domain-call";

	async function bootPair() {
		const transports = createLinkedTransports();
		const main = createKernel({
			process: "main",
			transport: transports.main,
			registrations: [host(), guest("acme.guest"), guest("acme.plain"), guest("acme.daemon")],
			webPlugins: ["acme.host", "acme.guest", "acme.plain"],
		});
		await main.activate();
		const window = transports.connectRenderer("w1");
		const renderer = createKernel({
			process: "renderer",
			windowId: "w1",
			transport: window,
			registrations: [host(() => {}), guest("acme.guest"), guest("acme.plain")],
		});
		await renderer.activate();
		const forge = (payload: unknown) => window.request(DOMAIN_CALL, payload);
		return { main, renderer, forge };
	}

	it("mirrors state and events from the home process into the renderer", async () => {
		const { main, renderer } = await bootPair();
		const counter = renderer.sdkFor("acme.guest").domains.get(Counter)!;
		expect(counter.getState().count).toBe(0);
		const bumps: number[] = [];
		const states: number[] = [];
		counter.on("bumped", ({ count }) => void bumps.push(count));
		counter.subscribe((state) => void states.push(state.count));

		await main.sdkFor("acme.guest").domains.get(Counter)!.methods.increment({ by: 3 });
		await renderer.flush();

		expect(states).toEqual([3]);
		expect(bumps).toEqual([3]);
	});

	it("still reaches windows, and every window listener, when a listener throws", async () => {
		const { main, renderer } = await bootPair();
		const throwing = () => {
			throw new Error("listener bug");
		};
		main.sdkFor("acme.guest").domains.get(Counter)!.on("bumped", throwing);
		const inWindow = renderer.sdkFor("acme.guest").domains.get(Counter)!;
		const bumps: number[] = [];
		const states: number[] = [];
		inWindow.on("bumped", throwing);
		inWindow.subscribe(throwing);
		inWindow.on("bumped", ({ count }) => void bumps.push(count));
		inWindow.subscribe((state) => void states.push(state.count));

		await main.sdkFor("acme.plain").domains.get(Counter)!.methods.increment({ by: 4 });
		await renderer.flush();

		expect(states).toEqual([4]);
		expect(bumps).toEqual([4]);
	});

	it("forwards method calls to the home process with the caller's identity and permissions", async () => {
		const { renderer } = await bootPair();

		await expect(
			renderer.sdkFor("acme.guest").domains.get(Counter)!.methods.whoami(undefined),
		).resolves.toBe("acme.guest (renderer)");
		await expect(
			renderer.sdkFor("acme.plain").domains.get(Guarded)!.methods.touch(undefined),
		).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
	});

	it("withdraws the proxy when the provider deactivates", async () => {
		const { main, renderer } = await bootPair();
		const removed: string[] = [];
		renderer
			.sdkFor("acme.guest")
			.domains.track(Counter, { added: () => {}, removed: () => void removed.push("gone") });

		await main.deactivate();
		await renderer.flush();

		expect(renderer.sdkFor("acme.guest").domains.get(Counter)).toBeNull();
		expect(removed).toEqual(["gone"]);
	});

	it("tells a method the caller called from a window", async () => {
		const { renderer } = await bootPair();

		await expect(renderer.kernelSdk.domains.get(Counter)!.methods.whoami(undefined)).resolves.toBe(
			"kernel (renderer)",
		);
	});

	it("gives the kernel in a window only the permissions its own screens need", async () => {
		const { renderer, forge } = await bootPair();

		await expect(renderer.kernelSdk.domains.get(Guarded)!.methods.touch(undefined)).resolves.toBe(
			"ok",
		);
		await expect(
			renderer.kernelSdk.domains.get(Clipboard)!.methods.read(undefined),
		).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
		await expect(
			forge({ domainId: Clipboard.id, method: "read", input: undefined, caller: "kernel" }),
		).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
	});

	it("refuses window callers claiming a plugin with no web entry, or no plugin at all", async () => {
		const { forge } = await bootPair();
		const call = (caller: string) =>
			forge({ domainId: Counter.id, method: "whoami", input: undefined, caller });

		await expect(call("acme.daemon")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
		await expect(call("acme.nobody")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
		await expect(call("acme.plain")).resolves.toBe("acme.plain (renderer)");
	});

	it("keeps home-only methods out of windows, even for the owner", async () => {
		const { main, renderer, forge } = await bootPair();

		await expect(
			main.sdkFor("acme.guest").domains.get(Vault)!.methods.reveal(undefined),
		).resolves.toBe("secret");
		await expect(
			renderer.sdkFor("acme.guest").domains.get(Vault)!.methods.reveal(undefined),
		).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
		await expect(
			forge({ domainId: Vault.id, method: "reveal", input: undefined, caller: "acme.host" }),
		).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
		await expect(
			forge({ domainId: Vault.id, method: "reveal", input: undefined, caller: "kernel" }),
		).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
	});

	it("rejects malformed calls and methods that are not the domain's own", async () => {
		const { forge } = await bootPair();

		await expect(forge({ domainId: Counter.id, method: "whoami" })).rejects.toMatchObject({
			code: "VALIDATION",
		});
		await expect(forge("not a call")).rejects.toMatchObject({ code: "VALIDATION" });
		await expect(
			forge({
				domainId: Counter.id,
				method: "constructor",
				input: undefined,
				caller: "acme.guest",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			forge({ domainId: Counter.id, method: "toString", input: undefined, caller: "acme.guest" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});
