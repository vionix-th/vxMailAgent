/* Canonical ESLint config for backend
 * Enforces no direct thread mutations; use services/conversation-mutations.ts
 */

module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  parser: require.resolve('@typescript-eslint/parser'),
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    project: undefined,
  },
  plugins: ['@typescript-eslint'],
  ignorePatterns: [
    'dist/**',
    'node_modules/**',
  ],
  overrides: [
    {
      files: ['**/*.ts'],
      excludedFiles: [
        // Allow canonical mutation helpers to manage messages/lastActiveAt/endedAt
        'services/conversation-mutations.ts',
      ],
      rules: {
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
              'Do not push directly to thread[\'messages\']; use conversation-mutations helpers.',
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
              'Do not assign to thread[\'messages|lastActiveAt|endedAt\']; use conversation-mutations helpers.',
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
              'Do not update thread[\'messages|lastActiveAt|endedAt\']; use conversation-mutations helpers.',
          },
        ],
      },
    },
  ],
};
