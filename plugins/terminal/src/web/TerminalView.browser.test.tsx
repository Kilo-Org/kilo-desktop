import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import {
	createFakeFeatureSystem,
	createFakeSdk,
	createFakeTheme,
} from "@anaconda-agentic-desktop/testing";
import type { SdkTheme, TerminalPalette } from "@anaconda-agentic-desktop/feature-sdk";
import { terminalFrameConnectSchema } from "../contracts/frame.js";

import {
	TERMINAL_PROTOCOL_VERSION,
	TERMINAL_SESSION_EXITED,
	terminalContract,
} from "../contracts/session.js";
import { TerminalLifecycleProvider } from "./TerminalLifecycleProvider.js";
import { TerminalView, type TerminalViewProps } from "./TerminalView.js";

afterEach(() => {
	cleanup();
	vi.unstubAllEnvs();
	document.documentElement.style.removeProperty("--app-scrollbar-thumb");
	document.documentElement.style.removeProperty("--app-scrollbar-thumb-hover");
});

function renderView(
	workspaceFolders: readonly { path: string; isPrimary: boolean }[] = [],
	props: Partial<TerminalViewProps> = {},
	options: {
		readonly openPort?: (featureId: string, channel: string, args?: unknown) => unknown;
		readonly ordinal?: number | null;
		readonly theme?: Partial<SdkTheme>;
	} = {},
) {
	const close = vi.fn(async () => undefined);
	const closeTab = vi.fn();
	const updateTab = vi.fn();
	let lifecycle: { onClose?: () => Promise<void> } | undefined;
	const registerTabLifecycle = vi.fn(
		(_sessionId: string, _instanceId: string, nextLifecycle: { onClose?: () => Promise<void> }) => {
			lifecycle = nextLifecycle;
			return vi.fn();
		},
	);
	const sdk = createFakeSdk({
		featureId: "terminal",
		channels: terminalContract,
		handlers: { close },
		...(options.theme ? { theme: options.theme } : {}),
	});
	if (options.openPort) sdk.services.openPort = options.openPort;
	const system = createFakeFeatureSystem({ sdks: { terminal: sdk } });
	system.getSdk("kilo-ui").plugins.expose("chatRightPanel", {
		registerTabLifecycle,
		closeTab,
		listTabs: () => [
			{
				instanceId: "terminal-1",
				ordinal: options.ordinal === undefined ? 1 : options.ordinal,
			},
		],
		updateTab,
	});
	const result = render(
		<SdkProvider system={system}>
			<TerminalLifecycleProvider>
				<TerminalView
					sessionId={props.sessionId ?? "chat-1"}
					instanceId={props.instanceId ?? "terminal-1"}
					title={props.title ?? "Terminal 1"}
					workspaceFolders={workspaceFolders}
					{...(props.metadata ? { metadata: props.metadata } : {})}
				/>
			</TerminalLifecycleProvider>
		</SdkProvider>,
	);
	return {
		...result,
		close,
		closeTab,
		registerTabLifecycle,
		system,
		updateTab,
		getLifecycle: () => lifecycle,
	};
}

