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

function create(context) {
  let services = context.parserServices;
  try {
    services = ESLintUtils.getParserServices(context);
  } catch {
    // fall through; we have AST-only fallback further down
  }
  if (!services || !services.program || !services.esTreeNodeToTSNodeMap) {
    // still return listeners; AST fallback handles some cases
  }
  const checker = services.program.getTypeChecker();
  const configured = new Set((context.options && context.options[0] && context.options[0].types) || []);
  const domainTypes = configured.size ? configured : DEFAULT_DOMAIN_TYPES;

  function resolveTargetTypeForObjectExpression(node) {
    const tsNode = services.esTreeNodeToTSNodeMap.get(node);
    let t = checker.getContextualType(tsNode);
    if (t) return t;
    // Fallback for: const x: Type = { ... }
    const parent = node.parent;
    if (parent && parent.type === 'VariableDeclarator' && parent.id && parent.id.type === 'Identifier') {
      const tsId = services.esTreeNodeToTSNodeMap.get(parent.id);
      const annotType = checker.getTypeAtLocation(tsId);
      if (annotType) return annotType;
    }
    return undefined;
  }

  function checkObjectExpression(node) {
    let contextualType = resolveTargetTypeForObjectExpression(node);
    let name = getTypeName(checker, contextualType);
    // Fallback: inspect TS type annotation on variable declarator without checker
    if (!name) {
      const parent = node.parent;
      if (parent && parent.type === 'VariableDeclarator' && parent.id && parent.id.type === 'Identifier' && parent.id.typeAnnotation) {
        const ta = parent.id.typeAnnotation.typeAnnotation;
        if (ta && ta.type === 'TSTypeReference' && ta.typeName && ta.typeName.type === 'Identifier') {
          name = ta.typeName.name;
        }
      }
    }
    if (!name || !domainTypes.has(name)) return;
    context.report({
      node,
      message: `Do not construct ${name} with an object literal. Use a validated factory that enforces invariants.`,
    });
  }

  return {
    ObjectExpression: checkObjectExpression,
  };
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow ad-hoc object literals for core domain types; require validated factories',
      recommended: false,
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
