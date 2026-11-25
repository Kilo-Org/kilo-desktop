import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { OpenCodeThreadController } from "./OpenCodeThreadController";
import { createFakeClient, createFakeEventSource, serverEvent, SESSION_ID } from "./testUtils";
import type { OpenCodeThreadState } from "./types";
import { useOpenCodeControllerState } from "./useOpenCodeControllerState";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function loadedController() {
	const events = createFakeEventSource();
	const controller = new OpenCodeThreadController(
		createFakeClient().client,
		() => events,
		SESSION_ID,
	);
	await controller.load();
	return { events, controller };
}

describe("useOpenCodeControllerState", () => {
	let root: Root | undefined;

	afterEach(() => {
		act(() => {
			root?.unmount();
		});
		root = undefined;
	});

	it("keeps the event subscription across event-driven re-renders", async () => {
		const { events, controller } = await loadedController();
		const snapshots: OpenCodeThreadState[] = [];
		const Probe = () => {
			snapshots.push(useOpenCodeControllerState(controller));
			return null;
		};

		act(() => {
			root = createRoot(document.createElement("div"));
			root.render(<Probe />);
		});
		expect(events.subscribe).toHaveBeenCalledOnce();

		act(() => {
			events.emit(serverEvent("session.renamed", { title: "First response" }));
		});

		expect(snapshots.at(-1)?.session?.title).toBe("First response");
		expect(events.subscribe).toHaveBeenCalledOnce();
		expect(events.unsubscribe).not.toHaveBeenCalled();

		act(() => {
			root?.unmount();
		});
		root = undefined;

		expect(controller.isAttachedToEvents()).toBe(false);
	});

	it("stays attached to events after a StrictMode double mount", async () => {
		const { events, controller } = await loadedController();
		const snapshots: OpenCodeThreadState[] = [];
		const Probe = () => {
			snapshots.push(useOpenCodeControllerState(controller));
			return null;
		};

		act(() => {
			root = createRoot(document.createElement("div"));
			root.render(
				<StrictMode>
					<Probe />
				</StrictMode>,
			);
		});
		expect(controller.isAttachedToEvents()).toBe(true);

		act(() => {
			events.emit(serverEvent("session.renamed", { title: "Recovered" }));
		});

		expect(snapshots.at(-1)?.session?.title).toBe("Recovered");
		expect(controller.isAttachedToEvents()).toBe(true);
	});
});
