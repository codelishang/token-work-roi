/* =============================================================
   Review-page sections — Tools, Efficiency, Insights
   ============================================================= */

import { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { U } from '../shared/utils.js';
import { RU } from './utils.js';
import { buildEfficiencyGuidance } from './efficiency-guidance.js';

function ReviewTrustBanner({ state }) {
  if (!state) return null;
  return (
    <section className={`story trust-banner trust-${state.tone}`}>
      <div className="section-label">数据来源</div>
      <h2 className="section-title">这是真实数据吗？</h2>
      <p className="section-sub">{state.summary}</p>
      <div className="trust-banner-grid">
        <div>
          <span>状态</span>
          <strong>{state.title}</strong>
          <p>{state.action}</p>
        </div>
        {(state.facts || []).map(fact => (
          <div key={fact.label}>
            <span>{fact.label}</span>
            <strong>{fact.value}</strong>
          </div>
        ))}
      </div>
      {state.latestRun && (
        <div className="trust-run">
          最近采集：{state.latestRun.source || 'unknown'} · {state.latestRun.status || 'unknown'} · {state.latestRun.message || '无摘要'}
        </div>
      )}
    </section>
  );
}

// ───────────────────────────────────────────────────────────────
// Closure progress — real data acceptance gate
// ───────────────────────────────────────────────────────────────
function ClosureProgressSection({ progress, trustState, projectCoverage, lazyState, onLazyAttribution }) {
  if (!progress) return null;
  const pct = Math.round(progress.completionShare * 100);
  const recognizedShare = projectCoverage?.recognizedShare || 0;
  const evidenceShare = projectCoverage?.attributionCompletionShare || progress.completionShare || 0;

  return (
    <section className="story closure-section">
      <div className="section-label">01 · 闭环</div>
      <h2 className="section-title">当前数据能不能用于复盘</h2>
      <p className="section-sub">先分清三件事：token 是否采到、项目是否识别、ROI 证据是否足够。前两项可以自动完成，第三项需要自动草稿或人工确认。</p>

      <div className="closure-readable-grid">
        <ReadableGate
          label="Token 已采到"
          value={trustState?.trusted ? '可信' : '待确认'}
          note={trustState?.trusted ? '已有 event 级 token 记录和 coverage gate。' : trustState?.summary || '需要先确认数据来源。'}
          done={trustState?.trusted}
        />
        <ReadableGate
          label="项目已识别"
          value={`${Math.round(recognizedShare * 100)}%`}
          note={`${projectCoverage?.projectCount || 0} 个项目；未知项目 ${projectCoverage?.unknownProjectCount || 0} 个。`}
          done={recognizedShare >= 0.8}
        />
        <ReadableGate
          label="ROI 证据待补"
          value={`${Math.round(evidenceShare * 100)}%`}
          note="还需要任务、目的、阶段、价值、产出链接或人工确认。"
          done={evidenceShare >= 0.8}
        />
      </div>

      <div className={`closure-hero ${progress.status === 'complete' ? 'complete' : 'needs-work'}`}>
        <div>
          <span>验收进度</span>
          <strong>{pct}%</strong>
          <p>{progress.completedChecks} / {progress.totalChecks} 项已满足 · {progress.totals.sessionCount} 个 session · {U.compactCN(progress.totals.totalTokens)} tokens</p>
        </div>
        <div className="closure-meter" aria-hidden="true">
          <span style={{width: `${pct}%`}}/>
        </div>
      </div>

      <div className="closure-grid">
        {progress.checks.map(check => (
          <article key={check.id} className={`closure-card ${check.complete ? 'done' : 'todo'}`}>
            <div className="closure-card-head">
              <span>{check.complete ? '已满足' : '待完成'}</span>
              <b>{check.current} / {check.target}</b>
            </div>
            <h3>{check.label}</h3>
            <p>{check.detail}</p>
            {!check.complete && <strong>{check.action}</strong>}
          </article>
        ))}
      </div>

      {progress.topGaps.length > 0 && (
        <div className="closure-gaps">
          <div className="closure-gaps-head">
            <h3>优先补齐的真实 session</h3>
            <span>按官方价和 token 降序，只列结构化字段缺口</span>
          </div>
          <div className="closure-gap-list">
            {progress.topGaps.slice(0, 3).map((row, index) => (
              <div key={`${row.sessionId}:${index}`} className="closure-gap-row">
                <div className="closure-gap-rank">{String(index + 1).padStart(2, '0')}</div>
                <div>
                  <strong>{row.project}</strong>
                  <span>{row.sessionId || '未命名 session'} · 缺 {row.missingFields.join('、')}</span>
                </div>
                <div>
                  <b>{U.compactCN(row.totalTokens)}</b>
                  <span>{row.costUSD > 0 ? U.money(row.costUSD) : '未定价/无官方价'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {progress.nextActions.length > 0 && (
        <div className="closure-actions">
          <h3>下一步</h3>
          {progress.nextActions.slice(0, 3).map(action => (
            <p key={action}>{action}</p>
          ))}
          <LazyAttributionButton
            state={lazyState}
            onClick={onLazyAttribution}
          />
        </div>
      )}
    </section>
  );
}

function ReadableGate({ label, value, note, done }) {
  return (
    <article className={`readable-gate ${done ? 'done' : 'todo'}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{note}</p>
    </article>
  );
}

function EvidenceFlywheelSection({
  flywheel,
  autopilotState,
  onRunAutopilot,
  onApplyEvidenceSuggestion,
  onDismissEvidenceSuggestion
}) {
  if (!flywheel) return null;
  const steps = flywheel.steps || [];
  const queues = flywheel.queues || {};
  const qualityRows = flywheel.quality?.rows || [];
  return (
    <section className="story flywheel-section">
      <div className="section-label">02 · 证据飞轮</div>
      <h2 className="section-title">真实 token 怎么变成可复盘证据</h2>
      <p className="section-sub">先拿到可信 token，再识别项目、生成自动证据、确认产出，最后才有节省模拟和模型策略。这里不读取对话正文，也不把自动推断包装成人工事实。</p>

      <div className="flywheel-hero">
        <div>
          <span>Evidence Flywheel</span>
          <strong>{flywheel.score || 0}%</strong>
          <p>{flywheel.completedSteps || 0} / {flywheel.totalSteps || steps.length || 0} 步可用 · {flywheel.totals?.sessionCount || 0} 个 session · {U.compactCN(flywheel.totals?.totalTokens || 0)} tokens</p>
        </div>
        <div className="flywheel-meter" aria-hidden="true">
          <span style={{width: `${Math.max(0, Math.min(100, flywheel.score || 0))}%`}}/>
        </div>
      </div>

      {qualityRows.length > 0 && (
        <div className="flywheel-quality-grid">
          {qualityRows.map(row => (
            <article key={row.id} className={`flywheel-quality-card tone-${row.tone}`}>
              <span>{row.label}</span>
              <strong>{row.count}</strong>
              <p>{row.detail}</p>
            </article>
          ))}
        </div>
      )}

      <div className="flywheel-steps">
        {steps.map(step => (
          <article key={step.id} className={`flywheel-step ${step.complete ? 'done' : 'todo'}`}>
            <span>{step.complete ? '已具备' : '待补齐'}</span>
            <strong>{step.label}</strong>
            <p>{step.current} / {step.target}</p>
            {!step.complete && <b>{step.action}</b>}
            <div aria-hidden="true"><i style={{width: `${Math.round((step.share || 0) * 100)}%`}}/></div>
          </article>
        ))}
      </div>

      <div className="flywheel-next">
        <span>下一步动作</span>
        <strong>{flywheel.nextAction || '抽查最高成本自动证据。'}</strong>
      </div>

      <div className="flywheel-queues">
        <FlywheelQueue title="最值得补的证据" rows={queues.highCostGaps || []} />
        <FlywheelQueue title="待确认草稿" rows={queues.confirmationDrafts || []} />
        <FlywheelQueue title="产出链接候选" rows={queues.outputCandidates || []} />
        <FlywheelQueue title="模型策略样本缺口" rows={queues.strategyCandidates || []} />
        <FlywheelQueue title="不可写入原因" rows={queues.blockedEvidence || []} />
      </div>

      <EvidenceAutopilotPanel
        state={autopilotState}
        onRun={onRunAutopilot}
        onApply={onApplyEvidenceSuggestion}
        onDismiss={onDismissEvidenceSuggestion}
      />
    </section>
  );
}

function FlywheelQueue({ title, rows = [] }) {
  return (
    <article className="flywheel-queue">
      <div className="flywheel-queue-head">
        <strong>{title}</strong>
        <span>{rows.length} 条</span>
      </div>
      {rows.length ? rows.slice(0, 4).map((row, index) => (
        <div key={`${row.source || ''}:${row.sessionId || ''}:${index}`} className="flywheel-queue-row">
          <span>{String(index + 1).padStart(2, '0')}</span>
          <div>
            <strong>{row.project || '未识别项目'}</strong>
            <p>{row.model || row.source || 'unknown'} · {Array.isArray(row.missing) && row.missing.length ? `缺 ${row.missing.join('、')}` : row.reason || row.sessionId || '待确认'}</p>
            {row.confidence ? <small>{row.provenance || '建议'} · {Math.round(row.confidence)}%</small> : null}
          </div>
          <b>{row.costUSD > 0 ? U.money(row.costUSD) : U.compactCN(row.totalTokens || 0)}</b>
        </div>
      )) : (
        <p className="flywheel-queue-empty">暂无明显缺口；继续运行 Evidence Autopilot 或补产出链接。</p>
      )}
    </article>
  );
}

function RoiEvidenceSection({
  evidence,
  zeroState,
  lazyState,
  onLazyAttribution,
  autopilotState,
  onRunAutopilot,
  onApplyEvidenceSuggestion,
  onDismissEvidenceSuggestion
}) {
  if (!evidence) return null;
  const showZeroState = zeroState?.isZero;
  return (
    <section className="story evidence-section">
      <div className="section-label">03 · ROI 证据</div>
      <h2 className="section-title">这些 Token 是否足够支撑 ROI 判断</h2>
      <p className="section-sub">Token Work ROI 不只统计消耗，还检查项目、任务、目的、阶段、价值、产出和人工确认是否完整。</p>

      {showZeroState ? (
        <div className="evidence-zero-state">
          <div>
            <span>证据缺口</span>
            <strong>{zeroState.title}</strong>
            <p>{zeroState.summary}</p>
          </div>
          <ul>
            {zeroState.missing.map(item => <li key={item}>{item}</li>)}
          </ul>
          <div>
            <EvidenceAutopilotPanel
              state={autopilotState}
              onRun={onRunAutopilot}
              onApply={onApplyEvidenceSuggestion}
              onDismiss={onDismissEvidenceSuggestion}
            />
            <LazyAttributionButton state={lazyState} onClick={onLazyAttribution}/>
          </div>
        </div>
      ) : (
        <div className="evidence-hero">
          <div>
            <span>ROI Evidence Score</span>
            <strong>{evidence.evidenceScore}</strong>
            <p>{evidence.complete} / {evidence.sessionCount} 个 session 证据完整 · {evidence.workItemCount} 个 work item</p>
          </div>
          <div className="evidence-meter" aria-hidden="true">
            <span style={{width: `${Math.max(0, Math.min(100, evidence.evidenceScore))}%`}}/>
          </div>
        </div>
      )}

      <div className="evidence-grid">
        <EvidenceStat label="人工确认" value={`${evidence.manualConfirmed}`} note={`${evidence.autoOrMissing} 个仍是自动或缺失`} />
        <EvidenceStat label="有产出链接" value={`${evidence.withOutput}`} note="只保存 URL、标签、类型" />
        <EvidenceStat label="未完成证据成本" value={evidence.incompleteCostUSD > 0 ? U.money(evidence.incompleteCostUSD) : '—'} note="官方价换算，不是账单" />
      </div>

      {evidence.highCostGaps.length > 0 && (
        <div className="evidence-gaps">
          {evidence.highCostGaps.slice(0, 3).map((row, index) => (
            <div key={`${row.sessionId}:${index}`} className="evidence-gap-row">
              <span>{String(index + 1).padStart(2, '0')}</span>
              <div>
                <strong>{row.project}</strong>
                <p>缺 {row.missing.join('、')} · {U.compactCN(row.totalTokens)} tokens</p>
              </div>
              <b>{row.costUSD > 0 ? U.money(row.costUSD) : '未定价'}</b>
            </div>
          ))}
        </div>
      )}
      {!showZeroState && (
        <EvidenceAutopilotPanel
          state={autopilotState}
          onRun={onRunAutopilot}
          onApply={onApplyEvidenceSuggestion}
          onDismiss={onDismissEvidenceSuggestion}
        />
      )}
    </section>
  );
}

function EvidenceStat({ label, value, note }) {
  return (
    <article className="evidence-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{note}</p>
    </article>
  );
}

// ───────────────────────────────────────────────────────────────
// Tools donut + per-tool list
// ───────────────────────────────────────────────────────────────
function ToolsSection({ daily, totalTokens }) {
  const tools = useMemo(() => {
    const list = RU.aggregateBy(daily, 'source').sort((a, b) => b.totalTokens - a.totalTokens);
    return list.map(t => ({
      ...t,
      topModel: RU.topModelFor(daily, r => r.source === t.key),
      share: (t.totalTokens / (totalTokens || 1)) * 100
    }));
  }, [daily, totalTokens]);

  const donutRef = useRef(null);
  const donutChart = useRef(null);

  useEffect(() => {
    if (!donutRef.current) return;
    if (!donutChart.current) {
      donutChart.current = echarts.init(donutRef.current, null, { renderer: 'canvas' });
    }
    donutChart.current.setOption({
      backgroundColor: 'transparent',
      animation: true,
      tooltip: {
        trigger: 'item',
        backgroundColor: 'oklch(0.16 0.010 60)',
        borderColor: 'transparent',
        textStyle: { color: 'oklch(0.91 0.018 145)', fontSize: 12 },
        extraCssText: 'border-radius: 8px; box-shadow: 0 8px 24px -8px rgb(0 0 0 / 0.3);',
        formatter: p => `<div style="font-weight:600">${p.name}</div>
          <div style="font-size:13px;margin-top:4px;font-feature-settings:'tnum'">${U.compactCN(p.value)} tokens · ${(p.percent || 0).toFixed(1)}%</div>`
      },
      series: [{
        type: 'pie',
        radius: ['60%', '92%'],
        center: ['50%', '50%'],
        avoidLabelOverlap: true,
        label: { show: false },
        labelLine: { show: false },
        itemStyle: { borderColor: 'oklch(0.91 0.018 145)', borderWidth: 4 },
        data: tools.map(t => ({
          name: t.key,
          value: t.totalTokens,
          itemStyle: { color: U.getSourceColor(t.key) }
        }))
      }]
    }, true);
    const onResize = () => donutChart.current?.resize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [tools]);

  if (!tools.length) return null;
  const top = tools[0];

  return (
    <section className="story">
      <div className="section-label">06 · 工具</div>
      <h2 className="section-title">你是怎么用这些工具的</h2>
      <p className="section-sub">每个工具背后挑选了不同模型、有不同的官方价结构。这是它们各自的份额与组合。</p>

      <div className="tools-split">
        <div style={{display: 'flex', justifyContent: 'center'}}>
          <div className="donut-wrap">
            <div ref={donutRef} style={{width: 280, height: 280}}/>
            <div className="donut-center">
              <div>
                <div className="l">主导工具</div>
                <div className="v">{top.share.toFixed(0)}%</div>
                <div className="s">{top.key}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="tool-list">
          {tools.map(t => (
            <div key={t.key} className="tool-card">
              <span className="tool-dot" style={{background: U.getSourceColor(t.key)}}/>
              <div className="tool-info">
                <h3 className="tool-name">{t.key}</h3>
                <div className="tool-model">
                  常用模型 · {t.topModel}
                </div>
              </div>
              <div className="tool-stats">
                <div>
                  <div className="tokens">{U.compactCN(t.totalTokens)}</div>
                  <div className="cost">{t.costUSD > 0 ? U.money(t.costUSD) : '—'}</div>
                </div>
                <span className="tool-badge" title="Cache hit rate">
                  <svg viewBox="0 0 12 12" fill="none">
                    <ellipse cx="6" cy="3.5" rx="4.5" ry="1.8" stroke="currentColor" strokeWidth="1.2"/>
                    <path d="M1.5 3.5v3c0 1 2 1.8 4.5 1.8s4.5-.8 4.5-1.8v-3" stroke="currentColor" strokeWidth="1.2"/>
                    <path d="M1.5 6.5v3c0 1 2 1.8 4.5 1.8s4.5-.8 4.5-1.8v-3" stroke="currentColor" strokeWidth="1.2"/>
                  </svg>
                  {t.cacheHitRate.toFixed(0)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ───────────────────────────────────────────────────────────────
// Efficiency analysis cards
// ───────────────────────────────────────────────────────────────
function EfficiencySection({ daily, period }) {
  const totals = useMemo(() => ({
    total: RU.sumField(daily, 'totalTokens'),
    input: RU.sumField(daily, 'inputTokens'),
    output: RU.sumField(daily, 'outputTokens'),
    cacheRead: RU.sumField(daily, 'cacheReadTokens'),
    reasoning: RU.sumField(daily, 'reasoningOutputTokens')
  }), [daily]);

  const cacheRate = totals.total ? (totals.cacheRead / totals.total) * 100 : 0;
  const ioRatio   = totals.output ? totals.input / totals.output : 0;
  const reasonPct = totals.total ? (totals.reasoning / totals.total) * 100 : 0;
  const guidance = useMemo(() => buildEfficiencyGuidance({
    cacheReuseRate: cacheRate,
    inputOutputRatio: ioRatio,
    reasoningShare: reasonPct,
    hasReasoningTokens: totals.reasoning > 0
  }), [cacheRate, ioRatio, reasonPct, totals.reasoning]);

  // sparklines for each metric over daily
  const daysArr = useMemo(() => RU.dailyTotals(daily, period), [daily, period]);

  const cacheSeries = useMemo(() => {
    const m = new Map();
    for (const r of daily) {
      const x = m.get(r.usageDate) || { tot: 0, cr: 0 };
      x.tot += r.totalTokens; x.cr += r.cacheReadTokens;
      m.set(r.usageDate, x);
    }
    return daysArr.map(d => {
      const x = m.get(d.date);
      return x && x.tot ? (x.cr / x.tot) * 100 : 0;
    });
  }, [daily, daysArr]);

  const ioSeries = useMemo(() => {
    const m = new Map();
    for (const r of daily) {
      const x = m.get(r.usageDate) || { i: 0, o: 0 };
      x.i += r.inputTokens; x.o += r.outputTokens;
      m.set(r.usageDate, x);
    }
    return daysArr.map(d => {
      const x = m.get(d.date);
      return x && x.o ? x.i / x.o : 0;
    });
  }, [daily, daysArr]);

  const reasonSeries = useMemo(() => {
    const m = new Map();
    for (const r of daily) {
      const x = m.get(r.usageDate) || { r: 0, t: 0 };
      x.r += r.reasoningOutputTokens; x.t += r.totalTokens;
      m.set(r.usageDate, x);
    }
    return daysArr.map(d => {
      const x = m.get(d.date);
      return x && x.t ? (x.r / x.t) * 100 : 0;
    });
  }, [daily, daysArr]);

  return (
    <section className="story">
      <div className="section-label">07 · 效率</div>
      <h2 className="section-title">你的 Token 用得高效吗</h2>
      <p className="section-sub">从三个角度看 token 的"性价比"——重复利用率、信息密度、推理强度。</p>

      <div className="eff-grid">
        <EffCard
          label="Cache 复用率"
          value={cacheRate.toFixed(1)}
          unit="%"
          note={`本期 ${U.compactCN(totals.cacheRead)} tokens 来自 cache read。这里是本地复盘口径，不是供应商精确 hit rate。`}
          guidance={guidance.cache}
          spark={cacheSeries}
          color="oklch(0.55 0.16 265)"/>
        <EffCard
          label="Input / Output 比"
          value={ioRatio.toFixed(1)}
          unit=":1"
          note={`平均喂给模型 ${ioRatio.toFixed(1)} 个 token，模型生成 1 个。比值越低说明指令越紧凑、生成越密集。`}
          guidance={guidance.io}
          spark={ioSeries}
          color="oklch(0.65 0.11 200)"/>
        <EffCard
          label="Reasoning 占比"
          value={reasonPct.toFixed(1)}
          unit="%"
          note={`推理 token 比例越高，说明你交给模型的任务越复杂——通常对应代码重构、调试或多步规划。`}
          guidance={guidance.reasoning}
          spark={reasonSeries}
          color="oklch(0.65 0.12 150)"/>
      </div>
    </section>
  );
}

function EffCard({ label, value, unit, note, guidance, spark, color }) {
  return (
    <div className="eff-card">
      <div className="eff-label">{label}</div>
      <div className="eff-value">
        {value}<span className="unit">{unit}</span>
      </div>
      {guidance && (
        <div className={`eff-guidance eff-guidance-${guidance.tone}`}>
          <span>{guidance.label} · {guidance.range}</span>
          <p>{guidance.advice}</p>
          <small>{guidance.source}</small>
        </div>
      )}
      <p className="eff-note">{note}</p>
      {spark && spark.length > 0 && (
        <div className="eff-spark">
          <MiniSpark values={spark} color={color}/>
        </div>
      )}
    </div>
  );
}

function MiniSpark({ values, color }) {
  if (!values || values.length === 0) return null;
  const w = 200, h = 32;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / Math.max(1, values.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 2) - 1;
    return [x, y];
  });
  const d = pts.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(' ');
  const dArea = d + ` L${w},${h} L0,${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{width: '100%', height: h, display: 'block'}}>
      <path d={dArea} fill={color} opacity="0.14"/>
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>
    </svg>
  );
}

// ───────────────────────────────────────────────────────────────
// Savings simulator — official-price model switching simulation
// ───────────────────────────────────────────────────────────────
function SavingsSimulatorSection({
  simulation,
  emptyReason,
  lazyState,
  actionsByRule = new Map(),
  onAddAction,
  onSetActionStatus,
  onLazyAttribution,
  autopilotState,
  onRunAutopilot,
  onApplyEvidenceSuggestion,
  onDismissEvidenceSuggestion
}) {
  if (!simulation) return null;
  const suggestions = simulation.suggestions || [];
  const unpriced = simulation.unpriced || {};

  return (
    <section className="story savings-section">
      <div className="section-label">08 · 节省模拟</div>
      <h2 className="section-title">哪些 token 可以少花一点</h2>
      <p className="section-sub">官方价换算节省模拟只用于比较模型策略，不是供应商账单；人民币按展示汇率估算。未公开官方美元价的模型不会参与节省金额计算。</p>

      <div className="savings-hero">
        <div>
          <span>模拟可节省</span>
          <strong>{simulation.potentialSavingsUSD > 0 ? U.money4(simulation.potentialSavingsUSD) : '—'}</strong>
          <p>{suggestions.length} 条模型切换建议 · 覆盖 {U.compactCN(suggestions.reduce((sum, row) => sum + row.totalTokens, 0))} tokens</p>
        </div>
        <div>
          <span>当前官方价</span>
          <strong>{simulation.totalCostUSD > 0 ? U.money4(simulation.totalCostUSD) : '—'}</strong>
          <p>本期 {U.compactCN(simulation.totalTokens)} tokens；未定价 tokens 不进入官方价节省判断。</p>
        </div>
      </div>

      {suggestions.length ? (
        <div className="savings-list">
          {suggestions.map((item, index) => (
            <article key={item.id} className="savings-card">
              <div className="savings-rank">{String(index + 1).padStart(2, '0')}</div>
              <div className="savings-body">
                <div className="savings-head">
                  <div>
                    <span>{tierLabel(item.currentTier)} → {tierLabel(item.suggestedTier)}</span>
                    <h3>{item.title}</h3>
                  </div>
                  <strong>{U.money4(item.savingsUSD)}</strong>
                </div>
                <p>{item.recommendation}</p>
                <div className="savings-metrics">
                  <SavingsMetric label="Sessions" value={item.sessionCount} />
                  <SavingsMetric label="Tokens" value={U.compactCN(item.totalTokens)} />
                  <SavingsMetric label="当前官方价" value={U.money4(item.currentCostUSD)} />
                  <SavingsMetric label="模拟后" value={U.money4(item.simulatedCostUSD)} />
                  <SavingsMetric label="证据来源" value={item.evidenceQuality || '缺证据'} />
                </div>
                <div className="savings-detail">
                  <span>为什么</span>
                  <p>{item.why}</p>
                  <span>证据口径</span>
                  <p>{item.evidenceSummary || item.evidenceQuality || '缺证据'}；自动证据不等同人工确认。</p>
                  <span>建议动作</span>
                  <p>{item.action}</p>
                  <span>参考模型</span>
                  <p>{item.suggestedModels.join('、') || tierLabel(item.suggestedTier)}</p>
                </div>
                <AdvisorActionControls
                  existing={actionsByRule.get(`savings:${item.id}`)}
                  onAdd={() => onAddAction?.({
                    sourceRule: `savings:${item.id}`,
                    category: '节省模拟',
                    title: item.title,
                    action: item.action,
                    evidence: `${item.sessionCount} sessions · ${U.compactCN(item.totalTokens)} tokens · 可节省 ${U.money4(item.savingsUSD)} · 证据 ${item.evidenceSummary || item.evidenceQuality || '缺证据'}`
                  })}
                  onSetStatus={onSetActionStatus}
                />
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="savings-empty">
          <h3>{emptyReason?.title || '当前周期没有触发可计算的官方价节省建议'}</h3>
          <ul>
            {(emptyReason?.reasons || ['高价值已完成/已发布任务不会被建议降级模型。']).map(reason => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <p>{emptyReason?.action || '补齐任务、阶段和价值后再看节省模拟。'}</p>
          <EvidenceAutopilotPanel
            state={autopilotState}
            onRun={onRunAutopilot}
            onApply={onApplyEvidenceSuggestion}
            onDismiss={onDismissEvidenceSuggestion}
          />
          <LazyAttributionButton state={lazyState} onClick={onLazyAttribution}/>
        </div>
      )}

      {unpriced.sessionCount > 0 && (
        <div className="savings-unpriced">
          <h3>未纳入成本决策的模型</h3>
          <p>{unpriced.sessionCount} 个 session、{U.compactCN(unpriced.totalTokens)} tokens 没有公开官方美元价：{unpriced.models.join('、') || 'unknown'}。这些模型只用于 token 和产出复盘，不按 $0 或 ¥0 计算节省。</p>
        </div>
      )}
    </section>
  );
}

function SavingsMetric({ label, value }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────
// ROI Advisor — local rule based recommendations
// ───────────────────────────────────────────────────────────────
function RoiAdvisorSection({ suggestions, actionsByRule = new Map(), onAddAction, onSetActionStatus }) {
  const [copiedId, setCopiedId] = useState(null);
  const copyAdvisor = async (item, mode) => {
    const text = mode === 'action'
      ? item.action
      : [
        item.title,
        `建议分类：${item.category || '未分类'}`,
        `影响级别：${item.impact}`,
        `建议：${item.recommendation}`,
        `原因：${item.reason}`,
        `证据：${item.evidence}`,
        `建议动作：${item.action}`
      ].join('\n');
    await copyText(text);
    const id = `${item.id}:${mode}`;
    setCopiedId(id);
    window.setTimeout(() => setCopiedId(null), 1400);
  };

  if (!suggestions.length) {
    return (
      <section className="story roi-advisor-section">
        <div className="section-label">09 · ROI 建议</div>
        <h2 className="section-title">当前没有明显的 ROI 风险</h2>
        <div className="no-data">本期没有触发模型选择、归因缺口或上下文效率建议。</div>
      </section>
    );
  }

  return (
    <section className="story roi-advisor-section">
      <div className="section-label">09 · ROI 建议</div>
      <h2 className="section-title">用有限 token 做更高 ROI 的事</h2>
      <p className="section-sub">这些建议只基于本地结构化数据和规则，不调用模型，不读取对话正文。</p>

      <div className="advisor-list">
        {suggestions.map((item, index) => (
          <article key={item.id} className={`advisor-card advisor-${item.tone}`}>
            <div className="advisor-rank">{String(index + 1).padStart(2, '0')}</div>
            <div className="advisor-body">
              <div className="advisor-head">
                <div>
                  <div className="advisor-meta">
                    <span className="advisor-category">{item.category || '未分类'}</span>
                    <span className="advisor-impact">{item.impact}影响</span>
                  </div>
                  <h3>{item.title}</h3>
                </div>
                <span className="advisor-tone">{toneLabel(item.tone)}</span>
              </div>
              <p className="advisor-recommendation">{item.recommendation}</p>
              <div className="advisor-grid">
                <div>
                  <span>原因</span>
                  <p>{item.reason}</p>
                </div>
                <div>
                  <span>证据</span>
                  <p>{item.evidence}</p>
                </div>
              </div>
              <div className="advisor-action">
                <span>建议动作</span>
                <strong>{item.action}</strong>
              </div>
              <div className="advisor-actions">
                <button type="button" onClick={() => copyAdvisor(item, 'full')}>
                  {copiedId === `${item.id}:full` ? '已复制' : '复制建议'}
                </button>
                <button type="button" onClick={() => copyAdvisor(item, 'action')}>
                  {copiedId === `${item.id}:action` ? '已复制' : '复制行动项'}
                </button>
              </div>
              <AdvisorActionControls
                existing={actionsByRule.get(`advisor:${item.id}`)}
                onAdd={() => onAddAction?.({
                  sourceRule: `advisor:${item.id}`,
                  category: item.category || 'ROI Advisor',
                  title: item.title,
                  action: item.action,
                  evidence: item.evidence
                })}
                onSetStatus={onSetActionStatus}
              />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function AdvisorActionControls({ existing, onAdd, onSetStatus }) {
  const [busy, setBusy] = useState(false);

  const run = async (fn) => {
    if (!fn) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  if (!existing) {
    return (
      <div className="advisor-action-loop">
        <button type="button" disabled={busy} onClick={() => run(onAdd)}>
          {busy ? '保存中' : '加入行动清单'}
        </button>
      </div>
    );
  }

  return (
    <div className="advisor-action-loop">
      <span className={`advisor-action-status status-${existing.status}`}>
        {existing.status === 'done' ? '已完成' : existing.status === 'dismissed' ? '已忽略' : '行动中'}
      </span>
      {existing.status !== 'done' && (
        <button type="button" disabled={busy} onClick={() => run(() => onSetStatus?.(existing, 'done'))}>
          标为完成
        </button>
      )}
      {existing.status !== 'dismissed' && (
        <button type="button" disabled={busy} onClick={() => run(() => onSetStatus?.(existing, 'dismissed'))}>
          忽略本次
        </button>
      )}
      {existing.status !== 'open' && (
        <button type="button" disabled={busy} onClick={() => run(() => onSetStatus?.(existing, 'open'))}>
          重新打开
        </button>
      )}
    </div>
  );
}

function AdvisorActionSummarySection({ actions = [], measurements = [], period, onSetActionStatus }) {
  const [busyId, setBusyId] = useState(null);
  const counts = useMemo(() => ({
    open: actions.filter(action => action.status === 'open').length,
    done: actions.filter(action => action.status === 'done').length,
    dismissed: actions.filter(action => action.status === 'dismissed').length
  }), [actions]);
  const ordered = useMemo(() => [...actions].sort((a, b) => {
    const rank = { open: 0, done: 1, dismissed: 2 };
    return (rank[a.status] ?? 3) - (rank[b.status] ?? 3)
      || String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  }), [actions]);

  const setStatus = async (action, status) => {
    setBusyId(action.id);
    try {
      await onSetActionStatus?.(action, status);
    } finally {
      setBusyId(null);
    }
  };

  const exportActions = () => {
    const lines = [
      '# Token Work Advisor Actions',
      '',
      `Period: ${period.start} to ${period.end}`,
      '',
      `- Open: ${counts.open}`,
      `- Done: ${counts.done}`,
      `- Dismissed: ${counts.dismissed}`,
      '',
      '## Actions',
      ''
    ];
    if (!ordered.length) {
      lines.push('No advisor actions in this period.');
    } else {
      for (const action of ordered) {
        lines.push(`### [${action.status}] ${action.title}`);
        lines.push(`- Category: ${action.category || 'ROI Advisor'}`);
        lines.push(`- Action: ${action.action}`);
        lines.push(`- Evidence: ${action.evidence || '—'}`);
        lines.push(`- Rule: ${action.sourceRule || 'manual'}`);
        lines.push('');
      }
    }
    U.downloadText(`token-work-actions-${period.start}-${period.end}.md`, lines.join('\n'), 'text/markdown;charset=utf-8');
  };

  return (
    <section className="story advisor-action-summary-section">
      <div className="section-label">10 · 行动清单</div>
      <h2 className="section-title">建议有没有变成下一步动作</h2>
      <p className="section-sub">这里只跟踪本期 Savings Simulator 和 ROI Advisor 生成的行动状态；完成行动不等同真实节省因果，只用于下次看同类 token / 官方价趋势。</p>

      <div className="action-summary-hero">
        <div>
          <span>Open</span>
          <strong>{counts.open}</strong>
          <p>需要下周继续执行的模型、上下文或归因动作。</p>
        </div>
        <div>
          <span>Done</span>
          <strong>{counts.done}</strong>
          <p>已完成动作会进入周报的行动状态。</p>
        </div>
        <div>
          <span>Dismissed</span>
          <strong>{counts.dismissed}</strong>
          <p>忽略只代表本期不处理，不会删除原建议证据。</p>
        </div>
      </div>

      <div className="action-summary-toolbar">
        <button type="button" onClick={exportActions} disabled={!actions.length}>
          导出行动清单 Markdown
        </button>
      </div>

      {measurements.length > 0 && (
        <div className="action-measurement-panel">
          <div className="action-measurement-head">
            <div>
              <span>行动前后趋势</span>
              <h3>同类 token 是否正在下降</h3>
            </div>
            <p>趋势对比不证明真实因果节省，只帮助下周复盘策略是否值得继续。</p>
          </div>
          <div className="action-measurement-list">
            {measurements.slice(0, 5).map(row => (
              <article key={row.id || row.title} className="action-measurement-card">
                <div>
                  <span>{row.scopeLabel}</span>
                  <strong>{row.title}</strong>
                  <p>{row.caveat}</p>
                </div>
                <div className="action-measurement-metrics">
                  <div>
                    <span>Before</span>
                    <b>{U.compactCN(row.beforeTokens)}</b>
                    <small>{row.beforeCostUSD > 0 ? U.money(row.beforeCostUSD) : '—'}</small>
                  </div>
                  <div>
                    <span>After</span>
                    <b>{U.compactCN(row.afterTokens)}</b>
                    <small>{row.afterCostUSD > 0 ? U.money(row.afterCostUSD) : '—'}</small>
                  </div>
                  <div>
                    <span>Delta</span>
                    <b>{row.deltaTokens >= 0 ? '+' : ''}{U.compactCN(row.deltaTokens)}</b>
                    <small>{row.deltaCostUSD >= 0 ? '+' : ''}{U.money(row.deltaCostUSD)}</small>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {ordered.length ? (
        <div className="action-summary-list">
          {ordered.map(action => (
            <article key={action.id} className={`action-summary-card status-${action.status}`}>
              <div className="action-summary-card-head">
                <span>{action.category || 'ROI Advisor'}</span>
                <b>{action.status === 'done' ? '已完成' : action.status === 'dismissed' ? '已忽略' : '行动中'}</b>
              </div>
              <h3>{action.title}</h3>
              <p>{action.action}</p>
              {action.evidence && <small>{action.evidence}</small>}
              <div className="action-summary-card-actions">
                {action.status !== 'done' && (
                  <button type="button" disabled={busyId === action.id} onClick={() => setStatus(action, 'done')}>标为完成</button>
                )}
                {action.status !== 'dismissed' && (
                  <button type="button" disabled={busyId === action.id} onClick={() => setStatus(action, 'dismissed')}>忽略本次</button>
                )}
                {action.status !== 'open' && (
                  <button type="button" disabled={busyId === action.id} onClick={() => setStatus(action, 'open')}>重新打开</button>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="no-data">还没有行动项。先在“节省模拟”或“ROI 建议”里把可执行建议加入行动清单。</div>
      )}
    </section>
  );
}

function toneLabel(tone) {
  if (tone === 'risk') return '先处理';
  if (tone === 'optimize') return '可优化';
  if (tone === 'good') return '可复用';
  return '需留意';
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the hidden-textarea fallback for restricted contexts.
    }
  }
  const el = document.createElement('textarea');
  el.value = text;
  el.setAttribute('readonly', '');
  el.style.position = 'fixed';
  el.style.left = '-9999px';
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
}

// ───────────────────────────────────────────────────────────────
// Model Strategy — what model should be used for which work
// ───────────────────────────────────────────────────────────────
function ModelStrategySection({
  strategy,
  lazyState,
  onLazyAttribution,
  autopilotState,
  onRunAutopilot,
  onApplyEvidenceSuggestion,
  onDismissEvidenceSuggestion
}) {
  if (!strategy) return null;
  const coverage = strategy.coverage;
  const taskRows = strategy.byTaskType.slice(0, 4);
  const stageRows = strategy.byStage.slice(0, 4);
  const valueRows = strategy.byValue.slice(0, 4);

  return (
    <section className="story model-strategy-section">
      <div className="section-label">11 · 模型策略</div>
      <h2 className="section-title">什么任务该用什么模型</h2>
      <p className="section-sub">按任务类型、工作阶段和产出价值观察模型使用效果。这里不读取正文，只使用你手动标注后的结构化字段。</p>

      <div className="strategy-coverage">
        <div>
          <span>策略样本覆盖</span>
          <strong>{(coverage.annotatedShare * 100).toFixed(0)}%</strong>
          <p>{coverage.annotatedSessionCount} / {coverage.sessionCount} 个 session 已有任务、阶段或价值标注</p>
        </div>
        <div>
          <span>已归因 tokens</span>
          <strong>{U.compactCN(coverage.annotatedTokens)}</strong>
          <p>占本期 {coverage.totalTokens ? ((coverage.annotatedTokenShare) * 100).toFixed(1) : '0.0'}%</p>
        </div>
      </div>

      {coverage.annotatedSessionCount === 0 && strategy.modelRows.length > 0 && (
        <div className="strategy-facts">
          <div className="strategy-facts-head">
            <div>
              <span>先看事实</span>
              <h3>还没标注任务，但模型用量已经可见</h3>
              <p>下面是当前周期按模型聚合的真实 token、来源和官方价。策略建议需要补任务、阶段或价值后才会变准。</p>
            </div>
            <div>
              <EvidenceAutopilotPanel
                state={autopilotState}
                onRun={onRunAutopilot}
                onApply={onApplyEvidenceSuggestion}
                onDismiss={onDismissEvidenceSuggestion}
              />
              <LazyAttributionButton state={lazyState} onClick={onLazyAttribution}/>
            </div>
          </div>
          <div className="strategy-fact-list">
            {strategy.modelRows.slice(0, 5).map(row => (
              <div key={row.model} className="strategy-fact-row">
                <div>
                  <strong>{row.model}</strong>
                  <span>{tierLabel(row.tier)} · {row.sessionCount} sessions · 占 {((row.share || 0) * 100).toFixed(1)}%</span>
                </div>
                <div>
                  <b>{U.compactCN(row.totalTokens)}</b>
                  <span>{row.costUSD > 0 ? U.money(row.costUSD) : '未定价/无官方价'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="strategy-playbook">
        {strategy.playbook.map(row => (
          <article key={row.id} className={`strategy-policy strategy-policy-${row.targetTier}`}>
            <div className="strategy-policy-head">
              <span>{row.label}</span>
              <b>{row.evidenceState}</b>
            </div>
            <h3>{row.title}</h3>
            <p>{row.action}</p>
            <div className="strategy-policy-evidence">
              <div>
                <span>样本</span>
                <strong>{row.sessionCount} sessions</strong>
              </div>
              <div>
                <span>Tokens</span>
                <strong>{U.compactCN(row.totalTokens)}</strong>
              </div>
              <div>
                <span>常用模型</span>
                <strong>{row.topModel}</strong>
              </div>
              <div>
                <span>官方价</span>
                <strong>{row.costUSD > 0 ? U.money(row.costUSD) : '—'}</strong>
              </div>
            </div>
          </article>
        ))}
      </div>

      <div className="strategy-grid">
        <StrategyPanel title="按任务类型" rows={taskRows} empty="先给 session 标注任务类型，才能看到不同任务的模型策略。"/>
        <StrategyPanel title="按工作阶段" rows={stageRows} empty="先标注探索、实现、验证、发布等阶段，才能判断模型切换时机。"/>
        <StrategyPanel title="按价值等级" rows={valueRows} empty="先标注产出价值，才能识别高价值低成本的可复用模型组合。"/>
      </div>

      {strategy.riskModels.length > 0 && (
        <div className="strategy-risk">
          <h3>低价值 / 废弃成本集中在哪些模型</h3>
          <div className="strategy-risk-list">
            {strategy.riskModels.map(row => (
              <div key={row.model} className="strategy-risk-row">
                <div>
                  <strong>{row.model}</strong>
                  <span>{tierLabel(row.tier)} · {row.sessionCount} sessions</span>
                </div>
                <div>
                  <b>{U.compactCN(row.totalTokens)}</b>
                  <span>{row.costUSD > 0 ? U.money(row.costUSD) : '未定价/无官方价'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="strategy-recommendations">
        {strategy.recommendations.map(item => (
          <article key={item.id}>
            <h3>{item.title}</h3>
            <p>{item.detail}</p>
            <strong>{item.action}</strong>
          </article>
        ))}
      </div>
    </section>
  );
}

function StrategyPanel({ title, rows, empty }) {
  return (
    <div className="strategy-panel">
      <h3>{title}</h3>
      {rows.length ? rows.map(row => (
        <div key={row.key} className="strategy-row">
          <div>
            <strong>{row.key}</strong>
            <span>{row.sessionCount} sessions · 常用 {row.topModel}</span>
          </div>
          <div>
            <b>{U.compactCN(row.totalTokens)}</b>
            <span>{row.costUSD > 0 ? U.money(row.costUSD) : '—'}</span>
          </div>
        </div>
      )) : <p className="strategy-empty">{empty}</p>}
    </div>
  );
}

function tierLabel(tier) {
  if (tier === 'heavy') return '重模型';
  if (tier === 'mid') return '中模型';
  if (tier === 'light') return '轻量模型';
  if (tier === 'unpriced') return '未定价';
  return '未分层';
}

// ───────────────────────────────────────────────────────────────
// Insights — expandable cards
// ───────────────────────────────────────────────────────────────
function InsightsSection({ insights }) {
  const [openIdx, setOpenIdx] = useState(null);

  if (!insights.length) {
    return (
      <section className="story">
        <div className="section-label">12 · 复盘</div>
        <h2 className="section-title">几件值得复盘的小事</h2>
        <div className="no-data">本期没有明显的异常或趋势变化。</div>
      </section>
    );
  }

  return (
      <section className="story">
      <div className="section-label">12 · 复盘</div>
      <h2 className="section-title">几件值得复盘的小事</h2>
      <p className="section-sub">基于你本期与上一周期的对比，自动挑出最值得关注的几条。点击展开看支撑数据。</p>

      <div className="insights">
        {insights.map((ins, i) => (
          <div key={i} className={`insight ${openIdx === i ? 'open' : ''}`}
            onClick={() => setOpenIdx(openIdx === i ? null : i)}>
            <div className="insight-head">
              <div className={`insight-emoji ${ins.kind}`}>{ins.emoji}</div>
              <div className="insight-text">{ins.headline}</div>
              <svg className="insight-arrow" width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="insight-body">
              <div className="insight-detail">
                {ins.detail.map((d, di) => (
                  <div key={di}>
                    <div className="k">{d.k}</div>
                    <div className="v">{d.v}</div>
                  </div>
                ))}
              </div>
              <p className="insight-narrative">{ins.narrative}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export { ToolsSection, EfficiencySection, ClosureProgressSection, EvidenceFlywheelSection, RoiEvidenceSection, SavingsSimulatorSection, RoiAdvisorSection, AdvisorActionSummarySection, ModelStrategySection, InsightsSection, ReviewTrustBanner };

function EvidenceAutopilotPanel({ state, onRun, onApply, onDismiss }) {
  const dismissed = new Set(state?.dismissedIds || []);
  const rows = (state?.plan?.queue || []).filter(row => !dismissed.has(row.suggestionId)).slice(0, 10);
  const summary = state?.plan?.summary || {};

  return (
    <div className="evidence-autopilot-panel">
      <div className="evidence-autopilot-head">
        <div>
          <span>Evidence Autopilot</span>
          <strong>一键生成复盘证据</strong>
          <p>只用结构化 session、项目路径和 Git 元数据；不读正文、diff 或完整文件路径。</p>
        </div>
        <button type="button" disabled={state?.busy} onClick={onRun}>
          {state?.busy ? '生成中…' : '生成证据'}
        </button>
      </div>

      {state?.message && <div className="evidence-autopilot-message">{state.message}</div>}
      {state?.error && <div className="evidence-autopilot-error">{state.error}</div>}

      {state?.plan && (
        <div className="evidence-autopilot-summary">
          <span>可写入 {state.plan.canApplyCount || 0}</span>
          <span>待确认 {state.plan.draftCount || 0}</span>
          <span>Git 候选 {summary.gitOutputCandidates || 0}</span>
        </div>
      )}

      {rows.length > 0 ? (
        <div className="evidence-autopilot-list">
          {rows.map(row => (
            <article key={row.suggestionId} className={`evidence-autopilot-row ${row.canApply ? 'can-apply' : 'draft'}`}>
              <div className="evidence-autopilot-row-main">
                <div className="evidence-autopilot-row-title">
                  <span>{row.provenance}</span>
                  <strong>{row.title}</strong>
                </div>
                <p>{row.reason}</p>
                <div className="evidence-autopilot-meta">
                  <span>{row.category}</span>
                  <span>{row.project || '未知项目'}</span>
                  <span>{Math.round(row.confidence || 0)}%</span>
                  <span>{U.compactCN(row.totalTokens || 0)} tokens</span>
                  <span>{row.costUSD > 0 ? U.money(row.costUSD) : '未定价'}</span>
                </div>
              </div>
              <div className="evidence-autopilot-actions">
                {row.canApply ? (
                  <button
                    type="button"
                    disabled={state?.applyingId === row.suggestionId}
                    onClick={() => onApply?.(row.suggestionId)}
                  >
                    {state?.applyingId === row.suggestionId ? '写入中' : '接受建议'}
                  </button>
                ) : (
                  <a href="/" title="回到看板编辑确认">编辑确认</a>
                )}
                <button type="button" className="ghost" onClick={() => onDismiss?.(row.suggestionId)}>
                  忽略本次
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="evidence-autopilot-empty">点击生成后会列出最值得补的 10 条证据；能安全写入的高置信建议会标为“自动高置信”。</p>
      )}
    </div>
  );
}

function LazyAttributionButton({ state, onClick }) {
  return (
    <div className="lazy-attribution-action">
      <button type="button" disabled={state?.busy} onClick={onClick}>
        {state?.busy ? '归因中…' : '一键懒人归因'}
      </button>
      <p>只写入高置信自动草稿，不覆盖人工标注。</p>
      {state?.message && <strong>{state.message}</strong>}
      {state?.error && <b>{state.error}</b>}
    </div>
  );
}
