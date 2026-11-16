import { describe, expect, it } from "vitest";

import { buildEnv } from "./environment.js";

describe("buildEnv", () => {
	it("applies the TERM and GIT_TERMINAL_PROMPT defaults over the inherited environment", () => {
		const env = buildEnv({}, {}, { TERM: "xterm-256color" });
		expect(env["TERM"]).toBe("dumb");
		expect(env["GIT_TERMINAL_PROMPT"]).toBe("0");
	});

	it("lets client-level env override the defaults", () => {
		const env = buildEnv({ TERM: "my-term", GIT_TERMINAL_PROMPT: undefined });
		expect(env["TERM"]).toBe("my-term");
		// An undefined value means "do not set this variable" — it is stripped
		// from the result so the child env never sees an undefined entry.
		expect("GIT_TERMINAL_PROMPT" in env).toBe(false);
	});

	it("lets per-call env override client-level env and the defaults", () => {
		const env = buildEnv({ TERM: "client-term" }, { TERM: "call-term", CUSTOM: "yes" });
		expect(env["TERM"]).toBe("call-term");
		expect(env["CUSTOM"]).toBe("yes");
	});

	it("inherits values from the process environment", () => {
		const env = buildEnv({}, {}, { HOME: "/home/git", TERM: "xterm" });
		expect(env["HOME"]).toBe("/home/git");
		expect(env["TERM"]).toBe("dumb");
	});

	if (process.platform === "win32") {
		it("preserves the case of the path environment variable", () => {
			const env = buildEnv({ PATH: "custom-path" }, {}, { path: "env-path" });
			expect(env["PATH"]).toBeUndefined();
			expect(env["path"]?.includes("custom-path")).toBe(true);
		});
	} else {
		it("treats environment variables as case-sensitive", () => {
			const env = buildEnv(
				{ PATH: "WOW_SUCH_CASE_SENSITIVITY" },
				{},
				{
					path: "wow-such-case-sensitivity",
				},
			);
			expect(env["PATH"]).toBe("WOW_SUCH_CASE_SENSITIVITY");
			expect(env["path"]).toBe("wow-such-case-sensitivity");
		});
	}
});
