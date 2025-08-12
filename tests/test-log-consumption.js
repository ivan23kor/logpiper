#!/usr/bin/env node

/**
 * Test to verify that MCP server removes logs after they are fetched (log consumption)
 */

import { spawn } from 'child_process';
import { setTimeout } from 'timers/promises';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DURATION = 12000; // 12 seconds

class LogConsumptionTest {
  constructor() {
    this.processes = [];
    this.dataDir = join(tmpdir(), 'logpiper');
    this.sessionIds = [];
    this.mcpServerProcess = null;
  }

  async runTest() {
    console.log('🧪 Log consumption test starting...\n');
    
    try {
      // Clear any existing data
      await this.clearExistingData();
      
      // Start MCP server
      console.log('🚀 Starting MCP server...');
      await this.startMCPServer();
      await setTimeout(2000); // Wait for server to start
      
      // Start a logpiper session
      console.log('🚀 Starting logpiper session...');
      await this.startTestSession();
      await setTimeout(2000); // Wait for logs to be generated
      
      // Check initial log count
      const initialLogs = await this.checkLogCount();
      console.log(`📊 Initial log count: ${initialLogs} entries`);
      
      if (initialLogs === 0) {
        throw new Error('No logs were generated');
      }
      
      // Simulate MCP client fetching logs (with consumption enabled)
      console.log('\n📥 Simulating MCP client fetching logs with consumption...');
      await this.simulateMCPLogFetch(true); // consumeLogs = true
      
      await setTimeout(1000); // Wait for consumption to complete
      
      // Check remaining log count
      const remainingLogs = await this.checkLogCount();
      console.log(`📊 Remaining log count after consumption: ${remainingLogs} entries`);
      
      // Test with consumption disabled
      console.log('\n📥 Generating more logs...');
      await setTimeout(2000); // Generate more logs
      
      const logsBeforeNonConsumption = await this.checkLogCount();
      console.log(`📊 Logs before non-consumption fetch: ${logsBeforeNonConsumption} entries`);
      
      console.log('📥 Simulating MCP client fetching logs WITHOUT consumption...');
      await this.simulateMCPLogFetch(false); // consumeLogs = false
      
      await setTimeout(1000);
      
      const logsAfterNonConsumption = await this.checkLogCount();
      console.log(`📊 Logs after non-consumption fetch: ${logsAfterNonConsumption} entries`);
      
      // Verify results
      const consumptionWorked = remainingLogs < initialLogs;
      const nonConsumptionWorked = logsAfterNonConsumption === logsBeforeNonConsumption;
      
      console.log('\n📊 Test Results:');
      console.log(`  🔸 Consumption reduced logs: ${consumptionWorked} (${initialLogs} → ${remainingLogs})`);
      console.log(`  🔸 Non-consumption preserved logs: ${nonConsumptionWorked} (${logsBeforeNonConsumption} → ${logsAfterNonConsumption})`);
      
      if (consumptionWorked && nonConsumptionWorked) {
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

  async clearExistingData() {
    console.log('🧹 Clearing existing test data...');
    if (!existsSync(this.dataDir)) {
      return;
    }
    
    try {
      const files = readdirSync(this.dataDir);
      for (const file of files) {
        if (file.includes('consumption_test_')) {
          const fs = require('fs');
          fs.unlinkSync(join(this.dataDir, file));
        }
      }
    } catch (error) {
      console.log('Note: Could not clear existing data:', error.message);
    }
  }

  async startMCPServer() {
    this.mcpServerProcess = spawn('node', ['dist/server.js'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.mcpServerProcess.stdout.on('data', (data) => {
      console.log('  📝 MCP Server stdout:', data.toString().trim());
    });

    this.mcpServerProcess.stderr.on('data', (data) => {
      const output = data.toString().trim();
      if (output.includes('logpiper-mcp server started')) {
        console.log('  ✅ MCP Server started successfully');
      } else {
        console.log('  📝 MCP Server stderr:', output);
      }
    });
  }

  async startTestSession() {
    // Start a session that generates logs continuously
    const childProcess = spawn('node', ['dist/cli.js', 'cmd', '/c', 
      'for /L %i in (1,1,15) do (echo Consumption test log entry %i && timeout /t 1 /nobreak > nul)'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true
    });

    this.processes.push(childProcess);
    
    childProcess.stdout.on('data', (data) => {
      const output = data.toString();
      
      // Extract session ID from output
      const sessionMatch = output.match(/🔗 Session: (session_[a-f0-9_]+)/);
      if (sessionMatch && !this.sessionIds.includes(sessionMatch[1])) {
        this.sessionIds.push(sessionMatch[1]);
        console.log(`  ✅ Captured session ID: ${sessionMatch[1]}`);
      }
    });

    childProcess.stderr.on('data', (data) => {
      const output = data.toString();
      
      // Extract session ID from stderr
      const sessionMatch = output.match(/🔗 Session: (session_[a-f0-9_]+)/);
      if (sessionMatch && !this.sessionIds.includes(sessionMatch[1])) {
        this.sessionIds.push(sessionMatch[1]);
        console.log(`  ✅ Captured session ID: ${sessionMatch[1]}`);
      }
    });
  }

  async checkLogCount() {
    if (this.sessionIds.length === 0) {
      return 0;
    }

    const sessionId = this.sessionIds[0];
    const logsFile = join(this.dataDir, `${sessionId}.logs`);
    
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

  async simulateMCPLogFetch(consumeLogs) {
    if (this.sessionIds.length === 0) {
      throw new Error('No session ID available for log fetch simulation');
    }

    const sessionId = this.sessionIds[0];
    
    // Simulate MCP tool call to get_new_logs
    console.log(`  🔸 Simulating get_new_logs call with consumeLogs=${consumeLogs}`);
    
    // Create a simple JSON-RPC request
    const request = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "get_new_logs",
        arguments: {
          sessionId: sessionId,
          since: 0,
          limit: 50,
          consumeLogs: consumeLogs
        }
      }
    };

    // Send request to MCP server
    if (this.mcpServerProcess && !this.mcpServerProcess.killed) {
      try {
        this.mcpServerProcess.stdin.write(JSON.stringify(request) + '\n');
        console.log(`  ✅ Sent MCP request for session ${sessionId}`);
      } catch (error) {
        console.log(`  ⚠️  Failed to send MCP request: ${error.message}`);
      }
    }
  }

  async cleanup() {
    console.log('\n🧹 Final cleanup...');
    
    // Terminate logpiper processes
    for (const process of this.processes) {
      if (!process.killed) {
        process.kill('SIGKILL');
      }
    }
    
    // Terminate MCP server
    if (this.mcpServerProcess && !this.mcpServerProcess.killed) {
      this.mcpServerProcess.kill('SIGKILL');
    }
    
    console.log('✅ Cleanup complete');
  }
}

// Run the test
const test = new LogConsumptionTest();
test.runTest().then(success => {
  process.exit(success ? 0 : 1);
}).catch(error => {
  console.error('Test execution failed:', error);
  process.exit(1);
});