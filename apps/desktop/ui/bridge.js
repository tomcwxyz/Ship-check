function invokeCommand(command, args) {
  const invoke = window.__TAURI__?.core?.invoke;
  if (typeof invoke !== "function") {
    throw new Error("Ship Check's desktop bridge is unavailable. Open this surface from the installed desktop app.");
  }
  return invoke(command, args);
}

export const desktopBridge = {
  chooseProject() {
    return invokeCommand("choose_project");
  },

  engineStatus() {
    return invokeCommand("engine_status");
  },

  scanProject(projectPath, packs) {
    return invokeCommand("scan_project", {
      request: {
        projectPath,
        packs,
      },
    });
  },

  scanGithubRepository(repository, gitRef, packs) {
    return invokeCommand("scan_github_repository", {
      request: {
        repository,
        gitRef: gitRef || null,
        packs,
      },
    });
  },
};
