import {describe,expect,it} from "vitest";
import {monitoringOverview, type MonitoringState} from "./monitoringPresentation";

function state(changes:Partial<MonitoringState>={}):MonitoringState {
  return {
    enabled:false,autoDiscovery:false,
    components:[],discoveredComponents:[],cmsConnectors:[],siteHints:[],alerts:[],feeds:[],
    ...changes
  };
}
const model={kind:"ai-model" as const,id:"gpt-5",evidence:"source-declared" as const};

describe("monitoring experience",()=>{
  it("does not label an empty but consented project as actively monitored",()=>{
    expect(monitoringOverview(state({enabled:true}))).toMatchObject({
      total:0,hasInventory:false,title:"Ready, but nothing to monitor yet"
    });
  });
  it("presents a genuine not-yet-enabled empty state",()=>{
    expect(monitoringOverview(state())).toMatchObject({
      total:0,hasInventory:false,title:"Nothing being monitored yet"
    });
  });
  it("deduplicates manual and source-declared component identifiers",()=>{
    const result=monitoringOverview(state({
      enabled:true,components:[model],discoveredComponents:[model]
    }));
    expect(result).toMatchObject({total:1,sourceCount:1,hasInventory:true,title:"Monitoring enabled"});
  });
  it("separates public CMS hints from verified inventory",()=>{
    const result=monitoringOverview(state({
      enabled:true,
      siteHints:[{cms:"wordpress",confidence:"likely",lastSeenAt:"2026-11-18T12:00:00.000Z"}]
    }));
    expect(result.total).toBe(0);
    expect(result.hasInventory).toBe(false);
  });
  it("shows a connected site with no first sync as waiting, not monitoring software",()=>{
    const result=monitoringOverview(state({
      enabled:true,
      cmsConnectors:[{id:"site",cms:"drupal",lastSeenAt:null,components:0}]
    }));
    expect(result).toMatchObject({
      pendingSites:1,total:0,title:"Waiting for your website's first sync"
    });
  });
  it("counts verified site inventory independently and flags feed outages",()=>{
    const result=monitoringOverview(state({
      enabled:true,components:[model],
      cmsConnectors:[{id:"site",cms:"wordpress",lastSeenAt:"2026-11-18T12:00:00Z",components:4}],
      feeds:[{provider:"drupal",checkedAt:"2026-11-18T12:00:00Z",successAt:null,errorCode:"unavailable"}]
    }));
    expect(result).toMatchObject({sourceCount:1,installedCount:4,total:5,hasInventory:true});
    expect(result.failingFeeds).toHaveLength(1);
  });
});
