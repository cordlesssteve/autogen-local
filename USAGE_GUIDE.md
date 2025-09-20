# Multi-Agent Workspace Usage Guide

## Quick Start: Setting up Agent Contexts, Querying, and Getting Results

### 1. Basic Setup

```typescript
import { WorkspaceInfrastructureBridge } from './src/infrastructure/integration/WorkspaceInfrastructureBridge';
import { WorkspaceConfigPresets } from './src/config/WorkspaceConfig';

// Initialize the workspace
const config = WorkspaceConfigPresets.localDevelopment();
const workspace = new WorkspaceInfrastructureBridge(config.infrastructure);
await workspace.initialize();

const workspaceId = 'my-project-workspace';
```

### 2. Setting Up Agent Contexts

```typescript
// Define your agent team
const agentContexts = [
  {
    id: 'product-manager',
    name: 'Product Manager',
    model: 'gpt-4',
    capabilities: ['requirements', 'prioritization', 'stakeholder_management'],
    context: `You are a Product Manager focused on user needs and business value.
             Your role is to define requirements, prioritize features, and ensure
             alignment with business goals.`
  },
  {
    id: 'architect',
    name: 'System Architect',
    model: 'claude-3',
    capabilities: ['system_design', 'technology_selection', 'scalability'],
    context: `You are a System Architect responsible for technical design decisions.
             Focus on scalability, maintainability, and technical feasibility.`
  },
  {
    id: 'developer',
    name: 'Senior Developer',
    model: 'gpt-4',
    capabilities: ['implementation', 'code_review', 'debugging'],
    context: `You are a Senior Developer who turns designs into working code.
             Focus on implementation details, code quality, and technical challenges.`
  }
];

// Register all agents with the workspace
for (const agent of agentContexts) {
  await workspace.registerAgent(agent.id, workspaceId, {
    name: agent.name,
    model: agent.model,
    capabilities: agent.capabilities
  });

  // Set agent as active
  await workspace.updateAgentStatus(agent.id, workspaceId, 'active', 'Ready for collaboration');
}
```

### 3. Querying the Group

