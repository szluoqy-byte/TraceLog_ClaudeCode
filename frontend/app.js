/* ─── TraceLog Frontend Application ──────────────────────────────────────── */

const API = '/api/v1/traces';
const app = document.getElementById('app');

// ─── Utilities ──────────────────────────────────────────────────────────────

function formatDuration(ms) {
  if (ms == null) return '-';
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString();
}

function shortTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleTimeString();
}

function statusBadge(status) {
  const cls = status === 'ERROR' ? 'badge-error' : status === 'OK' ? 'badge-ok' : 'badge-unset';
  return `<span class="badge ${cls}">${status}</span>`;
}

function kindBadge(kind) {
  const cls = `badge-kind-${kind.toLowerCase()}`;
  return `<span class="badge-kind ${cls}">${kind}</span>`;
}

function escapeHtml(str) {
  if (typeof str !== 'string') str = JSON.stringify(str, null, 2);
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ─── API Calls ──────────────────────────────────────────────────────────────

async function fetchTraces(search = '', status = '') {
  const params = new URLSearchParams({ limit: '100' });
  if (search) params.set('search', search);
  if (status) params.set('status', status);
  const res = await fetch(`${API}?${params}`);
  return res.json();
}

async function fetchTrace(traceId) {
  const res = await fetch(`${API}/${traceId}`);
  return res.json();
}

async function deleteTrace(traceId) {
  await fetch(`${API}/${traceId}`, { method: 'DELETE' });
}

async function loadSampleData() {
  const res = await fetch('/static/sample_trace.json');
  const data = await res.json();
  const items = Array.isArray(data) ? data : [data];
  await Promise.all(items.map(item => fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  })));
}

// ─── Views ──────────────────────────────────────────────────────────────────

function renderTraceRow(t) {
  return `
    <tr>
      <td class="trace-name" data-id="${t.trace_id}">${escapeHtml(t.name)}</td>
      <td>${statusBadge(t.status)}</td>
      <td class="mono">${formatDuration(t.duration_ms)}</td>
      <td class="mono">${t.span_count}</td>
      <td class="mono">${t.total_tokens.toLocaleString()}</td>
      <td class="mono">${shortTime(t.start_time)}</td>
      <td><button class="btn btn-del" data-id="${t.trace_id}" style="padding:4px 10px;font-size:11px;">Delete</button></td>
    </tr>`;
}

function bindTraceRowEvents(container) {
  container.querySelectorAll('.trace-name').forEach(el => {
    el.addEventListener('click', () => renderTraceDetail(el.dataset.id));
  });
  container.querySelectorAll('.btn-del').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm('Delete this trace?')) {
        await deleteTrace(el.dataset.id);
        renderTraceList();
      }
    });
  });
}

function renderLoading() {
  app.innerHTML = '<div class="loading"><div class="spinner"></div>Loading...</div>';
}

async function renderTraceList() {
  renderLoading();
  const data = await fetchTraces();

  if (!data.traces || data.traces.length === 0) {
    app.innerHTML = `
      <div class="empty-state">
        <h3>No traces yet</h3>
        <p>Upload a trace file or load sample data to get started.</p>
      </div>`;
    return;
  }

  app.innerHTML = `
    <div class="view-header">
      <h2>Traces (${data.total})</h2>
    </div>
    <div class="search-bar">
      <input class="search-input" id="search-input" placeholder="Search traces..." type="text">
    </div>
    <table class="trace-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Status</th>
          <th>Duration</th>
          <th>Spans</th>
          <th>Tokens</th>
          <th>Time</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${data.traces.map(renderTraceRow).join('')}
      </tbody>
    </table>`;

  bindTraceRowEvents(app);

  // Event: search
  let debounce;
  document.getElementById('search-input').addEventListener('input', (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(async () => {
      const result = await fetchTraces(e.target.value);
      const tbody = app.querySelector('tbody');
      if (!tbody) return;
      tbody.innerHTML = result.traces.map(renderTraceRow).join('');
      bindTraceRowEvents(tbody);
    }, 250);
  });
}

// ─── Trace Detail View ──────────────────────────────────────────────────────

