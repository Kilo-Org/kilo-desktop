import { describe, expect, it, vi } from "vitest";

import { appendText } from "../composer-focus";
import { createKiloSlashFormatter } from "../slash-commands/kilo-slash-command";
import {
	combineFormatters,
	composerPlaceholder,
	createMentionFormatter,
	mentionType,
	resolveMentionParts,
	type MentionSource,
} from "./mention-codec";

function source(key: string, resolve: MentionSource["implementation"]["resolve"]): MentionSource {
	return {
		key,
		trigger: "@",
		title: "Files",
		implementation: { search: async () => [], resolve },
	};
}

const files = source("kilo.files/files", (item) => ({ text: `@/${item.id}` }));
const FILES = mentionType("kilo.files/files");
const CONTEXT = {
	workSessionId: "wses_1",
	directory: "/projects/app",
	workspaceId: null,
	workspaceFolders: [],
};

describe("the mention formatter", () => {
	it("writes chips as directives and reads back only installed sources", () => {
		const formatter = createMentionFormatter([files]);
		const text = formatter.serialize({ id: "src/a b.ts", type: FILES, label: "a]b.ts" });

		expect(FILES).toBe("m_kilo_files_files");
		expect(text).toBe(":m_kilo_files_files[a b.ts]{name=src%2Fa%20b.ts} ");
		expect(formatter.parse(`see ${text}and :m_other[x]{name=y}`)).toEqual([
			{ kind: "text", text: "see " },
			{ kind: "mention", type: FILES, label: "a b.ts", id: "src/a b.ts" },
			{ kind: "text", text: " and :m_other[x]{name=y}" },
		]);
		expect(formatter.parse("")).toEqual([]);
	});

	it("reads slash commands first, then mentions in the rest", () => {
		const slash = createKiloSlashFormatter(new Map([["review", "command"]]));
		const formatter = combineFormatters(slash, createMentionFormatter([files]), (type) =>
			type.startsWith("m_"),
		);

		expect(formatter.parse("/review :m_kilo_files_files[a.ts]{name=a.ts}")).toMatchObject([
			{ kind: "mention", label: "review" },
			{ kind: "text", text: " " },
			{ kind: "mention", type: FILES, id: "a.ts" },
		]);
		expect(formatter.serialize({ id: "a.ts", type: FILES, label: "a.ts" })).toContain(
			":m_kilo_files_files",
		);
		expect(formatter.serialize({ id: "review", type: "command", label: "review" })).toContain(
			"/review",
		);
	});
});

describe("resolveMentionParts", () => {
	it("puts each mention's text in its place and its files after the text", async () => {
		const resolve = vi.fn(async (item: { id: string }, _context: unknown) => ({
			text: `<${item.id}>`,
			files: [{ url: `file:///${item.id}`, mime: "text/plain", filename: item.id }],
		}));
		const parts = await resolveMentionParts(
			[
				{ type: "text", text: "Compare :m_docs[A]{name=a} with :m_docs[B]{name=b}." },
				{ type: "file", url: "data:x", mime: "image/png" },
			],
			[source("docs", resolve)],
			CONTEXT,
		);

		expect(parts).toEqual([
			{ type: "text", text: "Compare <a> with <b>." },
			{ type: "file", url: "data:x", mime: "image/png" },
			{ type: "file", url: "file:///a", mime: "text/plain", filename: "a" },
			{ type: "file", url: "file:///b", mime: "text/plain", filename: "b" },
		]);
		expect(resolve.mock.calls[0]![1]).toMatchObject({ workSessionId: "wses_1" });
	});

	it("keeps the label when a source gives no text or fails", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const parts = await resolveMentionParts(
			[{ type: "text", text: ":m_quiet[Quiet]{name=q} :m_broken[Broken]{name=b}" }],
			[
				source("quiet", () => ({})),
				source("broken", () => {
					throw new Error("gone");
				}),
			],
			CONTEXT,
		);

		expect(parts).toEqual([{ type: "text", text: "Quiet Broken" }]);
	});

	it("leaves prompts without mentions, or without sources, as they are", async () => {
		const plain = [{ type: "text" as const, text: "hello" }];
		expect(await resolveMentionParts(plain, [files], CONTEXT)).toEqual(plain);
		expect(await resolveMentionParts(plain, [], CONTEXT)).toEqual(plain);
	});
});

describe("appendText", () => {
	it("separates added text with a space unless the composer ends in whitespace", () => {
		expect(appendText("", "a")).toBe("a");
		expect(appendText("see", "a")).toBe("see a");
		expect(appendText("see\n", "a")).toBe("see\na");
	});
});

describe("composerPlaceholder", () => {
	it("names each mention source", async () => {
		expect(composerPlaceholder([])).toBe("Send a message or / for commands…");
		expect(composerPlaceholder([files])).toBe(
			"Send a message, @ to mention files, or / for commands…",
		);
	});
});
