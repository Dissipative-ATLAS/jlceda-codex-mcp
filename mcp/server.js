#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import WebSocket, { WebSocketServer } from "ws";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const DEFAULT_EXPORT_DIR = path.join(ROOT, "exports");
const EXPORT_DIR = process.env.JLCEDA_EXPORT_DIR
  ? path.resolve(process.env.JLCEDA_EXPORT_DIR)
  : DEFAULT_EXPORT_DIR;
const HTTP_PORT = Number(process.env.JLCEDA_MCP_HTTP_PORT || "38425");
const WS_PORT = Number(process.env.JLCEDA_MCP_WS_PORT || "38426");
const WS_PATH = process.env.JLCEDA_MCP_WS_PATH || "/bridge/ws";
const SERVER_VERSION = "0.4.5";
const LOG_DIR = path.join(ROOT, "logs");
const STANDALONE_LIVE_SCRIPT = path.join(ROOT, "extension-live044", "standalone_live_bridge.js");
const STANDALONE_DIAG_SCRIPT = path.join(ROOT, "extension-live044", "standalone_diag.js");
const BRIDGE_CLIENT_TTL_MS = 10_000;

let bridgeRequestSequence = 0;
const bridgeClients = new Map();
const bridgeClientIdBySocket = new Map();
const pendingBridgeRequests = new Map();

function log(message) {
  process.stderr.write(`[jlceda-mcp] ${message}\n`);
}

async function ensureExportDir() {
  await fs.mkdir(EXPORT_DIR, { recursive: true });
}

async function appendProbe(url, req) {
  await fs.mkdir(LOG_DIR, { recursive: true });
  const parsed = new URL(url, `http://${req.headers.host || "127.0.0.1"}`);
  const record = {
    receivedAt: new Date().toISOString(),
    path: parsed.pathname,
    query: Object.fromEntries(parsed.searchParams.entries()),
    userAgent: req.headers["user-agent"] || null,
    remoteAddress: req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : null
  };
  await fs.appendFile(path.join(LOG_DIR, "probe.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
  return record;
}

async function appendActivation(url, req) {
  await fs.mkdir(LOG_DIR, { recursive: true });
  const parsed = new URL(url, `http://${req.headers.host || "127.0.0.1"}`);
  let body = "";
  if (req.method !== "GET" && req.method !== "HEAD") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = Buffer.concat(chunks).toString("utf8");
  }
  let parsedBody = null;
  if (body.trim()) {
    try {
      parsedBody = JSON.parse(body);
    } catch {
      parsedBody = body.slice(0, 2000);
    }
  }
  const record = {
    receivedAt: new Date().toISOString(),
    method: req.method,
    path: parsed.pathname,
    query: Object.fromEntries(parsed.searchParams.entries()),
    body: parsedBody,
    userAgent: req.headers["user-agent"] || null,
    remoteAddress: req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : null
  };
  await fs.appendFile(path.join(LOG_DIR, "activation.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
  return record;
}

async function readJsonlTail(filePath, limit = 20) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .slice(-Math.max(1, Math.min(limit, 200)))
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return { raw: line };
        }
      });
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function decodeWebSocketData(data) {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}

function sendBridgeMessage(socket, message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    throw new Error("JLCEDA bridge WebSocket is not open");
  }
  socket.send(JSON.stringify(message));
}

function createBridgeRequestId() {
  bridgeRequestSequence += 1;
  return `codex_bridge_req_${Date.now()}_${bridgeRequestSequence}`;
}

function removeBridgeSocket(socket) {
  const clientId = bridgeClientIdBySocket.get(socket);
  bridgeClientIdBySocket.delete(socket);
  if (!clientId) return;
  const client = bridgeClients.get(clientId);
  if (client && client.socket === socket) {
    bridgeClients.delete(clientId);
  }
  for (const [requestId, pending] of pendingBridgeRequests.entries()) {
    if (pending.clientId === clientId) {
      clearTimeout(pending.timer);
      pendingBridgeRequests.delete(requestId);
      pending.reject(new Error(`JLCEDA bridge client disconnected: ${clientId}`));
    }
  }
}

function cleanupBridgeClients() {
  const now = Date.now();
  for (const client of [...bridgeClients.values()]) {
    if (client.socket.readyState !== WebSocket.OPEN || now - client.lastSeenAt > BRIDGE_CLIENT_TTL_MS) {
      removeBridgeSocket(client.socket);
    }
  }
}

function getOpenBridgeClients() {
  cleanupBridgeClients();
  return [...bridgeClients.values()]
    .filter((client) => client.socket.readyState === WebSocket.OPEN)
    .sort((a, b) => a.connectedAt - b.connectedAt);
}

function bridgeStatus() {
  const clients = getOpenBridgeClients().map((client) => ({
    clientId: client.clientId,
    version: client.version || null,
    mode: client.mode || null,
    connectedAt: new Date(client.connectedAt).toISOString(),
    lastSeenAt: new Date(client.lastSeenAt).toISOString()
  }));
  return {
    wsUrl: `ws://127.0.0.1:${WS_PORT}${WS_PATH}`,
    connectedClients: clients.length,
    pendingRequests: pendingBridgeRequests.size,
    clients
  };
}

function registerBridgeClient(socket, message) {
  const clientId = String(message.clientId || "").trim() || `jlceda_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  const existing = bridgeClients.get(clientId);
  if (existing && existing.socket !== socket) {
    removeBridgeSocket(existing.socket);
  }
  const client = {
    clientId,
    socket,
    version: String(message.version || message.bridgeVersion || (existing && existing.version) || "").trim(),
    mode: String(message.mode || (existing && existing.mode) || "").trim(),
    connectedAt: existing ? existing.connectedAt : now,
    lastSeenAt: now
  };
  bridgeClients.set(clientId, client);
  bridgeClientIdBySocket.set(socket, clientId);
  return client;
}

function completePendingBridgeRequest(message) {
  const requestId = String(message.requestId || "").trim();
  const pending = pendingBridgeRequests.get(requestId);
  if (!pending) return false;
  pendingBridgeRequests.delete(requestId);
  clearTimeout(pending.timer);
  if (message.ok === false || message.error) {
    const text = message.error && message.error.message ? message.error.message : JSON.stringify(message.error || message);
    pending.reject(new Error(text));
    return true;
  }
  pending.resolve(message.payload);
  return true;
}

async function handleBridgeMessage(socket, data) {
  const message = JSON.parse(decodeWebSocketData(data));
  if (message.type === "hello") {
    const client = registerBridgeClient(socket, message);
    sendBridgeMessage(socket, {
      type: "welcome",
      clientId: client.clientId,
      serverVersion: SERVER_VERSION,
      receivedAt: new Date().toISOString()
    });
    return;
  }
  if (message.type === "ping") {
    const client = registerBridgeClient(socket, message);
    client.lastSeenAt = Date.now();
    sendBridgeMessage(socket, {
      type: "pong",
      clientId: client.clientId,
      sentAt: message.sentAt || null,
      receivedAt: new Date().toISOString()
    });
    return;
  }
  if (message.type === "exportResult") {
    const client = registerBridgeClient(socket, message);
    client.lastSeenAt = Date.now();
    const completed = completePendingBridgeRequest(message);
    if (!completed && message.ok !== false && message.payload && typeof message.payload === "object" && !Array.isArray(message.payload)) {
      await storeExportPayload(message.payload, "websocket-push");
    }
    return;
  }
  throw new Error(`Unknown JLCEDA bridge message type: ${String(message.type || "")}`);
}

async function waitForBridgeClient(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const clients = getOpenBridgeClients();
    if (clients.length) return clients[0];
    await sleep(250);
  }
  throw new Error(`No JLCEDA bridge client connected within ${timeoutMs} ms`);
}

async function requestBridgeExport(scope = "all", timeoutMs = 60_000) {
  const normalizedScope = ["sch", "pcb", "all"].includes(scope) ? scope : "all";
  const client = await waitForBridgeClient(Math.min(timeoutMs, 15_000));
  const requestId = createBridgeRequestId();
  const deadline = Date.now() + timeoutMs;
  const payloadPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingBridgeRequests.delete(requestId);
      reject(new Error(`Timed out waiting for JLCEDA export result: ${requestId}`));
    }, Math.max(1000, deadline - Date.now()));
    pendingBridgeRequests.set(requestId, {
      resolve,
      reject,
      timer,
      clientId: client.clientId
    });
  });
  sendBridgeMessage(client.socket, {
    type: "export",
    requestId,
    scope: normalizedScope,
    createdAt: Date.now()
  });
  const payload = await payloadPromise;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("JLCEDA bridge returned a non-object export payload");
  }
  if (!payload.extension || typeof payload.extension !== "object") {
    payload.extension = {};
  }
  payload.extension.transport = "websocket";
  payload.extension.bridgeClientId = client.clientId;
  const stored = await storeExportPayload(payload, "websocket");
  return {
    ...stored,
    bridge: {
      requestId,
      clientId: client.clientId,
      wsUrl: `ws://127.0.0.1:${WS_PORT}${WS_PATH}`
    }
  };
}

