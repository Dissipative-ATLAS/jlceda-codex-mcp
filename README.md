# JLCEDA Codex MCP Bridge / 嘉立创 EDA Codex MCP 桥接

[中文](#中文说明) | [English](#english)

## 中文说明

这是一个面向嘉立创 EDA 专业版（JLCPCB/Lichuang EDA Pro）的本地桥接项目。它包含一个嘉立创 EDA 扩展和一个本地 MCP/HTTP/WebSocket 服务，让 Codex 或其他 MCP 客户端可以自动导出并解析：

- 原理图/PCB DRC 状态
- 原理图/PCB 网表（EasyEDA JSON 或 Protel2）
- BOM（CSV/TSV/XLSX，支持 UTF-16LE/base64）

项目的目标不是替代嘉立创 EDA，而是把 GUI 内部的检查和制造数据变成可程序化读取的 JSON，方便后续做自动诊断、网表查询、BOM 检查和闭环修改。

### 功能

- 嘉立创 EDA 顶部菜单：`CodexExport044`
- Live WebSocket 桥接：Codex 可主动请求当前打开工程导出 JSON
- 一次性 HTTP 导出：扩展可把 JSON 推送到本地服务
- MCP 工具：列出导出、请求导出、读取摘要、查询网络、查询器件、解析 BOM、输出诊断
- DRC API 调用错误和真实 DRC 条目分离，避免把“当前没有 PCB 画布”误判为设计规则错误
- 保留原始导出数据，同时提供结构化摘要

### 目录

```text
extension-live044/     当前验证过的嘉立创 EDA 扩展源码
mcp/                   本地 MCP server + HTTP/WebSocket bridge
scripts/               启动、诊断、打包脚本
schemas/               JSON schema
samples/               脱敏示例导出
tools/                 .eext 打包工具
```

默认端口：

```text
HTTP:      http://127.0.0.1:38425
WebSocket: ws://127.0.0.1:38426/bridge/ws
```

### 安装依赖

需要 Node.js 20 或更高版本。

```powershell
npm install
npm --prefix mcp install
```

### 启动本地桥接

开发模式：

```powershell
npm --prefix mcp run http
```

Windows 后台启动：

```powershell
.\scripts\start-local-bridge.ps1
```

健康检查：

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:38425/health
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:38425/api/jlceda/ws-status
```

### 打包嘉立创 EDA 扩展

```powershell
npm run package:extension
```

生成 `.eext` 后，在嘉立创 EDA 专业版的扩展管理器中导入。导入并重启嘉立创 EDA 后，打开工程，在顶部菜单点击：

```text
CodexExport044 -> Start Live Bridge
```

连接成功后，Codex/MCP 客户端就可以主动请求导出。

### MCP 配置示例

在支持 MCP 的客户端中配置本地 server。把 `<repo>` 替换为本仓库路径：

```json
{
  "mcpServers": {
    "jlceda-codex": {
      "command": "node",
      "args": [
        "<repo>\\mcp\\server.js"
      ],
      "env": {
        "JLCEDA_EXPORT_DIR": "<repo>\\exports",
        "JLCEDA_MCP_HTTP_PORT": "38425",
        "JLCEDA_MCP_WS_PORT": "38426"
      }
    }
  }
}
```

Codex `config.toml` 示例：

```toml
[mcp_servers.jlceda_codex]
command = "node"
args = ['<repo>\mcp\server.js']
startup_timeout_sec = 30

[mcp_servers.jlceda_codex.env]
JLCEDA_EXPORT_DIR = '<repo>\exports'
JLCEDA_MCP_HTTP_PORT = "38425"
JLCEDA_MCP_WS_PORT = "38426"
```

### MCP 工具

- `jlceda_list_exports`：列出收到的 JSON 导出文件
- `jlceda_bridge_status`：查看 live WebSocket 连接状态
- `jlceda_request_export`：请求嘉立创 EDA 当前工程立即导出
- `jlceda_latest_export_summary`：摘要最新导出
- `jlceda_read_export`：读取指定导出 JSON
- `jlceda_parse_protel2_netlist`：解析 EasyEDA JSON 或 Protel2 网表
- `jlceda_find_net`：查询网络及其连接管脚
- `jlceda_find_component`：按位号、值、封装或料号查询器件
- `jlceda_diagnostics`：输出 DRC 与未连接管脚诊断
- `jlceda_bom_rows`：解析 BOM 行
- `jlceda_export_dir`：显示导出目录和端口

### 验证

```powershell
npm --prefix mcp run check
npm --prefix mcp run smoke
.\scripts\check-live-bridge.ps1
```

真实闭环验证流程：

1. 启动本地 bridge。
2. 打开嘉立创 EDA 工程。
3. 点击 `CodexExport044 -> Start Live Bridge`。
4. 调用 MCP 工具 `jlceda_request_export`。
5. 用 `jlceda_find_net`、`jlceda_find_component`、`jlceda_diagnostics` 分析导出的 JSON。

### 隐私与限制

- `exports/`、`logs/`、`node_modules/` 默认不会进入 git。
- 导出的 JSON 可能包含完整网表、BOM、工程路径或器件信息，公开仓库前请不要提交真实项目导出。
- 嘉立创 EDA 的 `SCH_Drc.check` 和 `PCB_Drc.check` 属于 API 中的 BETA 能力，返回结构可能随版本变化。
- 本项目当前实现的是“导出与诊断闭环”的数据通路；自动修改嘉立创工程文件需要额外的编辑策略和复核流程。

### License

MIT

## English

This project bridges JLCPCB/Lichuang EDA Pro with Codex and other MCP clients. It includes a JLCEDA Pro extension plus a local MCP/HTTP/WebSocket server that can export and parse:

- schematic/PCB DRC status
- schematic/PCB netlists, including EasyEDA JSON and Protel2-style data
- BOM files, including CSV/TSV/XLSX and UTF-16LE/base64 exports

The goal is not to replace JLCEDA Pro. The goal is to turn GUI-only design checks and manufacturing data into structured JSON that can be queried by automation, reviewed by Codex, and used as the data layer for later closed-loop schematic repair.

### Features

- JLCEDA Pro top menu: `CodexExport044`
- Live WebSocket bridge: an MCP client can request an export from the currently open project
- One-shot HTTP export path from the extension to the local receiver
- MCP tools for export listing, live export requests, summaries, net lookup, component lookup, BOM parsing, and diagnostics
- DRC API attempt errors are separated from real rule items, so a missing PCB canvas is not reported as a design-rule violation
- Raw export payloads are preserved while structured summaries are generated

### Repository Layout

```text
extension-live044/     Verified JLCEDA Pro extension source
mcp/                   Local MCP server plus HTTP/WebSocket bridge
scripts/               Startup, diagnostics, and packaging scripts
schemas/               JSON schema
samples/               Sanitized sample export
tools/                 .eext packaging helper
```

Default endpoints:

```text
HTTP:      http://127.0.0.1:38425
WebSocket: ws://127.0.0.1:38426/bridge/ws
```

### Install

Node.js 20 or newer is required.

```powershell
npm install
npm --prefix mcp install
```

### Start The Local Bridge

Development mode:

```powershell
npm --prefix mcp run http
```

Hidden Windows background process:

```powershell
.\scripts\start-local-bridge.ps1
```

Health checks:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:38425/health
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:38425/api/jlceda/ws-status
```

### Package And Install The JLCEDA Extension

```powershell
npm run package:extension
```

Import the generated `.eext` file in the JLCEDA Pro extension manager. Restart JLCEDA Pro, open a project, then click:

```text
CodexExport044 -> Start Live Bridge
```

After the live bridge is connected, MCP clients can request exports.

### MCP Configuration Example

Replace `<repo>` with the local repository path:

```json
{
  "mcpServers": {
    "jlceda-codex": {
      "command": "node",
      "args": [
        "<repo>\\mcp\\server.js"
      ],
      "env": {
        "JLCEDA_EXPORT_DIR": "<repo>\\exports",
        "JLCEDA_MCP_HTTP_PORT": "38425",
        "JLCEDA_MCP_WS_PORT": "38426"
      }
    }
  }
}
```

Codex `config.toml` example:

```toml
[mcp_servers.jlceda_codex]
command = "node"
args = ['<repo>\mcp\server.js']
startup_timeout_sec = 30

[mcp_servers.jlceda_codex.env]
JLCEDA_EXPORT_DIR = '<repo>\exports'
JLCEDA_MCP_HTTP_PORT = "38425"
JLCEDA_MCP_WS_PORT = "38426"
```

### MCP Tools

- `jlceda_list_exports`: list received JSON exports
- `jlceda_bridge_status`: show live WebSocket status
- `jlceda_request_export`: request a live export from JLCEDA Pro
- `jlceda_latest_export_summary`: summarize the newest export
- `jlceda_read_export`: read a specific export JSON
- `jlceda_parse_protel2_netlist`: parse EasyEDA JSON or Protel2 netlists
- `jlceda_find_net`: find a net and connected component pins
- `jlceda_find_component`: find a component by designator, value, footprint, supplier part, or manufacturer part
- `jlceda_diagnostics`: return DRC state and unconnected-pin diagnostics
- `jlceda_bom_rows`: return parsed BOM rows
- `jlceda_export_dir`: show the active export directory and bridge ports

### Validation

```powershell
npm --prefix mcp run check
npm --prefix mcp run smoke
.\scripts\check-live-bridge.ps1
```

Real closed-loop test:

1. Start the local bridge.
2. Open a project in JLCEDA Pro.
3. Click `CodexExport044 -> Start Live Bridge`.
4. Call `jlceda_request_export`.
5. Use `jlceda_find_net`, `jlceda_find_component`, and `jlceda_diagnostics` to inspect the exported JSON.

### Privacy And Limits

- `exports/`, `logs/`, and `node_modules/` are ignored by git.
- Exported JSON can contain full netlists, BOMs, project paths, and component data. Do not commit real project exports to a public repository.
- JLCEDA `SCH_Drc.check` and `PCB_Drc.check` are BETA APIs and their return shape may change.
- This project provides the export and diagnostics data path. Automatic project-file edits require a separate editing strategy and manual review loop.

### License

MIT
