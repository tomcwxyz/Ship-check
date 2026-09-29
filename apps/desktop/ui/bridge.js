function invokeCommand(command, args) {
  const invoke = window.__TAURI__?.core?.invoke;
  if (typeof invoke !== "function") {
    throw new Error("Ship Check's desktop bridge is unavailable. Open this surface from the installed desktop app.");
  }
  return invoke(command, args);
}

function commonScanRequest(packs, options = {}, databaseConnectionString = "") {
  const databaseInspection = Boolean(options.databaseInspection);
  return {
    deploymentUrl: options.deploymentUrl?.trim() || null,
    packs,
    localSemgrepScan: Boolean(options.localSemgrepScan),
    networkedDependencyScan: Boolean(options.networkedDependencyScan),
    inspectDatabase: databaseInspection,
    databaseConnectionString: databaseInspection ? databaseConnectionString.trim() || null : null,
    databasePlatform: databaseInspection ? options.databasePlatform || "postgres" : null,
    databaseTableLimit: databaseInspection ? Number(options.databaseTableLimit || 1000) : null,
  };
}

export const desktopBridge = {
  chooseProject() {
    return invokeCommand("choose_project");
  },

  chooseProjectArchive() {
    return invokeCommand("choose_project_archive");
  },

  chooseEstate() {
    return invokeCommand("choose_estate");
  },

  engineStatus() {
    return invokeCommand("engine_status");
  },

  scanProject(projectPath, packs, options = {}, databaseConnectionString = "") {
    return invokeCommand("scan_project", {
      request: {
        projectPath,
        ...commonScanRequest(packs, options, databaseConnectionString),
      },
    });
  },

  scanEstate(projectPath, packs, options = {}) {
    return invokeCommand("scan_estate", {
      request: {
        projectPath,
        packs,
        maxDepth: Number(options.maxDepth ?? 3),
        localSemgrepScan: Boolean(options.localSemgrepScan),
        networkedDependencyScan: Boolean(options.networkedDependencyScan),
      },
    });
  },

  scanGithubRepository(repository, gitRef, packs, options = {}, databaseConnectionString = "") {
    return invokeCommand("scan_github_repository", {
      request: {
        repository,
        gitRef: gitRef || null,
        ...commonScanRequest(packs, options, databaseConnectionString),
      },
    });
  },
};
