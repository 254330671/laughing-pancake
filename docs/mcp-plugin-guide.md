# MCP 插件开发指导文档（LLM 直用版）

> **这份文档的用途**：让任何用户把「这份文档 + 自己的需求描述」直接交给一个 LLM（Claude、ChatGPT 等），LLM 就能一次性生成一个**符合 MCP 协议、可直接接入应用**（Claude Code、Claude Desktop、Claude API 或任何 MCP 兼容宿主）的插件（MCP Server），包含完整代码、接入配置和测试方法。
>
> 文档内容核实日期：2026-07（协议版本 2025-11-25；Python SDK 稳定版 1.28.x；TypeScript SDK 稳定版 1.29.x）。所有协议细节均出自官方规范与官方 SDK 文档，出处见文末。

---

## 0. 怎么使用这份文档

### 给人类用户的三步流程

1. **写清需求**：按第 9 节的「需求描述模板」填写你想要的插件功能（要暴露哪些工具、连什么系统、需要什么密钥）。
2. **交给 LLM**：把**整份文档**和你的需求描述一起发给 LLM，并附上第 9 节的「生成指令」。
3. **验收**：按第 7 节测试插件，按第 8 节的验收清单逐项核对。

### 给 LLM 的总原则（生成插件时必须遵守）

- **默认技术选型**：除非用户另有要求，使用 **stdio 传输 + 官方 SDK 稳定版**（Python 用 FastMCP，TypeScript 用 `@modelcontextprotocol/sdk`）。这是最省事、兼容性最好的路径。
- **必须使用第 3 节标注的「稳定版」SDK API**。两个官方 SDK 的 main 分支目前是 v2 预发布版，API 与稳定版不同——不要凭记忆或 main 分支文档生成代码（常见错误见 3.3）。
- **产出必须完整**：项目文件结构、全部源代码、依赖清单（`pyproject.toml`/`requirements.txt` 或 `package.json`+`tsconfig.json`）、宿主接入配置片段、测试命令。用户复制粘贴即可运行。
- **生成后自检**：对照第 8 节验收清单逐项检查自己生成的代码，不合规处必须修正后再输出。

---

## 1. MCP 是什么：一页看懂

**MCP（Model Context Protocol，模型上下文协议）** 是连接 AI 应用与外部系统的开放标准协议。你写的「插件」在 MCP 术语里叫 **MCP Server**。

```
┌──────────────────────────────┐          ┌─────────────────────┐
│ 宿主应用 (Host)                │  MCP协议  │ 你的插件 (MCP Server) │
│ Claude Code / Claude Desktop  │ ◄──────► │ 暴露 工具/资源/提示词   │
│ Claude API / 自研应用          │ JSON-RPC │ 连接 数据库/API/文件…  │
└──────────────────────────────┘          └─────────────────────┘
```

- **Host（宿主）**：AI 应用本体（如 Claude Code）。
- **Client（客户端）**：宿主内部与每个 Server 保持 1:1 连接的组件，由宿主实现——**你不需要写它**。
- **Server（服务端，即你的插件）**：一个独立程序，通过标准化接口向宿主暴露能力。

Server 可以暴露三类能力（可任选，最常用的是工具）：

| 能力 | 谁决定何时使用 | 用途 | 典型例子 |
|---|---|---|---|
| **Tools（工具）** | 模型自动调用 | 执行动作、查询数据 | `query_database`、`send_email` |
| **Resources（资源）** | 应用/宿主决定 | 提供上下文数据（类似只读文件） | 配置文件、文档内容 |
| **Prompts（提示词）** | 用户主动触发 | 预置的提示词模板（如斜杠命令） | `/code_review` |

**一个只暴露 1~2 个工具的 Server 就是完全合法、完整的插件。** 从工具开始，需要时再加资源和提示词。

---

## 2. 协议硬性要求（合规契约）

以下是 MCP 规范（2025-11-25 修订版）中影响「插件能否被宿主接受」的硬性规则。**用官方 SDK 时，2.1~2.2 由 SDK 自动处理**，但你必须遵守 2.3~2.6。

### 2.1 消息格式与生命周期

