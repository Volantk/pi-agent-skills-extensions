# GLSL Template

Generic GLSL for WebGL 2.0 / OpenGL 3.3+

```glsl
#version 300 es
precision highp float;

//============================================================
// UNIFORMS
//============================================================

uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
uniform sampler2D u_texture0;

//============================================================
// CONSTANTS
//============================================================

const float PI = 3.14159265359;
const float TAU = 6.28318530718;
const float EPSILON = 0.0001;

//============================================================
// UTILITY FUNCTIONS
//============================================================

float remap_range(float value, float in_min, float in_max, float out_min, float out_max) {
    return out_min + (value - in_min) * (out_max - out_min) / (in_max - in_min);
}

float saturate_01(float x) {
    return clamp(x, 0.0, 1.0);
}

vec3 saturate_01(vec3 x) {
    return clamp(x, 0.0, 1.0);
}

float soft_threshold(float value, float edge, float softness) {
    return smoothstep(edge - softness, edge + softness, value);
}

//============================================================
// COORDINATE TRANSFORMS
//============================================================

vec2 transform_pixel_to_uv(vec2 frag_coord, vec2 resolution) {
    return frag_coord / resolution;
}

vec2 transform_uv_to_centered(vec2 uv) {
    return uv * 2.0 - 1.0;
}

vec2 transform_uv_aspect_correct(vec2 uv, vec2 resolution) {
    vec2 centered = uv * 2.0 - 1.0;
    centered.x *= resolution.x / resolution.y;
    return centered;
}

vec2 transform_uv_rotate(vec2 uv, float angle_radians, vec2 pivot) {
    vec2 offset = uv - pivot;
    float s = sin(angle_radians);
    float c = cos(angle_radians);
    return vec2(offset.x * c - offset.y * s, offset.x * s + offset.y * c) + pivot;
}

vec2 transform_uv_scale(vec2 uv, vec2 scale, vec2 pivot) {
    return (uv - pivot) / scale + pivot;
}

vec2 transform_uv_tile(vec2 uv, vec2 tiles) {
    return fract(uv * tiles);
}

//============================================================
// NOISE & PATTERNS
//============================================================

float hash_1d(float n) {
    return fract(sin(n) * 43758.5453123);
}

float hash_2d_to_1d(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

vec2 hash_2d_to_2d(vec2 p) {
    return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
}

float noise_value_2d(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f); // smoothstep
    
    float a = hash_2d_to_1d(i + vec2(0.0, 0.0));
    float b = hash_2d_to_1d(i + vec2(1.0, 0.0));
    float c = hash_2d_to_1d(i + vec2(0.0, 1.0));
    float d = hash_2d_to_1d(i + vec2(1.0, 1.0));
    
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float noise_fbm_2d(vec2 p, int octaves, float lacunarity, float gain) {
    float sum = 0.0;
    float amplitude = 1.0;
    float frequency = 1.0;
    float max_value = 0.0;
    
    for (int i = 0; i < octaves; i++) {
        sum += amplitude * noise_value_2d(p * frequency);
        max_value += amplitude;
        amplitude *= gain;
        frequency *= lacunarity;
    }
    
    return sum / max_value;
}

float pattern_checkerboard(vec2 uv, float scale) {
    vec2 grid = floor(uv * scale);
    return mod(grid.x + grid.y, 2.0);
}

float pattern_stripes(vec2 uv, float frequency, float angle_radians) {
    vec2 rotated = transform_uv_rotate(uv, angle_radians, vec2(0.5));
    return sin(rotated.x * frequency * TAU) * 0.5 + 0.5;
}

float pattern_circle_sdf(vec2 uv, vec2 center, float radius) {
    return length(uv - center) - radius;
}

float pattern_box_sdf(vec2 uv, vec2 center, vec2 half_size) {
    vec2 d = abs(uv - center) - half_size;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

//============================================================
// COLOR OPERATIONS
//============================================================

vec3 convert_rgb_to_hsv(vec3 rgb) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(rgb.bg, K.wz), vec4(rgb.gb, K.xy), step(rgb.b, rgb.g));
    vec4 q = mix(vec4(p.xyw, rgb.r), vec4(rgb.r, p.yzx), step(p.x, rgb.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 convert_hsv_to_rgb(vec3 hsv) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(hsv.xxx + K.xyz) * 6.0 - K.www);
    return hsv.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), hsv.y);
}

float compute_luminance(vec3 color) {
    return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

vec3 apply_contrast(vec3 color, float contrast) {
    return (color - 0.5) * contrast + 0.5;
}

vec3 apply_saturation(vec3 color, float saturation) {
    float luma = compute_luminance(color);
    return mix(vec3(luma), color, saturation);
}

//============================================================
// EFFECTS
//============================================================

// EFFECT: Vignette
// IN: uv (0-1), color
// OUT: color darkened at edges
vec3 apply_vignette_circular(vec2 uv, vec3 color, float intensity, float softness) {
    float dist_from_center = length(uv - 0.5);
    float vignette_mask = 1.0 - smoothstep(0.5 - softness, 0.5, dist_from_center * intensity);
    return color * vignette_mask;
}

// EFFECT: Film grain
// IN: uv, time for animation, color
// OUT: color with noise grain overlay
vec3 apply_film_grain(vec2 uv, float time, vec3 color, float intensity) {
    float grain = hash_2d_to_1d(uv * 1000.0 + time) * 2.0 - 1.0;
    return color + grain * intensity;
}

// EFFECT: Chromatic aberration
// IN: uv, texture sampler
// OUT: color with RGB channel offset
vec3 apply_chromatic_aberration(vec2 uv, sampler2D tex, float offset_amount) {
    vec2 direction = normalize(uv - 0.5);
    float r = texture(tex, uv + direction * offset_amount).r;
    float g = texture(tex, uv).g;
    float b = texture(tex, uv - direction * offset_amount).b;
    return vec3(r, g, b);
}

// EFFECT: Pixelation
// IN: uv, pixel size
// OUT: pixelated uv coordinates
vec2 apply_pixelate_uv(vec2 uv, float pixel_size, vec2 resolution) {
    vec2 pixels = resolution / pixel_size;
    return floor(uv * pixels) / pixels;
}

//============================================================
// BLENDING
//============================================================

vec3 blend_add(vec3 base, vec3 blend) {
    return min(base + blend, 1.0);
}

vec3 blend_multiply(vec3 base, vec3 blend) {
    return base * blend;
}

vec3 blend_screen(vec3 base, vec3 blend) {
    return 1.0 - (1.0 - base) * (1.0 - blend);
}

vec3 blend_overlay(vec3 base, vec3 blend) {
    return mix(
        2.0 * base * blend,
        1.0 - 2.0 * (1.0 - base) * (1.0 - blend),
        step(0.5, base)
    );
}

vec3 blend_soft_light(vec3 base, vec3 blend) {
    return mix(
        2.0 * base * blend + base * base * (1.0 - 2.0 * blend),
        sqrt(base) * (2.0 * blend - 1.0) + 2.0 * base * (1.0 - blend),
        step(0.5, blend)
    );
}

//============================================================
// MAIN
//============================================================

out vec4 out_frag_color;

void main() {
    vec2 uv = transform_pixel_to_uv(gl_FragCoord.xy, u_resolution);
    vec2 uv_centered = transform_uv_aspect_correct(uv, u_resolution);
    
    // --- YOUR EFFECT COMPOSITION HERE ---
    
    vec3 color = vec3(0.0);
    
    // Example: gradient background
    color = mix(vec3(0.1, 0.1, 0.2), vec3(0.3, 0.2, 0.4), uv.y);
    
    // Example: add animated circle
    float circle = pattern_circle_sdf(uv_centered, vec2(0.0), 0.3);
    float circle_mask = 1.0 - soft_threshold(circle, 0.0, 0.02);
    color = mix(color, vec3(1.0, 0.5, 0.2), circle_mask);
    
    // Example: post effects
    color = apply_vignette_circular(uv, color, 1.5, 0.3);
    
    // --- END EFFECT COMPOSITION ---
    
    out_frag_color = vec4(color, 1.0);
}
```

## Vertex Shader Template

```glsl
#version 300 es

//============================================================
// ATTRIBUTES
//============================================================

in vec3 a_position;
in vec2 a_texcoord;
in vec3 a_normal;

//============================================================
// UNIFORMS
//============================================================

uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_projection;
uniform mat4 u_normal_matrix;

//============================================================
// VARYINGS (to fragment shader)
//============================================================

out vec2 v_uv;
out vec3 v_normal_ws;
out vec3 v_position_ws;

//============================================================
// MAIN
//============================================================

void main() {
    v_uv = a_texcoord;
    
    vec4 world_pos = u_model * vec4(a_position, 1.0);
    v_position_ws = world_pos.xyz;
    v_normal_ws = normalize((u_normal_matrix * vec4(a_normal, 0.0)).xyz);
    
    gl_Position = u_projection * u_view * world_pos;
}
```
