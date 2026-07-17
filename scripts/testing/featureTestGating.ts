/**
 * DevPilot's imported desktop workspace has no hosted-feature test matrix.
 * Keep the Vitest configuration self-contained. The session-control baseline
 * test consumes fixtures from the deliberately excluded upstream
 * `packages/tests` workspace, so it cannot run in this desktop closure.
 */
export function resolveVitestFeatureTestExcludeGlobs(): string[] {
    return [
        '**/sessionControl/baselines.test.ts',
    ];
}