- 所有消息遵循 **JSON-RPC 2.0**，UTF-8 编码。请求必须带 `id`（字符串或整数，**不得为 null，同一会话内不得复用**）；通知不带 `id`。不支持 JSON-RPC 批量（batch）。
- 连接建立后的第一步必须是**初始化握手**：客户端发 `initialize` 请求（带 `protocolVersion`、`capabilities`、`clientInfo`）→ 服务端回复自己的 `protocolVersion`、`capabilities`、`serverInfo` → 客户端发 `notifications/initialized` 通知。之后才进入正常操作阶段。
- **版本协商**：当前协议版本字符串为 `"2025-11-25"`。若服务端支持客户端请求的版本，必须原样返回；否则返回自己支持的版本。SDK 自动处理。

初始化握手的最小示例（原生 JSON-RPC，供不用 SDK 的实现参考）：

```json
// ← 客户端
{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
  "protocolVersion": "2025-11-25",
  "capabilities": {},
  "clientInfo": {"name": "ExampleClient", "version": "1.0.0"}
}}
// → 服务端
{"jsonrpc": "2.0", "id": 1, "result": {
  "protocolVersion": "2025-11-25",
  "capabilities": {"tools": {"listChanged": true}},
  "serverInfo": {"name": "my-plugin", "version": "1.0.0"}
}}
// ← 客户端
{"jsonrpc": "2.0", "method": "notifications/initialized"}
```

### 2.2 核心方法一览

| 能力 | 方法 | 说明 |
|---|---|---|
| 工具 | `tools/list` | 返回 `{tools: [...], nextCursor?}`，支持 `cursor` 分页 |
| 工具 | `tools/call` | 参数 `{name, arguments}`，返回 CallToolResult（见 2.4） |
| 资源 | `resources/list` / `resources/read` | read 参数 `{uri}`，返回 `{contents: [{uri, mimeType?, text 或 blob}]}` |
| 提示词 | `prompts/list` / `prompts/get` | get 返回 `{description?, messages: [{role, content}]}` |
| 通用 | `ping` | 双向心跳，返回空对象 |

服务端在 `initialize` 响应的 `capabilities` 里声明自己实现了哪些能力，例如 `{"tools": {"listChanged": true}, "resources": {}, "prompts": {}}`。只声明你真正实现了的。

### 2.3 stdio 传输的铁律（最常见的翻车点）

stdio 模式下宿主把你的插件作为子进程启动，stdin/stdout 就是协议信道：

- stdout 上**每行一条** JSON-RPC 消息，消息内不得含换行。
- **绝对禁止向 stdout 输出任何非协议内容**——一句 `print()`（Python）或 `console.log()`（JS）、一条启动 banner、甚至依赖库打的日志，都会破坏 JSON-RPC 帧，宿主端表现为 `Unexpected token ... is not valid JSON`，连接直接失败。
- **所有日志一律写 stderr**：Python 用 `logging` 或 `print(..., file=sys.stderr)`；TypeScript 用 `console.error()`。宿主会捕获 stderr 作为服务器日志（Claude Desktop 存到 `mcp-server-<名字>.log`）。

### 2.4 工具定义与返回值

**工具定义**（`tools/list` 返回的每一项）：

```json
{
  "name": "get_weather",
  "title": "天气查询",
  "description": "查询指定城市的当前天气。当用户询问天气、气温、降水时调用。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "city": {"type": "string", "description": "城市名，如 Beijing"}
    },
    "required": ["city"]
  }
}
```

- `name`：**1~128 个字符，只能用 `A-Z a-z 0-9 _ - .`**，不能有空格，Server 内唯一。推荐 `snake_case` 动宾结构（`query_orders`、`create_ticket`）。
- `inputSchema`：必填，必须是合法的 JSON Schema 对象（默认方言 2020-12），**不能为 null**。无参数工具用 `{"type": "object", "additionalProperties": false}`。
- `description`：写清**做什么 + 什么时候该调用**。模型靠它决定是否调用工具，这是插件好不好用的第一决定因素。
- 可选 `outputSchema`：声明后，返回值中的 `structuredContent` **必须**符合该 Schema，且应同时把同一 JSON 序列化进一个 text 内容块（向后兼容）。

**工具返回值（CallToolResult）**：

```json
{
  "content": [{"type": "text", "text": "北京当前 22°C，晴"}],
  "structuredContent": {"temperature": 22, "condition": "晴"},
  "isError": false
}
```

