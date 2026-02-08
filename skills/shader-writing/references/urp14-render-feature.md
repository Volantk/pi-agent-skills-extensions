# URP 14 Render Feature Template

For Unity 2022.3 LTS / URP 14. Uses RTHandle system and current best practices.

## Overview

A Render Feature has two parts:
1. **ScriptableRendererFeature** — config, lifecycle, adds passes to the renderer
2. **ScriptableRenderPass** — executes rendering commands each frame

## Full-Screen Post-Process Render Feature

### C# — Feature + Pass

```csharp
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

//============================================================
// RENDER FEATURE
//============================================================

public class CustomPostProcessFeature : ScriptableRendererFeature
{
    //--------------------------------------------------------
    // SETTINGS
    //--------------------------------------------------------

    [System.Serializable]
    public class Settings
    {
        public RenderPassEvent renderPassEvent = RenderPassEvent.AfterRenderingPostProcessing;
        public Material material;

        [Range(0f, 1f)]
        public float intensity = 1.0f;
    }

    public Settings settings = new Settings();

    private CustomPostProcessPass _pass;

    //--------------------------------------------------------
    // LIFECYCLE
    //--------------------------------------------------------

    public override void Create()
    {
        _pass = new CustomPostProcessPass(settings);
        _pass.renderPassEvent = settings.renderPassEvent;
    }

    public override void AddRenderPasses(ScriptableRenderer renderer, ref RenderingData renderingData)
    {
        if (settings.material == null)
        {
            Debug.LogWarning("CustomPostProcessFeature: Missing material.");
            return;
        }

        // Skip scene view if not needed
        // if (renderingData.cameraData.isSceneViewCamera) return;

        renderer.EnqueuePass(_pass);
    }

    public override void SetupRenderPasses(ScriptableRenderer renderer, in RenderingData renderingData)
    {
        // Called after all passes are enqueued. Safe to access cameraColorTargetHandle here.
        _pass.SetTarget(renderer.cameraColorTargetHandle);
    }

    protected override void Dispose(bool disposing)
    {
        _pass?.Dispose();
    }
}

//============================================================
// RENDER PASS
//============================================================

public class CustomPostProcessPass : ScriptableRenderPass
{
    private readonly CustomPostProcessFeature.Settings _settings;
    private RTHandle _tempRT;
    private RTHandle _sourceRT;

    private static readonly int _intensityId = Shader.PropertyToID("_Intensity");

    //--------------------------------------------------------
    // CONSTRUCTOR
    //--------------------------------------------------------

    public CustomPostProcessPass(CustomPostProcessFeature.Settings settings)
    {
        _settings = settings;
        profilingSampler = new ProfilingSampler("CustomPostProcess");
    }

    public void SetTarget(RTHandle source)
    {
        _sourceRT = source;
    }

    //--------------------------------------------------------
    // SETUP — allocate temp RT
    //--------------------------------------------------------

    public override void OnCameraSetup(CommandBuffer cmd, ref RenderingData renderingData)
    {
        var descriptor = renderingData.cameraData.cameraTargetDescriptor;
        descriptor.depthBufferBits = 0; // No depth needed for post-process blit
        descriptor.msaaSamples = 1;

        RenderingUtils.ReAllocateIfNeeded(
            ref _tempRT,
            descriptor,
            FilterMode.Bilinear,
            TextureWrapMode.Clamp,
            name: "_CustomPostProcessTemp"
        );
    }

    //--------------------------------------------------------
    // EXECUTE — the actual rendering
    //--------------------------------------------------------

    public override void Execute(ScriptableRenderContext context, ref RenderingData renderingData)
    {
        if (_settings.material == null) return;

        CommandBuffer cmd = CommandBufferPool.Get();

        using (new ProfilingScope(cmd, profilingSampler))
        {
            // Set material properties
            _settings.material.SetFloat(_intensityId, _settings.intensity);

            // Blit source -> temp (apply effect)
            Blitter.BlitCameraTexture(cmd, _sourceRT, _tempRT, _settings.material, 0);

            // Blit temp -> source (copy back)
            Blitter.BlitCameraTexture(cmd, _tempRT, _sourceRT);
        }

        context.ExecuteCommandBuffer(cmd);
        CommandBufferPool.Release(cmd);
    }

    //--------------------------------------------------------
    // CLEANUP
    //--------------------------------------------------------

    public override void OnCameraCleanup(CommandBuffer cmd)
    {
        // Per-frame cleanup if needed
    }

    public void Dispose()
    {
        _tempRT?.Release();
    }
}
```

