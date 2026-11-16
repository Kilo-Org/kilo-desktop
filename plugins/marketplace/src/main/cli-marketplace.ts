import { z } from "zod";

import {
	marketplaceItemSchema,
	marketplaceTypeSchema,
	type MarketplaceItem,
	type MarketplaceItemRef,
} from "../contracts/schemas";

export type KiloConnection = {
	baseUrl: string;
	username: string;
	password: string;
	globalDirectory: string;
};

const installedSchema = z.record(
	z.string(),
	z.object({ type: marketplaceTypeSchema.or(z.literal("plugin")) }),
);
const listSchema = z.object({
	items: z.array(z.unknown()),
	installed: z.object({ project: installedSchema, global: installedSchema }),
	errors: z.array(z.string()).optional(),
});
const mutationSchema = z.object({
	success: z.boolean(),
	error: z.string().optional(),
	filePath: z.string().optional(),
});

export type CliMarketplaceList = {
	items: MarketplaceItem[];
	project: MarketplaceItemRef[];
	global: MarketplaceItemRef[];
	errors: string[];
};

function itemRefs(entries: Record<string, { type: string }>): MarketplaceItemRef[] {
	return Object.entries(entries).flatMap(([key, value]) => {
		if (value.type === "plugin") return [];
		const type = marketplaceTypeSchema.safeParse(value.type);
		if (!type.success) return [];
		const prefix = `${value.type}:`;
		return key.startsWith(prefix) ? [{ type: type.data, id: key.slice(prefix.length) }] : [];
	});
}

export class CliMarketplaceError extends Error {}

export class CliMarketplaceClient {
	readonly #connection: KiloConnection;
	readonly #fetch: typeof fetch;

	constructor(connection: KiloConnection, fetch: typeof globalThis.fetch) {
		this.#connection = connection;
		this.#fetch = fetch;
	}

	async list(directory: string): Promise<CliMarketplaceList> {
		const parsed = listSchema.parse(await this.#request("/kilocode/marketplace", directory));
		return {
			items: parsed.items.flatMap((item) => {
				const result = marketplaceItemSchema.safeParse(item);
				return result.success ? [result.data] : [];
			}),
			project: itemRefs(parsed.installed.project),
			global: itemRefs(parsed.installed.global),
			errors: parsed.errors ?? [],
		};
	}

	async install(
		directory: string,
		item: MarketplaceItem,
		target: "project" | "global",
		method: string | undefined,
		parameters: Record<string, string> | undefined,
	): Promise<string | undefined> {
		const selectedParameters = {
			...parameters,
			...(method ? { __method: method } : {}),
		};
		const result = mutationSchema.parse(
			await this.#request("/kilocode/marketplace/install", directory, {
				item: { type: item.type, id: item.id, content: item.content },
				target,
				...(Object.keys(selectedParameters).length ? { parameters: selectedParameters } : {}),
			}),
		);
		if (!result.success)
			throw new CliMarketplaceError(result.error ?? "Marketplace install failed.");
		return result.filePath;
	}

	async remove(
		directory: string,
		item: MarketplaceItemRef,
		scope: "project" | "global",
	): Promise<void> {
		const result = mutationSchema.parse(
			await this.#request("/kilocode/marketplace/remove", directory, { item, scope }),
		);
		if (!result.success)
			throw new CliMarketplaceError(result.error ?? "Marketplace removal failed.");
	}

	async #request(pathname: string, directory: string, body?: unknown): Promise<unknown> {
		const url = new URL(pathname, this.#connection.baseUrl);
		url.searchParams.set("directory", directory);
		const authorization = Buffer.from(
			`${this.#connection.username}:${this.#connection.password}`,
		).toString("base64");
		const response = await this.#fetch(url, {
			...(body === undefined
				? {}
				: {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body),
					}),
			headers: {
				authorization: `Basic ${authorization}`,
				...(body === undefined ? {} : { "content-type": "application/json" }),
			},
		});
		if (!response.ok) {
			throw new CliMarketplaceError(`Kilo Marketplace returned HTTP ${response.status}.`);
		}
		return response.json();
	}
}
