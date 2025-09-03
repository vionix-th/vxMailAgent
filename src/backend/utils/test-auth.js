#!/usr/bin/env node

const { signJwt } = require('../dist/utils/jwt');
const { JWT_SECRET } = require('../dist/config');
const fs = require('fs');
const path = require('path');

// Read existing users to get valid UIDs
function getExistingUsers() {
  const usersPath = path.join(__dirname, '../../../data/users.json');
  if (!fs.existsSync(usersPath)) {
    console.error('No users.json found at:', usersPath);
    process.exit(1);
  }
  
  const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
  return users;
}

// Generate JWT token for existing user
function generateTestToken(userId) {
  const users = getExistingUsers();
  const user = users.find(u => u.id === userId);
  
  if (!user) {
    console.error('User not found:', userId);
    console.log('Available users:');
    users.forEach(u => console.log(`  ${u.id} (${u.email})`));
    process.exit(1);
  }
  
  const payload = {
    uid: user.id,
    email: user.email,
    name: user.name,
    picture: user.picture
  };
  
  const token = signJwt(payload, JWT_SECRET, { expiresInSec: 3600 }); // 1 hour
  return token;
}

// Main CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node test-auth.js <user_id>');
    console.log('       node test-auth.js list');
    console.log('');
    console.log('Examples:');
    console.log('  node test-auth.js google:115075331003198785424');
    console.log('  node test-auth.js list');
    process.exit(1);
  }
  
  if (args[0] === 'list') {
    const users = getExistingUsers();
    console.log('Available users:');
    users.forEach(u => {
      console.log(`  ${u.id}`);
      console.log(`    Email: ${u.email}`);
      console.log(`    Name: ${u.name || 'N/A'}`);
      console.log('');
    });
    process.exit(0);
  }
  
  const userId = args[0];
  const token = generateTestToken(userId);
  
  console.log('Generated JWT token for user:', userId);
  console.log('Token:', token);
  console.log('');
  console.log('Usage with curl:');
  console.log(`curl -H "Authorization: Bearer ${token}" http://localhost:3001/api/fetcher/status`);
  console.log('');
  console.log('Or save to environment:');
  console.log(`export VX_TEST_TOKEN="${token}"`);
  console.log('curl -H "Authorization: Bearer $VX_TEST_TOKEN" http://localhost:3001/api/fetcher/status');
}

module.exports = { generateTestToken, getExistingUsers };