### Shader — Blit-Compatible (URP 14)

URP 14 `Blitter` uses `_BlitTexture` and a full-screen triangle. The vertex shader must use `Blit.hlsl`.

```hlsl
Shader "Custom/PostProcess/CustomEffect"
{
    Properties
    {
        _Intensity ("Intensity", Range(0, 1)) = 1.0
    }

    SubShader
    {
        Tags
        {
            "RenderType" = "Opaque"
            "RenderPipeline" = "UniversalPipeline"
        }

        ZWrite Off
        Cull Off
        ZTest Always

        Pass
        {
            Name "CustomEffect"

            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment frag

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.core/Runtime/Utilities/Blit.hlsl"

            //============================================================
            // UNIFORMS
            //============================================================

            float _Intensity;

            //============================================================
            // UTILITY FUNCTIONS
            //============================================================

            float compute_luminance(float3 color)
            {
                return dot(color, float3(0.2126, 0.7152, 0.0722));
            }

            //============================================================
            // EFFECTS
            //============================================================

            // EFFECT: Grayscale with intensity blend
            // IN: color, intensity (0 = original, 1 = full grayscale)
            // OUT: blended color
            float3 apply_grayscale(float3 color, float intensity)
            {
                float luma = compute_luminance(color);
                return lerp(color, float3(luma, luma, luma), intensity);
            }

            //============================================================
            // FRAGMENT SHADER
            //============================================================

            float4 frag(Varyings input) : SV_Target
            {
                // _BlitTexture and sampler_LinearClamp provided by Blit.hlsl
                float2 uv = input.texcoord;
                float4 color = SAMPLE_TEXTURE2D(_BlitTexture, sampler_LinearClamp, uv);

                // --- YOUR EFFECT COMPOSITION HERE ---

                color.rgb = apply_grayscale(color.rgb, _Intensity);

                // --- END EFFECT COMPOSITION ---

                return color;
            }

            ENDHLSL
        }
    }
}
```

## Geometry Render Feature (Draw objects with override material)

For rendering specific layers/objects with a custom material (outlines, highlights, masks, etc.).

```csharp
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

//============================================================
// RENDER FEATURE
//============================================================

public class CustomGeometryFeature : ScriptableRendererFeature
{
    [System.Serializable]
    public class Settings
    {
        public RenderPassEvent renderPassEvent = RenderPassEvent.AfterRenderingOpaques;
        public Material overrideMaterial;
        public int overrideMaterialPassIndex = 0;
        public LayerMask layerMask = -1;

        [Header("Filtering")]
        public RenderQueueRange renderQueueRange = RenderQueueRange.opaque;
    }

    public Settings settings = new Settings();

    private CustomGeometryPass _pass;

    public override void Create()
    {
        _pass = new CustomGeometryPass(settings);
        _pass.renderPassEvent = settings.renderPassEvent;
    }

    public override void AddRenderPasses(ScriptableRenderer renderer, ref RenderingData renderingData)
    {
        if (settings.overrideMaterial == null) return;
        renderer.EnqueuePass(_pass);
    }
}

//============================================================
// RENDER PASS
//============================================================

public class CustomGeometryPass : ScriptableRenderPass
{
    private readonly CustomGeometryFeature.Settings _settings;
    private FilteringSettings _filteringSettings;
    private readonly ShaderTagId _shaderTagId = new ShaderTagId("UniversalForward");

    public CustomGeometryPass(CustomGeometryFeature.Settings settings)
    {
        _settings = settings;
        _filteringSettings = new FilteringSettings(
            settings.renderQueueRange,
            settings.layerMask
        );
        profilingSampler = new ProfilingSampler("CustomGeometry");
    }

    public override void Execute(ScriptableRenderContext context, ref RenderingData renderingData)
    {
        CommandBuffer cmd = CommandBufferPool.Get();

        using (new ProfilingScope(cmd, profilingSampler))
        {
            context.ExecuteCommandBuffer(cmd);
            cmd.Clear();

            var drawingSettings = CreateDrawingSettings(
                _shaderTagId,
                ref renderingData,
                SortingCriteria.CommonOpaque
            );
            drawingSettings.overrideMaterial = _settings.overrideMaterial;
            drawingSettings.overrideMaterialPassIndex = _settings.overrideMaterialPassIndex;

            context.DrawRenderers(
                renderingData.cullResults,
                ref drawingSettings,
                ref _filteringSettings
            );
        }

        context.ExecuteCommandBuffer(cmd);
        CommandBufferPool.Release(cmd);
    }
}
```

