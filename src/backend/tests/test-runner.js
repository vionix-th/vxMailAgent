#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Get all test files
const testDir = __dirname;
const testFiles = fs.readdirSync(testDir)
  .filter(file => file.endsWith('.test.ts'))
  .map(file => path.join(testDir, file));

console.log(`Found ${testFiles.length} test files:`);
testFiles.forEach(file => console.log(`  - ${path.basename(file)}`));
console.log('');

let passCount = 0;
let failCount = 0;

async function runTest(testFile) {
  return new Promise((resolve) => {
    console.log(`Running ${path.basename(testFile)}...`);
    
    const child = spawn('npx', ['ts-node', '--esm', testFile], {
      stdio: 'pipe',
      cwd: path.dirname(testDir)
    });
    
    let output = '';
    let errorOutput = '';
    
    child.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        console.log(`✅ ${path.basename(testFile)} PASSED`);
        passCount++;
      } else {
        console.log(`❌ ${path.basename(testFile)} FAILED`);
        console.log('Error output:', errorOutput);
        failCount++;
      }
      console.log('');
      resolve(code);
    });
  });
}

async function runAllTests() {
  console.log('Starting test execution...\n');
  
  for (const testFile of testFiles) {
    await runTest(testFile);
  }
  
  console.log('='.repeat(50));
  console.log(`Test Results: ${passCount} passed, ${failCount} failed`);
  console.log('='.repeat(50));
  
  process.exit(failCount > 0 ? 1 : 0);
}

runAllTests().catch(console.error);