```typescript
class MultiAgentQuery {
  constructor(workspace, workspaceId, agents) {
    this.workspace = workspace;
    this.workspaceId = workspaceId;
    this.agents = agents;
    this.currentDiscussion = null;
  }

  async askGroup(question, context = {}) {
    const discussionId = `discussion_${Date.now()}`;
    this.currentDiscussion = discussionId;

    console.log(`🤔 Asking group: "${question}"`);

    // 1. Create shared workspace file for the discussion
    const discussionFile = `/discussions/${discussionId}.md`;

    // 2. Get file lock for discussion coordination
    const lockId = await this.workspace.requestFileLock(
      'system', this.workspaceId, discussionFile, 'write'
    );

    // 3. Initialize discussion document
    await this.workspace.publishFileEdit('system', this.workspaceId, discussionFile, {
      operation: 'create',
      content: this.createDiscussionTemplate(question, context)
    });

    // 4. Release lock so agents can participate
    if (lockId) {
      await this.workspace.releaseFileLock(lockId, 'system');
    }

    // 5. Notify all agents about the discussion
    const responses = [];
    for (const agent of this.agents) {
      const response = await this.queryAgent(agent, question, context, discussionFile);
      responses.push({
        agentId: agent.id,
        agentName: agent.name,
        response: response,
        timestamp: Date.now()
      });
    }

    return {
      discussionId,
      question,
      responses,
      summary: await this.generateSummary(responses)
    };
  }

  async queryAgent(agent, question, context, discussionFile) {
    // Update agent status
    await this.workspace.updateAgentStatus(
      agent.id, this.workspaceId, 'busy', `Responding to: ${question.substring(0, 50)}...`
    );

    try {
      // Request file lock to add response
      const lockId = await this.workspace.requestFileLock(
        agent.id, this.workspaceId, discussionFile, 'write'
      );

      // Simulate agent thinking (replace with actual LLM call)
      const response = await this.simulateAgentResponse(agent, question, context);

      // Add response to discussion file
      await this.workspace.publishFileEdit(agent.id, this.workspaceId, discussionFile, {
        operation: 'update',
        content: `\n\n## ${agent.name} Response\n\n${response}\n`,
        reason: `${agent.name} adding response to discussion`
      });

      // Release lock
      if (lockId) {
        await this.workspace.releaseFileLock(lockId, agent.id);
      }

      // Update status back to active
      await this.workspace.updateAgentStatus(agent.id, this.workspaceId, 'active', 'Response completed');

      return response;

    } catch (error) {
      await this.workspace.updateAgentStatus(agent.id, this.workspaceId, 'idle', `Error: ${error.message}`);
      throw error;
    }
  }

  createDiscussionTemplate(question, context) {
    return `# Group Discussion

## Question
${question}

## Context
${JSON.stringify(context, null, 2)}

## Participants
${this.agents.map(a => `- ${a.name} (${a.id})`).join('\n')}

## Responses
*Agents will add their responses below...*
`;
  }

  async simulateAgentResponse(agent, question, context) {
    // This is where you'd integrate with actual LLM APIs
    // For now, simulate based on agent role

    const roleResponses = {
      'product-manager': `From a product perspective, I think we need to consider the user impact and business value. ${question}`,
      'architect': `From a technical architecture standpoint, we should evaluate the system design implications. ${question}`,
      'developer': `From an implementation perspective, let me think about the coding challenges and technical feasibility. ${question}`
    };

    return roleResponses[agent.id] || `As ${agent.name}, I believe we should carefully consider: ${question}`;
  }

  async generateSummary(responses) {
    const summary = {
      totalResponses: responses.length,
      perspectives: responses.map(r => ({
        agent: r.agentName,
        keyPoint: r.response.substring(0, 100) + '...'
      })),
      consensus: this.analyzeConsensus(responses),
      nextSteps: this.suggestNextSteps(responses)
    };

    return summary;
  }

  analyzeConsensus(responses) {
    // Simple consensus analysis (enhance with actual sentiment/agreement analysis)
    return responses.length > 2 ? 'Multiple perspectives captured' : 'Limited input';
  }

  suggestNextSteps(responses) {
    return [
      'Review all agent perspectives',
      'Identify areas of agreement/disagreement',
      'Develop action plan based on input'
    ];
  }
}
```

### 4. Getting Results and Managing Consensus

```typescript
class ResultsManager {
  constructor(workspace, workspaceId) {
    this.workspace = workspace;
    this.workspaceId = workspaceId;
  }

  async collectResults(discussionId) {
    console.log(`📊 Collecting results for ${discussionId}`);

    // 1. Get discussion file content
    const discussionFile = `/discussions/${discussionId}.md`;
    // Note: You'd implement file reading here

    // 2. Parse responses from each agent
    const responses = await this.parseDiscussionFile(discussionFile);

    // 3. Generate comprehensive results
    const results = {
      discussionId,
      timestamp: Date.now(),
      participants: responses.map(r => r.agentId),
      responses: responses,
      analysis: await this.analyzeResults(responses),
      recommendations: await this.generateRecommendations(responses)
    };

    // 4. Save results snapshot
    await this.workspace.saveWorkspaceSnapshot('system', this.workspaceId, {
      files: { [discussionFile]: 'discussion-content' },
      metadata: { discussionId, type: 'group-query-results' },
      activeAgents: responses.map(r => r.agentId),
      consensus: results.analysis.consensus
    });

    return results;
  }

