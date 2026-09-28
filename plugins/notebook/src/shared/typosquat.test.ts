import { describe, expect, it } from "vitest";

import { checkTyposquat, checkTyposquats, extractPackageName } from "./typosquat.js";

// Cases mirror nteract's crates/notebook/src/typosquat.rs tests so the port keeps parity.
describe("typosquat detection", () => {
	it("does not flag popular packages or specs that name them", () => {
		for (const spec of [
			"numpy",
			"pandas",
			"requests",
			"numpy>=1.20",
			"pandas[sql]>=2.0",
			"Numpy",
			"typing_extensions",
			"conda-forge::numpy=1.26",
			"torch @ https://example.invalid/torch.whl",
		]) {
			expect(checkTyposquat(spec), spec).toBeUndefined();
		}
	});

	it("flags near misses of popular packages", () => {
		expect(checkTyposquat("numppy")).toEqual({
			package: "numppy",
			similar_to: "numpy",
			distance: 1,
		});
		expect(checkTyposquat("padas")?.similar_to).toBe("pandas");
		expect(checkTyposquat("requets")?.similar_to).toBe("requests");
		expect(checkTyposquat("pyhton")?.similar_to).toBe("python");
		expect(checkTyposquat("symppy")?.similar_to).toBe("sympy");
		expect(checkTyposquat("polrs")?.similar_to).toBe("polars");
	});

	it("reports the bare package name for qualified and versioned specs", () => {
		expect(checkTyposquat("conda-forge::Reqeusts>=2")).toMatchObject({
			package: "reqeusts",
			similar_to: "requests",
		});
	});

	it("does not flag legitimate packages that are close to other popular names", () => {
		for (const spec of [
			"python=3.11",
			"sympy",
			"scapy",
			"spacy",
			"cattrs",
			"toml",
			"h5py",
			"dataset",
			"arrow",
			"airflow",
			"biopython",
			"astropy",
			"pyright",
			"pygame",
			"pika",
			"jedi",
			"rope",
			"boltons",
			"anywidget",
			"pytorch",
			"py-opencv",
			"r-base",
		]) {
			expect(checkTyposquat(spec), spec).toBeUndefined();
		}
	});

	it("does not flag unrelated names", () => {
		expect(checkTyposquat("my-custom-package")).toBeUndefined();
		expect(checkTyposquat("foobarqux")).toBeUndefined();
		expect(checkTyposquat("")).toBeUndefined();
	});

	it("checks every spec and returns only the flagged ones", () => {
		expect(
			checkTyposquats(["numpy", "numppy", "pandass", "reqeusts"]).map((warning) => warning.package),
		).toEqual(["numppy", "pandass", "reqeusts"]);
	});

	it("extracts package names like nteract's notebook-doc", () => {
		expect(extractPackageName("pandas>=2.0")).toBe("pandas");
		expect(extractPackageName("numpy[extra]")).toBe("numpy");
		expect(extractPackageName("requests~=2.28")).toBe("requests");
		expect(extractPackageName("torch @ https://...")).toBe("torch");
		expect(extractPackageName(" conda-forge::SciPy=1.11 ")).toBe("scipy");
	});
});
