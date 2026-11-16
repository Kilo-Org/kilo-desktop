import { describe, expect, it } from "vitest";

import {
	fileMentionFormatter,
	fileMentionItems,
	workspaceFileMentionItems,
} from "./file-mention.js";

describe("file mentions", () => {
	it("maps only files to mention picker items", () => {
		expect(fileMentionItems(["src/", "src/App.tsx", "README.md"])).toEqual([
			{
				id: "src/App.tsx",
				type: "file",
				label: "App.tsx",
				description: "src/App.tsx",
				metadata: { icon: "file" },
			},
			{
				id: "README.md",
				type: "file",
				label: "README.md",
				description: "README.md",
				metadata: { icon: "file" },
			},
		]);
	});

	it("distinguishes files from every folder in a multi-folder workspace", () => {
		expect(
			workspaceFileMentionItems([
				{ workspaceDirectory: "/projects/app", paths: ["src/index.ts", "src/"] },
				{ workspaceDirectory: "/projects/reference", paths: ["src/index.ts"] },
			]),
		).toEqual([
			{
				id: "/projects/app/src/index.ts",
				type: "file",
				label: "index.ts",
				description: "app/src/index.ts",
				metadata: { icon: "file" },
			},
			{
				id: "/projects/reference/src/index.ts",
				type: "file",
				label: "index.ts",
				description: "reference/src/index.ts",
				metadata: { icon: "file" },
			},
		]);
	});

	it("uses full root paths when workspace folder names collide", () => {
		expect(
			workspaceFileMentionItems([
				{ workspaceDirectory: "/projects/app/src", paths: ["index.ts"] },
				{ workspaceDirectory: "/projects/reference/src", paths: ["index.ts"] },
			]).map(({ description }) => description),
		).toEqual(["/projects/app/src/index.ts", "/projects/reference/src/index.ts"]);
	});

	it("serializes Kilo file references and quotes paths with spaces", () => {
		expect(fileMentionFormatter.serialize({ id: "src/App.tsx" })).toBe("@/src/App.tsx ");
		expect(
			fileMentionFormatter.serialize({
				id: "docs/Release Notes.md",
			}),
		).toBe('@"/docs/Release Notes.md" ');
		expect(fileMentionFormatter.serialize({ id: 'docs/weird"file.md' })).toBe(
			'@"/docs/weird\\"file.md" ',
		);
	});

	it("parses file references among ordinary message text", () => {
		expect(
			fileMentionFormatter.parse('Compare @/src/App.tsx with @"/docs/Release Notes.md".'),
		).toEqual([
			{ kind: "text", text: "Compare " },
			{ kind: "mention", type: "file", id: "src/App.tsx", label: "App.tsx" },
			{ kind: "text", text: " with " },
			{
				kind: "mention",
				type: "file",
				id: "docs/Release Notes.md",
				label: "Release Notes.md",
			},
			{ kind: "text", text: "." },
		]);
	});

	it("parses adjacent unquoted file references separately", () => {
		expect(fileMentionFormatter.parse("@/a.tsx@/b.tsx")).toEqual([
			{ kind: "mention", type: "file", id: "a.tsx", label: "a.tsx" },
			{ kind: "mention", type: "file", id: "b.tsx", label: "b.tsx" },
		]);
	});
});
