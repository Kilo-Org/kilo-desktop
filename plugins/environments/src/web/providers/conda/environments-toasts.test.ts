import { describe, expect, it, vi } from "vitest";

vi.mock("@anaconda-agentic-desktop/ui/components/sonner", () => ({
	toast: {
		error: vi.fn(),
		success: vi.fn(),
		loading: vi.fn(() => "toast-id"),
	},
}));

vi.mock("./environments-error-message.js", () => ({
	friendlyEnvironmentsError: vi.fn((_reason: unknown, fallback: string) => fallback),
}));

// lucide-react icons import JSX — stub it so the unit project (environment: node) does not choke.
vi.mock("lucide-react", () => ({
	OctagonXIcon: "OctagonXIcon",
}));

import { toast } from "@anaconda-agentic-desktop/ui/components/sonner";

import { friendlyEnvironmentsError } from "./environments-error-message.js";
import {
	showEnvironmentCreatedToast,
	showEnvironmentsErrorToast,
	showPackagesInstalledToast,
	showPackagesUpdatedToast,
	trackBackgroundCreateToast,
	trackBackgroundDeleteToast,
	trackBackgroundInstallToast,
} from "./environments-toasts.js";

describe("showEnvironmentsErrorToast", () => {
	it("calls toast.error with title, friendly description, and infinite duration", () => {
		showEnvironmentsErrorToast("Create failed", "some-error", "Something went wrong");

		expect(toast.error).toHaveBeenCalledWith(
			"Create failed",
			expect.objectContaining({
				description: "Something went wrong",
				duration: Infinity,
			}),
		);
		expect(friendlyEnvironmentsError).toHaveBeenCalledWith("some-error", "Something went wrong");
	});

	it("passes id when toastId is provided", () => {
		showEnvironmentsErrorToast("Create failed", "err", "fallback", "my-toast");

		expect(toast.error).toHaveBeenCalledWith(
			"Create failed",
			expect.objectContaining({ id: "my-toast" }),
		);
	});
});

describe("showEnvironmentCreatedToast", () => {
	it("calls toast.success with the environment name and description", () => {
		showEnvironmentCreatedToast("my-env");

		expect(toast.success).toHaveBeenCalledWith("my-env created", {
			description: "The environment is ready to use.",
		});
	});
});

describe("trackBackgroundCreateToast", () => {
	it("shows loading then success on promise resolve", async () => {
		const promise = Promise.resolve();
		trackBackgroundCreateToast(promise, "my-env", "fallback");

		expect(toast.loading).toHaveBeenCalledWith("Creating my-env…", {
			description: "Resolving dependencies and installing packages.",
		});

		await promise;
		// Flush microtask queue for the .then callback
		await vi.waitFor(() => {
			expect(toast.success).toHaveBeenCalledWith("my-env created", {
				id: "toast-id",
				description: "The environment is ready to use.",
			});
		});
	});

	it("shows loading then error on promise reject", async () => {
		const error = new Error("boom");
		const promise = Promise.reject(error);
		// Prevent unhandled rejection noise — trackBackgroundCreateToast attaches
		// its own .then handler, but Node still warns for the tick before it runs.
		promise.catch(() => {});

		trackBackgroundCreateToast(promise, "my-env", "Something went wrong");

		expect(toast.loading).toHaveBeenCalled();

		await vi.waitFor(() => {
			expect(toast.error).toHaveBeenCalledWith(
				"Failed to create my-env",
				expect.objectContaining({
					id: "toast-id",
					duration: Infinity,
				}),
			);
		});
	});
});

describe("trackBackgroundDeleteToast", () => {
	it("shows loading then success on promise resolve", async () => {
		const promise = Promise.resolve();
		trackBackgroundDeleteToast(promise, "my-env");

		expect(toast.loading).toHaveBeenCalledWith("Deleting my-env…", {
			description: "Removing the environment and all its packages.",
		});

		await promise;
		await vi.waitFor(() => {
			expect(toast.success).toHaveBeenCalledWith("my-env deleted", {
				id: "toast-id",
				description: "The environment has been removed.",
			});
		});
	});

	it("shows loading then error on promise reject", async () => {
		const error = new Error("boom");
		const promise = Promise.reject(error);
		promise.catch(() => {});

		trackBackgroundDeleteToast(promise, "my-env");

		expect(toast.loading).toHaveBeenCalled();

		await vi.waitFor(() => {
			expect(toast.error).toHaveBeenCalledWith(
				"Failed to delete my-env",
				expect.objectContaining({
					id: "toast-id",
					duration: Infinity,
				}),
			);
		});
	});
});

describe("showPackagesInstalledToast / showPackagesUpdatedToast", () => {
	it("pluralises the count and names the environment", () => {
		showPackagesInstalledToast("dev", 1);
		expect(toast.success).toHaveBeenCalledWith("Packages installed", {
			description: "1 package installed in dev.",
		});

		showPackagesUpdatedToast("dev", 3, "t-1");
		expect(toast.success).toHaveBeenCalledWith("Packages updated", {
			id: "t-1",
			description: "3 packages updated in dev.",
		});
	});
});

describe("trackBackgroundInstallToast", () => {
	it("shows loading then success on promise resolve", async () => {
		const promise = Promise.resolve();
		trackBackgroundInstallToast(promise, "dev", 2, "fallback");

		expect(toast.loading).toHaveBeenCalledWith("Installing 2 packages…", {
			description: "Resolving dependencies for dev.",
		});

		await vi.waitFor(() => {
			expect(toast.success).toHaveBeenCalledWith("Packages installed", {
				id: "toast-id",
				description: "2 packages installed in dev.",
			});
		});
	});

	it("shows loading then a persistent error on promise reject", async () => {
		const promise = Promise.reject(new Error("boom"));
		promise.catch(() => {});

		trackBackgroundInstallToast(promise, "dev", 1, "Could not install.");

		expect(toast.loading).toHaveBeenCalledWith("Installing 1 package…", expect.anything());
		await vi.waitFor(() => {
			expect(toast.error).toHaveBeenCalledWith(
				"Install failed",
				expect.objectContaining({
					id: "toast-id",
					description: "Could not install.",
					duration: Infinity,
				}),
			);
		});
	});
});
