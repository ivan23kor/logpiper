import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { existsSync, statSync } from 'fs';
import type { LogEntry, PaginationResult } from './types.js';

export interface LogReaderOptions {
  maxChunkSize?: number; // Maximum response size in bytes
  defaultLimit?: number;
}

export class LogReader {
  private options: Required<LogReaderOptions>;

  constructor(options: LogReaderOptions = {}) {
    this.options = {
      maxChunkSize: options.maxChunkSize ?? 1024 * 1024, // 1MB default
      defaultLimit: options.defaultLimit ?? 100,
    };
  }

  /**
   * Read logs with cursor-based pagination using streaming
   * @param filePath Path to the .logs file
   * @param cursor Starting line number (0-based, exclusive)
   * @param limit Maximum number of entries to return
   * @param reverse Read in reverse order (latest first)
   */
  async readLogsPaginated(
    filePath: string,
    cursor: number = 0,
    limit: number = this.options.defaultLimit,
    reverse: boolean = false
  ): Promise<PaginationResult<LogEntry>> {
    if (!existsSync(filePath)) {
      return {
        data: [],
        total: 0,
        hasMore: false,
        hasPrevious: false,
      };
    }

    if (reverse) {
      return this.readLogsReverse(filePath, cursor, limit);
    }

    return this.readLogsForward(filePath, cursor, limit);
  }

