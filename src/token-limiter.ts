/**
 * Token limiting utility for LogPiper MCP responses
 * Provides approximate token counting and content truncation
 */

export interface TokenLimitResult {
  content: string;
  truncated: boolean;
  originalTokens: number;
  finalTokens: number;
  truncatedAt: number; // Character position where truncation occurred
}

/**
 * Approximate token counter based on OpenAI tokenization rules
 * Uses a simplified heuristic: ~4 characters per token for most text
 * JSON structure adds overhead, so we use a slightly lower ratio
 */
export class TokenLimiter {
  private static readonly CHARS_PER_TOKEN = 3.5; // Conservative estimate for JSON content
  private static readonly MAX_TOKENS = 25000;
  
  /**
   * Estimates token count for given text
   */
  static estimateTokens(text: string): number {
    return Math.ceil(text.length / this.CHARS_PER_TOKEN);
  }
  
  /**
   * Limits JSON string to maximum token count, preserving structure where possible
   */
  static limitJsonResponse(jsonString: string, maxTokens: number = this.MAX_TOKENS): TokenLimitResult {
    const originalTokens = this.estimateTokens(jsonString);
    
    if (originalTokens <= maxTokens) {
      return {
        content: jsonString,
        truncated: false,
        originalTokens,
        finalTokens: originalTokens,
        truncatedAt: -1,
      };
    }
    
    // Calculate target character count
    const targetChars = Math.floor(maxTokens * this.CHARS_PER_TOKEN * 0.9); // 10% buffer for safety
    
    // Try to parse and truncate intelligently
    try {
      const parsed = JSON.parse(jsonString);
      const truncated = this.truncateJsonObject(parsed, targetChars);
      const truncatedString = JSON.stringify(truncated, null, 2);
      
      return {
        content: truncatedString,
        truncated: true,
        originalTokens,
        finalTokens: this.estimateTokens(truncatedString),
        truncatedAt: truncatedString.length,
      };
    } catch (error) {
      // Fallback to simple string truncation if JSON parsing fails
      const truncatedString = jsonString.substring(0, targetChars) + '\n\n  "...": "Content truncated due to 25,000 token limit"\n}';
      
      return {
        content: truncatedString,
        truncated: true,
        originalTokens,
        finalTokens: this.estimateTokens(truncatedString),
        truncatedAt: targetChars,
      };
    }
  }
  
  /**
   * Intelligently truncates JSON object to fit within character limit
   */
  private static truncateJsonObject(obj: any, maxChars: number): any {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }
    
    if (Array.isArray(obj)) {
      return this.truncateJsonArray(obj, maxChars);
    }
    
    const result: any = {};
    let currentSize = 0;
    const overhead = JSON.stringify({}).length; // Basic object overhead
    
    // Priority order for preserving fields
    const priorityFields = ['sessionId', 'total', 'hasMore', 'nextCursor', 'truncated'];
    const dataFields = ['logs', 'results', 'sessions', 'data'];
    
    // Add priority fields first
    for (const key of priorityFields) {
      if (key in obj) {
        const fieldSize = JSON.stringify({ [key]: obj[key] }).length;
        if (currentSize + fieldSize + overhead < maxChars) {
          result[key] = obj[key];
          currentSize += fieldSize;
        }
      }
    }
    
    // Add other fields except data arrays
    for (const [key, value] of Object.entries(obj)) {
      if (priorityFields.includes(key) || dataFields.includes(key)) {
        continue;
      }
      
      const fieldSize = JSON.stringify({ [key]: value }).length;
      if (currentSize + fieldSize + overhead < maxChars) {
        result[key] = value;
        currentSize += fieldSize;
      }
    }
    
    // Add data arrays with truncation
    for (const key of dataFields) {
      if (key in obj && Array.isArray(obj[key])) {
        const remainingChars = maxChars - currentSize - overhead - 100; // Buffer for truncation message
        if (remainingChars > 100) {
          result[key] = this.truncateJsonArray(obj[key], remainingChars);
          result.truncated = true;
          result.truncationNote = `Array "${key}" truncated due to token limits. Use pagination for full results.`;
        }
        break; // Only process first data array to stay under limit
      }
    }
    
    return result;
  }
  
  /**
   * Truncates array to fit within character limit
   */
  private static truncateJsonArray(arr: any[], maxChars: number): any[] {
    if (!Array.isArray(arr) || arr.length === 0) {
      return arr;
    }
    
    const result: any[] = [];
    let currentSize = JSON.stringify([]).length; // Array overhead
    
    for (const item of arr) {
      const itemSize = JSON.stringify(item).length + 1; // +1 for comma
      if (currentSize + itemSize < maxChars) {
        result.push(item);
        currentSize += itemSize;
      } else {
        break;
      }
    }
    
    return result;
  }
}