import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
	defineDecisionExtensionPoint,
	defineExtensionPoint,
	implementation,
	type DecisionAnswer,
} from "./extension-point";
import { createKernel } from "./kernel";
import { testPlugin } from "./test-fixtures";

const Panel = defineExtensionPoint({
	id: "acme.host/panel",
	kind: "additive",
	metadata: z.object({ title: z.string() }),
});

const Widget = defineExtensionPoint({
	id: "acme.host/widget",
	kind: "additive",
	metadata: z.object({ label: z.string() }),
	implementation: implementation<() => string>("main"),
});

const RendererWidget = defineExtensionPoint({
	id: "acme.host/renderer-widget",
	kind: "additive",
	implementation: implementation<() => string>("renderer"),
});

const Root = defineExtensionPoint({
	id: "acme.host/root",
	kind: "exclusive",
	implementation: implementation<() => string>("main"),
});

const Quit = defineDecisionExtensionPoint({
	id: "acme.host/quit",
	process: "main",
	input: z.object({ reason: z.string() }),
	failMode: "open",
	timeoutMs: 50,
});

const Approve = defineDecisionExtensionPoint({
	id: "acme.host/approve",
	process: "main",
	input: z.object({}),
	failMode: "closed",
	timeoutMs: 50,
});

const ALL_POINTS = [Panel, Widget, RendererWidget, Root, Quit, Approve];

function host(extra: Record<string, unknown> = {}) {
	return testPlugin("acme.host", {
		manifest: {
			extensionPoints: [
				{ id: "panel", kind: "additive" },
				{ id: "widget", kind: "additive" },
				{ id: "renderer-widget", kind: "additive" },
				{ id: "root", kind: "exclusive" },
				{ id: "quit", kind: "decision" },
				{ id: "approve", kind: "decision" },
			],
			contextKeys: [{ id: "ready" }],
			...extra,
		},
		definitions: { extensionPoints: ALL_POINTS },
		entry: { activate: () => {} },
	});
}

function guest(id: string, extensions: Record<string, unknown[]>, activate = () => {}) {
	return testPlugin(id, {
		manifest: { contributes: { extensions } },
		entry: { activate },
	});
}

async function boot(...registrations: ReturnType<typeof testPlugin>[]) {
	const kernel = createKernel({ process: "main", registrations: [host(), ...registrations] });
	await kernel.activate();
	return kernel;
}

afterEach(() => {
	vi.useRealTimers();
});

describe("extension registry — points of plugins that aren't installed", () => {
	it("ignores implementing or adding to them, so optional integrations stay optional", async () => {
		const kernel = createKernel({
			process: "main",
			registrations: [
				guest("acme.guest", { "acme.host/widget": [{ id: "w", label: "W" }] }, () => {
					const sdk = kernel.sdkFor("acme.guest");
					sdk.extensions.implement(Widget, "w", () => "widget");
					sdk.extensions.add(Widget, { id: "later", label: "Later" }, () => "later");
				}),
			],
		});

		await kernel.activate();

		expect(kernel.issues().filter((issue) => issue.severity === "error")).toEqual([]);
	});

	it("reads them as having no contributions, so a host of an absent plugin's point renders nothing", async () => {
		const kernel = createKernel({ process: "main", registrations: [guest("acme.guest", {})] });
		await kernel.activate();

		expect(kernel.extensions.list(Widget)).toEqual([]);
		expect(kernel.extensions.all(Widget)).toEqual([]);
		expect(kernel.extensions.exclusive(Root)).toEqual({ chain: [] });
	});

	it("still refuses an unknown point of an installed plugin", async () => {
		const Missing = defineExtensionPoint({
			id: "acme.host/missing",
			kind: "additive",
			implementation: implementation<() => string>("main"),
		});
		const kernel = await boot();

		expect(() =>
			kernel.sdkFor("acme.host").extensions.add(Missing, { id: "m" }, () => "m"),
		).toThrow(/Unknown extension point/);
		expect(() => kernel.extensions.list(Missing)).toThrow(/Unknown extension point/);
	});
});

