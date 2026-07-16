import { describe, expect, it, vi } from 'vitest';

import { resolveDevPilotAcpLaunch } from './resolveDevPilotAcpLaunch';

describe('resolveDevPilotAcpLaunch', () => {
  it('turns a discovered executable into the exact ACP stdio invocation', () => {
    const discover = vi.fn(() => ({
      runtime: {
        command: 'C:\\runtime\\devpilot.exe',
        argsPrefix: [],
        kind: 'executable' as const,
        source: 'repository-virtual-environment' as const,
        repositoryPath: 'C:\\runtime',
        virtualEnvironmentPath: 'C:\\runtime\\.venv',
      },
      searchedPaths: [],
      detectedPythonInstallations: [],
      detectedVirtualEnvironments: [],
      repositoryPath: 'C:\\runtime',
    }));

    expect(resolveDevPilotAcpLaunch({
      env: { DEVPILOT_DESKTOP_ROOT: 'C:\\desktop' },
      discover,
    })).toEqual({
      command: 'C:\\runtime\\devpilot.exe',
      args: ['acp', '--stdio'],
      runtimeSource: 'repository-virtual-environment',
    });
    expect(discover).toHaveBeenCalledWith(expect.objectContaining({
      desktopRoot: 'C:\\desktop',
    }));
  });

  it('passes the explicit user path into discovery', () => {
    const discover = vi.fn(() => ({
      runtime: {
        command: '/opt/devpilot',
        argsPrefix: [],
        kind: 'executable' as const,
        source: 'configured' as const,
        repositoryPath: null,
        virtualEnvironmentPath: null,
      },
      searchedPaths: [],
      detectedPythonInstallations: [],
      detectedVirtualEnvironments: [],
      repositoryPath: '/work/DevPilot',
    }));

    resolveDevPilotAcpLaunch({
      env: { DEVPILOT_EXECUTABLE_PATH: '/opt/devpilot' },
      desktopRoot: '/work/DevPilot',
      discover,
    });

    expect(discover).toHaveBeenCalledWith(expect.objectContaining({
      configuredExecutablePath: '/opt/devpilot',
    }));
  });

  it('surfaces actionable discovery guidance instead of installing a runtime', () => {
    const discover = vi.fn(() => ({
      runtime: null,
      searchedPaths: ['/work/DevPilot/.venv/bin/devpilot'],
      detectedPythonInstallations: [],
      detectedVirtualEnvironments: [],
      repositoryPath: '/work/DevPilot',
    }));

    expect(() => resolveDevPilotAcpLaunch({
      desktopRoot: '/work/DevPilot',
      env: {},
      discover,
    })).toThrow(/manual executable path/i);
  });
});
