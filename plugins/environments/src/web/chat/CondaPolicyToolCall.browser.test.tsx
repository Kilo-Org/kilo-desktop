import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { RenderContribution } from "@kilo-desktop/kernel/web";
import type { AnacondaAccountResult } from "@kilo-desktop/plugin-anaconda/contracts";
import chatManifest from "@kilo-desktop/plugin-chat/plugin.json";
import {
	CHAT_DEFINITIONS,
	ToolRenderer,
	type ToolCallProps,
	type ToolRendererImplementation,
} from "@kilo-desktop/plugin-chat/contracts";

import { formatEnvironmentsErrorMessage, type PolicyNotice } from "../../contracts/common";
import { bootEnvironmentsHost, type EnvironmentsHostOptions } from "../../test/environments-host";
import { environmentsWebEntry } from "../index";

afterEach(cleanup);

const chat = { manifest: chatManifest, definitions: CHAT_DEFINITIONS };

const BLOCKED: PolicyNotice = {
	blocked: [
		{
			package: "pillow",
			version: "8.4.0",
			channel: "defaults",
			org: "acme",
			policy: "organization_policy",
			policyId: null,
			reason: "Known vulnerabilities",
		},
	],
};

const BLOCKED_MESSAGE = formatEnvironmentsErrorMessage(
	"POLICY_BLOCKED",
	"pillow 8.4.0 is blocked by organization_policy in acme: Known vulnerabilities\n\nsolver output",
	BLOCKED,
);

const install: ToolCallProps = {
	toolCallId: "call_install",
	toolName: "desktop_environments_conda_packages_install",
	args: { name: "dev", packages: ["pillow=8.4.0"] },
	argsText: "{}",
	status: { type: "complete" },
};

const failedInstall = (result: unknown): ToolCallProps => ({
	...install,
	result,
	isError: true,
	status: { type: "incomplete", reason: "error" },
});

function Original({ toolName }: ToolCallProps) {
	return <p data-qa-id="chat-default-row">{toolName}</p>;
}

async function renderCall(call: ToolCallProps, options: EnvironmentsHostOptions = {}) {
	const host = await bootEnvironmentsHost({
		webEntry: environmentsWebEntry,
		plugins: [chat],
		...options,
	});
	const contribution = host.renderer.extensions
		.list(ToolRenderer)
		.find((candidate) => candidate.key === "kilo.environments/conda-policy")!;
	const implementation = contribution.implementation as ToolRendererImplementation;
	host.render(
		<RenderContribution
			contribution={contribution}
			props={{ ...call, Original }}
			select={(renderer: ToolRendererImplementation) => renderer.component}
		/>,
	);
	return { host, isStandalone: implementation.isStandalone!(call) };
}

const card = () => page.getByTestId("environments-chat-policy-card");

describe("conda policy failures in the chat", () => {
	it("shows a policy block as a card with each blocked package, the default row one click away", async () => {
		const { isStandalone } = await renderCall(failedInstall(BLOCKED_MESSAGE));

		await expect.element(card()).toMatchTextContent(/^Blocked by your organization's policy/);
		await expect
			.element(page.getByTestId("environments-policy-blocked-package"))
			.toHaveTextContent(
				"pillow 8.4.0Blocked by the policy “organization_policy” in acmeReason: Known vulnerabilities",
			);
		await expect.element(page.getByTestId("chat-default-row")).not.toBeInTheDocument();
		expect(isStandalone).toBe(true);

		await page.getByTestId("environments-chat-policy-card-details").click();
		await expect.element(page.getByTestId("chat-default-row")).toBeVisible();
		await expect.element(card()).toMatchTextContent(/solver output$/);
	});

	it("explains a solve failure the policy may be behind", async () => {
		const { isStandalone } = await renderCall(
			failedInstall(
				formatEnvironmentsErrorMessage("SOLVE_FAILED", "nothing provides holoviews", {
					policyNote: true,
				}),
			),
		);

		await expect
			.element(card())
			.toMatchTextContent(/^Dependency conflict under your organization's policy/);
		await expect.element(page.getByTestId("environments-policy-note")).toBeVisible();
		expect(isStandalone).toBe(true);
	});

	it("signs in to Anaconda from the card, then says to ask the agent again", async () => {
		const signIn = vi.fn((): AnacondaAccountResult => ({ ok: true }));
		const { isStandalone } = await renderCall(
			failedInstall({
				content: [
					{
						type: "text",
						text: formatEnvironmentsErrorMessage("NOT_SIGNED_IN", undefined, {
							refused: { org: null, channel: "acme/main" },
						}),
					},
				],
			}),
			{ anaconda: { signIn } },
		);

		await expect.element(card()).toMatchTextContent(/acme\/main needs an Anaconda account/);
		await expect
			.element(page.getByTestId("environments-chat-policy-retry-hint"))
			.toHaveTextContent("After you sign in, ask the agent to try again.");
		expect(isStandalone).toBe(true);

		await page.getByTestId("environments-anaconda-sign-in").click();

		expect(signIn).toHaveBeenCalledOnce();
		await expect.element(page.getByTestId("environments-anaconda-signed-in")).toBeVisible();
		await expect
			.element(page.getByTestId("environments-chat-policy-retry-hint"))
			.toHaveTextContent("Ask the agent to try again.");
	});

	it("leaves the sign-in to the message without kilo.anaconda", async () => {
		await renderCall(failedInstall("CHANNEL_ACCESS_DENIED: 403"));

		await expect.element(card()).toMatchTextContent(/^Sign in to AnacondaAnaconda refused access/);
		await expect.element(page.getByTestId("environments-anaconda-sign-in")).not.toBeInTheDocument();
		await expect
			.element(page.getByTestId("environments-chat-policy-retry-hint"))
			.not.toBeInTheDocument();
	});

	it("keeps the default row, inside the fold, for other failures and for successes", async () => {
		const other = await renderCall(failedInstall("PACKAGE_NOT_FOUND: nope"));
		await expect.element(page.getByTestId("chat-default-row")).toBeVisible();
		await expect.element(card()).not.toBeInTheDocument();
		expect(other.isStandalone).toBe(false);

		const done = await renderCall({ ...install, result: BLOCKED_MESSAGE });
		await expect.element(page.getByTestId("chat-default-row")).toBeVisible();
		await expect.element(card()).not.toBeInTheDocument();
		expect(done.isStandalone).toBe(false);
	});
});