- `content` 必填，是内容块数组。内容块类型：`text`（最常用）、`image`/`audio`（base64 `data` + `mimeType`）、`resource_link`、内嵌 `resource`。
- `structuredContent`、`isError` 可选。

### 2.5 两类错误，不能混用

| 错误类型 | 何时用 | 怎么返回 |
|---|---|---|
| **协议错误**（JSON-RPC error 响应） | 工具名不存在、请求结构不合法、服务器内部故障 | `{"error": {"code": -32602, "message": "Unknown tool: xxx"}}` |
| **工具执行错误**（正常 result + `isError: true`） | 业务失败：上游 API 报错、**入参校验不通过**（如日期格式错、数值越界）、找不到记录 | `{"content": [{"type": "text", "text": "订单号不存在: A1024"}], "isError": true}` |

规则：**工具内部发生的一切错误都走 `isError: true`**，并在 `content` 里用一句可操作的话描述原因——模型能读到它并自我纠正（换参数重试、改用别的工具）。协议错误模型通常无法处理。JSON-RPC 标准错误码：`-32700` 解析错误、`-32600` 无效请求、`-32601` 方法不存在、`-32602` 参数无效、`-32603` 内部错误；资源不存在用 `-32002`。

### 2.6 两种传输方式怎么选

| | **stdio（默认推荐）** | **Streamable HTTP** |
|---|---|---|
| 运行方式 | 宿主把插件作为本地子进程启动 | 插件是独立 HTTP 服务，可远程部署、多客户端共享 |
| 适用场景 | 个人/团队本地插件、访问本机资源 | 对外提供服务、云端部署、需要集中鉴权 |
| 关键要求 | 见 2.3 | 单一端点（如 `/mcp`）同时支持 POST（必须）和 GET（可选 SSE）；客户端会带 `MCP-Protocol-Version` 和（若启用会话）`MCP-Session-Id` 头；**必须校验 `Origin` 头**（防 DNS rebinding，非法 Origin 返回 403）；本机服务只绑定 `127.0.0.1`；生产环境应实现鉴权（规范采用 OAuth 2.1，MCP Server 作为资源服务器） |

> 旧版「HTTP+SSE 双端点」传输（2024-11-05 时代）已废弃，新插件不要实现它。stdio 插件不需要实现 OAuth——密钥通过环境变量传入即可。

---

## 3. 用官方 SDK 实现（推荐路径，含完整模板）

### 3.1 Python（FastMCP，最少代码）

**环境**：Python ≥ 3.10。**安装**（务必加 `<2` 上界，见 3.3）：

```bash
pip install "mcp[cli]>=1.27,<2"        # 或 uv add "mcp[cli]>=1.27,<2"
```

**完整 stdio 插件模板**（`server.py`，可直接运行）：

```python
"""示例 MCP 插件：把这里替换成你的业务逻辑。"""
import sys
import logging

from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.exceptions import ToolError

# 日志必须走 stderr —— 千万不要 print() 到 stdout
logging.basicConfig(level=logging.INFO, stream=sys.stderr)

mcp = FastMCP("my-plugin")  # Server 名称


@mcp.tool()
def query_order(order_id: str) -> str:
    """查询订单状态。当用户询问某个订单的进度、物流或状态时调用。

    Args:
        order_id: 订单号，例如 A1024
    """
    if not order_id.startswith("A"):
        # 业务/入参错误 → 抛 ToolError，SDK 自动转成 isError=True 的返回
        raise ToolError(f"订单号格式不正确: {order_id}（应以 A 开头）")
    # TODO: 替换为真实查询逻辑
    return f"订单 {order_id}：已发货，预计明天送达"


@mcp.tool()
def add(a: int, b: int) -> int:
    """计算两个整数之和。"""
    return a + b


# 可选：资源（URI 模板参数自动映射为函数参数）
@mcp.resource("greeting://{name}")
def get_greeting(name: str) -> str:
    """按名字生成问候语"""
    return f"Hello, {name}!"


# 可选：提示词模板
@mcp.prompt()
def review_code(code: str) -> str:
    """生成代码评审提示词"""
    return f"请评审这段代码并指出问题：\n\n{code}"


if __name__ == "__main__":
    mcp.run(transport="stdio")   # 默认就是 stdio，可省略参数
```

要点：

