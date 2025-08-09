#!/usr/bin/env node

/**
 * Test script to demonstrate multi-session LogPiper functionality
 * This script simulates multiple terminal sessions with different commands
 */

const { spawn } = require('child_process');
const path = require('path');

console.log('🧪 Testing LogPiper Multi-Session Functionality\n');

// Simulate different project directories
const testProjects = [
  {
    name: 'Frontend Project',
    dir: path.join(__dirname, 'test-frontend'),
    command: 'npm',
    args: ['run', 'dev']
  },
  {
    name: 'Backend Project',
    dir: path.join(__dirname, 'test-backend'),
    command: 'docker-compose',
    args: ['logs', 'api', '-f']
  }
];

// Create test directories and mock log generators
testProjects.forEach(project => {
  const fs = require('fs');
  if (!fs.existsSync(project.dir)) {
    fs.mkdirSync(project.dir, { recursive: true });
  }

  if (project.command === 'npm') {
    const packageJson = {
      name: 'test-frontend',
      scripts: {
        dev: 'node mock-dev-server.js'
      }
    };
    fs.writeFileSync(
      path.join(project.dir, 'package.json'),
      JSON.stringify(packageJson, null, 2)
    );

    // Mock dev server that generates logs and errors
    const mockServer = `
const readline = require('readline');

console.log('🚀 Starting development server...');
console.log('📁 Project: test-frontend');
console.log('🌐 Local: http://localhost:3000');

let logCount = 0;

const generateLogs = () => {
  logCount++;
  
  if (logCount % 10 === 0) {
    console.log('✅ Hot reload complete - 2.1s');
  } else if (logCount % 15 === 0) {
    console.error('❌ TypeScript Error: Property \\'user\\' does not exist on type \\'Props\\'');
    console.error('    at src/components/UserProfile.tsx:15:7');
  } else if (logCount % 7 === 0) {
    console.log('📦 Compiled successfully in 890ms');
  } else {
    console.log(\`[Dev] Processing request \${Math.floor(Math.random() * 1000)}\`);
  }
};

setInterval(generateLogs, 2000);

console.log('\\n🔄 Press Ctrl+C to stop...');
    `;

    fs.writeFileSync(path.join(project.dir, 'mock-dev-server.js'), mockServer);
  }

  if (project.command === 'python') {
    const pythonScript = `
import time
import random
import sys

print("🐍 Starting Python application...")
print("📁 Project: test-python")

count = 0
while True:
    count += 1
    
    if count % 8 == 0:
        print("❌ ImportError: No module named 'requests'", file=sys.stderr)
    elif count % 12 == 0:
        print("✅ Database connection successful")  
    elif count % 5 == 0:
        print(f"📊 Processing data batch {random.randint(1, 100)}")
    else:
        print(f"[INFO] Application running - iteration {count}")
    
    time.sleep(3)
    `;

    fs.writeFileSync(path.join(project.dir, 'app.py'), pythonScript);
  }
});

console.log('📁 Created test project directories:');
testProjects.forEach(project => {
  console.log(`   - ${project.name}: ${project.dir}`);
});

console.log('\\n🔧 To test multi-session functionality:');
console.log('\\n1. Start LogPiper MCP server:');
console.log('   node dist/server.js');
console.log('\\n2. In separate terminals, run:');

testProjects.forEach((project, index) => {
  console.log(`   Terminal ${index + 1}: cd ${project.dir} && logpiper ${project.command} ${project.args.join(' ')}`);
});

console.log('\\n3. Use Claude Code MCP tools:');
console.log('   - get_new_logs() - View streaming logs');
console.log('   - list_sessions() - See all active sessions');
console.log('   - search_logs("error") - Find errors across sessions');
console.log('');
console.log('✨ Each session will generate unique logs and errors for testing!');