# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在此代码库中工作时提供指导。

## 启动应用

```bash
python run.py
```

在 `http://127.0.0.1:8079` 启动 FastAPI 服务器，支持热重载。SQLite 数据库（`tracelog.db`）在启动时自动初始化。

## 架构概览

**TraceLog** 是一个 AI Agent 可观测性平台 —— 用于采集、存储和可视化 AI Agent 执行 Trace 的单体全栈应用。

### 技术栈
- **后端：** FastAPI + SQLAlchemy (SQLite) + Pydantic，代码位于 `backend/`
- **前端：** 原生 JS 单页应用（无框架），以静态文件方式从 `frontend/` 提供服务
- **数据库：** SQLite，自动创建于 `tracelog.db`

### 数据模型
遵循 OpenTelemetry GenAI 规范的三层层级结构：
- **TraceRecord** → **SpanRecord**（通过 `parent_span_id` 构建树形结构）→ **EventRecord**
- Span 类型：`AGENT`、`LLM`、`TOOL`、`CHAIN`、`RETRIEVER`
- LLM Span 记录 token 数量；总 token 数和费用汇总到 Trace 层级

### API
所有路由挂载于 `/api/v1/traces`：
- `POST /` — 通过 JSON body 采集单条 Trace
- `POST /upload` — 上传 JSON 文件（单条或批量数组）
- `GET /` — 列出 Trace，支持 `offset`、`limit`、`status`、`search` 参数
- `GET /{trace_id}` — 获取完整 Trace（含嵌套 Span 和 Event）
- `DELETE /{trace_id}` — 级联删除 Span 和 Event

### 后端数据流
```
JSON 输入 → parser.parse_trace() → _save_trace() → SQLite
```
`parser.py` 负责处理灵活的时间格式、自动生成缺失的 UUID、带回退的枚举校验，以及从 LLM Span 属性中计算 token 总量。

### 前端
单页应用位于 `frontend/app.js`（约 566 行），主要视图：
1. **Trace 列表** —— 可搜索、可分页的表格
2. **Trace 详情** —— 交互式层级时间轴
3. **Span 详情面板** —— 标签页视图；LLM Span 显示 Prompts/Completion 标签；Tool Span 显示输入/输出

Span 树在客户端基于扁平 `spans` 数组通过 `parent_span_id` 构建。
