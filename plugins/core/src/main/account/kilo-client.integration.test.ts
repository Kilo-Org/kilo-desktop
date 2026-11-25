import { afterEach, describe, expect, it } from "vitest";

import {
	kilo2Executable,
	startKilo2,
	startStandInKiloApi,
	type Kilo2,
	type StandInKiloApi,
} from "../../testing/kilo2.js";
import { createKiloAccountClient } from "./kilo-client.js";

describe.skipIf(!kilo2Executable)("the Kilo account in the bundled kilo2", () => {
	let kilo: Kilo2 | undefined;
	let api: StandInKiloApi | undefined;

	afterEach(async () => {
		await kilo?.stop();
		await api?.stop();
		kilo = undefined;
		api = undefined;
	});

	it("signs in with a device code, reads the profile, switches organisation and signs out", async () => {
		api = await startStandInKiloApi();
		kilo = await startKilo2({ apiUrl: api.url });
		const account = createKiloAccountClient(kilo.connection);

		await expect(account.authStatus()).resolves.toMatchObject({ authenticated: false });

		const started = await account.authorize();
		expect(started.url).toBe(`${api.url}/device-auth?code=ABCD-1234`);
		api.approve();
		await account.callback(new AbortController().signal);

		await expect(account.authStatus()).resolves.toMatchObject({ authenticated: true });
		const profile = await account.profile();
		expect(profile).toMatchObject({
			email: "ada@example.com",
			name: "Ada Lovelace",
			organizations: [{ id: "org-1", name: "Analytical Engines" }],
			balance: { balance: 12.5 },
		});

		await account.setOrganization("org-1");
		await expect(account.profile()).resolves.toMatchObject({ organizationId: "org-1" });
		await account.setOrganization(null);
		await expect(account.profile()).resolves.toMatchObject({ organizationId: null });

		await account.signOut();
		await expect(account.authStatus()).resolves.toMatchObject({ authenticated: false });
	});

	it("stops waiting for approval when sign-in is cancelled", async () => {
		api = await startStandInKiloApi();
		kilo = await startKilo2({ apiUrl: api.url });
		const account = createKiloAccountClient(kilo.connection);
		await account.authorize();
		const controller = new AbortController();

		const waiting = account.callback(controller.signal);
		controller.abort(new Error("cancelled"));

		await expect(waiting).rejects.toThrow("cancelled");
	});
});
