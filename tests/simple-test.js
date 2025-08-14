#!/usr/bin/env node

/**
 * Simple test to verify multiple logpiper sessions work correctly
 */

import { spawn } from 'child_process';
import { setTimeout } from 'timers/promises';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DURATION = 8000; // 8 seconds

class SimpleMultiSessionTest {
  constructor() {
    this.processes = [];
    this.dataDir = join(tmpdir(), 'logpiper');
  }

  async runTest() {
    console.log('🧪 Simple multi-session test starting...\n');
    
    try {
      // Start 3 different simple commands
      this.startSession('ping -n 3 127.0.0.1', '1');
      await setTimeout(1000);
      
      this.startSession('echo Hello from session 2', '2'); 
      await setTimeout(1000);
      
      this.startSession('dir C:\\', '3');
      
      console.log(`⏳ Running test for ${TEST_DURATION / 1000} seconds...\n`);
      await setTimeout(TEST_DURATION);
      
      // Check results
      await this.checkResults();
      
    } catch (error) {
      console.error('❌ Test failed:', error);
    } finally {
      await this.cleanup();
    }
  }

  startSession(command, sessionName) {
    console.log(`🚀 Starting session ${sessionName}: ${command}`);
    
    const childProcess = spawn('node', ['dist/cli.js', ...command.split(' ')], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false
    });

    this.processes.push(childProcess);
    
    childProcess.stdout.on('data', (data) => {
      console.log(`📝 Session${sessionName}:`, data.toString().trim());
    });

    childProcess.stderr.on('data', (data) => {
      console.log(`📝 Session${sessionName} (err):`, data.toString().trim());
    });
  }

  async checkResults() {
    console.log('\n📊 Checking results...');
    
    if (!existsSync(this.dataDir)) {
      console.log('❌ No logpiper data directory found');
      return;
    }

    const files = readdirSync(this.dataDir);
    const sessionFiles = files.filter(f => f.endsWith('.json'));
    const logFiles = files.filter(f => f.endsWith('.logs'));
    
    console.log(`📂 Found ${sessionFiles.length} session files`);
    console.log(`📜 Found ${logFiles.length} log files`);
    
    let totalLogEntries = 0;
    
    for (const logFile of logFiles) {
      try {
        const content = readFileSync(join(this.dataDir, logFile), 'utf8');
        const lines = content.trim().split('\n').filter(line => line.length > 0);
        totalLogEntries += lines.length;
        console.log(`  📄 ${logFile}: ${lines.length} entries`);
      } catch (error) {
        console.log(`  ❌ Error reading ${logFile}: ${error.message}`);
      }
    }
    
    console.log(`\n📈 Summary:`);
    console.log(`  📁 Session files: ${sessionFiles.length}`);
    console.log(`  📜 Log files: ${logFiles.length}`);
    console.log(`  📝 Total log entries: ${totalLogEntries}`);
    
    if (sessionFiles.length >= 2 && logFiles.length >= 2 && totalLogEntries > 0) {
      console.log(`\n🎉 TEST PASSED: Multiple sessions are working!`);
      return true;
    } else {
      console.log(`\n❌ TEST FAILED: Expected multiple sessions with logs`);
      return false;
    }
  }

  async cleanup() {
    console.log('\n🧹 Cleaning up...');
    
    for (const process of this.processes) {
      if (!process.killed) {
        process.kill('SIGTERM');
      }
    }
    
    await setTimeout(1000);
    
    for (const process of this.processes) {
      if (!process.killed) {
        process.kill('SIGKILL');
      }
    }
    
    console.log('✅ Cleanup complete');
  }
}

// Run the test
const test = new SimpleMultiSessionTest();
test.runTest().catch(console.error);
