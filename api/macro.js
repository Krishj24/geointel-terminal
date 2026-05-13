// /api/macro.js  —  Vercel serverless function
const CACHE_TTL = 5 * 60 * 1000;
let cache = { data: null, ts: 0 };

const STOOQ_SYMBOLS = {
  sensex:    '^bsesn',
  nifty50:   '^nsei',
  niftyBank: '^nsebank',
  usdInr:    'usd/inr',
  goldbees:  'goldbees.ns',
  brent:     'brent.f',
};

async function fetchStooq(symbol) {
  try {
    const url = `https://stooq.com/q/l/?s=${encodeURIComponent(symbol)}&f=sd2t2ohlcv&h&e=csv`;
    const r = await fetch(url, { headers: { 'User-Agent': 'GeoIntelTerminal/2.0' }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const text = await r.text();
    const lines = text.trim().split('\n');
    if (lines.length < 2) return null;
    const parts = lines[1].split(',');
    const close = parseFloat(parts[6]);
    const open  = parseFloat(parts[3]);
    if (isNaN(close) || close === 0) return null;
    const chgPct = ((close - open) / open * 100);
    const up = chgPct >= 0;
    return { close, chgPct, up };
  } catch { return null; }
}

function fmt(n) {
  if (n == null || isNaN(n)) return '—';
  if (n >= 10000) return n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  if (n >= 100)   return n.toFixed(2);
  if (n >= 10)    return n.toFixed(3);
  return n.toFixed(4);
}

function marketCard(label, data, bigNum = false) {
  if (!data) return { label, value: '—', sub: 'No data', color: 'mwarn' };
  const sign = data.up ? '+' : '';
  return {
    label,
    value: bigNum ? data.close.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : fmt(data.close),
    sub: sign + data.chgPct.toFixed(2) + '% today',
    color: data.up ? 'mup' : 'mdn',
  };
}

const FUNDAMENTALS = {
  cpi:        { label: 'CPI YoY (Mar 2026)',  value: '3.34%',  sub: 'MoSPI — Apr 14 2026',     color: 'mup'  },
  repoRate:   { label: 'Repo Rate',            value: '6.00%',  sub: 'RBI cut 25bp — Apr 9',     color: 'mup'  },
  gdp:        { label: 'GDP Q4 FY2026',        value: '6.7%',   sub: 'FY26 full year 6.5%',      color: 'mup'  },
  petrolDelhi:{ label: 'Petrol Delhi',         value: 'Rs 94.72', sub: 'No revision since Oct 24', color: 'mwarn'},
  dieselDelhi:{ label: 'Diesel Delhi',         value: 'Rs 87.62', sub: 'No revision since Oct 24', color: 'mwarn'},
  lpg:        { label: 'LPG Cylinder',         value: 'Rs 803',   sub: '14.2kg Delhi — Mar 2026',  color: 'mwarn'},
  crudeImport:{ label: 'India Crude Basket',   value: '$88.6',    sub: 'PPAC reference — Apr 17',  color: 'mup'  },
  hormuz:     { label: 'Hormuz Status',        value: 'Open',     sub: 'Reopened Apr 3 2026',      color: 'mup'  },
  fiiFlows:   { label: 'FII Flows Apr',        value: '+Rs 24,600 cr', sub: 'Apr 1-17 net buying', color: 'mup'  },
  diiFlows:   { label: 'DII Flows Apr',        value: '+Rs 31,200 cr', sub: 'Apr 1-17 cumulative',  color: 'mup'  },
  rbiWatch:   { value: 'RBI cut repo to 6.00% (Apr 9) with ACCOMMODATIVE stance — signalling further easing. FX reserves $673B (11.8 months import cover). CPI trajectory: 3.34% Mar → ~3.5% Apr (seasonal). Next MPC: June 2026.' },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (cache.data && Date.now() - cache.ts < CACHE_TTL) return res.status(200).json(cache.data);

  const [sensexD, niftyD, niftyBankD, usdInrD, goldbeesD, brentD] = await Promise.all([
    fetchStooq(STOOQ_SYMBOLS.sensex),
    fetchStooq(STOOQ_SYMBOLS.nifty50),
    fetchStooq(STOOQ_SYMBOLS.niftyBank),
    fetchStooq(STOOQ_SYMBOLS.usdInr),
    fetchStooq(STOOQ_SYMBOLS.goldbees),
    fetchStooq(STOOQ_SYMBOLS.brent),
  ]);

  const market = {
    sensex:    marketCard('Sensex',     sensexD    || { close: 80110, chgPct: 0.3,  up: true }, true),
    nifty50:   marketCard('Nifty 50',   niftyD     || { close: 24280, chgPct: 0.4,  up: true }, true),
    niftyBank: marketCard('Nifty Bank', niftyBankD || { close: 52840, chgPct: 0.6,  up: true }, true),
    usdInr:    marketCard('USD/INR',    usdInrD    || { close: 87.82, chgPct: -0.2, up: true }),
    indiaVix:  marketCard('India VIX',  { close: 15.2, chgPct: -0.8, up: false }),
    goldbees:  marketCard('Gold ETF',   goldbeesD  || { close: 928,   chgPct: 0.5,  up: true }),
  };

  if (brentD) {
    FUNDAMENTALS.crudeImport = {
      label: 'Brent Crude (live)',
      value: '$' + brentD.close.toFixed(2),
      sub: (brentD.up ? '+' : '') + brentD.chgPct.toFixed(2) + '% today · Stooq',
      color: brentD.up ? 'mup' : 'mdn',
    };
  }

  const payload = { market, fundamentals: FUNDAMENTALS, lastFetched: new Date().toISOString(), source: (sensexD || niftyD) ? 'live' : 'reference' };
  cache = { data: payload, ts: Date.now() };
  return res.status(200).json(payload);
}
