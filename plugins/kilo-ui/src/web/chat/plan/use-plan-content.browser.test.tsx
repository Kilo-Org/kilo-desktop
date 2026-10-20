import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type * as AssistantUiReact from "@assistant-ui/react";

import { ChatConnectionProvider } from "../connection/ChatConnectionContext.js";
import type { PlanProjection } from "./plan-projection.js";
import { usePlanContent } from "./use-plan-content.js";

const planFileOnDisk = vi.hoisted(() => ({ content: "" }));

vi.mock("../runtime/create-kilo-runtime-client.js", () => ({
	createKiloDirectoryClient: () => ({
		file: { read: async () => ({ data: { content: planFileOnDisk.content } }) },
	}),
}));

vi.mock("@assistant-ui/react", async (importOriginal) => ({
	...(await importOriginal<typeof AssistantUiReact>()),
	useAuiState: (selector: (state: unknown) => unknown) =>
		selector({
			thread: {
				extras: {
					session: { id: "session-plan", directory: "/workspace" },
					replyToQuestion: vi.fn(),
					rejectQuestion: vi.fn(),
					replyToPermission: vi.fn(),
				},
			},
		}),
}));

const CONNECTION = {
	baseUrl: "http://127.0.0.1:4096",
	username: "kilo",
	password: "kilo",
	version: "1.0.0",
	globalDirectory: "/kilo",
};

const onDiskOnly = (anchorCallId: string): PlanProjection => ({
	status: "ready",
	path: ".kilo/plans/ship.md",
	markdown: "",
	anchorCallId,
	hiddenCallIds: new Set([anchorCallId]),
});

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
	return (
		<QueryClientProvider client={queryClient}>
			<ChatConnectionProvider
				status={{
					isPending: false,
					isError: false,
					error: null,
					connection: CONNECTION,
					connectionPromise: Promise.resolve(CONNECTION),
				}}
			>
				{children}
			</ChatConnectionProvider>
		</QueryClientProvider>
	);
}

afterEach(cleanup);

describe("usePlanContent", () => {
	it("reads each plan revision from disk instead of reusing the previous revision", async () => {
		queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		planFileOnDisk.content = "# Ship v1";
		const { result, rerender } = renderHook((projection) => usePlanContent(projection), {
			initialProps: onDiskOnly("edit-v1"),
			wrapper,
		});
		await vi.waitFor(() => expect(result.current.markdown).toBe("# Ship v1"));

		planFileOnDisk.content = "# Ship v2";
		rerender(onDiskOnly("edit-v2"));

		await vi.waitFor(() => expect(result.current.markdown).toBe("# Ship v2"));
	});
});
