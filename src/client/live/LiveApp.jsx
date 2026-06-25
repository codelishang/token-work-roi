import { useEffect, useMemo, useState } from 'react';
import { U } from '../shared/utils.js';
import './styles.css';

const REFRESH_MS = 7000;
const PULSE_WINDOW_MINUTES = 1440;

export function LiveApp() {
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(null);
  const [, setExchangeRateVersion] = useState(0);
  const isDesktopPulse = new URLSearchParams(window.location.search).get('surface') === 'desktop';

  useEffect(() => {
    document.body.classList.add('pulse-live-body');
    document.body.classList.toggle('desktop-pulse-body', isDesktopPulse);
    return () => {
      document.body.classList.remove('pulse-live-body');
      document.body.classList.remove('desktop-pulse-body');
    };
  }, [isDesktopPulse]);

  useEffect(() => {
    let alive = true;
    U.loadExchangeRate().then(() => {
      if (alive) setExchangeRateVersion(version => version + 1);
    });
    async function load() {
      try {
        const data = await fetchLiveSnapshot(PULSE_WINDOW_MINUTES);
        if (alive) {
          setSnapshot(data);
          setError(null);
        }
      } catch (err) {
        if (alive) setError(err.message);
      }
    }
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const totals = snapshot?.totals || {};
  const pulse = snapshot?.pulse || {};
  const agent = pulse.agent || {};
  const collectionRunning = snapshot?.collectionState?.status === 'running';
  const freshness = error ? 'error' : snapshot?.dataFreshness || 'loading';
  const canManualRefresh = Boolean(snapshot && !snapshot.demoMode && !collectionRunning && !refreshing);
  const generated = useMemo(() => formatChinaStandardTime(snapshot?.generatedAt), [snapshot?.generatedAt]);
  const statuslineCommand = `npx token-work statusline --format=text --window-minutes=${PULSE_WINDOW_MINUTES}`;
  const modelRows = (snapshot?.byModel || []).slice(0, 5);
  const sourceRows = (snapshot?.bySource || []).slice(0, 5);
  const warnings = snapshot?.warnings || [];
  const timeline = pulse.timeline || [];

  async function copyStatuslineCommand() {
    try {
      await navigator.clipboard?.writeText(statuslineCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  async function triggerCollect() {
    if (!canManualRefresh) return;
    setRefreshing(true);
    setRefreshError(null);
    try {
      const response = await fetch('/api/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'live-refresh' })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      setSnapshot(current => current ? {
        ...current,
        collectionState: payload,
        dataFreshness: 'collecting',
        staleReason: '正在刷新本地 Claude/Codex 结构化 token 日志。'
      } : current);
      window.setTimeout(async () => {
        try {
          setSnapshot(await fetchLiveSnapshot(PULSE_WINDOW_MINUTES));
          setError(null);
        } catch (err) {
          setError(err.message);
        }
      }, 1800);
    } catch (err) {
      setRefreshError(err.message);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <main className={`live-shell ${isDesktopPulse ? 'desktop-pulse' : 'browser-live'}`}>
      <nav className="pulse-nav">
        <div className="pulse-brand">
          <img className="pulse-logo" src="/token-work-icon.svg" alt="" aria-hidden="true" />
          <strong>元衡 Token Work Pulse</strong>
          <span className={`pulse-badge status-${freshness}`}>{freshnessLabel(freshness)}</span>
        </div>
        <div className="pulse-actions">
          <span className="pulse-time">{generated}</span>
          <button type="button" onClick={copyStatuslineCommand}>{copied ? '已复制' : '复制 statusline'}</button>
          <button type="button" onClick={triggerCollect} disabled={!canManualRefresh}>
            {collectionRunning || refreshing ? '刷新中' : '刷新'}
          </button>
          <a href="/review">打开复盘</a>
        </div>
      </nav>

      {(error || refreshError) && (
        <section className="pulse-error">
          {error && <strong>实时数据加载失败：{error}</strong>}
          {refreshError && <strong>刷新失败：{refreshError}</strong>}
          <span>这通常表示 UI 代理没有连上本地 API。请重新运行 Token Work，或在 /trust 查看服务状态。</span>
        </section>
      )}

      <section className="pulse-kpi-grid" aria-label="近24小时核心指标">
        <KpiCard accent="cyan" label="近24小时 Token" value={formatCompactTokens(totals.totalTokens)} detail={`${formatNumber(totals.totalTokens)} tokens`} trend={timeline.map(row => row.totalTokens)} />
        <KpiCard accent="green" label="近24小时官方价" value={formatMoney(totals.costUSD)} detail="官方价格换算，不是账单" trend={timeline.map(row => row.costUSD)} />
        <KpiCard accent="blue" label="Token 事件数" value={formatNumber(totals.requestCount)} detail="本地 token event 记录" trend={timeline.map(row => row.requests)} />
        <KpiCard accent="purple" label="输入" value={formatCompactTokens(totals.inputTokens)} detail={`${formatNumber(totals.inputTokens)} tokens`} trend={timeline.map(row => row.inputTokens)} />
        <KpiCard accent="blue" label="输出" value={formatCompactTokens(totals.outputTokens)} detail={`${formatNumber(totals.outputTokens)} tokens`} trend={timeline.map(row => row.outputTokens)} />
        <KpiCard accent="green" label="缓存复用" value={`${formatPercent(totals.cacheHitRate)}%`} detail={`${formatCompactTokens(totals.cacheReadTokens)} cache read`} trend={timeline.map(row => row.cacheReadTokens)} />
      </section>

      <section className="pulse-main-grid">
        <Panel className="pulse-chart-panel" title="24 小时 token burn rate" action="近24小时">
          <TrendLegend totals={totals} />
          <TrendChart data={pulse.timeline || []} />
        </Panel>

        <Panel className="pulse-agent-panel" title="Agent 活跃时长">
          <AgentRing activeHours={agent.activeHours || 0} windowHours={pulse.windowHours || 24} percent={agent.utilizationPercent || 0} />
        </Panel>
      </section>

      <section className="pulse-bottom-grid">
        <Panel title="模型消耗 Top 5" className="pulse-model-panel">
          <ModelRows rows={modelRows} totalTokens={totals.totalTokens} />
        </Panel>

        <Panel title="来源分布" className="pulse-source-panel">
          <SourceDonut rows={sourceRows} totalTokens={totals.totalTokens} />
        </Panel>

        <Panel title="当前建议" className="pulse-advice-panel">
          <AdviceList warnings={warnings} />
        </Panel>
      </section>

      <footer className="pulse-footer">
        <span>数据源：本地 SQLite</span>
        <span>窗口：近 24 小时</span>
        <span>最新 token 事件：{formatChinaStandardTime(snapshot?.latestEventAt)}</span>
        <span>数据仅保存在本地，不读取正文</span>
      </footer>
    </main>
  );
}

async function fetchLiveSnapshot(windowMinutes) {
  const response = await fetch(`/api/live?windowMinutes=${encodeURIComponent(windowMinutes)}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function FreshnessNotice({ snapshot }) {
  const freshness = snapshot.dataFreshness || 'empty';
  return (
    <section className={`pulse-freshness status-${freshness}`} aria-label="实时数据新鲜度">
      <strong>{freshnessTitle(freshness)}</strong>
      <span>{freshnessMessage(snapshot)}</span>
      <small>上次刷新：{formatChinaStandardTime(snapshot.latestCollectionRunAt)} · 最新 token 事件：{formatChinaStandardTime(snapshot.latestEventAt)}</small>
    </section>
  );
}

function KpiCard({ accent, label, value, detail, trend = [] }) {
  return (
    <article className={`pulse-kpi accent-${accent}`}>
      <span className="kpi-icon" aria-hidden="true"/>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
      <MiniSparkline values={trend} />
    </article>
  );
}

function Panel({ title, action, className = '', children }) {
  return (
    <section className={`pulse-panel ${className}`}>
      <header>
        <h2>{title}</h2>
        {action && <span>{action}</span>}
      </header>
      {children}
    </section>
  );
}

function TrendLegend({ totals }) {
  return (
    <div className="trend-legend">
      <div><i className="dot-cyan"/>总消耗 tokens <strong>{formatCompactTokens(totals.totalTokens)}</strong></div>
      <div><i className="dot-green"/>官方价成本 <strong>{formatMoney(totals.costUSD)}</strong></div>
    </div>
  );
}

function TrendChart({ data }) {
  const chart = buildTrendChart(data);
  if (!chart.points.length) return <EmptyState text="近 24 小时暂无 event 级 token 数据。" />;
  return (
    <svg className="trend-chart" viewBox={`0 0 ${chart.width} ${chart.height}`} preserveAspectRatio="none" role="img" aria-label="24小时 token 和官方价趋势">
      <defs>
        <linearGradient id="tokenArea" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.36"/>
          <stop offset="100%" stopColor="currentColor" stopOpacity="0"/>
        </linearGradient>
      </defs>
      {chart.yTicks.map(tick => <line key={`h-${tick.y}`} x1={chart.left} x2={chart.plotRight} y1={tick.y} y2={tick.y} className="chart-grid"/>)}
      {chart.yTicks.map(tick => (
        <g key={`tick-${tick.y}`}>
          <text x={chart.left - 8} y={tick.y + 4} className="chart-axis" textAnchor="end">{tick.tokens}</text>
          <text x={chart.plotRight + 12} y={tick.y + 4} className="chart-axis chart-axis-right" textAnchor="start">{tick.cost}</text>
        </g>
      ))}
      {chart.labels.map(label => (
        <text key={label.x} x={label.x} y={chart.height - 16} className="chart-label">{label.text}</text>
      ))}
      <path d={chart.tokenAreaPath} className="chart-token-area"/>
      <polyline points={chart.tokenPolyline} className="chart-token-line"/>
      <polyline points={chart.costPolyline} className="chart-cost-line"/>
    </svg>
  );
}

function MiniSparkline({ values }) {
  const points = sparklinePoints(values);
  if (!points) return <span className="kpi-sparkline empty" aria-hidden="true"/>;
  return (
    <svg className="kpi-sparkline" viewBox="0 0 92 32" aria-hidden="true">
      <polyline points={points} />
    </svg>
  );
}

function AgentRing({ activeHours, windowHours, percent }) {
  const safePercent = Math.max(0, Math.min(100, Number(percent || 0)));
  const radius = 88;
  const circumference = 2 * Math.PI * radius;
  const progress = (safePercent / 100) * circumference;
  return (
    <div className="agent-ring-wrap">
      <div className="agent-ring">
        <svg viewBox="0 0 220 220" aria-hidden="true">
          <circle className="agent-ring-track" cx="110" cy="110" r={radius}/>
          <circle
            className="agent-ring-progress"
            cx="110"
            cy="110"
            r={radius}
            strokeDasharray={`${progress.toFixed(2)} ${(circumference - progress).toFixed(2)}`}
          />
        </svg>
        <div className="agent-ring-center">
          <strong>{activeHours.toFixed(activeHours >= 10 ? 0 : 1)}h</strong>
          <span>/ {Math.round(windowHours || 24)}h</span>
        </div>
      </div>
      <b>{Math.round(safePercent)}%</b>
      <span>按 token event 时间桶计算</span>
    </div>
  );
}

function ModelRows({ rows, totalTokens }) {
  if (!rows.length) return <EmptyState text="暂无模型消耗。" />;
  return (
    <div className="model-list">
      {rows.map((row, index) => {
        const share = totalTokens ? Math.max(2, (row.totalTokens / totalTokens) * 100) : 0;
        return (
          <div className="model-row" key={row.key}>
            <span className="model-rank">{index + 1}</span>
            <div>
              <strong>{row.key}</strong>
              <i><span style={{ width: `${Math.min(100, share)}%` }}/></i>
            </div>
            <b>{formatCompactTokens(row.totalTokens)}</b>
            <small>{formatMoney(row.costUSD)}</small>
          </div>
        );
      })}
    </div>
  );
}

function SourceDonut({ rows, totalTokens }) {
  if (!rows.length) return <EmptyState text="暂无来源分布。" />;
  return (
    <div className="source-donut-layout">
      <div className="source-donut" style={{ background: sourceDonutGradient(rows, totalTokens) }}/>
      <div className="source-list">
        {rows.map((row, index) => (
          <div key={row.key}>
            <i style={{ background: sourceColor(index) }}/>
            <span>{row.key}</span>
            <strong>{totalTokens ? `${((row.totalTokens / totalTokens) * 100).toFixed(1)}%` : '0.0%'}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdviceList({ warnings }) {
  if (!warnings.length) return <EmptyState text="当前没有触发 guardrail。继续观察 burn rate、缓存复用和未定价模型。" />;
  return (
    <div className="advice-list">
      {warnings.slice(0, 3).map(warning => (
        <article key={warning.type} className={`advice-card level-${warning.level || 'medium'}`}>
          <strong>{warning.message}</strong>
          <span>{warning.evidence}</span>
          <b>{warning.action}</b>
        </article>
      ))}
    </div>
  );
}

function EmptyState({ text }) {
  return <div className="pulse-empty">{text}</div>;
}

function buildTrendChart(data) {
  const rows = (data || []).filter(Boolean);
  if (!rows.length || !rows.some(row => Number(row.totalTokens || 0) > 0 || Number(row.costUSD || 0) > 0 || Number(row.requests || 0) > 0)) {
    return { points: [] };
  }
  const width = 1200;
  const height = 260;
  const left = 72;
  const right = 132;
  const top = 30;
  const bottom = 38;
  const innerWidth = width - left - right;
  const innerHeight = height - top - bottom;
  const maxTokens = Math.max(1, ...rows.map(row => Number(row.totalTokens || 0)));
  const maxCost = Math.max(1, ...rows.map(row => Number(row.costUSD || 0)));
  const pointFor = (row, index, value, max) => {
    const x = left + (rows.length === 1 ? innerWidth : (index / (rows.length - 1)) * innerWidth);
    const y = top + innerHeight - (Number(value || 0) / max) * innerHeight;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };
  const tokenPoints = rows.map((row, index) => pointFor(row, index, row.totalTokens, maxTokens));
  const costPoints = rows.map((row, index) => pointFor(row, index, row.costUSD, maxCost));
  const firstX = tokenPoints[0].split(',')[0];
  const lastX = tokenPoints[tokenPoints.length - 1].split(',')[0];
  const tokenAreaPath = `M ${firstX} ${top + innerHeight} L ${tokenPoints.join(' L ')} L ${lastX} ${top + innerHeight} Z`;
  const labelIndexes = [0, Math.floor((rows.length - 1) / 4), Math.floor((rows.length - 1) / 2), Math.floor((rows.length - 1) * 3 / 4), rows.length - 1];
  const labels = [...new Set(labelIndexes)].map(index => ({
    x: left + (rows.length === 1 ? innerWidth : (index / (rows.length - 1)) * innerWidth),
    text: rows[index]?.label || ''
  }));
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(ratio => ({
    y: top + innerHeight - ratio * innerHeight,
    tokens: formatCompactTokens(maxTokens * ratio),
    cost: formatAxisMoney(maxCost * ratio)
  }));
  return {
    width,
    height,
    left,
    plotRight: width - right,
    points: tokenPoints,
    tokenPolyline: tokenPoints.join(' '),
    costPolyline: costPoints.join(' '),
    tokenAreaPath,
    labels,
    yTicks
  };
}

function sparklinePoints(values = []) {
  const rows = values.map(value => Number(value || 0));
  if (!rows.some(value => value > 0)) return '';
  const max = Math.max(...rows, 1);
  return rows.map((value, index) => {
    const x = rows.length === 1 ? 46 : (index / (rows.length - 1)) * 92;
    const y = 30 - (value / max) * 28;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function sourceDonutGradient(rows, totalTokens) {
  let cursor = 0;
  const stops = rows.map((row, index) => {
    const share = totalTokens ? (row.totalTokens / totalTokens) * 100 : 0;
    const start = cursor;
    cursor += share;
    return `${sourceColor(index)} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
  });
  if (cursor < 100) stops.push(`rgba(145,168,186,.18) ${cursor.toFixed(2)}% 100%`);
  return `conic-gradient(${stops.join(', ')})`;
}

function sourceColor(index) {
  return ['#35f4ff', '#6dff9c', '#a86bff', '#ffb84d', '#ff4d6d'][index % 5];
}

function freshnessLabel(value) {
  if (value === 'fresh') return '在线';
  if (value === 'collecting') return '刷新中';
  if (value === 'stale') return '可能过期';
  if (value === 'error') return '异常';
  if (value === 'empty') return '空数据';
  return '加载中';
}

function freshnessTitle(value) {
  if (value === 'fresh') return 'FRESH';
  if (value === 'collecting') return 'REFRESHING';
  if (value === 'stale') return 'STALE';
  if (value === 'error') return 'ERROR';
  if (value === 'empty') return 'EMPTY';
  return 'LOADING';
}

function freshnessMessage(snapshot) {
  if (snapshot.dataFreshness === 'collecting') return '正在把本地 Claude/Codex 结构化 token 元数据刷新进 SQLite。';
  if (snapshot.dataFreshness === 'stale') return snapshot.staleReason || '最近窗口没有事件，且后台刷新可能过期。';
  if (snapshot.dataFreshness === 'error') return snapshot.staleReason || '最近一次刷新失败，请打开 /trust 查看采集状态。';
  if (snapshot.dataFreshness === 'empty') return snapshot.staleReason || '当前 SQLite 没有 event 级 token 数据。';
  if (Number(snapshot?.totals?.totalTokens || 0) === 0) return snapshot.staleReason || '最近 24 小时没有新 token；历史 token 仍可在看板和复盘页查看。';
  return '最近 24 小时已有 event 级 token，可用于 burn rate、模型消耗和预算窗口判断。';
}

function formatNumber(value) {
  return Math.round(Number(value || 0)).toLocaleString('en-US');
}

function formatMoney(value) {
  return U.money(value);
}

function formatAxisMoney(value) {
  return U.compactMoney(value);
}

function formatPercent(value) {
  return Number(value || 0).toFixed(1);
}

function formatCompactTokens(value) {
  const number = Number(value || 0);
  if (number >= 100_000_000) return `${(number / 100_000_000).toFixed(number >= 1_000_000_000 ? 2 : 1)}亿`;
  if (number >= 10_000) return `${(number / 10_000).toFixed(number >= 1_000_000 ? 1 : 0)}万`;
  return formatNumber(number);
}

function formatChinaStandardTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date);
  const get = type => parts.find(part => part.type === type)?.value || '00';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')} UTC+8`;
}
