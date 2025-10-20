import { ApiConfig } from '../../shared/types';

export interface ApiConfigView {
  id: string;
  name: string;
  model: string;
  hasApiKey: boolean;
  maxCompletionTokens?: number;
}

export function serializeApiConfig(apiConfig: ApiConfig): ApiConfigView {
  const view: ApiConfigView = {
    id: apiConfig.id,
    name: apiConfig.name,
    model: apiConfig.model,
    hasApiKey: typeof apiConfig.apiKey === 'string' && apiConfig.apiKey.length > 0,
  };
  if (typeof apiConfig.maxCompletionTokens === 'number') {
    view.maxCompletionTokens = apiConfig.maxCompletionTokens;
  }
  return view;
}