- **类型注解 + docstring 就是 Schema**：FastMCP 用函数签名自动生成 `inputSchema`，docstring 成为工具 `description`（`Args:` 段落成为参数描述）。带默认值的参数为可选参数。
- **结构化输出**：返回 Pydantic `BaseModel`、`TypedDict`、dataclass 或 `dict[str, T]` 时，SDK 自动生成 `outputSchema` 并填充 `structuredContent`（基础类型会包装成 `{"result": value}`）。
- **错误**：优先 `raise ToolError("原因")`；未捕获异常也会被 SDK 转为 `isError: true`。
- **改用 Streamable HTTP**（生产部署推荐无状态 + JSON 响应）只需改两处：

```python
mcp = FastMCP("my-plugin", stateless_http=True, json_response=True)
# ...
mcp.run(transport="streamable-http")   # 注意是连字符；默认监听 http://localhost:8000/mcp
```

### 3.2 TypeScript（@modelcontextprotocol/sdk）

**环境**：Node.js ≥ 18。**安装**：

```bash
npm init -y
npm install @modelcontextprotocol/sdk zod@3
npm install -D @types/node typescript
```

`package.json` 需加 `"type": "module"`，构建脚本示例 `"build": "tsc && chmod 755 build/index.js"`。`tsconfig.json` 关键项：`"target": "ES2022", "module": "Node16", "moduleResolution": "Node16", "outDir": "./build", "rootDir": "./src", "strict": true`。

**完整 stdio 插件模板**（`src/index.ts`）：

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "my-plugin",
  version: "1.0.0",
});

server.registerTool(
  "query_order",
  {
    title: "订单查询",
    description: "查询订单状态。当用户询问某个订单的进度、物流或状态时调用。",
    // 注意：v1 SDK 的 inputSchema 是「zod 字段对象」（ZodRawShape），不要包 z.object()
    inputSchema: {
      order_id: z.string().describe("订单号，例如 A1024"),
    },
  },
  async ({ order_id }) => {
    if (!order_id.startsWith("A")) {
      // 业务/入参错误 → isError: true，模型可读并自我纠正
      return {
        content: [{ type: "text", text: `订单号格式不正确: ${order_id}（应以 A 开头）` }],
        isError: true,
      };
    }
    // TODO: 替换为真实查询逻辑
    return {
      content: [{ type: "text", text: `订单 ${order_id}：已发货，预计明天送达` }],
    };
  },
);

