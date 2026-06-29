"use strict";
var edaEsbuildExportName = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  var src_exports = {};
  __export(src_exports, {
    about: () => about,
    activate: () => activate,
    diagnoseLocalMcp: () => diagnoseLocalMcp,
    exportAllJson: () => exportAllJson,
    exportPcbJson: () => exportPcbJson,
    exportSchJson: () => exportSchJson,
    startLiveBridge: () => startLiveBridge
  });

  var EXTENSION_UUID = "44codexexport0000000000000000001";
  var EXTENSION_VERSION = "0.4.4";
  var EXTENSION_SOURCE = "extension-live044";
  var BASE_URL = "http://127.0.0.1:38425";
  var EXPORT_URL = BASE_URL + "/api/jlceda/export";
  var HEALTH_URL = BASE_URL + "/health";
  var PROBE_URL = BASE_URL + "/api/jlceda/probe";
  var LIVE_SCRIPT_URL = BASE_URL + "/api/jlceda/standalone-live-script";

  function safeStringify(value) {
    try {
      return JSON.stringify(value);
    } catch (error) {
      return String(value);
    }
  }

  function clone(value) {
    if (value === undefined) return null;
    if (value === null) return null;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
    if (value instanceof Error) return errorRecord(value);
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      return String(value);
    }
  }

  function errorRecord(error) {
    return {
      name: error && error.name ? error.name : undefined,
      message: error && error.message ? error.message : String(error),
      stack: error && error.stack ? error.stack : undefined
    };
  }

  function stamp() {
    return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
  }

  function rawProbe(eventName, extra) {
    try {
      var params = [
        "version=" + encodeURIComponent(EXTENSION_VERSION),
        "event=" + encodeURIComponent(eventName),
        "source=" + encodeURIComponent(EXTENSION_SOURCE),
        "href=" + encodeURIComponent(typeof location !== "undefined" ? String(location.href) : ""),
        "extra=" + encodeURIComponent(safeStringify(extra || null)),
        "t=" + encodeURIComponent(String(Date.now()))
      ].join("&");
      var url = PROBE_URL + "?" + params;
      if (typeof navigator !== "undefined" && navigator.sendBeacon) {
        try {
          navigator.sendBeacon(url);
        } catch (ignored) {
        }
      }
      if (typeof fetch === "function") {
        fetch(url, { method: "GET", mode: "no-cors", cache: "no-store" }).catch(function () {});
      }
      if (typeof XMLHttpRequest !== "undefined") {
        var xhr = new XMLHttpRequest();
        xhr.open("GET", url, true);
        xhr.send();
      }
      if (typeof eda !== "undefined" && eda.sys_ClientUrl && typeof eda.sys_ClientUrl.request === "function") {
        var result = eda.sys_ClientUrl.request(url);
        if (result && typeof result.catch === "function") result.catch(function () {});
      }
    } catch (error) {
    }
  }

  function showInfo(message, title) {
    try {
      if (typeof eda !== "undefined" && eda.sys_Dialog && typeof eda.sys_Dialog.showInformationMessage === "function") {
        eda.sys_Dialog.showInformationMessage(message, title || "Codex JLCEDA Export Bridge");
        return;
      }
      if (typeof eda !== "undefined" && eda.sys_MessageBox && typeof eda.sys_MessageBox.showInformationMessage === "function") {
        eda.sys_MessageBox.showInformationMessage(message, title || "Codex JLCEDA Export Bridge");
        return;
      }
      if (typeof eda !== "undefined" && eda.sys_Message && typeof eda.sys_Message.showToastMessage === "function") {
        eda.sys_Message.showToastMessage(message, "info");
        return;
      }
      if (typeof alert === "function") {
        alert((title ? title + "\n\n" : "") + message);
        return;
      }
      if (typeof console !== "undefined" && console.log) console.log((title ? title + ": " : "") + message);
    } catch (error) {
    }
  }

  function toast(message, type) {
    try {
      if (typeof eda !== "undefined" && eda.sys_Message && typeof eda.sys_Message.showToastMessage === "function") {
        eda.sys_Message.showToastMessage(message, type || "info");
        return;
      }
      if (typeof console !== "undefined" && console.log) console.log(message);
    } catch (error) {
    }
  }

  function callbackProbe(name) {
    rawProbe("callback-" + name, { version: EXTENSION_VERSION });
  }

  function getEdaApi() {
    if (typeof eda !== "undefined") return eda;
    if (typeof globalThis !== "undefined" && globalThis.eda) return globalThis.eda;
    return null;
  }

  async function tryCall(label, fn) {
    try {
      return { ok: true, label, value: clone(await fn()) };
    } catch (error) {
      return { ok: false, label, error: errorRecord(error) };
    }
  }

  async function tryRawCall(label, fn) {
    try {
      return { ok: true, label, value: await fn() };
    } catch (error) {
      return { ok: false, label, error: errorRecord(error) };
    }
  }

  async function runDrc(kind, api) {
    var out = { kind, available: !!(api && typeof api.check === "function"), attempts: [] };
    if (!out.available) return out;
    var detailed = await tryCall(kind + ".check(true,false,true)", function () {
      return api.check(true, false, true);
    });
    out.attempts.push(detailed);
    if (detailed.ok) {
      out.passed = Array.isArray(detailed.value) ? detailed.value.length === 0 : !!detailed.value;
      out.verbose = detailed.value;
      return out;
    }
    var uiFree = await tryCall(kind + ".check(true,false,false)", function () {
      return api.check(true, false, false);
    });
    out.attempts.push(uiFree);
    out.passed = uiFree.ok ? !!uiFree.value : null;
    out.verbose = uiFree.ok ? uiFree.value : null;
    return out;
  }

  function bytesToBase64(bytes) {
    var binary = "";
    for (var i = 0; i < bytes.length; i += 32768) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 32768)));
    }
    return btoa(binary);
  }

  function isTextLikeFile(file) {
    var name = String(file && file.name || "");
    var type = String(file && file.type || "");
    return /\.(csv|json|net|txt|xml)$/i.test(name) || /^text\//i.test(type) || /json|xml/i.test(type);
  }

  function isLikelyTextBytes(file, bytes) {
    if (!bytes || !bytes.length) return true;
    if (bytes.length >= 4 && bytes[0] === 80 && bytes[1] === 75 && bytes[2] === 3 && bytes[3] === 4) return false;
    if (isTextLikeFile(file)) return true;
    var control = 0;
    var limit = Math.min(bytes.length, 2048);
    for (var i = 0; i < limit; i += 1) {
      var b = bytes[i];
      if (b === 0) return false;
      if (b < 9 || b > 13 && b < 32) control += 1;
    }
    return control / limit < 0.05;
  }

  async function fileRecord(file) {
    if (!file) return null;
    var out = {
      name: file.name || null,
      type: file.type || null,
      size: typeof file.size === "number" ? file.size : null,
      lastModified: file.lastModified || null,
      encoding: null,
      binary: false,
      base64: null,
      text: null
    };
    try {
      if (typeof file.arrayBuffer === "function") {
        var bytes = new Uint8Array(await file.arrayBuffer());
        out.encoding = "base64";
        out.binary = !isLikelyTextBytes(file, bytes);
        out.base64 = bytesToBase64(bytes);
        if (!out.binary && typeof TextDecoder !== "undefined") out.text = new TextDecoder("utf-8").decode(bytes);
      } else if (typeof file.text === "function") {
        out.text = await file.text();
        out.encoding = "text";
        out.binary = out.text.indexOf("PK\u0003\u0004") === 0;
      } else {
        out.text = String(file);
        out.encoding = "text";
      }
    } catch (error) {
      out.error = errorRecord(error);
    }
    return out;
  }

  async function getSchManufacture() {
    var out = {};
    if (!eda.sch_ManufactureData) return out;
    if (typeof eda.sch_ManufactureData.getNetlistFile === "function") {
      var netlist = await tryRawCall("sch_ManufactureData.getNetlistFile", async function () {
        var type = typeof ESYS_NetlistType !== "undefined" && ESYS_NetlistType && ESYS_NetlistType.Protel2 ? ESYS_NetlistType.Protel2 : undefined;
        try {
          return await eda.sch_ManufactureData.getNetlistFile("codex-sch-" + stamp() + ".net", type);
        } catch (error) {
          return await eda.sch_ManufactureData.getNetlistFile("codex-sch-" + stamp() + ".net");
        }
      });
      out.netlist = netlist.ok ? await fileRecord(netlist.value) : netlist;
    }
    if (typeof eda.sch_ManufactureData.getBomFile === "function") {
      var bom = await tryRawCall("sch_ManufactureData.getBomFile", function () {
        return eda.sch_ManufactureData.getBomFile("codex-sch-bom-" + stamp() + ".csv", "csv");
      });
      out.bom = bom.ok ? await fileRecord(bom.value) : bom;
    }
    return out;
  }

  async function getPcbManufacture() {
    var out = {};
    if (!eda.pcb_ManufactureData) return out;
    if (typeof eda.pcb_ManufactureData.getNetlistFile === "function") {
      var netlist = await tryRawCall("pcb_ManufactureData.getNetlistFile", async function () {
        var type = typeof ESYS_NetlistType !== "undefined" && ESYS_NetlistType && ESYS_NetlistType.Protel2 ? ESYS_NetlistType.Protel2 : undefined;
        try {
          return await eda.pcb_ManufactureData.getNetlistFile("codex-pcb-" + stamp() + ".net", type);
        } catch (error) {
          return await eda.pcb_ManufactureData.getNetlistFile("codex-pcb-" + stamp() + ".net");
        }
      });
      out.netlist = netlist.ok ? await fileRecord(netlist.value) : netlist;
    }
    return out;
  }

  async function collectExport(scope) {
    var normalizedScope = scope === "sch" || scope === "pcb" || scope === "all" ? scope : "all";
    var payload = {
      schemaVersion: "jlceda-codex-export/v0.1",
      exportedAt: new Date().toISOString(),
      extension: {
        uuid: EXTENSION_UUID,
        version: EXTENSION_VERSION,
        mode: "extension"
      },
      scope: normalizedScope,
      environment: {
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
        location: typeof location !== "undefined" ? String(location.href) : null
      },
      drc: {},
      manufacture: {}
    };
    if (normalizedScope === "sch" || normalizedScope === "all") {
      payload.drc.sch = await runDrc("sch_Drc", eda.sch_Drc);
      payload.manufacture.sch = await getSchManufacture();
    }
    if (normalizedScope === "pcb" || normalizedScope === "all") {
      payload.drc.pcb = await runDrc("pcb_Drc", eda.pcb_Drc);
      payload.manufacture.pcb = await getPcbManufacture();
    }
    return payload;
  }

  async function responseJson(response) {
    if (!response) return null;
    if (typeof response.json === "function") {
      try {
        return await response.json();
      } catch (error) {
      }
    }
    if (typeof response.text === "function") {
      var text = await response.text();
      try {
        return JSON.parse(text);
      } catch (error) {
        return { text: text };
      }
    }
    return clone(response);
  }

  async function postToLocalBridge(payload) {
    var json = JSON.stringify(payload, null, 2);
    var name = "jlceda-codex-export-" + stamp() + "-" + payload.scope + ".json";
    if (typeof eda !== "undefined" && eda.sys_ClientUrl && typeof eda.sys_ClientUrl.request === "function" && typeof FormData !== "undefined" && typeof File !== "undefined") {
      var formData = new FormData();
      formData.append("file", new File([json], name, { type: "application/json;charset=utf-8" }));
      formData.append("type", "jlceda-codex-export");
      formData.append("scope", payload.scope);
      formData.append("timestamp", Date.now().toString());
      var response = await eda.sys_ClientUrl.request(EXPORT_URL, "POST", formData);
      var body = await responseJson(response);
      return { ok: !!(response && response.ok) || !!(body && body.success), response: body };
    }
    if (typeof fetch === "function") {
      var fetchResponse = await fetch(EXPORT_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: json
      });
      var fetchBody = await responseJson(fetchResponse);
      return { ok: fetchResponse.ok && !!(fetchBody && fetchBody.success), response: fetchBody };
    }
    throw new Error("No local HTTP request API is available.");
  }

  async function saveFallback(payload) {
    if (!(typeof eda !== "undefined" && eda.sys_FileSystem && typeof eda.sys_FileSystem.saveFile === "function" && typeof File !== "undefined")) return false;
    var json = JSON.stringify(payload, null, 2);
    var file = new File([json], "jlceda-codex-export-" + stamp() + "-" + payload.scope + ".json", { type: "application/json" });
    await eda.sys_FileSystem.saveFile(file);
    return true;
  }

  async function exportJson(scope) {
    callbackProbe("export-" + scope);
    try {
      toast("Codex JSON export started: " + scope, "info");
      var payload = await collectExport(scope);
      rawProbe("export-collected", { scope: scope });
      var posted = await postToLocalBridge(payload);
      if (posted.ok) {
        rawProbe("export-post-ok", { scope: scope, response: posted.response || null });
        toast("Codex JSON exported to local MCP", "success");
        return posted;
      }
      payload.localBridgePost = posted;
      await saveFallback(payload);
      rawProbe("export-post-failed", { scope: scope, response: posted.response || posted });
      showInfo("Local MCP POST failed. A JSON save fallback was attempted.\n\n" + safeStringify(posted.response || posted), "Codex Export Bridge");
      return posted;
    } catch (error) {
      var err = errorRecord(error);
      try {
        var fallbackPayload = {
          schemaVersion: "jlceda-codex-export/v0.1",
          exportedAt: new Date().toISOString(),
          extension: { uuid: EXTENSION_UUID, version: EXTENSION_VERSION, mode: "extension-error" },
          scope: scope,
          error: err
        };
        await saveFallback(fallbackPayload);
      } catch (ignored) {
      }
      showInfo(JSON.stringify(err, null, 2), "Codex Export Failed");
      rawProbe("export-error", { scope: scope, error: err });
      return { ok: false, error: err };
    }
  }

  async function requestText(url) {
    if (typeof eda !== "undefined" && eda.sys_ClientUrl && typeof eda.sys_ClientUrl.request === "function") {
      var response = await eda.sys_ClientUrl.request(url);
      if (response && typeof response.text === "function") return await response.text();
      if (typeof response === "string") return response;
      if (response && typeof response.data === "string") return response.data;
      if (response && typeof response.body === "string") return response.body;
      throw new Error("sys_ClientUrl returned a non-text response for " + url);
    }
    if (typeof fetch === "function") {
      var fetchResponse = await fetch(url, { cache: "no-store" });
      return await fetchResponse.text();
    }
    throw new Error("No local HTTP request API is available.");
  }

  async function diagnoseLocalMcp() {
    callbackProbe("diagnoseLocalMcp");
    try {
      var response = typeof eda !== "undefined" && eda.sys_ClientUrl && typeof eda.sys_ClientUrl.request === "function"
        ? await eda.sys_ClientUrl.request(HEALTH_URL)
        : await fetch(HEALTH_URL, { cache: "no-store" });
      var body = await responseJson(response);
      showInfo(JSON.stringify(body || response, null, 2), "Codex Local MCP Diagnostics");
    } catch (error) {
      showInfo(JSON.stringify(errorRecord(error), null, 2), "Codex Local MCP Diagnostics");
    }
  }

  async function startLiveBridge() {
    callbackProbe("startLiveBridge");
    try {
      var edaApi = getEdaApi();
      if (!edaApi) throw new Error("JLCEDA eda API is unavailable in extension callback scope.");
      if (typeof globalThis !== "undefined") {
        try {
          if (!globalThis.eda) globalThis.eda = edaApi;
        } catch (ignored) {
        }
      }
      var script = await requestText(LIVE_SCRIPT_URL + "?version=" + encodeURIComponent(EXTENSION_VERSION) + "&t=" + Date.now());
      var runner = new Function("eda", script + "\n//# sourceURL=codex-live-bridge-" + EXTENSION_VERSION + ".js");
      runner(edaApi);
      rawProbe("live-script-eval-ok", { version: EXTENSION_VERSION, length: script.length });
      toast("Codex live bridge script started", "success");
    } catch (error) {
      rawProbe("live-script-eval-error", { error: errorRecord(error) });
      showInfo(JSON.stringify(errorRecord(error), null, 2), "Codex Live Bridge Failed");
    }
  }

  function exportSchJson() {
    return exportJson("sch");
  }

  function exportPcbJson() {
    return exportJson("pcb");
  }

  function exportAllJson() {
    return exportJson("all");
  }

  function about() {
    callbackProbe("about");
    showInfo([
      "Codex JLCEDA Export Bridge " + EXTENSION_VERSION,
      "",
      "Verified menu callbacks and local MCP beacon diagnostics.",
      "UUID: " + EXTENSION_UUID,
      "Export endpoint: " + EXPORT_URL,
      "Live script endpoint: " + LIVE_SCRIPT_URL
    ].join("\n"), "Codex JLCEDA Export Bridge");
  }

  function activate(status, arg) {
    rawProbe("activate", { status: status || "", arg: arg || "" });
  }

  rawProbe("module-loaded");
  return __toCommonJS(src_exports);
})();
