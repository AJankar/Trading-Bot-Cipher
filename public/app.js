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
const logo          = $('logo');
const metricModal   = $('metricModal');
const metricModalOverlay = $('metricModalOverlay');
const metricModalClose = $('metricModalClose');
const metricModalLabel = $('metricModalLabel');
const metricDefinition = $('metricDefinition');
const metricImportance = $('metricImportance');
const summaryCard = $('stockSummaryCard');
const summaryTicker = $('summaryTicker');
const summaryPrice = $('summaryPrice');
const summaryPrediction = $('summaryPrediction');

let lastTicker = '';
let summaryHideTimer = null;
let summaryCardScrollRaf = null;
let summaryCardListenersAttached = false;
let summaryCardShouldBeVisible = false;

// ── UI state machine ─────────────────────────────────────
function showLanding() {
  dashboard.classList.add('hidden');
  loadingState.classList.add('hidden');
  errorState.classList.add('hidden');
  landingState.classList.remove('hidden');
  if (summaryCard) summaryCard.classList.add('hidden');
}

function showLoading(ticker) {
  if (summaryCard) summaryCard.classList.add('hidden');
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
  if (summaryCard) summaryCard.classList.add('hidden');
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

const metricDefinitions = {
  'CURRENT PRICE': {
    definition: 'The last traded price for the stock, which reflects the market value assigned by buyers and sellers at the most recent transaction. It is the live reference point used across valuations, comparisons, and risk assessment.',
    importance: 'Current price is foundational to every valuation and return calculation. It determines whether the stock is trading above or below intrinsic value and drives comparisons with peer multiples.'
  },
  'MARKET CAP': {
    definition: 'Market capitalization is the total equity value of the company, calculated by multiplying the current share price by the number of outstanding shares. It represents the market’s valuation of the company’s equity on a fully diluted basis.',
    importance: 'Market cap defines company size and risk profile, distinguishing mega-cap, large-cap, mid-cap, and small-cap peers. It also helps normalize valuation multiples across companies of different scale.'
  },
  'EBITDA (TTM)': {
    definition: 'EBITDA over the trailing twelve months measures operating earnings before interest, taxes, depreciation, and amortization. It isolates core cash-generating performance from capital structure and non-cash accounting items.',
    importance: 'EBITDA is widely used in enterprise value multiples and peer comparisons because it reflects operating profitability more consistently than net income. It helps compare companies with different tax situations and financing structures.'
  },
  'P/E RATIO': {
    definition: 'The price-to-earnings ratio compares the current share price to earnings per share over the trailing twelve months. It shows how much investors are paying for each dollar of reported earnings.',
    importance: 'P/E is a common valuation gauge for profitability-based businesses. It helps identify whether a stock is expensive or cheap relative to earnings and sentiment within its sector.'
  },
  'P/S RATIO': {
    definition: 'The price-to-sales ratio divides market capitalization by trailing revenue. It measures the value investors assign to each dollar of revenue, independent of profit margins.',
    importance: 'P/S is especially useful for companies with low or negative earnings, as it focuses on top-line scale. It helps compare revenue efficiency across peers and growth-stage businesses.'
  },
  'EV / EBITDA': {
    definition: 'The enterprise value to EBITDA multiple divides enterprise value by operating earnings before interest, taxes, depreciation, and amortization. It adjusts valuation for debt and cash balance differences.',
    importance: 'EV/EBITDA is a key multiple for comparing businesses with different capital structures. It captures how the market values operating cash flow across peers and acquisition targets.'
  },
  'DCF INTRINSIC VALUE': {
    definition: 'Discounted cash flow intrinsic value is an estimate of the company’s worth based on projected future free cash flows, discounted back to present value using a required return rate. It reflects the long-term economics of the business rather than short-term market noise.',
    importance: 'This metric provides a fundamental anchor to compare against the current price. A significant gap between DCF intrinsic value and market price highlights potential undervaluation or overvaluation.'
  },
  '52-WEEK HIGH': {
    definition: 'The 52-week high is the highest stock price reached over the past year. It shows the upper bound of the recent trading range and the peak market valuation for the stock during that period.',
    importance: 'Tracking the 52-week high helps assess momentum and whether the stock is trading near a recent peak or has room to move higher. It is useful for timing and technical reference.'
  },
  '52-WEEK LOW': {
    definition: 'The 52-week low is the lowest stock price reached over the past year. It shows the lower bound of the recent trading range and the point of maximum market pessimism in the last year.',
    importance: 'The 52-week low helps identify support levels and downside risk. It can also highlight potential value opportunities if fundamentals remain intact.'
  },
  'BETA': {
    definition: 'Beta is a measure of the stock’s historical volatility relative to the broader market. A beta above 1 indicates greater sensitivity to market moves, while a beta below 1 indicates lower sensitivity.',
    importance: 'Beta helps investors understand market risk and how the stock may move within a portfolio. It is often used when estimating expected returns and setting risk-adjusted targets.'
  },
  'REVENUE GROWTH (TTM)': {
    definition: 'Trailing twelve-month revenue growth measures the year-over-year increase in sales. It reflects the company’s ability to expand its top line over the most recent annual period.',
    importance: 'Revenue growth is a primary driver of valuation multiples and investor expectations. Sustained growth often justifies premium valuations and indicates market demand.'
  },
  'NET MARGIN (TTM)': {
    definition: 'Net margin over the trailing twelve months is net income divided by revenue, expressed as a percentage. It shows how much profit the company retains from each dollar of sales after all expenses.',
    importance: 'Net margin indicates profitability efficiency. Higher margins suggest stronger pricing power, cost control, and the ability to convert sales into earnings.'
  },
  'ROE (TTM)': {
    definition: 'Return on equity over the trailing twelve months measures the percentage return generated on shareholder equity. It indicates how effectively the company is deploying capital to generate profit.',
    importance: 'ROE is a key indicator of management quality and capital efficiency. Companies that can sustain high ROE often have competitive advantages and attractive reinvestment opportunities.'
  }
};


function openMetricModal(label) {
  const metadata = metricDefinitions[label];
  if (!metadata || !metricModal) return;
  metricModalLabel.textContent = label;
  metricDefinition.textContent = metadata.definition;
  metricImportance.textContent = metadata.importance;
  metricModal.classList.remove('hidden');
}

function closeMetricModal() {
  if (!metricModal) return;
  metricModal.classList.add('hidden');
}

function attachMetricModalListeners() {
  const cards = document.querySelectorAll('.metric-card');
  cards.forEach(card => {
    card.addEventListener('click', () => {
      const label = card.dataset.metricLabel || card.querySelector('.metric-label')?.textContent;
      if (label) openMetricModal(label.trim());
    });
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        const label = card.dataset.metricLabel || card.querySelector('.metric-label')?.textContent;
        if (label) openMetricModal(label.trim());
      }
    });
  });

  if (!metricModal.dataset.listenersAttached) {
    if (metricModalOverlay) {
      metricModalOverlay.addEventListener('click', closeMetricModal);
    }
    if (metricModalClose) {
      metricModalClose.addEventListener('click', closeMetricModal);
    }
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeMetricModal();
    });
    metricModal.dataset.listenersAttached = 'true';
  }
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
  renderSummaryCard(data);
}