describe("TerminalView", () => {
	it("renders a terminal frame without a workspace so the backend can use the user home", async () => {
		vi.stubEnv("VITE_TERMINAL_ORIGIN", "https://terminal.test");
		renderView();
		await expect.element(page.getByTestId("terminal-frame")).toBeVisible();
	});

	it("registers explicit close cleanup and removes it on unmount", async () => {
		const { registerTabLifecycle, updateTab, close, getLifecycle, unmount } = renderView([
			{ path: "/workspace", isPrimary: true },
		]);
		await vi.waitFor(() => expect(registerTabLifecycle).toHaveBeenCalledOnce());
		expect(updateTab).toHaveBeenCalledWith("chat-1", "terminal-1", {
			title: "Terminal 1",
			metadata: { terminalSessionId: "chat-1" },
		});
		const lifecycle = getLifecycle();
		if (!lifecycle?.onClose) throw new Error("Expected terminal close lifecycle");
		await lifecycle.onClose();
		expect(close).toHaveBeenCalledWith({
			sessionId: "chat-1",
			terminalId: "terminal-1",
			deleteHistory: true,
		});
		const unregister = registerTabLifecycle.mock.results[0]!.value;
		unmount();
		expect(unregister).toHaveBeenCalledOnce();
	});

	it("keeps the original backend session when Kilo replaces its local chat id", async () => {
		const { registerTabLifecycle, close, getLifecycle } = renderView([], {
			sessionId: "remote-chat-1",
			metadata: { terminalSessionId: "local-chat-1" },
		});
		await vi.waitFor(() => expect(registerTabLifecycle).toHaveBeenCalledOnce());
		const lifecycle = getLifecycle();
		if (!lifecycle?.onClose) throw new Error("Expected terminal close lifecycle");
		await lifecycle.onClose();
		expect(close).toHaveBeenCalledWith({
			sessionId: "local-chat-1",
			terminalId: "terminal-1",
			deleteHistory: true,
		});
	});

	it("deletes an exited terminal session and closes its host tab", async () => {
		const { close, closeTab, registerTabLifecycle, system } = renderView([], {
			sessionId: "remote-chat-1",
			metadata: { terminalSessionId: "local-chat-1" },
		});
		await vi.waitFor(() => expect(registerTabLifecycle).toHaveBeenCalledOnce());

		system.getSdk("terminal").events.emit(TERMINAL_SESSION_EXITED, {
			sessionId: "local-chat-1",
			terminalId: "terminal-1",
		});

		await vi.waitFor(() => expect(closeTab).toHaveBeenCalledWith("remote-chat-1", "terminal-1"));
		expect(close).toHaveBeenCalledWith({
			sessionId: "local-chat-1",
			terminalId: "terminal-1",
			deleteHistory: true,
		});

		system.getSdk("terminal").events.emit(TERMINAL_SESSION_EXITED, {
			sessionId: "local-chat-1",
			terminalId: "terminal-1",
		});
		expect(close).toHaveBeenCalledOnce();
	});

	it("connects the trusted frame with the stable session and updates its process label", async () => {
		vi.stubEnv("VITE_TERMINAL_ORIGIN", "https://terminal.test");
		document.documentElement.style.setProperty("--app-scrollbar-thumb", "#111111");
		document.documentElement.style.setProperty("--app-scrollbar-thumb-hover", "#222222");
		const terminalPort = { close: vi.fn() } as unknown as MessagePort;
		const openPort = vi.fn(() => terminalPort);
		const { updateTab } = renderView(
			[{ path: "/workspace", isPrimary: true }],
			{
				sessionId: "remote-chat-1",
				metadata: { terminalSessionId: "local-chat-1" },
				title: "Shell",
			},
			{ openPort, ordinal: null },
		);
		const frame = document.querySelector<HTMLIFrameElement>('[data-qa-id="terminal-frame"]');
		if (!frame?.contentWindow) throw new Error("Expected terminal iframe window");
		vi.spyOn(frame.contentWindow, "postMessage").mockImplementation(() => undefined);

		window.dispatchEvent(
			new MessageEvent("message", {
				origin: "https://terminal.test",
				source: frame.contentWindow,
				data: { type: "terminal:ready", protocolVersion: TERMINAL_PROTOCOL_VERSION },
			}),
		);
		await vi.waitFor(() => expect(openPort).toHaveBeenCalledOnce());
		expect(openPort).toHaveBeenCalledWith("terminal", "session", {
			protocolVersion: TERMINAL_PROTOCOL_VERSION,
			sessionId: "local-chat-1",
			terminalId: "terminal-1",
			cwd: "/workspace",
			cols: 120,
			rows: 30,
			initialLabel: "Shell",
		});

		window.dispatchEvent(
			new MessageEvent("message", {
				origin: "https://terminal.test",
				source: frame.contentWindow,
				data: {
					type: "terminal:label",
					protocolVersion: TERMINAL_PROTOCOL_VERSION,
					label: "vite",
				},
			}),
		);
		await vi.waitFor(() =>
			expect(updateTab).toHaveBeenCalledWith("remote-chat-1", "terminal-1", { title: "vite" }),
		);
	});

	it.each([
		{ sessionId: "chat-1", instanceId: "terminal-2" },
		{ sessionId: "chat-2", instanceId: "terminal-1" },
	])(
		"reuses the PTY on a same-mode theme reconnect and uses the latest workspace for $sessionId/$instanceId",
		async (identity) => {
			vi.stubEnv("VITE_TERMINAL_ORIGIN", "https://terminal.test");
			const theme = createFakeTheme();
			const ansiRed = "#ff5555";
			const terminalPort = { close: vi.fn() } as unknown as MessagePort;
			const openPort = vi.fn(
				(_featureId: string, _channel: string, _args?: unknown) => terminalPort,
			);
			const view = renderView(
				[{ path: "/workspace-one", isPrimary: true }],
				{},
				{ openPort, theme },
			);
			function connectFrame() {
				const frame = document.querySelector<HTMLIFrameElement>('[data-qa-id="terminal-frame"]');
				if (!frame?.contentWindow) throw new Error("Expected terminal iframe window");
				const postMessage = vi
					.spyOn(frame.contentWindow, "postMessage")
					.mockImplementation(() => undefined);
				window.dispatchEvent(
					new MessageEvent("message", {
						origin: "https://terminal.test",
						source: frame.contentWindow,
						data: { type: "terminal:ready", protocolVersion: TERMINAL_PROTOCOL_VERSION },
					}),
				);
				return {
					frame,
					connect: terminalFrameConnectSchema.parse(postMessage.mock.calls.at(-1)?.[0]),
				};
			}
			function changeWorkspace(nextIdentity = { sessionId: "chat-1", instanceId: "terminal-1" }) {
				view.rerender(
					<SdkProvider system={view.system}>
						<TerminalLifecycleProvider>
							<TerminalView
								{...nextIdentity}
								title="Terminal 1"
								workspaceFolders={[{ path: "/workspace-two", isPrimary: true }]}
							/>
						</TerminalLifecycleProvider>
					</SdkProvider>,
				);
			}
			const { frame } = connectFrame();
			expect(openPort.mock.lastCall?.[2]).toMatchObject({ cwd: "/workspace-one" });
			changeWorkspace();
			expect(document.querySelector('[data-qa-id="terminal-frame"]')).toBe(frame);
			await act(async () =>
				theme.setAppearance({
					...theme.appearance(),
					themeId: "kilo",
					terminal: { red: ansiRed } as TerminalPalette,
					shiki: "github-light",
				}),
			);
			const { frame: reconnectedFrame, connect } = connectFrame();
			expect(reconnectedFrame).not.toBe(frame);
			expect(connect.theme.red).toBe(ansiRed);
			expect(openPort.mock.lastCall?.[2]).toMatchObject({
				sessionId: "chat-1",
				terminalId: "terminal-1",
			});
			expect(openPort.mock.lastCall?.[2]).not.toHaveProperty("cwd");

			changeWorkspace(identity);
			expect(connectFrame().frame).not.toBe(reconnectedFrame);
			expect(openPort.mock.lastCall?.[2]).toMatchObject({
				sessionId: identity.sessionId,
				terminalId: identity.instanceId,
				cwd: "/workspace-two",
			});
		},
	);

	it("shows a connection error when no host port transport is available", async () => {
		vi.stubEnv("VITE_TERMINAL_ORIGIN", "https://terminal.test");
		renderView();
		const frame = document.querySelector<HTMLIFrameElement>('[data-qa-id="terminal-frame"]');
		if (!frame?.contentWindow) throw new Error("Expected terminal iframe window");

		window.dispatchEvent(
			new MessageEvent("message", {
				origin: "https://terminal.test",
				source: frame.contentWindow,
				data: { type: "terminal:ready", protocolVersion: TERMINAL_PROTOCOL_VERSION },
			}),
		);
		await expect.element(page.getByTestId("terminal-connection-error")).toBeVisible();
	});
});
