const path = require('node:path');

// Keep this module dependency-free so it can run in GitHub Actions before `yarn install`.
// We load the canonical release ring catalog from the checked-in CJS entrypoint.
const releaseRings = require(path.resolve(__dirname, '..', '..', 'packages', 'release-runtime', 'releaseRings.cjs'));
const { getReleaseRingCatalogEntry, normalizeReleaseRingId } = releaseRings;

function resolveLogicalVariantFromRing(ring) {
    if (ring.expoAppEnv === 'production') return 'production';
    if (ring.expoAppEnv === 'development') return 'development';
    return 'preview';
}

function buildRingBackedConfig(ringId, overrides) {
    const ring = getReleaseRingCatalogEntry(ringId);
    return {
        id: ringId,
        logicalVariant: resolveLogicalVariantFromRing(ring),
        name: overrides.name,
        iosBundleId: overrides.iosBundleId,
        androidPackage: overrides.androidPackage,
        scheme: overrides.scheme,
        updatesChannel: ring.expoUpdatesChannel,
        featurePolicyEnv: ring.embeddedPolicyEnv,
        enableAssociatedDomains: overrides.enableAssociatedDomains,
    };
}

function buildProductionConfig(overrides) {
    const ring = getReleaseRingCatalogEntry('stable');
    return {
        id: 'production',
        logicalVariant: 'production',
        name: overrides.name,
        iosBundleId: overrides.iosBundleId,
        androidPackage: overrides.androidPackage,
        scheme: overrides.scheme,
        updatesChannel: ring.expoUpdatesChannel,
        featurePolicyEnv: ring.embeddedPolicyEnv,
        enableAssociatedDomains: overrides.enableAssociatedDomains,
    };
}

const APP_ENVIRONMENT_CONFIGS = {
    internaldev: buildRingBackedConfig('internaldev', {
        name: 'DevPilot (internal dev)',
        iosBundleId: 'com.devpilot.desktop.internaldev',
        androidPackage: 'com.devpilot.desktop.internaldev',
        scheme: 'devpilot-internaldev',
        enableAssociatedDomains: false,
    }),
    internalpreview: buildRingBackedConfig('internalpreview', {
        name: 'DevPilot (internal preview)',
        iosBundleId: 'com.devpilot.desktop.internalpreview',
        androidPackage: 'com.devpilot.desktop.internalpreview',
        scheme: 'devpilot-internalpreview',
        enableAssociatedDomains: false,
    }),
    publicdev: buildRingBackedConfig('publicdev', {
        name: 'DevPilot (dev)',
        iosBundleId: 'com.devpilot.desktop.dev',
        androidPackage: 'com.devpilot.desktop.dev',
        scheme: 'devpilot-dev',
        enableAssociatedDomains: false,
    }),
    preview: buildRingBackedConfig('preview', {
        name: 'DevPilot (preview)',
        iosBundleId: 'com.devpilot.desktop.preview',
        androidPackage: 'com.devpilot.desktop.preview',
        scheme: 'devpilot-preview',
        enableAssociatedDomains: false,
    }),
    production: buildProductionConfig({
        name: 'DevPilot',
        iosBundleId: 'com.devpilot.desktop',
        androidPackage: 'com.devpilot.desktop',
        scheme: 'devpilot',
        enableAssociatedDomains: false,
    }),
};

function normalizeAppEnvironmentId(raw) {
    const value = String(raw ?? '').trim().toLowerCase();
    if (!value) return '';
    if (Object.prototype.hasOwnProperty.call(APP_ENVIRONMENT_CONFIGS, value)) {
        return value;
    }

    const ring = normalizeReleaseRingId(value);
    if (!ring) return '';
    return ring === 'stable' ? 'production' : ring;
}

function getAppEnvironmentConfig(raw) {
    const normalized = normalizeAppEnvironmentId(raw) || 'internaldev';
    return APP_ENVIRONMENT_CONFIGS[normalized];
}

module.exports = {
    APP_ENVIRONMENT_CONFIGS,
    getAppEnvironmentConfig,
    normalizeAppEnvironmentId,
};
