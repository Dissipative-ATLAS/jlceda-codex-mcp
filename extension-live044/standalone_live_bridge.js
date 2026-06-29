// Paste this file into JLCPCB EDA Pro: Advanced -> Run Script.
// It starts the same live WebSocket bridge without using the extension loader.
(function () {
  const extensionUuid = "44codexexport0000000000000000001";
  const extensionVersion = "0.4.4";
  const activationUrl = "http://127.0.0.1:38425/api/jlceda/activation";
  const bridgeWsUrl = "ws://127.0.0.1:38426/bridge/ws";
  const reconnectMs = 1500;
  const heartbeatMs = 2000;

  let socketId = "";
  let connected = false;
  let autoExportSent = false;
  let reconnectTimer = null;
  let heartbeatTimer = null;
  const clientId = "codex_jlceda_standalone_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);

  function toast(message, type) {
    try {
      if (eda.sys_Message && eda.sys_Message.showToastMessage) {
        eda.sys_Message.showToastMessage(message, type || "info");
      } else {
        console.log(message);
      }
    } catch (error) {
      console.log(message);
    }
  }

  function errObj(error) {
    return {
      name: error && error.name ? error.name : undefined,
      message: error && error.message ? error.message : String(error),
      stack: error && error.stack ? error.stack : undefined
    };
  }

  function clone(value) {
    if (value === undefined) return null;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      return String(value);
    }
  }

  function stamp() {
    return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
  }

  async function activation(eventName, extra) {
    try {
      if (!eda.sys_ClientUrl || typeof eda.sys_ClientUrl.request !== "function") return;
      const query = [
        "version=" + encodeURIComponent(extensionVersion),
        "event=" + encodeURIComponent(eventName),
        "mode=standalone-live",
        "clientId=" + encodeURIComponent(clientId),
        "href=" + encodeURIComponent(typeof location !== "undefined" ? String(location.href) : ""),
        "t=" + encodeURIComponent(String(Date.now()))
      ].join("&");
      await eda.sys_ClientUrl.request(activationUrl + "?" + query);
    } catch (error) {
      console.warn("Codex activation probe failed", error);
    }
  }

  function bytesToBase64(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 32768) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 32768)));
    }
    return btoa(binary);
  }

  function isTextLikeFile(file) {
    const name = String(file && file.name || "");
    const type = String(file && file.type || "");
    return /\.(csv|json|net|txt|xml)$/i.test(name) || /^text\//i.test(type) || /json|xml/i.test(type);
  }

  function isLikelyTextBytes(file, bytes) {
    if (!bytes || !bytes.length) return true;
    if (bytes.length >= 4 && bytes[0] === 80 && bytes[1] === 75 && bytes[2] === 3 && bytes[3] === 4) return false;
    if (isTextLikeFile(file)) return true;
    let control = 0;
    const limit = Math.min(bytes.length, 2048);
    for (let i = 0; i < limit; i += 1) {
      const b = bytes[i];
      if (b === 0) return false;
      if (b < 9 || (b > 13 && b < 32)) control += 1;
    }
    return control / limit < 0.05;
  }

  async function fileRecord(file) {
    if (!file) return null;
    const out = {
      name: file.name || null,
      type: file.type || null,
      size: typeof file.size === "number" ? file.size : null,
      encoding: null,
      binary: false,
      base64: null,
      text: null
    };
    try {
      if (typeof file.arrayBuffer === "function") {
        const bytes = new Uint8Array(await file.arrayBuffer());
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
      out.error = errObj(error);
    }
    return out;
  }

  async function tryCall(label, fn) {
    try {
      return { ok: true, label, value: clone(await fn()) };
    } catch (error) {
      return { ok: false, label, error: errObj(error) };
    }
  }

  async function tryRawCall(label, fn) {
    try {
      return { ok: true, label, value: await fn() };
    } catch (error) {
      return { ok: false, label, error: errObj(error) };
    }
  }

  async function runDrc(kind, api) {
    const out = { kind, available: !!(api && typeof api.check === "function"), attempts: [] };
    if (!out.available) return out;
    const detailed = await tryCall(kind + ".check(true,false,true)", () => api.check(true, false, true));
    out.attempts.push(detailed);
    if (detailed.ok) {
      out.passed = Array.isArray(detailed.value) ? detailed.value.length === 0 : !!detailed.value;
      out.verbose = detailed.value;
      return out;
    }
    const fallback = await tryCall(kind + ".check(true,false,false)", () => api.check(true, false, false));
    out.attempts.push(fallback);
    out.passed = fallback.ok ? !!fallback.value : null;
    out.verbose = fallback.ok ? fallback.value : null;
    return out;
  }

  async function manufactureSch() {
    const out = {};
    if (!eda.sch_ManufactureData) return out;
    if (typeof eda.sch_ManufactureData.getNetlistFile === "function") {
      const result = await tryRawCall("sch_ManufactureData.getNetlistFile", async () => {
        const netlistType = typeof ESYS_NetlistType !== "undefined" && ESYS_NetlistType && ESYS_NetlistType.Protel2 ? ESYS_NetlistType.Protel2 : undefined;
        try {
          return await eda.sch_ManufactureData.getNetlistFile("codex-sch-" + stamp() + ".net", netlistType);
        } catch (error) {
          return await eda.sch_ManufactureData.getNetlistFile("codex-sch-" + stamp() + ".net");
        }
      });
      out.netlist = result.ok ? await fileRecord(result.value) : result;
    }
    if (typeof eda.sch_ManufactureData.getBomFile === "function") {
      const result = await tryRawCall("sch_ManufactureData.getBomFile", () => eda.sch_ManufactureData.getBomFile("codex-sch-bom-" + stamp() + ".csv", "csv"));
      out.bom = result.ok ? await fileRecord(result.value) : result;
    }
    return out;
  }

  async function manufacturePcb() {
    const out = {};
    if (!eda.pcb_ManufactureData) return out;
    if (typeof eda.pcb_ManufactureData.getNetlistFile === "function") {
      const result = await tryRawCall("pcb_ManufactureData.getNetlistFile", async () => {
        const netlistType = typeof ESYS_NetlistType !== "undefined" && ESYS_NetlistType && ESYS_NetlistType.Protel2 ? ESYS_NetlistType.Protel2 : undefined;
        try {
          return await eda.pcb_ManufactureData.getNetlistFile("codex-pcb-" + stamp() + ".net", netlistType);
        } catch (error) {
          return await eda.pcb_ManufactureData.getNetlistFile("codex-pcb-" + stamp() + ".net");
        }
      });
      out.netlist = result.ok ? await fileRecord(result.value) : result;
    }
    return out;
  }

  async function collectExport(scope) {
    const normalizedScope = scope === "sch" || scope === "pcb" || scope === "all" ? scope : "all";
    const payload = {
      schemaVersion: "jlceda-codex-export/v0.1",
      exportedAt: new Date().toISOString(),
      extension: {
        uuid: extensionUuid,
        version: extensionVersion,
        mode: "standalone-live"
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
      payload.manufacture.sch = await manufactureSch();
    }
    if (normalizedScope === "pcb" || normalizedScope === "all") {
      payload.drc.pcb = await runDrc("pcb_Drc", eda.pcb_Drc);
      payload.manufacture.pcb = await manufacturePcb();
    }
    return payload;
  }

  function send(message) {
    if (!socketId || !eda.sys_WebSocket || typeof eda.sys_WebSocket.send !== "function") {
      throw new Error("eda.sys_WebSocket.send is unavailable.");
    }
    eda.sys_WebSocket.send(socketId, JSON.stringify(message));
  }

  async function handleExport(message) {
    const requestId = String(message && message.requestId || "");
    try {
      toast("Codex standalone live export started", "info");
      const payload = await collectExport(String(message && message.scope || "all"));
      send({ type: "exportResult", clientId, requestId, ok: true, payload });
      toast("Codex standalone live export sent", "success");
    } catch (error) {
      send({ type: "exportResult", clientId, requestId, ok: false, error: errObj(error) });
    }
  }

  function handleMessage(event) {
    try {
      const raw = event && event.data !== undefined ? event.data : event;
      const message = JSON.parse(typeof raw === "string" ? raw : String(raw));
      if (message.type === "welcome" || message.type === "pong") {
        connected = true;
        return;
      }
      if (message.type === "export") {
        handleExport(message);
      }
    } catch (error) {
      console.error("Codex standalone live bridge message error", error);
    }
  }

  function cleanup() {
    connected = false;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (socketId && eda.sys_WebSocket && typeof eda.sys_WebSocket.close === "function") {
      try {
        eda.sys_WebSocket.close(socketId, 1000, "codex standalone live bridge restart");
      } catch (error) {
        console.warn(error);
      }
    }
    socketId = "";
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      connect();
    }, reconnectMs);
  }

  function connect() {
    if (!eda.sys_WebSocket || typeof eda.sys_WebSocket.register !== "function") {
      toast("eda.sys_WebSocket.register is unavailable in this context", "error");
      activation("standaloneLiveNoWebSocket", {});
      return;
    }
    socketId = clientId + "_" + Date.now();
    try {
      activation("standaloneLiveConnectAttempt", { socketId });
      eda.sys_WebSocket.register(
        socketId,
        bridgeWsUrl,
        handleMessage,
        function () {
          connected = true;
          activation("standaloneLiveConnected", { socketId });
          send({ type: "hello", clientId, version: extensionVersion, mode: "standalone-live" });
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          heartbeatTimer = setInterval(function () {
            try {
              send({ type: "ping", clientId, sentAt: Date.now() });
            } catch (error) {
              cleanup();
              scheduleReconnect();
            }
          }, heartbeatMs);
          if (!autoExportSent) {
            autoExportSent = true;
            setTimeout(function () {
              handleExport({ requestId: "standalone_auto_" + Date.now(), scope: "all" });
            }, 800);
          }
          toast("Codex standalone live bridge connected", "success");
        }
      );
    } catch (error) {
      activation("standaloneLiveConnectError", errObj(error));
      toast("Codex standalone live bridge failed: " + (error && error.message ? error.message : String(error)), "error");
      cleanup();
      scheduleReconnect();
    }
  }

  if (globalThis.codexJlcStandaloneLiveStop) {
    try {
      globalThis.codexJlcStandaloneLiveStop();
    } catch (error) {
      console.warn(error);
    }
  }
  globalThis.codexJlcStandaloneLiveStop = cleanup;
  globalThis.codexJlcStandaloneLiveExportOnce = function (scope) {
    return collectExport(scope || "all");
  };

  activation("standaloneLiveStart", {});
  connect();
})();