## Render-to-Texture Feature (Render to a separate RTHandle)

For effects that need an intermediate texture (blur passes, custom buffers, etc.).

```csharp
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

//============================================================
// RENDER FEATURE
//============================================================

public class RenderToTextureFeature : ScriptableRendererFeature
{
    [System.Serializable]
    public class Settings
    {
        public RenderPassEvent renderPassEvent = RenderPassEvent.AfterRenderingOpaques;
        public Material material;
        public string globalTextureName = "_CustomBuffer";

        [Header("Texture Settings")]
        public RenderTextureFormat format = RenderTextureFormat.ARGB32;

        [Range(1, 4)]
        public int downsampling = 1;
    }

    public Settings settings = new Settings();

    private RenderToTexturePass _pass;

    public override void Create()
    {
        _pass = new RenderToTexturePass(settings);
        _pass.renderPassEvent = settings.renderPassEvent;
    }

    public override void AddRenderPasses(ScriptableRenderer renderer, ref RenderingData renderingData)
    {
        if (settings.material == null) return;
        renderer.EnqueuePass(_pass);
    }

    public override void SetupRenderPasses(ScriptableRenderer renderer, in RenderingData renderingData)
    {
        _pass.SetSource(renderer.cameraColorTargetHandle);
    }

    protected override void Dispose(bool disposing)
    {
        _pass?.Dispose();
    }
}

//============================================================
// RENDER PASS
//============================================================

public class RenderToTexturePass : ScriptableRenderPass
{
    private readonly RenderToTextureFeature.Settings _settings;
    private RTHandle _targetRT;
    private RTHandle _sourceRT;
    private readonly int _globalTextureId;

    public RenderToTexturePass(RenderToTextureFeature.Settings settings)
    {
        _settings = settings;
        _globalTextureId = Shader.PropertyToID(settings.globalTextureName);
        profilingSampler = new ProfilingSampler("RenderToTexture");
    }

    public void SetSource(RTHandle source)
    {
        _sourceRT = source;
    }

    public override void OnCameraSetup(CommandBuffer cmd, ref RenderingData renderingData)
    {
        var descriptor = renderingData.cameraData.cameraTargetDescriptor;
        descriptor.depthBufferBits = 0;
        descriptor.msaaSamples = 1;
        descriptor.colorFormat = _settings.format;
        descriptor.width /= _settings.downsampling;
        descriptor.height /= _settings.downsampling;

        RenderingUtils.ReAllocateIfNeeded(
            ref _targetRT,
            descriptor,
            FilterMode.Bilinear,
            TextureWrapMode.Clamp,
            name: _settings.globalTextureName
        );
    }

    public override void Execute(ScriptableRenderContext context, ref RenderingData renderingData)
    {
        if (_settings.material == null) return;

        CommandBuffer cmd = CommandBufferPool.Get();

        using (new ProfilingScope(cmd, profilingSampler))
        {
            // Render effect into target RT
            Blitter.BlitCameraTexture(cmd, _sourceRT, _targetRT, _settings.material, 0);

            // Make it available globally to other shaders
            cmd.SetGlobalTexture(_globalTextureId, _targetRT);
        }

        context.ExecuteCommandBuffer(cmd);
        CommandBufferPool.Release(cmd);
    }

    public void Dispose()
    {
        _targetRT?.Release();
    }
}
```

