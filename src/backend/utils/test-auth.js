#!/usr/bin/env node

const path = require('path');
const { signJwt } = require('../dist/backend/utils/jwt');
const { JWT_SECRET } = require('../dist/backend/config');
const { SqliteConnectionFactory, SystemUsersRepository } = require('../dist/backend/storage/sqlite');

async function loadUserRepository() {
  const factory = new SqliteConnectionFactory();
  const handle = factory.getSharedHandle();
  return new SystemUsersRepository(handle);
}

async function getExistingUsers() {
  const repo = await loadUserRepository();
  return await repo.getAll();
}

async function generateTestToken(userId) {
  const users = await getExistingUsers();
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

  const token = signJwt(payload, JWT_SECRET, { expiresInSec: 3600 });
  return token;
}

async function main() {
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
    const users = await getExistingUsers();
    console.log('Available users:');
    users.forEach(u => {
      console.log(`  ${u.id}`);
      console.log(`    Email: ${u.email}`);
      console.log(`    Name: ${u.name || 'N/A'}`);
      console.log('');
    });
    return;
  }

  const userId = args[0];
  const token = await generateTestToken(userId);

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

if (require.main === module) {
  main().catch(err => {
    console.error('Failed to generate test token:', err?.message || err);
    process.exit(1);
  });
}

module.exports = { generateTestToken, getExistingUsers };
