#!/usr/bin/env node

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Test runner that executes all .cjs test files
const HARD_TIMEOUT_MS = Number(process.env.TEST_HARD_TIMEOUT_MS || 30000);

async function runTest(testFile) {
  return new Promise((resolve) => {
    console.log(`\n🧪 Running ${path.basename(testFile)}...`);
    
    const child = spawn('node', ['--test', `--test-timeout=${HARD_TIMEOUT_MS}`, '--test-concurrency=1', testFile], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      cwd: __dirname,
      detached: true,
      env: {
        ...process.env,
        DISABLE_DOTENV: 'true',
        VX_TEST_MOCK_OPENAI: process.env.VX_TEST_MOCK_OPENAI || 'true',
        VX_TEST_MOCK_PROVIDER: process.env.VX_TEST_MOCK_PROVIDER || 'true',
        TRACE_PERSIST: process.env.TRACE_PERSIST || 'false',
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
  
  // Find all .cjs test files with priority: *.live.cjs -> *.unit.cjs -> *.mock.cjs -> others
  const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.cjs') && f !== 'run-all-tests.cjs');
  // Optional pattern filtering via TEST_FILES_GLOB (comma-separated substrings)
  const pattern = process.env.TEST_FILES_GLOB;
  const filtered = pattern ? files.filter(f => pattern.split(',').some(p => f.includes(p.trim()))) : files;
  const score = (f) => f.endsWith('.live.cjs') ? 0 : f.endsWith('.unit.cjs') ? 1 : f.endsWith('.mock.cjs') ? 2 : 3;
  const testFiles = filtered.sort((a, b) => score(a) - score(b)).map(file => path.join(__dirname, file));
  
  console.log(`Found ${testFiles.length} test files (live first):`);
  testFiles.forEach(file => console.log(`  - ${path.basename(file)}`));
  
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