function jsonText(value) {
  return JSON.stringify(value, null, 2);
}

function textResult(value) {
  return { content: [{ type: "text", text: typeof value === "string" ? value : jsonText(value) }] };
}

function safeFileName(name) {
  return path.basename(String(name || "")).replace(/[^a-zA-Z0-9._-]/g, "_");
}

function exportFileName(payload) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
  const scope = payload && payload.scope ? safeFileName(payload.scope) : "unknown";
  return `jlceda-codex-export-${stamp}-${scope}.json`;
}

async function listExportFiles() {
  await ensureExportDir();
  const entries = await fs.readdir(EXPORT_DIR, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".json")) continue;
    const fullPath = path.join(EXPORT_DIR, entry.name);
    const stat = await fs.stat(fullPath);
    files.push({
      name: entry.name,
      path: fullPath,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString()
    });
  }
  files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  return files;
}

async function readExportByName(fileName) {
  const files = await listExportFiles();
  let file = null;
  if (fileName) {
    const wanted = safeFileName(fileName);
    file = files.find((item) => item.name === wanted);
    if (!file) throw new Error(`Export JSON not found: ${wanted}`);
  } else {
    file = files[0];
    if (!file) throw new Error(`No export JSON files found in ${EXPORT_DIR}`);
  }
  const raw = await fs.readFile(file.path, "utf8");
  const payload = JSON.parse(raw);
  return { file, payload };
}

function findArrays(value, predicate, out = []) {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    if (predicate(value)) out.push(value);
    for (const item of value) findArrays(item, predicate, out);
    return out;
  }
  for (const item of Object.values(value)) findArrays(item, predicate, out);
  return out;
}

function isLikelyDrcItem(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  if (isDrcApiAttemptRecord(item)) return false;
  const keys = Object.keys(item).map((key) => key.toLowerCase());
  return keys.some((key) => ["message", "msg", "error", "warning", "rule", "net", "node", "object", "uuid"].includes(key));
}

function isDrcApiAttemptRecord(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  const label = typeof item.label === "string" ? item.label : "";
  return Object.prototype.hasOwnProperty.call(item, "ok") && label.includes("_Drc.check");
}

function extractDrcItems(exportJson) {
  const arrays = findArrays(exportJson.drc || exportJson, (arr) => arr.some(isLikelyDrcItem));
  const items = [];
  for (const arr of arrays) {
    for (const raw of arr) {
      if (!isLikelyDrcItem(raw)) continue;
      items.push(normalizeDrcItem(raw));
    }
  }
  return items;
}

function normalizeDrcItem(raw) {
  const lowerMap = {};
  for (const [key, value] of Object.entries(raw)) lowerMap[key.toLowerCase()] = value;
  return {
    severity: lowerMap.severity || lowerMap.type || lowerMap.level || null,
    rule: lowerMap.rule || lowerMap.rulename || lowerMap.checktype || null,
    message: lowerMap.message || lowerMap.msg || lowerMap.error || lowerMap.warning || lowerMap.description || JSON.stringify(raw),
    net: lowerMap.net || lowerMap.netname || null,
    designator: lowerMap.designator || lowerMap.component || lowerMap.comp || lowerMap.ref || null,
    pin: lowerMap.pin || lowerMap.pad || null,
    sheet: lowerMap.sheet || lowerMap.page || lowerMap.document || null,
    raw
  };
}

function drcAttemptErrors(drcBlock) {
  const attempts = Array.isArray(drcBlock && drcBlock.attempts) ? drcBlock.attempts : [];
  return attempts
    .filter((attempt) => attempt && typeof attempt === "object" && attempt.ok === false)
    .map((attempt) => {
      let message = null;
      if (typeof attempt.error === "string") {
        message = attempt.error;
      } else if (attempt.error && typeof attempt.error.message === "string") {
        message = attempt.error.message;
      } else if (attempt.error) {
        message = JSON.stringify(attempt.error);
      }
      return {
        label: typeof attempt.label === "string" ? attempt.label : null,
        message
      };
    })
    .filter((attempt) => attempt.label || attempt.message);
}

function parseCsvLine(line, delimiter = ",") {
  const out = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      out.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out;
}

function detectDelimitedTextSeparator(headerLine) {
  const line = String(headerLine || "");
  const tabCount = (line.match(/\t/g) || []).length;
  const commaCount = (line.match(/,/g) || []).length;
  const semicolonCount = (line.match(/;/g) || []).length;
  if (tabCount >= commaCount && tabCount >= semicolonCount && tabCount > 0) return "\t";
  if (semicolonCount > commaCount && semicolonCount > 0) return ";";
  return ",";
}

function parseCsv(text) {
  if (!text) return { headers: [], rows: [] };
  const lines = String(text).replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (!lines.length) return { headers: [], rows: [] };
  const delimiter = detectDelimitedTextSeparator(lines[0]);
  const headers = parseCsvLine(lines[0], delimiter).map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const values = parseCsvLine(line, delimiter);
    const row = {};
    headers.forEach((header, index) => {
      row[header || `col_${index + 1}`] = values[index] ?? "";
    });
    return row;
  });
  return { delimiter: delimiter === "\t" ? "tab" : delimiter, headers, rows };
}

