import type { Account } from '../../../shared/types';
import type { IMailProvider } from './base';
import outlookProvider from './outlook';
import gmailProvider from './gmail';
import { createMockMailProvider } from './mock';

const registry: Record<string, IMailProvider> = {
  outlook: outlookProvider,
  gmail: gmailProvider,
};

export function getMailProvider(id: Account['provider']): IMailProvider | undefined {
  if (String(process.env.VX_TEST_MOCK_PROVIDER || '').toLowerCase() === 'true') {
    return createMockMailProvider(id);
  }
  return registry[id];
}

export default registry;
