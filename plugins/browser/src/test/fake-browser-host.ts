// The desktop host's embedded browser, faked: guests are numbers the test
// attaches; each has a controller of spies and can emit state as the host's
// lifecycle listeners would (synchronously once while attaching).
import { vi, type Mock } from "vitest";

import type {
	BrowserHost,
	GuestController,
	GuestState,
	LocalFileAuthorizer,
} from "../main/browser-host.js";

type Spied<T> = {
	readonly [K in keyof T]: T[K] extends (...args: infer A) => infer R
		? Mock<(...args: A) => R>
		: T[K];
};

export interface FakeGuest {
	readonly controller: Spied<GuestController>;
	emit(state: Partial<GuestState>): void;
}

export function guestState(webContentsId: number, state: Partial<GuestState> = {}): GuestState {
	return {
		webContentsId,
		url: "",
		title: "",
		faviconUrl: "",
		loading: false,
		canGoBack: false,
		canGoForward: false,
		zoomFactor: 1,
		...state,
	};
}

export function createFakeBrowserHost() {
	const guests = new Map<number, FakeGuest>();
	let authorize: LocalFileAuthorizer | undefined;
	const refusals: string[] = [];
	const host = {
		partition: "persist:test-browser",
		initialize: vi.fn(),
		serveLocalFiles: vi.fn((next: LocalFileAuthorizer) => {
			authorize = next;
		}),
		attach: vi.fn((webContentsId: number, onState: (state: GuestState) => void) => {
			const refusal = refusals.shift();
			if (refusal) throw new Error(refusal);
			const controller = {
				webContentsId,
				navigate: vi.fn(async (_url: string) => undefined),
				goBack: vi.fn(),
				goForward: vi.fn(),
				reload: vi.fn(),
				hardReload: vi.fn(),
				zoomIn: vi.fn(),
				zoomOut: vi.fn(),
				resetZoom: vi.fn(),
				openDevTools: vi.fn(),
				dispose: vi.fn(),
			};
			let current = guestState(webContentsId);
			const guest: FakeGuest = {
				controller,
				emit: (state) => {
					current = { ...current, ...state };
					onState(current);
				},
			};
			guests.set(webContentsId, guest);
			onState(current);
			return controller;
		}),
	} satisfies BrowserHost;
	return {
		host,
		guest: (webContentsId: number) => {
			const guest = guests.get(webContentsId);
			if (!guest) throw new Error(`Guest ${webContentsId} was never attached.`);
			return guest;
		},
		authorize: (path: string) => {
			if (!authorize) throw new Error("No local-file authorizer was installed.");
			return authorize(path);
		},
		/** Refuses the next `times` attaches. */
		refuseAttach: (reason: string, times = 1) => {
			refusals.push(...Array.from({ length: times }, () => reason));
		},
	};
}

export type FakeBrowserHost = ReturnType<typeof createFakeBrowserHost>;
