'use strict';

/*
 * preload.js
 * The only bridge between the original web page and the desktop shell.
 * Deliberately narrow: no fs, no child_process, no arbitrary paths, no shell.
 * The page can only hand over *bytes plus a suggested file name*; the main
 * process decides where they land, after the user picked a location.
 */

const { contextBridge, ipcRenderer } = require('electron');

const api = {
  /** Save one image through the native "Save as" dialog. */
  saveSingle: (record) => ipcRenderer.invoke('nmo:save-single', record),

  /** Pick a target folder once, for "All" and batch exports. */
  beginBatch: (options) => ipcRenderer.invoke('nmo:begin-batch', options || {}),

  /** Write one already generated image into the folder chosen by beginBatch. */
  writeBatchFile: (token, record) => ipcRenderer.invoke('nmo:write-batch-file', token, record),

  /** Close a batch session and get the totals for the UI. */
  endBatch: (token) => ipcRenderer.invoke('nmo:end-batch', token),

  /** Open an explicitly whitelisted https/http link in the system browser. */
  openExternal: (url) => ipcRenderer.invoke('nmo:open-external', url),

  /** Build identity shown in the desktop status bar / evidence. */
  getBuildInfo: () => ipcRenderer.invoke('nmo:build-info'),

  /* ---- agent activity: let the page show "AI 正在做什么" ---- */
  getAgentState: () => ipcRenderer.invoke('nmo:agent-state'),
  onAgentActivity: (callback) => {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('nmo:agent-activity', (event, payload) => callback(payload));
  },

  /** Every network request the app attempted, for the offline audit. */
  getNetworkLog: () => ipcRenderer.invoke('nmo:network-log'),

  chooseExportDir: () => ipcRenderer.invoke('nmo:choose-dir'),

  /* ---- planned export: numbers are reserved before any byte is written ---- */
  planExport: (request) => ipcRenderer.invoke('nmo:plan-export', request || {}),
  writePlanFile: (token, record) => ipcRenderer.invoke('nmo:write-plan-file', token, record),
  endPlan: (token, mode, releaseSourceKeys) =>
    ipcRenderer.invoke('nmo:end-plan', token, mode, releaseSourceKeys || []),

  /* ---- parameter presets (settings only) ---- */
  readCurrent: () => ipcRenderer.invoke("nmo:current-read"),
  saveCurrent: data => ipcRenderer.sendSync("nmo:current-save",data),
  getPresets: () => ipcRenderer.invoke('nmo:presets-get'),
  savePreset: (payload) => ipcRenderer.invoke('nmo:presets-save', payload || {}),
  renamePreset: (payload) => ipcRenderer.invoke('nmo:presets-rename', payload || {}),
  deletePreset: (name) => ipcRenderer.invoke('nmo:presets-delete', name)
};

contextBridge.exposeInMainWorld('nmoDesktop', Object.freeze(api));
