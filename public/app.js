/* ══════════════════════════════════════════════════════════
   EQUITYLENS — Front-end controller
══════════════════════════════════════════════════════════ */

const $ = (id) => document.getElementById(id);

// ── State refs ────────────────────────────────────────────
const tickerInput   = $('tickerInput');
const analyzeBtn    = $('analyzeBtn');
const dashboard     = $('dashboard');
const loadingState  = $('loadingState');
const errorState    = $('errorState');
const landingState  = $('landingState');
const errorMessage  = $('errorMessage');
const loadingTicker = $('loadingTicker');

let lastTicker = '';

// ── UI state machine ─────────────────────────────────────
function showLanding() {
  dashboard.classList.add('hidden');
  loadingState.classList.add('hidden');
  errorState.classList.add('hidden');
  landingState.classList.remove('hidden');
}

function showLoading(ticker) {
  dashboard.classList.add('hidden');
  errorState.classList.add('hidden');
  landingState.classList.add('hidden');
  loadingState.classList.remove('hidden');
  loadingTicker.textContent = ticker;
  // Reset steps
  ['step1','step2','step3','step4'].forEach(id => {
    const el = $(id);
    el.classList.remove('active','done');
  });
  animateLoadingSteps();
}

function showError(msg) {
  dashboard.classList.add('hidden');
  loadingState.classList.add('hidden');
  landingState.classList.add('hidden');
  errorState.classList.remove('hidden');
  errorMessage.textContent = msg;
}

function showDashboard() {
  loadingState.classList.add('hidden');
  errorState.classList.add('hidden');
  landingState.classList.add('hidden');
  dashboard.classList.remove('hidden');
}

function animateLoadingSteps() {
  const steps = ['step1','step2','step3','step4'];
  const delays = [0, 800, 1600, 2800];
  steps.forEach((id, i) => {
    setTimeout(() => {
      const el = $(id);
      if (!el) return;
      // mark previous done
      if (i > 0) {
        const prev = $(steps[i-1]);
        if (prev) { prev.classList.remove('active'); prev.classList.add('done'); }
      }
      el.classList.add('active');
    }, delays[i]);
  });
}

// ── Format helpers ────────────────────────────────────────
function fmt(val, opts = {}) {
  if (val === null || val === undefined || val === 'N/A') return 'N/A';
  const n = Number(val);
  if (isNaN(n)) return 'N/A';

  if (opts.currency) {
    return '$' + n.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }
  if (opts.pct) {
    return (n * 100).toFixed(1) + '%';
  }
  if (opts.large) {
    // billions / millions
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    return '$' + n.toFixed(2);
  }
  if (opts.multiple) {
    return n.toFixed(1) + 'x';
  }
  return n.toFixed(opts.dp ?? 2);
}

function fmtNA(val) {
  return (val === null || val === undefined || val === 'N/A') ? 'N/A' : val;
}

// ── Render functions ─────────────────────────────────────

function renderHeadline(data) {
  $('hdTicker').textContent = data.ticker;
  $('hdName').textContent = data.company_name;

  const badge = $('recBadge');
  badge.textContent = data.overall_recommendation;
  badge.className = `rec-badge ${data.overall_recommendation}`;

  $('confValue').textContent = data.confidence_score;
  $('currentPrice').textContent = fmt(data.metrics_analysis.current_price, { currency: true });

  const tp = data.target_price_12m;
  $('targetPrice').textContent = (tp && tp !== 'N/A') ? fmt(tp, { currency: true }) : 'N/A';
}