  /**
   * Search logs with pagination using streaming
   */
  async searchLogsPaginated(
    filePath: string,
    query: string,
    cursor: number = 0,
    limit: number = this.options.defaultLimit
  ): Promise<PaginationResult<LogEntry>> {
    if (!existsSync(filePath)) {
      return {
        data: [],
        total: 0,
        hasMore: false,
        hasPrevious: false,
      };
    }

    const results: LogEntry[] = [];
    const lowerQuery = query.toLowerCase();
    let currentLine = 0;
    let matchCount = 0;
    let foundCount = 0;
    let responseSize = 0;

    return new Promise((resolve, reject) => {
      const fileStream = createReadStream(filePath);
      const rl = createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      });

      rl.on('line', (line) => {
        currentLine++;
        
        if (line.trim() === '') return;

        try {
          const entry = JSON.parse(line) as LogEntry;
          entry.timestamp = new Date(entry.timestamp);

          // Check if this line matches the search query
          const matches = entry.content.toLowerCase().includes(lowerQuery) ||
                         entry.command.toLowerCase().includes(lowerQuery);

          if (matches) {
            matchCount++;
            
            // Skip results before cursor
            if (matchCount <= cursor) return;
            
            // Check if we've reached the limit
            if (foundCount >= limit) {
              rl.close();
              return;
            }

            // Check response size
            const entrySize = JSON.stringify(entry).length;
            if (responseSize + entrySize > this.options.maxChunkSize && results.length > 0) {
              rl.close();
              return;
            }

            results.push(entry);
            responseSize += entrySize;
            foundCount++;
          }
        } catch (error) {
          // Skip invalid JSON lines
        }
      });

      rl.on('close', () => {
        resolve({
          data: results,
          total: matchCount,
          nextCursor: matchCount > cursor + foundCount ? cursor + foundCount : undefined,
          prevCursor: cursor > 0 ? Math.max(0, cursor - limit) : undefined,
          hasMore: matchCount > cursor + foundCount,
          hasPrevious: cursor > 0,
        });
      });

      rl.on('error', reject);
    });
  }

  /**
   * Get total line count efficiently
   */
  async getLogCount(filePath: string): Promise<number> {
    if (!existsSync(filePath)) {
      return 0;
    }

    let lineCount = 0;

    return new Promise((resolve, reject) => {
      const fileStream = createReadStream(filePath);
      const rl = createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      });

      rl.on('line', () => {
        lineCount++;
      });

      rl.on('close', () => {
        resolve(lineCount);
      });

      rl.on('error', reject);
    });
  }

  /**
   * Get new logs since cursor (optimized for tailing)
   */
  async getNewLogs(
    filePath: string,
    since: number,
    limit: number = this.options.defaultLimit
  ): Promise<PaginationResult<LogEntry>> {
    if (!existsSync(filePath)) {
      return {
        data: [],
        total: 0,
        hasMore: false,
        hasPrevious: false,
      };
    }

    const results: LogEntry[] = [];
    let currentLine = 0;
    let totalLines = 0;
    let responseSize = 0;

    return new Promise((resolve, reject) => {
      const fileStream = createReadStream(filePath);
      const rl = createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      });

      rl.on('line', (line) => {
        currentLine++;
        totalLines++;
        
        if (line.trim() === '') return;
        
        // Skip lines before cursor
        if (currentLine <= since) return;

        // Check if we've reached the limit
        if (results.length >= limit) {
          rl.close();
          return;
        }

        try {
          const entry = JSON.parse(line) as LogEntry;
          entry.timestamp = new Date(entry.timestamp);

          // Check response size
          const entrySize = JSON.stringify(entry).length;
          if (responseSize + entrySize > this.options.maxChunkSize && results.length > 0) {
            rl.close();
            return;
          }

          results.push(entry);
          responseSize += entrySize;
        } catch (error) {
          // Skip invalid JSON lines
        }
      });

      rl.on('close', () => {
        const nextCursor = results.length > 0 
          ? Math.max(...results.map(l => l.lineNumber))
          : since;

        resolve({
          data: results,
          total: totalLines - since,
          nextCursor: totalLines > since + results.length ? nextCursor : undefined,
          hasMore: totalLines > since + results.length,
          hasPrevious: since > 0,
        });
      });

      rl.on('error', reject);
    });
  }

  /**
   * Read logs in forward direction
   */
  private async readLogsForward(
    filePath: string,
    cursor: number,
    limit: number
  ): Promise<PaginationResult<LogEntry>> {
    const results: LogEntry[] = [];
    let currentLine = 0;
    let totalLines = 0;
    let responseSize = 0;

    return new Promise((resolve, reject) => {
      const fileStream = createReadStream(filePath);
      const rl = createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      });

      rl.on('line', (line) => {
        currentLine++;
        totalLines++;
        
        if (line.trim() === '') return;
        
        // Skip lines before cursor
        if (currentLine <= cursor) return;

        // Check if we've reached the limit
        if (results.length >= limit) {
          rl.close();
          return;
        }

        try {
          const entry = JSON.parse(line) as LogEntry;
          entry.timestamp = new Date(entry.timestamp);

          // Check response size
          const entrySize = JSON.stringify(entry).length;
          if (responseSize + entrySize > this.options.maxChunkSize && results.length > 0) {
            rl.close();
            return;
          }

          results.push(entry);
          responseSize += entrySize;
        } catch (error) {
          // Skip invalid JSON lines
        }
      });

      rl.on('close', () => {
        const nextCursor = results.length > 0 
          ? results[results.length - 1].lineNumber
          : cursor;

        resolve({
          data: results,
          total: totalLines,
          nextCursor: totalLines > cursor + results.length ? nextCursor : undefined,
          prevCursor: cursor > 0 ? Math.max(0, cursor - limit) : undefined,
          hasMore: totalLines > cursor + results.length,
          hasPrevious: cursor > 0,
        });
      });

      rl.on('error', reject);
    });
  }

  /**
   * Read logs in reverse direction (latest first)
   */
  private async readLogsReverse(
    filePath: string,
    cursor: number,
    limit: number
  ): Promise<PaginationResult<LogEntry>> {
    // For reverse reading, we need to read all lines first to determine total count
    // Then read from the appropriate position
    const totalCount = await this.getLogCount(filePath);
    
    if (totalCount === 0) {
      return {
        data: [],
        total: 0,
        hasMore: false,
        hasPrevious: false,
      };
    }

    // Calculate the actual start position for reverse reading
    const startLine = cursor === 0 ? totalCount - limit : cursor - limit;
    const endLine = cursor === 0 ? totalCount : cursor;

    const results: LogEntry[] = [];
    let currentLine = 0;
    let responseSize = 0;

    return new Promise((resolve, reject) => {
      const fileStream = createReadStream(filePath);
      const rl = createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      });

      rl.on('line', (line) => {
        currentLine++;
        
        if (line.trim() === '') return;
        
        // Only include lines in our target range
        if (currentLine <= Math.max(0, startLine) || currentLine > endLine) return;

        try {
          const entry = JSON.parse(line) as LogEntry;
          entry.timestamp = new Date(entry.timestamp);

          // Check response size
          const entrySize = JSON.stringify(entry).length;
          if (responseSize + entrySize > this.options.maxChunkSize && results.length > 0) {
            rl.close();
            return;
          }

          results.push(entry);
          responseSize += entrySize;
        } catch (error) {
          // Skip invalid JSON lines
        }
      });

      rl.on('close', () => {
        // Reverse the results for latest-first order
        results.reverse();

        const nextCursor = endLine < totalCount ? endLine + limit : undefined;
        const prevCursor = startLine > 0 ? Math.max(0, startLine) : undefined;

        resolve({
          data: results,
          total: totalCount,
          nextCursor,
          prevCursor,
          hasMore: endLine < totalCount,
          hasPrevious: startLine > 0,
        });
      });

      rl.on('error', reject);
    });
  }

  /**
   * Estimate response size for auto-chunking
   */
  private estimateResponseSize(entries: LogEntry[]): number {
    return JSON.stringify(entries).length;
  }
}