  async initiateConsensusVote(proposalId, proposal, agents) {
    console.log(`🗳️ Starting consensus vote: ${proposal}`);

    // 1. Publish the proposal
    for (const agent of agents) {
      await this.workspace.publishConsensusVote(
        agent.id, this.workspaceId, proposalId,
        await this.getAgentVote(agent, proposal),
        await this.getAgentReasoning(agent, proposal)
      );
    }

    // 2. Collect votes
    const votes = await this.collectVotes(proposalId, agents);

    // 3. Determine result
    const decision = this.calculateConsensus(votes);

    // 4. Log final decision
    await this.workspace.logConsensusDecision('system', this.workspaceId, {
      proposalId,
      description: proposal,
      votes: votes,
      finalDecision: decision.result,
      consensusMethod: 'majority'
    });

    return decision;
  }

  async getAgentVote(agent, proposal) {
    // Simulate agent voting logic (replace with actual LLM call)
    const responses = ['agree', 'disagree', 'abstain'];
    return responses[Math.floor(Math.random() * responses.length)];
  }

  async getAgentReasoning(agent, proposal) {
    return `${agent.name}'s reasoning for proposal: ${proposal}`;
  }

  calculateConsensus(votes) {
    const counts = votes.reduce((acc, vote) => {
      acc[vote.vote] = (acc[vote.vote] || 0) + 1;
      return acc;
    }, {});

    const total = votes.length;
    const agree = counts.agree || 0;
    const disagree = counts.disagree || 0;

    if (agree > total / 2) {
      return { result: 'approved', confidence: agree / total };
    } else if (disagree > total / 2) {
      return { result: 'rejected', confidence: disagree / total };
    } else {
      return { result: 'deadlock', confidence: 0.5 };
    }
  }
}
```

### 5. Complete Usage Example

```typescript
async function runMultiAgentSession() {
  // 1. Setup
  const config = WorkspaceConfigPresets.localDevelopment();
  const workspace = new WorkspaceInfrastructureBridge(config.infrastructure);
  await workspace.initialize();

  const workspaceId = 'product-planning-session';
  const agents = [/* agent contexts from above */];

  // 2. Initialize agents
  for (const agent of agents) {
    await workspace.registerAgent(agent.id, workspaceId, {
      name: agent.name,
      model: agent.model,
      capabilities: agent.capabilities
    });
  }

  // 3. Query the group
  const queryManager = new MultiAgentQuery(workspace, workspaceId, agents);
  const result = await queryManager.askGroup(
    "Should we implement a mobile app or focus on web platform improvements?",
    {
      budget: "$100k",
      timeline: "6 months",
      userFeedback: "60% requesting mobile app"
    }
  );

  console.log("📋 Group Discussion Results:");
  console.log(result.summary);

  // 4. Collect detailed results
  const resultsManager = new ResultsManager(workspace, workspaceId);
  const detailedResults = await resultsManager.collectResults(result.discussionId);

  // 5. Run consensus vote if needed
  const decision = await resultsManager.initiateConsensusVote(
    'mobile-vs-web-decision',
    'Prioritize mobile app development over web improvements',
    agents
  );

  console.log("🎯 Final Decision:", decision);

  // 6. Cleanup
  await workspace.shutdown();
}

// Run the session
runMultiAgentSession().catch(console.error);
```

### 6. Integration with Actual LLMs

```typescript
// Replace the simulation functions with real LLM calls
class LLMIntegration {
  async callAgent(agent, prompt, context) {
    // Example with OpenAI
    if (agent.model === 'gpt-4') {
      return await this.callOpenAI(agent, prompt, context);
    }

    // Example with Anthropic
    if (agent.model === 'claude-3') {
      return await this.callClaude(agent, prompt, context);
    }

    throw new Error(`Unknown model: ${agent.model}`);
  }

  async callOpenAI(agent, prompt, context) {
    // OpenAI API integration
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: agent.context },
          { role: 'user', content: `${prompt}\n\nContext: ${JSON.stringify(context)}` }
        ]
      })
    });

    const data = await response.json();
    return data.choices[0].message.content;
  }
}
```

This gives you a complete framework for setting up agent contexts, querying groups, and collecting results with proper coordination and conflict prevention! 🚀