function renderMetrics(data) {
  const m = data.metrics_analysis;

  const cards = [
    {
      label: 'CURRENT PRICE',
      value: fmt(m.current_price, { currency: true }),
      tag: null, cls: ''
    },
    {
      label: 'MARKET CAP',
      value: m.market_cap_millions !== 'N/A'
        ? fmt(m.market_cap_millions * 1e6, { large: true })
        : 'N/A',
      tag: null, cls: ''
    },
    {
      label: 'EBITDA (TTM)',
      value: m.ebitda !== 'N/A'
        ? fmt(m.ebitda, { large: true })
        : 'N/A',
      tag: null, cls: ''
    },
    {
      label: 'P/E RATIO',
      value: fmt(m.pe_ratio.value, { multiple: true }),
      tag: m.pe_ratio.assessment,
      cls: m.pe_ratio.assessment?.toLowerCase() || ''
    },
    {
      label: 'P/S RATIO',
      value: fmt(m.ps_ratio.value, { multiple: true }),
      tag: m.ps_ratio.assessment,
      cls: m.ps_ratio.assessment?.toLowerCase() || ''
    },
    {
      label: 'EV / EBITDA',
      value: fmt(m.ev_ebitda.value, { multiple: true }),
      tag: m.ev_ebitda.assessment,
      cls: m.ev_ebitda.assessment?.toLowerCase() || ''
    },
    {
      label: 'DCF INTRINSIC VALUE',
      value: fmt(m.dcf_intrinsic_value, { currency: true }),
      tag: null,
      cls: '',
      sub: m.dcf_intrinsic_value !== 'N/A' && m.current_price !== 'N/A'
        ? (() => {
            const gap = (((m.dcf_intrinsic_value - m.current_price) / m.current_price) * 100).toFixed(0);
            const dir = gap >= 0 ? '▲' : '▼';
            const cls = gap >= 0 ? 'buy' : 'sell';
            return `<span class="metric-gap ${cls}">${dir} ${Math.abs(gap)}% vs price</span>`;
          })()
        : ''
    },
    {
      label: '52-WEEK HIGH',
      value: fmt(m.week_52_high, { currency: true }),
      tag: null, cls: ''
    },
    {
      label: '52-WEEK LOW',
      value: fmt(m.week_52_low, { currency: true }),
      tag: null, cls: ''
    },
    {
      label: 'BETA',
      value: m.beta !== 'N/A' ? Number(m.beta).toFixed(2) : 'N/A',
      tag: null, cls: ''
    },
    {
      label: 'REVENUE GROWTH (TTM)',
      value: m.revenue_growth_ttm !== 'N/A' ? fmt(m.revenue_growth_ttm, { pct: true }) : 'N/A',
      tag: null, cls: ''
    },
    {
      label: 'NET MARGIN (TTM)',
      value: m.net_margin_ttm !== 'N/A' ? fmt(m.net_margin_ttm, { pct: true }) : 'N/A',
      tag: null, cls: ''
    },
    {
      label: 'ROE (TTM)',
      value: m.roe_ttm !== 'N/A' ? fmt(m.roe_ttm, { pct: true }) : 'N/A',
      tag: null, cls: ''
    }
  ];

  const grid = $('metricsGrid');
  grid.innerHTML = cards.map(c => `
    <div class="metric-card ${c.cls}">
      <span class="metric-label">${c.label}</span>
      <span class="metric-value">${c.value}</span>
      ${c.tag ? `<span class="metric-tag ${c.tag}">${c.tag}</span>` : ''}
      ${c.sub || ''}
    </div>
  `).join('');
}

// tiny inline metric-gap style — inject once
(function injectGapStyle() {
  const s = document.createElement('style');
  s.textContent = `
    .metric-gap {
      font-family: var(--mono);
      font-size: 0.7rem;
      font-weight: 600;
      display: inline-block;
      margin-top: 4px;
    }
    .metric-gap.buy  { color: var(--buy); }
    .metric-gap.sell { color: var(--sell); }
  `;
  document.head.appendChild(s);
})();

function renderDCFAssumptions(data) {
  const a = data.dcf_assumptions;
  if (!a) { $('dcfAssumptions').innerHTML = '<span style="color:var(--dim);font-size:0.8rem">DCF assumptions unavailable.</span>'; return; }

  const items = [
    { label: 'FCF GROWTH RATE',   value: a.fcf_growth_rate },
    { label: 'WACC',              value: a.wacc },
    { label: 'TERMINAL GROWTH',   value: a.terminal_growth },
    { label: 'PROJECTION YEARS',  value: a.projection_years }
  ];

  $('dcfAssumptions').innerHTML = items.map(i => `
    <div class="dcf-item">
      <span class="dcf-item-label">${i.label}</span>
      <span class="dcf-item-value">${i.value ?? 'N/A'}</span>
    </div>
  `).join('');
}

