import { describe, it, expect, afterEach } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
	AssistantRuntimeProvider,
	useExternalStoreRuntime,
	type ThreadMessageLike,
} from "@assistant-ui/react";

// Desktop's fork runs this in a real browser, where the extras come from a
// real external-store runtime rather than a mocked @assistant-ui/store
// (pre-bundled deps can't be mocked from inside).
const extrasRef = { current: undefined as unknown };

const NO_MESSAGES: readonly ThreadMessageLike[] = [];
const onNew = async () => {};

const WithExtras = ({ children }: { children: ReactNode }) => {
	const runtime = useExternalStoreRuntime<ThreadMessageLike>({
		messages: NO_MESSAGES,
		convertMessage: (message) => message,
		onNew,
		...(extrasRef.current !== undefined ? { extras: extrasRef.current } : {}),
	});
	return createElement(AssistantRuntimeProvider, { runtime }, children);
};

import { openCodeExtras } from "./openCodeExtras";
import { EMPTY_OPENCODE_THREAD_STATE } from "./openCodeThreadState";
import {
	useOpenCodePermissions,
	useOpenCodeQuestions,
	useOpenCodeSession,
	useOpenCodeThreadState,
} from "./hooks";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

const renderHookValue = <T,>(useHook: () => T): T => {
	let captured!: T;
	const Probe = () => {
		captured = useHook();
		return null;
	};
	const container = document.createElement("div");
	root = createRoot(container);
	act(() => {
		root!.render(createElement(WithExtras, null, createElement(Probe)));
	});
	return captured;
};

const provideExtras = (over: Record<string, unknown>) =>
	openCodeExtras.provide({
		session: null,
		state: EMPTY_OPENCODE_THREAD_STATE,
		permissions: {},
		questions: {},
		fork: async () => "",
		revert: async () => {},
		unrevert: async () => {},
		cancel: async () => {},
		refresh: async () => {},
		replyToPermission: async () => {},
		replyToQuestion: async () => {},
		rejectQuestion: async () => {},
		...over,
	} as Parameters<typeof openCodeExtras.provide>[0]);

afterEach(() => {
	act(() => root?.unmount());
	root = undefined;
	extrasRef.current = undefined;
});

describe("react-opencode hooks", () => {
	it("reads session and thread state from the runtime extras", () => {
		const session = { id: "s1" };
		const state = { ...EMPTY_OPENCODE_THREAD_STATE, sessionId: "s1" };
		extrasRef.current = provideExtras({ session, state });

		expect(renderHookValue(() => useOpenCodeSession())).toBe(session);
		expect(renderHookValue(() => useOpenCodeThreadState())).toBe(state);
		expect(renderHookValue(() => useOpenCodeThreadState((s) => s.sessionId))).toBe("s1");
	});

	it("falls back when no OpenCode runtime is active", () => {
		extrasRef.current = undefined;

		expect(renderHookValue(() => useOpenCodeSession())).toBeNull();
		expect(renderHookValue(() => useOpenCodeThreadState())).toBe(EMPTY_OPENCODE_THREAD_STATE);
		expect(renderHookValue(() => useOpenCodePermissions()).pending).toEqual([]);
		expect(renderHookValue(() => useOpenCodeQuestions())).toEqual([]);
	});

	it("projects pending permissions and questions to arrays", () => {
		const permission = { id: "p1" };
		const question = { id: "q1" };
		extrasRef.current = provideExtras({
			permissions: { p1: permission },
			questions: { q1: question },
		});

		expect(renderHookValue(() => useOpenCodePermissions()).pending).toEqual([permission]);
		expect(renderHookValue(() => useOpenCodeQuestions())).toEqual([question]);
	});
});
