// Paste into JLCPCB EDA Pro: Advanced -> Run Script.
// This script is self-contained and reports whether the JLCEDA script environment
// can reach the local Codex bridge and use WebSocket APIs.
(async function () {
  const base = "http://127.0.0.1:38425";
  const localBase = "http://localhost:38425";
  const lines = [];
  const details = {};

  function valueText(value) {
    try {
      return JSON.stringify(value);
    } catch (error) {
      return String(value);
    }
  }

  function add(key, value) {
    details[key] = value;
    lines.push(key + ": " + valueText(value));
  }

  function errorObject(error) {
    return {
      name: error && error.name ? error.name : null,
      message: error && error.message ? error.message : String(error),
      stack: error && error.stack ? String(error.stack).slice(0, 1000) : null
    };
  }

  function summarizeResponse(response) {
    if (response && typeof response === "object") {
      return {
        ok: Boolean(response.ok),
        status: response.status || null,
        type: Object.prototype.toString.call(response),
        keys: Object.keys(response).slice(0, 12)
      };
    }
    if (typeof response === "string") {
      return { type: "string", text: response.slice(0, 300) };
    }
    return { type: typeof response, value: response == null ? null : String(response).slice(0, 300) };
  }

  async function requestUrl(url) {
    if (globalThis.eda && eda.sys_ClientUrl && typeof eda.sys_ClientUrl.request === "function") {
      return await eda.sys_ClientUrl.request(url);
    }
    if (typeof fetch === "function") {
      return await fetch(url);
    }
    throw new Error("No HTTP-capable API is available.");
  }

  async function safeAdd(label, fn) {
    try {
      add(label, await fn());
    } catch (error) {
      add(label + " error", errorObject(error));
    }
  }

  async function report(eventName, extra) {
    const query = [
      "event=" + encodeURIComponent(eventName),
      "version=0.4.4-diag",
      "mode=standalone-diag",
      "href=" + encodeURIComponent(typeof location !== "undefined" ? String(location.href) : ""),
      "extra=" + encodeURIComponent(JSON.stringify(extra || {})),
      "t=" + Date.now()
    ].join("&");
    return await requestUrl(base + "/api/jlceda/activation?" + query);
  }

  add("globalThis.eda", Boolean(globalThis.eda));
  add("eda.sys_ClientUrl.request", Boolean(globalThis.eda && eda.sys_ClientUrl && typeof eda.sys_ClientUrl.request === "function"));
  add("eda.sys_WebSocket.register", Boolean(globalThis.eda && eda.sys_WebSocket && typeof eda.sys_WebSocket.register === "function"));
  add("globalThis.fetch", typeof fetch === "function");
  add("location", typeof location !== "undefined" ? String(location.href) : null);
  add("userAgent", typeof navigator !== "undefined" ? navigator.userAgent : null);

  if (globalThis.eda && eda.dmt_Schematic && typeof eda.dmt_Schematic.getCurrentSchematicPageInfo === "function") {
    await safeAdd("schematic page", async function () {
      return Boolean(await eda.dmt_Schematic.getCurrentSchematicPageInfo());
    });
  }
  if (globalThis.eda && eda.dmt_Pcb && typeof eda.dmt_Pcb.getCurrentPcbInfo === "function") {
    await safeAdd("pcb page", async function () {
      return Boolean(await eda.dmt_Pcb.getCurrentPcbInfo());
    });
  }

  await safeAdd("health 127.0.0.1", async function () {
    return summarizeResponse(await requestUrl(base + "/health?diag=" + Date.now()));
  });
  await safeAdd("health localhost", async function () {
    return summarizeResponse(await requestUrl(localBase + "/health?diag=" + Date.now()));
  });

  try {
    const response = await report("diag-start", details);
      add("local bridge report", summarizeResponse(response));
  } catch (error) {
    add("local bridge report error", errorObject(error));
  }

  let resolveWsWait = null;
  const wsWait = new Promise(function (resolve) {
    resolveWsWait = resolve;
    setTimeout(resolve, 2500);
  });

  try {
    if (globalThis.eda && eda.sys_WebSocket && typeof eda.sys_WebSocket.register === "function") {
      const socketId = "codex_diag_" + Date.now();
      add("ws register attempt", socketId);
      eda.sys_WebSocket.register(
        socketId,
        "ws://127.0.0.1:38426/bridge/ws",
        function (event) {
          lines.push("ws message: " + (event && event.data !== undefined ? String(event.data).slice(0, 300) : String(event)));
        },
        function () {
          lines.push("ws open callback: true");
          try {
            eda.sys_WebSocket.send(socketId, JSON.stringify({
              type: "hello",
              clientId: "codex_diag_" + Date.now(),
              version: "0.4.4-diag"
            }));
            report("diag-ws-open", { socketId: socketId }).catch(function () {});
          } catch (error) {
            lines.push("ws send error: " + valueText(errorObject(error)));
          }
          if (resolveWsWait) resolveWsWait();
        }
      );
    }
  } catch (error) {
    add("ws register error", errorObject(error));
  }

  await wsWait;

  const message = lines.join("\n");
  if (globalThis.eda && eda.sys_Dialog && typeof eda.sys_Dialog.showInformationMessage === "function") {
    eda.sys_Dialog.showInformationMessage(message, "Codex JLCEDA Diagnostics");
  } else if (globalThis.eda && eda.sys_Message && typeof eda.sys_Message.showToastMessage === "function") {
    eda.sys_Message.showToastMessage(message.slice(0, 500), "info");
  } else {
    console.log(message);
  }
})();
