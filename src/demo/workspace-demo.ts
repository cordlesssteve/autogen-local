#!/usr/bin/env ts-node
/**
 * Multi-LLM Collaborative Workspace Demo
 *
 * Demonstrates the workspace infrastructure without requiring actual LLMs.
 * Shows file locking, agent coordination, and consensus mechanisms.
 */

import { WorkspaceInfrastructureBridge } from '../infrastructure/integration/WorkspaceInfrastructureBridge';
import { WorkspaceConfigPresets } from '../config/WorkspaceConfig';

class WorkspaceDemo {
  private infrastructureBridge: WorkspaceInfrastructureBridge;
  private workspaceId: string = 'demo-workspace';
  private agents: string[] = ['ProductManager', 'Architect', 'Developer', 'QAEngineer'];

  constructor() {
    console.log('🚀 AutoGen Multi-LLM Workspace Demo');
    console.log('=====================================\n');

    // Use local development configuration
    const config = WorkspaceConfigPresets.localDevelopment();
    this.infrastructureBridge = new WorkspaceInfrastructureBridge(config.infrastructure);

    this.setupEventHandlers();
  }

  async run(): Promise<void> {
    try {
      console.log('🔧 Initializing workspace infrastructure...');
      await this.infrastructureBridge.initialize();

      console.log('📊 Infrastructure Health Status:');
      const healthStatus = this.infrastructureBridge.getHealthStatus();
      console.log(`   Overall: ${healthStatus.overall}`);
      console.log(`   Redis: ${healthStatus.redis.connected ? '✅ Connected' : '❌ Offline'}`);
      console.log(`   Kafka: ${healthStatus.kafka.connected ? '✅ Connected' : '❌ Offline'}`);

      if (healthStatus.overall === 'offline') {
        console.log('   🔄 Running in fallback mode (memory-based coordination)\n');
      } else {
        console.log('   🎉 Full infrastructure available!\n');
      }

      // Run demo scenarios
      await this.demoAgentRegistration();
      await this.demoFileLocking();
      await this.demoCollaborativeEditing();
      await this.demoConsensusVoting();
      await this.demoWorkspaceSnapshot();

      console.log('✅ Demo completed successfully!');

    } catch (error) {
      console.error('❌ Demo failed:', error);
    } finally {
      await this.infrastructureBridge.shutdown();
      console.log('🔚 Infrastructure shut down');
    }
  }

  private async demoAgentRegistration(): Promise<void> {
    console.log('👥 Agent Registration Demo');
    console.log('---------------------------');

    for (const agentId of this.agents) {
      await this.infrastructureBridge.registerAgent(agentId, this.workspaceId, {
        name: agentId,
        model: agentId === 'ProductManager' ? 'gpt-4' : 'claude-3',
        capabilities: this.getAgentCapabilities(agentId)
      });

      await this.infrastructureBridge.updateAgentStatus(agentId, this.workspaceId, 'active');
      console.log(`   ✅ Registered ${agentId}`);
    }
    console.log('');
  }

  private async demoFileLocking(): Promise<void> {
    console.log('🔒 File Locking Demo');
    console.log('--------------------');

    const testFile = '/project/requirements.md';

    // ProductManager requests write lock
    console.log(`   📝 ${this.agents[0]} requesting write lock on ${testFile}...`);
    const lock1 = await this.infrastructureBridge.requestFileLock(
      this.agents[0],
      this.workspaceId,
      testFile,
      'write'
    );

    if (lock1) {
      console.log(`   ✅ Lock acquired: ${lock1}`);

      // Another agent tries to get lock (should fail)
      console.log(`   📝 ${this.agents[1]} requesting write lock on same file...`);
      const lock2 = await this.infrastructureBridge.requestFileLock(
        this.agents[1],
        this.workspaceId,
        testFile,
        'write'
      );

      if (lock2) {
        console.log(`   ⚠️  Unexpected: Second lock acquired (fallback mode?)`);
      } else {
        console.log(`   ✅ Lock request blocked (correct behavior)`);
      }

      // Release the first lock
      console.log(`   🔓 ${this.agents[0]} releasing lock...`);
      const released = await this.infrastructureBridge.releaseFileLock(lock1, this.agents[0]);
      console.log(`   ${released ? '✅' : '❌'} Lock released`);
    } else {
      console.log(`   ❌ Lock acquisition failed (infrastructure offline)`);
    }
    console.log('');
  }

  private async demoCollaborativeEditing(): Promise<void> {
    console.log('📝 Collaborative Editing Demo');
    console.log('------------------------------');

    const files = [
      { path: '/project/architecture.md', agent: 'Architect' },
      { path: '/project/implementation.py', agent: 'Developer' },
      { path: '/project/test-plan.md', agent: 'QAEngineer' }
    ];

    for (const { path, agent } of files) {
      console.log(`   📄 ${agent} editing ${path}...`);

      await this.infrastructureBridge.publishFileEdit(agent, this.workspaceId, path, {
        operation: 'update',
        content: `# ${path}\n\nContent created by ${agent}\n\nTimestamp: ${new Date().toISOString()}`,
        previousContent: '',
        startLine: 1,
        endLine: 1
      });

      console.log(`   ✅ Edit published`);
    }
    console.log('');
  }

