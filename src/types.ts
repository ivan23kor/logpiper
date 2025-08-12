export interface LogEntry {
  id: string;
  sessionId: string;
  projectDir: string;
  command: string;
  args: string[];
  timestamp: Date;
  logLevel: 'stdout' | 'stderr' | 'info' | 'error' | 'warn';
  content: string;
  lineNumber: number;
}

export interface LogSession {
  id: string;
  projectDir: string;
  command: string;
  args: string[];
  startTime: Date;
  endTime?: Date;
  status: 'running' | 'stopped' | 'crashed';
  pid?: number;
  readCursor: number;
  errorHistory: ErrorEvent[];
  lastActivity: Date;
  autoCleanupScheduled?: boolean;
  metadata?: {
    commandSignature: string;
    projectName: string;
    workingDirectory: string;
    [key: string]: any;
  };
}

export interface ErrorEvent {
  id: string;
  sessionId: string;
  timestamp: Date;
  severity: 'critical' | 'high' | 'medium' | 'info';
  category: string;
  summary: string;
  details: {
    errorCount: number;
    firstError: string;
    context: string[];
    suggestedFix?: string;
  };
  metadata: {
    projectDir: string;
    command: string;
    logsCursor: string;
  };
  actions: ErrorAction[];
  acknowledged: boolean;
}

export interface ErrorAction {
  type: 'view_logs' | 'open_file' | 'restart_process' | 'debug';
  label: string;
  path?: string;
  data?: any;
}

export interface ErrorPattern {
  name: string;
  pattern: RegExp;
  severity: 'critical' | 'high' | 'medium' | 'info';
  category: string;
  description: string;
  suggestedFix?: string;
  cooldownMs: number;
}

export interface CommandAnalyzer {
  command: string;
  patterns: ErrorPattern[];
  contextAnalyzer?: (logs: LogEntry[]) => ErrorContext;
}

export interface ErrorContext {
  relatedFiles: string[];
  stackTrace?: string[];
  environment?: Record<string, string>;
}

export interface NotificationPayload {
  method: 'notifications/error_detected' | 'notifications/session_update';
  params: {
    id: string;
    sessionId: string;
    [key: string]: any;
  };
}

export interface SessionManager {
  createSession(projectDir: string, command: string, args: string[]): LogSession;
  getSession(sessionId: string): LogSession | undefined;
  listSessions(): LogSession[];
  updateSession(sessionId: string, updates: Partial<LogSession>): void;
  removeSession(sessionId: string): void;
}

export interface PaginationResult<T> {
  data: T[];
  total: number;
  nextCursor?: number;
  prevCursor?: number;
  hasMore: boolean;
  hasPrevious: boolean;
}

export interface LogStorage {
  addLog(entry: LogEntry): void;
  getNewLogs(sessionId: string, since: number, limit?: number): Promise<PaginationResult<LogEntry>>;
  getAllLogs(sessionId: string): LogEntry[];
  searchLogs(sessionId: string, query: string, cursor?: number, limit?: number): Promise<PaginationResult<LogEntry>>;
  getLogCount(sessionId: string): Promise<number>;
}