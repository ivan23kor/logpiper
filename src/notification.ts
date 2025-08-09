import type { ErrorEvent, NotificationPayload } from './types.js';

export class NotificationSystem {
  private notificationQueue: NotificationPayload[] = [];
  private rateLimitMap: Map<string, number[]> = new Map();
  private maxNotificationsPerMinute = 5;
  private batchTimeout: NodeJS.Timeout | null = null;
  private pendingBatch: ErrorEvent[] = [];

  constructor() {
    this.startBatchProcessor();
  }

  async sendErrorNotification(errorEvent: ErrorEvent): Promise<void> {
    if (this.shouldSuppressNotification(errorEvent)) {
      return;
    }

    if (errorEvent.severity === 'critical') {
      await this.sendImmediateNotification(errorEvent);
    } else {
      this.addToBatch(errorEvent);
    }

    this.recordNotification(errorEvent.sessionId);
  }

  private shouldSuppressNotification(errorEvent: ErrorEvent): boolean {
    const sessionKey = errorEvent.sessionId;
    const now = Date.now();
    const oneMinute = 60 * 1000;

    const recentNotifications = this.rateLimitMap.get(sessionKey) || [];
    const recentCount = recentNotifications.filter(time => now - time < oneMinute).length;

    if (recentCount >= this.maxNotificationsPerMinute) {
      console.error(`Rate limit exceeded for session ${sessionKey}, suppressing notification`);
      return true;
    }

    return false;
  }

  private recordNotification(sessionId: string): void {
    const now = Date.now();
    const notifications = this.rateLimitMap.get(sessionId) || [];
    
    notifications.push(now);
    
    const oneMinute = 60 * 1000;
    const filtered = notifications.filter(time => now - time < oneMinute);
    
    this.rateLimitMap.set(sessionId, filtered);
  }

  private async sendImmediateNotification(errorEvent: ErrorEvent): Promise<void> {
    const notification: NotificationPayload = {
      method: 'notifications/error_detected',
      params: {
        id: errorEvent.id,
        sessionId: errorEvent.sessionId,
        severity: errorEvent.severity,
        category: errorEvent.category,
        summary: errorEvent.summary,
        details: errorEvent.details,
        metadata: errorEvent.metadata,
        actions: errorEvent.actions,
        timestamp: errorEvent.timestamp.toISOString(),
        immediate: true,
      },
    };

    await this.sendNotification(notification);
  }

  private addToBatch(errorEvent: ErrorEvent): void {
    this.pendingBatch.push(errorEvent);

    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
    }

