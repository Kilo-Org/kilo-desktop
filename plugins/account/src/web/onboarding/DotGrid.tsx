import { useEffect, useRef, type RefObject } from "react";

import { cn } from "@kilo-desktop/ui/lib/utils";

/**
 * Port of the kilo.ai hero `InteractiveDotGrid`: a WebGL field of tiny square
 * dots. A ripple (a head ring plus two fading echoes) sweeps out from an
 * origin, swelling the dots it passes and tinting them with the brand
 * yellow → teal → purple gradient; the pointer drags an eight-point trail that
 * does the same locally.
 *
 * The render loop only runs while something is moving (a ripple, an active
 * pointer, or hover decay) and otherwise leaves the last frame on the canvas.
 * Ripples start from `introOrigin`'s center after mount and again from any
 * pointer-down on non-interactive space. Reduced motion draws the static grid;
 * no WebGL leaves the canvas blank so the page background shows through.
 */

const SETTINGS = {
	dotSize: 1,
	gap: 25,
	hoverRadius: 90,
	neighborScale: 5.5,
	trail: 0.5,
	rippleDuration: 2600,
	introDelay: 280,
	rippleTravelEase: 2,
	rippleWidthStart: 0.025,
	rippleWidthEnd: 0.075,
	rippleTailSpacing: 0.22,
	rippleTailStrength: 0.15,
	rippleFadeStart: 0.66,
	rippleFadePower: 3.3,
	/** Fully clear rounded box (CSS px) around the welcome copy (~384×320). */
	clearHalfSize: [210, 172],
	clearRadius: 80,
	/** Distance (CSS px) past the box over which dots fade back in. */
	clearFalloff: 130,
	maxPixelRatio: 2,
	maxPixelCount: 4_000_000,
} as const;

const PALETTE = {
	dark: { fill: "#383838", gradient: ["#f9f576", "#25bec1", "#7420d9"] },
	light: { fill: "#d6d6d6", gradient: ["#e3d400", "#1fa9ac", "#7420d9"] },
} as const;

const TRAIL_POINTS = 8;
const OFFSCREEN: [number, number] = [-1e4, -1e4];

const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;

uniform vec2 u_resolution;
uniform float u_pixelRatio;
uniform vec3 u_colorFill;
uniform vec3 u_gradientColor0;
uniform vec3 u_gradientColor1;
uniform vec3 u_gradientColor2;
uniform float u_dotSize;
uniform float u_gap;
uniform vec2 u_trail[8];
uniform float u_hoverIntensity;
uniform float u_rippleProgress;
uniform vec2 u_rippleOrigin;
uniform float u_rippleTravelEase;
uniform float u_rippleWidthStart;
uniform float u_rippleWidthEnd;
uniform float u_rippleTailSpacing;
uniform float u_rippleTailStrength;
uniform float u_rippleFadeStart;
uniform float u_rippleFadePower;
uniform float u_hoverRadius;
uniform float u_neighborScale;
uniform vec2 u_clearHalfSize;
uniform float u_clearRadius;
uniform float u_clearFalloff;

out vec4 fragColor;

#define HALF_PI 1.57079632679489661923

float squareDistance(vec2 p) {
  vec2 squarePoint = 1.03 * p;
  float angle = atan(squarePoint.x, squarePoint.y) + 1e-3;
  return cos(floor(0.5 + angle / HALF_PI) * HALF_PI - angle) * length(squarePoint);
}

float distanceToSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}

float exponentialFalloff(float distanceValue, float radius) {
  float normalizedDistance = clamp(distanceValue / max(radius, 1e-6), 0.0, 1.0);
  float exponentialFloor = exp(-4.0);
  return (exp(-4.0 * normalizedDistance * normalizedDistance) - exponentialFloor) / (1.0 - exponentialFloor);
}

vec3 sampleGradient(float t) {
  float x = clamp(t, 0.0, 1.0) * 2.0;
  vec3 color = mix(u_gradientColor0, u_gradientColor1, clamp(x, 0.0, 1.0));
  return mix(color, u_gradientColor2, clamp(x - 1.0, 0.0, 1.0));
}

vec2 cssResolution() {
  return u_resolution / max(u_pixelRatio, 1e-6);
}

