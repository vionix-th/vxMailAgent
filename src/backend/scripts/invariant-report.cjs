#!/usr/bin/env node
/* Invariants ESLint report: focuses on invariants/* rules */
const { ESLint } = require('eslint');

(async () => {
  const eslint = new ESLint({ cwd: __dirname + '/..' });
  const results = await eslint.lintFiles(['**/*.ts']);
  const interesting = new Set([
    'invariants/no-defaults-for-required',
    'invariants/no-domain-object-literals',
    'invariants/no-any-into-domain',
  ]);

  const byRule = new Map();
  const byFile = new Map();
  let total = 0;

  for (const r of results) {
    const msgs = (r.messages || []).filter(m => interesting.has(m.ruleId));
    if (msgs.length === 0) continue;
    total += msgs.length;
    const fileAgg = byFile.get(r.filePath) || { count: 0, byRule: new Map() };
    fileAgg.count += msgs.length;
    for (const m of msgs) {
      byRule.set(m.ruleId, (byRule.get(m.ruleId) || 0) + 1);
      fileAgg.byRule.set(m.ruleId, (fileAgg.byRule.get(m.ruleId) || 0) + 1);
    }
    byFile.set(r.filePath, fileAgg);
  }

  const toPairs = (m) => Array.from(m.entries());
  const fmtNum = (n) => String(n).padStart(3, ' ');

  console.log('Invariant Lint Report');
  console.log('======================');
  console.log(`Total issues: ${total}`);
  console.log('By rule:');
  for (const [rule, count] of toPairs(byRule).sort((a,b)=>b[1]-a[1])) {
    console.log(`- ${rule}: ${count}`);
  }
  console.log('\nTop files:');
  for (const [file, agg] of toPairs(byFile).sort((a,b)=>b[1].count-a[1].count).slice(0, 20)) {
    const parts = toPairs(agg.byRule).sort((a,b)=>b[1]-a[1]).map(([r,c])=>`${r.split('/')[1]}:${c}`).join(', ');
    console.log(`${fmtNum(agg.count)}  ${file.replace(process.cwd() + '/', '')}  (${parts})`);
  }
  console.log('\nDone.');
})().catch((e) => { console.error(e); process.exit(1); });
