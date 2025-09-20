#!/usr/bin/env ts-node
/**
 * Practical Multi-Agent Usage Example
 *
 * Demonstrates how to:
 * 1. Set up agent contexts
 * 2. Query the group
 * 3. Collect and analyze results
 * 4. Run consensus voting
 */

import { WorkspaceInfrastructureBridge } from '../infrastructure/integration/WorkspaceInfrastructureBridge';
import { WorkspaceConfigPresets } from '../config/WorkspaceConfig';

interface AgentContext {
  id: string;
  name: string;
  model: string;
  capabilities: string[];
  context: string;
  persona: string;
}

interface DiscussionResult {
  discussionId: string;
  question: string;
  responses: AgentResponse[];
  summary: ResultSummary;
  consensusVote?: ConsensusResult;
}

interface AgentResponse {
  agentId: string;
  agentName: string;
  response: string;
  timestamp: number;
  reasoning?: string;
}

interface ResultSummary {
  totalResponses: number;
  perspectives: Array<{ agent: string; keyPoint: string }>;
  agreements: string[];
  disagreements: string[];
  nextSteps: string[];
}

interface ConsensusResult {
  proposalId: string;
  result: 'approved' | 'rejected' | 'deadlock';
  confidence: number;
  votes: Record<string, { vote: string; reasoning: string }>;
}

export class MultiAgentWorkspace {
  private workspace: WorkspaceInfrastructureBridge;
  private workspaceId: string;
  private agents: AgentContext[] = [];
  private eventLog: any[] = [];

  constructor(workspaceId: string) {
    this.workspaceId = workspaceId;

    // Use testing config with proper environment variables
    const config = WorkspaceConfigPresets.testing();
    this.workspace = new WorkspaceInfrastructureBridge(config.infrastructure);

    this.setupEventLogging();
  }

  private setupEventLogging(): void {
    this.workspace.on('workspace_operation', (operation) => {
      this.eventLog.push({
        timestamp: Date.now(),
        type: 'operation',
        data: operation
      });
    });

    this.workspace.on('redis_connected', () => {
      console.log('🔗 Real-time coordination enabled (Redis)');
    });

    this.workspace.on('kafka_connected', () => {
      console.log('🔗 Persistent messaging enabled (Kafka)');
    });
  }

  async initialize(): Promise<void> {
    console.log(`🚀 Initializing Multi-Agent Workspace: ${this.workspaceId}`);
    console.log('=' .repeat(60));

    await this.workspace.initialize();

    const health = this.workspace.getHealthStatus();
    console.log(`📊 Infrastructure Status: ${health.overall}`);
    console.log(`   Redis: ${health.redis.connected ? '✅' : '❌'} (Real-time coordination)`);
    console.log(`   Kafka: ${health.kafka.connected ? '✅' : '❌'} (Persistent messaging)`);

    if (health.overall === 'offline') {
      console.log('⚠️  Running in standalone mode (no infrastructure)');
    } else if (health.overall === 'degraded') {
      console.log('⚠️  Running in degraded mode (partial infrastructure)');
    }

    console.log('');
  }

  async addAgent(agentConfig: AgentContext): Promise<void> {
    this.agents.push(agentConfig);

    // Register with infrastructure
    await this.workspace.registerAgent(agentConfig.id, this.workspaceId, {
      name: agentConfig.name,
      model: agentConfig.model,
      capabilities: agentConfig.capabilities
    });

    // Set as active
    await this.workspace.updateAgentStatus(
      agentConfig.id,
      this.workspaceId,
      'active',
      'Ready for collaboration'
    );

    console.log(`👤 Added agent: ${agentConfig.name} (${agentConfig.id})`);
  }

