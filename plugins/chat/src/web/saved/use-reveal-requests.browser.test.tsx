import { useCallback, useState } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RevealRequests } from "./reveal-requests";
import { useRevealRequests } from "./use-reveal-requests";

/**
 * A transcript shaped like `Thread`: its viewport is found from a column
 * held in state, so it is unknown on the first render, and scrolls smoothly.
 */
function Transcript({
	requests,
	trailing = 0,
	ready = true,
	hasMessage = true,
}: {
	requests: RevealRequests;
	trailing?: number;
	ready?: boolean;
	hasMessage?: boolean;
}) {
	const [column, setColumn] = useState<HTMLDivElement | null>(null);
	const viewport = useCallback(() => column?.closest('[data-slot="viewport"]') ?? null, [column]);
	useRevealRequests(requests, "chat-1", viewport, ready);
	return (
		<div data-slot="viewport" style={{ height: 120, overflowY: "auto", scrollBehavior: "smooth" }}>
			<div ref={setColumn}>
				<div style={{ height: 400 }} />
				{hasMessage ? (
					<div data-message-id="m1">
						<p>The saved reply.</p>
					</div>
				) : null}
				<div style={{ height: trailing }} />
			</div>
		</div>
	);
}

afterEach(cleanup);

describe("useRevealRequests", () => {
	it("finds the message of a reveal requested before the transcript mounted", async () => {
		const requests = new RevealRequests();
		const pending = requests.request("chat-1", { messageId: "m1", anchor: "not an anchor" });

		render(<Transcript requests={requests} />);

		expect(await pending).toBe("message");
	});

	it("waits for the transcript to show its older messages before looking", async () => {
		const requests = new RevealRequests();
		const pending = requests.request("chat-1", { messageId: "m1", anchor: "not an anchor" });
		const { rerender } = render(
			<Transcript requests={requests} ready={false} hasMessage={false} />,
		);
		await new Promise((resolve) => setTimeout(resolve, 600));

		rerender(<Transcript requests={requests} />);

		expect(await pending).toBe("message");
	});

	it("keeps the revealed message in view when the transcript jumps to its end right after", async () => {
		const requests = new RevealRequests();
		const pending = requests.request("chat-1", { messageId: "m1", anchor: "not an anchor" });
		render(<Transcript requests={requests} trailing={900} />);
		expect(await pending).toBe("message");
		const area = document.querySelector<HTMLElement>('[data-slot="viewport"]')!;
		const message = document.querySelector<HTMLElement>('[data-message-id="m1"]')!;
		const inView = () => {
			const box = area.getBoundingClientRect();
			const rect = message.getBoundingClientRect();
			return rect.bottom > box.top && rect.top < box.bottom;
		};
		expect(inView()).toBe(true);

		// What autoscroll did: follow the growing transcript back to its end.
		area.scrollTo({ top: area.scrollHeight, behavior: "instant" });

		await expect.poll(inView).toBe(true);
	});

	it("stops holding once the reader scrolls", async () => {
		const requests = new RevealRequests();
		const pending = requests.request("chat-1", { messageId: "m1", anchor: "not an anchor" });
		render(<Transcript requests={requests} trailing={900} />);
		await pending;
		const area = document.querySelector<HTMLElement>('[data-slot="viewport"]')!;

		area.dispatchEvent(new WheelEvent("wheel", { deltaY: 400 }));
		area.scrollTo({ top: area.scrollHeight, behavior: "instant" });
		await new Promise((resolve) => setTimeout(resolve, 100));

		expect(area.scrollTop).toBe(area.scrollHeight - area.clientHeight);
	});

	it("scrolls to the latest message of a bookmark requested before the transcript mounted", async () => {
		const requests = new RevealRequests();
		const pending = requests.request("chat-1", "latest");

		render(<Transcript requests={requests} />);

		expect(await pending).toBe("exact");
	});
});
