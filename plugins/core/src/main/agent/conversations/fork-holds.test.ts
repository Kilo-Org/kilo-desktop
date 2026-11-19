import { describe, expect, it } from "vitest";

import type { ChatRecords } from "./activity";
import { ForkHolds } from "./fork-holds";

const chats = (...ids: string[]) =>
	Object.fromEntries(ids.map((id) => [id, {}])) as unknown as ChatRecords;

describe("ForkHolds", () => {
	it("forgets a named fork once its chat is gone", () => {
		const holds = new ForkHolds();
		const hold = holds.begin(null, []);
		hold.narrow("ses_fork");
		hold.release();

		holds.prune(chats("ses_fork"));
		expect(holds.named("ses_fork")).toBe(true);

		holds.prune(chats());
		expect(holds.named("ses_fork")).toBe(false);
	});

	it("keeps a fork its own hold still names, though its chat isn't listed yet", () => {
		const holds = new ForkHolds();
		holds.begin(null, []).narrow("ses_fork");

		holds.prune(chats());

		expect(holds.named("ses_fork")).toBe(true);
	});
});
