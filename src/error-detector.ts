import type { 
  LogEntry, 
  ErrorEvent, 
  ErrorPattern, 
  CommandAnalyzer, 
  ErrorContext,
  ErrorAction 
} from './types.js';

export class ErrorDetector {
  private patterns: Map<string, ErrorPattern[]> = new Map();
  private commandAnalyzers: Map<string, CommandAnalyzer> = new Map();
  private errorCooldowns: Map<string, number> = new Map();
  private recentErrors: Map<string, ErrorEvent[]> = new Map();

  constructor() {
    this.loadDefaultPatterns();
    this.loadCommandAnalyzers();
  }

  private loadDefaultPatterns(): void {
    const defaultPatterns: ErrorPattern[] = [
      {
        name: 'build_failure',
        pattern: /(?:Build failed|Compilation error|SyntaxError|TypeError|Error:|Failed to compile)/i,
        severity: 'critical',
        category: 'build_failure',
        description: 'Build or compilation failure detected',
        suggestedFix: 'Check syntax and type errors in the indicated files',
        cooldownMs: 5000
      },
      {
        name: 'test_failure',
        pattern: /(?:\d+\s+failing|✗|FAIL:|Test failed|AssertionError)/i,
        severity: 'high',
        category: 'test_failure', 
        description: 'Test failure detected',
        suggestedFix: 'Review failed test cases and assertions',
        cooldownMs: 10000
      },
      {
        name: 'network_error',
        pattern: /(?:ECONNREFUSED|ETIMEDOUT|network error|connection refused|timeout)/i,
        severity: 'high',
        category: 'network_error',
        description: 'Network connectivity issue',
        suggestedFix: 'Check network connectivity and service availability',
        cooldownMs: 15000
      },
      {
        name: 'dependency_error',
        pattern: /(?:MODULE_NOT_FOUND|Cannot resolve|dependency|package not found)/i,
        severity: 'medium',
        category: 'dependency_error',
        description: 'Dependency or module resolution error',
        suggestedFix: 'Install missing dependencies or check import paths',
        cooldownMs: 30000
      },
      {
        name: 'runtime_error',
        pattern: /(?:ReferenceError|TypeError|RangeError|null is not an object|undefined)/i,
        severity: 'high',
        category: 'runtime_error',
        description: 'Runtime error detected',
        suggestedFix: 'Check variable definitions and type safety',
        cooldownMs: 8000
      },
      {
        name: 'warning',
        pattern: /(?:Warning|WARN|deprecated|outdated)/i,
        severity: 'info',
        category: 'warning',
        description: 'Warning or deprecation notice',
        suggestedFix: 'Consider updating deprecated code or dependencies',
        cooldownMs: 60000
      }
    ];

    this.patterns.set('default', defaultPatterns);
  }

  private loadCommandAnalyzers(): void {
    this.commandAnalyzers.set('npm', {
      command: 'npm',
      patterns: [
        {
          name: 'npm_install_error',
          pattern: /(?:npm ERR!|peer dep missing|ERESOLVE)/i,
          severity: 'high',
          category: 'dependency_error',
          description: 'NPM installation error',
          suggestedFix: 'Clear npm cache or resolve peer dependency conflicts',
          cooldownMs: 20000
        },
        {
          name: 'npm_script_error',
          pattern: /(?:npm ERR! Exit status \d+|script failed)/i,
          severity: 'critical',
          category: 'build_failure',
          description: 'NPM script execution failed',
          suggestedFix: 'Check the failing script for errors',
          cooldownMs: 5000
        }
      ]
    });

    this.commandAnalyzers.set('docker', {
      command: 'docker',
      patterns: [
        {
          name: 'docker_build_error',
          pattern: /(?:Error response from daemon|failed to solve|build failed)/i,
          severity: 'critical',
          category: 'build_failure',
          description: 'Docker build failure',
          suggestedFix: 'Check Dockerfile syntax and build context',
          cooldownMs: 10000
        },
        {
          name: 'docker_connection_error',
          pattern: /(?:Cannot connect to the Docker daemon|docker: command not found)/i,
          severity: 'critical',
          category: 'system_error',
          description: 'Docker daemon connection issue',
          suggestedFix: 'Start Docker daemon or check Docker installation',
          cooldownMs: 30000
        }
      ]
    });

    this.commandAnalyzers.set('python', {
      command: 'python',
      patterns: [
        {
          name: 'python_import_error',
          pattern: /(?:ImportError|ModuleNotFoundError|No module named)/i,
          severity: 'high',
          category: 'dependency_error',
          description: 'Python module import error',
          suggestedFix: 'Install missing Python packages or check PYTHONPATH',
          cooldownMs: 15000
        },
        {
          name: 'python_syntax_error',
          pattern: /(?:SyntaxError|IndentationError|TabError)/i,
          severity: 'critical',
          category: 'build_failure',
          description: 'Python syntax error',
          suggestedFix: 'Fix syntax errors in the indicated file',
          cooldownMs: 5000
        }
      ]
    });
  }

