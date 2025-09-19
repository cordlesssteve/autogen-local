/**
 * Kafka Persistent Messaging Layer for Multi-LLM Collaborative Workspace
 *
 * Provides persistent and reliable messaging for AutoGen multi-agent workspace:
 * - Complete workspace edit history and audit trails
 * - Cross-session workspace state persistence
 * - Reliable multi-LLM coordination and consensus tracking
 * - Durable workflow orchestration and decision logging
 *
 * Adapted from Meiosis Kafka orchestration infrastructure
 */

import { Kafka, Producer, Consumer, EachMessagePayload, KafkaConfig } from 'kafkajs';
import { EventEmitter } from 'events';

export interface WorkspaceKafkaMessage {
  id: string;
  timestamp: number;
  type: 'edit_history' | 'consensus_decision' | 'workspace_snapshot' | 'agent_coordination' | 'conflict_resolution';
  source: string;
  target?: string;
  priority: 'high' | 'medium' | 'low';
  payload: Record<string, any>;
  metadata: {
    agentId: string;
    workspaceId: string;
    sessionId: string;
    filePath?: string;
    correlationId?: string;
    sequenceNumber: number;
    requiresResponse?: boolean;
    consensusRound?: number;
  };
}

export interface KafkaWorkspaceConfig {
  clientId: string;
  brokers: string[];
  ssl?: boolean;
  sasl?: {
    mechanism: 'plain' | 'scram-sha-256' | 'scram-sha-512';
    username: string;
    password: string;
  };
  groupId: string;
  sessionTimeoutMs: number;
  heartbeatIntervalMs: number;
  retrySettings: {
    initialRetryTime: number;
    retries: number;
    maxRetryTime: number;
  };
  batchSettings: {
    batchSize: number;
    lingerMs: number;
  };
}

export const WORKSPACE_KAFKA_TOPICS = {
  // Persistent Workspace Operations
  EDIT_HISTORY: 'autogen-edit-history',
  WORKSPACE_SNAPSHOTS: 'autogen-workspace-snapshots',
  CONSENSUS_DECISIONS: 'autogen-consensus-decisions',
  AGENT_COORDINATION: 'autogen-agent-coordination',
  CONFLICT_RESOLUTION: 'autogen-conflict-resolution',

  // Cross-Session Continuity
  SESSION_MANAGEMENT: 'autogen-session-management',
  WORKSPACE_LIFECYCLE: 'autogen-workspace-lifecycle',

  // Audit and Compliance
  AUDIT_TRAIL: 'autogen-audit-trail',
  DECISION_LOG: 'autogen-decision-log'
};

export class KafkaWorkspaceOrchestrator extends EventEmitter {
  private kafka: Kafka;
  private producer: Producer;
  private consumer: Consumer;
  private config: KafkaWorkspaceConfig;
  private isConnected: boolean = false;
  private sequenceNumber: number = 0;

  constructor(config: KafkaWorkspaceConfig) {
    super();
    this.config = config;

    const kafkaConfig: KafkaConfig = {
      clientId: config.clientId,
      brokers: config.brokers,
      ssl: config.ssl,
      retry: {
        initialRetryTime: config.retrySettings.initialRetryTime,
        retries: config.retrySettings.retries,
        maxRetryTime: config.retrySettings.maxRetryTime
      },
      ...(config.sasl !== undefined && { sasl: config.sasl as any })
    };

    this.kafka = new Kafka(kafkaConfig);
    this.producer = this.kafka.producer({
      allowAutoTopicCreation: true,
      transactionTimeout: 30000,
      ...config.batchSettings
    });

    this.consumer = this.kafka.consumer({
      groupId: config.groupId,
      sessionTimeout: config.sessionTimeoutMs,
      heartbeatInterval: config.heartbeatIntervalMs,
      allowAutoTopicCreation: true
    });

    this.setupEventHandlers();
  }