function parseProtelNetlist(text) {
  if (!text) return { format: "protel2", components: [], nets: [] };
  const source = String(text).replace(/\r/g, "");
  const components = [];
  const nets = [];
  const blockRegex = /([\[(])([\s\S]*?)[\])]/g;
  let match;
  while ((match = blockRegex.exec(source))) {
    const kind = match[1];
    const lines = match[2]
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) continue;
    if (kind === "[") {
      components.push({
        designator: lines[0] || "",
        footprint: lines[1] || "",
        value: lines[2] || "",
        rawLines: lines
      });
    } else {
      nets.push({
        name: lines[0] || "",
        pins: lines.slice(1).map((pin) => {
          const dash = pin.lastIndexOf("-");
          return dash > 0
            ? { designator: pin.slice(0, dash), pin: pin.slice(dash + 1), raw: pin }
            : { designator: null, pin: null, raw: pin };
        }),
        rawLines: lines
      });
    }
  }
  return { format: "protel2", components, nets };
}

function parseEasyEdaNetlist(text) {
  const parsed = JSON.parse(String(text));
  const componentEntries = Object.entries(parsed.components || {});
  const components = [];
  const netsByName = new Map();
  const unconnectedPins = [];
  for (const [componentId, component] of componentEntries) {
    const props = component && component.props ? component.props : {};
    const designator = props.Designator || props.designator || componentId;
    const pinEntries = Object.entries((component && component.pinInfoMap) || {});
    const pins = [];
    for (const [pinKey, pinInfo] of pinEntries) {
      const pinNumber = (pinInfo && (pinInfo.number || pinInfo["Pin Number"])) || pinKey;
      const pinName = (pinInfo && pinInfo.name) || "";
      const netName = String((pinInfo && pinInfo.net) || "").trim();
      const pin = {
        componentId,
        designator,
        pin: String(pinNumber),
        pinName: String(pinName),
        net: netName || null
      };
      pins.push(pin);
      if (!netName) {
        unconnectedPins.push(pin);
        continue;
      }
      if (!netsByName.has(netName)) netsByName.set(netName, []);
      netsByName.get(netName).push(pin);
    }
    components.push({
      id: componentId,
      designator,
      value: props.Value || props.Name || props.DeviceName || props["Manufacturer Part"] || "",
      footprint: props.FootprintName || props.Footprint || props["Supplier Footprint"] || "",
      supplierPart: props["Supplier Part"] || "",
      manufacturer: props.Manufacturer || "",
      manufacturerPart: props["Manufacturer Part"] || "",
      pinCount: pins.length,
      pins
    });
  }
  return {
    format: "easyeda-json",
    version: parsed.version || null,
    components,
    nets: Array.from(netsByName, ([name, pins]) => ({ name, pinCount: pins.length, pins })),
    unconnectedPins
  };
}

function parseNetlist(text) {
  const source = String(text || "").trimStart();
  if (!source) return { format: "empty", components: [], nets: [], unconnectedPins: [] };
  if (source.startsWith("{")) {
    try {
      return parseEasyEdaNetlist(source);
    } catch (error) {
      return { format: "easyeda-json", error: error.message, components: [], nets: [], unconnectedPins: [] };
    }
  }
  return { ...parseProtelNetlist(source), unconnectedPins: [] };
}

function getManufactureRecord(exportJson, pathParts) {
  let cursor = exportJson;
  for (const part of pathParts) cursor = cursor && cursor[part];
  return cursor && typeof cursor === "object" ? cursor : null;
}

function fileRecordBytes(record) {
  if (!record || typeof record !== "object" || typeof record.base64 !== "string") return null;
  try {
    return Buffer.from(record.base64, "base64");
  } catch {
    return null;
  }
}

function decodeBufferText(bytes) {
  if (!bytes || !bytes.length) return "";
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return bytes.subarray(2).toString("utf16le").replace(/^\uFEFF/, "");
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = Buffer.alloc(bytes.length - 2);
    for (let index = 2; index + 1 < bytes.length; index += 2) {
      swapped[index - 2] = bytes[index + 1];
      swapped[index - 1] = bytes[index];
    }
    return swapped.toString("utf16le").replace(/^\uFEFF/, "");
  }
  const sampleLength = Math.min(bytes.length, 512);
  let evenNulls = 0;
  let oddNulls = 0;
  for (let index = 0; index < sampleLength; index += 1) {
    if (bytes[index] !== 0) continue;
    if (index % 2 === 0) evenNulls += 1;
    else oddNulls += 1;
  }
  const pairCount = Math.max(1, Math.floor(sampleLength / 2));
  if (oddNulls / pairCount > 0.3 && oddNulls > evenNulls * 2) {
    return bytes.toString("utf16le").replace(/^\uFEFF/, "");
  }
  if (evenNulls / pairCount > 0.3 && evenNulls > oddNulls * 2) {
    const swapped = Buffer.alloc(bytes.length);
    for (let index = 0; index + 1 < bytes.length; index += 2) {
      swapped[index] = bytes[index + 1];
      swapped[index + 1] = bytes[index];
    }
    return swapped.toString("utf16le").replace(/^\uFEFF/, "");
  }
  return bytes.toString("utf8").replace(/^\uFEFF/, "");
}

function fileRecordText(record) {
  if (!record || typeof record !== "object") return "";
  const bytes = fileRecordBytes(record);
  if (bytes) return decodeBufferText(bytes);
  if (typeof record.text === "string") return record.text.replace(/^\uFEFF/, "");
  return "";
}

