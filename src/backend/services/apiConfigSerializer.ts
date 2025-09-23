import { ApiConfig } from '../../shared/types';

export type ApiConfigView = Pick<ApiConfig, 'id' | 'name' | 'model' | 'maxCompletionTokens'>;

export function serializeApiConfig(apiConfig: ApiConfig): ApiConfigView {
  const view: ApiConfigView = {
    id: apiConfig.id,
    name: apiConfig.name,
    model: apiConfig.model,
  };
  if (typeof apiConfig.maxCompletionTokens === 'number') {
    view.maxCompletionTokens = apiConfig.maxCompletionTokens;
  }
  return view;
}
