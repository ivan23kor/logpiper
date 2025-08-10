import type {
  LogEntry,
  LogSession,
  SessionManager,
  LogStorage,
  PaginationResult
} from './types.js';
import { readdirSync, readFileSync, existsSync, statSync, unlinkSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { LogReader } from './log-reader.js';

export class LogManager implements SessionManager, LogStorage {
  private dataDir: string;
  private maxLogsPerSession: number = 10000;
  private logReader: LogReader;

  constructor() {
    this.dataDir = join(tmpdir(), 'logpiper');
    this.logReader = new LogReader({
      maxChunkSize: 1024 * 1024, // 1MB
      defaultLimit: 100,
    });
  }

  createSession(projectDir: string, command: string, args: string[]): LogSession {
    const sessionId = this.generateSessionId(projectDir, command);

    const session: LogSession = {
      id: sessionId,
      projectDir,
      command,
      args,
      startTime: new Date(),
      status: 'running',
      readCursor: 0,
      errorHistory: [],
      lastActivity: new Date()
    };

    // Sessions are now created by CLI and stored to files
    return session;
  }

  private generateSessionId(projectDir: string, command: string): string {
    const timestamp = Date.now();
    const projectName = projectDir.split(/[/\\]/).pop() || 'unknown';
    const commandName = command.replace(/[^a-zA-Z0-9]/g, '_');
    return `${projectName}_${commandName}_${timestamp}`;
  }

  getSession(sessionId: string): LogSession | undefined {
    const sessionFile = join(this.dataDir, `${sessionId}.json`);
    if (!existsSync(sessionFile)) {
      return undefined;
    }

    try {
      const sessionData = JSON.parse(readFileSync(sessionFile, 'utf8'));
      sessionData.startTime = new Date(sessionData.startTime);
      sessionData.lastActivity = new Date(sessionData.lastActivity);
      if (sessionData.endTime) {
        sessionData.endTime = new Date(sessionData.endTime);
      }
      return sessionData;
    } catch {
      return undefined;
    }
  }

  listSessions(): LogSession[] {
    if (!existsSync(this.dataDir)) {
      return [];
    }

    const sessions: LogSession[] = [];
    const files = readdirSync(this.dataDir);

    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const sessionFile = join(this.dataDir, file);
          const sessionData = JSON.parse(readFileSync(sessionFile, 'utf8'));

          // Convert string dates back to Date objects
          sessionData.startTime = new Date(sessionData.startTime);
          sessionData.lastActivity = new Date(sessionData.lastActivity);
          if (sessionData.endTime) {
            sessionData.endTime = new Date(sessionData.endTime);
          }

          sessions.push(sessionData);
        } catch (error) {
          // Skip invalid session files
        }
      }
    }

    return sessions.sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());
  }

  getActiveSessions(): LogSession[] {
    return this.listSessions().filter(session => session.status === 'running');
  }

  updateSession(sessionId: string, updates: Partial<LogSession>): void {
    // Session updates are now handled by CLI writing to files
    // This method exists for interface compatibility
  }

  removeSession(sessionId: string): void {
    // Sessions are file-based now, removal would require file deletion
    // This method exists for interface compatibility
  }

  addLog(entry: LogEntry): void {
    // Logs are now stored by CLI directly to files
    // This method exists for interface compatibility
  }

  async getNewLogs(sessionId: string, since: number, limit?: number): Promise<PaginationResult<LogEntry>> {
    const logsFile = join(this.dataDir, `${sessionId}.logs`);
    return this.logReader.getNewLogs(logsFile, since, limit);
  }

  // Legacy sync method for backward compatibility
  getNewLogsSync(sessionId: string, since: number): LogEntry[] {
    const allLogs = this.getAllLogs(sessionId);
    return allLogs.filter(log => log.lineNumber > since);
  }

  getAllLogs(sessionId: string): LogEntry[] {
    const logsFile = join(this.dataDir, `${sessionId}.logs`);
    if (!existsSync(logsFile)) {
      return [];
    }

    try {
      const content = readFileSync(logsFile, 'utf8');
      const lines = content.trim().split('\n').filter(line => line.length > 0);
      return lines.map(line => {
        const entry = JSON.parse(line);
        entry.timestamp = new Date(entry.timestamp);
        return entry;
      });
    } catch {
      return [];
    }
  }

  async searchLogs(sessionId: string, query: string, cursor?: number, limit?: number): Promise<PaginationResult<LogEntry>> {
    const logsFile = join(this.dataDir, `${sessionId}.logs`);
    return this.logReader.searchLogsPaginated(logsFile, query, cursor, limit);
  }

  // Legacy sync method for backward compatibility
  searchLogsSync(sessionId: string, query: string): LogEntry[] {
    const allLogs = this.getAllLogs(sessionId);
    const lowerQuery = query.toLowerCase();

    return allLogs.filter(log =>
      log.content.toLowerCase().includes(lowerQuery) ||
      log.command.toLowerCase().includes(lowerQuery)
    );
  }

  async getLogCount(sessionId: string): Promise<number> {
    const logsFile = join(this.dataDir, `${sessionId}.logs`);
    return this.logReader.getLogCount(logsFile);
  }

  // Legacy sync method for backward compatibility
  getLogCountSync(sessionId: string): number {
    return this.getAllLogs(sessionId).length;
  }

  getSessionStats(sessionId: string): {
    totalLogs: number;
    errorCount: number;
    warningCount: number;
    lastActivity: Date | null;
    uptime: number;
  } {
    const session = this.getSession(sessionId);
    const sessionLogs = this.getAllLogs(sessionId);

    const errorCount = sessionLogs.filter((log: LogEntry) =>
      log.logLevel === 'stderr' || log.logLevel === 'error'
    ).length;

    const warningCount = sessionLogs.filter((log: LogEntry) =>
      log.logLevel === 'warn' ||
      log.content.toLowerCase().includes('warning')
    ).length;

    const uptime = session ?
      (session.endTime || new Date()).getTime() - session.startTime.getTime() : 0;

    return {
      totalLogs: sessionLogs.length,
      errorCount,
      warningCount,
      lastActivity: session?.lastActivity || null,
      uptime
    };
  }

  getRecentLogs(sessionId: string, limit: number = 50): LogEntry[] {
    const sessionLogs = this.getAllLogs(sessionId);
    return sessionLogs.slice(-limit);
  }

  getLogsByTimeRange(
    sessionId: string,
    startTime: Date,
    endTime: Date
  ): LogEntry[] {
    const sessionLogs = this.getAllLogs(sessionId);

    return sessionLogs.filter((log: LogEntry) =>
      log.timestamp >= startTime && log.timestamp <= endTime
    );
  }

  getLogsByLevel(sessionId: string, levels: string[]): LogEntry[] {
    const sessionLogs = this.getAllLogs(sessionId);

    return sessionLogs.filter((log: LogEntry) => levels.includes(log.logLevel));
  }

  exportSessionLogs(sessionId: string): {
    session: LogSession;
    logs: LogEntry[];
    stats: {
      totalLogs: number;
      errorCount: number;
      warningCount: number;
      lastActivity: Date | null;
      uptime: number;
    };
  } | null {
    const session = this.getSession(sessionId);
    if (!session) return null;

    return {
      session,
      logs: this.getAllLogs(sessionId),
      stats: this.getSessionStats(sessionId)
    };
  }

  cleanup(): void {
    // File-based cleanup would require removing old session files
    // This method exists for interface compatibility
    // Could implement by scanning dataDir for old files
  }

  /**
   * Reset all sessions and logs - removes all data from the logpiper directory
   */
  resetAllSessions(): {
    success: boolean;
    message: string;
    deletedSessions: number;
    deletedLogFiles: number;
    errors: string[];
  } {
    const result = {
      success: false,
      message: '',
      deletedSessions: 0,
      deletedLogFiles: 0,
      errors: [] as string[]
    };

    try {
      if (!existsSync(this.dataDir)) {
        result.success = true;
        result.message = 'No data directory found - nothing to reset';
        return result;
      }

      const files = readdirSync(this.dataDir);
      
      for (const file of files) {
        const filePath = join(this.dataDir, file);
        
        try {
          if (file.endsWith('.json')) {
            unlinkSync(filePath);
            result.deletedSessions++;
          } else if (file.endsWith('.logs')) {
            unlinkSync(filePath);
            result.deletedLogFiles++;
          } else {
            // Remove any other files in the directory
            unlinkSync(filePath);
          }
        } catch (fileError) {
          result.errors.push(`Failed to delete ${file}: ${fileError}`);
        }
      }

      result.success = result.errors.length === 0;
      result.message = result.success 
        ? `Successfully reset all sessions. Deleted ${result.deletedSessions} sessions and ${result.deletedLogFiles} log files.`
        : `Partially completed reset with ${result.errors.length} errors. Deleted ${result.deletedSessions} sessions and ${result.deletedLogFiles} log files.`;

    } catch (error) {
      result.success = false;
      result.message = `Failed to reset sessions: ${error}`;
      result.errors.push(`Directory scan error: ${error}`);
    }

    return result;
  }

  /**
   * Reset specific session - removes session and its logs
   */
  resetSession(sessionId: string): {
    success: boolean;
    message: string;
    sessionDeleted: boolean;
    logsDeleted: boolean;
    errors: string[];
  } {
    const result = {
      success: false,
      message: '',
      sessionDeleted: false,
      logsDeleted: false,
      errors: [] as string[]
    };

    try {
      const sessionFile = join(this.dataDir, `${sessionId}.json`);
      const logsFile = join(this.dataDir, `${sessionId}.logs`);

      // Delete session file
      if (existsSync(sessionFile)) {
        try {
          unlinkSync(sessionFile);
          result.sessionDeleted = true;
        } catch (error) {
          result.errors.push(`Failed to delete session file: ${error}`);
        }
      }

      // Delete logs file
      if (existsSync(logsFile)) {
        try {
          unlinkSync(logsFile);
          result.logsDeleted = true;
        } catch (error) {
          result.errors.push(`Failed to delete logs file: ${error}`);
        }
      }

      if (!result.sessionDeleted && !result.logsDeleted) {
        result.message = `Session ${sessionId} not found`;
        result.success = true; // Not an error if session doesn't exist
      } else {
        result.success = result.errors.length === 0;
        const deletedItems = [];
        if (result.sessionDeleted) deletedItems.push('session');
        if (result.logsDeleted) deletedItems.push('logs');
        
        result.message = result.success
          ? `Successfully deleted ${deletedItems.join(' and ')} for session ${sessionId}`
          : `Partially completed deletion with ${result.errors.length} errors`;
      }

    } catch (error) {
      result.success = false;
      result.message = `Failed to reset session ${sessionId}: ${error}`;
      result.errors.push(`Reset error: ${error}`);
    }

    return result;
  }

  /**
   * Clear logs for a specific session (keep session metadata)
   */
  clearSessionLogs(sessionId: string): {
    success: boolean;
    message: string;
    logsDeleted: boolean;
    errors: string[];
  } {
    const result = {
      success: false,
      message: '',
      logsDeleted: false,
      errors: [] as string[]
    };

    try {
      const logsFile = join(this.dataDir, `${sessionId}.logs`);

      if (existsSync(logsFile)) {
        try {
          unlinkSync(logsFile);
          result.logsDeleted = true;
          result.success = true;
          result.message = `Successfully cleared logs for session ${sessionId}`;
        } catch (error) {
          result.errors.push(`Failed to delete logs file: ${error}`);
          result.message = `Failed to clear logs for session ${sessionId}: ${error}`;
        }
      } else {
        result.success = true;
        result.message = `No logs found for session ${sessionId}`;
      }

    } catch (error) {
      result.success = false;
      result.message = `Failed to clear logs for session ${sessionId}: ${error}`;
      result.errors.push(`Clear logs error: ${error}`);
    }

    return result;
  }

  /**
   * Reset sessions by criteria (status, age, etc.)
   */
  resetSessionsByCriteria(criteria: {
    status?: 'running' | 'stopped' | 'crashed';
    olderThan?: Date;
    projectDir?: string;
  }): {
    success: boolean;
    message: string;
    deletedSessions: number;
    deletedLogFiles: number;
    errors: string[];
    deletedSessionIds: string[];
  } {
    const result = {
      success: false,
      message: '',
      deletedSessions: 0,
      deletedLogFiles: 0,
      errors: [] as string[],
      deletedSessionIds: [] as string[]
    };

    try {
      const allSessions = this.listSessions();
      const sessionsToDelete = allSessions.filter(session => {
        // Filter by status
        if (criteria.status && session.status !== criteria.status) {
          return false;
        }

        // Filter by age
        if (criteria.olderThan && session.lastActivity > criteria.olderThan) {
          return false;
        }

        // Filter by project directory
        if (criteria.projectDir && session.projectDir !== criteria.projectDir) {
          return false;
        }

        return true;
      });

      for (const session of sessionsToDelete) {
        const resetResult = this.resetSession(session.id);
        
        if (resetResult.success) {
          result.deletedSessionIds.push(session.id);
          if (resetResult.sessionDeleted) result.deletedSessions++;
          if (resetResult.logsDeleted) result.deletedLogFiles++;
        } else {
          result.errors.push(...resetResult.errors);
        }
      }

      result.success = result.errors.length === 0;
      result.message = result.success
        ? `Successfully reset ${sessionsToDelete.length} sessions matching criteria`
        : `Partially completed reset with ${result.errors.length} errors. Reset ${result.deletedSessionIds.length} sessions.`;

    } catch (error) {
      result.success = false;
      result.message = `Failed to reset sessions by criteria: ${error}`;
      result.errors.push(`Criteria reset error: ${error}`);
    }

    return result;
  }

  getSessionsOverview(): {
    total: number;
    active: number;
    crashed: number;
    stopped: number;
    oldestActive: Date | null;
    newestActive: Date | null;
  } {
    const allSessions = this.listSessions();
    const activeSessions = allSessions.filter(s => s.status === 'running');
    const crashedSessions = allSessions.filter(s => s.status === 'crashed');
    const stoppedSessions = allSessions.filter(s => s.status === 'stopped');

    const activeStartTimes = activeSessions.map(s => s.startTime);

    return {
      total: allSessions.length,
      active: activeSessions.length,
      crashed: crashedSessions.length,
      stopped: stoppedSessions.length,
      oldestActive: activeStartTimes.length > 0 ?
        new Date(Math.min(...activeStartTimes.map(d => d.getTime()))) : null,
      newestActive: activeStartTimes.length > 0 ?
        new Date(Math.max(...activeStartTimes.map(d => d.getTime()))) : null
    };
  }

  mergeLogsFromSessions(sessionIds: string[], limit?: number): LogEntry[] {
    const allLogs: LogEntry[] = [];

    sessionIds.forEach(sessionId => {
      const sessionLogs = this.getAllLogs(sessionId);
      allLogs.push(...sessionLogs);
    });

    allLogs.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    return limit ? allLogs.slice(-limit) : allLogs;
  }

  getSessionsByProject(projectDir: string): LogSession[] {
    return this.listSessions().filter(session =>
      session.projectDir === projectDir
    );
  }

  getSessionsByCommand(command: string): LogSession[] {
    return this.listSessions().filter(session =>
      session.command === command
    );
  }

  // New paginated methods for efficient log handling

  /**
   * Get logs with pagination support
   */
  async getLogsPaginated(
    sessionId: string,
    cursor: number = 0,
    limit: number = 100,
    reverse: boolean = false
  ): Promise<PaginationResult<LogEntry>> {
    const logsFile = join(this.dataDir, `${sessionId}.logs`);
    return this.logReader.readLogsPaginated(logsFile, cursor, limit, reverse);
  }

  /**
   * Get recent logs (latest first) with pagination
   */
  async getRecentLogsPaginated(
    sessionId: string,
    limit: number = 50
  ): Promise<PaginationResult<LogEntry>> {
    const logsFile = join(this.dataDir, `${sessionId}.logs`);
    return this.logReader.readLogsPaginated(logsFile, 0, limit, true);
  }

  /**
   * Get logs by time range with pagination
   */
  async getLogsByTimeRangePaginated(
    sessionId: string,
    startTime: Date,
    endTime: Date,
    cursor: number = 0,
    limit: number = 100
  ): Promise<PaginationResult<LogEntry>> {
    // For time range queries, we'll first get all logs in cursor range
    // then filter by time range
    const result = await this.getLogsPaginated(sessionId, cursor, limit);
    
    const filteredLogs = result.data.filter(log =>
      log.timestamp >= startTime && log.timestamp <= endTime
    );

    return {
      ...result,
      data: filteredLogs,
    };
  }

  /**
   * Get logs by level with pagination
   */
  async getLogsByLevelPaginated(
    sessionId: string,
    levels: string[],
    cursor: number = 0,
    limit: number = 100
  ): Promise<PaginationResult<LogEntry>> {
    // For level filtering, we'll get logs and filter them
    const result = await this.getLogsPaginated(sessionId, cursor, limit);
    
    const filteredLogs = result.data.filter(log => levels.includes(log.logLevel));

    return {
      ...result,
      data: filteredLogs,
    };
  }

  /**
   * Merge logs from multiple sessions with pagination
   */
  async mergeLogsFromSessionsPaginated(
    sessionIds: string[],
    cursor: number = 0,
    limit: number = 100
  ): Promise<PaginationResult<LogEntry>> {
    const allLogs: LogEntry[] = [];
    let totalCount = 0;

    for (const sessionId of sessionIds) {
      const result = await this.getLogsPaginated(sessionId, cursor, limit);
      allLogs.push(...result.data);
      totalCount += result.total;
    }

    // Sort by timestamp
    allLogs.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    // Apply pagination to the merged results
    const paginatedLogs = allLogs.slice(0, limit);

    return {
      data: paginatedLogs,
      total: totalCount,
      nextCursor: paginatedLogs.length > 0 
        ? Math.max(...paginatedLogs.map(l => l.lineNumber))
        : cursor,
      hasMore: allLogs.length > limit,
      hasPrevious: cursor > 0,
    };
  }
}