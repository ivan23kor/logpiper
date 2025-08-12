#!/usr/bin/env node

/**
 * Test to verify that logpiper client termination automatically cleans up session files
 */

import { spawn } from 'child_process';
import { setTimeout } from 'timers/promises';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DURATION = 8000; // 8 seconds

class ClientTerminationCleanupTest {
  constructor() {
    this.processes = [];
    this.dataDir = join(tmpdir(), 'logpiper');
    this.sessionIds = [];
  }

  async runTest() {
    console.log('🧪 Client termination cleanup test starting...\n');
    
    try {
      // Clear any existing data
      await this.clearExistingData();
      
      // Start multiple logpiper sessions
      await this.startTestSessions();
      
      // Wait for sessions to generate some logs
      console.log('⏳ Waiting for sessions to generate logs...');
      await setTimeout(3000);
      
      // Verify sessions and logs exist
      const beforeTermination = await this.checkSessionFiles();
      console.log(`📊 Before termination: ${beforeTermination.testSessions} test sessions, ${beforeTermination.testLogFiles} test log files`);
      console.log(`    (Total in system: ${beforeTermination.sessions} sessions, ${beforeTermination.logFiles} log files)`);
      
      if (beforeTermination.testSessions === 0) {
        throw new Error('No test sessions were created');
      }
      
      // Show details of test sessions
      console.log('📝 Test session details:');
      for (const detail of beforeTermination.details.filter(d => d.isTestSession)) {
        console.log(`    🔸 ${detail.sessionId}: ${detail.status}, autoCleanup: ${detail.autoCleanupScheduled}, hasLogs: ${detail.hasLogs}`);
      }
      
      // Terminate all processes
      console.log('\n⏹️  Terminating all logpiper processes...');
      await this.terminateProcesses();
      
      // Wait for cleanup to complete (5 seconds for cleanup + 2 seconds buffer)
      console.log('⏳ Waiting for automatic cleanup...');
      await setTimeout(7000);
      
      // Check if files were cleaned up
      const afterCleanup = await this.checkSessionFiles();
      console.log(`📊 After cleanup: ${afterCleanup.testSessions} test sessions, ${afterCleanup.testLogFiles} test log files`);
      console.log(`    (Total in system: ${afterCleanup.sessions} sessions, ${afterCleanup.logFiles} log files)`);
      
      // Show remaining test sessions details
      const remainingTestSessions = afterCleanup.details.filter(d => d.isTestSession);
      if (remainingTestSessions.length > 0) {
        console.log('📝 Remaining test session details:');
        for (const detail of remainingTestSessions) {
          console.log(`    🔸 ${detail.sessionId}: ${detail.status}, autoCleanup: ${detail.autoCleanupScheduled}, hasLogs: ${detail.hasLogs}`);
        }
      }
      
      // Verify cleanup occurred
      const cleanupSuccessful = (afterCleanup.testSessions === 0 && afterCleanup.testLogFiles === 0);
      
      if (cleanupSuccessful) {
        console.log('\n🎉 TEST PASSED: Client termination cleanup works correctly!');
        return true;
      } else {
        console.log('\n❌ TEST FAILED: Test files were not cleaned up after client termination');
        console.log(`  Expected: 0 test sessions, 0 test log files`);
        console.log(`  Actual: ${afterCleanup.testSessions} test sessions, ${afterCleanup.testLogFiles} test log files`);
        return false;
      }
      
    } catch (error) {
      console.error('❌ Test failed:', error);
      return false;
    } finally {
      await this.cleanup();
    }
  }

  async clearExistingData() {
    console.log('🧹 Clearing existing test data...');
    if (!existsSync(this.dataDir)) {
      return;
    }
    
    try {
      const files = readdirSync(this.dataDir);
      for (const file of files) {
        if (file.includes('test_')) {
          const fs = require('fs');
          fs.unlinkSync(join(this.dataDir, file));
        }
      }
    } catch (error) {
      console.log('Note: Could not clear existing data:', error.message);
    }
  }

