# Unity HLSL Template

For Unity URP (Universal Render Pipeline) and Built-in.

## URP Unlit Shader

```hlsl
Shader "Custom/TemplateUnlit"
{
    //============================================================
    // PROPERTIES
    //============================================================
    Properties
    {
        _MainTex ("Texture", 2D) = "white" {}
        _Color ("Color", Color) = (1, 1, 1, 1)
        _Intensity ("Intensity", Range(0, 2)) = 1.0
    }

    SubShader
    {
        Tags 
        { 
            "RenderType" = "Opaque" 
            "RenderPipeline" = "UniversalPipeline"
            "Queue" = "Geometry"
        }
        
        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode" = "UniversalForward" }

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            //============================================================
            // CBUFFER (SRP Batcher compatible)
            //============================================================
            
            CBUFFER_START(UnityPerMaterial)
                float4 _MainTex_ST;
                float4 _Color;
                float _Intensity;
            CBUFFER_END

            TEXTURE2D(_MainTex);
            SAMPLER(sampler_MainTex);

            //============================================================
            // CONSTANTS
            //============================================================
            
            static const float PI = 3.14159265359;
            static const float TAU = 6.28318530718;
            static const float EPSILON = 0.0001;

            //============================================================
            // STRUCTS
            //============================================================

            struct Attributes
            {
                float4 positionOS : POSITION;
                float2 uv : TEXCOORD0;
                float3 normalOS : NORMAL;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv : TEXCOORD0;
                float3 positionWS : TEXCOORD1;
                float3 normalWS : TEXCOORD2;
            };

            //============================================================
            // UTILITY FUNCTIONS
            //============================================================

            float remap_range(float value, float inMin, float inMax, float outMin, float outMax)
            {
                return outMin + (value - inMin) * (outMax - outMin) / (inMax - inMin);
            }

            float saturate_01(float x)
            {
                return saturate(x); // HLSL built-in
            }

            float soft_threshold(float value, float edge, float softness)
            {
                return smoothstep(edge - softness, edge + softness, value);
            }

            //============================================================
            // COORDINATE TRANSFORMS
            //============================================================

            float2 transform_uv_rotate(float2 uv, float angleRadians, float2 pivot)
            {
                float2 offset = uv - pivot;
                float s = sin(angleRadians);
                float c = cos(angleRadians);
                return float2(offset.x * c - offset.y * s, offset.x * s + offset.y * c) + pivot;
            }

            float2 transform_uv_scale(float2 uv, float2 scale, float2 pivot)
            {
                return (uv - pivot) / scale + pivot;
            }

            float2 transform_uv_tile(float2 uv, float2 tiles)
            {
                return frac(uv * tiles);
            }

            //============================================================
            // NOISE & PATTERNS
            //============================================================

            float hash_2d_to_1d(float2 p)
            {
                return frac(sin(dot(p, float2(127.1, 311.7))) * 43758.5453123);
            }

            float2 hash_2d_to_2d(float2 p)
            {
                return frac(sin(float2(dot(p, float2(127.1, 311.7)), dot(p, float2(269.5, 183.3)))) * 43758.5453);
            }

            float noise_value_2d(float2 p)
            {
                float2 i = floor(p);
                float2 f = frac(p);
                float2 u = f * f * (3.0 - 2.0 * f);
                
                float a = hash_2d_to_1d(i + float2(0.0, 0.0));
                float b = hash_2d_to_1d(i + float2(1.0, 0.0));
                float c = hash_2d_to_1d(i + float2(0.0, 1.0));
                float d = hash_2d_to_1d(i + float2(1.0, 1.0));
                
                return lerp(lerp(a, b, u.x), lerp(c, d, u.x), u.y);
            }

            float pattern_checkerboard(float2 uv, float scale)
            {
                float2 grid = floor(uv * scale);
                return fmod(grid.x + grid.y, 2.0);
            }

            float pattern_circle_sdf(float2 uv, float2 center, float radius)
            {
                return length(uv - center) - radius;
            }

            //============================================================
            // COLOR OPERATIONS
            //============================================================

            float compute_luminance(float3 color)
            {
                return dot(color, float3(0.2126, 0.7152, 0.0722));
            }

            float3 apply_contrast(float3 color, float contrast)
            {
                return (color - 0.5) * contrast + 0.5;
            }

            float3 apply_saturation(float3 color, float saturationAmount)
            {
                float luma = compute_luminance(color);
                return lerp(float3(luma, luma, luma), color, saturationAmount);
            }

            //============================================================
            // EFFECTS
            //============================================================

            // EFFECT: Vignette
            // IN: uv (0-1), color
            // OUT: color darkened at edges
            float3 apply_vignette_circular(float2 uv, float3 color, float intensity, float softness)
            {
                float distFromCenter = length(uv - 0.5);
                float vignetteMask = 1.0 - smoothstep(0.5 - softness, 0.5, distFromCenter * intensity);
                return color * vignetteMask;
            }

            // EFFECT: Film grain
            // IN: uv, time, color
            // OUT: color with noise grain overlay
            float3 apply_film_grain(float2 uv, float time, float3 color, float intensity)
            {
                float grain = hash_2d_to_1d(uv * 1000.0 + time) * 2.0 - 1.0;
                return color + grain * intensity;
            }

            //============================================================
            // BLENDING
            //============================================================

            float3 blend_add(float3 base, float3 blend)
            {
                return min(base + blend, 1.0);
            }

            float3 blend_multiply(float3 base, float3 blend)
            {
                return base * blend;
            }

            float3 blend_screen(float3 base, float3 blend)
            {
                return 1.0 - (1.0 - base) * (1.0 - blend);
            }

            float3 blend_overlay(float3 base, float3 blend)
            {
                return lerp(
                    2.0 * base * blend,
                    1.0 - 2.0 * (1.0 - base) * (1.0 - blend),
                    step(0.5, base)
                );
            }

            //============================================================
            // VERTEX SHADER
            //============================================================

            Varyings vert(Attributes input)
            {
                Varyings output;
                
                VertexPositionInputs posInputs = GetVertexPositionInputs(input.positionOS.xyz);
                VertexNormalInputs normInputs = GetVertexNormalInputs(input.normalOS);
                
                output.positionCS = posInputs.positionCS;
                output.positionWS = posInputs.positionWS;
                output.normalWS = normInputs.normalWS;
                output.uv = TRANSFORM_TEX(input.uv, _MainTex);
                
                return output;
            }

            //============================================================
            // FRAGMENT SHADER
            //============================================================

            float4 frag(Varyings input) : SV_Target
            {
                float2 uv = input.uv;
                
                // --- YOUR EFFECT COMPOSITION HERE ---
                
                float4 texColor = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, uv);
                float3 color = texColor.rgb * _Color.rgb;
                
                // Example: add intensity
                color *= _Intensity;
                
                // Example: post effects
                color = apply_vignette_circular(uv, color, 1.5, 0.3);
                
                // --- END EFFECT COMPOSITION ---
                
                return float4(color, texColor.a * _Color.a);
            }

            ENDHLSL
        }
    }
}
```

