import { cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { bootEnvironmentsHost } from "../../../test/environments-host";
import {
	useAnacondaAccountKey,
	useRefreshOnAnacondaAccountChange,
} from "./use-anaconda-account-key";

afterEach(cleanup);

async function renderInHost(hook: () => unknown) {
	const host = await bootEnvironmentsHost({ anaconda: { signIn: () => ({ ok: true }) } });
	const view = renderHook(hook, {
		wrapper: ({ children }: { children: ReactNode }) => host.wrap(children),
	});
	return { host, ...view };
}

describe("the Anaconda account key", () => {
	it("follows sign-in and a switch of account", async () => {
		const { host, result } = await renderInHost(() => useAnacondaAccountKey());
		await vi.waitFor(() => expect(result.current).toBe("anonymous"));

		await host.setAnacondaSession({ status: "authenticated", user: { userId: "user-1" } });
		await vi.waitFor(() => expect(result.current).toBe("authenticated:user-1"));

		await host.setAnacondaSession({ status: "authenticated", user: { username: "grace" } });
		await vi.waitFor(() => expect(result.current).toBe("authenticated:grace"));
	});

	it("is null without kilo.anaconda", async () => {
		const host = await bootEnvironmentsHost();
		const { result } = renderHook(() => useAnacondaAccountKey(), {
			wrapper: ({ children }: { children: ReactNode }) => host.wrap(children),
		});

		expect(result.current).toBeNull();
	});
});

describe("useRefreshOnAnacondaAccountChange", () => {
	it("refreshes the account-filtered reads when the account changes, not when it first loads", async () => {
		const { host } = await renderInHost(() => useRefreshOnAnacondaAccountChange());
		const invalidate = vi.spyOn(host.queryClient, "invalidateQueries");
		await host.main.flush();
		expect(invalidate).not.toHaveBeenCalled();

		await host.setAnacondaSession({ status: "authenticated", user: { userId: "user-1" } });

		await vi.waitFor(() =>
			expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
				["environments", "findRepodata"],
				["environments", "previewInstall"],
				["environments", "previewUpdate"],
				["environments", "channelPolicies"],
			]),
		);
	});
});
