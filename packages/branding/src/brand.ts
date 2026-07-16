export const brand = Object.freeze({
  productName: 'DevPilot',
  shortName: 'DevPilot',
  desktopCliName: 'devpilot-app',
  desktopDevCliName: 'devpilot-app-dev',
  runtimeCliName: 'devpilot',
  description: 'Autonomous software research and engineering',
  repository: 'https://github.com/mylife-as-miles/DevPilot',
  runtimeRepository: 'https://github.com/mylife-as-miles/DevPilot',
  issuesUrl: 'https://github.com/mylife-as-miles/DevPilot/issues',
  desktopIdentifier: 'com.devpilot.desktop',
  deepLinkScheme: 'devpilot',
} as const);

export type DevPilotBrand = typeof brand;
