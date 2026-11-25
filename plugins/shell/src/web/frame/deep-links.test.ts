import { describe, expect, it } from "vitest";

import type { Contribution } from "@kilo-desktop/kernel";

import type { DeepLink } from "../../contracts";
import { resolveDeepLink } from "./navigation";

const link = (host: string, path: string, query: string[] = [], pathParam?: string) =>
	({ metadata: { host, path, query, pathParam } }) as unknown as Contribution<typeof DeepLink>;

describe("resolveDeepLink", () => {
	const links = [
		link("model-catalog", "/settings/models", ["model"]),
		link("settings", "/settings"),
	];

	it("maps a host to its path and keeps only the listed query parameters", () => {
		expect(resolveDeepLink("kilo-desktop://model-catalog?model=a&other=b", links)).toEqual({
			path: "/settings/models",
			search: { model: "a" },
		});
	});

	it("omits listed parameters that are absent", () => {
		expect(resolveDeepLink("kilo-desktop-dev://model-catalog", links)).toEqual({
			path: "/settings/models",
			search: {},
		});
	});

	it("carries the first path segment as the link's path parameter", () => {
		const catalog = [link("model-catalog", "/settings/local-model-server", [], "catalogModel")];
		expect(resolveDeepLink("kilo-desktop://model-catalog/qwen%203", catalog)).toEqual({
			path: "/settings/local-model-server",
			search: { catalogModel: "qwen 3" },
		});
		expect(resolveDeepLink("kilo-desktop:model-catalog/llama", catalog)).toEqual({
			path: "/settings/local-model-server",
			search: { catalogModel: "llama" },
		});
		expect(resolveDeepLink("kilo-desktop://model-catalog", catalog)?.search).toEqual({});
	});

	it("carries an action segment and its listed parameters together (web catalog install links)", () => {
		const packages = [
			link(
				"packages",
				"/settings/environments",
				["package", "version", "channel", "source"],
				"packageAction",
			),
		];
		expect(
			resolveDeepLink(
				"kilo-desktop://packages/install?package=scikit-learn&version=1.5.2&channel=conda-forge%2Flabel%2Fdev&source=dot-org&env=%2Fopt",
				packages,
			),
		).toEqual({
			path: "/settings/environments",
			search: {
				packageAction: "install",
				package: "scikit-learn",
				version: "1.5.2",
				channel: "conda-forge/label/dev",
				source: "dot-org",
			},
		});

		const models = [
			link("models", "/settings/local-model-server", ["model", "file", "source"], "modelAction"),
		];
		expect(
			resolveDeepLink(
				"kilo-desktop://models/install?model=550e8400-e29b-41d4-a716-446655440000&file=660e8400-e29b-41d4-a716-446655440001&source=dot-org&extra=ignored",
				models,
			),
		).toEqual({
			path: "/settings/local-model-server",
			search: {
				modelAction: "install",
				model: "550e8400-e29b-41d4-a716-446655440000",
				file: "660e8400-e29b-41d4-a716-446655440001",
				source: "dot-org",
			},
		});
	});

	it("returns null for unknown hosts and malformed URLs", () => {
		expect(resolveDeepLink("kilo-desktop://nowhere", links)).toBeNull();
		expect(resolveDeepLink("not a url", links)).toBeNull();
	});
});