describe("extension registry — additive points", () => {
	it("lists manifest contributions by priority, then plugin order", async () => {
		const kernel = await boot(
			guest("acme.a", { "acme.host/panel": [{ id: "low", title: "Low" }] }),
			guest("acme.b", {
				"acme.host/panel": [
					{ id: "high", title: "High", priority: 10 },
					{ id: "low", title: "Also low" },
				],
			}),
		);

		const listed = kernel.sdkFor("acme.host").extensions.list(Panel);

		expect(listed.map((contribution) => contribution.key)).toEqual([
			"acme.b/high",
			"acme.a/low",
			"acme.b/low",
		]);
		expect(listed[0]?.metadata).toEqual({ title: "High" });
	});

	it("keeps contributions that require an implementation inactive until one is bound", async () => {
		const kernel = await boot(
			guest("acme.g", { "acme.host/widget": [{ id: "w", label: "W" }] }, () => {}),
		);
		const guestSdk = kernel.sdkFor("acme.g");
		const hostSdk = kernel.sdkFor("acme.host");
		expect(hostSdk.extensions.list(Widget)).toEqual([]);

		const unbind = guestSdk.extensions.implement(Widget, "w", () => "hello");

		expect(hostSdk.extensions.list(Widget).map((c) => c.implementation?.())).toEqual(["hello"]);
		unbind();
		expect(hostSdk.extensions.list(Widget)).toEqual([]);
	});

	it("refuses to implement an unknown contribution or in the wrong process", async () => {
		const kernel = await boot(guest("acme.g", { "acme.host/renderer-widget": [{ id: "r" }] }));
		const sdk = kernel.sdkFor("acme.g");

		expect(() => sdk.extensions.implement(Widget, "nope", () => "x")).toThrow(/no contribution/i);
		expect(() => sdk.extensions.implement(RendererWidget, "r", () => "x")).toThrow(/renderer/);
	});

	it("validates runtime contributions and supports update and remove", async () => {
		const kernel = await boot(guest("acme.g", {}));
		const sdk = kernel.sdkFor("acme.g");
		const changes: string[] = [];
		kernel.sdkFor("acme.host").extensions.subscribe(Panel, () => void changes.push("changed"));

		expect(() => sdk.extensions.add(Panel, { id: "bad", title: 1 as unknown as string })).toThrow(
			/title/,
		);

		const handle = sdk.extensions.add(Panel, { id: "dyn", title: "First" });
		handle.update({ title: "Second" });
		expect(sdk.extensions.list(Panel).map((c) => c.metadata.title)).toEqual(["Second"]);

		handle.remove();
		expect(sdk.extensions.list(Panel)).toEqual([]);
		expect(changes).toEqual(["changed", "changed", "changed"]);
	});

	it("hides contributions whose when condition is false", async () => {
		const kernel = await boot(
			guest("acme.g", {
				"acme.host/panel": [{ id: "gated", title: "Gated", when: { all: ["acme.host/ready"] } }],
			}),
		);
		const hostSdk = kernel.sdkFor("acme.host");
		expect(hostSdk.extensions.list(Panel)).toEqual([]);

		hostSdk.context.set("ready", true);

		expect(hostSdk.extensions.list(Panel).map((c) => c.id)).toEqual(["gated"]);
	});

	it("only lets the owner set a context key", async () => {
		const kernel = await boot(guest("acme.g", {}));

		expect(() => kernel.sdkFor("acme.g").context.set("ready", true)).toThrow(/not declared/);
	});
});

describe("extension registry — change notifications", () => {
	function recordChanges(kernel: Awaited<ReturnType<typeof boot>>) {
		const changed: string[] = [];
		kernel.extensions.subscribe((pointId) => void changed.push(pointId));
		return changed;
	}

	it("notifies only points whose contributions read a context key that changed", async () => {
		const kernel = await boot(
			guest("acme.g", {
				"acme.host/panel": [{ id: "gated", title: "Gated", when: { none: ["acme.host/ready"] } }],
				"acme.host/widget": [{ id: "plain", label: "Plain" }],
			}),
		);
		const changed = recordChanges(kernel);

		kernel.sdkFor("acme.host").context.set("ready", true);

		expect(changed).toEqual([Panel.id]);
		expect(kernel.extensions.list(Panel)).toEqual([]);
	});

	it("notifies only points whose implementations in another process changed", async () => {
		const kernel = await boot(
			guest("acme.g", {
				"acme.host/panel": [{ id: "a", title: "A" }],
				"acme.host/widget": [
					{ id: "b", label: "B" },
					{ id: "c", label: "C" },
				],
			}),
		);
		kernel.extensions.setRemoteImplementations("window:w1", {
			[Panel.id]: ["acme.g/a"],
			[Widget.id]: ["acme.g/b"],
		});
		const changed = recordChanges(kernel);

		kernel.extensions.setRemoteImplementations("window:w1", {
			[Panel.id]: ["acme.g/a"],
			[Widget.id]: ["acme.g/c", "acme.g/b"],
		});
		kernel.extensions.setRemoteImplementations("window:w1", {
			[Widget.id]: ["acme.g/b", "acme.g/c"],
			[Panel.id]: ["acme.g/a"],
		});
		kernel.extensions.setRemoteImplementations("window:w1", {
			[Widget.id]: ["acme.g/b", "acme.g/c"],
		});

		expect(changed).toEqual([Widget.id, Panel.id]);
		expect(kernel.extensions.list(Widget).map((c) => c.id)).toEqual(["b", "c"]);
	});
});

