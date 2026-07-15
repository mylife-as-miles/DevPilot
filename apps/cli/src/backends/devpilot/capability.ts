import { createAcpCliCapability } from '@/capabilities/probes/createAcpCliCapability';
import { resolveAcpCatalogTransportHandler } from '@/agent/acp/catalog/transport/resolveAcpCatalogTransportHandler';

import { resolveDevPilotAcpLaunch } from './resolveDevPilotAcpLaunch';

export const cliCapability = createAcpCliCapability({
  agentId: 'devpilot',
  title: 'DevPilot CLI',
  acpArgs: ['acp', '--stdio'],
  transport: resolveAcpCatalogTransportHandler('generic'),
  resolveAcpProbeLaunch: () => {
    const launch = resolveDevPilotAcpLaunch({ env: process.env });
    return { command: launch.command, args: launch.args };
  },
});
