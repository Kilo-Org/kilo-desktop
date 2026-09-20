import { describe, expect, it } from "vitest";

import {
	getToolBashMetadataOutput,
	normalizeBashOutput,
	parseBashResult,
} from "./tool-ui-shared.js";

describe("parseBashResult", () => {
	it("reads stdout/stderr/exitCode objects and JSON strings", () => {
		expect(parseBashResult({ stdout: "ok", stderr: "warn", exitCode: 2 })).toEqual({
			stdout: "ok",
			stderr: "warn",
			exitCode: 2,
		});
		expect(parseBashResult(JSON.stringify({ stdout: "ok", exitCode: 0 }))).toEqual({
			stdout: "ok",
			stderr: undefined,
			exitCode: 0,
		});
	});

	it("treats OpenCode output/exit fields as stdout/exitCode", () => {
		expect(parseBashResult({ output: "hello\n", exit: 0 })).toEqual({
			stdout: "hello\n",
			stderr: undefined,
			exitCode: 0,
		});
	});

	it("keeps plain text as stdout", () => {
		expect(parseBashResult("plain")).toEqual({ stdout: "plain" });
	});
});

describe("normalizeBashOutput", () => {
	it("strips ANSI color and normalizes carriage returns", () => {
		const colored = `${String.fromCharCode(0x1b)}[32mpassing${String.fromCharCode(0x1b)}[0m\r\nnext`;
		expect(normalizeBashOutput(colored)).toBe("passing\nnext");
	});
});

describe("getToolBashMetadataOutput", () => {
	it("returns metadata.output for the matching tool call", () => {
		const parts = [
			{
				type: "tool",
				callID: "call-1",
				state: { metadata: { output: "chunk-one" } },
			},
			{
				type: "tool",
				callID: "call-2",
				state: { metadata: { output: "other" } },
			},
		];

		expect(getToolBashMetadataOutput(parts, "call-1")).toBe("chunk-one");
		expect(getToolBashMetadataOutput(parts, "missing")).toBeUndefined();
	});
});
