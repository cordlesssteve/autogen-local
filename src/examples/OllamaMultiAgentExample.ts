#!/usr/bin/env ts-node
/**
 * Real Multi-Agent Example with Ollama Integration
 *
 * Uses actual local Ollama models:
 * - mistral:7b-instruct (Business Strategist)
 * - phi3.5:latest (Technical Architect)
 * - qwen2.5-coder:3b (Implementation Engineer)
 */

import { WorkspaceInfrastructureBridge } from '../infrastructure/integration/WorkspaceInfrastructureBridge';
import { WorkspaceConfigPresets } from '../config/WorkspaceConfig';

interface OllamaAgentContext {
  id: string;
  name: string;
  model: string;
  capabilities: string[];
  context: string;
  persona: string;
  ollamaBaseUrl: string;
}

interface OllamaResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
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
  responseTime: number;
  model: string;
}

interface ResultSummary {
  totalResponses: number;
  perspectives: Array<{ agent: string; keyPoint: string }>;
  averageResponseTime: number;
  totalDiscussionTime: number;
  modelPerformance: Array<{ model: string; avgTime: number; responses: number }>;
}

interface ConsensusResult {
  proposalId: string;
  result: 'approved' | 'rejected' | 'deadlock';
  confidence: number;
  votes: Record<string, { vote: string; reasoning: string }>;
}

export class OllamaMultiAgentWorkspace {
  private workspace: WorkspaceInfrastructureBridge;
  private workspaceId: string;
  private agents: OllamaAgentContext[] = [];
  private eventLog: any[] = [];
  private discussionStartTime: number = 0;

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
    console.log(`🚀 Initializing Ollama Multi-Agent Workspace: ${this.workspaceId}`);
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

  async setupOllamaAgents(): Promise<void> {
    console.log('🤖 Setting up Ollama agent team with real local models...');

    const ollamaAgents: OllamaAgentContext[] = [
      {
        id: 'business-strategist',
        name: 'Business Strategist',
        model: 'mistral:7b-instruct',
        capabilities: ['business_analysis', 'market_research', 'roi_analysis'],
        context: `You are a Business Strategist focused on market analysis, ROI, and user value.
                 Analyze from a business perspective with focus on revenue, growth, and market positioning.
                 Keep responses concise and business-focused.`,
        persona: 'Market-focused, ROI-driven, strategic thinker',
        ollamaBaseUrl: 'http://localhost:11434'
      },
      {
        id: 'tech-architect',
        name: 'Technical Architect',
        model: 'phi3.5:latest',
        capabilities: ['system_design', 'scalability', 'architecture'],
        context: `You are a Technical Architect responsible for system design, scalability, and architecture.
                 Focus on technical feasibility, system performance, and architectural decisions.
                 Provide practical technical insights.`,
        persona: 'Architecture-focused, scalability-minded, technical expert',
        ollamaBaseUrl: 'http://localhost:11434'
      },
      {
        id: 'code-engineer',
        name: 'Implementation Engineer',
        model: 'qwen2.5-coder:3b',
        capabilities: ['implementation', 'code_quality', 'development'],
        context: `You are an Implementation Engineer focused on development effort, code quality, and implementation details.
                 Analyze from a coding and development perspective with focus on feasibility and effort.
                 Consider practical implementation challenges.`,
        persona: 'Code-focused, pragmatic, implementation-oriented',
        ollamaBaseUrl: 'http://localhost:11434'
      }
    ];

    // Test Ollama connectivity first
    console.log('🔍 Testing Ollama connectivity...');
    for (const agent of ollamaAgents) {
      const isConnected = await this.testOllamaConnection(agent);
      if (!isConnected) {
        throw new Error(`Failed to connect to Ollama model: ${agent.model}`);
      }
    }

    // Register agents with infrastructure
    for (const agent of ollamaAgents) {
      this.agents.push(agent);

      await this.workspace.registerAgent(agent.id, this.workspaceId, {
        name: agent.name,
        model: agent.model,
        capabilities: agent.capabilities
      });

      await this.workspace.updateAgentStatus(
        agent.id,
        this.workspaceId,
        'active',
        'Ready for collaboration with Ollama'
      );

      console.log(`   ✅ ${agent.name} (${agent.model})`);
    }

    console.log(`✅ Ollama team ready: ${this.agents.length} agents with real AI models\n`);
  }

