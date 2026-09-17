import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	WORKSPACE_FILE_CHANGE_EVENT,
	type WorkspaceFileChangeEvent,
} from "@anaconda-agentic-desktop/feature-sdk";

import { createFeatureSystem, SdkProvider } from "./SdkProvider.js";
import { createTestShellDelegates } from "./test-helpers.js";
import { useWorkspaceWatcher, type UseWorkspaceWatcherOptions } from "./useWorkspaceWatcher.js";

const BATCH = {
	root: "/work/project",
	changes: [
		{ path: "/work/project/src/a.py", type: "create" },
		{ path: "/work/project/src/a.ts", type: "update" },
	],
} satisfies WorkspaceFileChangeEvent;

const PY_BATCH = {
	root: "/work/project",
	changes: [{ path: "/work/project/src/a.py", type: "create" }],
} satisfies WorkspaceFileChangeEvent;

const TS_BATCH = {
	root: "/work/project",
	changes: [{ path: "/work/project/src/a.ts", type: "update" }],
} satisfies WorkspaceFileChangeEvent;

function Probe({ options }: { options: UseWorkspaceWatcherOptions }) {
	useWorkspaceWatcher(options);
	return null;
}

function mountProbe(initialOptions: UseWorkspaceWatcherOptions) {
	const system = createFeatureSystem({
		shellDelegates: createTestShellDelegates(),
		features: [],
	});
	const tree = (options: UseWorkspaceWatcherOptions) => (
		<SdkProvider system={system}>
			<Probe options={options} />
		</SdkProvider>
	);
	const rendered = render(tree(initialOptions));
	const emit = (payload: WorkspaceFileChangeEvent) => {
		system.services.featureRouter.eventBus.emit(WORKSPACE_FILE_CHANGE_EVENT, payload);
	};
	return {
		rerender: (options: UseWorkspaceWatcherOptions) => rendered.rerender(tree(options)),
		unmount: () => rendered.unmount(),
		emit,
		dispose: () => system.dispose(),
	};
}

describe("useWorkspaceWatcher", () => {
	afterEach(cleanup);

	it("subscribes on mount and fires the callback on batches", () => {
		const onEvent = vi.fn();
		const harness = mountProbe({ onFileChange: onEvent });

		harness.emit(BATCH);

		expect(onEvent).toHaveBeenCalledWith(BATCH);
		harness.dispose();
	});

	it("unsubscribes on unmount — the callback stops firing", () => {
		const onEvent = vi.fn();
		const harness = mountProbe({ onFileChange: onEvent });

		harness.unmount();
		harness.emit(BATCH);

		expect(onEvent).not.toHaveBeenCalled();
		harness.dispose();
	});

	it("applies new filters when the options change", () => {
		const onEvent = vi.fn();
		const harness = mountProbe({ includes: ["**/*.py"], onFileChange: onEvent });

		harness.emit(TS_BATCH);
		expect(onEvent).not.toHaveBeenCalled();

		harness.rerender({ includes: ["**/*.ts"], onFileChange: onEvent });
		harness.emit(TS_BATCH);

		expect(onEvent).toHaveBeenCalledTimes(1);
		expect(onEvent).toHaveBeenCalledWith(TS_BATCH);
		harness.dispose();
	});

	it("uses the latest callback without re-subscribing when only the callback changes", () => {
		const first = vi.fn();
		const harness = mountProbe({ includes: ["**/*.py"], onFileChange: first });

		harness.emit(PY_BATCH);
		expect(first).toHaveBeenCalledTimes(1);

		const second = vi.fn();
		harness.rerender({ includes: ["**/*.py"], onFileChange: second });
		harness.emit(PY_BATCH);

		expect(first).toHaveBeenCalledTimes(1);
		expect(second).toHaveBeenCalledTimes(1);
		expect(second).toHaveBeenCalledWith(PY_BATCH);
		harness.dispose();
	});

	it("does not subscribe when enabled is false", () => {
		const onEvent = vi.fn();
		const harness = mountProbe({ onFileChange: onEvent, enabled: false });

		harness.emit(BATCH);

		expect(onEvent).not.toHaveBeenCalled();
		harness.dispose();
	});

	it("subscribes when enabled changes from false to true", () => {
		const onEvent = vi.fn();
		const harness = mountProbe({ onFileChange: onEvent, enabled: false });

		harness.emit(BATCH);
		expect(onEvent).not.toHaveBeenCalled();

		harness.rerender({ onFileChange: onEvent, enabled: true });
		harness.emit(BATCH);

		expect(onEvent).toHaveBeenCalledTimes(1);
		expect(onEvent).toHaveBeenCalledWith(BATCH);
		harness.dispose();
	});

	it("unsubscribes when enabled changes from true to false", () => {
		const onEvent = vi.fn();
		const harness = mountProbe({ onFileChange: onEvent, enabled: true });

		harness.emit(BATCH);
		expect(onEvent).toHaveBeenCalledTimes(1);

		harness.rerender({ onFileChange: onEvent, enabled: false });
		harness.emit(BATCH);

		expect(onEvent).toHaveBeenCalledTimes(1);
		harness.dispose();
	});

	it("throws outside SdkProvider", () => {
		expect(() => render(<Probe options={{ onFileChange: () => {} }} />)).toThrow(
			/must be used within <SdkProvider>/,
		);
	});
});