// 可选：带结构化输出的工具
server.registerTool(
  "calculate_bmi",
  {
    description: "计算 BMI 指数",
    inputSchema: { weightKg: z.number(), heightM: z.number() },
    outputSchema: { bmi: z.number() },
  },
  async ({ weightKg, heightM }) => {
    const output = { bmi: weightKg / (heightM * heightM) };
    return {
      content: [{ type: "text", text: JSON.stringify(output) }],
      structuredContent: output,
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("my-plugin MCP Server running on stdio"); // 日志用 console.error（stderr）
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
```

要点：

- 导入路径必须带 **`.js` 后缀**（ESM 子路径导入）。
- 用 `registerTool` / `registerResource` / `registerPrompt`；旧的 `server.tool()` 等已标记 deprecated。
- **Streamable HTTP 版**：用 `createMcpExpressApp()`（来自 `@modelcontextprotocol/sdk/server/express.js`，自带 DNS-rebinding 防护）+ `StreamableHTTPServerTransport`（来自 `.../server/streamableHttp.js`）。无状态模式在每个 `app.post('/mcp', ...)` 请求内新建 server + transport（`sessionIdGenerator: undefined`），`await server.connect(transport); await transport.handleRequest(req, res, req.body)`，并在 `res.on('close')` 时清理。

### 3.3 ⚠️ SDK 版本陷阱（LLM 生成代码最容易错的地方）

两个官方 SDK 目前都处于 v1→v2 过渡期，**main 分支文档描述的是 v2 预发布版**。生成生产代码必须用 v1 稳定版 API：

| | ✅ v1 稳定版（用这个） | ❌ v2 预发布（不要用） |
|---|---|---|
| Python 导入 | `from mcp.server.fastmcp import FastMCP` | `from mcp.server import MCPServer` |
| Python 安装 | `pip install "mcp[cli]>=1.27,<2"` | `mcp==2.0.0bN` |
| TS 包名 | `@modelcontextprotocol/sdk` | `@modelcontextprotocol/server` / `@modelcontextprotocol/client` |
| TS 导入 | `"@modelcontextprotocol/sdk/server/mcp.js"`（带 `.js`） | `'@modelcontextprotocol/server'`（无 `.js`） |
| TS inputSchema | 字段对象 `{ name: z.string() }` | `z.object({ name: z.string() })` |

其他易错点：Python 装饰器**必须带括号**（`@mcp.tool()`）；Python HTTP 传输字符串是 `"streamable-http"`（连字符，不是下划线）；TS 的 zod 是必需 peer 依赖（`^3.25 || ^4.0`）。

### 3.4 不用 SDK（其他语言）

Go、Java、Rust 等也有官方/社区 SDK（见 modelcontextprotocol.io 的 SDK 列表）。若目标语言没有 SDK，按第 2 节的 JSON-RPC 消息格式手写即可：stdio 模式下只需实现 `initialize`、`notifications/initialized`（收）、`tools/list`、`tools/call`、`ping` 五个消息的处理，每行一条 JSON 写到 stdout。

---

## 4. 工具设计规范（决定插件好不好用）

1. **描述要写「何时调用」**：不只写功能，还要写触发条件。对比：
   - ❌ `"查询数据库"`
   - ✅ `"查询销售数据库。当用户询问销量、营收、客户订单等业务数据时调用。只支持只读查询。"`
2. **参数少而精**：每个参数写 `description`；枚举值用 JSON Schema `enum`；能给默认值的给默认值。真正必填的才放进 `required`。
3. **返回内容为模型服务**：返回模型下一步推理需要的信息，而不是原始数据倾倒。大结果要分页/截断/汇总（Claude Code 默认对单次工具输出有 25,000 token 上限）。
4. **错误信息可操作**：`isError` 的文本要告诉模型「哪里错了 + 怎么改」，例如 `"日期格式应为 YYYY-MM-DD，收到的是 2026/1/1"`。
5. **工具数量克制**：一个插件聚焦一个领域，工具控制在 3~10 个。太多相似工具会让模型选错。
6. **幂等与安全**：有副作用的操作（删除、发送、支付）在描述里写明，宿主可据此要求用户确认。

---

## 5. 接入应用（宿主配置）

### 5.1 Claude Code（CLI）

```bash
# stdio 插件（-- 之后是启动插件的完整命令）
claude mcp add my-plugin -- python /绝对路径/server.py
claude mcp add my-plugin -- node /绝对路径/build/index.js

# 带环境变量（传密钥）
claude mcp add my-plugin --env API_KEY=xxx -- python /绝对路径/server.py

# 远程 HTTP 插件
claude mcp add --transport http my-plugin https://example.com/mcp \
  --header "Authorization: Bearer TOKEN"

# 管理命令
claude mcp list          # 列出所有服务器及连接状态
claude mcp get my-plugin # 查看详情
claude mcp remove my-plugin
```

**作用域**（`--scope`，默认 `local`）：`local` 仅当前项目当前用户；`project` 写入项目根目录 `.mcp.json`（进版本库，团队共享）；`user` 当前用户所有项目可用。

**项目级 `.mcp.json` 格式**（放在项目根目录）：

```json
{
  "mcpServers": {
    "my-plugin": {
      "type": "stdio",
      "command": "python",
      "args": ["${CLAUDE_PROJECT_DIR}/mcp/server.py"],
      "env": {
        "API_KEY": "${MY_API_KEY}",
        "DB_URL": "${DB_URL:-sqlite:///:memory:}"
      }
    },
    "remote-plugin": {
      "type": "http",
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer ${API_TOKEN}" },
      "timeout": 60000
    }
  }
}
```

支持 `${VAR}` 和 `${VAR:-默认值}` 环境变量展开；`${CLAUDE_PROJECT_DIR}` 是项目根目录。会话内可用 `/mcp` 查看连接状态和认证。修改 `.mcp.json` 后需重启会话生效；项目级新服务器首次使用需在信任弹窗中批准。启动超时默认 30 秒，可用 `MCP_TIMEOUT=60000 claude` 或每服务器 `"timeout"` 字段调整。

### 5.2 Claude Desktop

配置文件位置：

- macOS：`~/Library/Application Support/Claude/claude_desktop_config.json`（或 设置 → 开发者 → 编辑配置）
- Windows：`%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "my-plugin": {
      "command": "/usr/local/bin/python3",
      "args": ["/绝对路径/server.py"],
      "env": { "API_KEY": "xxx" }
    }
  }
}
```

三条铁律：**① 命令和路径必须用绝对路径**（Claude Desktop 以极简 PATH 启动，`python`/`npx` 这种短名经常找不到，报 `spawn xxx ENOENT`）；**② 改完配置必须完全退出重启**（macOS Cmd+Q，关窗口不算）；**③ 排错看日志**：macOS `~/Library/Logs/Claude/mcp.log`（连接日志）和 `mcp-server-<名字>.log`（你插件的 stderr），Windows 在 `%APPDATA%\Claude\logs\`。

### 5.3 打包成 Claude Code 插件（可分发）

若想把 MCP Server 作为 Claude Code 插件分发（随插件安装自动注册），在插件根目录放 `.mcp.json`，或在 `.claude-plugin/plugin.json` 里内联 `mcpServers` 字段，路径用 `${CLAUDE_PLUGIN_ROOT}`（插件安装目录）：

```json
{
  "name": "my-plugin",
  "mcpServers": {
    "database-tools": {
      "command": "${CLAUDE_PLUGIN_ROOT}/servers/db-server",
      "args": ["--config", "${CLAUDE_PLUGIN_ROOT}/config.json"]
    }
  }
}
```

插件启用时 MCP Server 自动连接；工具全名形如 `mcp__plugin_<插件名>_<服务器名>__<工具名>`。

### 5.4 Claude API / Managed Agents（程序化接入）

- **Messages API（MCP connector，beta）**：仅支持远程 URL 型（Streamable HTTP）Server。请求带 beta 头 `mcp-client-2025-11-20`，且 `mcp_servers` 与 `tools` 必须成对出现：

```python
client.beta.messages.create(
    model="claude-opus-4-8", max_tokens=1024,
    betas=["mcp-client-2025-11-20"],
    mcp_servers=[{"type": "url", "url": "https://example.com/mcp", "name": "my-plugin"}],
    tools=[{"type": "mcp_toolset", "mcp_server_name": "my-plugin"}],
    messages=[...],
)
```

- **Managed Agents（beta）**：在 Agent 定义的 `mcp_servers` 里声明 `{type: "url", name, url}`（不含鉴权），OAuth/token 凭据存入 Vault，创建 Session 时用 `vault_ids` 挂载。托管 MCP 服务器（如 mcp.linear.app）通常要求 OAuth bearer token，而非该服务的原生 API key。

### 5.5 其他 MCP 兼容宿主

任何实现了 MCP 客户端的应用（Cursor、Windsurf、自研 Host 等）都能接入你的插件——stdio 插件给出「启动命令 + 参数 + 环境变量」，HTTP 插件给出 URL 即可。这正是 MCP 的价值：**一次实现，处处接入**。

---

## 6. 安全要求

1. **密钥管理**：密钥只通过环境变量或宿主配置的 `env` 传入，绝不硬编码进代码，绝不写入工具描述或返回内容，绝不打进日志。
2. **输入校验**：所有工具入参必须校验（SDK 的 Schema 校验之外，业务规则也要查）。涉及文件路径的参数必须规范化后确认仍在允许目录内（防 `../` 穿越）；涉及 SQL 的必须参数化查询；涉及 shell 的避免拼接命令。
3. **最小权限**：数据库用只读账号就不要给写权限；能限定 API scope 就限定。插件的权限就是模型的权限。
4. **HTTP 服务**：本地开发只绑定 `127.0.0.1`；校验 `Origin` 头；对外服务必须鉴权（OAuth 2.1 / Bearer token）。
5. **破坏性操作**：在工具描述中明确标注（宿主如 Claude Code 会让用户确认），必要时插件内部再加确认参数或 dry-run 模式。

---

## 7. 测试与调试

### 7.1 第一站：MCP Inspector（官方可视化调试器）

不接宿主、直接测插件（需 Node.js ≥ 22.7.5）：

```bash
# stdio 插件
npx @modelcontextprotocol/inspector python server.py
npx @modelcontextprotocol/inspector node build/index.js

# 带环境变量（-e 属于 Inspector，-- 之后属于你的插件）
npx @modelcontextprotocol/inspector -e API_KEY=xxx -- python server.py

# Python 快捷方式（需 mcp[cli]）
mcp dev server.py

# HTTP 插件：先启动你的服务，再裸启 Inspector，在 UI 里选 Streamable HTTP 填 URL
npx @modelcontextprotocol/inspector
```

浏览器打开 `http://localhost:6274`（启动时打印的带 token 链接），在 Tools/Resources/Prompts 标签页里逐个调用、看请求历史和通知。

**CLI 模式**可脚本化冒烟测试（适合 CI）：

```bash
npx @modelcontextprotocol/inspector --cli python server.py --method tools/list
npx @modelcontextprotocol/inspector --cli python server.py \
  --method tools/call --tool-name query_order --tool-arg order_id=A1024
```

### 7.2 推荐流程

1. **Inspector 先行**：确认 `tools/list` 输出的名称/描述/Schema 符合预期，逐个工具用合法参数、非法参数、边界值各调一遍，确认错误走 `isError` 且信息可操作。
2. **再接宿主**：配置进 Claude Code（`claude mcp list` 看状态）或 Claude Desktop，用自然语言让模型真实调用一轮。
3. **自动化**（可选）：Python 可用 `mcp.shared.memory.create_connected_server_and_client_session` 在内存中直连 server 写 pytest；或用 Inspector CLI 模式在 CI 里跑冒烟。

### 7.3 常见故障速查

| 症状 | 原因 | 解法 |
|---|---|---|
| 宿主报 `... is not valid JSON` | stdout 被日志污染 | 全部日志改 stderr（见 2.3）；引号里那个字符就是污染源的第一个字符 |
| `spawn xxx ENOENT` | 命令不在宿主的极简 PATH 里 | 配置里用绝对路径 |
| 启动超时 | npx 首次下载包、启动慢 | `MCP_TIMEOUT=60000` 或配置 `"timeout"` 字段 |
| 连上了但没有工具 | 缺环境变量导致工具注册失败 | 配置 `env` 传入密钥；看 stderr 日志 |
| 读文件失败/相对路径错乱 | 宿主启动子进程的工作目录不确定（可能是 `/`） | 代码和配置里一律绝对路径 |
| 改了 `.mcp.json` 不生效 | 只在会话启动时读取 | 重启 Claude Code 会话 / 完全退出重启 Claude Desktop |
| Windows 下 npx 起不来 | cmd.exe 不按 bash 方式搜 PATH | 用 `cmd /c npx ...` 或绝对路径 |

---

## 8. 验收清单（生成后逐项自检）

**协议合规**

- [ ] 用官方 SDK 稳定版（Python `mcp>=1.27,<2` + `FastMCP`；TS `@modelcontextprotocol/sdk` 1.x + `registerTool`），或手写实现完整覆盖 2.1/2.2 的握手与方法
- [ ] stdio 模式下代码（含依赖）没有任何 stdout 输出，日志全部走 stderr
- [ ] 每个工具：`name` 合法（`[A-Za-z0-9_.-]{1,128}`）、`inputSchema` 为合法 JSON Schema 对象、`description` 写明何时调用
- [ ] 业务/入参错误返回 `isError: true` + 可操作的错误文本，而不是抛协议错误或让进程崩溃
- [ ] 声明了 `outputSchema` 的工具，`structuredContent` 符合 Schema，且同一 JSON 也放进了 text 内容块

**工程完整性**

- [ ] 交付了完整文件清单：源代码、依赖声明（`pyproject.toml`/`requirements.txt` 或 `package.json`+`tsconfig.json`）、README（含运行与接入步骤）
- [ ] 密钥全部走环境变量，代码中无硬编码
- [ ] 文件路径/SQL/命令注入风险已按第 6 节处理
- [ ] 提供了目标宿主的接入配置片段（5.1~5.4 对应格式），路径为绝对路径或使用 `${CLAUDE_PROJECT_DIR}` 等变量

**可验证性**

- [ ] 提供了 Inspector 测试命令，且 `tools/list`、`tools/call` 正反用例均可通过
- [ ] 无参数工具的 `inputSchema` 是 `{"type": "object", "additionalProperties": false}`
- [ ] TS 版：导入带 `.js` 后缀、`package.json` 有 `"type": "module"`、inputSchema 用字段对象而非 `z.object()`
- [ ] Python 版：装饰器带括号、传输字符串为 `"stdio"` / `"streamable-http"`

---

## 9. LLM 生成模板（复制即用）

### 需求描述模板（用户填写）

```text
【插件名称】my-plugin
【一句话功能】查询公司内部订单系统的订单状态和物流信息
【实现语言】Python / TypeScript（二选一；不确定就选 Python）
【运行方式】本地 stdio（默认）/ 远程 HTTP
【目标宿主】Claude Code / Claude Desktop / Claude API / 其他：____
【工具清单】
  1. query_order —— 按订单号查订单状态；参数：order_id（字符串，必填）
  2. list_recent_orders —— 列出最近 N 天的订单；参数：days（整数，默认 7）
【要连接的外部系统】内部 REST API https://api.example.com/orders，
  鉴权方式：Header "Authorization: Bearer $ORDER_API_TOKEN"
【需要的环境变量】ORDER_API_TOKEN
【特殊要求】只读，不需要写操作；返回结果控制在 50 条以内
```

### 生成指令（连同本文档、需求描述一起发给 LLM）

```text
你是一名 MCP 插件开发专家。请严格依据我提供的《MCP 插件开发指导文档》
和上面的需求描述，生成一个完整可运行的 MCP Server 插件。要求：

1. 遵守文档第 2 节的全部协议硬性要求，使用第 3 节指定的 SDK 稳定版 API
  （注意 3.3 的版本陷阱）。
2. 按第 4 节规范设计工具的名称、描述和参数 Schema。
3. 按第 6 节处理密钥与输入校验。
4. 输出以下全部内容，缺一不可：
   a. 项目文件树
   b. 每个文件的完整代码（不省略、不用 "..." 占位）
   c. 安装与运行命令
   d. 针对我的目标宿主的接入配置（文档第 5 节对应格式）
   e. MCP Inspector 测试命令与 2~3 个测试用例（含一个错误输入用例）
5. 最后对照文档第 8 节验收清单逐项自检，输出核对结果；
   任何一项不满足，先修正代码再交付。
6. 需求中含糊之处，选择最简单的合理默认值并在交付说明中标注，
   不要展开询问。
```

---

## 附录 A：原生 JSON-RPC 参考实现要点（无 SDK 语言用）

一个最小合规 stdio Server 只需处理 5 种消息（全部单行 JSON 写 stdout）：

1. `initialize`（请求）→ 返回 `{protocolVersion, capabilities: {"tools": {}}, serverInfo: {name, version}}`。若客户端请求的版本不认识，返回你支持的版本（如 `"2025-11-25"`）。
2. `notifications/initialized`（通知）→ 无需响应。
3. `tools/list`（请求）→ 返回 `{tools: [...]}`（工具定义格式见 2.4）。
4. `tools/call`（请求）→ 执行并返回 CallToolResult；未知工具名返回 JSON-RPC error `-32602`。
5. `ping`（请求）→ 返回 `{}`。

其余方法可返回 `-32601`（Method not found）。收到无法解析的行返回 `-32700`。

## 附录 B：信息来源

- MCP 规范 2025-11-25 修订版：modelcontextprotocol.io/specification/2025-11-25（生命周期、传输、tools/resources/prompts、授权各章）及其源仓库 `modelcontextprotocol/modelcontextprotocol` 的 `schema/2025-11-25/schema.ts`
- 官方 SDK：`modelcontextprotocol/python-sdk`（v1.x 分支 README 与 docs/server.md）、`modelcontextprotocol/typescript-sdk`（v1.x 分支 README 与 docs/server.md）
- 官方构建/调试指南：modelcontextprotocol.io/docs/develop/build-server、/docs/tools/inspector、/docs/tools/debugging
- Claude Code MCP 文档：code.claude.com/docs/en/mcp 及 plugins-reference
- Claude API MCP connector 与 Managed Agents：platform.claude.com/docs（MCP connector、managed-agents/mcp-connector）

> 协议与 SDK 演进较快（SDK v2 预计 2026-07 底转正）。使用本文档超过半年后，建议按附录 B 的来源核对协议版本号与 SDK 安装方式，其余设计原则长期有效。
