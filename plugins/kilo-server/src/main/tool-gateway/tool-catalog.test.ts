import { afterEach, describe, expect, it, vi } from "vitest";

import { descriptor, FakeToolProducer } from "../../test/fake-tool-producer.js";
import { ToolCatalog } from "./tool-catalog.js";

const catalogs: ToolCatalog[] = [];

function createCatalog(options: ConstructorParameters<typeof ToolCatalog>[0] = {}): ToolCatalog {
	const catalog = new ToolCatalog(options);
	catalogs.push(catalog);
	return catalog;
}

function connect(catalog: ToolCatalog): FakeToolProducer {
	const producer = new FakeToolProducer();
	catalog.attach(producer.port);
	return producer;
}

afterEach(() => {
	for (const catalog of catalogs.splice(0)) catalog.dispose();
	vi.useRealTimers();
});

describe("ToolCatalog snapshots", () => {
	it("lists the tools the producer publishes", () => {
		const catalog = createCatalog();
		const producer = connect(catalog);

		producer.publish([descriptor("todos_list"), descriptor("todos_add")]);

		expect(catalog.tools.map((tool) => tool.name)).toEqual(["todos_list", "todos_add"]);
	});

	it("replaces the previous snapshot and notifies subscribers once per change", () => {
		const catalog = createCatalog();
		const producer = connect(catalog);
		const listener = vi.fn();
		catalog.subscribe(listener);

		producer.publish([descriptor("todos_list")]);
		producer.publish([descriptor("todos_add")]);

		expect(catalog.tools.map((tool) => tool.name)).toEqual(["todos_add"]);
		expect(listener).toHaveBeenCalledTimes(2);
	});

	it("does not notify when a snapshot is identical to the current one", () => {
		const catalog = createCatalog();
		const producer = connect(catalog);
		producer.publish([descriptor("todos_list")]);
		const listener = vi.fn();
		catalog.subscribe(listener);
		const version = catalog.version;

		producer.publish([descriptor("todos_list")]);

		expect(listener).not.toHaveBeenCalled();
		expect(catalog.version).toBe(version);
	});

	it("keeps the first tool when two share a name instead of renaming either", () => {
		const catalog = createCatalog();
		const producer = connect(catalog);

		producer.publish([
			descriptor("environments_conda_packages_install", { description: "genuine" }),
			descriptor("environments_conda_packages_install", { description: "duplicate" }),
		]);

		expect(catalog.tools).toEqual([
			descriptor("environments_conda_packages_install", { description: "genuine" }),
		]);
	});

	it("drops invalid descriptors and keeps the valid ones", () => {
		const catalog = createCatalog();
		const producer = connect(catalog);

		producer.publish([
			descriptor("todos_list"),
			{ name: "bad.name", description: "", inputSchema: { type: "object" } },
			{ name: "no_schema", description: "" },
		]);

		expect(catalog.tools.map((tool) => tool.name)).toEqual(["todos_list"]);
	});

	it("ignores malformed messages and stale revisions", () => {
		const catalog = createCatalog();
		const producer = connect(catalog);
		producer.publish([descriptor("todos_add")], 5);

		producer.send({ type: "catalog", tools: "nope" });
		producer.send("garbage");
		producer.publish([descriptor("todos_list")], 4);

		expect(catalog.tools.map((tool) => tool.name)).toEqual(["todos_add"]);
	});
});

