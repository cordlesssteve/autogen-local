#!/usr/bin/env ts-node
/**
 * Multi-Agent Orchestration Dashboard Server
 *
 * Real-time web dashboard for monitoring and managing multi-agent systems
 */

import express, { Request, Response } from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import { OllamaMultiAgentWorkspace } from '../examples/OllamaMultiAgentExample';

interface DashboardAgent {
  id: string;
  name: string;
  model: string;
  status: 'idle' | 'active' | 'busy' | 'error';
  lastActivity: string;
  capabilities: string[];
  context: string;
  persona: string;
  responseTime?: number;
  lastResponse?: string;
  isConnected: boolean;
}

interface ConversationMessage {
  id: string;
  timestamp: number;
  agentId: string;
  agentName: string;
  model: string;
  content: string;
  responseTime: number;
  type: 'question' | 'response' | 'consensus_vote' | 'system';
}

interface ConsensusVote {
  agentId: string;
  agentName: string;
  vote: 'agree' | 'disagree' | 'abstain';
  reasoning: string;
  timestamp: number;
}

interface WorkspaceSession {
  id: string;
  name: string;
  startTime: number;
  status: 'active' | 'paused' | 'completed';
  agents: DashboardAgent[];
  messages: ConversationMessage[];
  currentQuestion?: string;
  consensusVotes: ConsensusVote[];
  infrastructureStatus: {
    redis: boolean;
    kafka: boolean;
    overall: string;
  };
}

class MultiAgentDashboard {
  private app: express.Application;
  private server: any;
  private io: SocketIOServer;
  private workspace?: OllamaMultiAgentWorkspace;
  private session: WorkspaceSession;
  private messageCounter = 0;

  constructor(private port: number = 3000) {
    this.app = express();
    this.server = createServer(this.app);
    this.io = new SocketIOServer(this.server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });

    this.session = {
      id: `session_${Date.now()}`,
      name: 'Multi-Agent Workspace',
      startTime: Date.now(),
      status: 'active',
      agents: [],
      messages: [],
      consensusVotes: [],
      infrastructureStatus: {
        redis: false,
        kafka: false,
        overall: 'offline'
      }
    };

