#!/usr/bin/env node

import { spawn } from 'child_process';
import { randomBytes } from 'crypto';
import { resolve } from 'path';
import { writeFileSync, mkdirSync, existsSync, readFileSync, appendFileSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readFileSync as readPackageJson } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import type { LogEntry, LogSession } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface LogPiperConfig {
  mcpServerPort?: number;
  mcpServerHost?: string;
  verbose?: boolean;
}

interface TimestampedLine {
  content: string;
  timestamp: number; // Date.now()
}

class LogPiperCLI {
  private config: LogPiperConfig;
  private sessionId: string;
  private session!: LogSession;
  private lineNumber: number = 0;
  private dataDir: string;
  private chunkBuffer: TimestampedLine[] = [];
  private chunkLevel: 'stdout' | 'stderr' | null = null;
  private readonly chunkTimeThreshold = 500; // ms - increased for better log grouping
  private chunkFlushTimer: NodeJS.Timeout | null = null;
  private currentServicePrefix: string | null = null;
  private readonly maxChunkLines = 20;
  private readonly maxChunkBytes = 8192; // 8KB

  constructor(config: LogPiperConfig = {}) {
    this.config = {
      mcpServerPort: 8080,
      mcpServerHost: 'localhost',
      ...config
    };

    this.dataDir = join(tmpdir(), 'logpiper');
    this.ensureDataDir();

    this.sessionId = this.generateSessionId();
    // Don't create session in constructor - do it when needed
  }

  private ensureDataDir(): void {
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
  }

  private generateSessionId(): string {
    const timestamp = Date.now();
    const random = randomBytes(4).toString('hex');
    return `session_${timestamp}_${random}`;
  }

