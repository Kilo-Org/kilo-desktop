import { afterEach, describe, expect, it, vi } from "vitest";

import {
	SIGN_IN_DECLINED_TOOL_MESSAGE,
	signInRequiredToolMessage,
} from "@kilo-desktop/feature-sdk";

import { descriptor, FakeToolProducer } from "../../test/fake-tool-producer.js";
import { AgentToolSignIn } from "./agent-tool-sign-in.js";
import { createExternalCatalogView, createKiloCatalogView } from "./catalog-view.js";
import { ToolCatalog } from "./tool-catalog.js";

const catalogs: ToolCatalog[] = [];

afterEach(() => {
	for (const catalog of catalogs.splice(0)) catalog.dispose();
});

function setup(signedIn: boolean) {
	const catalog = new ToolCatalog();
	catalogs.push(catalog);
	const producer = new FakeToolProducer();
	catalog.attach(producer.port);
	producer.publish([
		descriptor("environments_conda_envs_list", {
			requiresSignIn: true,
			signInScope: "environments",
		}),
		descriptor("notebook_open", { requiresSignIn: true, signInScope: "notebook" }),
		descriptor("todos_echo"),
	]);
	producer.respond = (call) => ({ ran: call.name });
	let isSignedIn = signedIn;
	const signIn = new AgentToolSignIn(async () => isSignedIn);
	return {
		producer,
		signIn,
		kilo: createKiloCatalogView(catalog, signIn),
		external: createExternalCatalogView(catalog, signIn),
		signInNow: () => {
			isSignedIn = true;
			signIn.signedIn();
		},
	};
}

const signal = new AbortController().signal;
const names = (view: ReturnType<typeof setup>["kilo"]) => view.listTools().map((tool) => tool.name);

describe("catalog views and sign-in", () => {
	it("refuses a signed-out Kilo call to a sign-in tool before it reaches the app", async () => {
		const { kilo, producer } = setup(false);

		await expect(kilo.callTool("environments_conda_envs_list", {}, signal)).resolves.toEqual({
			isError: true,
			content: [{ type: "text", text: signInRequiredToolMessage("kilo") }],
		});
		expect(producer.calls()).toEqual([]);
	});

	it("refuses an external AI app's signed-out call with external guidance", async () => {
		const { external } = setup(false);

		await expect(external.callTool("environments_conda_envs_list", {}, signal)).resolves.toEqual({
			isError: true,
			content: [{ type: "text", text: signInRequiredToolMessage("external") }],
		});
	});

	it("still serves tools that do not require sign-in while signed out", async () => {
		const { kilo } = setup(false);

		const result = await kilo.callTool("todos_echo", {}, signal);

		expect(result.isError).toBeUndefined();
	});

	it("routes a sign-in tool's call to the app when the user is signed in", async () => {
		const { kilo, producer } = setup(true);

		const result = await kilo.callTool("environments_conda_envs_list", {}, signal);

		expect(result.isError).toBeUndefined();
		expect(producer.calls().map((call) => call.name)).toEqual(["environments_conda_envs_list"]);
	});

	it("does not advertise sign-in metadata to MCP clients", () => {
		const { kilo } = setup(false);

		expect(kilo.listTools()[0]).not.toHaveProperty("requiresSignIn");
		expect(kilo.listTools()[0]).not.toHaveProperty("signInScope");
	});

	it("withdraws a feature's sign-in tools and refuses them as declined after the user declines", async () => {
		const { kilo, external, signIn } = setup(false);
		const changed = vi.fn();
		kilo.subscribe(changed);
		expect(names(kilo)).toEqual(["environments_conda_envs_list", "notebook_open", "todos_echo"]);

		signIn.decline("environments");

		expect(changed).toHaveBeenCalledOnce();
		expect(names(kilo)).toEqual(["notebook_open", "todos_echo"]);
		expect(names(external)).toEqual(["notebook_open", "todos_echo"]);
		await expect(kilo.callTool("environments_conda_envs_list", {}, signal)).resolves.toEqual({
			isError: true,
			content: [{ type: "text", text: SIGN_IN_DECLINED_TOOL_MESSAGE }],
		});
	});

	it("keeps asking for sign-in for other features after one feature is declined", async () => {
		const { kilo, signIn } = setup(false);

		signIn.decline("notebook");

		await expect(kilo.callTool("environments_conda_envs_list", {}, signal)).resolves.toEqual({
			isError: true,
			content: [{ type: "text", text: signInRequiredToolMessage("kilo") }],
		});
		await expect(kilo.callTool("notebook_open", {}, signal)).resolves.toEqual({
			isError: true,
			content: [{ type: "text", text: SIGN_IN_DECLINED_TOOL_MESSAGE }],
		});
	});

	it("offers sign-in tools again once the user signs in after declining", async () => {
		const { kilo, signIn, signInNow } = setup(false);
		signIn.decline("environments");
		signIn.decline("notebook");
		const changed = vi.fn();
		kilo.subscribe(changed);

		signInNow();

		expect(changed).toHaveBeenCalledOnce();
		expect(names(kilo)).toEqual(["environments_conda_envs_list", "notebook_open", "todos_echo"]);
		const result = await kilo.callTool("environments_conda_envs_list", {}, signal);
		expect(result.isError).toBeUndefined();
	});
});
