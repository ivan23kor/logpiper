#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { LogManager } from './log-manager.js';
import { ErrorDetector } from './error-detector.js';
import { NotificationSystem } from './notification.js';
import { TokenLimiter } from './token-limiter.js';
import type { LogEntry, LogSession } from './types.js';

class LogPiperMcpServer {
  private server: Server;
  private logManager: LogManager;
  private errorDetector: ErrorDetector;
  private notificationSystem: NotificationSystem;

  constructor() {
    this.logManager = new LogManager();
    this.errorDetector = new ErrorDetector();
    this.notificationSystem = new NotificationSystem();

    this.server = new Server(
      {
        name: 'logpiper-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    this.setupRequestHandlers();
    this.setupIncomingLogHandlers();
    this.startCleanupTimer();
  }

  private setupRequestHandlers(): void {
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      const sessions = this.logManager.getActiveSessions();

      return {
        resources: sessions.map(session => ({
          uri: `logpiper://logs/${session.id}`,
          name: `${session.command} logs`,
          description: `Logs for ${session.command} in ${session.projectDir}`,
          mimeType: 'text/plain',
        })).concat([
          {
            uri: 'logpiper://sessions/active',
            name: 'Active Sessions',
            description: 'List of currently active logging sessions',
            mimeType: 'application/json',
          },
          {
            uri: 'logpiper://sessions/overview',
            name: 'Sessions Overview',
            description: 'Overview statistics of all sessions',
            mimeType: 'application/json',
          }
        ]),
      };
    });

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;

      if (uri.startsWith('logpiper://logs/')) {
        const sessionId = uri.replace('logpiper://logs/', '');
        const session = this.logManager.getSession(sessionId);

        if (!session) {
          throw new McpError(ErrorCode.InvalidRequest, `Session ${sessionId} not found`);
        }

        // Use paginated approach to avoid memory issues with huge logs
        const maxResourceSize = 500 * 1024; // 500KB limit for resource content
        let logContent = '';
        let cursor = 0;
        let totalLogs = 0;
        const limit = 1000; // Process in batches

        try {
          const totalCount = await this.logManager.getLogCount(sessionId);
          totalLogs = totalCount;

          // If logs are small enough, get them all
          if (totalCount <= 5000) { // Estimated threshold
            const result = await this.logManager.getLogsPaginated(sessionId, 0, totalCount);
            logContent = result.data
              .map(log => `[${log.timestamp.toISOString()}] [${log.logLevel.toUpperCase()}] ${log.content}`)
              .join('\n');
          } else {
            // For large logs, get recent ones and add a message
            const result = await this.logManager.getLogsPaginated(sessionId, 0, 2000, true);
            logContent = `# LogPiper: Large log file detected (${totalCount} entries)
# Showing most recent 2000 entries. Use MCP tools for paginated access.
# Available tools: get_logs_paginated, search_logs

` + result.data
              .map(log => `[${log.timestamp.toISOString()}] [${log.logLevel.toUpperCase()}] ${log.content}`)
              .join('\n');
          }

          // Check if content is still too large
          if (logContent.length > maxResourceSize) {
            const truncatedContent = logContent.substring(0, maxResourceSize - 500);
            logContent = truncatedContent + '\n\n# Content truncated due to size limits. Use MCP tools for full access.';
          }

          return {
            contents: [{
              uri,
              mimeType: 'text/plain',
              text: logContent,
            }],
          };
        } catch (error) {
          // Fallback to error message if pagination fails
          return {
            contents: [{
              uri,
              mimeType: 'text/plain',
              text: `# Error loading logs for session ${sessionId}: ${error}\n# Use MCP tools like get_logs_paginated for access.`,
            }],
          };
        }
      }

      if (uri === 'logpiper://sessions/active') {
        const activeSessions = this.logManager.getActiveSessions();
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(activeSessions, null, 2),
          }],
        };
      }

      if (uri === 'logpiper://sessions/overview') {
        const overview = this.logManager.getSessionsOverview();
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(overview, null, 2),
          }],
        };
      }

      throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${uri}`);
    });

    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'get_new_logs',
            description: 'Get new logs since a specific cursor position (streaming)',
            inputSchema: {
              type: 'object',
              properties: {
                sessionId: {
                  type: 'string',
                  description: 'Session ID to get logs from. If not provided, returns from all active sessions.',
                },
                since: {
                  type: 'number',
                  description: 'Line number cursor to get logs after. Defaults to 0.',
                  default: 0,
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of log entries to return',
                  default: 100,
                },
                consumeLogs: {
                  type: 'boolean',
                  description: 'Whether to remove logs after fetching them (default: true)',
                  default: true,
                },
              },
            },
          },
          {
            name: 'list_sessions',
            description: 'List all logging sessions with metadata',
            inputSchema: {
              type: 'object',
              properties: {
                status: {
                  type: 'string',
                  enum: ['running', 'stopped', 'crashed', 'all'],
                  description: 'Filter sessions by status',
                  default: 'all',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of sessions to return',
                  default: 100,
                },
                offset: {
                  type: 'number',
                  description: 'Number of sessions to skip (for pagination)',
                  default: 0,
                },
              },
            },
          },
          {
            name: 'search_logs',
            description: 'Search through logs with a query string',
            inputSchema: {
              type: 'object',
              properties: {
                sessionId: {
                  type: 'string',
                  description: 'Session ID to search in. If not provided, searches all sessions.',
                },
                query: {
                  type: 'string',
                  description: 'Search query string',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results to return',
                  default: 50,
                },
                offset: {
                  type: 'number',
                  description: 'Number of results to skip (for pagination)',
                  default: 0,
                },
              },
              required: ['query'],
            },
          },
          {
            name: 'get_logs_paginated',
            description: 'Get logs with cursor-based pagination and automatic chunking',
            inputSchema: {
              type: 'object',
              properties: {
                sessionId: {
                  type: 'string',
                  description: 'Session ID to get logs from',
                },
                cursor: {
                  type: 'number',
                  description: 'Starting cursor position (line number). Defaults to 0.',
                  default: 0,
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of log entries to return',
                  default: 100,
                },
                reverse: {
                  type: 'boolean',
                  description: 'Read in reverse order (latest first)',
                  default: false,
                },
                consumeLogs: {
                  type: 'boolean',
                  description: 'Whether to remove logs after fetching them (default: true)',
                  default: true,
                },
              },
              required: ['sessionId'],
            },
          },
          {
            name: 'cleanup_sessions',
            description: 'Cleanup sessions: intelligent cleanup based on criteria or complete reset of all data',
            inputSchema: {
              type: 'object',
              properties: {
                mode: {
                  type: 'string',
                  enum: ['smart', 'all'],
                  description: 'Cleanup mode: "smart" for intelligent cleanup, "all" for complete reset',
                  default: 'smart',
                },
                dryRun: {
                  type: 'boolean',
                  description: 'Show what would be cleaned up without actually deleting (smart mode only)',
                  default: false,
                },
                force: {
                  type: 'boolean',
                  description: 'Use aggressive cleanup criteria (smart mode) or skip confirmation (all mode)',
                  default: false,
                },
                confirm: {
                  type: 'boolean',
                  description: 'Must be true for "all" mode to confirm destructive operation',
                },
              },
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case 'get_new_logs':
          return this.handleGetNewLogs(args as any);
        case 'list_sessions':
          return this.handleListSessions(args as any);
        case 'search_logs':
          return this.handleSearchLogs(args as any);
        case 'get_logs_paginated':
          return this.handleGetLogsPaginated(args as any);
        case 'cleanup_sessions':
          return this.handleCleanupSessions(args as any);
        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    });
  }

  private async handleGetNewLogs(args: {
    sessionId?: string;
    since?: number;
    limit?: number;
    consumeLogs?: boolean;
  }) {
    const { sessionId, since = 0, limit = 100, consumeLogs = true } = args;

    if (sessionId) {
      const result = await this.logManager.getNewLogs(sessionId, since, limit);

      // Update read cursor to track what has been read
      if (result.data.length > 0) {
        const maxLineNumber = Math.max(...result.data.map(log => log.lineNumber));
        this.updateSessionReadCursor(sessionId, maxLineNumber);

        // Remove consumed logs if requested
        if (consumeLogs) {
          await this.removeConsumedLogs(sessionId, maxLineNumber);
        }
      }

      return {
        content: [this.applyTokenLimit({
          sessionId,
          logs: result.data,
          total: result.total,
          nextCursor: result.nextCursor,
          hasMore: result.hasMore,
          hasPrevious: result.hasPrevious,
          logsConsumed: consumeLogs && result.data.length > 0,
        })],
      };
    } else {
      const activeSessions = this.logManager.getActiveSessions();
      const allResults: LogEntry[] = [];
      let totalCount = 0;

      for (const session of activeSessions) {
        const result = await this.logManager.getNewLogs(session.id, since, limit);
        allResults.push(...result.data);
        totalCount += result.total;

        // Update read cursor and remove consumed logs for each session
        if (result.data.length > 0) {
          const maxLineNumber = Math.max(...result.data.map(log => log.lineNumber));
          this.updateSessionReadCursor(session.id, maxLineNumber);

          if (consumeLogs) {
            await this.removeConsumedLogs(session.id, maxLineNumber);
          }
        }
      }

      allResults.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      // Apply final pagination to merged results
      const finalResults = allResults.slice(0, limit);
      const hasMore = allResults.length > limit;

      return {
        content: [this.applyTokenLimit({
          logs: finalResults,
          total: totalCount,
          nextCursor: finalResults.length > 0 ? Math.max(...finalResults.map(l => l.lineNumber)) : since,
          hasMore,
          hasPrevious: since > 0,
          logsConsumed: consumeLogs && finalResults.length > 0,
        })],
      };
    }
  }

  private async handleListSessions(args: {
    status?: string;
    limit?: number;
    offset?: number;
  }) {
    const { status = 'all', limit = 100, offset = 0 } = args;
    let sessions = this.logManager.listSessions();

    if (status !== 'all') {
      sessions = sessions.filter(s => s.status === status);
    }

    const paginatedSessions = sessions.slice(offset, offset + limit);
    const hasMore = offset + limit < sessions.length;

    return {
      content: [this.applyTokenLimit({
        sessions: paginatedSessions.map(session => ({
          ...session,
          stats: this.logManager.getSessionStats(session.id),
        })),
        total: sessions.length,
        offset,
        limit,
        hasMore,
        nextOffset: hasMore ? offset + limit : null,
      })],
    };
  }


  private async handleSearchLogs(args: {
    sessionId?: string;
    query: string;
    limit?: number;
    offset?: number;
  }) {
    const { sessionId, query, limit = 50, offset = 0 } = args;

    if (sessionId) {
      const result = await this.logManager.searchLogs(sessionId, query, offset, limit);

      return {
        content: [this.applyTokenLimit({
          sessionId,
          query,
          results: result.data,
          total: result.total,
          offset,
          limit,
          hasMore: result.hasMore,
          hasPrevious: result.hasPrevious,
          nextOffset: result.nextCursor,
          prevOffset: result.prevCursor,
        })],
      };
    } else {
      const sessions = this.logManager.getActiveSessions();
      const allResults: LogEntry[] = [];
      let totalCount = 0;

      for (const session of sessions) {
        const result = await this.logManager.searchLogs(session.id, query, offset, limit);
        allResults.push(...result.data);
        totalCount += result.total;
      }

      allResults.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

      // Apply final pagination to merged results
      const finalResults = allResults.slice(0, limit);
      const hasMore = allResults.length > limit;

      return {
        content: [this.applyTokenLimit({
          query,
          results: finalResults,
          total: totalCount,
          offset,
          limit,
          hasMore,
          hasPrevious: offset > 0,
          nextOffset: hasMore ? offset + limit : null,
          prevOffset: offset > 0 ? Math.max(0, offset - limit) : null,
        })],
      };
    }
  }



  private async handleGetLogsPaginated(args: {
    sessionId: string;
    cursor?: number;
    limit?: number;
    reverse?: boolean;
    consumeLogs?: boolean;
  }) {
    const { sessionId, cursor = 0, limit = 100, reverse = false, consumeLogs = true } = args;

    const result = await this.logManager.getLogsPaginated(sessionId, cursor, limit, reverse);

    // Update read cursor to track what has been read
    if (result.data.length > 0) {
      const maxLineNumber = Math.max(...result.data.map(log => log.lineNumber));
      this.updateSessionReadCursor(sessionId, maxLineNumber);

      // Remove consumed logs if requested
      if (consumeLogs) {
        await this.removeConsumedLogs(sessionId, maxLineNumber);
      }
    }

    return {
      content: [this.applyTokenLimit({
        sessionId,
        logs: result.data,
        total: result.total,
        cursor,
        limit,
        reverse,
        nextCursor: result.nextCursor,
        prevCursor: result.prevCursor,
        hasMore: result.hasMore,
        hasPrevious: result.hasPrevious,
        logsConsumed: consumeLogs && result.data.length > 0,
      })],
    };
  }


  private async handleCleanupSessions(args: {
    mode?: 'smart' | 'all';
    dryRun?: boolean;
    force?: boolean;
    confirm?: boolean;
  }) {
    const { mode = 'smart', dryRun = false, force = false, confirm } = args;

    if (mode === 'all') {
      // Complete reset mode
      if (!confirm && !force) {
        return {
          content: [this.applyTokenLimit({
            success: false,
            message: 'Reset operation cancelled - confirm parameter must be set to true',
            warning: 'This operation will delete ALL sessions and logs permanently',
            mode: 'all',
          })],
        };
      }

      const result = this.logManager.resetAllSessions();
      return {
        content: [this.applyTokenLimit({
          ...result,
          operation: 'cleanup_sessions',
          mode: 'all',
          timestamp: new Date().toISOString(),
        })],
      };
    } else {
      // Smart cleanup mode
      const result = this.logManager.cleanupOldSessions(dryRun, force);
      return {
        content: [this.applyTokenLimit({
          ...result,
          operation: 'cleanup_sessions',
          mode: 'smart',
          dryRun,
          force,
          timestamp: new Date().toISOString(),
        })],
      };
    }
  }





  private setupIncomingLogHandlers(): void {
    // Handle incoming data from CLI instances
    process.stdin.on('data', (data) => {
      try {
        const message = JSON.parse(data.toString().trim());
        this.handleIncomingMessage(message);
      } catch (error) {
        console.error('Failed to parse incoming message:', error);
      }
    });
  }

  private async handleIncomingMessage(message: any): Promise<void> {
    switch (message.type) {
      case 'session_start':
        this.logManager.createSession(
          message.data.projectDir,
          message.data.command,
          message.data.args
        );
        break;

      case 'log_entry':
        const logEntry: LogEntry = message.data;
        this.logManager.addLog(logEntry);

        const errorEvent = this.errorDetector.analyzeLog(logEntry);
        if (errorEvent) {
          await this.notificationSystem.sendErrorNotification(errorEvent);
        }
        break;

      case 'session_end':
        this.logManager.updateSession(message.data.sessionId, {
          status: 'stopped',
          endTime: new Date(message.data.endTime),
        });
        break;

      case 'process_error':
        this.logManager.updateSession(message.data.sessionId, {
          status: 'crashed',
        });
        break;

      case 'session_interrupt':
        this.logManager.updateSession(message.data.sessionId, {
          status: 'stopped',
          endTime: new Date(message.data.timestamp),
        });
        break;
    }
  }

  /**
   * Update the read cursor for a session to track which logs have been read
   */
  private updateSessionReadCursor(sessionId: string, lineNumber: number): void {
    try {
      const { join } = require('path');
      const { tmpdir } = require('os');
      const fs = require('fs');
      
      const sessionFile = join(tmpdir(), 'logpiper', `${sessionId}.json`);
      if (fs.existsSync(sessionFile)) {
        const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
        if (lineNumber > sessionData.readCursor) {
          sessionData.readCursor = lineNumber;
          sessionData.lastActivity = new Date().toISOString();
          fs.writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2));
        }
      }
    } catch (error) {
      // Silently fail - not critical for functionality
    }
  }

  /**
   * Apply token limiting to MCP response content
   */
  private applyTokenLimit(responseData: any): any {
    const jsonString = JSON.stringify(responseData, null, 2);
    const limitResult = TokenLimiter.limitJsonResponse(jsonString);
    
    if (limitResult.truncated) {
      console.error(`Response truncated: ${limitResult.originalTokens} → ${limitResult.finalTokens} tokens (limit: 25,000)`);
    }
    
    return {
      type: 'text',
      text: limitResult.content,
    };
  }

  /**
   * Remove consumed logs up to a specific line number
   */
  private async removeConsumedLogs(sessionId: string, upToLineNumber: number): Promise<void> {
    try {
      const { join } = require('path');
      const { tmpdir } = require('os');
      const fs = require('fs');
      
      const logsFile = join(tmpdir(), 'logpiper', `${sessionId}.logs`);
      if (!fs.existsSync(logsFile)) {
        return;
      }

      // Read all logs
      const content = fs.readFileSync(logsFile, 'utf8');
      const lines = content.trim().split('\n').filter((line: string) => line.length > 0);
      
      // Filter out consumed logs (those with lineNumber <= upToLineNumber)
      const remainingLines = lines.filter((line: string) => {
        try {
          const logEntry = JSON.parse(line);
          return logEntry.lineNumber > upToLineNumber;
        } catch {
          return true; // Keep malformed lines
        }
      });

      // Write back only the remaining logs
      if (remainingLines.length === 0) {
        // If no logs remain, delete the file to free up space
        fs.unlinkSync(logsFile);
      } else {
        fs.writeFileSync(logsFile, remainingLines.join('\n') + '\n');
      }

      console.error(`Removed ${lines.length - remainingLines.length} consumed log entries for session ${sessionId}`);
    } catch (error) {
      console.error(`Failed to remove consumed logs for session ${sessionId}:`, error);
    }
  }

  private startCleanupTimer(): void {
    // Run initial cleanup on startup
    this.logManager.cleanup();
    
    // Schedule regular cleanups
    setInterval(() => {
      this.logManager.cleanup();
    }, 15 * 60 * 1000); // Cleanup every 15 minutes
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('logpiper-mcp server started');
  }
}

const server = new LogPiperMcpServer();
server.start().catch((error) => {
  console.error('Failed to start logpiper-mcp server:', error);
  process.exit(1);
});