function renderSummaryCard(data) {
  if (!summaryCard || !summaryTicker || !summaryPrice || !summaryPrediction) return;

  summaryTicker.textContent = data.ticker || 'N/A';
  summaryPrice.textContent = fmt(data.metrics_analysis.current_price, { currency: true });
  const prediction = data.overall_recommendation || 'N/A';
  summaryPrediction.textContent = prediction;
  const predictionClass = prediction.toLowerCase().replace(/\s+/g, '-');
  summaryPrediction.className = `prediction-pill ${predictionClass}`;
  summaryCard.dataset.populated = 'true';
  initializeSummaryCardObserver();
}

function setSummaryCardVisible(visible) {
  if (!summaryCard) return;

  summaryCardShouldBeVisible = Boolean(visible);

  if (summaryHideTimer) {
    clearTimeout(summaryHideTimer);
    summaryHideTimer = null;
  }

  if (summaryCardShouldBeVisible) {
    // If the card was display:none, first render it in the faded state,
    // force that style to apply, then remove the faded class so CSS can animate in.
    if (summaryCard.classList.contains('hidden')) {
      summaryCard.classList.add('faded-out');
      summaryCard.classList.remove('hidden');
      void summaryCard.offsetHeight; // force reflow for reliable fade-in
    }

    requestAnimationFrame(() => {
      if (summaryCardShouldBeVisible) {
        summaryCard.classList.remove('faded-out');
        summaryCard.setAttribute('aria-hidden', 'false');
      }
    });
    return;
  }

  summaryCard.setAttribute('aria-hidden', 'true');

  if (summaryCard.classList.contains('hidden')) return;

  summaryCard.classList.add('faded-out');

  // Use a guarded timeout instead of transitionend. This avoids race conditions
  // where a pending fade-out transition can hide the card after it was shown again.
  summaryHideTimer = setTimeout(() => {
    if (!summaryCardShouldBeVisible && summaryCard.classList.contains('faded-out')) {
      summaryCard.classList.add('hidden');
    }
    summaryHideTimer = null;
  }, 380);
}

