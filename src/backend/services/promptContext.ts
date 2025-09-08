import path from 'path';
import fs from 'fs/promises';
import logger from './logger';
import { clampText, ContextPackName } from '../utils/prompt-helpers';

// Simple in-memory cache with TTL
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const fileCache = new Map<string, { ts: number; data: string }>();

async function readFileCached(p: string): Promise<string> {
  const now = Date.now();
  const cached = fileCache.get(p);
  if (cached && now - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }
  try {
    const data = await fs.readFile(p, 'utf8');
    fileCache.set(p, { ts: now, data });
    return data;
  } catch (e: any) {
    logger.warn('promptContext: readFileCached failed', { path: p, error: e?.message || String(e) });
    return '';
  }
}

export async function buildDocsLite(root: string): Promise<string> {
  const designPathA = path.join(root, 'DESIGN.md');
  const designPathB = path.join(root, 'Design.md');
  const examplePath = path.join(root, 'Example.md');
  const devDocPath = path.join(root, 'docs', 'DEVELOPER.md');
  const troubleshootingPath = path.join(root, 'docs', 'TROUBLESHOOTING.md');

  const [designA, designB, example, devDoc, troubleshooting] = await Promise.all([
    readFileCached(designPathA),
    readFileCached(designPathB),
    readFileCached(examplePath),
    readFileCached(devDocPath),
    readFileCached(troubleshootingPath),
  ]);

  const design = designA || designB;
  const sections: string[] = [];
  if (design) sections.push('=== DESIGN.md (excerpt) ===', clampText(design, 4000));
  if (example) sections.push('=== Example.md (excerpt) ===', clampText(example, 2500));
  if (devDoc) sections.push('=== docs/DEVELOPER.md (excerpt) ===', clampText(devDoc, 2000));
  if (troubleshooting) sections.push('=== docs/TROUBLESHOOTING.md (excerpt) ===', clampText(troubleshooting, 1500));
  return sections.join('\n\n');
}

export async function buildTypesLite(root: string): Promise<string> {
  const typesPath = path.join(root, 'src', 'shared', 'types.ts');
  const types = await readFileCached(typesPath);
  if (!types) return '';
  const lines = types.split('\n');
  const picked: string[] = [];
  for (let i = 0; i < lines.length && picked.join('\n').length < 1800; i++) {
    const l = lines[i];
    if (/^export\s+(interface|type|enum)\s+/.test(l)) {
      picked.push(l);
      let braceDepth = l.includes('{') ? 1 : 0;
      let j = i + 1;
      let count = 0;
      while (j < lines.length && count < 20 && (braceDepth > 0 || !/;\s*$/.test(lines[j - 1] || ''))) {
        const lj = lines[j];
        if (lj.includes('{')) braceDepth++;
        if (lj.includes('}')) braceDepth = Math.max(0, braceDepth - 1);
        picked.push(lj);
        j++;
        count++;
        if (braceDepth === 0 && /}\s*;?\s*$/.test(lj)) break;
      }
      i = j - 1;
      picked.push('');
    }
  }
  return ['=== Shared Types (selected exports) ===', clampText(picked.join('\n'), 2000)].filter(Boolean).join('\n');
}

export async function buildRoutesLite(root: string): Promise<string> {
  const routesDir = path.join(root, 'src', 'backend', 'routes');
  let entries: Array<{ method: string; path: string; file: string }> = [];
  try {
    const files = (await fs.readdir(routesDir)).filter(f => f.endsWith('.ts'));
    const contents = await Promise.all(files.map(f => readFileCached(path.join(routesDir, f))));
    contents.forEach((text, idx) => {
      const f = files[idx];
      if (!text) return;
      const regex = /app\.(get|post|put|delete)\(\s*['"]([^'\"]+)['"]/g;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(text))) {
        entries.push({ method: m[1].toUpperCase(), path: m[2], file: f });
      }
    });
  } catch (e: any) {
    logger.warn('promptContext: routes-lite scan failed', { dir: routesDir, error: e?.message || String(e) });
  }
  entries = entries.sort((a, b) => a.path.localeCompare(b.path)).slice(0, 80);
  const lines = entries.map(e => `${e.method} ${e.path} (${e.file})`);
  return ['=== Backend Routes (lite) ===', clampText(lines.join('\n'), 1500)].filter(Boolean).join('\n');
}

export async function buildExamples(root: string): Promise<string> {
  const dir = path.join(root, 'data', 'prompt-examples');
  try {
    const st = await fs.stat(dir);
    if (!st.isDirectory()) return '';
  } catch (e: any) {
    logger.warn('promptContext: examples dir stat failed', { dir, error: e?.message || String(e) });
    return '';
  }
  let files: string[] = [];
  try {
    files = (await fs.readdir(dir)).filter(f => f.endsWith('.md') || f.endsWith('.txt')).slice(0, 8);
  } catch (e: any) {
    logger.warn('promptContext: readdir examples failed', { dir, error: e?.message || String(e) });
    return '';
  }
  const chunks: string[] = [];
  await Promise.all(
    files.map(async (f) => {
      const text = await readFileCached(path.join(dir, f));
      if (text) chunks.push(`=== Example: ${f} ===\n` + clampText(text.trim(), 1200));
    })
  );
  return chunks.join('\n\n');
}

export function buildPolicies(): string {
  const bullets = [
    '- Actor-actionable only; use capabilities actually accessible to the actor.',
    '- No invented tools/APIs; Affordances are authoritative.',
    '- Keep prompts lean; avoid boilerplate disclaimers.',
    '- Use Markdown-style sections; no code fences.',
    '- Infra/meta only if actor-accessible and necessary.',
  ];
  return ['=== Prompt Policies ===', bullets.join('\n')].join('\n');
}

export async function buildSelectedPacks(root: string, finalPacks: ContextPackName[]): Promise<string> {
  const packOutputs: string[] = [];
  const include = async (name: ContextPackName, builder: () => Promise<string> | string) => {
    if (finalPacks.includes(name)) {
      const out = await builder();
      if (out) packOutputs.push(out);
    }
  };
  await include('docs-lite', () => buildDocsLite(root));
  await include('types-lite', () => buildTypesLite(root));
  await include('routes-lite', () => buildRoutesLite(root));
  await include('examples', () => buildExamples(root));
  await include('policies', () => buildPolicies());

  // Global cap to prevent bloat
  let merged = packOutputs.join('\n\n');
  const GLOBAL_CAP = 9000;
  if (merged.length > GLOBAL_CAP) merged = clampText(merged, GLOBAL_CAP);
  return merged;
}
