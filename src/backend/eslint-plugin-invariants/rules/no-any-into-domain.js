"use strict";

const ts = require('typescript');
const { ESLintUtils } = require('@typescript-eslint/utils');

const DEFAULT_DOMAIN_TYPES = new Set([
  'EmailEnvelope',
  'ConversationThread',
  'Account',
  'ProviderEvent',
  'Prompt',
  'Agent',
  'Director',
  'Filter',
  'Imprint',
]);

function getTypeName(checker, type) {
  if (!type) return null;
  const sym = type.getSymbol?.();
  if (!sym) return null;
  return checker.getFullyQualifiedName(sym).split('.').pop();
}

function isAnyOrUnknown(type) {
  if (!type) return false;
  const f = type.flags;
  return (f & ts.TypeFlags.Any) !== 0 || (f & ts.TypeFlags.Unknown) !== 0;
}

function create(context) {
  let services = context.parserServices;
  try {
    services = ESLintUtils.getParserServices(context);
  } catch {
    return {}; // this rule needs type info; skip silently when not available
  }
  const checker = services.program.getTypeChecker();
  const configured = new Set((context.options && context.options[0] && context.options[0].types) || []);
  const domainTypes = configured.size ? configured : DEFAULT_DOMAIN_TYPES;

  function checkVariableDeclarator(node) {
    if (!node.init || node.id.type !== 'Identifier') return;
    const tsId = services.esTreeNodeToTSNodeMap.get(node.id);
    const tsInit = services.esTreeNodeToTSNodeMap.get(node.init);
    const targetType = checker.getTypeAtLocation(tsId);
    const sourceType = checker.getTypeAtLocation(tsInit);
    const name = getTypeName(checker, targetType);
    if (name && domainTypes.has(name) && isAnyOrUnknown(sourceType)) {
      context.report({
        node: node.init,
        message: `Do not assign 'any/unknown' into ${name}. Validate and narrow the type first.`,
      });
    }
  }

  function checkAssignmentExpression(node) {
    const tsLeft = services.esTreeNodeToTSNodeMap.get(node.left);
    const tsRight = services.esTreeNodeToTSNodeMap.get(node.right);
    const targetType = checker.getTypeAtLocation(tsLeft);
    const sourceType = checker.getTypeAtLocation(tsRight);
    const name = getTypeName(checker, targetType);
    if (name && domainTypes.has(name) && isAnyOrUnknown(sourceType)) {
      context.report({
        node: node.right,
        message: `Do not assign 'any/unknown' into ${name}. Validate and narrow the type first.`,
      });
    }
  }

  // We skip ReturnStatement for now; object/variable flows catch the common cases.

  return {
    VariableDeclarator: checkVariableDeclarator,
    AssignmentExpression: checkAssignmentExpression,
  };
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow assigning any/unknown into core domain types',
      recommended: true,
    },
    schema: [
      {
        type: 'object',
        properties: {
          types: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
  },
  create,
};
