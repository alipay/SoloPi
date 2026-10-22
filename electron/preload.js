// Explicit IPC surface. Never expose Node, Electron, or raw IPC events.
const { contextBridge, ipcRenderer, webUtils } = require('electron');
const channels = new Set([
  "solopi:current", "solopi:record-start", "solopi:record-stop", "solopi:record-discard", "solopi:convert", "solopi:select-file",
  "team-config:devices", "team-config:status", "team-config:validate", "team-config:import", "team-config:export", "team-config:onboarding",
  "agent:performance", "agent:request-policy", "agent:save-request-policy", "agent:compare-model", "agent:comparison", "agent:stop-comparison", "preview:frame-ack", "agent:models", "agent:select-model", "agent:mirror-targets", "agent:mirror-start", "agent:mirror-stop", "agent:list", "agent:create", "agent:get", "agent:call-details", "agent:send", "agent:edit-queued", "agent:delete-queued", "agent:steer-queued", "agent:approval-mode", "agent:approve", "agent:stop", "agent:extensions", "agent:extension-inventory", "agent:skill-detail", "agent:test-mcp", "agent:save-extensions",
  "bugreport:pick", "bugreport:start", "bugreport:status", "bugreport:current", "bugreport:cancel", "bugreport:history", "bugreport:open-report", "bugreport:reveal-source",
  "adb:list-devices",
  "adb:list-packages",
  "mobile-ui:inspect",
  "mobile-ui:debug-step",
  "performance:list-devices",
  "adb:install-apk",
  "performance:list-packages",
  "performance:get-package-version",
  "performance:sample",
  "performance:crashes-start", "performance:crashes-get", "performance:crashes-stop",
  "adb:read-sdk-env",
  "adb:set-sdk-env",
  "adb:get-package-version",
  "adb:launch-test-page",
  "adb:logcat-start",
  "adb:logcat-stop",
  "adb:scrcpy-start", "preview:targets", "preview:start", "preview:stop", "preview:close",
  "scrcpy:check",
  "workflow:stop",
  "workflow-task:submit", "workflow-task:creation-event",
  "workflow:run",
  "workflow:validate-task-selection",
  "workflow:set-header-devices",
  "workflow-report:finalize-task",
  "workflow-state:load",
  "workflow-state:save",
  "workflow-case:update-failed",
  "workflow-task:list",
  "workflow-task:clean",
  "workflow-task:stop",
  "workflow-report:load-task",
  "workflow-report:delete-task-detail",
  "workflow-report:export-package",
  "workflow-report:open-package",
  "llm:test-provider",
  "llm:chat",
  "dialog:select-audio-file",
  "dialog:select-apk-file",
  "dialog:select-image-file",
  "dialog:select-image-files",
  "audio:save-recording",
  "audio:create-preview",
  "adb:enable-phone-keeplog",
  "logs:pull-and-decode",
  "quick-actions:list",
  "quick-actions:import-git",
  "quick-actions:export-git",
  "quick-actions:visibility",
  "quick-actions:import-script",
  "quick-actions:update",
  "quick-actions:remove",
  "quick-actions:reorder",
  "quick-actions:select-path",
  "quick-actions:query",
  "quick-actions:execute",
  "shell:open-path",
  "shell:show-item-in-folder",
  "file:save-text",
  "file:read-image-data-url",
  "shell:open-external",
  "environment:get-config",
  "environment:save-config",
  "tts:test-provider",
  "case-library:check-git-lfs",
  "case-library:install-git-lfs-homebrew",
  "case-library:pull-git-repo",
  "case-library:reload-local",
  "case-library:check-apply",
  "case-library:push-git-repo"
]);
const events = new Set(['settings:workflow-update', 'settings:environment-updated', 'team-config:progress','team-config:changed','agent:comparison','quick-actions:changed', 'agent:environment-update', 'agent:configuration-update', 'agent:mirror-frame', 'agent:changed', 'workflow-case:update', 'workflow-task:changed', 'workflow:progress', 'case-library:local-changed', 'adb:logcat-state']);
const listeners = new Map();
contextBridge.exposeInMainWorld('glassbox', {
  ipcRenderer: {
    invoke(channel, ...args) {
      if (!channels.has(channel)) return Promise.reject(new Error('Unsupported IPC channel'));
      return ipcRenderer.invoke(channel, ...args);
    },
    on(channel, callback) {
      if (!events.has(channel) || typeof callback !== 'function') throw new Error('Unsupported IPC event');
      let callbacks = listeners.get(channel);
      if (!callbacks) listeners.set(channel, callbacks = new Map());
      if (callbacks.has(callback)) return;
      const listener = (_event, ...args) => callback(null, ...args);
      callbacks.set(callback, listener);
      ipcRenderer.on(channel, listener);
    },
    removeListener(channel, callback) {
      const callbacks = listeners.get(channel);
      const listener = callbacks?.get(callback);
      if (listener) ipcRenderer.removeListener(channel, listener);
      callbacks?.delete(callback);
    },
  },
  webUtils: { getPathForFile: (file) => webUtils.getPathForFile(file) },
});