function isZipBytes(bytes) {
  return !!bytes && bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function summarizeFileRecord(record) {
  if (!record || typeof record !== "object") return null;
  const bytes = fileRecordBytes(record);
  const text = typeof record.text === "string" ? record.text : "";
  const zipLike = isZipBytes(bytes) || text.startsWith("PK\u0003\u0004");
  return {
    name: record.name || null,
    type: record.type || null,
    size: typeof record.size === "number" ? record.size : bytes ? bytes.length : text.length || null,
    encoding: record.encoding || (record.base64 ? "base64" : record.text ? "text" : null),
    hasText: typeof record.text === "string",
    hasBase64: typeof record.base64 === "string",
    textLength: typeof record.text === "string" ? record.text.length : 0,
    base64Length: typeof record.base64 === "string" ? record.base64.length : 0,
    binary: record.binary === true || zipLike,
    fileType: zipLike ? "xlsx/zip" : null,
    error: record.error || null
  };
}

function readZipTextEntries(bytes) {
  const entries = new Map();
  let eocd = -1;
  const minOffset = Math.max(0, bytes.length - 66000);
  for (let offset = bytes.length - 22; offset >= minOffset; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error("XLSX ZIP end-of-central-directory record not found");
  const totalEntries = bytes.readUInt16LE(eocd + 10);
  let offset = bytes.readUInt32LE(eocd + 16);
  for (let i = 0; i < totalEntries && offset < bytes.length; i += 1) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) break;
    const method = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const name = bytes.slice(offset + 46, offset + 46 + nameLength).toString("utf8");
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);
    let content = null;
    if (method === 0) content = compressed;
    else if (method === 8) content = zlib.inflateRawSync(compressed);
    if (content && /\.xml(?:\.rels)?$/i.test(name)) entries.set(name, content.toString("utf8"));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function decodeXmlText(text) {
  return String(text || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function parseXmlAttrs(text) {
  const attrs = {};
  const attrRegex = /([\w:.-]+)="([^"]*)"/g;
  let match;
  while ((match = attrRegex.exec(text || ""))) attrs[match[1]] = decodeXmlText(match[2]);
  return attrs;
}

function parseSharedStrings(xml) {
  const strings = [];
  const itemRegex = /<si\b[\s\S]*?<\/si>/g;
  let itemMatch;
  while ((itemMatch = itemRegex.exec(xml || ""))) {
    let value = "";
    const textRegex = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let textMatch;
    while ((textMatch = textRegex.exec(itemMatch[0]))) value += decodeXmlText(textMatch[1]);
    strings.push(value);
  }
  return strings;
}

function colIndexFromCellRef(ref) {
  const letters = String(ref || "").match(/^[A-Z]+/i);
  if (!letters) return 0;
  let value = 0;
  for (const ch of letters[0].toUpperCase()) value = value * 26 + ch.charCodeAt(0) - 64;
  return value - 1;
}

function resolveWorksheetPath(entries) {
  const workbook = entries.get("xl/workbook.xml") || "";
  const rels = entries.get("xl/_rels/workbook.xml.rels") || "";
  const relMap = {};
  const relRegex = /<Relationship\b([^>]*)\/?>/g;
  let relMatch;
  while ((relMatch = relRegex.exec(rels))) {
    const attrs = parseXmlAttrs(relMatch[1]);
    if (attrs.Id && attrs.Target) relMap[attrs.Id] = attrs.Target;
  }
  const sheetNames = [];
  const sheetRegex = /<sheet\b([^>]*)\/?>/g;
  let firstPath = null;
  let sheetMatch;
  while ((sheetMatch = sheetRegex.exec(workbook))) {
    const attrs = parseXmlAttrs(sheetMatch[1]);
    if (attrs.name) sheetNames.push(attrs.name);
    const relId = attrs["r:id"];
    const target = relId ? relMap[relId] : null;
    if (!firstPath && target) {
      const normalized = target.startsWith("/") ? target.slice(1) : `xl/${target}`.replace(/\/+/g, "/");
      firstPath = normalized.replace(/^xl\/xl\//, "xl/");
    }
  }
  if (!firstPath) {
    firstPath = Array.from(entries.keys()).find((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name)) || null;
  }
  return { sheetNames, firstPath };
}

function parseWorksheetRows(xml, sharedStrings) {
  const matrix = [];
  const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(xml || ""))) {
    const row = [];
    const cellRegex = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowMatch[1]))) {
      const attrs = parseXmlAttrs(cellMatch[1]);
      const col = colIndexFromCellRef(attrs.r);
      const cellXml = cellMatch[2];
      const valueMatch = cellXml.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
      const inlineMatch = cellXml.match(/<t\b[^>]*>([\s\S]*?)<\/t>/);
      let value = "";
      if (attrs.t === "s" && valueMatch) value = sharedStrings[Number(valueMatch[1])] || "";
      else if (inlineMatch) value = decodeXmlText(inlineMatch[1]);
      else if (valueMatch) value = decodeXmlText(valueMatch[1]);
      row[col] = value;
    }
    if (row.some((value) => value !== undefined && value !== "")) matrix.push(row);
  }
  return matrix;
}

function parseXlsxBytes(bytes) {
  const entries = readZipTextEntries(bytes);
  const { sheetNames, firstPath } = resolveWorksheetPath(entries);
  if (!firstPath || !entries.has(firstPath)) throw new Error("XLSX worksheet XML not found");
  const sharedStrings = parseSharedStrings(entries.get("xl/sharedStrings.xml") || "");
  const matrix = parseWorksheetRows(entries.get(firstPath), sharedStrings);
  const headerRow = matrix.find((row) => row.some((value) => value !== undefined && value !== "")) || [];
  const headerIndex = matrix.indexOf(headerRow);
  const headers = headerRow.map((value, index) => String(value || `Column${index + 1}`));
  const rows = matrix.slice(headerIndex + 1)
    .filter((row) => row.some((value) => value !== undefined && value !== ""))
    .map((row) => {
      const out = {};
      headers.forEach((header, index) => {
        out[header || `Column${index + 1}`] = row[index] ?? "";
      });
      return out;
    });
  return {
    sheetNames,
    activeSheet: sheetNames[0] || path.basename(firstPath, ".xml"),
    headers,
    rows
  };
}

function parseBomRecord(record) {
  const file = summarizeFileRecord(record);
  if (!record) return { file, format: null, headers: [], rows: [] };
  const bytes = fileRecordBytes(record);
  if (isZipBytes(bytes)) {
    try {
      const parsed = parseXlsxBytes(bytes);
      return {
        file,
        format: "xlsx",
        sheetNames: parsed.sheetNames,
        activeSheet: parsed.activeSheet,
        headers: parsed.headers,
        rows: parsed.rows
      };
    } catch (error) {
      return { file, format: "xlsx", headers: [], rows: [], error: error.message };
    }
  }
  const text = fileRecordText(record);
  if (text.startsWith("PK\u0003\u0004")) {
    return {
      file,
      format: "xlsx",
      headers: [],
      rows: [],
      warning: "This BOM was captured as lossy text. Re-export with bridge v0.1.1 or newer to include base64."
    };
  }
  const csv = parseCsv(text);
  return {
    file,
    format: text ? (csv.delimiter === "tab" ? "tsv" : "csv") : null,
    delimiter: csv.delimiter || null,
    headers: csv.headers,
    rows: csv.rows
  };
}

function summarizeComponent(component) {
  return {
    ...component,
    pins: (component.pins || []).slice(0, 12)
  };
}

function summarizeNet(net) {
  return {
    ...net,
    pins: (net.pins || []).slice(0, 12)
  };
}

function getManufactureText(exportJson, pathParts) {
  return fileRecordText(getManufactureRecord(exportJson, pathParts));
}