  async setupDefaultAgents(): Promise<void> {
    console.log('👥 Setting up default agent team...');

    const defaultAgents: AgentContext[] = [
      {
        id: 'product-manager',
        name: 'Product Manager',
        model: 'gpt-4',
        capabilities: ['requirements', 'prioritization', 'user_research'],
        context: 'You are a Product Manager focused on user needs and business value.',
        persona: 'Business-focused, user-centric, data-driven decision maker'
      },
      {
        id: 'architect',
        name: 'System Architect',
        model: 'claude-3',
        capabilities: ['system_design', 'scalability', 'technology_selection'],
        context: 'You are a System Architect responsible for technical design and infrastructure.',
        persona: 'Technical expert, focuses on scalability and maintainability'
      },
      {
        id: 'developer',
        name: 'Senior Developer',
        model: 'gpt-4',
        capabilities: ['implementation', 'code_review', 'debugging'],
        context: 'You are a Senior Developer who implements designs and solves technical challenges.',
        persona: 'Practical implementer, focuses on code quality and feasibility'
      },
      {
        id: 'qa-engineer',
        name: 'QA Engineer',
        model: 'claude-3',
        capabilities: ['testing', 'quality_assurance', 'risk_assessment'],
        context: 'You are a QA Engineer focused on quality, testing, and risk management.',
        persona: 'Quality-focused, risk-aware, systematic thinker'
      }
    ];

    for (const agent of defaultAgents) {
      await this.addAgent(agent);
    }

    console.log(`✅ Team setup complete: ${this.agents.length} agents ready\n`);
  }

  async askGroup(question: string, context: Record<string, any> = {}): Promise<DiscussionResult> {
    const discussionId = `discussion_${Date.now()}`;

    console.log(`🤔 Group Discussion: "${question}"`);
    console.log('─'.repeat(50));

    // Create discussion workspace
    const discussionFile = `/discussions/${discussionId}.md`;

    // Initialize discussion document
    await this.workspace.publishFileEdit('system', this.workspaceId, discussionFile, {
      operation: 'create',
      content: this.createDiscussionTemplate(question, context)
    });

    // Collect responses from all agents
    const responses: AgentResponse[] = [];

    for (const agent of this.agents) {
      console.log(`💭 ${agent.name} is thinking...`);

      try {
        // Update agent status
        await this.workspace.updateAgentStatus(
          agent.id,
          this.workspaceId,
          'busy',
          `Responding to: ${question.substring(0, 30)}...`
        );

        // Get agent response (simulated for now)
        const response = await this.getAgentResponse(agent, question, context);

        responses.push({
          agentId: agent.id,
          agentName: agent.name,
          response: response,
          timestamp: Date.now()
        });

        // Add response to discussion file
        await this.workspace.publishFileEdit(agent.id, this.workspaceId, discussionFile, {
          operation: 'update',
          content: `\n\n## ${agent.name} Response\n\n${response}\n`
        });

        // Update status back to active
        await this.workspace.updateAgentStatus(agent.id, this.workspaceId, 'active', 'Response completed');

        console.log(`✅ ${agent.name}: ${response.substring(0, 80)}...`);

      } catch (error) {
        console.log(`❌ ${agent.name}: Failed to respond - ${error}`);
        await this.workspace.updateAgentStatus(agent.id, this.workspaceId, 'idle', `Error: ${error}`);
      }
    }

    // Generate summary
    const summary = this.generateSummary(responses);

    console.log('\n📊 Discussion Summary:');
    console.log(`   Responses: ${summary.totalResponses}`);
    console.log(`   Key themes: ${summary.perspectives.length}`);
    console.log(`   Agreements: ${summary.agreements.length}`);
    console.log(`   Disagreements: ${summary.disagreements.length}`);

    return {
      discussionId,
      question,
      responses,
      summary
    };
  }

  async runConsensusVote(proposalId: string, proposal: string): Promise<ConsensusResult> {
    console.log(`\n🗳️  Consensus Vote: "${proposal}"`);
    console.log('─'.repeat(50));

    const votes: Record<string, { vote: string; reasoning: string }> = {};

    // Collect votes from all agents
    for (const agent of this.agents) {
      const vote = await this.getAgentVote(agent, proposal);
      const reasoning = await this.getAgentReasoning(agent, proposal, vote);

      votes[agent.id] = { vote, reasoning };

      // Publish vote to infrastructure
      await this.workspace.publishConsensusVote(
        agent.id,
        this.workspaceId,
        proposalId,
        vote as any,
        reasoning
      );

      const emoji = vote === 'agree' ? '✅' : vote === 'disagree' ? '❌' : '⚪';
      console.log(`${emoji} ${agent.name}: ${vote} - ${reasoning}`);
    }

    // Calculate result
    const result = this.calculateConsensus(votes);

    // Log final decision
    await this.workspace.logConsensusDecision('system', this.workspaceId, {
      proposalId,
      description: proposal,
      votes: votes as any,
      finalDecision: result.result === 'deadlock' ? 'deferred' : result.result,
      consensusMethod: 'majority'
    });

    console.log(`\n🎯 Decision: ${result.result.toUpperCase()} (${(result.confidence * 100).toFixed(1)}% confidence)`);

    return result;
  }