  async startTestSessions() {
    console.log('🚀 Starting test logpiper sessions...');
    
    // Session 1: Short echo command
    this.startSession('echo', ['Test', 'session', '1'], 'test_session_1');
    await setTimeout(500);
    
    // Session 2: Multiple echo commands
    this.startSession('cmd', ['/c', 'for /L %i in (1,1,5) do (echo Test session 2 entry %i && timeout /t 1 /nobreak > nul)'], 'test_session_2');
    await setTimeout(500);
    
    // Session 3: Ping command (will be terminated)
    this.startSession('ping', ['127.0.0.1', '-n', '10'], 'test_session_3');
    await setTimeout(500);
  }

  startSession(command, args, sessionName) {
    console.log(`  🔸 Starting ${sessionName}: ${command} ${args.join(' ')}`);
    
    const childProcess = spawn('node', ['dist/cli.js', command, ...args], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32'
    });

    this.processes.push(childProcess);
    
    childProcess.stdout.on('data', (data) => {
      const output = data.toString();
      
      // Extract session ID from output
      const sessionMatch = output.match(/🔗 Session: (session_[a-f0-9_]+)/);
      if (sessionMatch && !this.sessionIds.includes(sessionMatch[1])) {
        this.sessionIds.push(sessionMatch[1]);
        console.log(`    ✅ Captured session ID: ${sessionMatch[1]}`);
      }
    });

    childProcess.stderr.on('data', (data) => {
      const output = data.toString();
      
      // Extract session ID from stderr
      const sessionMatch = output.match(/🔗 Session: (session_[a-f0-9_]+)/);
      if (sessionMatch && !this.sessionIds.includes(sessionMatch[1])) {
        this.sessionIds.push(sessionMatch[1]);
        console.log(`    ✅ Captured session ID: ${sessionMatch[1]}`);
      }
    });
  }

  async checkSessionFiles() {
    if (!existsSync(this.dataDir)) {
      return { sessions: 0, logFiles: 0, details: [], testSessions: 0, testLogFiles: 0 };
    }

    const files = readdirSync(this.dataDir);
    const sessionFiles = files.filter(f => f.endsWith('.json'));
    const logFiles = files.filter(f => f.endsWith('.logs'));
    
    const details = [];
    let testSessions = 0;
    let testLogFiles = 0;
    
    for (const sessionFile of sessionFiles) {
      try {
        const sessionData = JSON.parse(readFileSync(join(this.dataDir, sessionFile), 'utf8'));
        const hasLogs = existsSync(join(this.dataDir, sessionFile.replace('.json', '.logs')));
        
        // Check if this is one of our test sessions
        const isTestSession = this.sessionIds.includes(sessionData.id);
        if (isTestSession) {
          testSessions++;
          if (hasLogs) testLogFiles++;
        }
        
        details.push({
          sessionId: sessionData.id,
          status: sessionData.status,
          hasLogs,
          autoCleanupScheduled: sessionData.autoCleanupScheduled || false,
          isTestSession
        });
      } catch (error) {
        console.log(`    ⚠️  Error reading ${sessionFile}: ${error.message}`);
      }
    }
    
    return {
      sessions: sessionFiles.length,
      logFiles: logFiles.length,
      details,
      testSessions,
      testLogFiles
    };
  }

  async terminateProcesses() {
    for (const process of this.processes) {
      if (!process.killed) {
        console.log(`  🔸 Terminating process PID ${process.pid}`);
        process.kill('SIGTERM');
      }
    }
    
    // Wait a moment for graceful termination
    await setTimeout(1000);
    
    // Force kill any remaining processes
    for (const process of this.processes) {
      if (!process.killed) {
        console.log(`  🔸 Force killing process PID ${process.pid}`);
        process.kill('SIGKILL');
      }
    }
  }

  async cleanup() {
    console.log('\n🧹 Final cleanup...');
    
    // Make sure all processes are terminated
    for (const process of this.processes) {
      if (!process.killed) {
        process.kill('SIGKILL');
      }
    }
    
    console.log('✅ Cleanup complete');
  }
}

// Run the test
const test = new ClientTerminationCleanupTest();
test.runTest().then(success => {
  process.exit(success ? 0 : 1);
}).catch(error => {
  console.error('Test execution failed:', error);
  process.exit(1);
});