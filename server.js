require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Validate API key at startup ───────────────────────────────────────────────
const API_KEY = process.env.fin_secret;
if (!API_KEY || API_KEY.trim() === '') {
  console.error('\n❌  FATAL: fin_secret is missing or empty in your .env file.');
  console.error('   Open .env and paste your Finnhub API key after the equals sign.');
  console.error('   Example:  fin_secret=your_key_here\n');
  process.exit(1);
}

const FINNHUB_BASE = 'https://finnhub.io/api/v1';
const FINNHUB_HEADERS = { 'X-Finnhub-Token': API_KEY };

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Rate-limit the analysis endpoint so one user can't exhaust Finnhub quota
const analysisLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Too many requests — please wait a minute before retrying.' }
});

// ── Finnhub helpers ───────────────────────────────────────────────────────────
async function finnhub(endpoint, params = {}) {
  try {
    const response = await axios.get(`${FINNHUB_BASE}${endpoint}`, {
      headers: FINNHUB_HEADERS,
      params,
      timeout: 10000
    });
    return { data: response.data, error: null };
  } catch (err) {
    const status = err.response?.status;
    if (status === 401 || status === 403) {
      return { data: null, error: 'API_KEY_INVALID' };
    }
    if (status === 429) {
      return { data: null, error: 'RATE_LIMITED' };
    }
    return { data: null, error: err.message || 'FETCH_FAILED' };
  }
}

// Small delay to respect Finnhub free-tier rate limits
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function safeGet(obj, ...keys) {
  return keys.reduce((acc, key) => {
    if (acc == null) return null;
    return acc[key] !== undefined ? acc[key] : null;
  }, obj);
}

function numOrNA(val) {
  if (val === null || val === undefined || val === '' || isNaN(val)) return 'N/A';
  return Number(val);
}

// ── Valuation logic ───────────────────────────────────────────────────────────

function assessPE(pe, peerAvgPE) {
  if (pe === null || pe === 'N/A') return 'N/A';
  const p = Number(pe);
  if (isNaN(p) || p < 0) return 'N/A';
  // Use peer avg if available, otherwise rule-of-thumb bands
  if (peerAvgPE && peerAvgPE !== 'N/A') {
    const avg = Number(peerAvgPE);
    if (p < avg * 0.85) return 'UNDERVALUED';
    if (p > avg * 1.15) return 'OVERVALUED';
    return 'FAIR';
  }
  if (p < 15) return 'UNDERVALUED';
  if (p > 30) return 'OVERVALUED';
  return 'FAIR';
}

function assessPS(ps, peerAvgPS) {
  if (ps === null || ps === 'N/A') return 'N/A';
  const p = Number(ps);
  if (isNaN(p) || p < 0) return 'N/A';
  if (peerAvgPS && peerAvgPS !== 'N/A') {
    const avg = Number(peerAvgPS);
    if (p < avg * 0.85) return 'UNDERVALUED';
    if (p > avg * 1.15) return 'OVERVALUED';
    return 'FAIR';
  }
  if (p < 2) return 'UNDERVALUED';
  if (p > 8) return 'OVERVALUED';
  return 'FAIR';
}

function assessEVEBITDA(ev, peerAvgEV) {
  if (ev === null || ev === 'N/A') return 'N/A';
  const e = Number(ev);
  if (isNaN(e) || e < 0) return 'N/A';
  if (peerAvgEV && peerAvgEV !== 'N/A') {
    const avg = Number(peerAvgEV);
    if (e < avg * 0.85) return 'UNDERVALUED';
    if (e > avg * 1.15) return 'OVERVALUED';
    return 'FAIR';
  }
  if (e < 10) return 'UNDERVALUED';
  if (e > 20) return 'OVERVALUED';
  return 'FAIR';
}

function computeDCF({ fcf, fcfGrowthRate, wacc, terminalGrowth, sharesOutstanding }) {
  // Conservative 10-year DCF
  if (!fcf || fcf <= 0 || !sharesOutstanding || sharesOutstanding <= 0) return null;
  const years = 10;
  let presentValue = 0;
  let cashFlow = fcf;
  for (let i = 1; i <= years; i++) {
    cashFlow *= (1 + fcfGrowthRate);
    presentValue += cashFlow / Math.pow(1 + wacc, i);
  }
  // Terminal value
  const terminalValue = (cashFlow * (1 + terminalGrowth)) / (wacc - terminalGrowth);
  const pvTerminal = terminalValue / Math.pow(1 + wacc, years);
  const totalValue = presentValue + pvTerminal;
  return totalValue / sharesOutstanding;
}

