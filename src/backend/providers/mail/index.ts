import type { Account } from '../../../shared/types';
import type { IMailProvider } from './base';
import outlookProvider from './outlook';
import gmailProvider from './gmail';

const registry: Record<string, IMailProvider> = {
  outlook: outlookProvider,
  gmail: gmailProvider,
};

/** Look up a mail provider implementation by id. */
export function getMailProvider(id: Account['provider']): IMailProvider | undefined {
  return registry[id];
}

export default registry;