  async connect(): Promise<void> {
    // Check if already connected
    if (this.isConnected) {
      return;
    }

    try {
      // Connect producer and consumer if not already connected
      await this.producer.connect();
      await this.consumer.connect();

      // Subscribe to all workspace topics
      await this.consumer.subscribe({
        topics: Object.values(WORKSPACE_KAFKA_TOPICS),
        fromBeginning: false
      });

      await this.consumer.run({
        eachMessage: this.handleMessage.bind(this)
      });

      this.isConnected = true;
      this.emit('connected');
    } catch (error) {
      this.emit('error', new Error(`Kafka connection failed: ${error}`));
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.isConnected = false;

    try {
      await this.consumer.disconnect();
      await this.producer.disconnect();
      this.emit('disconnected');
    } catch (error) {
      this.emit('error', new Error(`Kafka disconnection failed: ${error}`));
    }
  }

  // Edit History Operations
  async logFileEdit(
    agentId: string,
    workspaceId: string,
    sessionId: string,
    filePath: string,
    editData: {
      operation: 'create' | 'update' | 'delete';
      previousContent?: string;
      newContent?: string;
      patch?: string;
      startLine?: number;
      endLine?: number;
      reason?: string;
    }
  ): Promise<void> {
    const message: WorkspaceKafkaMessage = {
      id: `edit_${Date.now()}_${this.generateId()}`,
      timestamp: Date.now(),
      type: 'edit_history',
      source: agentId,
      priority: 'high',
      payload: {
        operation: editData.operation,
        previousContent: editData.previousContent,
        newContent: editData.newContent,
        patch: editData.patch,
        startLine: editData.startLine,
        endLine: editData.endLine,
        reason: editData.reason,
        filePath,
        editTimestamp: Date.now()
      },
      metadata: {
        agentId,
        workspaceId,
        sessionId,
        filePath,
        sequenceNumber: this.getNextSequence(),
        correlationId: `edit_${workspaceId}_${filePath}_${Date.now()}`
      }
    };

    await this.publishMessage(WORKSPACE_KAFKA_TOPICS.EDIT_HISTORY, message);
  }

  // Workspace Snapshot Operations
  async saveWorkspaceSnapshot(
    agentId: string,
    workspaceId: string,
    sessionId: string,
    snapshot: {
      files: Record<string, string>;
      metadata: Record<string, any>;
      activeAgents: string[];
      consensus: Record<string, any>;
      reason: string;
    }
  ): Promise<void> {
    const message: WorkspaceKafkaMessage = {
      id: `snapshot_${Date.now()}_${this.generateId()}`,
      timestamp: Date.now(),
      type: 'workspace_snapshot',
      source: agentId,
      priority: 'medium',
      payload: {
        files: snapshot.files,
        metadata: snapshot.metadata,
        activeAgents: snapshot.activeAgents,
        consensus: snapshot.consensus,
        reason: snapshot.reason,
        snapshotTimestamp: Date.now()
      },
      metadata: {
        agentId,
        workspaceId,
        sessionId,
        sequenceNumber: this.getNextSequence(),
        correlationId: `snapshot_${workspaceId}_${Date.now()}`
      }
    };

    await this.publishMessage(WORKSPACE_KAFKA_TOPICS.WORKSPACE_SNAPSHOTS, message);
  }

  // Consensus Decision Logging
  async logConsensusDecision(
    agentId: string,
    workspaceId: string,
    sessionId: string,
    decision: {
      proposalId: string;
      description: string;
      votes: Record<string, { vote: 'agree' | 'disagree' | 'abstain'; reasoning?: string }>;
      finalDecision: 'approved' | 'rejected' | 'deferred';
      consensusMethod: 'majority' | 'weighted' | 'unanimous' | 'delegate';
      implementation?: string;
      deadline?: number;
    }
  ): Promise<void> {
    const message: WorkspaceKafkaMessage = {
      id: `consensus_${Date.now()}_${this.generateId()}`,
      timestamp: Date.now(),
      type: 'consensus_decision',
      source: agentId,
      priority: 'high',
      payload: {
        proposalId: decision.proposalId,
        description: decision.description,
        votes: decision.votes,
        finalDecision: decision.finalDecision,
        consensusMethod: decision.consensusMethod,
        implementation: decision.implementation,
        deadline: decision.deadline,
        decisionTimestamp: Date.now()
      },
      metadata: {
        agentId,
        workspaceId,
        sessionId,
        sequenceNumber: this.getNextSequence(),
        correlationId: `consensus_${decision.proposalId}`,
        consensusRound: this.extractConsensusRound(decision.proposalId)
      }
    };

    await this.publishMessage(WORKSPACE_KAFKA_TOPICS.CONSENSUS_DECISIONS, message);
  }

  // Agent Coordination Operations
  async logAgentCoordination(
    agentId: string,
    workspaceId: string,
    sessionId: string,
    coordination: {
      type: 'handoff' | 'collaboration' | 'delegation' | 'synchronization';
      targetAgent?: string;
      task: string;
      dependencies?: string[];
      expectedDuration?: number;
      priority: 'high' | 'medium' | 'low';
    }
  ): Promise<void> {
    const message: WorkspaceKafkaMessage = {
      id: `coord_${Date.now()}_${this.generateId()}`,
      timestamp: Date.now(),
      type: 'agent_coordination',
      source: agentId,
      target: coordination.targetAgent,
      priority: coordination.priority,
      payload: {
        coordinationType: coordination.type,
        task: coordination.task,
        dependencies: coordination.dependencies || [],
        expectedDuration: coordination.expectedDuration,
        coordinationTimestamp: Date.now()
      },
      metadata: {
        agentId,
        workspaceId,
        sessionId,
        sequenceNumber: this.getNextSequence(),
        correlationId: `coord_${workspaceId}_${Date.now()}`,
        requiresResponse: coordination.type === 'delegation'
      }
    };

    await this.publishMessage(WORKSPACE_KAFKA_TOPICS.AGENT_COORDINATION, message);
  }

  // Conflict Resolution Operations
  async logConflictResolution(
    agentId: string,
    workspaceId: string,
    sessionId: string,
    conflict: {
      conflictId: string;
      type: 'edit_collision' | 'consensus_deadlock' | 'resource_contention' | 'priority_conflict';
      involvedAgents: string[];
      conflictDetails: Record<string, any>;
      resolutionMethod: 'automatic' | 'escalation' | 'consensus_vote' | 'manual_override';
      resolution: Record<string, any>;
      outcome: 'resolved' | 'escalated' | 'deferred';
    }
  ): Promise<void> {
    const message: WorkspaceKafkaMessage = {
      id: `conflict_${Date.now()}_${this.generateId()}`,
      timestamp: Date.now(),
      type: 'conflict_resolution',
      source: agentId,
      priority: 'high',
      payload: {
        conflictId: conflict.conflictId,
        conflictType: conflict.type,
        involvedAgents: conflict.involvedAgents,
        conflictDetails: conflict.conflictDetails,
        resolutionMethod: conflict.resolutionMethod,
        resolution: conflict.resolution,
        outcome: conflict.outcome,
        resolutionTimestamp: Date.now()
      },
      metadata: {
        agentId,
        workspaceId,
        sessionId,
        sequenceNumber: this.getNextSequence(),
        correlationId: conflict.conflictId
      }
    };

    await this.publishMessage(WORKSPACE_KAFKA_TOPICS.CONFLICT_RESOLUTION, message);
  }

  // Query Operations for Cross-Session Continuity
  async getWorkspaceHistory(
    workspaceId: string,
    fromTimestamp?: number,
    toTimestamp?: number,
    messageTypes?: string[]
  ): Promise<WorkspaceKafkaMessage[]> {
    // This would typically require a Kafka Streams application or external storage
    // For now, emit event that application can handle with proper storage backend
    this.emit('history_request', {
      workspaceId,
      fromTimestamp,
      toTimestamp,
      messageTypes
    });

    return []; // Placeholder - implement with proper storage backend
  }

  async getLatestWorkspaceSnapshot(workspaceId: string): Promise<WorkspaceKafkaMessage | null> {
    // Emit event for application to handle
    this.emit('snapshot_request', { workspaceId });
    return null; // Placeholder - implement with proper storage backend
  }

  // Session Management
  async startWorkspaceSession(
    agentId: string,
    workspaceId: string,
    sessionId: string,
    sessionData: {
      participants: string[];
      goal: string;
      timeLimit?: number;
      consensusThreshold?: number;
    }
  ): Promise<void> {
    const message: WorkspaceKafkaMessage = {
      id: `session_start_${Date.now()}_${this.generateId()}`,
      timestamp: Date.now(),
      type: 'workspace_snapshot', // Using existing type for session events
      source: agentId,
      priority: 'high',
      payload: {
        eventType: 'session_start',
        participants: sessionData.participants,
        goal: sessionData.goal,
        timeLimit: sessionData.timeLimit,
        consensusThreshold: sessionData.consensusThreshold,
        sessionStartTime: Date.now()
      },
      metadata: {
        agentId,
        workspaceId,
        sessionId,
        sequenceNumber: this.getNextSequence(),
        correlationId: `session_${sessionId}`
      }
    };

    await this.publishMessage(WORKSPACE_KAFKA_TOPICS.SESSION_MANAGEMENT, message);
  }

  async endWorkspaceSession(
    agentId: string,
    workspaceId: string,
    sessionId: string,
    sessionResult: {
      outcome: 'completed' | 'timeout' | 'aborted';
      finalState: Record<string, any>;
      decisions: string[];
      participants: string[];
      summary: string;
    }
  ): Promise<void> {
    const message: WorkspaceKafkaMessage = {
      id: `session_end_${Date.now()}_${this.generateId()}`,
      timestamp: Date.now(),
      type: 'workspace_snapshot',
      source: agentId,
      priority: 'high',
      payload: {
        eventType: 'session_end',
        outcome: sessionResult.outcome,
        finalState: sessionResult.finalState,
        decisions: sessionResult.decisions,
        participants: sessionResult.participants,
        summary: sessionResult.summary,
        sessionEndTime: Date.now()
      },
      metadata: {
        agentId,
        workspaceId,
        sessionId,
        sequenceNumber: this.getNextSequence(),
        correlationId: `session_${sessionId}`
      }
    };

    await this.publishMessage(WORKSPACE_KAFKA_TOPICS.SESSION_MANAGEMENT, message);
  }

  // Private Helper Methods
  private setupEventHandlers(): void {
    this.producer.on('producer.connect', () => {
      this.emit('producer_connected');
    });

    this.producer.on('producer.disconnect', () => {
      this.emit('producer_disconnected');
    });

    this.consumer.on('consumer.connect', () => {
      this.emit('consumer_connected');
    });

    this.consumer.on('consumer.disconnect', () => {
      this.emit('consumer_disconnected');
    });

    this.consumer.on('consumer.crash', (error) => {
      this.emit('error', new Error(`Consumer crashed: ${error}`));
    });
  }

  private async handleMessage(payload: EachMessagePayload): Promise<void> {
    try {
      const { topic, partition, message } = payload;

      if (!message.value) return;

      const workspaceMessage: WorkspaceKafkaMessage = JSON.parse(message.value.toString());

      // Emit event for application to handle
      this.emit('workspace_kafka_message', {
        topic,
        partition,
        offset: message.offset,
        message: workspaceMessage
      });

    } catch (error) {
      this.emit('error', new Error(`Message handling failed: ${error}`));
    }
  }

  private async publishMessage(topic: string, message: WorkspaceKafkaMessage): Promise<void> {
    try {
      await this.producer.send({
        topic,
        messages: [{
          key: message.metadata.workspaceId,
          value: JSON.stringify(message),
          timestamp: message.timestamp.toString(),
          headers: {
            messageType: message.type,
            agentId: message.metadata.agentId,
            correlationId: message.metadata.correlationId || ''
          }
        }]
      });
    } catch (error) {
      this.emit('error', new Error(`Message publish failed: ${error}`));
      throw error;
    }
  }

  private generateId(): string {
    return Math.random().toString(36).substr(2, 9);
  }

  private getNextSequence(): number {
    return ++this.sequenceNumber;
  }

  private extractConsensusRound(proposalId: string): number {
    const match = proposalId.match(/round_(\d+)/);
    return match ? parseInt(match[1]) : 1;
  }

  // Simple getter to ensure config is used (removes TS warning)
  getConfig(): KafkaWorkspaceConfig {
    return this.config;
  }

  // Simple getter to ensure isConnected is used (removes TS warning)
  getIsConnected(): boolean {
    return this.isConnected;
  }
}