function deriveTarget(dcfValue, currentPrice) {
  if (!dcfValue || dcfValue === 'N/A') return 'N/A';
  // 12m target = blend of DCF (60%) and current price (40%) to stay conservative
  return Math.round((dcfValue * 0.6 + currentPrice * 0.4) * 100) / 100;
}

function buildRecommendation(signals) {
  // signals: array of 'UNDERVALUED' | 'FAIR' | 'OVERVALUED' | 'N/A'
  const valid = signals.filter((s) => s !== 'N/A');
  if (valid.length === 0) return { rec: 'HOLD', confidence: 20 };
  const under = valid.filter((s) => s === 'UNDERVALUED').length;
  const over = valid.filter((s) => s === 'OVERVALUED').length;
  const fair = valid.filter((s) => s === 'FAIR').length;
  const total = valid.length;
  const dataCoverage = total / signals.length; // 0–1

  let rec, rawConf;
  if (under > over && under > fair) {
    rec = 'BUY';
    rawConf = (under / total) * 100;
  } else if (over > under && over > fair) {
    rec = 'SELL';
    rawConf = (over / total) * 100;
  } else {
    rec = 'HOLD';
    rawConf = ((fair + Math.min(under, over)) / total) * 100;
  }

  // Scale down by data coverage
  const confidence = Math.round(rawConf * dataCoverage);
  return { rec, confidence: Math.max(10, Math.min(confidence, 92)) };
}

function peerSummary(ticker, pe, ps, ev, peers) {
  if (!peers || peers.length === 0) return 'No peer data available for comparison.';
  const validPE = peers.filter((p) => p.pe && p.pe !== 'N/A').map((p) => p.pe);
  const validPS = peers.filter((p) => p.ps && p.ps !== 'N/A').map((p) => p.ps);
  const validEV = peers.filter((p) => p.ev && p.ev !== 'N/A').map((p) => p.ev);
  const avg = (arr) => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : 'N/A';
  const avgPE = avg(validPE);
  const avgPS = avg(validPS);
  const avgEV = avg(validEV);
  const peerNames = peers.map((p) => p.symbol).join(', ');

  let lines = [`Peers analyzed: ${peerNames}.`];
  lines.push(`Peer avg — P/E: ${avgPE} | P/S: ${avgPS} | EV/EBITDA: ${avgEV}.`);

  const cmp = (val, avg, label) => {
    if (val === 'N/A' || avg === 'N/A') return null;
    const diff = (((val - avg) / avg) * 100).toFixed(0);
    const dir = val < avg ? 'discount' : 'premium';
    return `${ticker} trades at a ${Math.abs(diff)}% ${dir} to peer avg on ${label}.`;
  };
  [
    cmp(pe, avgPE, 'P/E'),
    cmp(ps, avgPS, 'P/S'),
    cmp(ev, avgEV, 'EV/EBITDA')
  ].forEach((l) => l && lines.push(l));

  return lines.join(' ');
}

