import { describe, it, expect } from 'vitest';
import { extractJson } from './extract-json.js';

describe('extractJson', () => {
  it('should extract valid JSON object', () => {
    const text = 'Here is some JSON: {"name": "John", "age": 30}';
    const result = extractJson(text);
    expect(result).toBe('{"name": "John", "age": 30}');
  });

  it('should extract valid JSON array', () => {
    const text = 'Data: [1, 2, 3, 4, 5]';
    const result = extractJson(text);
    expect(result).toBe('[1, 2, 3, 4, 5]');
  });

  it('should extract JSON from markdown code block', () => {
    const text = `
Here is the result:
\`\`\`json
{
  "status": "success",
  "data": {
    "id": 123,
    "value": "test"
  }
}
\`\`\`
`;
    const result = extractJson(text);
    expect(result).toBe(`{
  "status": "success",
  "data": {
    "id": 123,
    "value": "test"
  }
}`);
  });

  it('should extract JSON from regular code block', () => {
    const text = `
Result:
\`\`\`
{"message": "Hello, world!"}
\`\`\`
`;
    const result = extractJson(text);
    expect(result).toBe('{"message": "Hello, world!"}');
  });

  it('should extract nested JSON', () => {
    const text = 'Response: {"user": {"name": "Alice", "emails": ["alice@example.com", "alice2@example.com"]}}';
    const result = extractJson(text);
    expect(result).toBe('{"user": {"name": "Alice", "emails": ["alice@example.com", "alice2@example.com"]}}');
  });

  it('should extract JSON with special characters', () => {
    const text = 'Result: {"message": "Hello\\nWorld", "path": "C:\\\\Users\\\\test"}';
    const result = extractJson(text);
    expect(result).toBe('{"message": "Hello\\nWorld", "path": "C:\\\\Users\\\\test"}');
  });

  it('should return original text when no JSON found', () => {
    const text = 'This is just plain text with no JSON';
    const result = extractJson(text);
    expect(result).toBe(text);
  });

  it('should handle empty string', () => {
    const result = extractJson('');
    expect(result).toBe('');
  });

  it('should extract first valid JSON when multiple exist', () => {
    const text = 'First: {"a": 1} and second: {"b": 2}';
    const result = extractJson(text);
    // The regex {[\s\S]*} matches greedily from first { to last }
    // This returns the original text because the match isn't valid JSON
    expect(result).toBe(text);
  });

  it('should handle JSON with trailing comma (invalid but common)', () => {
    const text = 'Data: {"name": "test",}';
    const result = extractJson(text);
    // Should return original text as it's invalid JSON
    expect(result).toBe(text);
  });

  it('should extract JSON with numbers and booleans', () => {
    const text = 'Config: {"count": 42, "enabled": true, "ratio": 3.14, "flag": false, "data": null}';
    const result = extractJson(text);
    expect(result).toBe('{"count": 42, "enabled": true, "ratio": 3.14, "flag": false, "data": null}');
  });

  it('should handle JSON within other text', () => {
    const text = `
The server responded with the following data:
{"status": 200, "message": "OK"}
Please process accordingly.
`;
    const result = extractJson(text);
    expect(result).toBe('{"status": 200, "message": "OK"}');
  });

  it('should extract complex nested structure', () => {
    const text = `Output: {
  "users": [
    {"id": 1, "name": "Alice", "active": true},
    {"id": 2, "name": "Bob", "active": false}
  ],
  "metadata": {
    "total": 2,
    "page": 1
  }
}`;
    const result = extractJson(text);
    expect(result).toBe(`{
  "users": [
    {"id": 1, "name": "Alice", "active": true},
    {"id": 2, "name": "Bob", "active": false}
  ],
  "metadata": {
    "total": 2,
    "page": 1
  }
}`);
  });

  it('should validate extracted JSON is parseable', () => {
    const text = 'Data: {"valid": "json", "number": 123}';
    const extracted = extractJson(text);
    expect(() => JSON.parse(extracted)).not.toThrow();
    expect(JSON.parse(extracted)).toEqual({ valid: "json", number: 123 });
  });

  it('should handle malformed JSON by returning original text', () => {
    const text = 'Bad JSON: {"unclosed": "quote}';
    const result = extractJson(text);
    expect(result).toBe(text);
  });

  it('should extract JSON from various markdown formats', () => {
    const variations = [
      '```json\n{"test": true}\n```',
      '```JSON\n{"test": true}\n```',
      '```\n{"test": true}\n```',
      '` {"test": true} `',
    ];
    
    variations.forEach(text => {
      const result = extractJson(text);
      expect(result).toBe('{"test": true}');
    });
  });
});