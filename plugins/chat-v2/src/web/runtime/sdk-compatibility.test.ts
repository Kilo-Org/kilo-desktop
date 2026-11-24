import { describe, expect, it } from "vitest";

import { createOpencodeClient } from "@kilo-desktop/react-opencode-v2";

describe("react-opencode-v2's client", () => {
	it("is a v1-shaped client answered by Kilo v2", () => {
		const client = createOpencodeClient({ baseUrl: "http://127.0.0.1:1", directory: "/p" });

		expect(typeof client.session.promptAsync).toBe("function");
		expect(typeof client.permission.reply).toBe("function");
		expect(typeof client.question.reply).toBe("function");
		expect(() => client.file.read({ path: "a" } as never)).toThrow("isn't on Kilo v2 yet");
	});
});