describe("extension registry — exclusive points", () => {
	async function bootRoots() {
		const kernel = await boot(
			guest("acme.a", { "acme.host/root": [{ id: "a" }] }),
			guest("acme.b", { "acme.host/root": [{ id: "b", priority: 5 }] }),
		);
		kernel.sdkFor("acme.a").extensions.implement(Root, "a", () => "A");
		kernel.sdkFor("acme.b").extensions.implement(Root, "b", () => "B");
		return kernel;
	}

	it("picks the highest-priority contribution and exposes the rest as the fallback chain", async () => {
		const kernel = await bootRoots();

		const resolution = kernel.sdkFor("acme.host").extensions.exclusive(Root);

		expect(resolution.winner?.key).toBe("acme.b/b");
		expect(resolution.chain.map((c) => c.key)).toEqual(["acme.b/b", "acme.a/a"]);
	});

	it("honours a user pin", async () => {
		const kernel = await bootRoots();

		kernel.extensions.pin(Root.id, "acme.a/a");

		expect(kernel.sdkFor("acme.host").extensions.exclusive(Root).winner?.key).toBe("acme.a/a");
	});

	it("falls back to the next candidate when the winner fails", async () => {
		const kernel = await bootRoots();
		const hostSdk = kernel.sdkFor("acme.host");

		kernel.extensions.reportFailure(Root.id, "acme.b/b", new Error("crashed"));

		expect(hostSdk.extensions.exclusive(Root).winner?.key).toBe("acme.a/a");
	});
});

describe("extension registry — decision points", () => {
	function decider(id: string, point: typeof Quit | typeof Approve) {
		return guest(id, { [point.id]: [{ id: "check" }] }, () => {});
	}

	async function bootDeciders(
		answers: Record<string, () => DecisionAnswer | Promise<DecisionAnswer>>,
		point: typeof Quit | typeof Approve = Quit,
	) {
		const kernel = await boot(...Object.keys(answers).map((id) => decider(id, point)));
		for (const [id, answer] of Object.entries(answers)) {
			kernel.sdkFor(id).extensions.implement(point as typeof Quit, "check", answer);
		}
		return kernel;
	}

	it("proceeds when every handler proceeds", async () => {
		const kernel = await bootDeciders({ "acme.a": () => "proceed", "acme.b": () => "proceed" });

		await expect(
			kernel.sdkFor("acme.host").extensions.decide(Quit, { reason: "user" }),
		).resolves.toEqual({ outcome: "proceed" });
	});

	it("merges ask answers into one prompt", async () => {
		const kernel = await bootDeciders({
			"acme.a": () => ({ ask: "Unsaved notebook." }),
			"acme.b": () => ({ ask: "Terminal still running." }),
		});

		await expect(
			kernel.sdkFor("acme.host").extensions.decide(Quit, { reason: "user" }),
		).resolves.toEqual({
			outcome: "ask",
			reasons: ["Unsaved notebook.", "Terminal still running."],
		});
	});

	it("stops at the first rejection", async () => {
		const second = vi.fn(() => "proceed" as const);
		const kernel = await bootDeciders({
			"acme.a": () => ({ reject: "Update installing." }),
			"acme.b": second,
		});

		await expect(
			kernel.sdkFor("acme.host").extensions.decide(Quit, { reason: "user" }),
		).resolves.toEqual({ outcome: "reject", reason: "Update installing." });
		expect(second).not.toHaveBeenCalled();
	});

	it("treats a failing or slow handler as proceed when the point fails open", async () => {
		vi.useFakeTimers();
		const kernel = await bootDeciders({
			"acme.a": () => {
				throw new Error("boom");
			},
			"acme.b": () => new Promise<DecisionAnswer>(() => {}),
		});

		const decision = kernel.sdkFor("acme.host").extensions.decide(Quit, { reason: "user" });
		await vi.advanceTimersByTimeAsync(50);

		await expect(decision).resolves.toEqual({ outcome: "proceed" });
	});

	it("treats a failing handler as a rejection when the point fails closed", async () => {
		const kernel = await bootDeciders(
			{
				"acme.a": () => {
					throw new Error("boom");
				},
			},
			Approve,
		);

		await expect(kernel.sdkFor("acme.host").extensions.decide(Approve, {})).resolves.toEqual({
			outcome: "reject",
			reason: expect.stringContaining("acme.a"),
		});
	});

	it("only lets the point's owner run a decision", async () => {
		const kernel = await boot(guest("acme.g", {}));

		await expect(kernel.sdkFor("acme.g").extensions.decide(Quit, { reason: "x" })).rejects.toThrow(
			/owner/,
		);
	});
});
