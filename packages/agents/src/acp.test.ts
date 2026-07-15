import { describe, expect, it } from 'vitest';

import { BUILT_IN_ACP_CONFIG, getBuiltInAcpConfig, hasBuiltInAcpConfig } from './acp.js';
import { getProviderCliRuntimeSpec } from './providers/providerCliRuntime.js';

describe('built-in ACP config', () => {
  it('keeps the built-in ACP allowlist explicit and drift-free', () => {
    expect(Object.keys(BUILT_IN_ACP_CONFIG).sort()).toEqual(['customAcp', 'devpilot', 'kiro']);
  });

  it('exposes DevPilot as a built-in ACP stdio provider', () => {
    expect(hasBuiltInAcpConfig('devpilot')).toBe(true);
    expect(getBuiltInAcpConfig('devpilot')).toMatchObject({
      agentId: 'devpilot',
      launcher: {
        command: getProviderCliRuntimeSpec('devpilot').binaryName,
        args: ['acp', '--stdio'],
      },
      supportsLoadSession: true,
      supportsModes: 'yes',
      supportsModels: 'yes',
    });
  });

  it('exposes Custom ACP as a built-in generic ACP agent family', () => {
    expect(hasBuiltInAcpConfig('customAcp')).toBe(true);
    expect(getBuiltInAcpConfig('customAcp')).toMatchObject({
      agentId: 'customAcp',
      launcher: {
        command: getProviderCliRuntimeSpec('customAcp').binaryName,
        args: [],
      },
      transportProfile: 'generic',
      supportsLoadSession: true,
      supportsModes: 'auto',
      supportsModels: 'auto',
      promptImageSupport: 'auto',
    });
  });

  it('exposes Kiro as a built-in generic ACP agent', () => {
    expect(hasBuiltInAcpConfig('kiro')).toBe(true);
    expect(getBuiltInAcpConfig('kiro')).toMatchObject({
      agentId: 'kiro',
      launcher: {
        command: getProviderCliRuntimeSpec('kiro').binaryName,
        args: ['acp'],
      },
      transportProfile: 'kiro',
      supportsLoadSession: true,
      supportsModes: 'yes',
      supportsModels: 'yes',
      promptImageSupport: 'yes',
    });
  });

  it('does not mark non-ACP shell-bridge providers as built-in ACP', () => {
    expect(hasBuiltInAcpConfig('gemini')).toBe(false);
    expect(hasBuiltInAcpConfig('pi')).toBe(false);
  });
});
