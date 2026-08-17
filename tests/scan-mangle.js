const fs = require('fs');
for (const f of ['client.js', 'package/lib/client.js']) {
  const src = fs.readFileSync(f, 'utf8');
  const re = /\b([A-Za-z0-9_$]+)r\('[a-z]/g;
  const hits = new Set();
  let m;
  while ((m = re.exec(src)) !== null) {
    const name = m[1] + 'r';
    if (name !== 'tr') hits.add(m[1] + 'r(');
  }
  console.log(f, '->', [...hits].join(' '));
}