vec2 patternFromPixel(vec2 pixelPosition) {
  vec2 res = cssResolution();
  return vec2(pixelPosition.x - 0.5 * res.x, 0.5 * res.y - pixelPosition.y);
}

float easeOutCubic(float t) {
  float p = 1.0 - clamp(t, 0.0, 1.0);
  return 1.0 - p * p * p;
}

float easeOutPower(float t, float power) {
  float p = 1.0 - clamp(t, 0.0, 1.0);
  return 1.0 - pow(p, max(power, 0.1));
}

float rippleField(vec2 dotCenter, float progress) {
  vec2 res = cssResolution();
  vec2 normalizedDot = clamp((dotCenter + 0.5 * res) / max(res, vec2(1e-6)), 0.0, 1.0);
  float aspect = res.x / max(res.y, 1e-6);
  vec2 origin = clamp(u_rippleOrigin, vec2(0.0), vec2(1.0));
  float distanceFromDrop = length((normalizedDot - origin) * vec2(aspect, 1.0));
  vec2 farCorner = vec2(max(origin.x, 1.0 - origin.x) * aspect, max(origin.y, 1.0 - origin.y));
  float maxRadius = length(farCorner);
  float t = clamp(progress, 0.0, 1.0);
  float fadeStart = clamp(u_rippleFadeStart, 0.05, 0.98);
  float fadePower = max(u_rippleFadePower, 0.1);
  float travel = easeOutPower(t, u_rippleTravelEase);
  float ringEnergy = smoothstep(0.0, 0.055, t) * pow(1.0 - smoothstep(fadeStart, 1.0, t), fadePower);
  float tailEnergy = smoothstep(0.08, 0.28, t) *
    pow(1.0 - smoothstep(min(fadeStart + 0.02, 0.98), 1.0, t), max(fadePower * 0.86, 0.1));

  float head = mix(0.0, maxRadius + 0.16, travel);
  float width = mix(max(u_rippleWidthStart, 0.001), max(u_rippleWidthEnd, 0.001), easeOutCubic(t));
  float primaryRing = (1.0 - smoothstep(0.0, width, abs(distanceFromDrop - head))) * mix(1.0, 0.68, t);

  float secondHead = head - max(u_rippleTailSpacing, 0.01);
  float secondRing = step(0.0, secondHead) *
    (1.0 - smoothstep(0.0, width * 1.2, abs(distanceFromDrop - secondHead))) *
    u_rippleTailStrength * tailEnergy;

  float thirdHead = head - max(u_rippleTailSpacing, 0.01) * 2.0;
  float thirdRing = step(0.0, thirdHead) *
    (1.0 - smoothstep(0.0, width * 1.45, abs(distanceFromDrop - thirdHead))) *
    u_rippleTailStrength * 0.52 * tailEnergy;

  return clamp(max(primaryRing, max(secondRing, thirdRing)), 0.0, 1.0) * ringEnergy;
}

float roundedBoxDistance(vec2 p, vec2 halfSize, float radius) {
  vec2 q = abs(p) - halfSize + radius;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}

// Edge fade and the clearing behind the centered copy, baked in so the canvas
// needs no CSS mask or overlay layer. The clearing is sized in CSS pixels
// because the copy is fixed-size; a window-relative shape lets dots creep
// under the text on larger windows.
float visibility(vec2 cssPixel, vec2 res) {
  vec2 uv = cssPixel / max(res, vec2(1e-6));
  vec2 edge = min(uv, 1.0 - uv);
  float edgeFade = smoothstep(0.0, 0.1, edge.x) * smoothstep(0.0, 0.1, edge.y);
  float d = roundedBoxDistance(cssPixel - 0.5 * res, u_clearHalfSize, u_clearRadius);
  float clearing = smoothstep(0.0, max(u_clearFalloff, 1.0), d);
  return edgeFade * clearing;
}