  private createDiscussionTemplate(question: string, context: Record<string, any>): string {
    return `# Group Discussion

## Question
${question}

## Context
${Object.entries(context).map(([key, value]) => `- **${key}**: ${value}`).join('\n')}

## Participants
${this.agents.map(a => `- ${a.name} (${a.id}) - ${a.persona}`).join('\n')}

## Discussion Log
Started at: ${new Date().toISOString()}

---
`;
  }

  private async getAgentResponse(agent: AgentContext, question: string, context: Record<string, any>): Promise<string> {
    // Simulate agent thinking based on their role and persona
    // In real implementation, this would call actual LLM APIs

    const roleResponses = {
      'product-manager': this.generateProductManagerResponse(question, context),
      'architect': this.generateArchitectResponse(question, context),
      'developer': this.generateDeveloperResponse(question, context),
      'qa-engineer': this.generateQAResponse(question, context)
    };

    return (roleResponses as any)[agent.id] || `As ${agent.name}, I think: ${question}`;
  }

  private generateProductManagerResponse(question: string, _context: Record<string, any>): string {
    return `From a product perspective, I need to consider:

1. **User Impact**: How does this affect our users and their experience?
2. **Business Value**: What's the ROI and alignment with our business goals?
3. **Market Position**: How does this help us compete and grow?

Based on the context provided, I believe we should prioritize solutions that deliver maximum user value while maintaining sustainable business growth.

The key question "${question}" requires us to balance user needs with technical feasibility and business constraints.`;
  }

  private generateArchitectResponse(question: string, _context: Record<string, any>): string {
    return `From a system architecture standpoint, I'm evaluating:

1. **Technical Feasibility**: Can our current architecture support this?
2. **Scalability**: How will this impact system performance and growth?
3. **Maintainability**: What are the long-term technical implications?

Considering "${question}" and the provided context, I recommend:
- Evaluating our current infrastructure capacity
- Planning for future scalability requirements
- Ensuring security and reliability standards are met

The technical implementation should align with our architectural principles and long-term technical strategy.`;
  }

  private generateDeveloperResponse(question: string, _context: Record<string, any>): string {
    return `From an implementation perspective, I'm focusing on:

1. **Development Effort**: What's the coding complexity and time investment?
2. **Technical Challenges**: What are the potential implementation hurdles?
3. **Code Quality**: How can we maintain high standards and testability?

Regarding "${question}", my concerns include:
- Implementation timeline and resource requirements
- Integration with existing codebase
- Testing and deployment considerations

I suggest breaking this down into manageable development phases with clear technical milestones.`;
  }

  private generateQAResponse(question: string, _context: Record<string, any>): string {
    return `From a quality assurance perspective, I'm examining:

1. **Risk Assessment**: What could go wrong and how do we prevent it?
2. **Testing Strategy**: How do we validate this works correctly?
3. **Quality Standards**: Does this meet our quality benchmarks?

For "${question}", I want to ensure:
- Comprehensive testing coverage
- Clear acceptance criteria
- Risk mitigation strategies
- Performance and reliability validation

We need robust quality gates before any implementation proceeds.`;
  }

  private async getAgentVote(agent: AgentContext, _proposal: string): Promise<string> {
    // Simulate voting based on agent personality
    const roleVotingTendencies = {
      'product-manager': ['agree', 'agree', 'abstain'], // Business-focused, usually agrees to progress
      'architect': ['agree', 'disagree', 'abstain'], // Technical concerns might cause disagreement
      'developer': ['agree', 'abstain', 'disagree'], // Practical concerns about implementation
      'qa-engineer': ['disagree', 'abstain', 'agree'] // Quality concerns might cause hesitation
    };

    const tendencies = (roleVotingTendencies as any)[agent.id] || ['agree', 'disagree', 'abstain'];
    return tendencies[Math.floor(Math.random() * tendencies.length)];
  }

