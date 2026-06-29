// Paste this file into JLCPCB EDA Pro: Advanced -> Run Script.
// It runs the same export flow without installing the extension package.
(async function () {
  const extensionUuid = "44codexexport0000000000000000001";
  const extensionVersion = "0.4.4";
  const url = "http://127.0.0.1:38425/api/jlceda/export";
  const testUrl = "http://127.0.0.1:38425/health";
  const clone = (value) => {
    try { return JSON.parse(JSON.stringify(value)); } catch (err) { return String(value); }
  };
  const errObj = (err) => ({ name: err && err.name, message: err && err.message ? err.message : String(err), stack: err && err.stack });
  const bytesToBase64 = (bytes) => {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 32768) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 32768)));
    }
    return btoa(binary);
  };
  const isTextLikeFile = (file) => /\.(csv|json|net|txt|xml)$/i.test(String(file && file.name || "")) ||
    /^text\//i.test(String(file && file.type || "")) || /json|xml/i.test(String(file && file.type || ""));
  const isLikelyTextBytes = (file, bytes) => {
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
  };
  const runDrc = async (kind, api) => {
    if (!api || typeof api.check !== "function") return { kind, available: false };
    try {
      const value = await api.check(true, false, true);
      return { kind, available: true, passed: Array.isArray(value) ? value.length === 0 : !!value, verbose: clone(value) };
    } catch (first) {
      try {
        const value = await api.check(true, false, false);
        return { kind, available: true, passed: !!value, verbose: null, fallback: clone(value), firstError: errObj(first) };
      } catch (second) {
        return { kind, available: true, passed: null, error: errObj(second), firstError: errObj(first) };
      }
    }
  };
  const asFileRecord = async (file) => {
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
    } catch (err) { out.error = errObj(err); }
    return out;
  };
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
  const payload = {
    schemaVersion: "jlceda-codex-export/v0.1",
    exportedAt: new Date().toISOString(),
    extension: {
      uuid: extensionUuid,
      version: extensionVersion,
      mode: "standalone"
    },
    scope: "all",
    environment: {
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      location: typeof location !== "undefined" ? String(location.href) : null
    },
    drc: {
      sch: await runDrc("sch_Drc", eda.sch_Drc),
      pcb: await runDrc("pcb_Drc", eda.pcb_Drc)
    },
    manufacture: {
      sch: {},
      pcb: {}
    }
  };
  if (eda.sch_ManufactureData && eda.sch_ManufactureData.getNetlistFile) {
    payload.manufacture.sch.netlist = await asFileRecord(await eda.sch_ManufactureData.getNetlistFile(`codex-sch-${stamp}.net`));
  }
  if (eda.sch_ManufactureData && eda.sch_ManufactureData.getBomFile) {
    payload.manufacture.sch.bom = await asFileRecord(await eda.sch_ManufactureData.getBomFile(`codex-sch-bom-${stamp}.csv`, "csv"));
  }
  if (eda.pcb_ManufactureData && eda.pcb_ManufactureData.getNetlistFile) {
    payload.manufacture.pcb.netlist = await asFileRecord(await eda.pcb_ManufactureData.getNetlistFile(`codex-pcb-${stamp}.net`));
  }
  try {
    const ok = await eda.sys_ClientUrl.request(testUrl);
    if (ok && ok.ok) {
      const formData = new FormData();
      formData.append("file", new File([JSON.stringify(payload, null, 2)], `jlceda-codex-export-${stamp}.json`, { type: "application/json;charset=utf-8" }));
      formData.append("type", "jlceda-codex-export");
      formData.append("scope", "all");
      formData.append("timestamp", Date.now().toString());
      const response = await eda.sys_ClientUrl.request(url, "POST", formData);
      if (response && response.ok) {
        eda.sys_Message.showToastMessage("Codex JSON exported to local MCP", "success");
        return;
      }
    }
  } catch (err) {
    payload.localBridgePostError = errObj(err);
  }
  const file = new File([JSON.stringify(payload, null, 2)], `jlceda-codex-export-${stamp}.json`, { type: "application/json" });
  await eda.sys_FileSystem.saveFile(file);
})();