function updateSummaryCardVisibility() {
  if (!summaryCard) return;

  if (summaryCard.dataset.populated !== 'true' || dashboard.classList.contains('hidden')) {
    setSummaryCardVisible(false);
    return;
  }

  const headline = document.querySelector('.headline-card');
  if (!headline) {
    setSummaryCardVisible(false);
    return;
  }

  const headerHeight = document.querySelector('.site-header')?.offsetHeight || 0;
  const revealPoint = headerHeight + 12;
  const headlineRect = headline.getBoundingClientRect();

  // Show the fixed summary as soon as the main headline recommendation card
  // has scrolled past the sticky header area. This works even with fast scrolls,
  // unlike the old IntersectionObserver setup that could miss state changes
  // while the dashboard was hidden or during programmatic smooth scrolling.
  setSummaryCardVisible(headlineRect.bottom <= revealPoint);
}

function scheduleSummaryCardUpdate() {
  if (summaryCardScrollRaf) return;

  summaryCardScrollRaf = requestAnimationFrame(() => {
    summaryCardScrollRaf = null;
    updateSummaryCardVisibility();
  });
}

function initializeSummaryCardObserver() {
  if (!summaryCard) return;

  if (summaryCard.summaryObserver) {
    summaryCard.summaryObserver.disconnect();
    summaryCard.summaryObserver = null;
  }

  if (!summaryCardListenersAttached) {
    window.addEventListener('scroll', scheduleSummaryCardUpdate, { passive: true });
    window.addEventListener('resize', scheduleSummaryCardUpdate);
    window.addEventListener('orientationchange', scheduleSummaryCardUpdate);
    summaryCardListenersAttached = true;
  }

  scheduleSummaryCardUpdate();
  setTimeout(scheduleSummaryCardUpdate, 50);
  setTimeout(scheduleSummaryCardUpdate, 350);
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
    <button type="button" class="metric-card ${c.cls}" data-metric-label="${c.label}">
      <span class="metric-label">${c.label}</span>
      <span class="metric-value">${c.value}</span>
      ${c.tag ? `<span class="metric-tag ${c.tag}">${c.tag}</span>` : ''}
      ${c.sub || ''}
    </button>
  `).join('');
  attachMetricModalListeners();
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

function getPeerMetrics() {
  return [
    { key: 'current_price', label: 'CURRENT PRICE', type: 'currency' },
    { key: 'market_cap_millions', label: 'MARKET CAP', type: 'market_cap' },
    { key: 'ebitda', label: 'EBITDA (TTM)', type: 'large' },
    { key: 'pe', label: 'P/E RATIO', type: 'multiple' },
    { key: 'ps', label: 'P/S RATIO', type: 'multiple' },
    { key: 'ev', label: 'EV / EBITDA', type: 'multiple' },
    { key: 'dcf_intrinsic_value', label: 'DCF INTRINSIC VALUE', type: 'currency' },
    { key: 'week_52_high', label: '52-WEEK HIGH', type: 'currency' },
    { key: 'week_52_low', label: '52-WEEK LOW', type: 'currency' },
    { key: 'beta', label: 'BETA', type: 'beta' },
    { key: 'revenue_growth_ttm', label: 'REVENUE GROWTH (TTM)', type: 'pct' },
    { key: 'net_margin_ttm', label: 'NET MARGIN (TTM)', type: 'pct' },
    { key: 'roe_ttm', label: 'ROE (TTM)', type: 'pct' }
  ];
}

function formatPeerValue(key, value) {
  if (value === null || value === undefined || value === 'N/A') return 'N/A';
  const num = Number(value);
  if (isNaN(num)) return 'N/A';

  const metric = getPeerMetrics().find(m => m.key === key);
  if (!metric) return String(value);

  switch (metric.type) {
    case 'currency':
      return fmt(num, { currency: true });
    case 'market_cap':
      return fmt(num * 1e6, { large: true });
    case 'large':
      return fmt(num, { large: true });
    case 'multiple':
      return num.toFixed(1) + 'x';
    case 'pct':
      return fmt(num, { pct: true });
    case 'beta':
      return num.toFixed(2);
    default:
      return String(value);
  }
}

function renderPeerMetricFilters() {
  const dropdown = $('peerMetricsDropdown');
  if (!dropdown) return;
  const metrics = getPeerMetrics();

  dropdown.innerHTML = metrics.map(metric => `
    <label class="filter-checkbox dropdown-item">
      <input type="checkbox" data-metric="${metric.key}" checked />
      <span class="checkbox-label">${metric.label}</span>
    </label>
  `).join('');

  attachPeerFilterListeners();
  updatePeerDropdownButtonLabel();
}

function attachPeerFilterListeners() {
  const dropdown = $('peerMetricsDropdown');
  const toggle = $('peerMetricsToggle');
  const items = dropdown ? dropdown.querySelectorAll('input[type="checkbox"]') : [];

  items.forEach(checkbox => {
    checkbox.removeEventListener('change', handlePeerFilterChange);
    checkbox.addEventListener('change', handlePeerFilterChange);
  });

  if (toggle) {
    toggle.removeEventListener('click', handlePeerDropdownToggle);
    toggle.addEventListener('click', handlePeerDropdownToggle);
  }

  document.removeEventListener('click', handleDocumentClickForPeerDropdown);
  document.addEventListener('click', handleDocumentClickForPeerDropdown);
}

function handlePeerDropdownToggle(event) {
  event.stopPropagation();
  const dropdown = $('peerMetricsDropdown');
  const toggle = $('peerMetricsToggle');
  if (!dropdown || !toggle) return;

  const expanded = dropdown.classList.toggle('hidden') === false;
  toggle.setAttribute('aria-expanded', String(expanded));
}

function handleDocumentClickForPeerDropdown(event) {
  const dropdown = $('peerMetricsDropdown');
  const toggle = $('peerMetricsToggle');
  if (!dropdown || !toggle) return;
  if (!dropdown.contains(event.target) && !toggle.contains(event.target)) {
    dropdown.classList.add('hidden');
    toggle.setAttribute('aria-expanded', 'false');
  }
}

function updatePeerDropdownButtonLabel() {
  const toggle = $('peerMetricsToggle');
  const dropdown = $('peerMetricsDropdown');
  if (!toggle || !dropdown) return;

  const selected = Array.from(dropdown.querySelectorAll('input[type="checkbox"]:checked'))
    .map(input => input.nextElementSibling?.textContent?.trim())
    .filter(Boolean);

  const labelText = selected.length > 0
    ? `${selected.length} metric${selected.length === 1 ? '' : 's'} selected`
    : 'Choose peer metrics';

  toggle.querySelector('.dropdown-label').textContent = labelText;
}

function handlePeerFilterChange() {
  const dropdown = $('peerMetricsDropdown');
  if (!dropdown) return;

  const selectedMetrics = Array.from(dropdown.querySelectorAll('input[type="checkbox"]:checked'))
    .map(input => input.dataset.metric);

  getPeerMetrics().forEach(metric => {
    const show = selectedMetrics.includes(metric.key);
    const selector = `.peer-table th[data-metric="${metric.key}"], .peer-table td[data-metric="${metric.key}"]`;
    document.querySelectorAll(selector).forEach(cell => {
      cell.classList.toggle('hidden', !show);
    });
  });

  updatePeerDropdownButtonLabel();
}

function renderPeers(data) {
  const m = data.metrics_analysis;
  const peers = m.peers || [];

  if (peers.length === 0) {
    $('peerSection').classList.add('hidden');
    return;
  }
  $('peerSection').classList.remove('hidden');

  renderPeerMetricFilters();

  const metrics = getPeerMetrics();
  const avg = (key) => {
    const vals = peers
      .map(p => p[key])
      .filter(v => v !== 'N/A' && v !== null && !isNaN(v) && Number(v) > 0)
      .map(Number);
    return vals.length ? (vals.reduce((a,b) => a+b, 0) / vals.length) : null;
  };

  const subjectValue = (key) => {
    if (key === 'pe') return m.pe_ratio.value;
    if (key === 'ps') return m.ps_ratio.value;
    if (key === 'ev') return m.ev_ebitda.value;
    return m[key] ?? 'N/A';
  };

  const peerRows = peers.map(peer => `
    <tr>
      <td>${peer.symbol}</td>
      ${metrics.map(metric => `
        <td class="num-col" data-metric="${metric.key}">${formatPeerValue(metric.key, peer[metric.key])}</td>
      `).join('')}
      <td>—</td>
    </tr>
  `).join('');

  const avgRow = `
    <tr class="avg-row">
      <td>PEER AVG</td>
      ${metrics.map(metric => `
        <td class="num-col" data-metric="${metric.key}">${formatPeerValue(metric.key, avg(metric.key))}</td>
      `).join('')}
      <td>—</td>
    </tr>
  `;

  const subjectRow = `
    <tr class="subject-row">
      <td>${data.ticker} ◈</td>
      ${metrics.map(metric => `
        <td class="num-col" data-metric="${metric.key}">${formatPeerValue(metric.key, subjectValue(metric.key))}</td>
      `).join('')}
      <td>${formatPeerValue('pe', subjectValue('pe')) === 'N/A' ? '<span class="vs-inline">—</span>' : '<span class="vs-inline">≈ in line</span>'}</td>
    </tr>
  `;

  $('peerTableBody').innerHTML = peerRows + avgRow + subjectRow;
  $('peerSummaryText').textContent = m.peer_evaluation_summary;
  handlePeerFilterChange();
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
  initializeSummaryCardObserver();
  // Smooth scroll to dashboard and account for the sticky site header
  const headerHeight = document.querySelector('.site-header')?.offsetHeight || 0;
  const targetTop = window.pageYOffset + dashboard.getBoundingClientRect().top - headerHeight - 16;
  window.scrollTo({ top: Math.max(targetTop, 0), behavior: 'smooth' });
  scheduleSummaryCardUpdate();
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

if (logo) {
  logo.addEventListener('click', () => {
    showLanding();
    tickerInput.value = '';
    tickerInput.focus();
  });
}

$('errorRetry').addEventListener('click', () => {
  if (lastTicker) analyze(lastTicker);
  else showLanding();
});

// ── Initial state ─────────────────────────────────────────
showLanding();
tickerInput.focus();