async function renderTraceDetail(traceId) {
  renderLoading();
  const trace = await fetchTrace(traceId);

  const duration = trace.start_time && trace.end_time
    ? (new Date(trace.end_time) - new Date(trace.start_time))
    : null;

  // Build span tree
  const spanMap = {};
  const rootSpans = [];
  trace.spans.forEach(s => { spanMap[s.span_id] = { ...s, children: [] }; });
  trace.spans.forEach(s => {
    if (s.parent_span_id && spanMap[s.parent_span_id]) {
      spanMap[s.parent_span_id].children.push(spanMap[s.span_id]);
    } else {
      rootSpans.push(spanMap[s.span_id]);
    }
  });

  // Flatten tree in DFS order with depth
  const flatSpans = [];
  function flatten(node, depth) {
    flatSpans.push({ ...node, depth });
    node.children.forEach(c => flatten(c, depth + 1));
  }
  rootSpans.forEach(r => flatten(r, 0));

  // Calculate timeline bounds
  const traceStart = new Date(trace.start_time).getTime();
  const traceEnd = trace.end_time ? new Date(trace.end_time).getTime() : traceStart + 1000;
  const totalMs = traceEnd - traceStart;

  // Generate ruler marks (5 marks)
  const rulerMarks = [];
  for (let i = 0; i <= 4; i++) {
    rulerMarks.push({
      pct: i * 25,
      label: formatDuration((totalMs / 4) * i),
    });
  }

  app.innerHTML = `
    <div style="margin-bottom:16px;">
      <a href="#" id="back-link" style="font-size:13px;">&#8592; Back to traces</a>
    </div>
    <div class="trace-detail-header">
      <h2>${statusBadge(trace.status)} ${escapeHtml(trace.name)}</h2>
      <div class="trace-meta">
        <div class="trace-meta-item">
          <span class="label">Trace ID</span>
          <span class="value">${trace.trace_id}</span>
        </div>
        <div class="trace-meta-item">
          <span class="label">Duration</span>
          <span class="value">${formatDuration(duration)}</span>
        </div>
        <div class="trace-meta-item">
          <span class="label">Spans</span>
          <span class="value">${trace.spans.length}</span>
        </div>
        <div class="trace-meta-item">
          <span class="label">Total Tokens</span>
          <span class="value">${trace.total_tokens.toLocaleString()}</span>
        </div>
        <div class="trace-meta-item">
          <span class="label">Cost</span>
          <span class="value">$${trace.total_cost.toFixed(4)}</span>
        </div>
        <div class="trace-meta-item">
          <span class="label">Start Time</span>
          <span class="value">${formatTime(trace.start_time)}</span>
        </div>
      </div>
    </div>

    <!-- Timeline -->
    <div class="timeline-container">
      <div class="timeline-header">Execution Timeline</div>
      <div class="timeline-ruler">
        ${rulerMarks.map(m => `<span style="left:calc(220px + (100% - 232px) * ${m.pct} / 100)">${m.label}</span>`).join('')}
      </div>
      <div class="timeline-rows">
        ${flatSpans.map((s) => {
          const sStart = s.start_time ? new Date(s.start_time).getTime() : traceStart;
          const sEnd = s.end_time ? new Date(s.end_time).getTime() : sStart + 100;
          const left = ((sStart - traceStart) / totalMs) * 100;
          const width = Math.max(((sEnd - sStart) / totalMs) * 100, 0.3);
          const barClass = s.status === 'ERROR' ? 'bar-error' : `bar-${s.span_kind.toLowerCase()}`;
          const indent = s.depth * 16;
          return `
            <div class="timeline-row" data-span-id="${s.span_id}">
              <div class="span-label">
                <span class="indent" style="width:${indent}px"></span>
                ${kindBadge(s.span_kind)}
                <span class="name" title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</span>
              </div>
              <div class="bar-area">
                <div class="bar ${barClass}" style="left:${left}%;width:${width}%"></div>
                <span class="bar-duration">${formatDuration(s.duration_ms)}</span>
              </div>
            </div>`;
        }).join('')}
      </div>
    </div>

    <!-- Span Detail Panel -->
    <div class="span-detail" id="span-detail">
      <div style="padding:40px;text-align:center;color:var(--text-muted);">
        Click a span in the timeline to view details
      </div>
    </div>
  `;

  // Back button
  document.getElementById('back-link').addEventListener('click', (e) => {
    e.preventDefault();
    renderTraceList();
  });

  // Span click handlers
  const spanById = Object.fromEntries(flatSpans.map(s => [s.span_id, s]));
  app.querySelectorAll('.timeline-row').forEach(row => {
    row.addEventListener('click', () => {
      app.querySelectorAll('.timeline-row').forEach(r => r.classList.remove('selected'));
      row.classList.add('selected');
      renderSpanDetail(spanById[row.dataset.spanId]);
    });
  });

  // Auto-select first span
  if (flatSpans.length > 0) {
    app.querySelector('.timeline-row').click();
  }
}

