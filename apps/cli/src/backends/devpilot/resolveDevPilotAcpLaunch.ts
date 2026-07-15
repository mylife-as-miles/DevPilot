import {
  buildDevPilotAcpInvocation,
  discoverDevPilotRuntime,
  formatRuntimeNotFoundGuidance,
} from '@devpilot/runtime';

type DiscoverRuntime = typeof discoverDevPilotRuntime;

export function resolveDevPilotAcpLaunch(params: Readonly<{
  env: NodeJS.ProcessEnv;
  desktopRoot?: string;
  discover?: DiscoverRuntime;
}>): Readonly<{
  command: string;
  args: readonly string[];
  runtimeSource: NonNullable<ReturnType<DiscoverRuntime>['runtime']>['source'];
}> {
  const discover = params.discover ?? discoverDevPilotRuntime;
  const configuredExecutablePath =
    params.env.DEVPILOT_EXECUTABLE_PATH?.trim()
    || params.env.HAPPIER_DEVPILOT_PATH?.trim()
    || null;
  const desktopRoot =
    params.desktopRoot
    || params.env.DEVPILOT_DESKTOP_ROOT?.trim()
    || process.cwd();
  const result = discover({
    configuredExecutablePath,
    desktopRoot,
    env: params.env,
  });
  if (!result.runtime) {
    throw new Error(formatRuntimeNotFoundGuidance(result));
  }

  const invocation = buildDevPilotAcpInvocation(result.runtime);
  return Object.freeze({
    command: invocation.command,
    args: invocation.args,
    runtimeSource: result.runtime.source,
  });
}
