/**
 * Validates parameters against a minimal subset of JSON Schema.
 * @param schema Schema definition to validate against.
 * @param params Data to validate.
 * @param path Path used to prefix error messages.
 * @returns Array of validation error messages.
 */
export function validateAgainstSchema(
  schema: any,
  params: any,
  path: string = '',
): string[] {
  const errors: string[] = [];
  if (!schema || typeof schema !== 'object') return errors;
  const type = schema.type;
  const here = path || 'root';
  if (type === 'object') {
    const props = schema.properties || {};
    const required: string[] = Array.isArray(schema.required) ? schema.required : [];
    for (const r of required) {
      if (params == null || typeof params !== 'object' || typeof (params as any)[r] === 'undefined') {
        errors.push(`${here}: missing required property '${r}'`);
      }
    }
    if (params && typeof params === 'object') {
      for (const key of Object.keys(props)) {
        const subSchema = props[key];
        if (typeof (params as any)[key] !== 'undefined') {
          errors.push(...validateAgainstSchema(subSchema, (params as any)[key], path ? `${path}.${key}` : key));
        }
      }
    }
  } else if (type === 'array') {
    if (!Array.isArray(params)) errors.push(`${here}: expected array`);
    else if (schema.items) {
      params.forEach((v: any, i: number) => {
        errors.push(...validateAgainstSchema(schema.items, v, `${here}[${i}]`));
      });
    }
  } else if (type === 'string') {
    if (typeof params !== 'string') errors.push(`${here}: expected string`);
    if (schema.enum && Array.isArray(schema.enum) && !schema.enum.includes(params)) {
      errors.push(`${here}: expected one of ${schema.enum.join(', ')}`);
    }
  } else if (type === 'number' || type === 'integer') {
    if (typeof params !== 'number') errors.push(`${here}: expected number`);
  } else if (type === 'boolean') {
    if (typeof params !== 'boolean') errors.push(`${here}: expected boolean`);
  }
  return errors;
}