function buildOutlook({ beta, week52High, week52Low, currentPrice, dcfValue, pe, revenueGrowth, netMargin, roe, ev, ticker }) {
  const beta_ = beta !== 'N/A' ? `Beta of ${beta} implies ${beta > 1.5 ? 'elevated' : beta > 1 ? 'moderate' : 'below-market'} daily price volatility.` : 'Beta unavailable.';
  const support = week52Low !== 'N/A' ? `52-week range: $${week52Low}–$${week52High}. Current price ($${currentPrice}) sits ${(((currentPrice - week52Low) / (week52High - week52Low)) * 100).toFixed(0)}% through that band.` : '52-week range unavailable.';

  const dcfGap = dcfValue && dcfValue !== 'N/A' && currentPrice
    ? `DCF intrinsic value of $${dcfValue.toFixed(2)} implies a ${(((dcfValue - currentPrice) / currentPrice) * 100).toFixed(0)}% ${dcfValue > currentPrice ? 'upside' : 'downside'} to current price.`
    : 'DCF comparison unavailable.';

  const peCtx = pe !== 'N/A' ? `P/E of ${pe}x ${pe < 15 ? 'is below the broad-market rule-of-thumb (15x), a potential value signal' : pe > 30 ? 'is above 30x, pricing in significant growth expectations' : 'sits in a fair-value band'}.` : '';

  const growthCtx = revenueGrowth !== 'N/A' ? `Revenue growth (TTM): ${(revenueGrowth * 100).toFixed(1)}%.` : '';
  const marginCtx = netMargin !== 'N/A' ? `Net margin: ${(netMargin * 100).toFixed(1)}%.` : '';
  const roeCtx = roe !== 'N/A' ? `ROE: ${(roe * 100).toFixed(1)}%.` : '';

  return {
    next_few_days: `Technical positioning context only — not a price call. ${beta_} ${support} Use these bands to gauge near-term risk exposure, not direction.`,
    next_few_weeks: `No earnings catalyst calendar is embedded in this data feed. Valuation backdrop: ${peCtx} Monitor upcoming macro releases (CPI, Fed decisions) that affect discount rates broadly. If an earnings date is known, volatility typically compresses afterward.`,
    next_few_months: `Fundamental trend context. ${growthCtx} ${marginCtx} ${roeCtx} Improving margins and positive revenue growth are constructive; deteriorating margins in a high-multiple stock are a risk factor. Sector cyclicality should be weighed against macro conditions.`,
    next_few_years: `Long-term anchor. ${dcfGap} The DCF output is model-dependent — treat it as a directional signal, not a price target. A sustained discount to intrinsic value, combined with a durable competitive moat and re-investable free cash flow, would support a constructive multi-year view. Risks include multiple compression in a rising-rate environment and competitive disruption.`
  };
}

function buildThesis({ ticker, rec, pe, ps, ev, dcfValue, currentPrice, peerSummaryStr, revenueGrowth, netMargin, roe, beta }) {
  const sign = dcfValue && dcfValue !== 'N/A' && currentPrice
    ? `DCF analysis places intrinsic value at **$${Number(dcfValue).toFixed(2)}**, representing a **${(((dcfValue - currentPrice) / currentPrice) * 100).toFixed(0)}%** ${dcfValue > currentPrice ? 'discount to intrinsic value (bullish skew)' : 'premium to intrinsic value (bearish skew)'}.`
    : 'DCF estimate is unavailable due to insufficient free-cash-flow data.';

  const recLine = rec === 'BUY'
    ? 'The composite multi-metric read leans **undervalued** at current levels.'
    : rec === 'SELL'
      ? 'The composite multi-metric read leans **overvalued** at current levels.'
      : 'The composite multi-metric read suggests **fair value** at current levels.';

  return `## ${ticker} — ${rec} Thesis\n\n${recLine} ${sign}\n\n**Peer context:** ${peerSummaryStr}\n\n**Key metrics:** P/E ${pe}x | P/S ${ps}x | EV/EBITDA ${ev}x | Revenue growth ${revenueGrowth !== 'N/A' ? (revenueGrowth * 100).toFixed(1) + '%' : 'N/A'} | Net margin ${netMargin !== 'N/A' ? (netMargin * 100).toFixed(1) + '%' : 'N/A'} | ROE ${roe !== 'N/A' ? (roe * 100).toFixed(1) + '%' : 'N/A'}\n\n**Risks:** Model confidence is bounded by data completeness. DCF outputs are sensitive to FCF growth and WACC assumptions — small changes produce large swings in intrinsic value. High beta (${beta}) amplifies both upside capture and drawdown risk. This thesis is a snapshot of current metrics; conditions change.\n\n**Rewards (if BUY):** A persistent discount to DCF intrinsic value, positive revenue growth, and healthy free cash flow conversion would support re-rating toward fair value over time.\n\n---\n*This is a valuation snapshot grounded in current metrics — not a prediction of future price — and is not financial advice.*`;
}