void main() {
  vec2 res = cssResolution();
  vec2 cssPixel = gl_FragCoord.xy / max(u_pixelRatio, 1e-6);
  float fade = visibility(cssPixel, res);
  if (fade < 0.004) {
    fragColor = vec4(0.0);
    return;
  }

  vec2 shapeUV = cssPixel - 0.5 * res;
  float gap = max(abs(u_gap), 1e-6);
  vec2 grid = fract(shapeUV / gap) + 1e-4;
  vec2 gridIndex = floor(shapeUV / gap);
  vec2 point = (grid - (vec2(0.5) - 1e-3)) * gap;

  // Most of each cell is empty even at the largest dot size; skip the field
  // math there. This is ~70% of pixels.
  if (max(abs(point.x), abs(point.y)) > u_dotSize + u_neighborScale + 1.0) {
    fragColor = vec4(0.0);
    return;
  }

  vec2 dotCenter = (gridIndex + 0.5) * gap;
  float pointerNeighbor = 0.0;
  float pointerGradientPosition = 1.0;

  if (u_hoverIntensity > 0.001) {
    vec2 pointerHead = patternFromPixel(u_trail[0]);
    pointerNeighbor = exponentialFalloff(length(dotCenter - pointerHead), max(u_hoverRadius, 1.0));
    pointerGradientPosition = clamp(length(dotCenter - pointerHead) / max(u_hoverRadius, 1.0), 0.0, 1.0);

    for (int index = 0; index < 7; index++) {
      vec2 start = patternFromPixel(u_trail[index]);
      vec2 end = patternFromPixel(u_trail[index + 1]);
      float perpendicularDistance = distanceToSegment(dotCenter, start, end);
      float along = (float(index) + 0.5) / 7.0;
      float trailRadius = max(u_hoverRadius * mix(0.42, 0.10, along), 1.0);
      float influence = exponentialFalloff(perpendicularDistance, trailRadius) * pow(1.0 - along, 1.65);
      if (influence > pointerNeighbor) {
        pointerNeighbor = influence;
        pointerGradientPosition = clamp(perpendicularDistance / trailRadius, 0.0, 1.0);
      }
    }
    pointerNeighbor *= u_hoverIntensity;
  }

  float rippleNeighbor = u_rippleProgress < 1.0 ? rippleField(dotCenter, u_rippleProgress) : 0.0;
  float neighbor = pointerNeighbor;
  float gradientPosition = pointerGradientPosition;
  if (rippleNeighbor > neighbor) {
    neighbor = rippleNeighbor;
    gradientPosition = 1.0 - clamp(rippleNeighbor, 0.0, 1.0);
  }

  float dotSize = u_dotSize + neighbor * u_neighborScale;
  float distanceFromSquare = squareDistance(point);
  // Analytic ~1 device pixel; fwidth() is undefined after the early returns.
  float edgeWidth = 1.2 / max(u_pixelRatio, 1e-6);
  float shape = 1.0 - smoothstep(dotSize - edgeWidth, dotSize + edgeWidth, distanceFromSquare);

  float effectColor = max(u_hoverIntensity, clamp(rippleNeighbor, 0.0, 1.0));
  float coverage = (1.0 - smoothstep(0.85, 1.0, gradientPosition)) * effectColor;
  vec3 color = mix(u_colorFill, sampleGradient(gradientPosition), coverage);

  float alpha = shape * fade;
  fragColor = vec4(color * alpha, alpha);
}
`;

type Uniforms = Record<string, WebGLUniformLocation | null>;

function hexToRgb(hex: string): [number, number, number] {
	const value = Number.parseInt(hex.slice(1), 16);
	return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
	const shader = gl.createShader(type);
	if (!shader) return null;
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		gl.deleteShader(shader);
		return null;
	}
	return shader;
}

export function createProgram(gl: WebGL2RenderingContext): WebGLProgram | null {
	const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
	const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
	const program = vertex && fragment ? link(gl, vertex, fragment) : null;
	// A linked program keeps what it needs, so the shaders are released either way.
	gl.deleteShader(vertex);
	gl.deleteShader(fragment);
	return program;
}

function link(
	gl: WebGL2RenderingContext,
	vertex: WebGLShader,
	fragment: WebGLShader,
): WebGLProgram | null {
	const program = gl.createProgram();
	if (!program) return null;
	gl.attachShader(program, vertex);
	gl.attachShader(program, fragment);
	gl.linkProgram(program);
	if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
	gl.deleteProgram(program);
	return null;
}

/** Controls (and their labels) that a click-to-ripple must not fire through. */
const INTERACTIVE_SELECTOR = [
	"button",
	"a",
	"input",
	"textarea",
	"select",
	"label",
	"[contenteditable]",
	"[role='button']",
	"[role='checkbox']",
	"[role='switch']",
	"[role='radio']",
	"[role='link']",
].join(", ");

export function isInteractiveTarget(target: EventTarget | null): boolean {
	return target instanceof Element && target.closest(INTERACTIVE_SELECTOR) !== null;
}

export function DotGrid({
	className,
	introOrigin,
}: {
	className?: string;
	/** Element whose center seeds the intro ripple (the window center when absent). */
	introOrigin?: RefObject<HTMLElement | null>;
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		const gl = canvas?.getContext("webgl2", { premultipliedAlpha: true, antialias: false });
		if (!canvas || !gl) return;
		const program = createProgram(gl);
		if (!program) return;

		const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		gl.useProgram(program);
		const buffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
		const position = gl.getAttribLocation(program, "a_position");
		gl.enableVertexAttribArray(position);
		gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

		const uniforms: Uniforms = {};
		const uniform = (name: string) => (uniforms[name] ??= gl.getUniformLocation(program, name));
		gl.uniform1f(uniform("u_dotSize"), SETTINGS.dotSize);
		gl.uniform1f(uniform("u_gap"), SETTINGS.gap);
		gl.uniform1f(uniform("u_hoverRadius"), SETTINGS.hoverRadius);
		gl.uniform1f(uniform("u_neighborScale"), SETTINGS.neighborScale);
		gl.uniform1f(uniform("u_rippleTravelEase"), SETTINGS.rippleTravelEase);
		gl.uniform1f(uniform("u_rippleWidthStart"), SETTINGS.rippleWidthStart);
		gl.uniform1f(uniform("u_rippleWidthEnd"), SETTINGS.rippleWidthEnd);
		gl.uniform1f(uniform("u_rippleTailSpacing"), SETTINGS.rippleTailSpacing);
		gl.uniform1f(uniform("u_rippleTailStrength"), SETTINGS.rippleTailStrength);
		gl.uniform1f(uniform("u_rippleFadeStart"), SETTINGS.rippleFadeStart);
		gl.uniform1f(uniform("u_rippleFadePower"), SETTINGS.rippleFadePower);
		gl.uniform2f(uniform("u_clearHalfSize"), ...SETTINGS.clearHalfSize);
		gl.uniform1f(uniform("u_clearRadius"), SETTINGS.clearRadius);
		gl.uniform1f(uniform("u_clearFalloff"), SETTINGS.clearFalloff);

		const applyPalette = () => {
			const palette = canvas.matches(':is([data-theme="dark"] *)') ? PALETTE.dark : PALETTE.light;
			gl.uniform3fv(uniform("u_colorFill"), hexToRgb(palette.fill));
			palette.gradient.forEach((hex, index) =>
				gl.uniform3fv(uniform(`u_gradientColor${index}`), hexToRgb(hex)),
			);
		};
		applyPalette();

		let rect = canvas.getBoundingClientRect();
		const resize = () => {
			rect = canvas.getBoundingClientRect();
			let ratio = Math.min(window.devicePixelRatio || 1, SETTINGS.maxPixelRatio);
			const pixels = rect.width * rect.height * ratio * ratio;
			if (pixels > SETTINGS.maxPixelCount) ratio *= Math.sqrt(SETTINGS.maxPixelCount / pixels);
			canvas.width = Math.max(1, Math.round(rect.width * ratio));
			canvas.height = Math.max(1, Math.round(rect.height * ratio));
			gl.viewport(0, 0, canvas.width, canvas.height);
			gl.uniform2f(uniform("u_resolution"), canvas.width, canvas.height);
			gl.uniform1f(uniform("u_pixelRatio"), ratio);
		};

		let pointer: [number, number] = [...OFFSCREEN];
		let trail = Array.from({ length: TRAIL_POINTS }, () => [...OFFSCREEN] as [number, number]);
		let pointerActive = false;
		let hoverIntensity = 0;
		let rippleStart: number | null = null;
		let frame: number | null = null;

		const draw = () => {
			const now = performance.now();
			frame = null;
			hoverIntensity += ((pointerActive ? 1 : 0) - hoverIntensity) * 0.12;
			const head = trail[0]!;
			if (pointerActive) {
				head[0] += (pointer[0] - head[0]) * 0.34;
				head[1] += (pointer[1] - head[1]) * 0.34;
			}
			const follow = 0.34 - 0.26 * SETTINGS.trail;
			for (let index = 1; index < TRAIL_POINTS; index++) {
				const point = trail[index]!;
				const previous = trail[index - 1]!;
				const rate = Math.max(0.045, follow * (1 - 0.035 * index));
				point[0] += (previous[0] - point[0]) * rate;
				point[1] += (previous[1] - point[1]) * rate;
			}
			if (!pointerActive && hoverIntensity < 0.01) {
				hoverIntensity = 0;
				trail = trail.map(() => [...OFFSCREEN] as [number, number]);
			}

			let rippleProgress = 1;
			if (rippleStart !== null) {
				rippleProgress = Math.min((now - rippleStart) / SETTINGS.rippleDuration, 1);
				if (rippleProgress >= 1) rippleStart = null;
			}

			gl.uniform2fv(uniform("u_trail"), trail.flat());
			gl.uniform1f(uniform("u_hoverIntensity"), hoverIntensity);
			gl.uniform1f(uniform("u_rippleProgress"), rippleProgress);
			gl.clearColor(0, 0, 0, 0);
			gl.clear(gl.COLOR_BUFFER_BIT);
			gl.drawArrays(gl.TRIANGLES, 0, 3);

			if (rippleStart !== null || pointerActive || hoverIntensity > 0) schedule();
		};
		const schedule = () => {
			frame ??= window.requestAnimationFrame(draw);
		};

		const startRipple = (clientX: number, clientY: number) => {
			if (reduceMotion || rect.width === 0 || rect.height === 0) return;
			gl.uniform2f(
				uniform("u_rippleOrigin"),
				(clientX - rect.left) / rect.width,
				1 - (clientY - rect.top) / rect.height,
			);
			rippleStart = performance.now();
			schedule();
		};

		const onPointerMove = (event: PointerEvent) => {
			if (reduceMotion || event.pointerType === "touch") return;
			pointer = [event.clientX - rect.left, event.clientY - rect.top];
			if (!pointerActive && hoverIntensity < 0.01) {
				trail = trail.map(() => [...pointer] as [number, number]);
			}
			pointerActive = true;
			schedule();
		};
		const onPointerLeave = () => {
			if (!pointerActive) return;
			pointerActive = false;
			schedule();
		};
		const onPointerDown = (event: PointerEvent) => {
			if (!isInteractiveTarget(event.target)) startRipple(event.clientX, event.clientY);
		};

		const resizeObserver = new ResizeObserver(() => {
			resize();
			schedule();
		});
		resizeObserver.observe(canvas);
		const themeObserver = new MutationObserver(() => {
			applyPalette();
			schedule();
		});
		themeObserver.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-theme"],
			subtree: true,
		});
		resize();
		schedule();

		window.addEventListener("pointermove", onPointerMove, { passive: true });
		document.documentElement.addEventListener("pointerleave", onPointerLeave);
		window.addEventListener("blur", onPointerLeave);
		window.addEventListener("pointerdown", onPointerDown);
		const intro = window.setTimeout(() => {
			const box = introOrigin?.current?.getBoundingClientRect();
			if (box) startRipple(box.left + box.width / 2, box.top + box.height / 2);
			else startRipple(rect.left + rect.width / 2, rect.top + rect.height / 2);
		}, SETTINGS.introDelay);

		return () => {
			window.clearTimeout(intro);
			if (frame !== null) window.cancelAnimationFrame(frame);
			resizeObserver.disconnect();
			themeObserver.disconnect();
			window.removeEventListener("pointermove", onPointerMove);
			document.documentElement.removeEventListener("pointerleave", onPointerLeave);
			window.removeEventListener("blur", onPointerLeave);
			window.removeEventListener("pointerdown", onPointerDown);
			gl.deleteBuffer(buffer);
			gl.deleteProgram(program);
		};
	}, [introOrigin]);

	return (
		<canvas
			ref={canvasRef}
			aria-hidden="true"
			data-qa-id="onboarding-dot-grid"
			className={cn("block size-full", className)}
		/>
	);
}