  private async getAgentReasoning(agent: AgentContext, _proposal: string, vote: string): Promise<string> {
    const reasoningTemplates = {
      agree: `I support this proposal because it aligns with ${agent.persona.toLowerCase()} principles.`,
      disagree: `I have concerns about this proposal from a ${agent.name.toLowerCase()} perspective.`,
      abstain: `I need more information before making a decision as ${agent.name}.`
    };

    return (reasoningTemplates as any)[vote] || `My ${vote} vote reflects ${agent.persona.toLowerCase()} considerations.`;
  }

  private generateSummary(responses: AgentResponse[]): ResultSummary {
    return {
      totalResponses: responses.length,
      perspectives: responses.map(r => ({
        agent: r.agentName,
        keyPoint: r.response.split('\n')[0] || r.response.substring(0, 100)
      })),
      agreements: ['Need to consider user impact', 'Technical feasibility is important'],
      disagreements: ['Timeline estimates vary', 'Risk tolerance differs'],
      nextSteps: [
        'Review all perspectives',
        'Identify common themes',
        'Address key concerns',
        'Develop action plan'
      ]
    };
  }

  private calculateConsensus(votes: Record<string, { vote: string; reasoning: string }>): ConsensusResult {
    const voteCount = Object.values(votes).reduce((acc, { vote }) => {
      acc[vote] = (acc[vote] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const total = Object.keys(votes).length;
    const agree = voteCount.agree || 0;
    const disagree = voteCount.disagree || 0;

    let result: 'approved' | 'rejected' | 'deadlock';
    let confidence: number;

    if (agree > total / 2) {
      result = 'approved';
      confidence = agree / total;
    } else if (disagree > total / 2) {
      result = 'rejected';
      confidence = disagree / total;
    } else {
      result = 'deadlock';
      confidence = 0.5;
    }

    return {
      proposalId: `consensus_${Date.now()}`,
      result,
      confidence,
      votes
    };
  }

  async getWorkspaceStatus(): Promise<any> {
    const health = this.workspace.getHealthStatus();

    return {
      workspaceId: this.workspaceId,
      infrastructure: health,
      agents: this.agents.map(a => ({
        id: a.id,
        name: a.name,
        capabilities: a.capabilities
      })),
      eventsLogged: this.eventLog.length,
      lastActivity: this.eventLog.length > 0 ? this.eventLog[this.eventLog.length - 1].timestamp : null
    };
  }

  async shutdown(): Promise<void> {
    console.log('\n🧹 Shutting down workspace...');
    await this.workspace.shutdown();
    console.log('✅ Workspace shutdown complete');
  }
}

// Example usage function
export async function runExample(): Promise<void> {
  const workspace = new MultiAgentWorkspace('product-planning-session');

  try {
    // 1. Initialize workspace
    await workspace.initialize();

    // 2. Set up agent team
    await workspace.setupDefaultAgents();

    // 3. Run group discussion
    const discussion = await workspace.askGroup(
      "Should we build a mobile app or improve our web platform?",
      {
        budget: "$150,000",
        timeline: "6 months",
        currentUsers: "web: 80%, mobile browser: 20%",
        userRequests: "mobile app: 60%, web improvements: 40%"
      }
    );

    // 4. Run consensus vote
    discussion.consensusVote = await workspace.runConsensusVote(
      'mobile-vs-web-decision',
      'Prioritize mobile app development over web platform improvements'
    );

    // 5. Show final results
    console.log('\n📋 Final Results:');
    console.log('==================');
    console.log(`Discussion: ${discussion.question}`);
    console.log(`Consensus: ${discussion.consensusVote.result} (${(discussion.consensusVote.confidence * 100).toFixed(1)}% confidence)`);
    console.log(`Events logged: ${(await workspace.getWorkspaceStatus()).eventsLogged}`);

    // Example completed
    console.log('Example results saved to workspace snapshot');

  } finally {
    await workspace.shutdown();
  }
}

// Run the example if this file is executed directly
if (require.main === module) {
  console.log('🚀 Starting Multi-Agent Workspace Example...\n');

  runExample()
    .then(() => {
      console.log('\n🎉 Example completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Example failed:', error);
      process.exit(1);
    });
}