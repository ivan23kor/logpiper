# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.2] - 2025-08-11

### Changed
- Improved log chunking logic in `src/cli.ts`:
- Added timestamps to log lines.
- Added service prefix extraction from log lines.
- Chunking now considers time, line count, and byte size thresholds.

## [1.0.1] - 2025-08-11

### Added
- **CLI Help Support**: Added `-h`/`--help` flags with comprehensive usage documentation
- **Version Support**: Added `--version`/`-V` flags to display package version
- **Manual Agent Installation**: Added `--install-agent` flag for installing monitoring agent after global installations
- **Enhanced Argument Parsing**: Improved CLI to ignore `--` flags and properly parse commands
- **ES Module Compatibility**: Fixed `__dirname` usage for ES modules compatibility

### Changed
- **Global Installation**: Removed unreliable `postinstall` script dependency for better global install support
- **Documentation**: Updated README with complete MCP tools documentation and usage examples
- **License**: Added MIT LICENSE.md file

### Fixed
- **Global Installation Issues**: Fixed postinstall scripts not running during `npm install -g`
- **CLI Argument Parsing**: Fixed issue where CLI flags would interfere with command parsing
- **ES Module Imports**: Fixed module import issues in compiled JavaScript

### Technical Details
- Refactored CLI constructor to avoid premature session creation
- Added proper TypeScript declarations for session management
- Enhanced error handling for agent installation
- Improved help text with practical usage examples

## [1.0.0] - 2025-08-11

### Added
- Initial release of LogPiper MCP server and CLI
- **MCP Tools**: Complete set of log monitoring tools for Claude Code integration
  - `get_new_logs`: Stream new logs since cursor position
  - `list_sessions`: List all logging sessions with metadata
  - `get_session_info`: Get detailed session information
  - `search_logs`: Search through logs with query strings
  - `acknowledge_error`: Mark errors as acknowledged
  - `get_error_history`: Get recent errors for sessions
  - `get_logs_paginated`: Cursor-based pagination for large log files
  - `get_recent_logs`: Quick access to latest logs
  - Session reset and cleanup tools
- **CLI Tool**: Command-line interface for log capture and streaming
- **Error Detection**: AI-powered pattern matching with command-specific analyzers
- **Session Management**: File-based persistence with multi-process access
- **Chunking System**: Intelligent log grouping to reduce noise
- **Notification System**: Proactive error alerts and notifications
- **Agent Integration**: LogPiper Monitor agent for Claude Code

### Features
- Real-time log streaming from terminal commands
- Intelligent error detection with cooldown mechanisms
- Cross-platform support (Windows, macOS, Linux)
- Docker and container log monitoring support
- Continuous monitoring for long-running processes
- MCP server integration with Claude Code

[1.0.2]: https://github.com/ivan23kor/logpiper-mcp/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/ivan23kor/logpiper-mcp/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/ivan23kor/logpiper-mcp/releases/tag/v1.0.0