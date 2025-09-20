/* ESLint v9 Flat Config for backend */
const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');

module.exports = [
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: __dirname,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      invariants: require('./eslint-plugin-invariants'),
    },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: false }],
      'no-throw-literal': 'error',
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/no-floating-promises': ['warn', { ignoreVoid: true, ignoreIIFE: true }],
      'no-useless-catch': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='push'][callee.object.property.name='messages']",
          message:
            'Do not push directly to thread.messages; use appendMessageToThread/repoAppendMessage from services/conversation-mutations.ts',
        },
        {
          selector:
            "CallExpression[callee.property.name='push'] > MemberExpression.callee[object.type='MemberExpression'][object.computed=true][object.property.value='messages']",
          message:
            "Do not push directly to thread['messages']; use conversation-mutations helpers.",
        },
        {
          selector:
            "AssignmentExpression[left.type='MemberExpression'][left.property.name=/^(messages|lastActiveAt|endedAt)$/]",
          message:
            'Do not assign to messages/lastActiveAt/endedAt on threads; use conversation-mutations helpers.',
        },
        {
          selector:
            "AssignmentExpression[left.type='MemberExpression'][left.computed=true][left.property.value=/^(messages|lastActiveAt|endedAt)$/]",
          message:
            "Do not assign to thread['messages|lastActiveAt|endedAt']; use conversation-mutations helpers.",
        },
        {
          selector:
            "UpdateExpression[argument.type='MemberExpression'][argument.property.name=/^(messages|lastActiveAt|endedAt)$/]",
          message:
            'Do not update messages/lastActiveAt/endedAt on threads; use conversation-mutations helpers.',
        },
        {
          selector:
            "UpdateExpression[argument.type='MemberExpression'][argument.computed=true][argument.property.value=/^(messages|lastActiveAt|endedAt)$/]",
          message:
            "Do not update thread['messages|lastActiveAt|endedAt']; use conversation-mutations helpers.",
        },
      ],
      // Invariant enforcement (type-aware)
      'invariants/no-defaults-for-required': 'error',
      'invariants/no-domain-object-literals': ['error', { types: ['EmailEnvelope','ConversationThread','Account','ProviderEvent'] }],
      'invariants/no-any-into-domain': ['error', { types: ['EmailEnvelope','ConversationThread','Account','ProviderEvent'] }],
    },
  },
  {
    files: ['services/conversation-mutations.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
];