function renderPeers(data) {
  const m = data.metrics_analysis;
  const peers = m.peers || [];

  if (peers.length === 0) {
    $('peerSection').classList.add('hidden');
    return;
  }
  $('peerSection').classList.remove('hidden');

  // Compute peer averages for avg row
  const avg = (key) => {
    const vals = peers.map(p => p[key]).filter(v => v !== 'N/A' && !isNaN(v) && v > 0);
    return vals.length ? (vals.reduce((a,b) => a+b, 0) / vals.length) : null;
  };
  const avgPE = avg('pe');
  const avgPS = avg('ps');
  const avgEV = avg('ev');

  const subPE = m.pe_ratio.value !== 'N/A' ? Number(m.pe_ratio.value) : null;
  const subPS = m.ps_ratio.value !== 'N/A' ? Number(m.ps_ratio.value) : null;
  const subEV = m.ev_ebitda.value !== 'N/A' ? Number(m.ev_ebitda.value) : null;

  const vsTag = (val, avg) => {
    if (val === null || avg === null) return '<span class="vs-inline">—</span>';
    const pct = ((val - avg) / avg * 100).toFixed(0);
    if (val < avg * 0.88) return `<span class="vs-cheaper">▼ ${Math.abs(pct)}% cheaper</span>`;
    if (val > avg * 1.12) return `<span class="vs-richer">▲ ${Math.abs(pct)}% richer</span>`;
    return `<span class="vs-inline">≈ in line</span>`;
  };

  const na = (v) => (v === 'N/A' || v === null || isNaN(v)) ? 'N/A' : Number(v).toFixed(1) + 'x';

  const peerRows = peers.map(p => `
    <tr>
      <td>${p.symbol}</td>
      <td class="num-col">${na(p.pe)}</td>
      <td class="num-col">${na(p.ps)}</td>
      <td class="num-col">${na(p.ev)}</td>
      <td>—</td>
    </tr>
  `).join('');

  const avgRow = `
    <tr class="avg-row">
      <td>PEER AVG</td>
      <td class="num-col">${avgPE ? avgPE.toFixed(1) + 'x' : 'N/A'}</td>
      <td class="num-col">${avgPS ? avgPS.toFixed(1) + 'x' : 'N/A'}</td>
      <td class="num-col">${avgEV ? avgEV.toFixed(1) + 'x' : 'N/A'}</td>
      <td>—</td>
    </tr>
  `;

  const subjectRow = `
    <tr class="subject-row">
      <td>${data.ticker} ◈</td>
      <td class="num-col">${na(subPE)}</td>
      <td class="num-col">${na(subPS)}</td>
      <td class="num-col">${na(subEV)}</td>
      <td>${vsTag(subPE, avgPE)}</td>
    </tr>
  `;

  $('peerTableBody').innerHTML = peerRows + avgRow + subjectRow;
  $('peerSummaryText').textContent = m.peer_evaluation_summary;
}

function renderOutlook(data) {
  const p = data.market_predictions;
  $('outlookDays').textContent   = p.next_few_days   || 'Unavailable.';
  $('outlookWeeks').textContent  = p.next_few_weeks  || 'Unavailable.';
  $('outlookMonths').textContent = p.next_few_months || 'Unavailable.';
  $('outlookYears').textContent  = p.next_few_years  || 'Unavailable.';
}

function renderThesis(data) {
  // Simple markdown → HTML (bold, headers, hr, em, paragraphs)
  let md = data.investment_thesis || '';
  md = md
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^---$/gm, '<hr/>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br/>');
  $('thesis').innerHTML = `<p>${md}</p>`;
}

function render(data) {
  renderHeadline(data);
  renderMetrics(data);
  renderDCFAssumptions(data);
  renderPeers(data);
  renderOutlook(data);
  renderThesis(data);
  showDashboard();
  // Smooth scroll to dashboard
  dashboard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── API call ─────────────────────────────────────────────
async function analyze(ticker) {
  ticker = ticker.toUpperCase().trim();
  if (!ticker) { tickerInput.focus(); return; }
  lastTicker = ticker;
  showLoading(ticker);

  try {
    const res = await fetch(`/api/analyze/${encodeURIComponent(ticker)}`);
    const json = await res.json();

    if (!res.ok) {
      showError(json.error || `Server returned ${res.status}. Check your Finnhub API key in .env.`);
      return;
    }
    render(json);
  } catch (err) {
    showError(`Network error: ${err.message}. Is the server running?`);
  }
}

// ── Event listeners ───────────────────────────────────────
analyzeBtn.addEventListener('click', () => {
  analyze(tickerInput.value);
});

tickerInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') analyze(tickerInput.value);
  // Auto-uppercase as user types
  setTimeout(() => {
    tickerInput.value = tickerInput.value.toUpperCase();
  }, 0);
});

document.querySelectorAll('.hint-chip').forEach(btn => {
  btn.addEventListener('click', () => {
    const t = btn.dataset.ticker;
    tickerInput.value = t;
    analyze(t);
  });
});

$('errorRetry').addEventListener('click', () => {
  if (lastTicker) analyze(lastTicker);
  else showLanding();
});

// ── Initial state ─────────────────────────────────────────
showLanding();
tickerInput.focus();