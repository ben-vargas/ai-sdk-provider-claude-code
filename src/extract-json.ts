/**
 * Extracts JSON from Claude's response, handling various formatting patterns.
 * Attempts to parse and clean the response to extract valid JSON for object generation.
 * 
 * @param text - The raw text response from Claude that may contain JSON
 * @returns The extracted JSON string, or the original text if extraction fails
 * 
 * @example
 * ```typescript
 * const response = '```json\n{"name": "Alice", "age": 30}\n```';
 * const json = extractJson(response);
 * // Returns: '{"name": "Alice", "age": 30}'
 * ```
 * 
 * @remarks
 * This function handles:
 * - Markdown code blocks (```json and ```)
 * - JavaScript variable declarations (const, let, var)
 * - Trailing semicolons
 * - Unquoted object keys (basic conversion)
 * - Single quotes to double quotes conversion
 */
export function extractJson(text: string): string {
  // Remove markdown code blocks if present
  let jsonText = text.trim();
  
  // Remove ```json blocks
  jsonText = jsonText.replace(/^```json\s*/gm, '');
  jsonText = jsonText.replace(/^```\s*/gm, '');
  jsonText = jsonText.replace(/```\s*$/gm, '');
  
  // Remove common TypeScript/JavaScript patterns
  jsonText = jsonText.replace(/^const\s+\w+\s*=\s*/, ''); // Remove "const varName = "
  jsonText = jsonText.replace(/^let\s+\w+\s*=\s*/, ''); // Remove "let varName = "
  jsonText = jsonText.replace(/^var\s+\w+\s*=\s*/, ''); // Remove "var varName = "
  jsonText = jsonText.replace(/;?\s*$/, ''); // Remove trailing semicolons
  
  // Try to extract JSON object or array
  const objectMatch = jsonText.match(/{[\s\S]*}/);
  const arrayMatch = jsonText.match(/\[[\s\S]*\]/);
  
  if (objectMatch) {
    jsonText = objectMatch[0];
  } else if (arrayMatch) {
    jsonText = arrayMatch[0];
  }
  
  // First try to parse as valid JSON
  try {
    JSON.parse(jsonText);
    return jsonText;
  } catch {
    // If it's not valid JSON, it might be a JavaScript object literal
    // Try to convert it to valid JSON
    try {
      // This is a simple conversion that handles basic cases
      // Replace unquoted keys with quoted keys
      const converted = jsonText
        .replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":')
        // Replace single quotes with double quotes
        .replace(/'/g, '"');
      
      // Validate the converted JSON
      JSON.parse(converted);
      return converted;
    } catch {
      // If all else fails, return the original text
      // The AI SDK will handle the error appropriately
      return text;
    }
  }
}