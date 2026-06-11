import { describe, it, expect } from 'vitest';
import { sanitizeJsonSchemaForOutputFormat } from './sanitize-json-schema.js';

describe('sanitizeJsonSchemaForOutputFormat', () => {
  describe('passthrough (no format keywords)', () => {
    it('returns the input unchanged by reference when no format keys exist', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1 },
          tags: { type: 'array', items: { type: 'string' } },
          choice: { anyOf: [{ type: 'string' }, { type: 'number' }] },
        },
        required: ['name'],
      };

      const result = sanitizeJsonSchemaForOutputFormat(schema);

      expect(result.schema).toBe(schema);
      expect(result.strippedFormatPaths).toEqual([]);
    });

    it('does not treat a property NAMED format as the format keyword', () => {
      const schema = {
        type: 'object',
        properties: {
          format: { type: 'string' },
        },
      };

      const result = sanitizeJsonSchemaForOutputFormat(schema);

      expect(result.schema).toBe(schema);
      expect(result.strippedFormatPaths).toEqual([]);
    });
  });

  describe('format stripping and description folding', () => {
    it('strips format at the root and creates a description', () => {
      const schema = { type: 'string', format: 'date-time' };

      const result = sanitizeJsonSchemaForOutputFormat(schema);

      expect(result.schema).toEqual({
        type: 'string',
        description: 'Expected format: date-time',
      });
      expect(result.strippedFormatPaths).toEqual(['#']);
      // Input is not mutated
      expect(schema).toEqual({ type: 'string', format: 'date-time' });
    });

    it('appends the format hint to an existing description', () => {
      const schema = {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email', description: 'Contact email' },
        },
      };

      const result = sanitizeJsonSchemaForOutputFormat(schema);

      expect(result.schema).toEqual({
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Contact email (expected format: email)' },
        },
      });
      expect(result.strippedFormatPaths).toEqual(['#/properties/email']);
    });

    it('strips formats in nested objects and arrays', () => {
      const schema = {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
          links: {
            type: 'array',
            items: { type: 'string', format: 'uri' },
          },
        },
      };

      const { schema: sanitized, strippedFormatPaths } = sanitizeJsonSchemaForOutputFormat(schema);

      const props = sanitized.properties as Record<string, Record<string, unknown>>;
      const userProps = props.user.properties as Record<string, Record<string, unknown>>;
      expect(userProps.createdAt).toEqual({
        type: 'string',
        description: 'Expected format: date-time',
      });
      expect(props.links.items).toEqual({
        type: 'string',
        description: 'Expected format: uri',
      });
      expect(strippedFormatPaths).toEqual([
        '#/properties/user/properties/createdAt',
        '#/properties/links/items',
      ]);
    });

    it('strips formats in tuple items, prefixItems, and union keywords', () => {
      const schema = {
        type: 'object',
        properties: {
          tuple: {
            type: 'array',
            items: [{ type: 'string', format: 'uuid' }, { type: 'number' }],
          },
          prefixed: {
            type: 'array',
            prefixItems: [{ type: 'string', format: 'email' }],
          },
          choice: {
            anyOf: [{ type: 'string', format: 'uri' }, { type: 'number' }],
          },
          either: {
            oneOf: [{ type: 'string', format: 'date' }],
          },
          all: {
            allOf: [{ type: 'string', format: 'time' }],
          },
          negated: {
            not: { type: 'string', format: 'ipv4' },
          },
        },
      };

      const { schema: sanitized, strippedFormatPaths } = sanitizeJsonSchemaForOutputFormat(schema);

      const props = sanitized.properties as Record<string, Record<string, unknown>>;
      expect((props.tuple.items as unknown[])[0]).toEqual({
        type: 'string',
        description: 'Expected format: uuid',
      });
      expect((props.tuple.items as unknown[])[1]).toEqual({ type: 'number' });
      expect((props.prefixed.prefixItems as unknown[])[0]).toEqual({
        type: 'string',
        description: 'Expected format: email',
      });
      expect((props.choice.anyOf as unknown[])[0]).toEqual({
        type: 'string',
        description: 'Expected format: uri',
      });
      expect((props.either.oneOf as unknown[])[0]).toEqual({
        type: 'string',
        description: 'Expected format: date',
      });
      expect((props.all.allOf as unknown[])[0]).toEqual({
        type: 'string',
        description: 'Expected format: time',
      });
      expect(props.negated.not).toEqual({
        type: 'string',
        description: 'Expected format: ipv4',
      });
      expect(strippedFormatPaths).toEqual([
        '#/properties/tuple/items/0',
        '#/properties/prefixed/prefixItems/0',
        '#/properties/choice/anyOf/0',
        '#/properties/either/oneOf/0',
        '#/properties/all/allOf/0',
        '#/properties/negated/not',
      ]);
    });

    it('strips formats in $defs, definitions, additionalProperties, and patternProperties', () => {
      const schema = {
        type: 'object',
        $defs: {
          Email: { type: 'string', format: 'email' },
        },
        definitions: {
          Uri: { type: 'string', format: 'uri' },
        },
        additionalProperties: { type: 'string', format: 'uuid' },
        patternProperties: {
          '^x-': { type: 'string', format: 'date-time' },
        },
      };

      const { schema: sanitized, strippedFormatPaths } = sanitizeJsonSchemaForOutputFormat(schema);

      expect((sanitized.$defs as Record<string, unknown>).Email).toEqual({
        type: 'string',
        description: 'Expected format: email',
      });
      expect((sanitized.definitions as Record<string, unknown>).Uri).toEqual({
        type: 'string',
        description: 'Expected format: uri',
      });
      expect(sanitized.additionalProperties).toEqual({
        type: 'string',
        description: 'Expected format: uuid',
      });
      expect((sanitized.patternProperties as Record<string, unknown>)['^x-']).toEqual({
        type: 'string',
        description: 'Expected format: date-time',
      });
      expect(strippedFormatPaths).toHaveLength(4);
    });

    it('strips formats in dependentSchemas, dependencies (schema form), and contentSchema', () => {
      const schema = {
        type: 'object',
        dependentSchemas: {
          billing: {
            properties: { invoiceEmail: { type: 'string', format: 'email' } },
          },
        },
        dependencies: {
          shipping: {
            properties: { trackingUrl: { type: 'string', format: 'uri' } },
          },
          // draft-07 array form (property-name strings) must pass through untouched
          credit_card: ['billing_address'],
        },
        contentSchema: { type: 'string', format: 'uuid' },
      };

      const { schema: sanitized, strippedFormatPaths } = sanitizeJsonSchemaForOutputFormat(schema);

      const dependentSchemas = sanitized.dependentSchemas as Record<
        string,
        { properties: Record<string, unknown> }
      >;
      expect(dependentSchemas.billing.properties.invoiceEmail).toEqual({
        type: 'string',
        description: 'Expected format: email',
      });
      const dependencies = sanitized.dependencies as Record<string, unknown>;
      expect((dependencies.shipping as { properties: Record<string, unknown> }).properties).toEqual(
        {
          trackingUrl: { type: 'string', description: 'Expected format: uri' },
        }
      );
      expect(dependencies.credit_card).toBe(schema.dependencies.credit_card);
      expect(sanitized.contentSchema).toEqual({
        type: 'string',
        description: 'Expected format: uuid',
      });
      expect(strippedFormatPaths).toEqual([
        '#/dependentSchemas/billing/properties/invoiceEmail',
        '#/dependencies/shipping/properties/trackingUrl',
        '#/contentSchema',
      ]);
      // Input is not mutated
      expect(schema.contentSchema).toEqual({ type: 'string', format: 'uuid' });
    });

    it('preserves spec-invalid non-string descriptions instead of overwriting them', () => {
      const schema = {
        type: 'object',
        properties: {
          weird: { type: 'string', format: 'email', description: 123 },
        },
      };

      const { schema: sanitized, strippedFormatPaths } = sanitizeJsonSchemaForOutputFormat(
        schema as Record<string, unknown>
      );

      const props = sanitized.properties as Record<string, Record<string, unknown>>;
      // format is still stripped, but the (invalid) description is left alone
      expect(props.weird).toEqual({ type: 'string', description: 123 });
      expect(strippedFormatPaths).toEqual(['#/properties/weird']);
    });

    it('leaves untouched sibling subtrees as the same references', () => {
      const untouched = {
        type: 'object',
        properties: { count: { type: 'number' } },
      };
      const schema = {
        type: 'object',
        properties: {
          untouched,
          stamped: { type: 'string', format: 'date-time' },
        },
      };

      const { schema: sanitized } = sanitizeJsonSchemaForOutputFormat(schema);

      expect(sanitized).not.toBe(schema);
      expect((sanitized.properties as Record<string, unknown>).untouched).toBe(untouched);
    });
  });

  describe('pattern is preserved', () => {
    it('does not touch pattern keywords (real CLI enforcement)', () => {
      const schema = {
        type: 'object',
        properties: {
          code: { type: 'string', pattern: '^[A-Z]{3}-\\d{4}$' },
          email: { type: 'string', format: 'email', pattern: '.+@.+' },
        },
      };

      const { schema: sanitized, strippedFormatPaths } = sanitizeJsonSchemaForOutputFormat(schema);

      const props = sanitized.properties as Record<string, Record<string, unknown>>;
      expect(props.code).toEqual({ type: 'string', pattern: '^[A-Z]{3}-\\d{4}$' });
      expect(props.email).toEqual({
        type: 'string',
        pattern: '.+@.+',
        description: 'Expected format: email',
      });
      expect(strippedFormatPaths).toEqual(['#/properties/email']);
    });
  });

  describe('defensive behavior', () => {
    it('ignores non-string format values', () => {
      const schema = {
        type: 'object',
        properties: {
          weird: { type: 'string', format: 42 },
        },
      };

      const result = sanitizeJsonSchemaForOutputFormat(schema as Record<string, unknown>);

      expect(result.schema).toBe(schema);
      expect(result.strippedFormatPaths).toEqual([]);
    });

    it('handles cyclic object graphs without infinite recursion', () => {
      const node: Record<string, unknown> = {
        type: 'object',
        properties: {
          stamp: { type: 'string', format: 'date-time' },
        },
      };
      (node.properties as Record<string, unknown>).self = node;

      const { schema: sanitized, strippedFormatPaths } = sanitizeJsonSchemaForOutputFormat(node);

      expect(strippedFormatPaths).toContain('#/properties/stamp');
      const props = sanitized.properties as Record<string, unknown>;
      expect(props.stamp).toEqual({
        type: 'string',
        description: 'Expected format: date-time',
      });
      // The cyclic reference is left as-is (returned unchanged on revisit).
      expect(props.self).toBe(node);
    });

    it('sanitizes shared (DAG) subschemas in every location', () => {
      const shared = { type: 'string', format: 'email' };
      const schema = {
        type: 'object',
        properties: {
          a: shared,
          b: shared,
        },
      };

      const { schema: sanitized, strippedFormatPaths } = sanitizeJsonSchemaForOutputFormat(schema);

      const props = sanitized.properties as Record<string, Record<string, unknown>>;
      expect(props.a).toEqual({ type: 'string', description: 'Expected format: email' });
      expect(props.b).toEqual({ type: 'string', description: 'Expected format: email' });
      expect(strippedFormatPaths).toEqual(['#/properties/a', '#/properties/b']);
    });
  });
});
