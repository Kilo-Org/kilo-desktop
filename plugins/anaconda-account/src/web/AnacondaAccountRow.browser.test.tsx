import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { SdkProvider } from "@kilo-desktop/sdk-react";
import { toast } from "@kilo-desktop/ui/components/sonner";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";

import { anacondaAccountContract, type AnacondaAccountSession } from "../contracts/schemas.js";
import { AnacondaAccountRow } from "./AnacondaAccountRow.js";
import { webRegister } from "./index.js";

vi.mock("@kilo-desktop/ui/components/sonner", () => ({
	Toaster: () => null,
	toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() },
}));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

const SIGNED_IN: AnacondaAccountSession = {
	status: "authenticated",
	user: { email: "dev@anaconda.com", username: "dev" },
};

function renderRow(
	options: {
		session?: AnacondaAccountSession | (() => Promise<AnacondaAccountSession>);
		login?: () => Promise<AnacondaAccountSession>;
		logout?: () => Promise<AnacondaAccountSession>;
		cancel?: () => Promise<undefined>;
		register?: boolean;
		/** `local-model-catalog` flag; on by default since the panel ships with the catalog. */
		catalogEnabled?: boolean;
	} = {},
) {
	let current: AnacondaAccountSession =
		typeof options.session === "object" ? options.session : { status: "anonymous" };
	const login = vi.fn(
		options.login ??
			(async () => {
				current = SIGNED_IN;
				return current;
			}),
	);
	const logout = vi.fn(
		options.logout ??
			(async () => {
				current = { status: "anonymous" };
				return current;
			}),
	);
	const resolveSession =
		typeof options.session === "function" ? options.session : async () => current;
	const refresh = vi.fn(resolveSession);
	const sdk = createFakeSdk({
		featureId: "anaconda-account",
		channels: anacondaAccountContract,
		handlers: {
			"session.get": resolveSession,
			"session.refresh": refresh,
			login,
			logout,
			"login.cancel": options.cancel ?? (async () => undefined),
		},
	});
	if (options.register !== false) webRegister(sdk);
	const flags = { "local-model-catalog": options.catalogEnabled ?? true };
	sdk.services.shellDelegates.featureFlags = {
		...sdk.services.shellDelegates.featureFlags,
		peek: () => flags,
		subscribe: (fn) => {
			fn(flags);
			return () => undefined;
		},
	};
	const system = createFakeFeatureSystem({ sdks: { "anaconda-account": sdk } });
	const view = render(
		<SdkProvider system={system}>
			<AnacondaAccountRow />
		</SdkProvider>,
	);
	return { screen: page.elementLocator(view.baseElement), login, logout, refresh };
}

describe("AnacondaAccountRow", () => {
	it("shows the signed-in email and signs out", async () => {
		const { screen, logout } = renderRow({ session: SIGNED_IN });

		await expect
			.element(screen.getByTestId("account-anaconda-email"))
			.toHaveTextContent("Signed in as dev@anaconda.com");
		await screen.getByTestId("account-anaconda-sign-out").click();

		await vi.waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
		await expect
			.element(screen.getByTestId("account-anaconda-status"))
			.toHaveTextContent("Not signed in.");
	});

	it("signs in from the not-signed-in state", async () => {
		const { screen, login } = renderRow();

		await expect
			.element(screen.getByTestId("account-anaconda-status"))
			.toHaveTextContent("Not signed in.");
		await screen.getByTestId("account-anaconda-sign-in").click();

		await vi.waitFor(() => expect(login).toHaveBeenCalledTimes(1));
		await expect
			.element(screen.getByTestId("account-anaconda-email"))
			.toHaveTextContent("Signed in as dev@anaconda.com");
	});

	it("re-checks the stored key when the row mounts", async () => {
		const { screen, refresh } = renderRow({ session: SIGNED_IN });

		await expect.element(screen.getByTestId("account-anaconda-email")).toBeVisible();
		expect(refresh).toHaveBeenCalledTimes(1);
	});

	it("shows the session error reason", async () => {
		const { screen } = renderRow({ session: { status: "error", reason: "Keyring unavailable" } });

		await expect
			.element(screen.getByTestId("account-anaconda-status"))
			.toHaveTextContent("Keyring unavailable");
	});

	it("stays loading until the session resolves", async () => {
		const { screen } = renderRow({ session: () => new Promise(() => {}) });

		await expect
			.element(screen.getByTestId("account-anaconda-row"))
			.toHaveAttribute("data-state", "loading");
	});

	it("offers Cancel while waiting for the browser and ends the sign-in quietly", async () => {
		let endLogin: (session: AnacondaAccountSession) => void = () => {};
		const cancel = vi.fn(async () => {
			endLogin({ status: "anonymous" });
			return undefined;
		});
		const { screen } = renderRow({
			login: () =>
				new Promise((resolve) => {
					endLogin = resolve;
				}),
			cancel,
		});

		await screen.getByTestId("account-anaconda-sign-in").click();
		await expect
			.element(screen.getByTestId("account-anaconda-sign-in"))
			.toHaveTextContent("Waiting for browser…");
		await screen.getByTestId("account-anaconda-cancel-sign-in").click();

		await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
		await expect
			.element(screen.getByTestId("account-anaconda-sign-in"))
			.toHaveTextContent("Sign in");
		expect(screen.getByTestId("account-anaconda-cancel-sign-in").query()).toBeNull();
		expect(toast.error).not.toHaveBeenCalled();
	});

	it("toasts a failed sign-in", async () => {
		const { screen } = renderRow({
			login: async () => ({ status: "error", reason: "Port 8000 is in use." }),
		});

		await screen.getByTestId("account-anaconda-sign-in").click();

		await vi.waitFor(() =>
			expect(toast.error).toHaveBeenCalledWith(
				"Could not sign in to Anaconda",
				expect.objectContaining({ description: "Port 8000 is in use." }),
			),
		);
	});

	it("renders nothing while the model catalog flag is off", async () => {
		const { screen } = renderRow({ catalogEnabled: false });

		expect(screen.getByTestId("account-anaconda-row").query()).toBeNull();
	});

	it("renders nothing when the account capability is not registered", async () => {
		const { screen } = renderRow({ register: false });

		expect(screen.getByTestId("account-anaconda-row").query()).toBeNull();
	});
});