// ─── Span Detail Panel ─────────────────────────────────────────────────────

function renderSpanDetail(span) {
  const panel = document.getElementById('span-detail');
  const attrs = span.attributes || {};
  const events = span.events || [];

  // Determine tabs
  const tabs = ['Overview'];
  if (span.span_kind === 'LLM') tabs.push('Prompts', 'Completion');
  if (span.span_kind === 'TOOL') tabs.push('Input', 'Output');
  if (events.length > 0) tabs.push('Events');
  tabs.push('Attributes');

  panel.innerHTML = `
    <div class="span-detail-header">
      ${kindBadge(span.span_kind)}
      <h3>${escapeHtml(span.name)}</h3>
      ${statusBadge(span.status)}
    </div>
    <div class="span-tabs">
      ${tabs.map((t, i) => `<div class="span-tab ${i === 0 ? 'active' : ''}" data-tab="${t}">${t}</div>`).join('')}
    </div>
    <div class="span-tab-content" id="tab-content"></div>
  `;

  function showTab(tabName) {
    const content = document.getElementById('tab-content');
    panel.querySelectorAll('.span-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));

    switch (tabName) {
      case 'Overview':
        content.innerHTML = renderOverviewTab(span);
        break;
      case 'Prompts':
        content.innerHTML = renderPromptsTab(attrs);
        break;
      case 'Completion':
        content.innerHTML = renderCompletionTab(attrs);
        break;
      case 'Input':
        content.innerHTML = renderToolInputTab(attrs);
        break;
      case 'Output':
        content.innerHTML = renderToolOutputTab(attrs);
        break;
      case 'Events':
        content.innerHTML = renderEventsTab(events);
        break;
      case 'Attributes':
        content.innerHTML = renderAttributesTab(attrs);
        break;
    }
  }

  panel.querySelectorAll('.span-tab').forEach(tab => {
    tab.addEventListener('click', () => showTab(tab.dataset.tab));
  });

  showTab('Overview');
}

function renderOverviewTab(span) {
  const attrs = span.attributes || {};
  const rows = [
    ['Span ID', span.span_id],
    ['Kind', span.span_kind],
    ['Status', span.status + (span.status_message ? ` - ${span.status_message}` : '')],
    ['Start Time', formatTime(span.start_time)],
    ['End Time', formatTime(span.end_time)],
    ['Duration', formatDuration(span.duration_ms)],
  ];

  // Add kind-specific info
  if (span.span_kind === 'LLM') {
    if (attrs['llm.model']) rows.push(['Model', attrs['llm.model']]);
    if (attrs['llm.vendor']) rows.push(['Vendor', attrs['llm.vendor']]);
    if (attrs['llm.temperature'] != null) rows.push(['Temperature', attrs['llm.temperature']]);
    if (attrs['llm.usage.prompt_tokens'] != null) rows.push(['Prompt Tokens', attrs['llm.usage.prompt_tokens']]);
    if (attrs['llm.usage.completion_tokens'] != null) rows.push(['Completion Tokens', attrs['llm.usage.completion_tokens']]);
    if (attrs['llm.usage.total_tokens'] != null) rows.push(['Total Tokens', attrs['llm.usage.total_tokens']]);
  }
  if (span.span_kind === 'TOOL') {
    if (attrs['tool.name']) rows.push(['Tool Name', attrs['tool.name']]);
    if (attrs['tool.error']) rows.push(['Error', attrs['tool.error']]);
  }
  if (span.span_kind === 'RETRIEVER') {
    if (attrs['retriever.type']) rows.push(['Retriever Type', attrs['retriever.type']]);
    if (attrs['retriever.top_k'] != null) rows.push(['Top K', attrs['retriever.top_k']]);
    if (attrs['retriever.results_count'] != null) rows.push(['Results', attrs['retriever.results_count']]);
  }

  return `
    <table class="kv-table">
      ${rows.map(([k, v]) => `
        <tr>
          <td class="kv-key">${escapeHtml(k)}</td>
          <td class="kv-value">${escapeHtml(String(v))}</td>
        </tr>
      `).join('')}
    </table>
    ${span.status === 'ERROR' && span.status_message ? `
      <div style="margin-top:16px;padding:12px;background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.3);border-radius:6px;color:var(--red);font-size:13px;">
        <strong>Error:</strong> ${escapeHtml(span.status_message)}
      </div>
    ` : ''}
  `;
}

function renderMessagesTab(attrs, attrKey, defaultRole) {
  const messages = attrs[attrKey] || [];
  if (messages.length === 0) return '<p style="color:var(--text-muted)">No data available</p>';
  return messages.map(msg => `
    <div class="message-block">
      <div class="message-role message-role-${msg.role || defaultRole}">${escapeHtml(msg.role || 'unknown')}</div>
      <div class="message-content">${escapeHtml(msg.content || '')}</div>
    </div>`).join('');
}

function renderPromptsTab(attrs) {
  return renderMessagesTab(attrs, 'llm.prompts', 'user');
}

function renderCompletionTab(attrs) {
  return renderMessagesTab(attrs, 'llm.completions', 'assistant');
}

function renderToolInputTab(attrs) {
  const input = attrs['tool.input'];
  if (!input) return '<p style="color:var(--text-muted)">No input data</p>';
  return `<div class="code-block">${escapeHtml(JSON.stringify(input, null, 2))}</div>`;
}

function renderToolOutputTab(attrs) {
  const output = attrs['tool.output'];
  const error = attrs['tool.error'];
  let html = '';
  if (error) {
    html += `<div style="margin-bottom:12px;padding:12px;background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.3);border-radius:6px;color:var(--red);font-size:13px;">${escapeHtml(error)}</div>`;
  }
  if (output) {
    html += `<div class="code-block">${escapeHtml(JSON.stringify(output, null, 2))}</div>`;
  }
  if (!output && !error) {
    html = '<p style="color:var(--text-muted)">No output data</p>';
  }
  return html;
}

function renderEventsTab(events) {
  return events.map(e => `
    <div class="event-item">
      <div class="event-header">
        <span class="event-name">${escapeHtml(e.name)}</span>
        <span class="event-time">${formatTime(e.timestamp)}</span>
      </div>
      ${Object.keys(e.attributes || {}).length > 0
        ? `<div class="code-block" style="margin-top:6px;font-size:11px;">${escapeHtml(JSON.stringify(e.attributes, null, 2))}</div>`
        : ''}
    </div>
  `).join('');
}

function renderAttributesTab(attrs) {
  const keys = Object.keys(attrs);
  if (keys.length === 0) return '<p style="color:var(--text-muted)">No attributes</p>';
  return `<div class="code-block">${escapeHtml(JSON.stringify(attrs, null, 2))}</div>`;
}

// ─── Event Handlers ─────────────────────────────────────────────────────────

// Nav home
document.getElementById('nav-home').addEventListener('click', () => renderTraceList());

// Upload modal
const uploadModal = document.getElementById('upload-modal');
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');

document.getElementById('btn-upload').addEventListener('click', () => {
  uploadModal.style.display = 'flex';
});
document.getElementById('btn-close-modal').addEventListener('click', () => {
  uploadModal.style.display = 'none';
});
uploadModal.addEventListener('click', (e) => {
  if (e.target === uploadModal) uploadModal.style.display = 'none';
});

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  if (e.dataTransfer.files.length) uploadFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files.length) uploadFile(fileInput.files[0]);
});

async function uploadFile(file) {
  const status = document.getElementById('upload-status');
  status.innerHTML = '<div class="loading"><div class="spinner"></div>Uploading...</div>';
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch(`${API}/upload`, { method: 'POST', body: formData });
    const data = await res.json();
    status.innerHTML = `<p style="color:var(--green);">Uploaded ${data.total} trace(s) successfully.</p>`;
    setTimeout(() => {
      uploadModal.style.display = 'none';
      status.innerHTML = '';
      renderTraceList();
    }, 1000);
  } catch (err) {
    status.innerHTML = `<p style="color:var(--red);">Upload failed: ${err.message}</p>`;
  }
}

// Load sample data
document.getElementById('btn-load-sample').addEventListener('click', async () => {
  const btn = document.getElementById('btn-load-sample');
  btn.textContent = 'Loading...';
  btn.disabled = true;
  try {
    await loadSampleData();
    renderTraceList();
  } catch (err) {
    alert('Failed to load sample data: ' + err.message);
  }
  btn.textContent = 'Load Sample';
  btn.disabled = false;
});

// ─── Init ───────────────────────────────────────────────────────────────────
renderTraceList();
