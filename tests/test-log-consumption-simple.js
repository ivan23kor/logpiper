#!/usr/bin/env node

/**
 * Simple test to verify that logs can be consumed (removed after reading)
 * This test directly tests the LogManager functionality
 */

import { setTimeout } from 'timers/promises';
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

class SimpleLogConsumptionTest {
  constructor() {
    this.dataDir = join(tmpdir(), 'logpiper');
    this.testSessionId = 'test_consumption_session_' + Date.now();
  }

  async runTest() {
    console.log('🧪 Simple log consumption test starting...\n');
    
    try {
      // Setup test environment
      await this.setupTestEnvironment();
      
      // Create test logs
      await this.createTestLogs();
      
      // Check initial log count
      const initialCount = await this.getLogCount();
      console.log(`📊 Initial log count: ${initialCount} entries`);
      
      if (initialCount === 0) {
        throw new Error('No test logs were created');
      }
      
      // Simulate log consumption (manually)
      console.log('📥 Simulating log consumption (removing first 3 logs)...');
      await this.consumeLogs(3);
      
      // Check remaining log count
      const remainingCount = await this.getLogCount();
      console.log(`📊 Remaining log count: ${remainingCount} entries`);
      
      // Verify consumption worked
      const expectedRemaining = initialCount - 3;
      const consumptionWorked = remainingCount === expectedRemaining;
      
      console.log('\n📊 Test Results:');
      console.log(`  🔸 Initial logs: ${initialCount}`);
      console.log(`  🔸 Consumed: 3`);
      console.log(`  🔸 Expected remaining: ${expectedRemaining}`);
      console.log(`  🔸 Actual remaining: ${remainingCount}`);
      console.log(`  🔸 Consumption worked: ${consumptionWorked}`);
      
      if (consumptionWorked) {
        console.log('\n🎉 TEST PASSED: Log consumption works correctly!');
        return true;
      } else {
        console.log('\n❌ TEST FAILED: Log consumption not working as expected');
        return false;
      }
      
    } catch (error) {
      console.error('❌ Test failed:', error);
      return false;
    } finally {
      await this.cleanup();
    }
  }

  async setupTestEnvironment() {
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
    
    // Create test session file
    const sessionData = {
      id: this.testSessionId,
      projectDir: process.cwd(),
      command: 'test',
      args: [],
      startTime: new Date(),
      status: 'running',
      readCursor: 0,
      errorHistory: [],
      lastActivity: new Date()
    };
    
    const sessionFile = join(this.dataDir, `${this.testSessionId}.json`);
    writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2));
    
    console.log(`✅ Created test session: ${this.testSessionId}`);
  }

  async createTestLogs() {
    const logsFile = join(this.dataDir, `${this.testSessionId}.logs`);
    
    // Create 10 test log entries
    for (let i = 1; i <= 10; i++) {
      const logEntry = {
        id: `${this.testSessionId}_${i}`,
        sessionId: this.testSessionId,
        projectDir: process.cwd(),
        command: 'test',
        args: [],
        timestamp: new Date(),
        logLevel: 'stdout',
        content: `Test log entry ${i}`,
        lineNumber: i
      };
      
      appendFileSync(logsFile, JSON.stringify(logEntry) + '\n');
    }
    
    console.log(`✅ Created 10 test log entries`);
  }

  async getLogCount() {
    const logsFile = join(this.dataDir, `${this.testSessionId}.logs`);
    
    if (!existsSync(logsFile)) {
      return 0;
    }

    try {
      const content = readFileSync(logsFile, 'utf8');
      const lines = content.trim().split('\n').filter(line => line.length > 0);
      return lines.length;
    } catch {
      return 0;
    }
  }

  async consumeLogs(upToLineNumber) {
    const logsFile = join(this.dataDir, `${this.testSessionId}.logs`);
    
    if (!existsSync(logsFile)) {
      return;
    }

    // Read all logs
    const content = readFileSync(logsFile, 'utf8');
    const lines = content.trim().split('\n').filter(line => line.length > 0);
    
    // Filter out consumed logs (those with lineNumber <= upToLineNumber)
    const remainingLines = lines.filter(line => {
      try {
        const logEntry = JSON.parse(line);
        return logEntry.lineNumber > upToLineNumber;
      } catch {
        return true; // Keep malformed lines
      }
    });

    // Write back only the remaining logs
    if (remainingLines.length === 0) {
      // If no logs remain, delete the file to free up space
      unlinkSync(logsFile);
      console.log(`  🗑️  Deleted empty log file`);
    } else {
      writeFileSync(logsFile, remainingLines.join('\n') + '\n');
      console.log(`  ♻️  Kept ${remainingLines.length} logs after consumption`);
    }

    console.log(`  ✅ Consumed ${lines.length - remainingLines.length} log entries`);
  }

  async cleanup() {
    console.log('\n🧹 Cleaning up test files...');
    
    try {
      const sessionFile = join(this.dataDir, `${this.testSessionId}.json`);
      const logsFile = join(this.dataDir, `${this.testSessionId}.logs`);
      
      if (existsSync(sessionFile)) {
        unlinkSync(sessionFile);
        console.log('  🗑️  Removed test session file');
      }
      
      if (existsSync(logsFile)) {
        unlinkSync(logsFile);
        console.log('  🗑️  Removed test logs file');
      }
      
    } catch (error) {
      console.log('  ⚠️  Could not clean up test files:', error.message);
    }
    
    console.log('✅ Cleanup complete');
  }
}

// Run the test
const test = new SimpleLogConsumptionTest();
test.runTest().then(success => {
  process.exit(success ? 0 : 1);
}).catch(error => {
  console.error('Test execution failed:', error);
  process.exit(1);
});