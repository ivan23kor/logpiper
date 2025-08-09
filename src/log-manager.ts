import type { 
  LogEntry, 
  LogSession, 
  SessionManager, 
  LogStorage 
} from './types.js';
import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

export class LogManager implements SessionManager, LogStorage {
  private dataDir: string;
  private maxLogsPerSession: number = 10000;

  constructor() {
    this.dataDir = join(tmpdir(), 'logpiper');
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

  getNewLogs(sessionId: string, since: number): LogEntry[] {
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

  searchLogs(sessionId: string, query: string): LogEntry[] {
    const allLogs = this.getAllLogs(sessionId);
    const lowerQuery = query.toLowerCase();
    
    return allLogs.filter(log => 
      log.content.toLowerCase().includes(lowerQuery) ||
      log.command.toLowerCase().includes(lowerQuery)
    );
  }

  getLogCount(sessionId: string): number {
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
}