#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { createInterface } from 'readline';

const AGENT_CONTENT = `---
name: logpiper-monitor
description: Use this agent when you need continuous monitoring of application logs for errors and issues. Examples: <example>Context: User has just implemented a new authentication feature and wants to ensure it's working properly. user: 'I just added OAuth login functionality to the app' assistant: 'Great! Let me use the logpiper-monitor agent to check for any errors or issues with the new authentication implementation.' <commentary>Since a new feature was implemented, use the logpiper-monitor to automatically check logs for any related errors or exceptions.</commentary></example> <example>Context: User is developing and wants proactive error monitoring. user: 'The app seems to be running slower today' assistant: 'I'll use the logpiper-monitor agent to continuously monitor the logs and identify any performance-related errors or exceptions that might be causing the slowdown.' <commentary>Use the logpiper-monitor for proactive monitoring when performance issues are suspected.</commentary></example>
model: sonnet
---

You are a vigilant Log Monitor Guardian, an expert in continuous application monitoring and error detection. Your primary mission is to maintain constant surveillance of application logs using logpiper MCP tools to ensure system health and catch issues before they escalate.

Your core responsibilities:

1. **Immediate Log Analysis**: After any feature implementation or deployment, immediately initiate logpiper sessions to check for errors, warnings, or anomalies

2. **Continuous Monitoring**: Run logpiper sessions in background mode for ongoing surveillance, maintaining persistent monitoring until all identified issues are resolved

3. **Systematic Error Detection**: Automatically search logs for critical keywords including 'error', 'failed', 'exception', 'warning', 'timeout', 'crash', and related error patterns

4. **Proactive Issue Identification**: Don't wait for problems to be reported - actively hunt for potential issues in log streams and alert immediately when found

5. **Comprehensive Reporting**: When errors are detected, provide detailed analysis including:
   - Exact error messages and stack traces
   - Timestamp and frequency of occurrences
   - Potential root causes and impact assessment
   - Recommended remediation steps

6. **Persistent Resolution Tracking**: Continue monitoring until all identified errors are confirmed fixed, re-checking logs after each fix attempt

Your workflow:
- Start logpiper monitoring immediately when called
- Search for error patterns systematically
- Report findings with actionable insights
- Maintain background monitoring sessions
- Escalate critical issues requiring immediate attention
- Verify fixes by continued log analysis

You are relentless in your pursuit of system stability and will not consider your job complete until logs show clean, error-free operation. Always assume that if an error can occur, it will occur, and your vigilance is the primary defense against system failures.
`;

async function promptUser(question) {
    const rl = createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.toLowerCase().trim());
        });
    });
}

async function installAgent() {
    try {
        console.log('\n🚀 logpiper installation complete!');
        console.log('\n📋 Optional: Install Log Monitoring Agent');
        console.log('This agent provides automatic log monitoring for Claude Code.');

        const shouldInstall = await promptUser('\nWould you like to install the Log Monitoring Agent? (y/N): ');

        if (shouldInstall === 'y' || shouldInstall === 'yes') {
            const defaultAgentsDir = join(homedir(), '.claude', 'agents');

            console.log(`\n📁 Default agent directory: ${defaultAgentsDir}`);

            let agentsDir = defaultAgentsDir;
            const useCustomDir = await promptUser('Use default directory? (Y/n): ');

            if (useCustomDir === 'n' || useCustomDir === 'no') {
                const customDir = await promptUser('Enter custom agent directory path: ');
                agentsDir = customDir.trim() || defaultAgentsDir;
            }

            // Check if directory exists
            if (!existsSync(agentsDir)) {
                console.log(`❌ Directory does not exist: ${agentsDir}`);
                const shouldCreate = await promptUser('Create directory? (y/N): ');

                if (shouldCreate === 'y' || shouldCreate === 'yes') {
                    mkdirSync(agentsDir, { recursive: true });
                    console.log(`✅ Created directory: ${agentsDir}`);
                } else {
                    console.log('⏭️  Agent installation cancelled.');
                    console.log(`💡 You can manually create the directory and copy the agent file later.`);
                    return;
                }
            }

            const agentPath = join(agentsDir, 'logpiper-monitor.md');

            // Write agent file
            writeFileSync(agentPath, AGENT_CONTENT, 'utf8');
            console.log(`✅ Installed Logpiper Monitor agent to: ${agentPath}`);
            console.log('\n💡 The agent is now available in Claude Code!');
            console.log('   Use it by mentioning log monitoring or error detection needs.');
        } else {
            console.log('\n⏭️  Skipped agent installation.');
            console.log('   You can manually copy logpiper-monitor.md to ~/.claude/agents/ later.');
        }

        console.log('\n📖 Next steps:');
        console.log('   1. Add logpiper to your Claude Code MCP settings');
        console.log('   2. Start monitoring: logpiper <your-command>');
        console.log('   3. Use Claude Code to analyze logs in real-time');
        console.log('\n🔗 Documentation: https://github.com/ivan23kor/logpiper-mcp#readme');

    } catch (error) {
        console.error('❌ Error during agent installation:', error.message);
        console.log('💡 You can manually install the agent later from the package files.');
    }
}

// Check if this is a global installation using multiple methods
function isGlobalInstallation() {
    // Method 1: Check npm_config_global
    if (process.env.npm_config_global === 'true') {
        return true;
    }
    
    // Method 2: Check if npm_config_prefix contains global paths
    const prefix = process.env.npm_config_prefix;
    if (prefix) {
        const globalPrefixPatterns = [
            '/usr/local',
            '/usr/global',
            'AppData\\npm',
            '.npm-global',
            'npm\\node_modules',
            'lib/node_modules'
        ];
        
        if (globalPrefixPatterns.some(pattern => prefix.includes(pattern))) {
            return true;
        }
    }
    
    // Method 3: Check process.cwd() for global install patterns
    const cwd = process.cwd();
    const globalCwdPatterns = [
        'node_modules/logpiper-mcp',
        '\\npm\\node_modules\\logpiper-mcp',
        '/lib/node_modules/logpiper-mcp',
        '/usr/local/lib/node_modules/logpiper-mcp'
    ];
    
    if (globalCwdPatterns.some(pattern => cwd.includes(pattern))) {
        return true;
    }
    
    return false;
}

// Run agent installation for global installs, show info for local installs
if (isGlobalInstallation()) {
    installAgent().catch(console.error);
} else {
    console.log('\n🚀 logpiper installed locally.');
    console.log('💡 For global installation with agent setup: npm install -g logpiper-mcp');
}