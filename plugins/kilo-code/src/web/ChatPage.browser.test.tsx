import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import type { ChannelHandlerMap } from "@anaconda-agentic-desktop/feature-sdk";
import { FeatureError } from "@anaconda-agentic-desktop/feature-sdk";
import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";

import type * as AssistantUiReact from "@assistant-ui/react";

import { kiloCodeContract, type KiloWorkspaceConnection } from "../contracts/schemas.js";
import { ChatPage } from "./ChatPage.js";

vi.mock("@assistant-ui/react", async (importOriginal) => {
	const actual = await importOriginal<typeof AssistantUiReact>();
	return {
		...actual,
		AssistantRuntimeProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
	};
});

vi.mock("./runtime/use-kilo-runtime.js", () => ({
	useKiloRuntime: () => ({}),
}));

vi.mock("./components/assistant-ui/thread.js", () => ({
	Thread: () => <div data-qa-id="kilo-chat-thread-mock">Thread</div>,
}));

type KiloHandlers = ChannelHandlerMap<typeof kiloCodeContract>;

const connection: KiloWorkspaceConnection = {
	baseUrl: "http://127.0.0.1:4321",
	username: "kilo",
	password: "secret",
	version: "7.4.20",
	directory: "/tmp/unscoped",
};

function testClient(): QueryClient {
	return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderChatPage(handlers: Partial<KiloHandlers>) {
	const sdk = createFakeSdk({
		featureId: "kilo-code",
		channels: kiloCodeContract,
		handlers: {
			"server.getConnection": async () => connection,
			"server.restart": async () => connection,
			"server.status": async () =>
				({
					status: "ready",
					baseUrl: connection.baseUrl,
					version: connection.version,
				}) as const,
			...handlers,
		},
	});
	const system = createFakeFeatureSystem({ sdks: { "kilo-code": sdk } });
	return render(
		<SdkProvider system={system}>
			<QueryClientProvider client={testClient()}>
				<ChatPage />
			</QueryClientProvider>
		</SdkProvider>,
	);
}

afterEach(() => {
	cleanup();
});

describe("ChatPage", () => {
	it("renders the thread while the connection is still pending", async () => {
		const { baseElement } = renderChatPage({
			"server.getConnection": () => new Promise<KiloWorkspaceConnection>(() => undefined),
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("kilo-chat-thread-mock")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-chat-loading")).not.toBeInTheDocument();
	});

	it("shows an error banner when the connection fails but keeps the thread mounted", async () => {
		const { baseElement } = renderChatPage({
			"server.getConnection": async () => {
				throw new FeatureError("Kilo Code requires the desktop app.", "BUSINESS");
			},
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("kilo-chat-error")).toBeVisible();
		await expect
			.element(screen.getByText(/Could not connect to Kilo: Kilo Code requires the desktop app/))
			.toBeVisible();
		await expect.element(screen.getByTestId("kilo-chat-thread-mock")).toBeVisible();
	});

	it("renders the thread without eagerly initializing a remote session", async () => {
		const { baseElement } = renderChatPage({});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("kilo-chat-thread-mock")).toBeVisible();
	});
});
