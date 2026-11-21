export type OverlayConfig = { base: string; site: string; token: string; dashboardUrl: string };

export function start(config: OverlayConfig): void | Promise<void> {}