    const delay = this.getBatchDelay(errorEvent.severity);
    this.batchTimeout = setTimeout(() => {
      this.processBatch();
    }, delay);
  }

  private getBatchDelay(severity: string): number {
    switch (severity) {
      case 'high': return 30000; // 30 seconds
      case 'medium': return 120000; // 2 minutes
      case 'info': return 300000; // 5 minutes
      default: return 60000; // 1 minute
    }
  }

  private async processBatch(): Promise<void> {
    if (this.pendingBatch.length === 0) {
      return;
    }

    const batch = [...this.pendingBatch];
    this.pendingBatch = [];
    this.batchTimeout = null;

    if (batch.length === 1) {
      await this.sendImmediateNotification(batch[0]);
      return;
    }

    await this.sendBatchNotification(batch);
  }

  private async sendBatchNotification(errors: ErrorEvent[]): Promise<void> {
    const groupedBySeverity = errors.reduce((acc, error) => {
      const key = error.severity;
      if (!acc[key]) acc[key] = [];
      acc[key].push(error);
      return acc;
    }, {} as Record<string, ErrorEvent[]>);

    const groupedBySession = errors.reduce((acc, error) => {
      const key = error.sessionId;
      if (!acc[key]) acc[key] = [];
      acc[key].push(error);
      return acc;
    }, {} as Record<string, ErrorEvent[]>);

    const summary = this.generateBatchSummary(errors, groupedBySeverity, groupedBySession);
    
    const notification: NotificationPayload = {
      method: 'notifications/error_detected',
      params: {
        id: `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        sessionId: 'multiple',
        severity: this.getHighestSeverity(errors),
        category: 'batch_errors',
        summary,
        details: {
          errorCount: errors.length,
          firstError: errors[0].details.firstError,
          context: errors.slice(0, 3).map(e => e.details.firstError),
          suggestedFix: 'Multiple issues detected - review individual errors',
        },
        metadata: {
          projectDir: 'multiple',
          command: 'multiple',
          logsCursor: `batch_${Date.now()}`,
        },
        actions: [
          { type: 'view_logs', label: 'View All Logs' },
          ...this.getUniqueFileActions(errors),
        ],
        timestamp: new Date().toISOString(),
        batch: true,
        errors: errors.map(e => ({
          id: e.id,
          sessionId: e.sessionId,
          severity: e.severity,
          category: e.category,
          summary: e.summary,
          timestamp: e.timestamp,
        })),
      },
    };

    await this.sendNotification(notification);
  }

  private generateBatchSummary(
    errors: ErrorEvent[],
    groupedBySeverity: Record<string, ErrorEvent[]>,
    groupedBySession: Record<string, ErrorEvent[]>
  ): string {
    const sessionCount = Object.keys(groupedBySession).length;
    const severities = Object.keys(groupedBySeverity)
      .sort((a, b) => this.getSeverityWeight(b) - this.getSeverityWeight(a));

    if (sessionCount === 1) {
      const sessionId = Object.keys(groupedBySession)[0];
      const session = groupedBySession[sessionId];
      return `${errors.length} ${severities[0]} error${errors.length > 1 ? 's' : ''} in ${session[0].metadata.command}`;
    }

    return `${errors.length} errors across ${sessionCount} sessions: ${severities.map(s => `${groupedBySeverity[s].length} ${s}`).join(', ')}`;
  }

  private getSeverityWeight(severity: string): number {
    switch (severity) {
      case 'critical': return 4;
      case 'high': return 3;
      case 'medium': return 2;
      case 'info': return 1;
      default: return 0;
    }
  }

  private getHighestSeverity(errors: ErrorEvent[]): string {
    return errors.reduce((highest, error) => {
      return this.getSeverityWeight(error.severity) > this.getSeverityWeight(highest) 
        ? error.severity 
        : highest;
    }, 'info');
  }

  private getUniqueFileActions(errors: ErrorEvent[]): Array<{ type: string; label: string; path?: string }> {
    const uniqueFiles = new Set<string>();
    
    errors.forEach(error => {
      error.actions.forEach(action => {
        if (action.type === 'open_file' && action.path) {
          uniqueFiles.add(action.path);
        }
      });
    });

    return Array.from(uniqueFiles).slice(0, 5).map(path => ({
      type: 'open_file',
      label: `Open ${path.split(':')[0]}`,
      path,
    }));
  }

  private async sendNotification(notification: NotificationPayload): Promise<void> {
    try {
      // Send via JSON-RPC notification to stdout for MCP client
      const jsonRpcNotification = {
        jsonrpc: '2.0',
        method: notification.method,
        params: notification.params,
      };

      process.stdout.write(JSON.stringify(jsonRpcNotification) + '\n');
      
      console.error(`📢 Sent ${notification.params.severity} notification: ${notification.params.summary}`);
    } catch (error) {
      console.error('Failed to send notification:', error);
    }
  }

  private startBatchProcessor(): void {
    // Process any pending batches on exit
    process.on('SIGINT', () => {
      if (this.pendingBatch.length > 0) {
        this.processBatch();
      }
    });

    process.on('SIGTERM', () => {
      if (this.pendingBatch.length > 0) {
        this.processBatch();
      }
    });
  }

  async sendSessionUpdateNotification(
    sessionId: string, 
    status: 'started' | 'stopped' | 'crashed',
    metadata: any
  ): Promise<void> {
    const notification: NotificationPayload = {
      method: 'notifications/session_update',
      params: {
        id: `session_update_${Date.now()}`,
        sessionId,
        status,
        metadata,
        timestamp: new Date().toISOString(),
      },
    };

    await this.sendNotification(notification);
  }

  cleanup(): void {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
    }

    if (this.pendingBatch.length > 0) {
      this.processBatch();
    }

    // Clear old rate limit data
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    
    for (const [sessionId, notifications] of this.rateLimitMap.entries()) {
      const filtered = notifications.filter(time => now - time < oneHour);
      if (filtered.length === 0) {
        this.rateLimitMap.delete(sessionId);
      } else {
        this.rateLimitMap.set(sessionId, filtered);
      }
    }
  }

  getNotificationStats(): {
    queueSize: number;
    batchPending: number;
    rateLimitedSessions: number;
    totalNotificationsSent: number;
  } {
    const rateLimitedSessions = Array.from(this.rateLimitMap.values())
      .filter(notifications => notifications.length > 0).length;

    const totalNotificationsSent = Array.from(this.rateLimitMap.values())
      .reduce((sum, notifications) => sum + notifications.length, 0);

    return {
      queueSize: this.notificationQueue.length,
      batchPending: this.pendingBatch.length,
      rateLimitedSessions,
      totalNotificationsSent,
    };
  }
}