## URP Lit Shader (Surface-style)

```hlsl
Shader "Custom/TemplateLit"
{
    Properties
    {
        _BaseMap ("Base Map", 2D) = "white" {}
        _BaseColor ("Base Color", Color) = (1, 1, 1, 1)
        _Metallic ("Metallic", Range(0, 1)) = 0.0
        _Smoothness ("Smoothness", Range(0, 1)) = 0.5
        _BumpMap ("Normal Map", 2D) = "bump" {}
        _BumpScale ("Normal Scale", Float) = 1.0
    }

    SubShader
    {
        Tags 
        { 
            "RenderType" = "Opaque" 
            "RenderPipeline" = "UniversalPipeline"
        }

        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode" = "UniversalForward" }

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE
            #pragma multi_compile _ _ADDITIONAL_LIGHTS
            #pragma multi_compile _ _SHADOWS_SOFT
            
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            //============================================================
            // CBUFFER
            //============================================================

            CBUFFER_START(UnityPerMaterial)
                float4 _BaseMap_ST;
                float4 _BaseColor;
                float _Metallic;
                float _Smoothness;
                float _BumpScale;
            CBUFFER_END

            TEXTURE2D(_BaseMap);        SAMPLER(sampler_BaseMap);
            TEXTURE2D(_BumpMap);        SAMPLER(sampler_BumpMap);

            //============================================================
            // STRUCTS
            //============================================================

            struct Attributes
            {
                float4 positionOS : POSITION;
                float2 uv : TEXCOORD0;
                float3 normalOS : NORMAL;
                float4 tangentOS : TANGENT;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv : TEXCOORD0;
                float3 positionWS : TEXCOORD1;
                float3 normalWS : TEXCOORD2;
                float4 tangentWS : TEXCOORD3;
                float3 viewDirWS : TEXCOORD4;
            };

            //============================================================
            // LIGHTING HELPERS
            //============================================================

            float3 sample_normal_map(float2 uv, float3 normalWS, float4 tangentWS, float scale)
            {
                float3 normalTS = UnpackNormalScale(SAMPLE_TEXTURE2D(_BumpMap, sampler_BumpMap, uv), scale);
                float3 bitangent = tangentWS.w * cross(normalWS, tangentWS.xyz);
                float3x3 TBN = float3x3(tangentWS.xyz, bitangent, normalWS);
                return normalize(mul(normalTS, TBN));
            }

            //============================================================
            // VERTEX SHADER
            //============================================================

            Varyings vert(Attributes input)
            {
                Varyings output;
                
                VertexPositionInputs posInputs = GetVertexPositionInputs(input.positionOS.xyz);
                VertexNormalInputs normInputs = GetVertexNormalInputs(input.normalOS, input.tangentOS);
                
                output.positionCS = posInputs.positionCS;
                output.positionWS = posInputs.positionWS;
                output.uv = TRANSFORM_TEX(input.uv, _BaseMap);
                output.normalWS = normInputs.normalWS;
                output.tangentWS = float4(normInputs.tangentWS, input.tangentOS.w);
                output.viewDirWS = GetWorldSpaceViewDir(posInputs.positionWS);
                
                return output;
            }

            //============================================================
            // FRAGMENT SHADER
            //============================================================

            float4 frag(Varyings input) : SV_Target
            {
                // Sample textures
                float4 baseColor = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, input.uv) * _BaseColor;
                float3 normalWS = sample_normal_map(input.uv, input.normalWS, input.tangentWS, _BumpScale);
                
                // Setup lighting input
                InputData lightingInput = (InputData)0;
                lightingInput.positionWS = input.positionWS;
                lightingInput.normalWS = normalWS;
                lightingInput.viewDirectionWS = normalize(input.viewDirWS);
                lightingInput.shadowCoord = TransformWorldToShadowCoord(input.positionWS);
                
                // Setup surface data
                SurfaceData surfaceData = (SurfaceData)0;
                surfaceData.albedo = baseColor.rgb;
                surfaceData.alpha = baseColor.a;
                surfaceData.metallic = _Metallic;
                surfaceData.smoothness = _Smoothness;
                surfaceData.normalTS = float3(0, 0, 1);
                surfaceData.occlusion = 1.0;
                
                // Calculate lighting
                float4 color = UniversalFragmentPBR(lightingInput, surfaceData);
                
                return color;
            }

            ENDHLSL
        }
        
        // Shadow caster pass
        UsePass "Universal Render Pipeline/Lit/ShadowCaster"
    }
}
```

