#!/usr/bin/env node

import { spawn } from 'child_process';
import { randomBytes } from 'crypto';
import { resolve } from 'path';
import { writeFileSync, mkdirSync, existsSync, readFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { LogEntry, LogSession } from './types.js';

interface LogPiperConfig {
  mcpServerPort?: number;
  mcpServerHost?: string;
  verbose?: boolean;
}

class LogPiperCLI {
  private config: LogPiperConfig;
  private sessionId: string;
  private session: LogSession;
  private lineNumber: number = 0;
  private dataDir: string;
  private chunkBuffer: string[] = [];
  private chunkLevel: 'stdout' | 'stderr' | null = null;
  private chunkTimer: NodeJS.Timeout | null = null;
  private readonly chunkDelay = 100; // ms

  constructor(config: LogPiperConfig = {}) {
    this.config = {
      mcpServerPort: 8080,
      mcpServerHost: 'localhost',
      ...config
    };
    
    this.dataDir = join(tmpdir(), 'logpiper');
    this.ensureDataDir();
    
    this.sessionId = this.generateSessionId();
    this.session = this.createSession();
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

  private createSession(): LogSession {
    const projectDir = resolve(process.cwd());
    const allArgs = process.argv.slice(2).filter(arg => arg !== '--verbose' && arg !== '-v');
    const [command, ...args] = allArgs;
    
    if (!command) {
      console.error('Usage: logpiper <command> [args...]');
      process.exit(1);
    }

    return {
      id: this.sessionId,
      projectDir,
      command,
      args,
      startTime: new Date(),
      status: 'running',
      readCursor: 0,
      errorHistory: [],
      lastActivity: new Date()
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
      
      // Update session status
      if (data.type === 'session_end') {
        const sessionFile = join(this.dataDir, `${this.sessionId}.json`);
        if (existsSync(sessionFile)) {
          const session = JSON.parse(readFileSync(sessionFile, 'utf8'));
          session.status = 'stopped';
          session.endTime = data.data.endTime;
          writeFileSync(sessionFile, JSON.stringify(session, null, 2));
        }
      }
      
      if (this.config.verbose) {
        console.error('LogPiper event:', JSON.stringify(data));
      }
    } catch (error) {
      if (this.config.verbose) {
        console.error('Failed to store LogPiper data:', error);
      }
    }
  }

  private async handleOutput(data: Buffer, logLevel: 'stdout' | 'stderr'): Promise<void> {
    const content = data.toString();
    const lines = content.split('\n').filter(line => line.length > 0);

    // Display output immediately for real-time feedback
    for (const line of lines) {
      console.log(line);
    }

    // Add to chunk buffer
    this.addToChunk(lines, logLevel);
    this.session.lastActivity = new Date();
  }

  private addToChunk(lines: string[], logLevel: 'stdout' | 'stderr'): void {
    // If this is a different log level than current chunk, flush and start new chunk
    if (this.chunkLevel !== null && this.chunkLevel !== logLevel) {
      this.flushChunk();
    }

    // Add lines to buffer
    this.chunkBuffer.push(...lines);
    this.chunkLevel = logLevel;

    // Reset/set timer to flush chunk after delay
    if (this.chunkTimer) {
      clearTimeout(this.chunkTimer);
    }
    
    this.chunkTimer = setTimeout(() => {
      this.flushChunk();
    }, this.chunkDelay);
  }

  private async flushChunk(): Promise<void> {
    if (this.chunkBuffer.length === 0) return;

    const combinedContent = this.chunkBuffer.join('\n');
    const logEntry = this.createLogEntry(combinedContent, this.chunkLevel!);
    
    await this.sendToMCPServer({
      type: 'log_entry',
      data: logEntry
    });

    // Reset chunk state
    this.chunkBuffer = [];
    this.chunkLevel = null;
    this.chunkTimer = null;
  }

  async run(): Promise<void> {
    console.log(`🚀 LogPiper starting: ${this.session.command} ${this.session.args.join(' ')}`);
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
      
      this.session.status = code === 0 ? 'stopped' : 'crashed';
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

      console.log(`\n✅ Process ${code === 0 ? 'completed' : 'crashed'} (code: ${code})`);
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
    });
  }
}

const cli = new LogPiperCLI({
  verbose: process.argv.includes('--verbose') || process.argv.includes('-v')
});

cli.run().catch((error) => {
  console.error('❌ LogPiper CLI error:', error);
  process.exit(1);
});