// ── Main analysis endpoint ────────────────────────────────────────────────────
app.get('/api/analyze/:ticker', analysisLimiter, async (req, res) => {
  const ticker = req.params.ticker.toUpperCase().trim();
  if (!ticker || ticker.length > 10) {
    return res.status(400).json({ error: 'Invalid ticker symbol.' });
  }

  // ── Fetch core data (parallel where safe) ────────────────────────────────
  const [quoteRes, profileRes, metricsRes, peersRes] = await Promise.all([
    finnhub('/quote', { symbol: ticker }),
    finnhub('/stock/profile2', { symbol: ticker }),
    finnhub('/stock/metric', { symbol: ticker, metric: 'all' }),
    finnhub('/stock/peers', { symbol: ticker })
  ]);

  // Hard-fail only on API key issues
  for (const r of [quoteRes, profileRes, metricsRes]) {
    if (r.error === 'API_KEY_INVALID') {
      return res.status(401).json({ error: 'Finnhub rejected your API key. Check fin_secret in .env.' });
    }
  }

  const quote = quoteRes.data;
  const profile = profileRes.data;
  const metrics = metricsRes.data?.metric || {};

  // Validate that we got a real ticker back
  if (!profile || !profile.name) {
    return res.status(404).json({ error: `No company data found for ticker "${ticker}". Check the symbol and try again.` });
  }

  const currentPrice = numOrNA(safeGet(quote, 'c'));
  const marketCap = numOrNA(safeGet(profile, 'marketCapitalization')); // in millions
  const sharesOutstanding = numOrNA(safeGet(profile, 'shareOutstanding')); // in millions

  const pe = numOrNA(safeGet(metrics, 'peTTM'));
  const ps = numOrNA(safeGet(metrics, 'psTTM'));
  const ev = numOrNA(safeGet(metrics, 'evEbitdaTTM') ?? safeGet(metrics, 'enterpriseValueEbitdaTTM'));
  const ebitda = numOrNA(safeGet(metrics, 'ebitdaPerShareTTM') !== null
    ? null  // don't use per-share; look for absolute below
    : null);

  // EBITDA absolute — Finnhub metric key varies; try multiple
  const ebitdaAbs = (() => {
    const candidates = ['ebitdaPerShareTTM', 'ebitda', 'EBITDA'];
    // Per-share * shares gives absolute
    const eps = safeGet(metrics, 'ebitdaPerShareTTM');
    if (eps && sharesOutstanding !== 'N/A') {
      return numOrNA(eps * sharesOutstanding * 1e6); // shares in millions
    }
    return 'N/A';
  })();

  const beta = numOrNA(safeGet(metrics, 'beta'));
  const week52High = numOrNA(safeGet(metrics, '52WeekHigh'));
  const week52Low = numOrNA(safeGet(metrics, '52WeekLow'));
  const revenueGrowth = numOrNA(safeGet(metrics, 'revenueGrowthTTMYoy'));
  const netMargin = numOrNA(safeGet(metrics, 'netProfitMarginTTM') ?? safeGet(metrics, 'netMarginTTM'));
  const roe = numOrNA(safeGet(metrics, 'roeTTM'));
  const fcf = (() => {
    // Prefer absolute FCF; Finnhub often gives per-share
    const fcfPS = safeGet(metrics, 'freeCashFlowPerShareTTM');
    if (fcfPS && sharesOutstanding !== 'N/A') {
      return fcfPS * sharesOutstanding * 1e6;
    }
    return null;
  })();

  // ── Peers ────────────────────────────────────────────────────────────────
  let peerMetrics = [];
  if (!peersRes.error && Array.isArray(peersRes.data)) {
    const peerSymbols = peersRes.data.filter((s) => s !== ticker).slice(0, 5);
    for (const sym of peerSymbols) {
      await sleep(300); // pace to avoid rate limit
      const pRes = await finnhub('/stock/metric', { symbol: sym, metric: 'all' });
      if (!pRes.error && pRes.data?.metric) {
        const m = pRes.data.metric;
        peerMetrics.push({
          symbol: sym,
          pe: numOrNA(safeGet(m, 'peTTM')),
          ps: numOrNA(safeGet(m, 'psTTM')),
          ev: numOrNA(safeGet(m, 'evEbitdaTTM') ?? safeGet(m, 'enterpriseValueEbitdaTTM'))
        });
      }
    }
  }

  // Peer averages
  const peerAvg = (key) => {
    const vals = peerMetrics.map((p) => p[key]).filter((v) => v !== 'N/A' && v > 0);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const peerAvgPE = peerAvg('pe');
  const peerAvgPS = peerAvg('ps');
  const peerAvgEV = peerAvg('ev');

  // ── Assessments ──────────────────────────────────────────────────────────
  const peAssessment = assessPE(pe !== 'N/A' ? pe : null, peerAvgPE);
  const psAssessment = assessPS(ps !== 'N/A' ? ps : null, peerAvgPS);
  const evAssessment = assessEVEBITDA(ev !== 'N/A' ? ev : null, peerAvgEV);

  // ── DCF ─────────────────────────────────────────────────────────────────
  // Conservative assumptions — stated explicitly
  const fcfGrowthRate = revenueGrowth !== 'N/A' ? Math.min(Math.max(revenueGrowth * 0.7, 0.02), 0.15) : 0.05;
  const wacc = 0.10; // 10% WACC — standard conservative assumption
  const terminalGrowth = 0.025; // 2.5% terminal growth
  const dcfRaw = computeDCF({
    fcf,
    fcfGrowthRate,
    wacc,
    terminalGrowth,
    sharesOutstanding: sharesOutstanding !== 'N/A' ? sharesOutstanding * 1e6 : null
  });
  const dcfValue = dcfRaw ? Math.round(dcfRaw * 100) / 100 : 'N/A';
  const dcfAssessment = dcfValue !== 'N/A' && currentPrice !== 'N/A'
    ? (dcfValue > currentPrice * 1.15 ? 'UNDERVALUED' : dcfValue < currentPrice * 0.85 ? 'OVERVALUED' : 'FAIR')
    : 'N/A';

  // ── Recommendation ───────────────────────────────────────────────────────
  const signals = [peAssessment, psAssessment, evAssessment, dcfAssessment];
  const { rec, confidence } = buildRecommendation(signals);
  const target12m = currentPrice !== 'N/A' ? deriveTarget(dcfValue !== 'N/A' ? dcfValue : null, currentPrice) : 'N/A';

  // ── Strings ──────────────────────────────────────────────────────────────
  const peerSummaryStr = peerSummary(ticker, pe, ps, ev, peerMetrics);
  const outlook = buildOutlook({
    beta, week52High, week52Low, currentPrice,
    dcfValue: dcfValue !== 'N/A' ? dcfValue : null,
    pe, revenueGrowth, netMargin, roe, ev, ticker
  });
  const thesis = buildThesis({
    ticker, rec, pe, ps, ev,
    dcfValue: dcfValue !== 'N/A' ? dcfValue : null,
    currentPrice, peerSummaryStr, revenueGrowth, netMargin, roe, beta
  });

  // ── Response ─────────────────────────────────────────────────────────────
  const payload = {
    ticker,
    company_name: profile.name || ticker,
    overall_recommendation: rec,
    confidence_score: `${confidence}%`,
    target_price_12m: target12m,
    dcf_assumptions: {
      fcf_growth_rate: `${(fcfGrowthRate * 100).toFixed(1)}% (derived from TTM revenue growth × 0.7, capped 2–15%)`,
      wacc: '10.0% (conservative standard)',
      terminal_growth: '2.5%',
      projection_years: 10
    },
    metrics_analysis: {
      current_price: currentPrice,
      ebitda: ebitdaAbs,
      market_cap_millions: marketCap,
      pe_ratio: { value: pe, assessment: peAssessment },
      ps_ratio: { value: ps, assessment: psAssessment },
      ev_ebitda: { value: ev, assessment: evAssessment },
      dcf_intrinsic_value: dcfValue,
      week_52_high: week52High,
      week_52_low: week52Low,
      beta,
      revenue_growth_ttm: revenueGrowth,
      net_margin_ttm: netMargin,
      roe_ttm: roe,
      peer_evaluation_summary: peerSummaryStr,
      peers: peerMetrics
    },
    market_predictions: outlook,
    investment_thesis: thesis
  };

  res.json(payload);
});

// ── Serve SPA for all other routes ───────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n✅  Stock Analyzer running at http://localhost:${PORT}`);
  console.log(`   Finnhub key loaded: ${API_KEY.slice(0, 4)}${'*'.repeat(Math.max(0, API_KEY.length - 4))}\n`);
});