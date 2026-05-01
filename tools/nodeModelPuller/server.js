const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 3700;
const OUT_DIR = path.join(__dirname, 'output');

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);

// Build a set of hashes from files already on disk so dedup survives restarts
const seen = new Set(
  fs.readdirSync(OUT_DIR)
    .filter(f => f.endsWith('.glb'))
    .map(f => f.replace(/^model_[^_]+_([0-9a-f]+)\.glb$/, '$1'))
    .filter(h => h.length === 8)
);

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/save') {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);

      if (seen.has(hash)) {
        console.log(`Duplicate (${hash}), skipping`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, duplicate: true, hash }));
        return;
      }

      seen.add(hash);
      const filename = `model_${Date.now()}_${hash}.glb`;
      const filepath = path.join(OUT_DIR, filename);
      fs.writeFileSync(filepath, buf);
      console.log(`Saved ${buf.length} bytes → ${filepath} (${hash})`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, duplicate: false, hash, file: filename, bytes: buf.length }));
    });
    req.on('error', err => {
      console.error('Request error:', err);
      res.writeHead(500);
      res.end('error');
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT}`);
  console.log(`Known hashes from disk: ${seen.size}`);
});