function summarizeExport(exportJson, includeRaw = false) {
  const drcItems = extractDrcItems(exportJson);
  const schDrcAttemptErrors = drcAttemptErrors(exportJson.drc && exportJson.drc.sch);
  const pcbDrcAttemptErrors = drcAttemptErrors(exportJson.drc && exportJson.drc.pcb);
  const schNetlistRecord = getManufactureRecord(exportJson, ["manufacture", "sch", "netlist"]);
  const pcbNetlistRecord = getManufactureRecord(exportJson, ["manufacture", "pcb", "netlist"]);
  const bomRecord = getManufactureRecord(exportJson, ["manufacture", "sch", "bom"]);
  const schNetlist = parseNetlist(fileRecordText(schNetlistRecord));
  const pcbNetlist = parseNetlist(fileRecordText(pcbNetlistRecord));
  const bom = parseBomRecord(bomRecord);
  const byRule = {};
  const byNet = {};
  for (const item of drcItems) {
    const rule = item.rule || "unknown";
    const net = item.net || "unknown";
    byRule[rule] = (byRule[rule] || 0) + 1;
    byNet[net] = (byNet[net] || 0) + 1;
  }
  const summary = {
    schemaVersion: exportJson.schemaVersion || null,
    exportedAt: exportJson.exportedAt || null,
    scope: exportJson.scope || null,
    drc: {
      totalItems: drcItems.length,
      sch: exportJson.drc && exportJson.drc.sch ? {
        available: exportJson.drc.sch.available ?? null,
        passed: exportJson.drc.sch.passed ?? null,
        verboseType: typeof exportJson.drc.sch.verbose,
        error: exportJson.drc.sch.error || (schDrcAttemptErrors[0] && schDrcAttemptErrors[0].message) || null,
        attemptErrors: schDrcAttemptErrors
      } : null,
      pcb: exportJson.drc && exportJson.drc.pcb ? {
        available: exportJson.drc.pcb.available ?? null,
        passed: exportJson.drc.pcb.passed ?? null,
        verboseType: typeof exportJson.drc.pcb.verbose,
        error: exportJson.drc.pcb.error || (pcbDrcAttemptErrors[0] && pcbDrcAttemptErrors[0].message) || null,
        attemptErrors: pcbDrcAttemptErrors
      } : null,
      byRule,
      byNet,
      items: drcItems.slice(0, 200)
    },
    netlists: {
      sch: {
        file: summarizeFileRecord(schNetlistRecord),
        format: schNetlist.format,
        version: schNetlist.version || null,
        error: schNetlist.error || null,
        componentCount: schNetlist.components.length,
        netCount: schNetlist.nets.length,
        unconnectedPinCount: (schNetlist.unconnectedPins || []).length,
        components: schNetlist.components.slice(0, 40).map(summarizeComponent),
        nets: schNetlist.nets.slice(0, 80).map(summarizeNet),
        unconnectedPins: (schNetlist.unconnectedPins || []).slice(0, 80)
      },
      pcb: {
        file: summarizeFileRecord(pcbNetlistRecord),
        format: pcbNetlist.format,
        version: pcbNetlist.version || null,
        error: pcbNetlist.error || null,
        componentCount: pcbNetlist.components.length,
        netCount: pcbNetlist.nets.length,
        unconnectedPinCount: (pcbNetlist.unconnectedPins || []).length,
        components: pcbNetlist.components.slice(0, 40).map(summarizeComponent),
        nets: pcbNetlist.nets.slice(0, 80).map(summarizeNet),
        unconnectedPins: (pcbNetlist.unconnectedPins || []).slice(0, 80)
      }
    },
    bom: {
      file: bom.file,
      format: bom.format,
      sheetNames: bom.sheetNames || [],
      activeSheet: bom.activeSheet || null,
      warning: bom.warning || null,
      error: bom.error || null,
      delimiter: bom.delimiter || null,
      rowCount: bom.rows.length,
      headers: bom.headers,
      rows: bom.rows.slice(0, 80)
    }
  };
  if (includeRaw) summary.raw = exportJson;
  return summary;
}

function parsedNetlistFromExport(exportJson, source = "sch") {
  const netlistRecord = getManufactureRecord(exportJson, ["manufacture", source, "netlist"]);
  const parsed = parseNetlist(fileRecordText(netlistRecord));
  return { file: summarizeFileRecord(netlistRecord), parsed };
}

function normalizeSearch(value) {
  return String(value ?? "").trim().toLowerCase();
}

function matchesSearch(value, query, mode = "exact") {
  const haystack = normalizeSearch(value);
  const needle = normalizeSearch(query);
  if (!needle) return true;
  if (mode === "contains") return haystack.includes(needle);
  return haystack === needle;
}

function findNetMatches(parsed, query, mode = "exact") {
  return (parsed.nets || [])
    .filter((net) => matchesSearch(net.name, query, mode))
    .map((net) => summarizeNet(net));
}

function componentSearchFields(component) {
  return [
    component.id,
    component.designator,
    component.value,
    component.footprint,
    component.supplierPart,
    component.manufacturer,
    component.manufacturerPart
  ];
}

function findComponentMatches(parsed, query, mode = "exact") {
  return (parsed.components || [])
    .filter((component) => componentSearchFields(component).some((field) => matchesSearch(field, query, mode)))
    .map((component) => summarizeComponent(component));
}

function pinsForComponent(parsed, designator) {
  const wanted = normalizeSearch(designator);
  if (!wanted) return [];
  const pins = [];
  for (const component of parsed.components || []) {
    if (normalizeSearch(component.designator) === wanted || normalizeSearch(component.id) === wanted) {
      for (const pin of component.pins || []) pins.push(pin);
    }
  }
  if (pins.length) return pins;
  for (const net of parsed.nets || []) {
    for (const pin of net.pins || []) {
      if (normalizeSearch(pin.designator) === wanted) pins.push({ ...pin, net: pin.net || net.name });
    }
  }
  return pins;
}

function classifyUnconnectedPin(pin) {
  const pinName = String(pin.pinName || pin.pin || "").toUpperCase();
  if (/^(NC|N\/C|DNC|NO[_ -]?CONNECT)/.test(pinName)) return "likely_nc";
  if (/^(SBU1|SBU2)$/.test(pinName)) return "unused_usb_sbu";
  return "needs_review";
}

function buildDiagnostics(exportJson, source = "sch") {
  const { file, parsed } = parsedNetlistFromExport(exportJson, source);
  const drcItems = extractDrcItems(exportJson);
  const unconnectedPins = (parsed.unconnectedPins || []).map((pin) => ({
    ...pin,
    category: classifyUnconnectedPin(pin)
  }));
  const unconnectedByCategory = {};
  for (const pin of unconnectedPins) {
    unconnectedByCategory[pin.category] = (unconnectedByCategory[pin.category] || 0) + 1;
  }
  const sourceDrc = exportJson.drc && exportJson.drc[source] ? exportJson.drc[source] : null;
  return {
    source,
    netlistFile: file,
    netlist: {
      format: parsed.format,
      version: parsed.version || null,
      error: parsed.error || null,
      componentCount: (parsed.components || []).length,
      netCount: (parsed.nets || []).length
    },
    drc: {
      available: sourceDrc ? sourceDrc.available ?? null : null,
      passed: sourceDrc ? sourceDrc.passed ?? null : null,
      verboseType: sourceDrc ? typeof sourceDrc.verbose : null,
      error: sourceDrc ? sourceDrc.error || null : null,
      itemCount: drcItems.length,
      items: drcItems.slice(0, 200)
    },
    unconnected: {
      total: unconnectedPins.length,
      byCategory: unconnectedByCategory,
      needsReview: unconnectedPins.filter((pin) => pin.category === "needs_review").slice(0, 200),
      likelyIntentional: unconnectedPins.filter((pin) => pin.category !== "needs_review").slice(0, 200)
    }
  };
}

