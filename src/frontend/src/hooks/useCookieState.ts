import { useEffect, useState } from 'react';
import { CookieOptions, getCookie, setCookie } from '../utils/cookies';

export interface UseCookieStateOptions<T> extends CookieOptions {
  serialize?: (value: T) => string;
  deserialize?: (raw: string) => T;
}

export function useCookieState<T>(
  name: string,
  defaultValue: T,
  options?: UseCookieStateOptions<T>
) {
  const { serialize, deserialize, ...cookieOptions } = options || {};

  const init = (): T => {
    const raw = getCookie(name);
    if (raw == null) return defaultValue;
    try {
      return deserialize ? deserialize(raw) : (JSON.parse(raw) as T);
    } catch {
      // Fallback for primitives
      if (typeof defaultValue === 'boolean') return (raw === 'true') as unknown as T;
      return raw as unknown as T;
    }
  };

  const [value, setValue] = useState<T>(init);

  useEffect(() => {
    const data = serialize ? serialize(value) : JSON.stringify(value);
    setCookie(name, data, cookieOptions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, value]);

  return [value, setValue] as const;
}