    this.setupExpress();
    this.setupSocketHandlers();
  }

  private setupExpress(): void {
    // Serve static files from dashboard directory
    this.app.use(express.static(path.join(__dirname, 'public')));
    this.app.use(express.json());

    // API routes
    this.app.get('/api/session', (_req: Request, res: Response) => {
      res.json(this.session);
    });

    this.app.post('/api/agents/:id/update', (req: Request, res: Response) => {
      const agentId = req.params.id;
      const updates = req.body;

      const agent = this.session.agents.find(a => a.id === agentId);
      if (agent) {
        Object.assign(agent, updates);
        this.broadcastUpdate('agent_updated', agent);
        res.json({ success: true, agent });
      } else {
        res.status(404).json({ error: 'Agent not found' });
      }
    });

    this.app.post('/api/ask', async (req: Request, res: Response) => {
      const { question, context } = req.body;

      if (!this.workspace) {
        return res.status(400).json({ error: 'Workspace not initialized' });
      }

      try {
        this.session.currentQuestion = question;

        // Log the question being asked
        this.addConversationMessage({
          agentId: 'user',
          agentName: 'User',
          model: 'human',
          content: question,
          responseTime: 0,
          type: 'question'
        });

        this.broadcastUpdate('question_started', { question, context });

        const result = await this.workspace.askGroup(question, context);

        this.broadcastUpdate('question_completed', result);
        return res.json({ success: true, result });
      } catch (error) {
        return res.status(500).json({ error: (error as Error).message });
      }
    });

    this.app.post('/api/consensus', async (req: Request, res: Response) => {
      const { proposalId, proposal } = req.body;

      if (!this.workspace) {
        return res.status(400).json({ error: 'Workspace not initialized' });
      }

      try {
        this.session.consensusVotes = [];

        // Log the consensus proposal being made
        this.addConversationMessage({
          agentId: 'user',
          agentName: 'User',
          model: 'human',
          content: `Consensus Vote: ${proposal}`,
          responseTime: 0,
          type: 'question'
        });

        this.broadcastUpdate('consensus_started', { proposalId, proposal });

        const result = await this.workspace.runConsensusVote(proposalId, proposal);

        this.broadcastUpdate('consensus_completed', result);
        return res.json({ success: true, result });
      } catch (error) {
        return res.status(500).json({ error: (error as Error).message });
      }
    });

    // Workspace initialization endpoint
    this.app.post('/api/initialize-workspace', async (_req: Request, res: Response) => {
      try {
        await this.initializeWorkspace('dashboard-session');
        return res.json({
          success: true,
          message: 'Workspace initialized successfully',
          agents: this.session.agents,
          infrastructureStatus: this.session.infrastructureStatus
        });
      } catch (error) {
        return res.status(500).json({
          error: (error as Error).message,
          success: false
        });
      }
    });

    // Manual agent population endpoint for debugging
    this.app.post('/api/populate-agents', (_req: Request, res: Response) => {
      this.populateAgentsManually();
      this.broadcastUpdate('agents_populated', {
        count: this.session.agents.length,
        agents: this.session.agents
      });
      return res.json({
        success: true,
        count: this.session.agents.length,
        agents: this.session.agents
      });
    });

    // Default route serves dashboard
    this.app.get('/', (_req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });
  }

  private setupSocketHandlers(): void {
    this.io.on('connection', (socket) => {
      console.log('📱 Dashboard client connected');

      // Send current session state to new client
      socket.emit('session_update', this.session);

      socket.on('initialize_workspace', async (data) => {
        try {
          await this.initializeWorkspace(data.workspaceId || 'dashboard-session');
          socket.emit('workspace_initialized', { success: true });
        } catch (error) {
          socket.emit('workspace_error', { error: (error as Error).message });
        }
      });

      socket.on('disconnect', () => {
        console.log('📱 Dashboard client disconnected');
      });
    });
  }

  async initializeWorkspace(workspaceId: string): Promise<void> {
    console.log('🚀 Initializing workspace for dashboard...');

    this.workspace = new OllamaMultiAgentWorkspace(workspaceId);

    // Override the workspace methods to capture events for dashboard
    this.setupWorkspaceEventCapture();

    await this.workspace.initialize();
    await this.workspace.setupOllamaAgents();

    // Manually populate agents after setup is complete
    this.populateAgentsManually();

    // Update session with agent info
    this.updateAgentsFromWorkspace();
    this.updateInfrastructureStatus();

    this.broadcastUpdate('workspace_initialized', {
      workspaceId,
      agents: this.session.agents,
      infrastructure: this.session.infrastructureStatus
    });
  }

  private populateAgentsManually(): void {
    // Manually create the agent list since they're successfully connecting in the logs
    const knownAgents = [
      {
        id: 'business-strategist',
        name: 'Business Strategist',
        model: 'mistral:7b-instruct',
        capabilities: ['business_analysis', 'market_research', 'roi_analysis'],
        context: 'You are a Business Strategist focused on market analysis, ROI, and user value. Analyze from a business perspective with focus on revenue, growth, and market positioning.',
        persona: 'Market-focused, ROI-driven, strategic thinker',
        ollamaBaseUrl: 'http://localhost:11434'
      },
      {
        id: 'tech-architect',
        name: 'Technical Architect',
        model: 'phi3.5:latest',
        capabilities: ['system_design', 'scalability', 'architecture'],
        context: 'You are a Technical Architect responsible for system design, scalability, and architecture. Focus on technical feasibility, system performance, and architectural decisions.',
        persona: 'Architecture-focused, scalability-minded, technical expert',
        ollamaBaseUrl: 'http://localhost:11434'
      },
      {
        id: 'code-engineer',
        name: 'Implementation Engineer',
        model: 'qwen2.5-coder:3b',
        capabilities: ['implementation', 'code_quality', 'development'],
        context: 'You are an Implementation Engineer focused on development effort, code quality, and implementation details. Analyze from a coding and development perspective.',
        persona: 'Code-focused, pragmatic, implementation-oriented',
        ollamaBaseUrl: 'http://localhost:11434'
      }
    ];

    this.session.agents = knownAgents.map(agent => ({
      id: agent.id,
      name: agent.name,
      model: agent.model,
      status: 'active' as const, // Mark as active since they're connected in logs
      lastActivity: 'Connected to Ollama',
      capabilities: agent.capabilities,
      context: agent.context,
      persona: agent.persona,
      isConnected: true
    }));

    console.log(`📋 Manually populated ${this.session.agents.length} agents for dashboard`);
  }

  private setupWorkspaceEventCapture(): void {
    if (!this.workspace) return;

    // Capture workspace events
    (this.workspace as any).workspace.on('workspace_operation', (operation: any) => {
      this.addSystemMessage(`Operation: ${operation.type} by ${operation.agentId}`);
    });

    (this.workspace as any).workspace.on('redis_connected', () => {
      this.session.infrastructureStatus.redis = true;
      this.updateInfrastructureStatus();
    });

    (this.workspace as any).workspace.on('kafka_connected', () => {
      this.session.infrastructureStatus.kafka = true;
      this.updateInfrastructureStatus();
    });

    // Override response method to capture conversations
    const originalGetOllamaResponse = (this.workspace as any).getOllamaResponse;
    (this.workspace as any).getOllamaResponse = async (...args: any[]) => {
      const [agent] = args;

      // Update agent status to busy
      this.updateAgentStatus(agent.id, 'busy', 'Thinking...');

      const startTime = Date.now();
      try {
        const response = await originalGetOllamaResponse.apply(this.workspace, args);
        const responseTime = Date.now() - startTime;

        // Add message to conversation
        this.addConversationMessage({
          agentId: agent.id,
          agentName: agent.name,
          model: agent.model,
          content: response,
          responseTime,
          type: 'response'
        });

        // Update agent status back to active
        this.updateAgentStatus(agent.id, 'active', 'Response completed');
        this.updateAgentLastResponse(agent.id, response, responseTime);

        return response;
      } catch (error) {
        this.updateAgentStatus(agent.id, 'error', (error as Error).message);
        throw error;
      }
    };

    // Override voting methods to capture consensus
    const originalGetOllamaVote = (this.workspace as any).getOllamaVote;
    (this.workspace as any).getOllamaVote = async (...args: any[]) => {
      const [agent, proposal] = args;

      const vote = await originalGetOllamaVote.apply(this.workspace, args);
      const reasoning = await (this.workspace as any).getOllamaReasoning(agent, proposal, vote);

      // Add vote to consensus tracking
      this.session.consensusVotes.push({
        agentId: agent.id,
        agentName: agent.name,
        vote,
        reasoning,
        timestamp: Date.now()
      });

      // Add vote as conversation message
      this.addConversationMessage({
        agentId: agent.id,
        agentName: agent.name,
        model: agent.model,
        content: `Vote: ${vote.toUpperCase()}\nReasoning: ${reasoning}`,
        responseTime: 0,
        type: 'consensus_vote'
      });

      this.broadcastUpdate('consensus_vote', {
        agentId: agent.id,
        agentName: agent.name,
        vote,
        reasoning
      });

      return vote;
    };
  }

  private updateAgentsFromWorkspace(): void {
    if (!this.workspace) return;

    // Get agents from workspace - they're stored in the workspace.agents property
    const agents = (this.workspace as any).agents || [];
    console.log(`📋 Found ${agents.length} agents in workspace`);

    if (agents.length > 0) {
      this.session.agents = agents.map((agent: any) => {
        console.log(`📋 Registering agent: ${agent.name} (${agent.model})`);
        return {
          id: agent.id,
          name: agent.name,
          model: agent.model,
          status: 'idle' as const,
          lastActivity: new Date().toISOString(),
          capabilities: agent.capabilities || [],
          context: agent.context || '',
          persona: agent.persona || '',
          isConnected: true
        };
      });

      this.broadcastUpdate('agents_registered', {
        count: this.session.agents.length,
        agents: this.session.agents
      });
    } else {
      console.log('⚠️  No agents found in workspace - they may still be initializing');
    }
  }

  private updateInfrastructureStatus(): void {
    if (!this.workspace) return;

    const health = (this.workspace as any).workspace.getHealthStatus();
    this.session.infrastructureStatus = {
      redis: health.redis.connected,
      kafka: health.kafka.connected,
      overall: health.overall
    };

    this.broadcastUpdate('infrastructure_status', this.session.infrastructureStatus);
  }

  private updateAgentStatus(agentId: string, status: DashboardAgent['status'], activity: string): void {
    const agent = this.session.agents.find(a => a.id === agentId);
    if (agent) {
      agent.status = status;
      agent.lastActivity = activity;
      this.broadcastUpdate('agent_status', { agentId, status, activity });
    }
  }

  private updateAgentLastResponse(agentId: string, response: string, responseTime: number): void {
    const agent = this.session.agents.find(a => a.id === agentId);
    if (agent) {
      agent.lastResponse = response.substring(0, 200) + (response.length > 200 ? '...' : '');
      agent.responseTime = responseTime;
      this.broadcastUpdate('agent_response', { agentId, response: agent.lastResponse, responseTime });
    }
  }

  private addConversationMessage(message: Omit<ConversationMessage, 'id' | 'timestamp'>): void {
    const fullMessage: ConversationMessage = {
      id: `msg_${++this.messageCounter}`,
      timestamp: Date.now(),
      ...message
    };

    this.session.messages.push(fullMessage);
    this.broadcastUpdate('new_message', fullMessage);
  }

  private addSystemMessage(content: string): void {
    this.addConversationMessage({
      agentId: 'system',
      agentName: 'System',
      model: 'system',
      content,
      responseTime: 0,
      type: 'system'
    });
  }

  private broadcastUpdate(event: string, data: any): void {
    this.io.emit(event, data);
    this.io.emit('session_update', this.session);
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        console.log(`🖥️  Multi-Agent Dashboard running at http://localhost:${this.port}`);
        console.log('📊 Real-time agent monitoring enabled');
        console.log('🎛️  Agent management interface ready');
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (this.workspace) {
      await this.workspace.shutdown();
    }
    this.server.close();
  }
}

// CLI runner
async function main() {
  const dashboard = new MultiAgentDashboard(3000);

  try {
    await dashboard.start();

    // Keep the server running
    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down dashboard...');
      await dashboard.stop();
      process.exit(0);
    });

  } catch (error) {
    console.error('❌ Dashboard failed to start:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

export { MultiAgentDashboard };