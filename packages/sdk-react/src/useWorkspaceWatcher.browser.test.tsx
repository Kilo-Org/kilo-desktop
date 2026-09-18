import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	WORKSPACE_FILE_CHANGE_EVENT,
	type WorkspaceFileChangeEvent,
} from "@kilo-desktop/feature-sdk";

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

	describe("files option", () => {
		it("fires for the exact file path only — sibling does not match", () => {
			const onEvent = vi.fn();
			const harness = mountProbe({
				files: ["/work/project/src/a.ts"],
				onFileChange: onEvent,
			});

			const sibling: WorkspaceFileChangeEvent = {
				root: "/work/project",
				changes: [{ path: "/work/project/src/b.ts", type: "update" }],
			};
			harness.emit(sibling);
			expect(onEvent).not.toHaveBeenCalled();

			harness.emit(TS_BATCH); // contains /work/project/src/a.ts
			expect(onEvent).toHaveBeenCalledTimes(1);
			harness.dispose();
		});

		it("posix-normalizes Windows paths (C:\\work\\a.ts matches the event path)", () => {
			const onEvent = vi.fn();
			const harness = mountProbe({
				files: ["C:\\work\\a.ts"],
				onFileChange: onEvent,
			});

			const winBatch: WorkspaceFileChangeEvent = {
				root: "C:/work",
				changes: [{ path: "C:/work/a.ts", type: "update" }],
			};
			harness.emit(winBatch);
			expect(onEvent).toHaveBeenCalledTimes(1);
			harness.dispose();
		});

		it("escapes magic chars — proj[1] matches only itself, not proj1", () => {
			const onEvent = vi.fn();
			const harness = mountProbe({
				files: ["/work/proj[1]/a.ts"],
				onFileChange: onEvent,
			});

			const noMagic: WorkspaceFileChangeEvent = {
				root: "/work",
				changes: [{ path: "/work/proj1/a.ts", type: "update" }],
			};
			harness.emit(noMagic);
			expect(onEvent).not.toHaveBeenCalled();

			const magic: WorkspaceFileChangeEvent = {
				root: "/work",
				changes: [{ path: "/work/proj[1]/a.ts", type: "update" }],
			};
			harness.emit(magic);
			expect(onEvent).toHaveBeenCalledTimes(1);
			harness.dispose();
		});
	});

	describe("dirs option", () => {
		it("fires for the dir itself and all descendants, not outside paths", () => {
			const onEvent = vi.fn();
			const harness = mountProbe({
				dirs: ["/work/project"],
				onFileChange: onEvent,
			});

			const inside: WorkspaceFileChangeEvent = {
				root: "/work/project",
				changes: [{ path: "/work/project/src/a.ts", type: "update" }],
			};
			harness.emit(inside);
			expect(onEvent).toHaveBeenCalledTimes(1);

			const outside: WorkspaceFileChangeEvent = {
				root: "/work/other",
				changes: [{ path: "/work/other/src/a.ts", type: "update" }],
			};
			harness.emit(outside);
			expect(onEvent).toHaveBeenCalledTimes(1); // no new call
			harness.dispose();
		});

		it("handles trailing-slash input (/work/project/ works)", () => {
			const onEvent = vi.fn();
			const harness = mountProbe({
				dirs: ["/work/project/"],
				onFileChange: onEvent,
			});

			const inside: WorkspaceFileChangeEvent = {
				root: "/work/project",
				changes: [{ path: "/work/project/src/a.ts", type: "update" }],
			};
			harness.emit(inside);
			expect(onEvent).toHaveBeenCalledTimes(1);
			harness.dispose();
		});
	});

	it("includes + files + dirs all concatenate into one filter", () => {
		const onEvent = vi.fn();
		const harness = mountProbe({
			includes: ["**/*.py"],
			files: ["/work/project/src/a.ts"],
			dirs: ["/work/other"],
			onFileChange: onEvent,
		});

		// Matches via includes
		harness.emit(PY_BATCH);
		expect(onEvent).toHaveBeenCalledTimes(1);

		// Matches via files
		harness.emit(TS_BATCH);
		expect(onEvent).toHaveBeenCalledTimes(2);

		// Matches via dirs
		const dirBatch: WorkspaceFileChangeEvent = {
			root: "/work/other",
			changes: [{ path: "/work/other/readme.md", type: "create" }],
		};
		harness.emit(dirBatch);
		expect(onEvent).toHaveBeenCalledTimes(3);

		// Does not match any
		const unmatched: WorkspaceFileChangeEvent = {
			root: "/work/unrelated",
			changes: [{ path: "/work/unrelated/x.txt", type: "update" }],
		};
		harness.emit(unmatched);
		expect(onEvent).toHaveBeenCalledTimes(3);
		harness.dispose();
	});
});
