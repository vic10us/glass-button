/**
 * Full-screen triangle. One oversized triangle covers the viewport with no
 * vertex buffer at all: positions come from gl_VertexID. Fragments outside
 * the viewport are clipped, so the cost is the same as a quad and there is
 * no diagonal seam.
 */
export const QUAD_VERT = /* glsl */ `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  // IDs 0,1,2 -> (-1,-1), (3,-1), (-1,3)
  vec2 pos = vec2(float((gl_VertexID & 1) << 2) - 1.0, float((gl_VertexID & 2) << 1) - 1.0);
  vUv = pos * 0.5 + 0.5;
  gl_Position = vec4(pos, 0.0, 1.0);
}
`;
