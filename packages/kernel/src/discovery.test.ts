import { describe, expect, it } from "vitest";
import { z } from "zod";

import { discoverPlugins } from "./discovery";
import { defineDomainObject } from "./domain-object";
import { defineExtensionPoint } from "./extension-point";
import { defineObjectType } from "./object-type";
import type { PluginRegistration } from "./plugin";

function manifest(id: string, extra: Record<string, unknown> = {}) {
	return { manifestVersion: 1, id, displayName: id, version: "1.0.0", ...extra };
}

const Panel = defineExtensionPoint({
	id: "acme.host/panel",
	kind: "additive",
	metadata: z.object({ title: z.string() }),
});

const Store = defineDomainObject({ id: "acme.host/store", home: "main", state: z.object({}) });

const host: PluginRegistration = {
	manifest: manifest("acme.host", {
		extensionPoints: [{ id: "panel", kind: "additive" }],
		domainObjects: [{ id: "store", home: "main" }],
	}),
	definitions: { extensionPoints: [Panel], domainObjects: [Store] },
};

function contributor(id: string, extensions: Record<string, unknown[]>, extra = {}) {
	return { manifest: manifest(id, { contributes: { extensions }, ...extra }) };
}

describe("discoverPlugins", () => {
	it("resolves valid plugins and exposes their extension points, domain objects and contributions", () => {
		const result = discoverPlugins([
			host,
			contributor("acme.guest", { "acme.host/panel": [{ id: "one", title: "One" }] }),
		]);

		expect(result.issues).toEqual([]);
		expect(result.plugins.map((plugin) => [plugin.manifest.id, plugin.status])).toEqual([
			["acme.host", "resolved"],
			["acme.guest", "resolved"],
		]);
		expect(result.extensionPoints.get("acme.host/panel")?.owner).toBe("acme.host");
		expect(result.domainObjects.get("acme.host/store")?.owner).toBe("acme.host");
		expect(result.contributions).toEqual([
			{
				pointId: "acme.host/panel",
				pluginId: "acme.guest",
				entry: { id: "one", priority: 0, metadata: { title: "One" } },
			},
		]);
	});

	it("skips manifests that fail validation", () => {
		const result = discoverPlugins([{ manifest: { id: "NotDotted", version: "x" } }]);

		expect(result.plugins).toEqual([]);
		expect(result.issues).toEqual([
			expect.objectContaining({ severity: "error", code: "invalid-manifest" }),
		]);
	});

	it("rejects a second plugin with the same id", () => {
		const result = discoverPlugins([host, host]);

		expect(result.plugins).toHaveLength(1);
		expect(result.issues).toEqual([
			expect.objectContaining({ pluginId: "acme.host", code: "duplicate-plugin" }),
		]);
	});

	it("reserves the kilo publisher for bundled plugins", () => {
		const result = discoverPlugins([{ manifest: manifest("kilo.fake"), source: "external" }]);

		expect(result.plugins).toEqual([]);
		expect(result.issues).toEqual([
			expect.objectContaining({ pluginId: "kilo.fake", code: "reserved-publisher" }),
		]);
	});

	it("reports extension points declared without a definition and definitions without a declaration", () => {
		const result = discoverPlugins([
			{
				manifest: manifest("acme.host", { extensionPoints: [{ id: "panel", kind: "additive" }] }),
			},
			{ manifest: manifest("acme.other"), definitions: { extensionPoints: [Panel] } },
		]);

		expect(result.extensionPoints.size).toBe(0);
		expect(result.issues.map((issue) => [issue.pluginId, issue.code])).toEqual([
			["acme.host", "undefined-extension-point"],
			["acme.other", "foreign-definition"],
		]);
	});

	it("reports a declared kind that differs from the definition", () => {
		const result = discoverPlugins([
			{
				manifest: manifest("acme.host", { extensionPoints: [{ id: "panel", kind: "exclusive" }] }),
				definitions: { extensionPoints: [Panel] },
			},
		]);

		expect(result.extensionPoints.size).toBe(0);
		expect(result.issues).toEqual([
			expect.objectContaining({ pluginId: "acme.host", code: "kind-mismatch" }),
		]);
	});

	it("drops contributions to unknown points and with invalid metadata", () => {
		const result = discoverPlugins([
			host,
			contributor("acme.guest", {
				"acme.host/missing": [{ id: "a" }],
				"acme.host/panel": [
					{ id: "b", title: 42 },
					{ id: "c", title: "C" },
				],
			}),
		]);

		expect(result.contributions.map((contribution) => contribution.entry.id)).toEqual(["c"]);
		expect(result.issues.map((issue) => issue.code)).toEqual([
			"unknown-extension-point",
			"invalid-contribution",
		]);
		expect(result.issues[0]?.severity).toBe("error");
	});

	it("only warns about contributions to points of plugins that are not installed", () => {
		const result = discoverPlugins([
			contributor("acme.guest", { "acme.optional/panel": [{ id: "a" }] }),
		]);

		expect(result.contributions).toEqual([]);
		expect(result.issues).toEqual([
			expect.objectContaining({
				severity: "warning",
				code: "absent-extension-point-owner",
				pluginId: "acme.guest",
			}),
		]);
	});

	it("rejects duplicate contribution ids from one plugin to one point", () => {
		const result = discoverPlugins([
			host,
			contributor("acme.guest", {
				"acme.host/panel": [
					{ id: "same", title: "A" },
					{ id: "same", title: "B" },
				],
			}),
		]);

		expect(result.contributions).toHaveLength(1);
		expect(result.issues).toEqual([
			expect.objectContaining({ pluginId: "acme.guest", code: "duplicate-contribution" }),
		]);
	});

	it("orders plugins after the owners of what they require", () => {
		const result = discoverPlugins([
			{ manifest: manifest("acme.guest", { requires: { "acme.host/store": "required" } }) },
			host,
		]);

		expect(result.plugins.map((plugin) => plugin.manifest.id)).toEqual(["acme.host", "acme.guest"]);
	});

	it("marks a plugin unresolved when a required item is missing, but not an optional one", () => {
		const result = discoverPlugins([
			{ manifest: manifest("acme.needy", { requires: { "acme.gone/thing": "required" } }) },
			{ manifest: manifest("acme.relaxed", { requires: { "acme.gone/thing": "optional" } }) },
		]);

		expect(result.plugins.map((plugin) => [plugin.manifest.id, plugin.status])).toEqual([
			["acme.needy", "unresolved"],
			["acme.relaxed", "resolved"],
		]);
		expect(result.plugins[0]?.unresolvedReasons).toEqual([
			'Requires "acme.gone/thing", which is not available.',
		]);
	});

	it("propagates unresolved status to plugins that require an unresolved plugin's items", () => {
		const result = discoverPlugins([
			{
				...host,
				manifest: manifest("acme.host", {
					extensionPoints: [{ id: "panel", kind: "additive" }],
					domainObjects: [{ id: "store", home: "main" }],
					requires: { "acme.gone/thing": "required" },
				}),
			},
			{ manifest: manifest("acme.guest", { requires: { "acme.host/store": "required" } }) },
		]);

		expect(result.plugins.map((plugin) => plugin.status)).toEqual(["unresolved", "unresolved"]);
	});

	it("marks plugins in a requires cycle unresolved", () => {
		const a = {
			manifest: manifest("acme.a", {
				domainObjects: [{ id: "x", home: "main" }],
				requires: { "acme.b/y": "required" },
			}),
			definitions: {
				domainObjects: [defineDomainObject({ id: "acme.a/x", home: "main", state: z.object({}) })],
			},
		};
		const b = {
			manifest: manifest("acme.b", {
				domainObjects: [{ id: "y", home: "main" }],
				requires: { "acme.a/x": "required" },
			}),
			definitions: {
				domainObjects: [defineDomainObject({ id: "acme.b/y", home: "main", state: z.object({}) })],
			},
		};

		const result = discoverPlugins([a, b]);

		expect(result.plugins.map((plugin) => plugin.status)).toEqual(["unresolved", "unresolved"]);
		expect(result.issues).toContainEqual(expect.objectContaining({ code: "requires-cycle" }));
	});

	it("warns about when conditions that use undeclared context keys", () => {
		const result = discoverPlugins([
			host,
			contributor(
				"acme.guest",
				{
					"acme.host/panel": [
						{ id: "a", title: "A", when: { all: ["acme.guest/ready", "acme.nobody/thing"] } },
					],
				},
				{ contextKeys: [{ id: "ready" }] },
			),
		]);

		expect(result.contributions).toHaveLength(1);
		expect(result.issues).toEqual([
			expect.objectContaining({ severity: "warning", code: "unknown-context-key" }),
		]);
	});

	it("accepts contributions to kernel-owned points", () => {
		const Root = defineExtensionPoint({ id: "kernel/root", kind: "exclusive" });

		const result = discoverPlugins([contributor("acme.ui", { "kernel/root": [{ id: "frame" }] })], {
			kernelDefinitions: { extensionPoints: [Root] },
		});

		expect(result.issues).toEqual([]);
		expect(result.extensionPoints.get("kernel/root")?.owner).toBe("kernel");
		expect(result.contributions).toHaveLength(1);
	});

	describe("object types", () => {
		const Item = defineObjectType({ id: "acme.host/item" });
		const Items = defineDomainObject({
			id: "acme.host/items",
			home: "main",
			state: z.object({}),
			lookup: () => null,
			objectType: Item,
		});

		it("registers declared object types and the collection that resolves each", () => {
			const result = discoverPlugins([
				{
					manifest: manifest("acme.host", {
						objectTypes: [{ id: "item" }],
						domainObjects: [{ id: "items", home: "main", objectType: "acme.host/item" }],
					}),
					definitions: { objectTypes: [Item], domainObjects: [Items] },
				},
			]);

			expect(result.issues).toEqual([]);
			expect(result.objectTypes.get("acme.host/item")).toEqual({
				owner: "acme.host",
				definition: Item,
				collection: "acme.host/items",
			});
		});

		it("reports object types declared without a definition, and foreign or undeclared definitions", () => {
			const result = discoverPlugins([
				{ manifest: manifest("acme.host", { objectTypes: [{ id: "item" }] }) },
				{ manifest: manifest("acme.other"), definitions: { objectTypes: [Item] } },
				{
					manifest: manifest("acme.third"),
					definitions: { objectTypes: [defineObjectType({ id: "acme.third/thing" })] },
				},
			]);

			expect(result.objectTypes.size).toBe(0);
			expect(result.issues.map((issue) => [issue.pluginId, issue.code])).toEqual([
				["acme.host", "undefined-object-type"],
				["acme.other", "foreign-definition"],
				["acme.third", "undeclared-object-type"],
			]);
		});

		it("requires a collection's object type to match its manifest and be its plugin's", () => {
			const result = discoverPlugins([
				{
					manifest: manifest("acme.host", {
						objectTypes: [{ id: "item" }],
						domainObjects: [{ id: "items", home: "main" }],
					}),
					definitions: { objectTypes: [Item], domainObjects: [Items] },
				},
			]);

			expect(result.domainObjects.size).toBe(0);
			expect(result.issues).toEqual([
				expect.objectContaining({ pluginId: "acme.host", code: "object-type-mismatch" }),
			]);
		});

		it("lets only one collection resolve an object type", () => {
			const Others = defineDomainObject({
				id: "acme.host/others",
				home: "main",
				state: z.object({}),
				lookup: () => null,
				objectType: Item,
			});
			const result = discoverPlugins([
				{
					manifest: manifest("acme.host", {
						objectTypes: [{ id: "item" }],
						domainObjects: [
							{ id: "items", home: "main", objectType: "acme.host/item" },
							{ id: "others", home: "main", objectType: "acme.host/item" },
						],
					}),
					definitions: { objectTypes: [Item], domainObjects: [Items, Others] },
				},
			]);

			expect(result.objectTypes.get("acme.host/item")?.collection).toBe("acme.host/items");
			expect(result.domainObjects.has("acme.host/others")).toBe(false);
			expect(result.issues).toEqual([
				expect.objectContaining({ pluginId: "acme.host", code: "duplicate-collection" }),
			]);
		});

		it("requires a collection that resolves an object type to declare a lookup", () => {
			const NoLookup = defineDomainObject({
				id: "acme.host/items",
				home: "main",
				state: z.object({}),
				objectType: Item,
			});
			const result = discoverPlugins([
				{
					manifest: manifest("acme.host", {
						objectTypes: [{ id: "item" }],
						domainObjects: [{ id: "items", home: "main", objectType: "acme.host/item" }],
					}),
					definitions: { objectTypes: [Item], domainObjects: [NoLookup] },
				},
			]);

			expect(result.domainObjects.size).toBe(0);
			expect(result.issues).toEqual([
				expect.objectContaining({ pluginId: "acme.host", code: "missing-lookup" }),
			]);
		});
	});

	it("never lets an extension point, a domain object, a context key or an object type share an id", () => {
		const Thing = defineExtensionPoint({ id: "acme.host/thing", kind: "additive" });
		const ThingStore = defineDomainObject({
			id: "acme.host/thing",
			home: "main",
			state: z.object({}),
		});
		const result = discoverPlugins([
			{
				manifest: manifest("acme.host", {
					extensionPoints: [{ id: "thing", kind: "additive" }],
					domainObjects: [{ id: "thing", home: "main" }],
					contextKeys: [{ id: "thing" }],
				}),
				definitions: { extensionPoints: [Thing], domainObjects: [ThingStore] },
			},
		]);

		expect(result.issues.map((issue) => [issue.pluginId, issue.code, issue.message])).toEqual([
			["acme.host", "duplicate-id", expect.stringContaining('"acme.host/thing"')],
		]);
	});
});
