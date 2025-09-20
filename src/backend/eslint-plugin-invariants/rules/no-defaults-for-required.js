"use strict";

const ts = require('typescript');
const { ESLintUtils } = require('@typescript-eslint/utils');

function create(context) {
  let services = context.parserServices;
  // Prefer robust accessor from @typescript-eslint/utils (throws if not available)
  try {
    services = ESLintUtils.getParserServices(context);
  } catch {
    // Fall back to context.parserServices; if still unavailable, continue with best-effort checks.
  }
  if (!services || !services.program || !services.esTreeNodeToTSNodeMap) {
    // Proceed with best-effort (declared type annotation fallback) implemented below.
  }
  const checker = services.program.getTypeChecker();

  function isRequiredInType(type, propName) {
    if (!type || !propName) return false;
    try {
      const sym = type.getProperty(propName);
      if (!sym) return false;
      if ((sym.flags & ts.SymbolFlags.Optional) !== 0) return false;
      const decls = sym.getDeclarations?.() || [];
      for (const d of decls) {
        if (d && 'questionToken' in d && d.questionToken) return false; // optional
      }
      return true; // treat as required
    } catch {
      return false;
    }
  }

  function isDefaultingExpression(expr) {
    // Ban any `||` or `??` defaulting
    if (expr && expr.type === 'LogicalExpression' && (expr.operator === '||' || expr.operator === '??')) return true;
    // Ban String(...) coercion
    if (expr && expr.type === 'CallExpression' && expr.callee && expr.callee.type === 'Identifier' && expr.callee.name === 'String') return true;
    // Ban + '' coercion
    if (expr && expr.type === 'BinaryExpression' && expr.operator === '+' && (isEmptyStringLiteral(expr.left) || isEmptyStringLiteral(expr.right))) return true;
    return false;
  }

  function isEmptyStringLiteral(node) {
    return node && node.type === 'Literal' && node.value === '';
  }

  function resolveTargetTypeForObjectExpression(node) {
    const tsNode = services.esTreeNodeToTSNodeMap.get(node);
    let t = checker.getContextualType(tsNode);
    if (t) return t;
    // Fallback: const x: Type = { ... }
    const parent = node.parent;
    if (parent && parent.type === 'VariableDeclarator' && parent.id && parent.id.type === 'Identifier') {
      const tsId = services.esTreeNodeToTSNodeMap.get(parent.id);
      const annotType = checker.getTypeAtLocation(tsId);
      if (annotType) return annotType;
    }
    return undefined;
  }

  function checkObjectExpression(node) {
    const contextualType = resolveTargetTypeForObjectExpression(node);
    // Fallback: capture declared type name to report better messages when checker unavailable
    let declaredName = null;
    if (!contextualType) {
      const parent = node.parent;
      if (parent && parent.type === 'VariableDeclarator' && parent.id && parent.id.type === 'Identifier' && parent.id.typeAnnotation) {
        const ta = parent.id.typeAnnotation.typeAnnotation;
        if (ta && ta.type === 'TSTypeReference' && ta.typeName && ta.typeName.type === 'Identifier') {
          declaredName = ta.typeName.name;
        }
      }
    }
    if (!contextualType && !declaredName) return;

    for (const prop of node.properties) {
      if (prop.type !== 'Property') continue;
      const key = prop.key;
      const name = key.type === 'Identifier' ? key.name : key.type === 'Literal' ? String(key.value) : null;
      if (!name) continue;

      const value = prop.value;
      if (contextualType) {
        if (!isRequiredInType(contextualType, name)) continue;
        if (isDefaultingExpression(value)) {
          context.report({
            node: value,
            message: `Required property "${name}" must not use defaulting/coercion (||, ??, String(), + ''). Validate and fail early.`,
          });
        }
      } else {
        // Without checker, conservatively flag obvious defaulting/coercion within typed literal initializers
        if (isDefaultingExpression(value)) {
          context.report({
            node: value,
            message: `Defaulting/coercion is not allowed for required properties when constructing ${declaredName}. Validate and fail early.`,
          });
        }
      }
    }
  }

  function checkAssignmentExpression(node) {
    // Only handle direct property assignments: obj.prop = expr
    if (node.left.type !== 'MemberExpression' || node.left.computed) return;
    const obj = node.left.object;
    const prop = node.left.property;
    if (prop.type !== 'Identifier') return;

    // Get type of object
    const tsObj = services.esTreeNodeToTSNodeMap.get(obj);
    const objType = checker.getTypeAtLocation(tsObj);
    if (!objType) return;

    // If the property exists and is required, forbid defaulting on RHS
    if (!isRequiredInType(objType, prop.name)) return;
    if (isDefaultingExpression(node.right)) {
      context.report({
        node: node.right,
        message: `Required property "${prop.name}" must not use defaulting/coercion (||, ??, String(), + ''). Validate and fail early.`,
      });
    }
  }

  return {
    ObjectExpression: checkObjectExpression,
    AssignmentExpression: checkAssignmentExpression,
  };
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow defaults/coercions for required (non-optional) properties in typed objects',
      recommended: true,
    },
    schema: [],
  },
  create,
};