describe("ToolCatalog calls", () => {
	it("routes a call to the producer and resolves with its result", async () => {
		const catalog = createCatalog();
		const producer = connect(catalog);
		producer.publish([descriptor("todos_echo")]);
		producer.respond = (call) => ({ echoed: call.args.text, context: call.context });

		await expect(
			catalog.invoke("todos_echo", { text: "hi" }, { kiloSessionId: "s1", kiloCallId: "k1" }),
		).resolves.toEqual({ echoed: "hi", context: { kiloSessionId: "s1", kiloCallId: "k1" } });
		expect(catalog.pendingCount).toBe(0);
	});

	it("rejects with the producer's error message", async () => {
		const catalog = createCatalog();
		const producer = connect(catalog);
		producer.publish([descriptor("todos_echo")]);
		producer.respond = () => {
			throw new Error("Invalid input");
		};

		await expect(catalog.invoke("todos_echo", {}, {})).rejects.toThrow("Invalid input");
		expect(catalog.pendingCount).toBe(0);
	});

	it("rejects unknown tools without contacting the producer", async () => {
		const catalog = createCatalog();
		const producer = connect(catalog);
		producer.publish([descriptor("todos_echo")]);

		await expect(catalog.invoke("todos_missing", {}, {})).rejects.toThrow(/Unknown tool/);
		expect(producer.calls()).toEqual([]);
	});

	it("rejects calls when no producer is connected", async () => {
		const catalog = createCatalog();

		await expect(catalog.invoke("todos_echo", {}, {})).rejects.toThrow(/not connected/);
	});

	it("cancels a pending call, tells the producer, and ignores its late result", async () => {
		const catalog = createCatalog();
		const producer = connect(catalog);
		producer.publish([descriptor("todos_echo")]);
		const controller = new AbortController();

		const call = catalog.invoke("todos_echo", {}, {}, controller.signal);
		const [sent] = producer.calls();
		controller.abort();

		await expect(call).rejects.toThrow(/cancelled/);
		expect(producer.sent.at(-1)).toEqual({ type: "cancel", id: sent!.id });
		expect(catalog.pendingCount).toBe(0);
		expect(() => producer.resolve(sent!.id, "late")).not.toThrow();
	});

	it("rejects a call whose signal is already aborted", async () => {
		const catalog = createCatalog();
		const producer = connect(catalog);
		producer.publish([descriptor("todos_echo")]);

		await expect(catalog.invoke("todos_echo", {}, {}, AbortSignal.abort())).rejects.toThrow(
			/cancelled/,
		);
		expect(producer.calls()).toEqual([]);
	});

	it("fails pending calls with an unknown-outcome error when the producer disconnects", async () => {
		const catalog = createCatalog();
		const producer = connect(catalog);
		producer.publish([descriptor("environments_conda_packages_install")]);

		const call = catalog.invoke("environments_conda_packages_install", {}, {});
		producer.disconnect();

		await expect(call).rejects.toThrow(/outcome is unknown/);
		expect(catalog.pendingCount).toBe(0);
	});

	it("fails only the replaced producer's pending calls when a new producer attaches", async () => {
		const catalog = createCatalog();
		const first = connect(catalog);
		first.publish([descriptor("todos_echo")]);
		const call = catalog.invoke("todos_echo", {}, {});

		const second = connect(catalog);
		second.publish([descriptor("todos_echo")]);
		second.respond = () => "from second";

		await expect(call).rejects.toThrow(/outcome is unknown/);
		expect(first.closedByMain).toBe(true);
		await expect(catalog.invoke("todos_echo", {}, {})).resolves.toBe("from second");
	});
});

describe("ToolCatalog reload grace", () => {
	it("keeps the last tools briefly after a disconnect, then clears them", () => {
		vi.useFakeTimers();
		const catalog = createCatalog({ reloadGraceMs: 1000 });
		const producer = connect(catalog);
		producer.publish([descriptor("todos_echo")]);
		const listener = vi.fn();
		catalog.subscribe(listener);

		producer.disconnect();
		expect(catalog.tools.map((tool) => tool.name)).toEqual(["todos_echo"]);
		vi.advanceTimersByTime(1000);

		expect(catalog.tools).toEqual([]);
		expect(listener).toHaveBeenCalledOnce();
	});

	it("does not announce a change when the reloaded window publishes the same tools", () => {
		vi.useFakeTimers();
		const catalog = createCatalog({ reloadGraceMs: 1000 });
		const original = connect(catalog);
		original.publish([descriptor("todos_echo")]);
		const listener = vi.fn();
		catalog.subscribe(listener);

		original.disconnect();
		vi.advanceTimersByTime(500);
		connect(catalog).publish([descriptor("todos_echo")]);
		vi.advanceTimersByTime(5000);

		expect(listener).not.toHaveBeenCalled();
		expect(catalog.tools.map((tool) => tool.name)).toEqual(["todos_echo"]);
	});

	it("fails calls fast during the grace period", async () => {
		vi.useFakeTimers();
		const catalog = createCatalog({ reloadGraceMs: 1000 });
		const producer = connect(catalog);
		producer.publish([descriptor("todos_echo")]);
		producer.disconnect();

		await expect(catalog.invoke("todos_echo", {}, {})).rejects.toThrow(/not connected/);
	});
});
