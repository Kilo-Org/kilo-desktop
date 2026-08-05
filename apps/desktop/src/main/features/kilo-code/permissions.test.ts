import { describe, expect, it } from "vitest";

import {
	buildReferenceFolderRules,
	deduplicatePermissionRules,
	reconcileReferenceFolderRules,
} from "./permissions.js";
import type { Workspace } from "./workspace-capability.js";

function workspace(primary: string, references: string[]): Workspace {
	return {
		id: "workspace-1",
		name: "Workspace",
		folders: [primary, ...references].map((folderPath, position) => ({
			id: `folder-${position}`,
			path: folderPath,
			isPrimary: position === 0,
			position,
		})),
		createdAt: 1,
		updatedAt: 1,
	};
}

describe("Kilo reference-folder permissions", () => {
	it("allows only reference folders and covers both the directory and its descendants", () => {
		expect(buildReferenceFolderRules(workspace("/primary", ["/shared/"]))).toEqual([
			{ permission: "external_directory", pattern: "/shared", action: "allow" },
			{ permission: "external_directory", pattern: "/shared/*", action: "allow" },
		]);
		expect(buildReferenceFolderRules(null)).toEqual([]);
	});

	it("adds new allows and shadows removed reference folders with ask rules", () => {
		expect(
			reconcileReferenceFolderRules(
				workspace("/primary", ["/removed"]),
				workspace("/primary", ["/added"]),
			),
		).toEqual([
			{ permission: "external_directory", pattern: "/added", action: "allow" },
			{ permission: "external_directory", pattern: "/added/*", action: "allow" },
			{ permission: "external_directory", pattern: "/removed", action: "ask" },
			{ permission: "external_directory", pattern: "/removed/*", action: "ask" },
		]);
	});

	it("treats primary/reference transitions as permission changes and deduplicates triples", () => {
		expect(
			reconcileReferenceFolderRules(workspace("/one", ["/two"]), workspace("/two", ["/one"])),
		).toEqual([
			{ permission: "external_directory", pattern: "/one", action: "allow" },
			{ permission: "external_directory", pattern: "/one/*", action: "allow" },
			{ permission: "external_directory", pattern: "/two", action: "ask" },
			{ permission: "external_directory", pattern: "/two/*", action: "ask" },
		]);
		expect(
			deduplicatePermissionRules([
				{ permission: "external_directory", pattern: "/same", action: "allow" },
				{ permission: "external_directory", pattern: "/same", action: "allow" },
			]),
		).toHaveLength(1);
	});
});