function bomFromExport(exportJson) {
  return parseBomRecord(getManufactureRecord(exportJson, ["manufacture", "sch", "bom"]));
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function storeExportPayload(payload, origin = "http") {
  await ensureExportDir();
  const name = exportFileName(payload);
  const fullPath = path.join(EXPORT_DIR, name);
  await fs.writeFile(fullPath, jsonText(payload), "utf8");
  return {
    success: true,
    msg: "success",
    origin,
    file: fullPath,
    summary: summarizeExport(payload)
  };
}

async function handleHttpJson(req) {
  const bodyBuffer = await readRequestBody(req);
  const contentType = String(req.headers["content-type"] || "");
  const payload = parseIncomingPayload(bodyBuffer, contentType);
  return await storeExportPayload(payload, "http");
}

async function handleHttpRequestExport(req) {
  const bodyBuffer = await readRequestBody(req);
  let body = {};
  if (bodyBuffer.length > 0) {
    body = JSON.parse(bodyBuffer.toString("utf8").replace(/^\uFEFF/, ""));
  }
  const scope = String(body.scope || "all").trim();
  const timeoutMs = Number.isInteger(body.timeoutMs) ? body.timeoutMs : 60_000;
  return await requestBridgeExport(scope, Math.min(Math.max(timeoutMs, 5000), 180_000));
}

function parseIncomingPayload(bodyBuffer, contentType) {
  if (/multipart\/form-data/i.test(contentType)) {
    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!boundaryMatch) throw new Error("multipart/form-data request is missing boundary");
    const parts = parseMultipartFormData(bodyBuffer, boundaryMatch[1] || boundaryMatch[2]);
    const jsonPart =
      parts.find((part) => /application\/json/i.test(part.contentType || "")) ||
      parts.find((part) => /\.json$/i.test(part.filename || "")) ||
      parts.find((part) => part.name === "json") ||
      parts.find((part) => part.name === "file");
    if (!jsonPart) throw new Error("multipart/form-data request does not contain a JSON file or json field");
    return JSON.parse(jsonPart.content.toString("utf8").replace(/^\uFEFF/, ""));
  }
  return JSON.parse(bodyBuffer.toString("utf8").replace(/^\uFEFF/, ""));
}

function parseMultipartFormData(bodyBuffer, boundary) {
  const delimiter = Buffer.from(`--${boundary}`);
  const parts = [];
  let offset = 0;
  while (offset < bodyBuffer.length) {
    const start = bodyBuffer.indexOf(delimiter, offset);
    if (start < 0) break;
    const afterBoundary = start + delimiter.length;
    if (bodyBuffer.slice(afterBoundary, afterBoundary + 2).toString() === "--") break;
    let partStart = afterBoundary;
    if (bodyBuffer.slice(partStart, partStart + 2).toString() === "\r\n") partStart += 2;
    const headerEnd = bodyBuffer.indexOf(Buffer.from("\r\n\r\n"), partStart);
    if (headerEnd < 0) break;
    const next = bodyBuffer.indexOf(delimiter, headerEnd + 4);
    if (next < 0) break;
    const headerText = bodyBuffer.slice(partStart, headerEnd).toString("utf8");
    let content = bodyBuffer.slice(headerEnd + 4, next);
    if (content.slice(-2).toString() === "\r\n") content = content.slice(0, -2);
    const headers = {};
    for (const line of headerText.split(/\r\n/)) {
      const idx = line.indexOf(":");
      if (idx > 0) headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
    }
    const disposition = headers["content-disposition"] || "";
    const name = (disposition.match(/name="([^"]*)"/i) || [])[1] || null;
    const filename = (disposition.match(/filename="([^"]*)"/i) || [])[1] || null;
    parts.push({ name, filename, contentType: headers["content-type"] || "", headers, content });
    offset = next;
  }
  return parts;
}

function standaloneLiveLoaderScript() {
  return [
    "(async function(){",
    "  const base = 'http://127.0.0.1:" + HTTP_PORT + "';",
    "  const edaApi = typeof eda !== 'undefined' ? eda : globalThis.eda;",
    "  async function request(url, method, body) {",
    "    const errors = [];",
    "    if (edaApi && edaApi.sys_ClientUrl && typeof edaApi.sys_ClientUrl.request === 'function') {",
    "      try { return await edaApi.sys_ClientUrl.request(url, method || 'GET', body); } catch (err) { errors.push('sys_ClientUrl: ' + (err && err.message ? err.message : String(err))); }",
    "    } else {",
    "      errors.push('sys_ClientUrl unavailable');",
    "    }",
    "    if (typeof fetch === 'function') {",
    "      try { return await fetch(url, { method: method || 'GET', body }); } catch (err) { errors.push('fetch: ' + (err && err.message ? err.message : String(err))); }",
    "    } else {",
    "      errors.push('fetch unavailable');",
    "    }",
    "    throw new Error(errors.join(' | '));",
    "  }",
    "  async function report(eventName, extra) {",
    "    const query = [",
    "      'event=' + encodeURIComponent(eventName),",
    "      'version=0.4.5-loader',",
    "      'mode=standalone-loader',",
    "      'hasClientUrl=' + encodeURIComponent(Boolean(edaApi && edaApi.sys_ClientUrl && edaApi.sys_ClientUrl.request)),",
    "      'hasWebSocket=' + encodeURIComponent(Boolean(edaApi && edaApi.sys_WebSocket && edaApi.sys_WebSocket.register)),",
    "      'hasFetch=' + encodeURIComponent(Boolean(globalThis.fetch)),",
    "      'href=' + encodeURIComponent(typeof location !== 'undefined' ? String(location.href) : ''),",
    "      'extra=' + encodeURIComponent(JSON.stringify(extra || {})),",
    "      't=' + Date.now()",
    "    ].join('&');",
    "    try { await request(base + '/api/jlceda/activation?' + query); } catch (err) {}",
    "  }",
    "  try {",
    "    await report('loader-start');",
    "    const url = base + '/api/jlceda/standalone-live-script?loader=v2&t=' + Date.now();",
    "    const res = await request(url);",
    "  if (!res || !res.ok) throw new Error('Codex standalone live script fetch failed');",
    "  const code = await res.text();",
    "    await report('loader-script-fetched', { length: code.length });",
    "  new Function('eda', code + '\\n//# sourceURL=codex-standalone-live-loader.js')(edaApi);",
    "  } catch (err) {",
    "    await report('loader-error', { message: err && err.message ? err.message : String(err), stack: err && err.stack ? err.stack : null });",
    "    const text = 'Codex standalone live loader failed:\\n' + (err && err.message ? err.message : String(err));",
    "    if (edaApi && edaApi.sys_Dialog && edaApi.sys_Dialog.showInformationMessage) edaApi.sys_Dialog.showInformationMessage(text, 'Codex Live Loader');",
    "    else if (edaApi && edaApi.sys_Message && edaApi.sys_Message.showToastMessage) edaApi.sys_Message.showToastMessage(text, 'error');",
    "    else console.error(text);",
    "  }",
    "})();"
  ].join("\n");
}

