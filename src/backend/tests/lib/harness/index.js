const { startBackend, withServer } = require('./server');
const { requestWithTimeout, fetchJson } = require('./http');
const { waitFor } = require('./wait');
const { createLogCapture, assertMetaFields } = require('./logs');
const { discoverTestUser, createSession } = require('./session');

module.exports = {
  // lifecycle
  startBackend,
  withServer,
  // http
  requestWithTimeout,
  fetchJson,
  // wait utils
  waitFor,
  // logs
  createLogCapture,
  assertMetaFields,
  // session & user
  discoverTestUser,
  createSession,
};
