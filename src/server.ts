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

class LogPiperMCPServer {
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
      const sessions = this.logManager.listSessions();
      
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
        const logs = this.logManager.getAllLogs(sessionId);
        const session = this.logManager.getSession(sessionId);

        if (!session) {
          throw new McpError(ErrorCode.InvalidRequest, `Session ${sessionId} not found`);
        }

        const logContent = logs
          .map(log => `[${log.timestamp.toISOString()}] [${log.logLevel.toUpperCase()}] ${log.content}`)
          .join('\n');

        return {
          contents: [{
            uri,
            mimeType: 'text/plain',
            text: logContent,
          }],
        };
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
      const newLogs = this.logManager.getNewLogs(sessionId, since);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            sessionId,
            logs: newLogs.slice(0, limit),
            nextCursor: newLogs.length > 0 ? Math.max(...newLogs.map(l => l.lineNumber)) : since,
            hasMore: newLogs.length > limit,
          }, null, 2),
        }],
      };
    } else {
      const activeSessions = this.logManager.getActiveSessions();
      const allNewLogs: LogEntry[] = [];

      activeSessions.forEach(session => {
        const logs = this.logManager.getNewLogs(session.id, since);
        allNewLogs.push(...logs);
      });

      allNewLogs.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            logs: allNewLogs.slice(0, limit),
            nextCursor: allNewLogs.length > 0 ? Math.max(...allNewLogs.map(l => l.lineNumber)) : since,
            hasMore: allNewLogs.length > limit,
          }, null, 2),
        }],
      };
    }
  }

  private async handleListSessions(args: { status?: string }) {
    const { status = 'all' } = args;
    let sessions = this.logManager.listSessions();

    if (status !== 'all') {
      sessions = sessions.filter(s => s.status === status);
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          sessions: sessions.map(session => ({
            ...session,
            stats: this.logManager.getSessionStats(session.id),
          })),
          total: sessions.length,
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
  }) {
    const { sessionId, query, limit = 50 } = args;

    if (sessionId) {
      const results = this.logManager.searchLogs(sessionId, query);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            sessionId,
            query,
            results: results.slice(0, limit),
            total: results.length,
          }, null, 2),
        }],
      };
    } else {
      const sessions = this.logManager.listSessions();
      const allResults: LogEntry[] = [];

      sessions.forEach(session => {
        const results = this.logManager.searchLogs(session.id, query);
        allResults.push(...results);
      });

      allResults.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            query,
            results: allResults.slice(0, limit),
            total: allResults.length,
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
    console.error('LogPiper MCP Server started');
  }
}

const server = new LogPiperMCPServer();
server.start().catch((error) => {
  console.error('Failed to start LogPiper MCP Server:', error);
  process.exit(1);
});