  private async demoConsensusVoting(): Promise<void> {
    console.log('🗳️  Consensus Voting Demo');
    console.log('-------------------------');

    const proposalId = 'proposal-microservices-migration';
    const proposal = 'Should we migrate to microservices architecture?';

    console.log(`   📋 Proposal: ${proposal}`);
    console.log(`   🗳️  Collecting votes...`);

    // Each agent votes
    const votes = [
      { agent: 'ProductManager', vote: 'agree', reasoning: 'Better scalability for business growth' },
      { agent: 'Architect', vote: 'agree', reasoning: 'Improved system modularity and deployment flexibility' },
      { agent: 'Developer', vote: 'disagree', reasoning: 'Increased complexity and development overhead' },
      { agent: 'QAEngineer', vote: 'abstain', reasoning: 'Need more information about testing strategy' }
    ];

    for (const { agent, vote, reasoning } of votes) {
      await this.infrastructureBridge.publishConsensusVote(
        agent,
        this.workspaceId,
        proposalId,
        vote as 'agree' | 'disagree' | 'abstain',
        reasoning
      );
      console.log(`   ${this.getVoteEmoji(vote)} ${agent}: ${vote} - ${reasoning}`);
    }

    // Calculate result (simple majority)
    const agreeCount = votes.filter(v => v.vote === 'agree').length;
    const disagreeCount = votes.filter(v => v.vote === 'disagree').length;
    const finalDecision = agreeCount > disagreeCount ? 'approved' : 'rejected';

    console.log(`   📊 Result: ${finalDecision} (${agreeCount} agree, ${disagreeCount} disagree)`);

    // Log the decision
    await this.infrastructureBridge.logConsensusDecision('ProductManager', this.workspaceId, {
      proposalId,
      description: proposal,
      votes: votes.reduce((acc, v) => {
        acc[v.agent] = { vote: v.vote as any, reasoning: v.reasoning };
        return acc;
      }, {} as Record<string, any>),
      finalDecision: finalDecision as 'approved' | 'rejected',
      consensusMethod: 'majority'
    });

    console.log(`   ✅ Decision logged to audit trail`);
    console.log('');
  }

  private async demoWorkspaceSnapshot(): Promise<void> {
    console.log('📸 Workspace Snapshot Demo');
    console.log('---------------------------');

    const snapshot = {
      files: {
        '/project/requirements.md': '# Requirements\n\nUser authentication system needed...',
        '/project/architecture.md': '# Architecture\n\nMicroservices approach with API Gateway...',
        '/project/implementation.py': '# Implementation\n\ndef authenticate_user(username, password):\n    pass',
        '/project/test-plan.md': '# Test Plan\n\n## Unit Tests\n- Authentication logic\n\n## Integration Tests\n- API endpoints'
      },
      metadata: {
        version: '1.0.0',
        timestamp: Date.now(),
        participants: this.agents,
        sessionDuration: 45 * 60 * 1000 // 45 minutes
      },
      activeAgents: this.agents,
      consensus: {
        'demo-proposal-1': 'approved'
      }
    };

    console.log(`   📁 Saving snapshot with ${Object.keys(snapshot.files).length} files...`);

    await this.infrastructureBridge.saveWorkspaceSnapshot(
      'ProductManager',
      this.workspaceId,
      snapshot
    );

    console.log(`   ✅ Snapshot saved to persistent storage`);
    console.log(`   📊 Snapshot contains:`);
    Object.keys(snapshot.files).forEach(file => {
      console.log(`      📄 ${file}`);
    });
    console.log('');
  }

  private setupEventHandlers(): void {
    this.infrastructureBridge.on('workspace_operation', (operation) => {
      if (process.env.VERBOSE) {
        console.log(`🔔 Operation: ${operation.type} by ${operation.agentId}`);
      }
    });

    this.infrastructureBridge.on('redis_connected', () => {
      console.log('🔗 Redis connected');
    });

    this.infrastructureBridge.on('kafka_connected', () => {
      console.log('🔗 Kafka connected');
    });

    this.infrastructureBridge.on('redis_error', (error) => {
      if (process.env.VERBOSE) {
        console.log(`⚠️  Redis error: ${error.message}`);
      }
    });

    this.infrastructureBridge.on('kafka_error', (error) => {
      if (process.env.VERBOSE) {
        console.log(`⚠️  Kafka error: ${error.message}`);
      }
    });
  }

  private getAgentCapabilities(agentId: string): string[] {
    const capabilities = {
      ProductManager: ['requirements', 'prioritization', 'stakeholder_management'],
      Architect: ['system_design', 'technology_selection', 'scalability'],
      Developer: ['implementation', 'code_review', 'debugging'],
      QAEngineer: ['testing', 'quality_assurance', 'automation']
    };

    return capabilities[agentId as keyof typeof capabilities] || ['general'];
  }

  private getVoteEmoji(vote: string): string {
    const emojis = {
      agree: '✅',
      disagree: '❌',
      abstain: '⚪'
    };
    return emojis[vote as keyof typeof emojis] || '❓';
  }
}

// Run the demo
async function main() {
  const demo = new WorkspaceDemo();
  await demo.run();
}

if (require.main === module) {
  main().catch(console.error);
}

export { WorkspaceDemo };