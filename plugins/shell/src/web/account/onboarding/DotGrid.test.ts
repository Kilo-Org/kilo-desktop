import { describe, expect, it, vi } from "vitest";

import { createProgram } from "./DotGrid";

const VERTEX = 1;
const FRAGMENT = 2;

function fakeGl({ compiles = [true, true], links = true } = {}) {
	const vertexShader = { kind: "vertex" };
	const fragmentShader = { kind: "fragment" };
	const program = { kind: "program" };
	const gl = {
		VERTEX_SHADER: VERTEX,
		FRAGMENT_SHADER: FRAGMENT,
		COMPILE_STATUS: "compile",
		LINK_STATUS: "link",
		createShader: vi.fn((type: number) => (type === VERTEX ? vertexShader : fragmentShader)),
		shaderSource: vi.fn(),
		compileShader: vi.fn(),
		getShaderParameter: vi.fn((shader: object) => compiles[shader === vertexShader ? 0 : 1]),
		deleteShader: vi.fn(),
		createProgram: vi.fn(() => program),
		attachShader: vi.fn(),
		linkProgram: vi.fn(),
		getProgramParameter: vi.fn(() => links),
		deleteProgram: vi.fn(),
	};
	return {
		gl,
		context: gl as unknown as WebGL2RenderingContext,
		vertexShader,
		fragmentShader,
		program,
	};
}

describe("createProgram", () => {
	it("returns the linked program and releases both shaders", () => {
		const { gl, context, vertexShader, fragmentShader, program } = fakeGl();

		expect(createProgram(context)).toBe(program);
		expect(gl.deleteShader).toHaveBeenCalledWith(vertexShader);
		expect(gl.deleteShader).toHaveBeenCalledWith(fragmentShader);
		expect(gl.deleteProgram).not.toHaveBeenCalled();
	});

	it("releases the compiled vertex shader when the fragment shader fails", () => {
		const { gl, context, vertexShader, fragmentShader } = fakeGl({ compiles: [true, false] });

		expect(createProgram(context)).toBeNull();
		expect(gl.deleteShader).toHaveBeenCalledWith(vertexShader);
		expect(gl.deleteShader).toHaveBeenCalledWith(fragmentShader);
		expect(gl.createProgram).not.toHaveBeenCalled();
	});

	it("releases the program and both shaders when linking fails", () => {
		const { gl, context, vertexShader, fragmentShader, program } = fakeGl({ links: false });

		expect(createProgram(context)).toBeNull();
		expect(gl.deleteProgram).toHaveBeenCalledWith(program);
		expect(gl.deleteShader).toHaveBeenCalledWith(vertexShader);
		expect(gl.deleteShader).toHaveBeenCalledWith(fragmentShader);
	});
});
