import { useEffect, useState } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { KiloServerStatus } from "@anaconda-agentic-desktop/contracts";
import { createLinkedFakeSdkPair } from "@anaconda-agentic-desktop/testing";

import { kiloCodeBrowserRegister } from "./browserRegister";

describe("kiloCodeBrowserRegister", () => {
	it("renders a desktop-required state and rejects process lifecycle operations", async () => {
		const { mainSdk, rendererSdk } = createLinkedFakeSdkPair({ featureId: "kilo-code" });
		kiloCodeBrowserRegister(mainSdk);

		function StatusProbe() {
			const [status, setStatus] = useState<KiloServerStatus>();
			useEffect(() => {
				void rendererSdk
					.invoke("server.status")
					.then((value) => setStatus(value as KiloServerStatus));
			}, []);
			return <output data-qa-id="kilo-code-browser-status">{status?.status}</output>;
		}

		render(<StatusProbe />);
		expect(await screen.findByText("unavailable")).toBeVisible();
		await expect(rendererSdk.invoke("server.restart")).rejects.toMatchObject({
			code: "BUSINESS",
			message: "Kilo Code requires the desktop app.",
		});
		rendererSdk.destroy();
		mainSdk.dispose();
	});
});
