# TraceLog

AI Agent 可观测性平台，用于采集、存储和可视化 AI Agent 的执行 Trace。

## 功能特性

- **Trace 采集**：支持 JSON body 直接上传或文件批量导入
- **层级可视化**：交互式时间轴，展示 Trace → Span → Event 完整调用链
- **多类型 Span**：区分 Agent、LLM、Tool、Chain、Retriever 不同执行节点
- **LLM 详情**：查看完整的 Prompt 输入与 Completion 输出，统计 Token 用量和费用
- **搜索与过滤**：按名称搜索、按状态（OK / ERROR / UNSET）筛选

## 快速开始

**环境要求：** Python 3.9+

```bash
# 安装依赖
pip install -r requirements.txt

# 启动服务
python run.py
```

浏览器访问 `http://127.0.0.1:8079`，点击「加载示例数据」即可体验。

## 数据格式

Trace JSON 遵循 OpenTelemetry GenAI 语义规范，基本结构如下：

```json
{
  "trace_id": "my_trace_001",
  "name": "Agent Run",
  "start_time": "2026-03-16T10:00:00Z",
  "end_time": "2026-03-16T10:00:12Z",
  "status": "OK",
  "spans": [
    {
      "span_id": "span_001",
      "parent_span_id": null,
      "name": "root",
      "span_kind": "AGENT",
      "start_time": "2026-03-16T10:00:00Z",
      "end_time": "2026-03-16T10:00:12Z",
      "status": "OK",
      "attributes": {},
      "events": []
    }
  ]
}
```

支持批量上传（JSON 数组格式）。缺失的 `trace_id` / `span_id` 会自动生成。

### Span 属性约定

| Span 类型 | 关键属性 |
|-----------|---------|
| `LLM` | `llm.input_messages`、`llm.output_messages`、`llm.token_count.prompt`、`llm.token_count.completion` |
| `TOOL` | `tool.name`、`tool.input`、`tool.output` |
| `AGENT` | `agent.name`、`agent.input`、`agent.output` |

## API

Base URL：`/api/v1/traces`

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/` | 采集单条 Trace（JSON body） |
| `POST` | `/upload` | 上传 JSON 文件（单条或批量） |
| `GET` | `/` | 列出 Trace，支持 `offset`、`limit`、`status`、`search` |
| `GET` | `/{trace_id}` | 获取完整 Trace（含所有 Span 和 Event） |
| `DELETE` | `/{trace_id}` | 删除 Trace（级联删除 Span 和 Event） |

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | FastAPI · SQLAlchemy · Pydantic · Uvicorn |
| 前端 | 原生 JavaScript（无框架）|
| 数据库 | SQLite（运行时自动创建） |
