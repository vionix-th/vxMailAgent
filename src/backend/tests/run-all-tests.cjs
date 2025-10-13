#!/usr/bin/env node

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Test runner that executes all .cjs test files
const HARD_TIMEOUT_MS = Number(process.env.TEST_HARD_TIMEOUT_MS || 30000);

const {
  ensureBackendReady,
} = require('./lib/harness.cjs');
const {
  DEFAULT_TEST_ENV,
  applyTestEnvDefaults,
} = require('./lib/env.cjs');

applyTestEnvDefaults();

const DEFAULT_ENV = { ...DEFAULT_TEST_ENV };
const INCLUDE_LIVE = process.env.VX_TEST_INCLUDE_LIVE === 'true';
const TSC_TIMEOUT_MS = Number(process.env.TSC_TIMEOUT_MS || 120000);

async function runTypeScriptCheck() {
  if (process.env.VX_TEST_SKIP_TSC === 'true') {
    console.log('⏭️  Skipping TypeScript compile check (VX_TEST_SKIP_TSC=true)');
    return;
  }
  console.log('🛠️  Running TypeScript compile check (tsc --noEmit)...');
  const backendDir = path.join(__dirname, '..');
  const localTsc = path.join(backendDir, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
  const useLocal = fs.existsSync(localTsc);
  const cmd = useLocal ? localTsc : 'npx';
  const args = useLocal ? ['--noEmit'] : ['tsc', '--noEmit'];

  await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: backendDir,
      stdio: 'inherit',
      env: { ...process.env, ...DEFAULT_ENV },
    });
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      reject(new Error(`TypeScript compile check exceeded ${TSC_TIMEOUT_MS}ms`));
    }, TSC_TIMEOUT_MS);

    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`TypeScript compile check failed with exit code ${code}`));
      }
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  console.log('✅ TypeScript compile check passed');
}

async function runTest(testFile) {
  return new Promise((resolve) => {
    console.log(`\n🧪 Running ${path.basename(testFile)}...`);
    
    const child = spawn('node', ['--test', `--test-timeout=${HARD_TIMEOUT_MS}`, '--test-concurrency=1', testFile], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      cwd: __dirname,
      detached: true,
      env: {
        ...process.env,
        ...DEFAULT_ENV,
        // Keep Node strict and preload diagnostics shim; avoid injecting many service-level timeouts
        NODE_OPTIONS: [process.env.NODE_OPTIONS || '', '--unhandled-rejections=strict', '-r', './lib/diagnostics-shim.cjs'].filter(Boolean).join(' '),
      }
    });
    
    let output = '';
    let errorOutput = '';
    
    child.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });
    
    const killer = setTimeout(() => {
      console.log(`⏳ Hard timeout ${HARD_TIMEOUT_MS}ms exceeded for ${path.basename(testFile)} — dumping handles & killing test process`);
      try { if (child && child.connected) child.send({ type: 'dump-handles' }); } catch {}
      setTimeout(() => {
        try {
          if (process.platform !== 'win32') {
            // Kill entire process group
            try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
          } else {
            child.kill('SIGKILL');
          }
        } catch {}
        // If the child still doesn't close, force-resolve to advance the suite
        setTimeout(() => resolve(124), 1000);
      }, 750);
    }, HARD_TIMEOUT_MS + 2000);

    child.on('close', (code) => {
      clearTimeout(killer);
      if (code === 0) {
        console.log(`✅ ${path.basename(testFile)} PASSED`);
        // Show summary line from output
        const lines = output.split('\n');
        const summaryLine = lines.find(line => line.includes('tests') && line.includes('pass'));
        if (summaryLine) {
          console.log(`   ${summaryLine.trim()}`);
        }
      } else {
        console.log(`❌ ${path.basename(testFile)} FAILED`);
        if (errorOutput) {
          console.log('Error:', errorOutput.split('\n')[0]);
        }
      }
      resolve(code);
    });
  });
}

async function runAllTests() {
  console.log('🚀 Running all backend tests...');

  await runTypeScriptCheck();
  
  // Find all .cjs test files with priority: *.live.cjs -> *.unit.cjs -> *.mock.cjs -> others
  const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.cjs') && f !== 'run-all-tests.cjs');
  // Optional pattern filtering via TEST_FILES_GLOB (comma-separated substrings)
  const pattern = process.env.TEST_FILES_GLOB;
  const filtered = pattern ? files.filter(f => pattern.split(',').some(p => f.includes(p.trim()))) : files;
  const score = (f) => f.endsWith('.live.cjs') ? 0 : f.endsWith('.unit.cjs') ? 1 : f.endsWith('.mock.cjs') ? 2 : 3;
  const sorted = filtered.sort((a, b) => score(a) - score(b));
  const absolute = sorted.map(file => path.join(__dirname, file));

  const liveTests = absolute.filter(file => file.endsWith('.live.cjs'));
  let skippedLive = [];
  if (!INCLUDE_LIVE) {
    skippedLive = liveTests;
    if (liveTests.length) {
      console.log('⏭️  Skipping live REST suites (VX_TEST_INCLUDE_LIVE!=true).');
    }
  } else if (liveTests.length && process.env.VX_TEST_SKIP_LIVE !== 'true' && process.env.VX_TEST_IN_PROCESS_SERVER !== 'true') {
    try {
      await ensureBackendReady({ timeoutMs: Number(process.env.VX_TEST_PREFLIGHT_TIMEOUT_MS || 5000) });
      console.log('✅ Backend preflight passed');
    } catch (error) {
      const message = error?.message || String(error);
      console.warn(`⚠️  Backend preflight failed: ${message}`);
      if (process.env.VX_TEST_REQUIRE_LIVE === 'true') {
        console.error('Live tests are required by configuration; aborting.');
        process.exitCode = 1;
        return;
      }
      skippedLive = liveTests;
      console.log('⏭️  Skipping live test files due to unavailable backend. Set VX_TEST_REQUIRE_LIVE=true to enforce running them.');
    }
  }

  const testFiles = absolute.filter(file => !skippedLive.includes(file));
  
  console.log(`Found ${testFiles.length} test files (live first):`);
  testFiles.forEach(file => console.log(`  - ${path.basename(file)}`));
  if (skippedLive.length) {
    console.log(`Skipped ${skippedLive.length} live test files:`);
    skippedLive.forEach(file => console.log(`  - ${path.basename(file)}`));
  }
  
  let passCount = 0;
  let failCount = 0;
  
  for (const testFile of testFiles) {
    const exitCode = await runTest(testFile);
    if (exitCode === 0) {
      passCount++;
    } else {
      failCount++;
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log(`📊 Test Results: ${passCount} passed, ${failCount} failed`);
  console.log('='.repeat(60));
  
  if (failCount === 0) {
    console.log('🎉 All tests passed!');
  } else {
    console.log('💥 Some tests failed. Check output above for details.');
  }
  
  process.exit(failCount > 0 ? 1 : 0);
}

// Run with real data if environment variable is set
if (process.env.VX_TEST_REAL_DATA === 'true') {
  console.log('🔴 Running tests with REAL DATA mode enabled');
  console.log(`   User ID: ${process.env.VX_TEST_USER_ID || 'default'}`);
} else {
  console.log('🟡 Running tests with MOCK DATA (set VX_TEST_REAL_DATA=true for real data)');
}

runAllTests().catch(console.error);
