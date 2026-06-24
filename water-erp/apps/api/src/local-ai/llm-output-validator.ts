import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from './llm.service';

export interface FieldSchema {
  type: 'string' | 'number' | 'boolean' | 'enum' | 'array' | 'object';
  required?: boolean;
  default?: unknown;
  min?: number;
  max?: number;
  values?: string[]; // For enum type
  items?: FieldSchema; // For array type
  properties?: Record<string, FieldSchema>; // For object type
  strict?: boolean; // If true, fail on type mismatch instead of coerce
}

export interface ValidationResult<T> {
  valid: boolean;
  value: T;
  errors: string[];
  warnings: string[];
}

@Injectable()
export class LlmOutputValidator {
  private readonly logger = new Logger(LlmOutputValidator.name);

  validateEnum<T extends string>(value: unknown, allowed: T[], fallback: T): T {
    if (typeof value === 'string' && allowed.includes(value as T)) {
      return value as T;
    }
    this.logger.warn(
      `Invalid enum value "${String(value)}", falling back to "${fallback}". Allowed: ${allowed.join(', ')}`,
    );
    return fallback;
  }

  validateEnumArray<T extends string>(
    values: unknown[],
    allowed: T[],
    fallback: T,
  ): T[] {
    return values.map((v) => this.validateEnum(v, allowed, fallback));
  }

  /**
   * Validate a single object against a schema
   */
  validateObject<T = Record<string, unknown>>(
    obj: unknown,
    schema: Record<string, FieldSchema>,
  ): ValidationResult<T> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const result: Record<string, unknown> = {};

    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return {
        valid: false,
        value: {} as T,
        errors: ['Input is not an object'],
        warnings: [],
      };
    }

    const input = obj as Record<string, unknown>;

    for (const [key, fieldSchema] of Object.entries(schema)) {
      const value = input[key];
      const validated = this.validateField(key, value, fieldSchema);

      if (validated.error) {
        if (fieldSchema.required) {
          errors.push(validated.error);
        } else {
          warnings.push(validated.error);
          result[key] =
            fieldSchema.default ?? this.getDefaultForType(fieldSchema.type);
        }
      } else {
        result[key] = validated.value;
      }
    }

    return {
      valid: errors.length === 0,
      value: result as T,
      errors,
      warnings,
    };
  }

  /**
   * Validate an array of objects against a schema
   */
  validateArray<T = Record<string, unknown>>(
    arr: unknown,
    schema: Record<string, FieldSchema>,
  ): ValidationResult<T[]> {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!Array.isArray(arr)) {
      return {
        valid: false,
        value: [],
        errors: ['Input is not an array'],
        warnings: [],
      };
    }

    const validItems: T[] = [];

    for (let i = 0; i < arr.length; i++) {
      const result = this.validateObject<T>(arr[i], schema);

      if (!result.valid) {
        errors.push(`Item ${i}: ${result.errors.join(', ')}`);
      } else {
        validItems.push(result.value);
        if (result.warnings.length > 0) {
          warnings.push(`Item ${i}: ${result.warnings.join(', ')}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      value: validItems,
      errors,
      warnings,
    };
  }

  private validateField(
    key: string,
    value: unknown,
    schema: FieldSchema,
  ): { value: unknown; error?: string } {
    // Handle missing values
    if (value === undefined || value === null) {
      if (schema.required) {
        return { value: undefined, error: `Field "${key}" is required` };
      }
      return { value: schema.default ?? this.getDefaultForType(schema.type) };
    }

    // Type validation
    switch (schema.type) {
      case 'string':
        if (typeof value !== 'string') {
          return {
            value: String(value),
            error: `Field "${key}" is not a string, converted`,
          };
        }
        return { value };

      case 'number':
        if (typeof value !== 'number' || isNaN(value)) {
          const parsed = Number(value);
          if (isNaN(parsed)) {
            // In strict mode, fail instead of using default
            if (schema.strict) {
              return {
                value: undefined,
                error: `Field "${key}" is not a valid number (strict mode)`,
              };
            }
            return {
              value: schema.default ?? 0,
              error: `Field "${key}" is not a valid number`,
            };
          }
          // In strict mode, fail on type mismatch
          if (schema.strict) {
            return {
              value: undefined,
              error: `Field "${key}" is not a number type (strict mode)`,
            };
          }
          return {
            value: parsed,
            error: `Field "${key}" is not a number, converted`,
          };
        }
        if (schema.min !== undefined && value < schema.min) {
          return {
            value: schema.min,
            error: `Field "${key}" is below minimum ${schema.min}`,
          };
        }
        if (schema.max !== undefined && value > schema.max) {
          return {
            value: schema.max,
            error: `Field "${key}" exceeds maximum ${schema.max}`,
          };
        }
        return { value };

      case 'boolean':
        if (typeof value !== 'boolean') {
          // In strict mode, fail on type mismatch
          if (schema.strict) {
            return {
              value: undefined,
              error: `Field "${key}" is not a boolean type (strict mode)`,
            };
          }
          const converted = Boolean(value);
          return {
            value: converted,
            error: `Field "${key}" is not a boolean, converted`,
          };
        }
        return { value };

      case 'enum':
        if (!schema.values || !schema.values.includes(String(value))) {
          const fallback = schema.default ?? schema.values?.[0] ?? '';
          return {
            value: fallback,
            error: `Field "${key}" has invalid enum value "${String(value)}", using "${fallback}"`,
          };
        }
        return { value: String(value) };

      case 'array':
        if (!Array.isArray(value)) {
          return { value: [], error: `Field "${key}" is not an array` };
        }
        if (schema.items) {
          const validated = value.map((item, i) => {
            const fieldResult = this.validateField(
              `${key}[${i}]`,
              item,
              schema.items!,
            );
            return fieldResult.value;
          });
          return { value: validated };
        }
        return { value };

      case 'object':
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          return { value: {}, error: `Field "${key}" is not an object` };
        }
        if (schema.properties) {
          const result = this.validateObject(
            value as Record<string, unknown>,
            schema.properties,
          );
          return { value: result.value };
        }
        return { value };

      default:
        return { value };
    }
  }

  private getDefaultForType(type: FieldSchema['type']): unknown {
    switch (type) {
      case 'string':
        return '';
      case 'number':
        return 0;
      case 'boolean':
        return false;
      case 'array':
        return [];
      case 'object':
        return {};
      case 'enum':
        return undefined;
      default:
        return undefined;
    }
  }

  async retryChatJson<T>(
    llm: LlmService,
    systemPrompt: string,
    userPrompt: string,
    validate: (raw: unknown) => raw is T,
    maxRetries = 2,
    signal?: AbortSignal,
  ): Promise<T> {
    let lastError: string | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const raw = await llm.chatJson<unknown>(
          systemPrompt,
          userPrompt,
          0,
          signal,
        );

        if (validate(raw)) {
          return raw;
        }

        lastError = `Validation failed on attempt ${attempt + 1}`;
        this.logger.warn(lastError);

        if (Array.isArray(raw) && raw.length > 0) {
          const filtered = raw.filter(validate);
          if (filtered.length > 0) {
            this.logger.log(
              `Recovered ${filtered.length}/${raw.length} items after filtering`,
            );
            return filtered as T;
          }
        }
      } catch (err) {
        lastError = `LLM call failed on attempt ${attempt + 1}: ${String(err).slice(0, 200)}`;
        this.logger.warn(lastError);
      }
    }

    throw new Error(
      `LLM output validation failed after ${maxRetries + 1} attempts. Last error: ${lastError}`,
    );
  }
}