## Multi-Pass Example (Two-Pass Blur)

```csharp
public override void Execute(ScriptableRenderContext context, ref RenderingData renderingData)
{
    CommandBuffer cmd = CommandBufferPool.Get();

    using (new ProfilingScope(cmd, profilingSampler))
    {
        // Pass 0: Horizontal blur — source -> tempA
        _material.SetVector("_BlurDirection", new Vector4(1, 0, 0, 0));
        Blitter.BlitCameraTexture(cmd, _sourceRT, _tempA, _material, 0);

        // Pass 1: Vertical blur — tempA -> tempB
        _material.SetVector("_BlurDirection", new Vector4(0, 1, 0, 0));
        Blitter.BlitCameraTexture(cmd, _tempA, _tempB, _material, 0);

        // Copy result back
        Blitter.BlitCameraTexture(cmd, _tempB, _sourceRT);
    }

    context.ExecuteCommandBuffer(cmd);
    CommandBufferPool.Release(cmd);
}
```

## Setup Checklist

1. **Create the shader** — must use `Blit.hlsl` vertex + `_BlitTexture` for full-screen effects
2. **Create a material** from the shader
3. **Create the C# feature + pass** scripts
4. **Add the feature** to the URP Renderer Asset (Inspector → Add Renderer Feature)
5. **Assign the material** in the feature's settings
6. **Set the render pass event** to control when it runs in the pipeline

## Key URP 14 API Notes

| API | Usage |
|-----|-------|
| `RTHandle` | Replaces `RenderTargetIdentifier` / `RenderTargetHandle`. Auto-scales with dynamic resolution. |
| `RenderingUtils.ReAllocateIfNeeded()` | Allocates or resizes an RTHandle only when needed. Always use over manual `RTHandle.Alloc()`. |
| `Blitter.BlitCameraTexture()` | Replaces `cmd.Blit()`. Uses full-screen triangle, works with RTHandles. |
| `renderer.cameraColorTargetHandle` | Access in `SetupRenderPasses()`, not in `AddRenderPasses()`. |
| `_BlitTexture` | The source texture name used by `Blit.hlsl`. Do NOT use `_MainTex` for blit shaders. |
| `#include ".../Blit.hlsl"` | Provides `Vert` function and `Varyings` struct. Use `#pragma vertex Vert`. |
| `ProfilingScope` | Wrap execute logic for Frame Debugger / RenderDoc visibility. |
| `CommandBufferPool.Get/Release` | Always use pooled command buffers, never `new CommandBuffer()`. |

## Common RenderPassEvent Values

| Event | When |
|-------|------|
| `BeforeRenderingOpaques` | Before opaque geometry |
| `AfterRenderingOpaques` | After opaque, before transparents |
| `BeforeRenderingTransparents` | Just before transparents |
| `AfterRenderingTransparents` | After transparents, before post |
| `BeforeRenderingPostProcessing` | Before Unity's built-in post stack |
| `AfterRenderingPostProcessing` | After Unity's post stack (final image) |
| `AfterRendering` | Very last, after everything |

## Deprecated / Avoid in URP 14

| Deprecated | Use Instead |
|------------|-------------|
| `RenderTargetHandle` | `RTHandle` |
| `cmd.Blit()` | `Blitter.BlitCameraTexture()` |
| `renderer.cameraColorTarget` | `renderer.cameraColorTargetHandle` |
| `RenderTargetIdentifier` | `RTHandle` |
| `ConfigureTarget()` with `RenderTargetIdentifier` | `ConfigureTarget()` with `RTHandle` |
