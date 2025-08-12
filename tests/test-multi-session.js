#!/usr/bin/env node

/**
 * Test script to verify that multiple logpiper sessions work correctly
 */

import { spawn } from 'child_process';
import { join } from 'path';
import { setTimeout } from 'timers/promises';
import { existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';

const TEST_DURATION = 10000; // 10 seconds
const LOGPIPER_BINARY = 'node dist/cli.js';

class MultiSessionTest {
  constructor() {
    this.processes = [];
    this.sessionIds = [];
    this.dataDir = join(tmpdir(), 'logpiper');
  }

  async runTest() {
    console.log('🧪 Starting multi-session test...');
    
    try {
      // Start multiple logpiper instances
      await this.startSession1(); // npm run dev in frontend directory
      await this.startSession2(); // echo command with different output
      await this.startSession3(); // docker-compose logs simulation
      
      console.log(`⏳ Running test for ${TEST_DURATION / 1000} seconds...`);
      await setTimeout(TEST_DURATION);
      
      // Check results
      await this.verifyResults();
      
    } catch (error) {
      console.error('❌ Test failed:', error);
    } finally {
      await this.cleanup();
    }
  }

  async startSession1() {
    console.log('🚀 Starting session 1: echo with interval');
    
    const childProcess = spawn('node', ['dist/cli.js', 'cmd', '/c', 'for /L %i in (1,1,20) do (echo Session1: Log entry %i && timeout /t 1 /nobreak > nul)'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true
    });

    this.processes.push(childProcess);
    
    childProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('📝 Session1 stdout:', output.trim());
      
      // Extract session ID from output
      const sessionMatch = output.match(/🔗 Session: (session_[a-f0-9_]+)/);
      if (sessionMatch && !this.sessionIds.includes(sessionMatch[1])) {
        this.sessionIds.push(sessionMatch[1]);
        console.log('✅ Captured Session1 ID:', sessionMatch[1]);
      }
    });

    childProcess.stderr.on('data', (data) => {
      const output = data.toString();
      console.log('📝 Session1 stderr:', output.trim());
      
      // Extract session ID from output
      const sessionMatch = output.match(/🔗 Session: (session_[a-f0-9_]+)/);
      if (sessionMatch && !this.sessionIds.includes(sessionMatch[1])) {
        this.sessionIds.push(sessionMatch[1]);
        console.log('✅ Captured Session1 ID:', sessionMatch[1]);
      }
    });

    // Give it time to start
    await setTimeout(1000);
  }

  async startSession2() {
    console.log('🚀 Starting session 2: different echo command');
    
    const childProcess = spawn('node', ['dist/cli.js', 'cmd', '/c', 'for /L %i in (1,1,15) do (echo Session2: Different log %i && timeout /t 1 /nobreak > nul)'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true
    });

    this.processes.push(childProcess);

    childProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('📝 Session2 stdout:', output.trim());
      
      // Extract session ID from output
      const sessionMatch = output.match(/🔗 Session: (session_[a-f0-9_]+)/);
      if (sessionMatch && !this.sessionIds.includes(sessionMatch[1])) {
        this.sessionIds.push(sessionMatch[1]);
        console.log('✅ Captured Session2 ID:', sessionMatch[1]);
      }
    });

    childProcess.stderr.on('data', (data) => {
      const output = data.toString();
      console.log('📝 Session2 stderr:', output.trim());
      
      // Extract session ID from output
      const sessionMatch = output.match(/🔗 Session: (session_[a-f0-9_]+)/);
      if (sessionMatch && !this.sessionIds.includes(sessionMatch[1])) {
        this.sessionIds.push(sessionMatch[1]);
        console.log('✅ Captured Session2 ID:', sessionMatch[1]);
      }
    });

    // Give it time to start
    await setTimeout(1000);
  }

  async startSession3() {
    console.log('🚀 Starting session 3: ping command');
    
    const childProcess = spawn('node', ['dist/cli.js', 'ping', '127.0.0.1', '-n', '8'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true
    });

    this.processes.push(childProcess);

    childProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('📝 Session3 stdout:', output.trim());
      
      // Extract session ID from output
      const sessionMatch = output.match(/🔗 Session: (session_[a-f0-9_]+)/);
      if (sessionMatch && !this.sessionIds.includes(sessionMatch[1])) {
        this.sessionIds.push(sessionMatch[1]);
        console.log('✅ Captured Session3 ID:', sessionMatch[1]);
      }
    });

    childProcess.stderr.on('data', (data) => {
      const output = data.toString();
      console.log('📝 Session3 stderr:', output.trim());
      
      // Extract session ID from output
      const sessionMatch = output.match(/🔗 Session: (session_[a-f0-9_]+)/);
      if (sessionMatch && !this.sessionIds.includes(sessionMatch[1])) {
        this.sessionIds.push(sessionMatch[1]);
        console.log('✅ Captured Session3 ID:', sessionMatch[1]);
      }
    });

    // Give it time to start
    await setTimeout(1000);
  }

  async verifyResults() {
    console.log('\n📊 Verification Results:');
    console.log(`🎯 Started ${this.processes.length} logpiper processes`);
    console.log(`📝 Captured ${this.sessionIds.length} session IDs:`, this.sessionIds);
    
    let successCount = 0;
    let totalLogCount = 0;

    for (const sessionId of this.sessionIds) {
      const sessionFile = join(this.dataDir, `${sessionId}.json`);
      const logsFile = join(this.dataDir, `${sessionId}.logs`);
      
      console.log(`\n🔍 Checking session: ${sessionId}`);
      
      if (existsSync(sessionFile)) {
        const sessionData = JSON.parse(readFileSync(sessionFile, 'utf8'));
        console.log(`  ✅ Session file exists`);
        console.log(`  📁 Project: ${sessionData.projectDir}`);
        console.log(`  🔨 Command: ${sessionData.command} ${sessionData.args.join(' ')}`);
        console.log(`  ⏱️  Started: ${sessionData.startTime}`);
        console.log(`  📊 Status: ${sessionData.status}`);
      } else {
        console.log(`  ❌ Session file missing`);
        continue;
      }
      
      if (existsSync(logsFile)) {
        const logContent = readFileSync(logsFile, 'utf8');
        const logLines = logContent.trim().split('\n').filter(line => line.length > 0);
        console.log(`  ✅ Logs file exists with ${logLines.length} entries`);
        
        // Show first and last log entries
        if (logLines.length > 0) {
          try {
            const firstLog = JSON.parse(logLines[0]);
            const lastLog = JSON.parse(logLines[logLines.length - 1]);
            console.log(`  📅 First log: ${firstLog.timestamp} - ${firstLog.content.substring(0, 50)}...`);
            console.log(`  📅 Last log:  ${lastLog.timestamp} - ${lastLog.content.substring(0, 50)}...`);
            totalLogCount += logLines.length;
          } catch (error) {
            console.log(`  ⚠️  Error parsing log entries: ${error.message}`);
          }
        }
        
        successCount++;
      } else {
        console.log(`  ❌ Logs file missing`);
      }
    }

    console.log(`\n📈 Summary:`);
    console.log(`  ✅ Successful sessions: ${successCount}/${this.sessionIds.length}`);
    console.log(`  📝 Total log entries: ${totalLogCount}`);
    
    if (successCount === this.sessionIds.length && successCount >= 2) {
      console.log(`\n🎉 TEST PASSED: Multiple logpiper sessions work correctly!`);
      return true;
    } else {
      console.log(`\n❌ TEST FAILED: Not all sessions worked correctly`);
      return false;
    }
  }

  async cleanup() {
    console.log('\n🧹 Cleaning up...');
    
    for (const process of this.processes) {
      if (!process.killed) {
        process.kill('SIGTERM');
        console.log('  ⏹️  Terminated process');
      }
    }
    
    // Wait for processes to close gracefully
    await setTimeout(2000);
    
    for (const process of this.processes) {
      if (!process.killed) {
        process.kill('SIGKILL');
        console.log('  💀 Force killed process');
      }
    }
    
    console.log('✅ Cleanup complete');
  }
}

// Run the test
const test = new MultiSessionTest();
test.runTest().catch(console.error);
