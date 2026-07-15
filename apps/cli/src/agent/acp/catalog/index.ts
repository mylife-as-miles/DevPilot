import type { AgentCatalogEntry } from '@/backends/types';

import { createCatalogDefinedAcpEntry } from './createCatalogDefinedAcpEntry';

export const BUILT_IN_CATALOG_DEFINED_ACP_AGENTS = {
  devpilot: createCatalogDefinedAcpEntry('devpilot'),
  customAcp: createCatalogDefinedAcpEntry('customAcp'),
  kiro: createCatalogDefinedAcpEntry('kiro'),
} as const satisfies Record<'devpilot' | 'customAcp' | 'kiro', AgentCatalogEntry>;
