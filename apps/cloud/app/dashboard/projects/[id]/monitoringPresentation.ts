/** Read-only presentation logic for the Cloud monitoring screen.
 * Consent isn't the same as an inventory: enabled with zero components must
 * never display as if the platform is actively watching something.
 */
export type ComponentKind = "ai-model" | "wordpress-core" | "wordpress-plugin" | "wordpress-theme" | "drupal-package";
export type MonitoredComponent = {
  kind: ComponentKind; id: string; version?: string; evidence: "source-declared"
};
export type MonitoringState = {
  enabled: boolean;
  autoDiscovery: boolean;
  components: MonitoredComponent[];
  discoveredComponents: MonitoredComponent[];
  cmsConnectors: Array<{id:string;cms:string;lastSeenAt:string|null;components:number}>;
  siteHints: Array<{cms:"wordpress"|"drupal";confidence:"likely"|"possible";lastSeenAt:string}>;
  alerts: Array<{
    identity:string;provider:string;componentId:string;status:string;scope:string;
    summary:string;sourceUrl:string;effectiveDate:string|null;lastSeenAt:string;
  }>;
  feeds: Array<{provider:string;checkedAt:string;successAt:string|null;errorCode:string|null}>;
};

export function monitoringOverview(state: MonitoringState) {
  // Manual and scan inventories can contain the same technology. Count once,
  // but preserve both evidence sources on the detailed list.
  const uniqueSource = new Set([...state.components,...state.discoveredComponents].map(c => c.kind + ":" + c.id));
  const sourceCount = uniqueSource.size;
  const installedCount = state.cmsConnectors.reduce((total, site) =>
    total + Math.max(0,Number.isFinite(site.components) ? site.components : 0),0);
  const total = sourceCount + installedCount;
  const pendingSites = state.cmsConnectors.filter(site => !site.lastSeenAt).length;
  const failingFeeds = state.feeds.filter(feed => Boolean(feed.errorCode));
  const title = total > 0
    ? "Monitoring enabled"
    : pendingSites > 0
      ? "Waiting for your website's first sync"
      : state.enabled
        ? "Ready, but nothing to monitor yet"
        : "Nothing being monitored yet";
  const description = total > 0
    ? "Ship Check has an inventory to compare with relevant provider notices. Source declarations still need production verification."
    : pendingSites > 0
      ? "Your website is connected. Its first inventory has not arrived yet."
      : state.enabled
        ? "Monitoring is switched on, but no technologies have been identified. Add some from a scan or a connected website."
        : "Start with a scan or connect a WordPress or Drupal website. No code or repository access is needed for Cloud monitoring.";
  return {total,sourceCount,installedCount,pendingSites,failingFeeds,title,description,hasInventory:total>0};
}
