import { describe, expect, it } from "vitest";

import { discoverPlugins, KERNEL_CONTEXT_KEYS, KERNEL_DEFINITIONS } from "@kilo-desktop/kernel";

import manifest from "../../plugin.json";
import { CORE_DEFINITIONS } from "./index";

describe("kilo.core manifest", () => {
	it("agrees with its contracts and the kernel's extension points", () => {
		const result = discoverPlugins([{ manifest, definitions: CORE_DEFINITIONS }], {
			kernelDefinitions: KERNEL_DEFINITIONS,
			kernelContextKeys: KERNEL_CONTEXT_KEYS,
		});

		expect(result.issues).toEqual([]);
		expect(result.objectTypes.get("kilo.core/chat")?.collection).toBe("kilo.core/chats");
		expect(result.objectTypes.get("kilo.core/model")?.collection).toBe("kilo.core/models");
	});
});
