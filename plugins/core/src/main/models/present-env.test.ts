import { describe, expect, it } from "vitest";

import { presentEnvNames } from "./present-env";

describe("presentEnvNames", () => {
	it("returns only candidate names that have a non-empty value", () => {
		expect(
			presentEnvNames(
				[
					"AWS_ACCESS_KEY_ID",
					"AWS_SECRET_ACCESS_KEY",
					"AWS_REGION",
					"AWS_BEARER_TOKEN_BEDROCK",
					"AWS_PROFILE",
					"AWS_SSO_START_URL",
				],
				{
					AWS_PROFILE: "Sandbox-621741996708",
					AWS_SSO_START_URL: "https://example.awsapps.com/start",
					AWS_ACCESS_KEY_ID: "",
					AWS_REGION: "  ",
				},
			),
		).toEqual(["AWS_PROFILE", "AWS_SSO_START_URL"]);
	});

	it("preserves candidate order and ignores unknown env keys", () => {
		expect(
			presentEnvNames(["GROQ_API_KEY", "AWS_PROFILE"], {
				AWS_PROFILE: "default",
				UNRELATED: "1",
			}),
		).toEqual(["AWS_PROFILE"]);
	});
});