  public analyzeLog(logEntry: LogEntry): ErrorEvent | null {
    if (logEntry.logLevel === 'stdout' && !this.containsError(logEntry.content)) {
      return null;
    }

    const commandType = logEntry.command.split(' ')[0];
    const relevantPatterns = this.getRelevantPatterns(commandType);
    
    for (const pattern of relevantPatterns) {
      if (pattern.pattern.test(logEntry.content)) {
        const cooldownKey = `${logEntry.sessionId}_${pattern.name}`;
        
        if (this.isInCooldown(cooldownKey, pattern.cooldownMs)) {
          continue;
        }

        const errorEvent = this.createErrorEvent(logEntry, pattern);
        this.setCooldown(cooldownKey);
        this.addToRecentErrors(logEntry.sessionId, errorEvent);
        
        return errorEvent;
      }
    }

    return null;
  }

  private containsError(content: string): boolean {
    const errorKeywords = ['error', 'failed', 'exception', 'warning', 'err!'];
    const lowerContent = content.toLowerCase();
    return errorKeywords.some(keyword => lowerContent.includes(keyword));
  }

  private getRelevantPatterns(commandType: string): ErrorPattern[] {
    const commandPatterns = this.commandAnalyzers.get(commandType)?.patterns || [];
    const defaultPatterns = this.patterns.get('default') || [];
    return [...commandPatterns, ...defaultPatterns];
  }

  private isInCooldown(key: string, cooldownMs: number): boolean {
    const lastTime = this.errorCooldowns.get(key);
    if (!lastTime) return false;
    return Date.now() - lastTime < cooldownMs;
  }

  private setCooldown(key: string): void {
    this.errorCooldowns.set(key, Date.now());
  }

  private createErrorEvent(logEntry: LogEntry, pattern: ErrorPattern): ErrorEvent {
    const context = this.extractErrorContext(logEntry);
    
    return {
      id: `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      sessionId: logEntry.sessionId,
      timestamp: logEntry.timestamp,
      severity: pattern.severity,
      category: pattern.category,
      summary: this.generateErrorSummary(logEntry, pattern),
      details: {
        errorCount: 1,
        firstError: logEntry.content,
        context: context.stackTrace || [logEntry.content],
        suggestedFix: pattern.suggestedFix
      },
      metadata: {
        projectDir: logEntry.projectDir,
        command: `${logEntry.command} ${logEntry.args.join(' ')}`,
        logsCursor: `line_${logEntry.lineNumber}`
      },
      actions: this.generateErrorActions(logEntry, pattern),
      acknowledged: false
    };
  }

  private extractErrorContext(logEntry: LogEntry): ErrorContext {
    const content = logEntry.content;
    const context: ErrorContext = {
      relatedFiles: []
    };

    const filePathRegex = /(?:at\s+)?([^\s:]+\.(?:js|ts|tsx|jsx|py|rb|go|rs|java|cpp|c|h)):(\d+):?(\d+)?/g;
    let match;
    while ((match = filePathRegex.exec(content)) !== null) {
      const filePath = match[1];
      const line = match[2];
      const column = match[3];
      context.relatedFiles.push(`${filePath}:${line}${column ? `:${column}` : ''}`);
    }

    if (content.includes('at ') || content.includes('Traceback')) {
      context.stackTrace = content.split('\n').filter(line => 
        line.trim().startsWith('at ') || 
        line.includes('File "') ||
        line.includes('line ')
      );
    }

    return context;
  }

  private generateErrorSummary(logEntry: LogEntry, pattern: ErrorPattern): string {
    const commandType = logEntry.command.split(' ')[0];
    
    if (pattern.category === 'build_failure') {
      return `${commandType} build failed in ${logEntry.projectDir}`;
    } else if (pattern.category === 'test_failure') {
      return `Test failures detected in ${commandType} tests`;
    } else if (pattern.category === 'dependency_error') {
      return `Dependency resolution error in ${commandType}`;
    } else {
      return `${pattern.description} in ${commandType}`;
    }
  }

  private generateErrorActions(logEntry: LogEntry, pattern: ErrorPattern): ErrorAction[] {
    const actions: ErrorAction[] = [
      {
        type: 'view_logs',
        label: 'View Full Logs'
      }
    ];

    const extractedContext = this.extractErrorContext(logEntry);
    if (extractedContext.relatedFiles.length > 0) {
      extractedContext.relatedFiles.forEach(filePath => {
        actions.push({
          type: 'open_file',
          label: `Open ${filePath.split(':')[0]}`,
          path: filePath
        });
      });
    }

    if (pattern.category === 'build_failure' || pattern.category === 'test_failure') {
      actions.push({
        type: 'restart_process',
        label: 'Restart Process'
      });
    }

    return actions;
  }

  private addToRecentErrors(sessionId: string, error: ErrorEvent): void {
    if (!this.recentErrors.has(sessionId)) {
      this.recentErrors.set(sessionId, []);
    }
    
    const errors = this.recentErrors.get(sessionId)!;
    errors.push(error);
    
    if (errors.length > 50) {
      errors.shift();
    }
  }

  public getRecentErrors(sessionId: string, limit: number = 10): ErrorEvent[] {
    const errors = this.recentErrors.get(sessionId) || [];
    return errors.slice(-limit);
  }

  public acknowledgeError(errorId: string): boolean {
    for (const errors of this.recentErrors.values()) {
      const error = errors.find(e => e.id === errorId);
      if (error) {
        error.acknowledged = true;
        return true;
      }
    }
    return false;
  }

  public clearSession(sessionId: string): void {
    this.recentErrors.delete(sessionId);
    
    const keysToDelete = Array.from(this.errorCooldowns.keys())
      .filter(key => key.startsWith(`${sessionId}_`));
    
    keysToDelete.forEach(key => this.errorCooldowns.delete(key));
  }
}