  /**
   * Check for duplicate sessions and warn user
   */
  private checkForDuplicateSessions(projectDir: string, commandSignature: string): void {
    if (!existsSync(this.dataDir)) {
      return;
    }

    try {
      const files = readdirSync(this.dataDir);
      const activeSessions = [];

      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const sessionFile = join(this.dataDir, file);
            const sessionData = JSON.parse(readFileSync(sessionFile, 'utf8'));

            // Only check running sessions
            if (sessionData.status === 'running' &&
              sessionData.projectDir === projectDir &&
              sessionData.metadata?.commandSignature === commandSignature) {
              activeSessions.push(sessionData);
            }
          } catch {
            // Skip invalid session files
          }
        }
      }

      if (activeSessions.length > 0) {
        console.log(`\n⚠️  Warning: Found ${activeSessions.length} existing session(s) for the same command:`);
        for (const session of activeSessions) {
          const age = Date.now() - new Date(session.startTime).getTime();
          const ageMinutes = Math.floor(age / (1000 * 60));
          console.log(`  🔗 ${session.id} (${ageMinutes} minutes ago)`);
        }
        console.log('\n💡 Multiple sessions may be capturing the same output.');
        console.log('   This is normal if you\'re monitoring different aspects or instances.');
        console.log('');
      }
    } catch (error) {
      // Silently continue if we can't check for duplicates
    }
  }

  private getVersion(): string {
    try {
      // Try to find package.json in the module directory
      const moduleDir = resolve(__dirname, '..');
      const packagePath = join(moduleDir, 'package.json');
      const packageJson = JSON.parse(readPackageJson(packagePath, 'utf8'));
      return packageJson.version || 'unknown';
    } catch {
      try {
        // Fallback to current directory
        const packagePath = join(process.cwd(), 'package.json');
        const packageJson = JSON.parse(readPackageJson(packagePath, 'utf8'));
        return packageJson.version || 'unknown';
      } catch {
        return 'unknown';
      }
    }
  }

  private showHelp(): void {
    const version = this.getVersion();
    console.log(`logpiper v${version} - MCP server for intelligent log monitoring

USAGE:
  logpiper [OPTIONS] <command> [args...]
  logpiper [OPTIONS]

OPTIONS:
  -h, --help         Show this help message
  -V, --version      Show version number
  -v, --verbose      Enable verbose logging
      --install-agent Install LogPiper monitoring agent for Claude Code

EXAMPLES:
  # Monitor a build process
  logpiper npm run build

  # Monitor tests with verbose output
  logpiper --verbose npm test

  # Monitor Docker container logs
  docker logs -f myapp 2>&1 | logpiper

  # Monitor long-running services
  logpiper docker-compose up

  # Install monitoring agent after global installation
  logpiper --install-agent

CONTINUOUS MONITORING:
  For streaming logs, pipe both stdout and stderr:
    docker-compose logs -f 2>&1 | logpiper
    tail -f app.log | logpiper

DOCUMENTATION:
  GitHub: https://github.com/ivan23kor/logpiper-mcp
  
LogPiper streams command output to MCP tools for real-time error detection 
and analysis in Claude Code`);
  }

  private async installAgent(): Promise<void> {
    const { spawn } = await import('child_process');
    const postinstallScript = join(process.cwd(), 'scripts', 'postinstall.js');

    try {
      // Try to find the postinstall script in the module directory
      const moduleDir = resolve(__dirname, '..');
      const scriptPath = join(moduleDir, 'scripts', 'postinstall.js');

      const child = spawn('node', [scriptPath], {
        stdio: 'inherit',
        env: { ...process.env, npm_config_global: 'true' }
      });

      child.on('close', (code) => {
        process.exit(code || 0);
      });

      child.on('error', (error) => {
        console.error('❌ Failed to run agent installer:', error.message);
        console.log('💡 You can manually create ~/.claude/agents/logpiper-monitor.md');
        process.exit(1);
      });
    } catch (error) {
      console.error('❌ Agent installation failed:', error);
      process.exit(1);
    }
  }

  private parseArguments(): { command: string | null, args: string[] } {
    const allArgs = process.argv.slice(2);

    // Find the first argument that doesn't start with --
    let commandIndex = -1;
    for (let i = 0; i < allArgs.length; i++) {
      if (!allArgs[i].startsWith('--')) {
        commandIndex = i;
        break;
      }
    }

    if (commandIndex === -1) {
      return { command: null, args: [] };
    }

    const command = allArgs[commandIndex];
    const args = allArgs.slice(commandIndex + 1);

    return { command, args };
  }

  private initializeSession(command: string, args: string[]): void {
    const projectDir = resolve(process.cwd());
    const commandSignature = `${command} ${args.join(' ')}`;

    // Check for existing sessions with the same command in the same directory
    this.checkForDuplicateSessions(projectDir, commandSignature);

    this.session = {
      id: this.sessionId,
      projectDir,
      command,
      args,
      startTime: new Date(),
      status: 'running',
      readCursor: 0,
      errorHistory: [],
      lastActivity: new Date(),
      pid: undefined,
      metadata: {
        commandSignature,
        projectName: projectDir.split(/[/\\]/).pop() || 'unknown',
        workingDirectory: projectDir
      }
    };
  }

  private createLogEntry(content: string, logLevel: 'stdout' | 'stderr'): LogEntry {
    return {
      id: `${this.sessionId}_${this.lineNumber}`,
      sessionId: this.sessionId,
      projectDir: this.session.projectDir,
      command: this.session.command,
      args: this.session.args,
      timestamp: new Date(),
      logLevel,
      content: content.trim(),
      lineNumber: this.lineNumber++
    };
  }

  private async sendToMCPServer(data: any): Promise<void> {
    try {
      // Store session data
      if (data.type === 'session_start') {
        const sessionFile = join(this.dataDir, `${this.sessionId}.json`);
        writeFileSync(sessionFile, JSON.stringify(data.data, null, 2));
      }

      // Store log entries
      if (data.type === 'log_entry') {
        const logsFile = join(this.dataDir, `${this.sessionId}.logs`);
        appendFileSync(logsFile, JSON.stringify(data.data) + '\n');
      }

      // Update session status and schedule cleanup for terminated sessions
      if (data.type === 'session_end' || data.type === 'session_interrupt' || data.type === 'process_error') {
        const sessionFile = join(this.dataDir, `${this.sessionId}.json`);
        if (existsSync(sessionFile)) {
          const session = JSON.parse(readFileSync(sessionFile, 'utf8'));
          if (data.type === 'session_end') {
            // Preserve the status set by the child close handler
            session.status = this.session.status;
            session.endTime = data.data.endTime;
          } else if (data.type === 'process_error') {
            session.status = 'crashed';
            session.endTime = new Date();
          } else if (data.type === 'session_interrupt') {
            session.status = 'stopped';
            session.endTime = data.data.timestamp;
          }
          session.autoCleanupScheduled = true;
          writeFileSync(sessionFile, JSON.stringify(session, null, 2));
        }

        // Schedule immediate cleanup for terminated sessions
        setTimeout(() => {
          this.cleanupTerminatedSession();
        }, 500); // Short delay to ensure session file is written
      }

      if (this.config.verbose) {
        console.error('logpiper event:', JSON.stringify(data));
      }
    } catch (error) {
      if (this.config.verbose) {
        console.error('Failed to store logpiper data:', error);
      }
    }
  }

  private cleanupTerminatedSession(): void {
    try {
      const sessionFile = join(this.dataDir, `${this.sessionId}.json`);
      const logsFile = join(this.dataDir, `${this.sessionId}.logs`);

      // Check if session is marked for auto cleanup
      if (existsSync(sessionFile)) {
        const session = JSON.parse(readFileSync(sessionFile, 'utf8'));
        if (session.autoCleanupScheduled && session.status !== 'running') {
          // Remove session and log files
          try {
            if (existsSync(sessionFile)) {
              unlinkSync(sessionFile);
              if (this.config.verbose) {
                console.error(`Cleaned up session file: ${sessionFile}`);
              }
            }
            if (existsSync(logsFile)) {
              unlinkSync(logsFile);
              if (this.config.verbose) {
                console.error(`Cleaned up logs file: ${logsFile}`);
              }
            }
          } catch (cleanupError) {
            if (this.config.verbose) {
              console.error('Failed to cleanup session files:', cleanupError);
            }
          }
        }
      }
    } catch (error) {
      if (this.config.verbose) {
        console.error('Error during session cleanup:', error);
      }
    }
  }

  private async handleOutput(data: Buffer, logLevel: 'stdout' | 'stderr'): Promise<void> {
    const content = data.toString();
    const lines = content.split('\n').filter(line => line.length > 0);
    const timestamp = Date.now();

    // Display output immediately for real-time feedback
    for (const line of lines) {
      console.log(line);
    }

    // Add to chunk buffer with timestamps
    this.addToChunk(lines, logLevel, timestamp);
    this.session.lastActivity = new Date();
  }

  private addToChunk(lines: string[], logLevel: 'stdout' | 'stderr', timestamp: number): void {
    // Check if we need to flush current chunk before adding new lines
    if (this.shouldFlushChunk(logLevel, lines)) {
      this.flushChunk();
    }

    // Update current service prefix from first line
    if (lines.length > 0) {
      const servicePrefix = this.extractServicePrefix(lines[0]);
      if (servicePrefix) {
        this.currentServicePrefix = servicePrefix;
      }
    }

    // Add lines to buffer with timestamps
    const timestampedLines: TimestampedLine[] = lines.map(content => ({
      content,
      timestamp
    }));

    this.chunkBuffer.push(...timestampedLines);
    this.chunkLevel = logLevel;

    // Set or reset flush timer to batch log entries
    if (this.chunkFlushTimer) {
      clearTimeout(this.chunkFlushTimer);
    }

    this.chunkFlushTimer = setTimeout(() => {
      this.flushChunk();
    }, this.chunkTimeThreshold);
  }

  private extractServicePrefix(line: string): string | null {
    // Match docker-compose service prefixes like "crowbar-mongodb        |"
    const dockerComposeMatch = line.match(/^([a-zA-Z0-9_-]+)\s*\|\s*/);
    if (dockerComposeMatch) {
      return dockerComposeMatch[1];
    }

    // Match other common service patterns like "[service-name]" or "service-name:"
    const serviceBracketMatch = line.match(/^\[([a-zA-Z0-9_-]+)\]/);
    if (serviceBracketMatch) {
      return serviceBracketMatch[1];
    }

    const serviceColonMatch = line.match(/^([a-zA-Z0-9_-]+):\s/);
    if (serviceColonMatch) {
      return serviceColonMatch[1];
    }

    return null;
  }

  private isJsonLikeLine(line: string): boolean {
    const trimmed = line.trim();
    return (trimmed.startsWith('{') && trimmed.includes('"')) ||
      (trimmed.includes('"t":{"$date":') && trimmed.includes('"s":'));
  }

  private shouldFlushChunk(newLogLevel: 'stdout' | 'stderr', newLines: string[]): boolean {
    // Flush if no current chunk exists
    if (this.chunkLevel === null || this.chunkBuffer.length === 0) {
      return false;
    }

    // Flush if log level changed
    if (this.chunkLevel !== newLogLevel) {
      return true;
    }

    // Check size limits
    if (this.chunkBuffer.length >= this.maxChunkLines) {
      return true;
    }

    const currentSize = this.chunkBuffer.reduce((sum, line) => sum + line.content.length, 0);
    const newSize = newLines.reduce((sum, line) => sum + line.length, 0);
    if (currentSize + newSize > this.maxChunkBytes) {
      return true;
    }

    // Check for service prefix change (content-based grouping)
    if (newLines.length > 0) {
      const newServicePrefix = this.extractServicePrefix(newLines[0]);

      // If we have a current service and new lines have a different service, flush
      if (this.currentServicePrefix && newServicePrefix &&
        this.currentServicePrefix !== newServicePrefix) {
        return true;
      }
    }

    return false;
  }

  private async flushChunk(): Promise<void> {
    if (this.chunkBuffer.length === 0) return;

    // Clear flush timer
    if (this.chunkFlushTimer) {
      clearTimeout(this.chunkFlushTimer);
      this.chunkFlushTimer = null;
    }

    // Extract content from timestamped lines and combine
    const combinedContent = this.chunkBuffer.map(line => line.content).join('\n');
    const logEntry = this.createLogEntry(combinedContent, this.chunkLevel!);

    await this.sendToMCPServer({
      type: 'log_entry',
      data: logEntry
    });

    // Reset chunk state
    this.chunkBuffer = [];
    this.chunkLevel = null;
    this.currentServicePrefix = null;
  }

  private async runPipeMode(): Promise<void> {
    this.initializeSession('pipe', []);

    console.error(`🚀 logpiper pipe mode started`);
    console.error(`📁 Project: ${this.session.projectDir}`);
    console.error(`🔗 Session: ${this.sessionId}`);

    await this.sendToMCPServer({
      type: 'session_start',
      data: this.session
    });

    // Read from stdin with chunking
    process.stdin.on('data', (data) => {
      this.handleOutput(data, 'stdout');
    });

    process.stdin.on('end', async () => {
      // Flush any remaining chunk before ending
      await this.flushChunk();

      this.session.status = 'stopped';
      this.session.endTime = new Date();

      await this.sendToMCPServer({
        type: 'session_end',
        data: {
          sessionId: this.sessionId,
          endTime: this.session.endTime
        }
      });

      console.error(`\n✅ Pipe mode completed`);
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      console.error('\n⏹️  Stopping logpiper...');

      // Flush any remaining chunk before interrupting
      await this.flushChunk();

      await this.sendToMCPServer({
        type: 'session_interrupt',
        data: {
          sessionId: this.sessionId,
          timestamp: new Date()
        }
      });

      // Wait a moment for cleanup to complete
      await new Promise(resolve => setTimeout(resolve, 1000));

      process.exit(0);
    });
  }

  async run(): Promise<void> {
    // Check for special flags first
    const allArgs = process.argv.slice(2);

    // Handle help flag
    if (allArgs.includes('--help') || allArgs.includes('-h')) {
      this.showHelp();
      return;
    }

    // Handle version flag
    if (allArgs.includes('--version') || allArgs.includes('-V')) {
      console.log(this.getVersion());
      return;
    }

    // Handle agent installation
    if (allArgs.includes('--install-agent')) {
      await this.installAgent();
      return;
    }

    const { command, args } = this.parseArguments();

    if (!command) {
      // Handle pipe mode - read from stdin
      await this.runPipeMode();
      return;
    }

    this.initializeSession(command, args);

    console.log(`🚀 logpiper starting: ${this.session.command} ${this.session.args.join(' ')}`);
    console.log(`📁 Project: ${this.session.projectDir}`);
    console.log(`🔗 Session: ${this.sessionId}`);

    await this.sendToMCPServer({
      type: 'session_start',
      data: this.session
    });

    const child = spawn(this.session.command, this.session.args, {
      cwd: this.session.projectDir,
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: process.platform === 'win32'
    });

    this.session.pid = child.pid;

    child.stdout?.on('data', (data) => {
      this.handleOutput(data, 'stdout');
    });

    child.stderr?.on('data', (data) => {
      this.handleOutput(data, 'stderr');
    });

    child.on('close', async (code, signal) => {
      // Flush any remaining chunk before ending session
      await this.flushChunk();

      // Distinguish between crashes and graceful terminations
      // Common signals that indicate graceful shutdown: SIGINT, SIGTERM, SIGHUP
      const isGracefulShutdown = signal === 'SIGINT' || signal === 'SIGTERM' || signal === 'SIGHUP' ||
        // Also check for common signal exit codes: 130 (SIGINT), 143 (SIGTERM), 129 (SIGHUP)
        code === 130 || code === 143 || code === 129;
      const isSuccess = code === 0;
      
      this.session.status = isSuccess || isGracefulShutdown ? 'stopped' : 'crashed';
      this.session.endTime = new Date();

      await this.sendToMCPServer({
        type: 'session_end',
        data: {
          sessionId: this.sessionId,
          exitCode: code,
          signal,
          endTime: this.session.endTime
        }
      });

      if (isSuccess) {
        console.log(`\n✅ Process completed successfully (code: ${code})`);
      } else if (isGracefulShutdown) {
        console.log(`\n⏹️  Process terminated gracefully by signal ${signal} (code: ${code})`);
      } else {
        console.log(`\n❌ Process crashed (code: ${code})`);
      }

      // Wait a moment for cleanup to complete
      await new Promise(resolve => setTimeout(resolve, 1000));

      process.exit(code || 0);
    });

    child.on('error', async (error) => {
      // Flush any remaining chunk before crashing
      await this.flushChunk();

      this.session.status = 'crashed';

      await this.sendToMCPServer({
        type: 'process_error',
        data: {
          sessionId: this.sessionId,
          error: error.message,
          timestamp: new Date()
        }
      });

      console.error('❌ Process error:', error.message);
      process.exit(1);
    });

    process.on('SIGINT', async () => {
      console.log('\n⏹️  Stopping logpiper...');

      // Flush any remaining chunk before interrupting
      await this.flushChunk();

      child.kill('SIGTERM');

      setTimeout(() => {
        child.kill('SIGKILL');
      }, 5000);

      await this.sendToMCPServer({
        type: 'session_interrupt',
        data: {
          sessionId: this.sessionId,
          timestamp: new Date()
        }
      });

      // Wait a moment for cleanup to complete
      await new Promise(resolve => setTimeout(resolve, 1000));

      process.exit(0);
    });
  }
}

const cli = new LogPiperCLI({
  verbose: process.argv.includes('--verbose') || process.argv.includes('-v')
});

cli.run().catch((error) => {
  console.error('❌ logpiper CLI error:', error);
  process.exit(1);
});