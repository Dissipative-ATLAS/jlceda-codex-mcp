// Minimal JLCEDA script probe.
// Run this file's contents in JLCPCB EDA Pro: Advanced -> Run Script.
(function () {
  var base = "http://127.0.0.1:38425";
  var lines = [];

  function add(key, value) {
    try {
      lines.push(key + ": " + JSON.stringify(value));
    } catch (error) {
      lines.push(key + ": " + String(value));
    }
  }

  function safeMessage(error) {
    return error && error.message ? error.message : String(error);
  }

  function show(title) {
    var message = lines.join("\n");
    try {
      if (typeof eda !== "undefined" && eda.sys_Dialog && typeof eda.sys_Dialog.showInformationMessage === "function") {
        eda.sys_Dialog.showInformationMessage(message, title || "Codex Script Probe");
        return;
      }
    } catch (error) {
      lines.push("dialog error: " + safeMessage(error));
    }
    try {
      if (typeof alert === "function") {
        alert(message);
        return;
      }
    } catch (error) {
      lines.push("alert error: " + safeMessage(error));
    }
    try {
      console.log(message);
    } catch (error) {
      // Nothing else is available.
    }
  }

  add("probe", "standalone_probe_minimal");
  add("version", "0.4.4");
  add("time", new Date().toISOString());
  add("typeof eda", typeof eda);
  add("has sys_Dialog", typeof eda !== "undefined" && !!(eda.sys_Dialog && eda.sys_Dialog.showInformationMessage));
  add("has sys_ClientUrl.request", typeof eda !== "undefined" && !!(eda.sys_ClientUrl && eda.sys_ClientUrl.request));
  add("has sys_WebSocket.register", typeof eda !== "undefined" && !!(eda.sys_WebSocket && eda.sys_WebSocket.register));
  add("has fetch", typeof fetch === "function");
  try {
    add("location", typeof location === "undefined" ? null : String(location.href));
  } catch (error) {
    add("location error", safeMessage(error));
  }

  show("Codex Script Probe Started");

  var query = [
    "event=minimal-probe",
    "version=0.4.4-minimal",
    "t=" + Date.now()
  ].join("&");
  var url = base + "/api/jlceda/activation?" + query;
  try {
    if (typeof eda !== "undefined" && eda.sys_ClientUrl && typeof eda.sys_ClientUrl.request === "function") {
      eda.sys_ClientUrl.request(url);
      return;
    }
    if (typeof fetch === "function") {
      fetch(url);
      return;
    }
  } catch (error) {
    add("local request error", safeMessage(error));
    show("Codex Script Probe Request Failed");
  }
})();
