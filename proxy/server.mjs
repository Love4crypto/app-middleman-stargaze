import express from 'express';

const TARGET = 'https://constellations-api.mainnet.stargaze-apis.com/graphql';
const app = express();

// Accept JSON even if content-type has charset, etc.
app.use(express.json({ limit: '1mb', type: '*/*' }));

// Allow your app origins (add more if needed)
const ALLOWED = new Set([
  'https://app.usemiddleman.xyz',
  'http://localhost:5173',
  'http://127.0.0.1:5173'
]);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (ALLOWED.has(origin) || process.env.CORS_ANY === '1')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Handle both GET (?query&variables=...) and POST {query, variables}
app.all('/graphql', async (req, res) => {
  try {
    let query, variables;

    if (req.method === 'GET') {
      query = req.query.query;
      const v = req.query.variables;
      if (typeof v === 'string' && v.length) {
        try { variables = JSON.parse(v); } catch { variables = undefined; }
      }
    } else {
      ({ query, variables } = req.body || {});
      if (typeof variables === 'string') {
        try { variables = JSON.parse(variables); } catch { /* leave as string */ }
      }
    }

    if (!query) return res.status(400).json({ errors: [{ message: 'Missing GraphQL query' }] });

    // Always send variables (at least empty object)
    const payload = { query, variables: variables ?? {} };

    const r = await fetch(TARGET, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const text = await r.text();
    res.status(r.status);
    res.type(r.headers.get('content-type') || 'application/json');
    res.send(text);
  } catch (err) {
    res.status(502).json({ errors: [{ message: 'Proxy error: ' + (err?.message || String(err)) }] });
  }
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log('GQL proxy listening on', port));
