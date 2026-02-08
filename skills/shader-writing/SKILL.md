---
name: shader-writing
description: Write clearly structured GLSL and HLSL shaders. Supports generic GLSL and Unity HLSL. Uses self-documenting function names, composable effect blocks, and LLM-friendly conventions. Invoke with target format (glsl, unity-hlsl).
---

# Shader Writing

Write shaders that are readable, composable, and self-documenting.

## Usage

User specifies format: `glsl` or `unity-hlsl`

## Core Principles

### 1. Function Names Are Comments

Bad:
```glsl
float f(float x) { return x * x * (3.0 - 2.0 * x); }
```

Good:
```glsl
float smoothstep_cubic_ease(float edge0_to_edge1_normalized) {
    float t = edge0_to_edge1_normalized;
    return t * t * (3.0 - 2.0 * t);
}
```

### 2. Explicit Data Flow

Functions declare their intent through naming:
- `compute_*` - pure calculation, no side effects
- `sample_*` - texture reads
- `transform_*` - coordinate/space transformations  
- `blend_*` - mixing operations
- `apply_*` - applies an effect to input
- `get_*` - retrieves a value/property
- `is_*` / `has_*` - boolean checks

### 3. Composable Effect Blocks

Each effect is a self-contained function with clear inputs/outputs:

```glsl
// EFFECT: Vignette
// IN: uv (0-1), color
// OUT: color with vignette applied
vec3 apply_vignette_circular(vec2 uv, vec3 color, float intensity, float softness) {
    float dist_from_center = length(uv - 0.5);
    float vignette_mask = 1.0 - smoothstep(0.5 - softness, 0.5, dist_from_center * intensity);
    return color * vignette_mask;
}
```

### 4. Section Structure

```glsl
//============================================================
// SECTION NAME
//============================================================
```

Shader sections in order:
1. DEFINES & COMPATIBILITY
2. UNIFORMS / PROPERTIES
3. CONSTANTS
4. UTILITY FUNCTIONS
5. COORDINATE TRANSFORMS
6. NOISE & PATTERNS
7. LIGHTING
8. EFFECTS
9. MAIN / FRAGMENT / VERTEX

## Templates & References

See references for full templates:
- [GLSL Template](references/glsl-template.md)
- [Unity HLSL Template](references/unity-hlsl-template.md)
- [URP 14 Render Feature](references/urp14-render-feature.md) — ScriptableRendererFeature + Pass setup, Blit-compatible shaders, RTHandle API

## Quick Reference

### Parameter Naming

| Suffix | Meaning |
|--------|---------|
| `_uv` | Texture coordinates (0-1) |
| `_ndc` | Normalized device coordinates (-1 to 1) |
| `_ws` | World space |
| `_os` | Object space |
| `_vs` | View space |
| `_ts` | Tangent space |
| `_01` | Normalized 0-1 range |
| `_normalized` | Unit length or 0-1 |

### Common Patterns

**Remap value:**
```glsl
float remap_range(float value, float in_min, float in_max, float out_min, float out_max) {
    return out_min + (value - in_min) * (out_max - out_min) / (in_max - in_min);
}
```

**Soft threshold:**
```glsl
float soft_threshold(float value, float edge, float softness) {
    return smoothstep(edge - softness, edge + softness, value);
}
```

**Rotate UV:**
```glsl
vec2 transform_uv_rotate(vec2 uv, float angle_radians, vec2 pivot) {
    vec2 offset = uv - pivot;
    float s = sin(angle_radians);
    float c = cos(angle_radians);
    return vec2(offset.x * c - offset.y * s, offset.x * s + offset.y * c) + pivot;
}
```
