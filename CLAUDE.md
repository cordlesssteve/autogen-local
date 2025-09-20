# CLAUDE.md

## Universal Standards (Imports)
@../../../.claude/config/intellectual-honesty.md
@../../../.claude/config/verification-protocols.md
@../../../.claude/config/file-organization.md

## Project Structure Reference

**Directory Tree:** Use `.directory_tree.txt` in project root for complete structure
**NEVER regenerate directory tree** - read existing file to save context tokens

## 🚨 MANDATORY READING ORDER 🚨
Before starting ANY development work, Claude MUST read these files in order:

1. **[CURRENT_STATUS.md](./CURRENT_STATUS.md)** - Current reality and what's actually done
2. **[ACTIVE_PLAN.md](./ACTIVE_PLAN.md)** - What we're currently executing
3. Only then reference other documentation for context

## Project Context
- **Platform:** Multi-LLM collaborative workspace framework built on AutoGen with Redis/Kafka orchestration
- **Current Version:** 0.1.0 (Active Development)
- **Active Branch:** main
- **Focus:** Infrastructure integration and agent collaboration system

## [Fallback] Core Standards
*If imports above fail, these provide essential behavioral guidelines:*

### Plan Status Indicators - ALWAYS CHECK THESE
- **ACTIVE**: Currently executing - use this plan
- **ARCHIVED**: Completed/historical - reference only
- **SUPERSEDED**: Replaced by newer plan - ignore unless needed for context
- **BLOCKED**: Waiting for external input - cannot proceed

### Critical Success Verification
- **NEVER claim completion** without compilation verification
- **ALWAYS test instantiation** of core components
- **VERIFY integration** between components actually works

### Red Flags 🚨
**STOP and ask for clarification if you see:**
- Multiple plans marked as "ACTIVE"
- Conflicting information between CURRENT_STATUS.md and ACTIVE_PLAN.md
- Plans that haven't been updated in >1 week
- Missing status headers on planning documents

## Project-Specific Guidelines

### Technology Stack
- **Runtime:** Node.js 18+, TypeScript 5.3+
- **Framework:** Custom AutoGen fork with multi-agent system
- **Infrastructure:** Redis (state), Kafka (messaging), Docker Compose
- **Testing:** Jest with ts-jest, 70% coverage threshold
- **Quality:** ESLint with TypeScript rules, strict typing

### Development Workflow
- **Testing Strategy:** Unit tests with Jest, integration tests for Redis/Kafka
- **Build Process:** TypeScript compilation with watch mode support
- **Environment Management:** Docker Compose for local infrastructure
- **Code Quality:** ESLint + TypeScript strict mode, 70% test coverage required

### Essential Commands
```bash
# Development
npm run dev              # Start development server with ts-node
npm run build            # Compile TypeScript to dist/
npm run test             # Run Jest test suite
npm run typecheck        # TypeScript compilation check
npm run lint             # ESLint checks
npm run lint:fix         # Auto-fix ESLint issues

# Infrastructure
npm run infrastructure:setup    # Start Redis/Kafka with Docker
npm run infrastructure:down     # Stop infrastructure containers
npm run workspace:demo          # Run workspace demonstration

# Testing
npm run test:watch       # Jest watch mode
npm run test:integration # Integration tests only
```

### Project Architecture
- **Entry Point:** src/index.ts - Main workspace coordination
- **Key Directories:**
  - `src/` - TypeScript source code
  - `tests/` - Jest test files
  - `dist/` - Compiled JavaScript output
- **Configuration:** package.json contains Jest/ESLint config
- **Integration Points:** Redis (state), Kafka (messaging), AutoGen agents

## Environment Configuration
- **Infrastructure:** Redis on port 6380, Kafka on port 9093 (via Docker Compose)
- **Required Variables:** REDIS_HOST, REDIS_PORT, KAFKA_BROKERS for integration tests
- **Local Setup:** Run `npm install` then `npm run infrastructure:setup`
- **Dependencies:** Docker/Docker Compose for Redis/Kafka, Node.js 18+

## Quality Standards
- **ALWAYS implement** Level 3+ testing maturity from universal standards
- **NEVER skip** verification protocols before claiming completion
- **Code Review:** TypeScript strict mode, ESLint compliance required
- **Testing Coverage:** 70% minimum coverage (branches, functions, lines, statements)
- **Integration Testing:** Redis/Kafka connectivity must be verified
- **Infrastructure Dependency:** Never claim system works without infrastructure tests

## Troubleshooting
### Common Issues
- **Redis/Kafka Connection:** Ensure `npm run infrastructure:setup` completed successfully
- **Test Timeouts:** Integration tests may need longer timeouts (15-30s) for infrastructure
- **TypeScript Errors:** Run `npm run typecheck` to isolate compilation issues
- **Port Conflicts:** Redis (6380) and Kafka (9093) must be available

### Emergency Procedures
- **Build Failures:** Run `npm run clean && npm run build` to clear dist/
- **Infrastructure Issues:** `npm run infrastructure:down && npm run infrastructure:setup`
- **Test Suite Failures:** Check Redis/Kafka containers are running before integration tests

---

**Template Instructions:**
1. Replace all [REPLACE: ...] sections with project-specific content ✅
2. Remove unused sections that don't apply to your project ✅
3. Add project-specific sections as needed (Docker, multi-instance coordination) ✅
4. Keep the core structure and mandatory reading order ✅
5. Maintain focus on Claude AI instructions, not human documentation ✅