function startHttpServer() {
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === "GET" && isHealthCheckUrl(req.url)) {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(jsonText({
          success: true,
          name: "jlceda-codex-mcp",
          version: SERVER_VERSION,
          exportDir: EXPORT_DIR,
          bridge: bridgeStatus()
        }));
        return;
      }
      if (req.method === "GET" && String(req.url || "").split("?")[0] === "/api/jlceda/ws-status") {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(jsonText({
          success: true,
          bridge: bridgeStatus()
        }));
        return;
      }
      if (req.method === "GET" && String(req.url || "").split("?")[0] === "/api/jlceda/probe") {
        const record = await appendProbe(req.url, req);
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "access-control-allow-origin": "*"
        });
        res.end(jsonText({ success: true, probe: record }));
        return;
      }
      if (["GET", "POST"].includes(req.method || "") && String(req.url || "").split("?")[0] === "/api/jlceda/activation") {
        const record = await appendActivation(req.url, req);
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "access-control-allow-origin": "*"
        });
        res.end(jsonText({ success: true, activation: record }));
        return;
      }
      if (req.method === "GET" && String(req.url || "").split("?")[0] === "/api/jlceda/activation-log") {
        const parsed = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
        const limit = Number.parseInt(parsed.searchParams.get("limit") || "20", 10);
        const records = await readJsonlTail(path.join(LOG_DIR, "activation.jsonl"), Number.isFinite(limit) ? limit : 20);
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "access-control-allow-origin": "*"
        });
        res.end(jsonText({ success: true, records }));
        return;
      }
      if (req.method === "GET" && String(req.url || "").split("?")[0] === "/api/jlceda/probe-log") {
        const parsed = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
        const limit = Number.parseInt(parsed.searchParams.get("limit") || "20", 10);
        const records = await readJsonlTail(path.join(LOG_DIR, "probe.jsonl"), Number.isFinite(limit) ? limit : 20);
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "access-control-allow-origin": "*"
        });
        res.end(jsonText({ success: true, records }));
        return;
      }
      if (req.method === "GET" && String(req.url || "").split("?")[0] === "/api/jlceda/standalone-live-loader") {
        await appendProbe(req.url, req);
        res.writeHead(200, {
          "content-type": "application/javascript; charset=utf-8",
          "access-control-allow-origin": "*",
          "cache-control": "no-store"
        });
        res.end(standaloneLiveLoaderScript());
        return;
      }
      if (req.method === "GET" && String(req.url || "").split("?")[0] === "/api/jlceda/standalone-live-script") {
        await appendProbe(req.url, req);
        const script = await fs.readFile(STANDALONE_LIVE_SCRIPT, "utf8");
        res.writeHead(200, {
          "content-type": "application/javascript; charset=utf-8",
          "access-control-allow-origin": "*",
          "cache-control": "no-store"
        });
        res.end(script);
        return;
      }
      if (req.method === "GET" && String(req.url || "").split("?")[0] === "/api/jlceda/standalone-diag-script") {
        await appendProbe(req.url, req);
        const script = await fs.readFile(STANDALONE_DIAG_SCRIPT, "utf8");
        res.writeHead(200, {
          "content-type": "application/javascript; charset=utf-8",
          "access-control-allow-origin": "*",
          "cache-control": "no-store"
        });
        res.end(script);
        return;
      }
      if (req.method === "POST" && req.url === "/api/jlceda/export") {
        const result = await handleHttpJson(req);
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(jsonText(result));
        return;
      }
      if (req.method === "POST" && req.url === "/api/jlceda/request-export") {
        const result = await handleHttpRequestExport(req);
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(jsonText(result));
        return;
      }
      res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
      res.end(jsonText({ success: false, error: "not found" }));
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      res.end(jsonText({ success: false, error: error.message, stack: error.stack }));
    }
  });
  server.listen(HTTP_PORT, "127.0.0.1", () => {
    log(`HTTP bridge listening on http://127.0.0.1:${HTTP_PORT}`);
    log(`export dir: ${EXPORT_DIR}`);
  });
  return server;
}

function startBridgeWebSocketServer() {
  const wss = new WebSocketServer({
    host: "127.0.0.1",
    port: WS_PORT,
    path: WS_PATH
  });
  wss.on("connection", (socket) => {
    log(`WebSocket client connected from ${socket._socket && socket._socket.remoteAddress ? socket._socket.remoteAddress : "unknown"}`);
    socket.on("message", (data) => {
      handleBridgeMessage(socket, data).catch((error) => {
        try {
          sendBridgeMessage(socket, {
            type: "error",
            message: error.message || String(error)
          });
        } catch {
          // Ignore secondary send failures.
        }
      });
    });
    socket.on("close", () => {
      removeBridgeSocket(socket);
    });
    socket.on("error", () => {
      removeBridgeSocket(socket);
    });
  });
  wss.on("listening", () => {
    log(`WebSocket bridge listening on ws://127.0.0.1:${WS_PORT}${WS_PATH}`);
  });
  wss.on("error", (error) => {
    log(`WebSocket bridge error: ${error.message}`);
  });
  return wss;
}

function isHealthCheckUrl(url) {
  return [
    "/api/test",
    "/health",
    "/api/jlceda/ping",
    "/api/jlceda/status"
  ].includes(String(url || "").split("?")[0]);
}

