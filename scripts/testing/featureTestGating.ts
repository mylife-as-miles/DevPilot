/**
 * DevPilot's imported desktop workspace has no hosted-feature test matrix.
 * Keep the Vitest configuration self-contained while leaving an explicit seam
 * for desktop feature exclusions if a gated feature is introduced later.
 */
export function resolveVitestFeatureTestExcludeGlobs(): string[] {
    return [];
}
