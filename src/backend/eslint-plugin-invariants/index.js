"use strict";

module.exports = {
  rules: {
    'no-defaults-for-required': require('./rules/no-defaults-for-required'),
    'no-domain-object-literals': require('./rules/no-domain-object-literals'),
    'no-any-into-domain': require('./rules/no-any-into-domain'),
  },
};

