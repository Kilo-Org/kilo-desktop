import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@kilo-desktop/ui/components/sonner", () => ({
	toast: {
		error: vi.fn(),
		success: vi.fn(),
	},
}));

vi.mock("./environments-error-message", () => ({
	friendlyEnvironmentsError: vi.fn((_reason: unknown, fallback: string) => fallback),
}));

import { toast } from "@kilo-desktop/ui/components/sonner";

import { friendlyEnvironmentsError } from "./environments-error-message";
import {
	backupEnvironmentJob,
	createEnvironmentJob,
	deleteEnvironmentJob,
	importEnvironmentJob,
	installPackagesJob,
	jobToastOptions,
	showJobError,
	showJobSuccess,
	updatePackagesJob,
} from "./environments-toasts";

beforeEach(() => {
	vi.clearAllMocks();
});

describe("jobToastOptions", () => {
	it("maps the job copy onto toast.promise loading, success and error states", () => {
		const options = jobToastOptions(createEnvironmentJob("my-env"));

		expect(options.loading).toBe("Creating my-env…");
		expect(options.description).toBe("Resolving dependencies and installing packages.");
		expect(options.success()).toEqual({
			message: "my-env created",
			description: "The environment is ready to use.",
		});
	});

	it("keeps failures on screen with the friendly error as the description", () => {
		const options = jobToastOptions(deleteEnvironmentJob("my-env"));

		expect(options.error("boom")).toEqual({
			message: "Could not delete my-env",
			description: "Could not delete the environment.",
			duration: Infinity,
		});
		expect(friendlyEnvironmentsError).toHaveBeenCalledWith(
			"boom",
			"Could not delete the environment.",
		);
	});

	it("continues an existing toast when given an id", () => {
		expect(jobToastOptions(updatePackagesJob("dev", 2), "t-1")).toMatchObject({ id: "t-1" });
		expect(jobToastOptions(updatePackagesJob("dev", 2))).not.toHaveProperty("id");
	});
});

describe("job copy", () => {
	it("pluralises package counts and names the environment", () => {
		expect(installPackagesJob("dev", 1)).toMatchObject({
			loading: "Installing 1 package…",
			successDescription: "1 package installed in dev.",
			errorTitle: "Could not install packages",
		});
		expect(updatePackagesJob("dev", 3)).toMatchObject({
			loading: "Updating 3 packages…",
			successDescription: "3 packages updated in dev.",
			errorTitle: "Could not update packages",
		});
	});

	it("uses 'Could not …' titles for every failure", () => {
		for (const copy of [
			createEnvironmentJob("a"),
			importEnvironmentJob("a"),
			deleteEnvironmentJob("a"),
			installPackagesJob("a", 1),
			updatePackagesJob("a", 1),
			backupEnvironmentJob("a", "a-backup"),
		]) {
			expect(copy.errorTitle).toMatch(/^Could not /);
		}
	});

	it("gives imports their own fallback message", () => {
		expect(importEnvironmentJob("a").errorFallback).toBe(
			"Could not create the environment from the file.",
		);
	});
});

describe("showJobSuccess / showJobError", () => {
	it("reports a finished job with a success toast", () => {
		showJobSuccess(installPackagesJob("dev", 2));
		expect(toast.success).toHaveBeenCalledWith("Packages installed", {
			description: "2 packages installed in dev.",
		});
	});

	it("reports a failed job with a persistent error toast", () => {
		showJobError(createEnvironmentJob("my-env"), new Error("boom"));
		expect(toast.error).toHaveBeenCalledWith("Could not create my-env", {
			description: "Could not create the environment.",
			duration: Infinity,
		});
	});
});
