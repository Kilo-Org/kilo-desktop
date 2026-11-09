import { describe, expect, it } from "vitest";

import { EmptyKiloCatalogError } from "../runtime/kilo-connection-error";
import { fetchModelCatalogForConnection, isModelCatalogPending } from "./use-kilo-model-catalog";

const connection = {
	baseUrl: "http://127.0.0.1:4096",
	username: "kilo",
	password: "secret",
	version: "test",
	globalDirectory: "/tmp/kilo",
};

describe("isModelCatalogPending", () => {
	it("is pending on the initial catalog fetch", () => {
		expect(isModelCatalogPending({ isPending: true, isFetching: true })).toBe(true);
	});

	it("is pending while an empty catalog is refetching", () => {
		expect(
			isModelCatalogPending({
				isPending: false,
				isFetching: true,
				data: { models: [] },
			}),
		).toBe(true);
	});

	it("is not pending when an empty catalog has finished loading", () => {
		expect(
			isModelCatalogPending({
				isPending: false,
				isFetching: false,
				data: { models: [] },
			}),
		).toBe(false);
	});

	it("keeps a populated catalog usable while it refetches", () => {
		expect(
			isModelCatalogPending({
				isPending: false,
				isFetching: true,
				data: { models: [{ id: "anthropic/claude-sonnet" }] },
			}),
		).toBe(false);
	});
});

describe("fetchModelCatalogForConnection", () => {
	it("reads the merged Kilo config model alongside the provider catalog", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async (input) => {
			const url = input instanceof Request ? input.url : String(input);
			const pathname = new URL(url).pathname;
			if (pathname === "/provider") {
				return Response.json({
					all: [
						{
							id: "anthropic",
							name: "Anthropic",
							models: {
								"claude-sonnet": {
									id: "claude-sonnet",
									name: "Claude Sonnet",
									providerID: "anthropic",
								},
							},
						},
					],
					default: { anthropic: "claude-sonnet" },
					connected: ["anthropic"],
				});
			}
			if (pathname === "/config") return Response.json({ model: "anthropic/claude-sonnet" });
			if (pathname === "/kilo/auth/status") return Response.json({ authenticated: false });
			throw new Error(`Unexpected URL: ${url}`);
		};

		try {
			await expect(fetchModelCatalogForConnection(connection)).resolves.toMatchObject({
				configuredModel: { providerID: "anthropic", modelID: "claude-sonnet" },
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("throws when Kilo reports no providers yet so the query can retry", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async (input) => {
			const url = input instanceof Request ? input.url : String(input);
			const pathname = new URL(url).pathname;
			if (pathname === "/provider") return Response.json({ all: [], default: {}, connected: [] });
			if (pathname === "/config") return Response.json({});
			if (pathname === "/kilo/auth/status") return Response.json({ authenticated: false });
			throw new Error(`Unexpected URL: ${url}`);
		};

		try {
			await expect(fetchModelCatalogForConnection(connection)).rejects.toBeInstanceOf(
				EmptyKiloCatalogError,
			);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("resolves a populated but unconnected provider list instead of throwing", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async (input) => {
			const url = input instanceof Request ? input.url : String(input);
			const pathname = new URL(url).pathname;
			if (pathname === "/provider") {
				return Response.json({
					all: [
						{
							id: "anthropic",
							name: "Anthropic",
							models: {
								"claude-sonnet": {
									id: "claude-sonnet",
									name: "Claude Sonnet",
									providerID: "anthropic",
								},
							},
						},
					],
					default: { anthropic: "claude-sonnet" },
					connected: [],
				});
			}
			if (pathname === "/config") return Response.json({});
			if (pathname === "/kilo/auth/status") return Response.json({ authenticated: false });
			throw new Error(`Unexpected URL: ${url}`);
		};

		try {
			await expect(fetchModelCatalogForConnection(connection)).resolves.toMatchObject({
				models: [],
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