## Built-in Pipeline (Legacy)

```hlsl
Shader "Custom/TemplateLegacy"
{
    Properties
    {
        _MainTex ("Texture", 2D) = "white" {}
        _Color ("Color", Color) = (1, 1, 1, 1)
    }

    SubShader
    {
        Tags { "RenderType" = "Opaque" }

        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            
            #include "UnityCG.cginc"

            //============================================================
            // UNIFORMS
            //============================================================

            sampler2D _MainTex;
            float4 _MainTex_ST;
            float4 _Color;

            //============================================================
            // STRUCTS
            //============================================================

            struct appdata
            {
                float4 vertex : POSITION;
                float2 uv : TEXCOORD0;
                float3 normal : NORMAL;
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
                float2 uv : TEXCOORD0;
                float3 worldNormal : TEXCOORD1;
                float3 worldPos : TEXCOORD2;
            };

            //============================================================
            // UTILITY FUNCTIONS  
            //============================================================

            float soft_threshold(float value, float edge, float softness)
            {
                return smoothstep(edge - softness, edge + softness, value);
            }

            //============================================================
            // VERTEX SHADER
            //============================================================

            v2f vert(appdata v)
            {
                v2f o;
                o.pos = UnityObjectToClipPos(v.vertex);
                o.uv = TRANSFORM_TEX(v.uv, _MainTex);
                o.worldNormal = UnityObjectToWorldNormal(v.normal);
                o.worldPos = mul(unity_ObjectToWorld, v.vertex).xyz;
                return o;
            }

            //============================================================
            // FRAGMENT SHADER
            //============================================================

            float4 frag(v2f i) : SV_Target
            {
                float4 color = tex2D(_MainTex, i.uv) * _Color;
                return color;
            }

            ENDCG
        }
    }
}
```

## GLSL to HLSL Cheat Sheet

| GLSL | HLSL |
|------|------|
| `vec2/3/4` | `float2/3/4` |
| `mat2/3/4` | `float2x2/3x3/4x4` |
| `mix()` | `lerp()` |
| `fract()` | `frac()` |
| `mod()` | `fmod()` |
| `texture()` | `SAMPLE_TEXTURE2D()` |
| `in/out/inout` | same |
| `gl_FragCoord` | `SV_Position` |