  private async testOllamaConnection(agent: OllamaAgentContext): Promise<boolean> {
    try {
      const response = await fetch(`${agent.ollamaBaseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: agent.model,
          prompt: 'Test connection. Respond with only: Connected',
          stream: false
        })
      });

      if (!response.ok) {
        console.log(`   ❌ ${agent.model}: HTTP ${response.status}`);
        return false;
      }

      const data = await response.json() as OllamaResponse;
      console.log(`   ✅ ${agent.model}: ${data.response.trim()}`);
      return true;

    } catch (error) {
      console.log(`   ❌ ${agent.model}: ${error}`);
      return false;
    }
  }

  async askGroup(question: string, context: Record<string, any> = {}): Promise<DiscussionResult> {
    const discussionId = `ollama_discussion_${Date.now()}`;
    this.discussionStartTime = Date.now();

    console.log(`🤔 Real AI Group Discussion: "${question}"`);
    console.log('─'.repeat(50));
    console.log(`🤖 Models: ${this.agents.map(a => a.model).join(', ')}`);
    console.log('');

    // Create discussion workspace
    const discussionFile = `/discussions/${discussionId}.md`;

    // Initialize discussion document
    await this.workspace.publishFileEdit('system', this.workspaceId, discussionFile, {
      operation: 'create',
      content: this.createDiscussionTemplate(question, context)
    });

    // Collect responses from all Ollama agents
    const responses: AgentResponse[] = [];

    for (const agent of this.agents) {
      console.log(`💭 ${agent.name} (${agent.model}) is thinking...`);

      try {
        // Update agent status
        await this.workspace.updateAgentStatus(
          agent.id,
          this.workspaceId,
          'busy',
          `Processing: ${question.substring(0, 30)}...`
        );

        // Get real response from Ollama
        const startTime = Date.now();
        const response = await this.getOllamaResponse(agent, question, context, responses);
        const responseTime = Date.now() - startTime;

        responses.push({
          agentId: agent.id,
          agentName: agent.name,
          response: response,
          timestamp: Date.now(),
          responseTime: responseTime,
          model: agent.model
        });

        // Add response to discussion file
        await this.workspace.publishFileEdit(agent.id, this.workspaceId, discussionFile, {
          operation: 'update',
          content: `\n\n## ${agent.name} (${agent.model})\n\n${response}\n\n*Response time: ${responseTime}ms*\n`
        });

        // Update status back to active
        await this.workspace.updateAgentStatus(agent.id, this.workspaceId, 'active', 'Response completed');

        console.log(`   ✅ ${agent.name}: ${response.substring(0, 80)}...`);
        console.log(`   ⏱️  Response time: ${responseTime}ms`);

      } catch (error) {
        console.log(`   ❌ ${agent.name}: Failed to respond - ${error}`);
        await this.workspace.updateAgentStatus(agent.id, this.workspaceId, 'idle', `Error: ${error}`);
      }
    }

    // Generate summary
    const summary = this.generateSummary(responses);

    console.log('\n📊 Real AI Discussion Summary:');
    console.log(`   Responses: ${summary.totalResponses}`);
    console.log(`   Total time: ${summary.totalDiscussionTime}ms`);
    console.log(`   Average per agent: ${summary.averageResponseTime}ms`);
    console.log(`   Models used: ${summary.modelPerformance.map(m => m.model).join(', ')}`);

    return {
      discussionId,
      question,
      responses,
      summary
    };
  }

  private async getOllamaResponse(
    agent: OllamaAgentContext,
    question: string,
    context: Record<string, any>,
    previousResponses: AgentResponse[]
  ): Promise<string> {
    // Build context for this agent
    let prompt = `${agent.context}\n\nQuestion: ${question}\n`;

    if (Object.keys(context).length > 0) {
      prompt += `\nContext:\n${Object.entries(context).map(([key, value]) => `- ${key}: ${value}`).join('\n')}\n`;
    }

    if (previousResponses.length > 0) {
      prompt += `\nPrevious responses from other agents:\n`;
      for (const prev of previousResponses) {
        prompt += `- ${prev.agentName}: ${prev.response.substring(0, 150)}...\n`;
      }
    }

    prompt += `\nAs ${agent.name}, provide your perspective. Keep it focused and professional (2-3 sentences):`;

    try {
      const response = await fetch(`${agent.ollamaBaseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: agent.model,
          prompt: prompt,
          stream: false,
          options: {
            temperature: 0.7,
            max_tokens: 200
          }
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as OllamaResponse;
      return data.response.trim();

    } catch (error) {
      throw new Error(`Ollama API call failed: ${error}`);
    }
  }

  async runConsensusVote(proposalId: string, proposal: string): Promise<ConsensusResult> {
    console.log(`\n🗳️  Real AI Consensus Vote: "${proposal}"`);
    console.log('─'.repeat(50));

    const votes: Record<string, { vote: string; reasoning: string }> = {};

    // Collect votes from all Ollama agents
    for (const agent of this.agents) {
      console.log(`   🤖 ${agent.name} (${agent.model}) voting...`);

      const vote = await this.getOllamaVote(agent, proposal);
      const reasoning = await this.getOllamaReasoning(agent, proposal, vote);

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
      console.log(`   ${emoji} ${agent.name}: ${vote} - ${reasoning}`);
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

    console.log(`\n🎯 AI Consensus Decision: ${result.result.toUpperCase()} (${(result.confidence * 100).toFixed(1)}% confidence)`);

    return result;
  }

  private async getOllamaVote(agent: OllamaAgentContext, proposal: string): Promise<string> {
    const prompt = `${agent.context}\n\nProposal: ${proposal}\n\nAs ${agent.name}, vote on this proposal. Respond with ONLY one word: "agree", "disagree", or "abstain":`;

    try {
      const response = await fetch(`${agent.ollamaBaseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: agent.model,
          prompt: prompt,
          stream: false,
          options: {
            temperature: 0.3,
            max_tokens: 10
          }
        })
      });

      const data = await response.json() as OllamaResponse;
      const vote = data.response.trim().toLowerCase();

      // Ensure valid vote
      if (['agree', 'disagree', 'abstain'].includes(vote)) {
        return vote;
      } else {
        // Fallback based on agent type
        return this.getFallbackVote(agent);
      }

    } catch (error) {
      console.log(`   ⚠️  Vote error for ${agent.name}, using fallback`);
      return this.getFallbackVote(agent);
    }
  }

  private getFallbackVote(agent: OllamaAgentContext): string {
    // Fallback voting based on agent personality
    const tendencies = {
      'business-strategist': 'agree',    // Business usually wants to move forward
      'tech-architect': 'abstain',       // Architects need more info
      'code-engineer': 'disagree'        // Engineers see implementation challenges
    };

    return (tendencies as any)[agent.id] || 'abstain';
  }

  private async getOllamaReasoning(agent: OllamaAgentContext, proposal: string, vote: string): Promise<string> {
    const prompt = `${agent.context}\n\nProposal: ${proposal}\nYour vote: ${vote}\n\nAs ${agent.name}, briefly explain your ${vote} vote in one sentence:`;

    try {
      const response = await fetch(`${agent.ollamaBaseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: agent.model,
          prompt: prompt,
          stream: false,
          options: {
            temperature: 0.5,
            max_tokens: 50
          }
        })
      });

      const data = await response.json() as OllamaResponse;
      return data.response.trim();

    } catch (error) {
      return `${agent.name} voted ${vote} based on ${agent.persona.toLowerCase()} considerations.`;
    }
  }

  private createDiscussionTemplate(question: string, context: Record<string, any>): string {
    return `# Real AI Multi-Agent Discussion

## Question
${question}

## Context
${Object.entries(context).map(([key, value]) => `- **${key}**: ${value}`).join('\n')}

## AI Participants
${this.agents.map(a => `- ${a.name} (${a.model}) - ${a.persona}`).join('\n')}

## Discussion Log
Started at: ${new Date().toISOString()}
Infrastructure: Redis ${this.workspace.getHealthStatus().redis.connected ? '✅' : '❌'} | Kafka ${this.workspace.getHealthStatus().kafka.connected ? '✅' : '❌'}

---
`;
  }

  private generateSummary(responses: AgentResponse[]): ResultSummary {
    const totalTime = Date.now() - this.discussionStartTime;
    const avgResponseTime = responses.length > 0 ?
      responses.reduce((sum, r) => sum + r.responseTime, 0) / responses.length : 0;

    // Group by model for performance analysis
    const modelStats = responses.reduce((acc, r) => {
      if (!acc[r.model]) {
        acc[r.model] = { totalTime: 0, count: 0 };
      }
      acc[r.model].totalTime += r.responseTime;
      acc[r.model].count += 1;
      return acc;
    }, {} as Record<string, { totalTime: number; count: number }>);

    const modelPerformance = Object.entries(modelStats).map(([model, stats]) => ({
      model,
      avgTime: stats.totalTime / stats.count,
      responses: stats.count
    }));

    return {
      totalResponses: responses.length,
      perspectives: responses.map(r => ({
        agent: r.agentName,
        keyPoint: r.response.split('.')[0] || r.response.substring(0, 100)
      })),
      averageResponseTime: avgResponseTime,
      totalDiscussionTime: totalTime,
      modelPerformance
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
      proposalId: `ollama_consensus_${Date.now()}`,
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
        model: a.model,
        capabilities: a.capabilities
      })),
      eventsLogged: this.eventLog.length,
      lastActivity: this.eventLog.length > 0 ? this.eventLog[this.eventLog.length - 1].timestamp : null
    };
  }

  async shutdown(): Promise<void> {
    console.log('\n🧹 Shutting down Ollama workspace...');
    await this.workspace.shutdown();
    console.log('✅ Workspace shutdown complete');
  }
}

// Example usage function with real Ollama models
export async function runOllamaExample(): Promise<void> {
  const workspace = new OllamaMultiAgentWorkspace('ollama-ai-session');

  try {
    // 1. Initialize workspace
    await workspace.initialize();

    // 2. Set up real Ollama agent team
    await workspace.setupOllamaAgents();

    // 3. Run real AI group discussion
    const discussion = await workspace.askGroup(
      "Should we prioritize building a mobile app or improving our web platform?",
      {
        budget: "$200,000",
        timeline: "Q1 2025",
        current_users: "web: 75%, mobile browser: 25%",
        user_feedback: "mobile app requests: 60%, web improvements: 40%",
        team_size: "5 developers"
      }
    );

    // 4. Run real AI consensus vote
    discussion.consensusVote = await workspace.runConsensusVote(
      'mobile-vs-web-ai-decision',
      'Prioritize mobile app development over web platform improvements for Q1 2025'
    );

    // 5. Show final results
    console.log('\n📋 Real AI Discussion Results:');
    console.log('============================');
    console.log(`Question: ${discussion.question}`);
    console.log(`AI Models: ${discussion.responses.map(r => r.model).join(', ')}`);
    console.log(`Consensus: ${discussion.consensusVote.result} (${(discussion.consensusVote.confidence * 100).toFixed(1)}% confidence)`);
    console.log(`Total time: ${discussion.summary.totalDiscussionTime}ms`);
    console.log(`Average response: ${discussion.summary.averageResponseTime.toFixed(0)}ms`);
    console.log(`Events logged: ${(await workspace.getWorkspaceStatus()).eventsLogged}`);

    console.log('\n🤖 Model Performance:');
    for (const model of discussion.summary.modelPerformance) {
      console.log(`   ${model.model}: ${model.avgTime.toFixed(0)}ms avg (${model.responses} responses)`);
    }

  } finally {
    await workspace.shutdown();
  }
}

// Run the Ollama example if this file is executed directly
if (require.main === module) {
  console.log('🚀 Starting Real Ollama Multi-Agent Example...\n');

  runOllamaExample()
    .then(() => {
      console.log('\n🎉 Real AI multi-agent collaboration completed successfully!');
      console.log('✅ Local Ollama models worked together with infrastructure coordination');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Ollama example failed:', error);
      console.log('\n🔧 Troubleshooting:');
      console.log('   1. Check Ollama is running: ollama serve');
      console.log('   2. Verify models are installed: ollama list');
      console.log('   3. Test model manually: ollama run mistral:7b-instruct');
      process.exit(1);
    });
}