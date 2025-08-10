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
            const result = await this.logManager.getRecentLogsPaginated(sessionId, 2000);
            logContent = `# LogPiper: Large log file detected (${totalCount} entries)
# Showing most recent 2000 entries. Use MCP tools for paginated access.
# Available tools: get_logs_paginated, get_recent_logs, search_logs

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
            name: 'get_session_info',
            description: 'Get detailed information about a specific session',
            inputSchema: {
              type: 'object',
              properties: {
                sessionId: {
                  type: 'string',
                  description: 'Session ID to get information for',
                },
              },
              required: ['sessionId'],
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
            name: 'acknowledge_error',
            description: 'Mark an error as acknowledged',
            inputSchema: {
              type: 'object',
              properties: {
                errorId: {
                  type: 'string',
                  description: 'ID of the error to acknowledge',
                },
              },
              required: ['errorId'],
            },
          },
          {
            name: 'get_error_history',
            description: 'Get recent errors for a session',
            inputSchema: {
              type: 'object',
              properties: {
                sessionId: {
                  type: 'string',
                  description: 'Session ID to get errors for',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of errors to return',
                  default: 10,
                },
              },
              required: ['sessionId'],
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
              },
              required: ['sessionId'],
            },
          },
          {
            name: 'get_recent_logs',
            description: 'Get recent logs (latest first) with pagination',
            inputSchema: {
              type: 'object',
              properties: {
                sessionId: {
                  type: 'string',
                  description: 'Session ID to get logs from',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of log entries to return',
                  default: 50,
                },
              },
              required: ['sessionId'],
            },
          },
          {
            name: 'reset_all_sessions',
            description: 'Reset all sessions and logs - completely clears all LogPiper data',
            inputSchema: {
              type: 'object',
              properties: {
                confirm: {
                  type: 'boolean',
                  description: 'Must be set to true to confirm the destructive operation',
                },
              },
              required: ['confirm'],
            },
          },
          {
            name: 'reset_session',
            description: 'Reset a specific session - removes session and its logs',
            inputSchema: {
              type: 'object',
              properties: {
                sessionId: {
                  type: 'string',
                  description: 'Session ID to reset',
                },
              },
              required: ['sessionId'],
            },
          },
          {
            name: 'clear_session_logs',
            description: 'Clear logs for a session while keeping session metadata',
            inputSchema: {
              type: 'object',
              properties: {
                sessionId: {
                  type: 'string',
                  description: 'Session ID to clear logs for',
                },
              },
              required: ['sessionId'],
            },
          },
          {
            name: 'reset_sessions_by_criteria',
            description: 'Reset sessions matching specific criteria',
            inputSchema: {
              type: 'object',
              properties: {
                status: {
                  type: 'string',
                  enum: ['running', 'stopped', 'crashed'],
                  description: 'Reset sessions with this status',
                },
                olderThanDays: {
                  type: 'number',
                  description: 'Reset sessions older than this many days',
                },
                projectDir: {
                  type: 'string',
                  description: 'Reset sessions from this project directory',
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
        case 'get_session_info':
          return this.handleGetSessionInfo(args as any);
        case 'search_logs':
          return this.handleSearchLogs(args as any);
        case 'acknowledge_error':
          return this.handleAcknowledgeError(args as any);
        case 'get_error_history':
          return this.handleGetErrorHistory(args as any);
        case 'get_logs_paginated':
          return this.handleGetLogsPaginated(args as any);
        case 'get_recent_logs':
          return this.handleGetRecentLogs(args as any);
        case 'reset_all_sessions':
          return this.handleResetAllSessions(args as any);
        case 'reset_session':
          return this.handleResetSession(args as any);
        case 'clear_session_logs':
          return this.handleClearSessionLogs(args as any);
        case 'reset_sessions_by_criteria':
          return this.handleResetSessionsByCriteria(args as any);
        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    });
  }

  private async handleGetNewLogs(args: {
    sessionId?: string;
    since?: number;
    limit?: number;
  }) {
    const { sessionId, since = 0, limit = 100 } = args;

    if (sessionId) {
      const result = await this.logManager.getNewLogs(sessionId, since, limit);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            sessionId,
            logs: result.data,
            total: result.total,
            nextCursor: result.nextCursor,
            hasMore: result.hasMore,
            hasPrevious: result.hasPrevious,
          }, null, 2),
        }],
      };
    } else {
      const activeSessions = this.logManager.getActiveSessions();
      const allResults: LogEntry[] = [];
      let totalCount = 0;

      for (const session of activeSessions) {
        const result = await this.logManager.getNewLogs(session.id, since, limit);
        allResults.push(...result.data);
        totalCount += result.total;
      }

      allResults.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      // Apply final pagination to merged results
      const finalResults = allResults.slice(0, limit);
      const hasMore = allResults.length > limit;

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            logs: finalResults,
            total: totalCount,
            nextCursor: finalResults.length > 0 ? Math.max(...finalResults.map(l => l.lineNumber)) : since,
            hasMore,
            hasPrevious: since > 0,
          }, null, 2),
        }],
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
      content: [{
        type: 'text',
        text: JSON.stringify({
          sessions: paginatedSessions.map(session => ({
            ...session,
            stats: this.logManager.getSessionStats(session.id),
          })),
          total: sessions.length,
          offset,
          limit,
          hasMore,
          nextOffset: hasMore ? offset + limit : null,
        }, null, 2),
      }],
    };
  }

  private async handleGetSessionInfo(args: { sessionId: string }) {
    const { sessionId } = args;
    const session = this.logManager.getSession(sessionId);

    if (!session) {
      throw new McpError(ErrorCode.InvalidRequest, `Session ${sessionId} not found`);
    }

    const stats = this.logManager.getSessionStats(sessionId);
    const recentErrors = this.errorDetector.getRecentErrors(sessionId);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          session,
          stats,
          recentErrors,
        }, null, 2),
      }],
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
        content: [{
          type: 'text',
          text: JSON.stringify({
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
          }, null, 2),
        }],
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
        content: [{
          type: 'text',
          text: JSON.stringify({
            query,
            results: finalResults,
            total: totalCount,
            offset,
            limit,
            hasMore,
            hasPrevious: offset > 0,
            nextOffset: hasMore ? offset + limit : null,
            prevOffset: offset > 0 ? Math.max(0, offset - limit) : null,
          }, null, 2),
        }],
      };
    }
  }

  private async handleAcknowledgeError(args: { errorId: string }) {
    const { errorId } = args;
    const acknowledged = this.errorDetector.acknowledgeError(errorId);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          errorId,
          acknowledged,
        }),
      }],
    };
  }

  private async handleGetErrorHistory(args: { sessionId: string; limit?: number }) {
    const { sessionId, limit = 10 } = args;
    const errors = this.errorDetector.getRecentErrors(sessionId, limit);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          sessionId,
          errors,
          total: errors.length,
        }, null, 2),
      }],
    };
  }

  private async handleGetLogsPaginated(args: {
    sessionId: string;
    cursor?: number;
    limit?: number;
    reverse?: boolean;
  }) {
    const { sessionId, cursor = 0, limit = 100, reverse = false } = args;

    const result = await this.logManager.getLogsPaginated(sessionId, cursor, limit, reverse);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
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
        }, null, 2),
      }],
    };
  }

  private async handleGetRecentLogs(args: {
    sessionId: string;
    limit?: number;
  }) {
    const { sessionId, limit = 50 } = args;

    const result = await this.logManager.getRecentLogsPaginated(sessionId, limit);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          sessionId,
          logs: result.data,
          total: result.total,
          limit,
          nextCursor: result.nextCursor,
          prevCursor: result.prevCursor,
          hasMore: result.hasMore,
          hasPrevious: result.hasPrevious,
        }, null, 2),
      }],
    };
  }

  private async handleResetAllSessions(args: { confirm: boolean }) {
    const { confirm } = args;

    if (!confirm) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            message: 'Reset operation cancelled - confirm parameter must be set to true',
            warning: 'This operation will delete ALL sessions and logs permanently',
          }, null, 2),
        }],
      };
    }

    const result = this.logManager.resetAllSessions();

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ...result,
          operation: 'reset_all_sessions',
          timestamp: new Date().toISOString(),
        }, null, 2),
      }],
    };
  }

  private async handleResetSession(args: { sessionId: string }) {
    const { sessionId } = args;
    const result = this.logManager.resetSession(sessionId);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ...result,
          operation: 'reset_session',
          sessionId,
          timestamp: new Date().toISOString(),
        }, null, 2),
      }],
    };
  }

  private async handleClearSessionLogs(args: { sessionId: string }) {
    const { sessionId } = args;
    const result = this.logManager.clearSessionLogs(sessionId);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ...result,
          operation: 'clear_session_logs',
          sessionId,
          timestamp: new Date().toISOString(),
        }, null, 2),
      }],
    };
  }

  private async handleResetSessionsByCriteria(args: {
    status?: 'running' | 'stopped' | 'crashed';
    olderThanDays?: number;
    projectDir?: string;
  }) {
    const { status, olderThanDays, projectDir } = args;

    const criteria: any = {};
    if (status) criteria.status = status;
    if (projectDir) criteria.projectDir = projectDir;
    if (olderThanDays !== undefined) {
      criteria.olderThan = new Date(Date.now() - (olderThanDays * 24 * 60 * 60 * 1000));
    }

    const result = this.logManager.resetSessionsByCriteria(criteria);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ...result,
          operation: 'reset_sessions_by_criteria',
          criteria: {
            status,
            olderThanDays,
            projectDir,
          },
          timestamp: new Date().toISOString(),
        }, null, 2),
      }],
    };
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

  private startCleanupTimer(): void {
    setInterval(() => {
      this.logManager.cleanup();
    }, 60 * 60 * 1000); // Cleanup every hour
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