function buildMcpServer() {
  const server = new McpServer({
    name: "jlceda-codex-mcp",
    version: SERVER_VERSION
  });

  server.registerTool(
    "jlceda_list_exports",
    {
      title: "List JLCEDA exports",
      description: "List JSON exports received from the JLCPCB/Lichuang EDA Pro extension.",
      inputSchema: {
        limit: z.number().int().positive().max(100).optional()
      }
    },
    async ({ limit = 20 }) => {
      const files = await listExportFiles();
      return textResult({ exportDir: EXPORT_DIR, files: files.slice(0, limit) });
    }
  );

  server.registerTool(
    "jlceda_bridge_status",
    {
      title: "Show JLCEDA live bridge status",
      description: "Show whether a JLCPCB/Lichuang EDA Pro extension is connected through the WebSocket bridge.",
      inputSchema: {}
    },
    async () => textResult({ bridge: bridgeStatus(), exportDir: EXPORT_DIR, httpPort: HTTP_PORT })
  );

  server.registerTool(
    "jlceda_activation_log",
    {
      title: "Read JLCEDA bridge activation log",
      description: "Read recent activation probe records sent by the JLCEDA extension.",
      inputSchema: {
        limit: z.number().int().positive().max(200).optional()
      }
    },
    async ({ limit = 20 }) => {
      const records = await readJsonlTail(path.join(LOG_DIR, "activation.jsonl"), limit);
      return textResult({ logPath: path.join(LOG_DIR, "activation.jsonl"), records });
    }
  );

  server.registerTool(
    "jlceda_request_export",
    {
      title: "Request live JLCEDA export",
      description: "Ask the connected JLCPCB/Lichuang EDA Pro extension to export DRC, netlist, and BOM JSON now, then store it locally.",
      inputSchema: {
        scope: z.enum(["sch", "pcb", "all"]).optional(),
        timeoutMs: z.number().int().positive().max(180000).optional()
      }
    },
    async ({ scope = "all", timeoutMs = 60000 }) => {
      const result = await requestBridgeExport(scope, timeoutMs);
      return textResult(result);
    }
  );

  server.registerTool(
    "jlceda_latest_export_summary",
    {
      title: "Summarize latest JLCEDA export",
      description: "Read the newest export JSON and summarize DRC, EasyEDA/Protel2 netlist, and BOM data.",
      inputSchema: {
        includeRaw: z.boolean().optional()
      }
    },
    async ({ includeRaw = false }) => {
      const { file, payload } = await readExportByName();
      return textResult({ file, summary: summarizeExport(payload, includeRaw) });
    }
  );

  server.registerTool(
    "jlceda_read_export",
    {
      title: "Read JLCEDA export",
      description: "Read a specific export JSON by file name, or the newest one when fileName is omitted.",
      inputSchema: {
        fileName: z.string().optional(),
        includeSummary: z.boolean().optional()
      }
    },
    async ({ fileName, includeSummary = true }) => {
      const { file, payload } = await readExportByName(fileName);
      return textResult({ file, summary: includeSummary ? summarizeExport(payload) : undefined, export: payload });
    }
  );

  server.registerTool(
    "jlceda_parse_protel2_netlist",
    {
      title: "Parse netlist",
      description: "Parse EasyEDA JSON or Protel2 netlist text from an export JSON or direct text input.",
      inputSchema: {
        fileName: z.string().optional(),
        source: z.enum(["sch", "pcb"]).optional(),
        text: z.string().optional()
      }
    },
    async ({ fileName, source = "sch", text }) => {
      let netText = text || "";
      let file = null;
      if (!netText) {
        const read = await readExportByName(fileName);
        file = read.file;
        netText = getManufactureText(read.payload, ["manufacture", source, "netlist"]);
      }
      return textResult({ file, source, parsed: parseNetlist(netText) });
    }
  );

  server.registerTool(
    "jlceda_find_net",
    {
      title: "Find JLCEDA net pins",
      description: "Find matching schematic or PCB nets and return their connected component pins.",
      inputSchema: {
        fileName: z.string().optional(),
        source: z.enum(["sch", "pcb"]).optional(),
        net: z.string(),
        match: z.enum(["exact", "contains"]).optional()
      }
    },
    async ({ fileName, source = "sch", net, match = "exact" }) => {
      const { file, payload } = await readExportByName(fileName);
      const { file: netlistFile, parsed } = parsedNetlistFromExport(payload, source);
      return textResult({
        file,
        source,
        query: { net, match },
        netlist: {
          file: netlistFile,
          format: parsed.format,
          componentCount: (parsed.components || []).length,
          netCount: (parsed.nets || []).length
        },
        matches: findNetMatches(parsed, net, match)
      });
    }
  );

  server.registerTool(
    "jlceda_find_component",
    {
      title: "Find JLCEDA component pins",
      description: "Find matching components by designator, ID, value, footprint, supplier part, or manufacturer part.",
      inputSchema: {
        fileName: z.string().optional(),
        source: z.enum(["sch", "pcb"]).optional(),
        query: z.string(),
        match: z.enum(["exact", "contains"]).optional(),
        includePins: z.boolean().optional()
      }
    },
    async ({ fileName, source = "sch", query, match = "exact", includePins = true }) => {
      const { file, payload } = await readExportByName(fileName);
      const { file: netlistFile, parsed } = parsedNetlistFromExport(payload, source);
      const matches = findComponentMatches(parsed, query, match).map((component) => ({
        ...component,
        pins: includePins ? pinsForComponent(parsed, component.designator).slice(0, 200) : component.pins
      }));
      return textResult({
        file,
        source,
        query: { component: query, match, includePins },
        netlist: {
          file: netlistFile,
          format: parsed.format,
          componentCount: (parsed.components || []).length,
          netCount: (parsed.nets || []).length
        },
        matches
      });
    }
  );

  server.registerTool(
    "jlceda_diagnostics",
    {
      title: "Build JLCEDA diagnostics",
      description: "Return DRC status, DRC items, and unconnected-pin diagnostics for the latest or selected export.",
      inputSchema: {
        fileName: z.string().optional(),
        source: z.enum(["sch", "pcb"]).optional()
      }
    },
    async ({ fileName, source = "sch" }) => {
      const { file, payload } = await readExportByName(fileName);
      return textResult({ file, diagnostics: buildDiagnostics(payload, source) });
    }
  );

  server.registerTool(
    "jlceda_bom_rows",
    {
      title: "Read JLCEDA BOM rows",
      description: "Read parsed BOM rows from an export JSON, with optional text filtering across row values.",
      inputSchema: {
        fileName: z.string().optional(),
        query: z.string().optional(),
        limit: z.number().int().positive().max(500).optional()
      }
    },
    async ({ fileName, query = "", limit = 100 }) => {
      const { file, payload } = await readExportByName(fileName);
      const bom = bomFromExport(payload);
      const needle = normalizeSearch(query);
      const rows = (bom.rows || []).filter((row) => {
        if (!needle) return true;
        return Object.values(row).some((value) => normalizeSearch(value).includes(needle));
      });
      return textResult({
        file,
        query,
        bom: {
          file: bom.file,
          format: bom.format,
          sheetNames: bom.sheetNames || [],
          activeSheet: bom.activeSheet || null,
          warning: bom.warning || null,
          error: bom.error || null,
          rowCount: bom.rows.length,
          matchedRowCount: rows.length,
          headers: bom.headers,
          rows: rows.slice(0, limit)
        }
      });
    }
  );

  server.registerTool(
    "jlceda_export_dir",
    {
      title: "Show JLCEDA export directory",
      description: "Return the directory where the HTTP bridge stores JLCEDA JSON exports.",
      inputSchema: {}
    },
    async () => textResult({ exportDir: EXPORT_DIR, httpPort: HTTP_PORT, wsPort: WS_PORT, wsPath: WS_PATH })
  );

  return server;
}

async function smoke() {
  await ensureExportDir();
  const samplePath = path.join(EXPORT_DIR, "sample-export.json");
  const bomBytes = Buffer.from(
    "\uFEFFNo.\tQuantity\tValue\tFootprint\n1\t1\tESP32-C3-MINI-1U\tModule\n",
    "utf16le"
  );
  const sample = {
    schemaVersion: "jlceda-codex-export/v0.1",
    exportedAt: new Date().toISOString(),
    scope: "sch",
    drc: {
      sch: {
        passed: false,
        verbose: [{ rule: "Unconnected Pin", message: "U1 pin EN is unconnected", designator: "U1", pin: "EN" }]
      }
    },
    manufacture: {
      sch: {
        netlist: { text: "[\nU1\nQFN\nESP32-C3\n]\n(\nVCC3V3\nU1-1\nC1-1\n)\n" },
        bom: {
          name: "sample-bom.csv",
          size: bomBytes.length,
          encoding: "base64",
          base64: bomBytes.toString("base64"),
          text: bomBytes.toString("utf8")
        }
      }
    }
  };
  await fs.writeFile(samplePath, jsonText(sample), "utf8");
  const read = await readExportByName("sample-export.json");
  const summary = summarizeExport(read.payload);
  console.log(jsonText({ ok: true, samplePath, summary }));
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--smoke")) {
    await smoke();
    return;
  }
  if (args.has("--check")) {
    buildMcpServer();
    console.log(jsonText({ ok: true, message: "MCP server tools registered" }));
    return;
  }
  await ensureExportDir();
  startHttpServer();
  startBridgeWebSocketServer();
  if (args.has("--http-only")) {
    log("HTTP-only mode. Press Ctrl+C to stop.");
    return;
  }
  const server = buildMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
