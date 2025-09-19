/**
 * Infrastructure Bridge for Multi-LLM Collaborative Workspace
 *
 * Provides unified interface and graceful fallback for workspace infrastructure:
 * - Hybrid Redis (real-time) + Kafka (persistent) orchestration
 * - Graceful degradation when infrastructure is unavailable
 * - Unified event emission and coordination interface
 * - Infrastructure health monitoring and automatic failover
 *
 * Adapted from Meiosis Infrastructure Bridge pattern
 */

import { EventEmitter } from 'events';
import { RedisWorkspaceOrchestrator, RedisWorkspaceConfig } from '../orchestration/RedisWorkspaceOrchestrator';
import { KafkaWorkspaceOrchestrator, KafkaWorkspaceConfig } from '../orchestration/KafkaWorkspaceOrchestrator';

export interface WorkspaceInfrastructureConfig {
  redis: RedisWorkspaceConfig;
  kafka: KafkaWorkspaceConfig;
  fallbackMode: 'memory' | 'file' | 'disabled';
  healthCheckIntervalMs: number;
  reconnectAttempts: number;
  reconnectDelayMs: number;
}

export interface InfrastructureHealthStatus {
  redis: {
    connected: boolean;
    lastHealthCheck: number;
    errorCount: number;
    lastError?: string;
  };
  kafka: {
    connected: boolean;
    lastHealthCheck: number;
    errorCount: number;
    lastError?: string;
  };
  overall: 'healthy' | 'degraded' | 'offline';
}

export interface WorkspaceOperation {
  id: string;
  timestamp: number;
  type: 'file_operation' | 'agent_coordination' | 'consensus_action' | 'session_management';
  agentId: string;
  workspaceId: string;
  data: Record<string, any>;
  requiresPersistence: boolean;
  requiresRealtime: boolean;
}

export class WorkspaceInfrastructureBridge extends EventEmitter {
  private redisOrchestrator?: RedisWorkspaceOrchestrator;
  private kafkaOrchestrator?: KafkaWorkspaceOrchestrator;
  private config: WorkspaceInfrastructureConfig;
  private healthStatus: InfrastructureHealthStatus;
  private healthCheckInterval?: NodeJS.Timeout;
  private fallbackStorage: Map<string, any> = new Map();
  private reconnectAttempts: Map<string, number> = new Map();
  private reconnectInProgress: Set<string> = new Set();

  constructor(config: WorkspaceInfrastructureConfig) {
    super();
    this.config = config;
    this.healthStatus = {
      redis: {
        connected: false,
        lastHealthCheck: 0,
        errorCount: 0
      },
      kafka: {
        connected: false,
        lastHealthCheck: 0,
        errorCount: 0
      },
      overall: 'offline'
    };

    this.initializeOrchestrators();
  }

  async initialize(): Promise<void> {
    try {
      // Try to connect Redis first (real-time coordination)
      if (this.redisOrchestrator) {
        try {
          await this.redisOrchestrator.connect();
          this.healthStatus.redis.connected = true;
          this.emit('redis_connected');
        } catch (error) {
          this.handleRedisError(error);
        }
      }

      // Try to connect Kafka (persistent storage)
      if (this.kafkaOrchestrator) {
        try {
          await this.kafkaOrchestrator.connect();
          this.healthStatus.kafka.connected = true;
          this.emit('kafka_connected');
        } catch (error) {
          this.handleKafkaError(error);
        }
      }

      this.updateOverallHealth();
      this.startHealthChecks();
      this.emit('initialized', this.healthStatus);

    } catch (error) {
      this.emit('error', new Error(`Infrastructure initialization failed: ${error}`));
    }
  }

  async shutdown(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    try {
      if (this.redisOrchestrator) {
        await this.redisOrchestrator.disconnect();
      }
      if (this.kafkaOrchestrator) {
        await this.kafkaOrchestrator.disconnect();
      }
      this.emit('shutdown');
    } catch (error) {
      this.emit('error', new Error(`Infrastructure shutdown failed: ${error}`));
    }
  }

  // File Locking Operations
  async requestFileLock(
    agentId: string,
    workspaceId: string,
    filePath: string,
    lockType: 'read' | 'write' | 'exclusive'
  ): Promise<string | null> {
    const operation: WorkspaceOperation = {
      id: this.generateOperationId(),
      timestamp: Date.now(),
      type: 'file_operation',
      agentId,
      workspaceId,
      data: { action: 'request_lock', filePath, lockType },
      requiresPersistence: true,
      requiresRealtime: true
    };

    // Try Redis first for real-time coordination
    if (this.healthStatus.redis.connected && this.redisOrchestrator) {
      try {
        const lockId = await this.redisOrchestrator.requestFileLock(agentId, workspaceId, filePath, lockType);

        // Log to Kafka for audit trail
        if (lockId && this.healthStatus.kafka.connected && this.kafkaOrchestrator) {
          await this.kafkaOrchestrator.logFileEdit(agentId, workspaceId, this.generateSessionId(), filePath, {
            operation: 'update',
            reason: `Lock acquired: ${lockType}`
          });
        }

        await this.emitOperation(operation);
        return lockId;
      } catch (error) {
        this.handleRedisError(error);
      }
    }

    // Fallback to memory-based locking
    return this.fallbackFileLock(agentId, workspaceId, filePath, lockType);
  }

  async releaseFileLock(lockId: string, agentId: string): Promise<boolean> {
    const operation: WorkspaceOperation = {
      id: this.generateOperationId(),
      timestamp: Date.now(),
      type: 'file_operation',
      agentId,
      workspaceId: this.extractWorkspaceFromLock(lockId),
      data: { action: 'release_lock', lockId },
      requiresPersistence: true,
      requiresRealtime: true
    };

    // Try Redis first
    if (this.healthStatus.redis.connected && this.redisOrchestrator) {
      try {
        const released = await this.redisOrchestrator.releaseFileLock(lockId, agentId);

        // Log to Kafka
        if (released && this.healthStatus.kafka.connected && this.kafkaOrchestrator) {
          await this.kafkaOrchestrator.logFileEdit(agentId, operation.workspaceId, this.generateSessionId(), '', {
            operation: 'update',
            reason: 'Lock released'
          });
        }

        await this.emitOperation(operation);
        return released;
      } catch (error) {
        this.handleRedisError(error);
      }
    }

    // Fallback to memory
    return this.fallbackLockRelease(lockId, agentId);
  }

  // File Edit Operations
  async publishFileEdit(
    agentId: string,
    workspaceId: string,
    filePath: string,
    editData: {
      operation: 'create' | 'update' | 'delete';
      content?: string;
      patch?: string;
      startLine?: number;
      endLine?: number;
      previousContent?: string;
    }
  ): Promise<void> {
    const operation: WorkspaceOperation = {
      id: this.generateOperationId(),
      timestamp: Date.now(),
      type: 'file_operation',
      agentId,
      workspaceId,
      data: { action: 'file_edit', filePath, ...editData },
      requiresPersistence: true,
      requiresRealtime: true
    };

    // Redis for real-time notifications
    if (this.healthStatus.redis.connected && this.redisOrchestrator) {
      try {
        await this.redisOrchestrator.publishFileEdit(agentId, workspaceId, filePath, editData);
      } catch (error) {
        this.handleRedisError(error);
      }
    }

    // Kafka for persistent audit trail
    if (this.healthStatus.kafka.connected && this.kafkaOrchestrator) {
      try {
        await this.kafkaOrchestrator.logFileEdit(
          agentId,
          workspaceId,
          this.generateSessionId(),
          filePath,
          {
            operation: editData.operation,
            ...(editData.previousContent !== undefined && { previousContent: editData.previousContent }),
            ...(editData.content !== undefined && { newContent: editData.content }),
            ...(editData.patch !== undefined && { patch: editData.patch }),
            ...(editData.startLine !== undefined && { startLine: editData.startLine }),
            ...(editData.endLine !== undefined && { endLine: editData.endLine })
          }
        );
      } catch (error) {
        this.handleKafkaError(error);
      }
    }

    await this.emitOperation(operation);
  }

  // Agent Coordination
  async registerAgent(
    agentId: string,
    workspaceId: string,
    agentInfo: {
      name: string;
      model: string;
      capabilities: string[];
    }
  ): Promise<void> {
    const operation: WorkspaceOperation = {
      id: this.generateOperationId(),
      timestamp: Date.now(),
      type: 'agent_coordination',
      agentId,
      workspaceId,
      data: { action: 'register_agent', ...agentInfo },
      requiresPersistence: true,
      requiresRealtime: true
    };

    // Redis for real-time agent registry
    if (this.healthStatus.redis.connected && this.redisOrchestrator) {
      try {
        await this.redisOrchestrator.registerAgent(agentId, { ...agentInfo, workspaceId });
      } catch (error) {
        this.handleRedisError(error);
      }
    }

    // Kafka for agent coordination logging
    if (this.healthStatus.kafka.connected && this.kafkaOrchestrator) {
      try {
        await this.kafkaOrchestrator.logAgentCoordination(
          agentId,
          workspaceId,
          this.generateSessionId(),
          {
            type: 'synchronization',
            task: 'agent_registration',
            priority: 'medium'
          }
        );
      } catch (error) {
        this.handleKafkaError(error);
      }
    }

    await this.emitOperation(operation);
  }

  async updateAgentStatus(
    agentId: string,
    workspaceId: string,
    status: 'active' | 'busy' | 'idle' | 'offline',
    currentTask?: string
  ): Promise<void> {
    const operation: WorkspaceOperation = {
      id: this.generateOperationId(),
      timestamp: Date.now(),
      type: 'agent_coordination',
      agentId,
      workspaceId,
      data: { action: 'update_status', status, currentTask },
      requiresPersistence: false,
      requiresRealtime: true
    };

    // Redis for real-time status updates
    if (this.healthStatus.redis.connected && this.redisOrchestrator) {
      try {
        await this.redisOrchestrator.updateAgentStatus(agentId, workspaceId, status, currentTask);
      } catch (error) {
        this.handleRedisError(error);
      }
    }

    await this.emitOperation(operation);
  }

  // Consensus Operations
  async publishConsensusVote(
    agentId: string,
    workspaceId: string,
    proposalId: string,
    vote: 'agree' | 'disagree' | 'abstain',
    reasoning?: string
  ): Promise<void> {
    const operation: WorkspaceOperation = {
      id: this.generateOperationId(),
      timestamp: Date.now(),
      type: 'consensus_action',
      agentId,
      workspaceId,
      data: { action: 'vote', proposalId, vote, reasoning },
      requiresPersistence: true,
      requiresRealtime: true
    };

    // Redis for real-time voting coordination
    if (this.healthStatus.redis.connected && this.redisOrchestrator) {
      try {
        await this.redisOrchestrator.publishConsensusVote(agentId, workspaceId, proposalId, vote, reasoning);
      } catch (error) {
        this.handleRedisError(error);
      }
    }

    await this.emitOperation(operation);
  }

  async logConsensusDecision(
    agentId: string,
    workspaceId: string,
    decision: {
      proposalId: string;
      description: string;
      votes: Record<string, { vote: 'agree' | 'disagree' | 'abstain'; reasoning?: string }>;
      finalDecision: 'approved' | 'rejected' | 'deferred';
      consensusMethod: 'majority' | 'weighted' | 'unanimous' | 'delegate';
    }
  ): Promise<void> {
    const operation: WorkspaceOperation = {
      id: this.generateOperationId(),
      timestamp: Date.now(),
      type: 'consensus_action',
      agentId,
      workspaceId,
      data: { action: 'log_decision', ...decision },
      requiresPersistence: true,
      requiresRealtime: false
    };

    // Kafka for persistent decision logging
    if (this.healthStatus.kafka.connected && this.kafkaOrchestrator) {
      try {
        await this.kafkaOrchestrator.logConsensusDecision(
          agentId,
          workspaceId,
          this.generateSessionId(),
          decision
        );
      } catch (error) {
        this.handleKafkaError(error);
      }
    }

    await this.emitOperation(operation);
  }

  // Workspace Management
  async saveWorkspaceSnapshot(
    agentId: string,
    workspaceId: string,
    snapshot: {
      files: Record<string, string>;
      metadata: Record<string, any>;
      activeAgents: string[];
      consensus: Record<string, any>;
    }
  ): Promise<void> {
    const operation: WorkspaceOperation = {
      id: this.generateOperationId(),
      timestamp: Date.now(),
      type: 'session_management',
      agentId,
      workspaceId,
      data: { action: 'save_snapshot', ...snapshot },
      requiresPersistence: true,
      requiresRealtime: false
    };

    // Kafka for persistent snapshots
    if (this.healthStatus.kafka.connected && this.kafkaOrchestrator) {
      try {
        await this.kafkaOrchestrator.saveWorkspaceSnapshot(
          agentId,
          workspaceId,
          this.generateSessionId(),
          { ...snapshot, reason: 'periodic_snapshot' }
        );
      } catch (error) {
        this.handleKafkaError(error);
      }
    }

    await this.emitOperation(operation);
  }

  // Health and Status
  getHealthStatus(): InfrastructureHealthStatus {
    return { ...this.healthStatus };
  }

  isHealthy(): boolean {
    return this.healthStatus.overall === 'healthy';
  }

  isDegraded(): boolean {
    return this.healthStatus.overall === 'degraded';
  }

  // Private Implementation
  private initializeOrchestrators(): void {
    // Initialize Redis orchestrator
    try {
      this.redisOrchestrator = new RedisWorkspaceOrchestrator(this.config.redis);
      this.setupRedisEventHandlers();
    } catch (error) {
      this.emit('error', new Error(`Redis orchestrator initialization failed: ${error}`));
    }

    // Initialize Kafka orchestrator
    try {
      this.kafkaOrchestrator = new KafkaWorkspaceOrchestrator(this.config.kafka);
      this.setupKafkaEventHandlers();
    } catch (error) {
      this.emit('error', new Error(`Kafka orchestrator initialization failed: ${error}`));
    }
  }

  private setupRedisEventHandlers(): void {
    if (!this.redisOrchestrator) return;

    this.redisOrchestrator.on('connected', () => {
      this.healthStatus.redis.connected = true;
      this.healthStatus.redis.errorCount = 0;
      this.reconnectAttempts.set('redis', 0);
      this.updateOverallHealth();
      this.emit('redis_connected');
    });

    this.redisOrchestrator.on('disconnected', () => {
      this.healthStatus.redis.connected = false;
      this.updateOverallHealth();
      this.emit('redis_disconnected');
    });

    this.redisOrchestrator.on('error', (error) => {
      this.handleRedisError(error);
    });

    this.redisOrchestrator.on('workspace_message', (data) => {
      this.emit('redis_message', data);
    });

    this.redisOrchestrator.on('lock_retry', (request) => {
      this.emit('lock_retry', request);
    });
  }

  private setupKafkaEventHandlers(): void {
    if (!this.kafkaOrchestrator) return;

    this.kafkaOrchestrator.on('connected', () => {
      this.healthStatus.kafka.connected = true;
      this.healthStatus.kafka.errorCount = 0;
      this.reconnectAttempts.set('kafka', 0);
      this.updateOverallHealth();
      this.emit('kafka_connected');
    });

    this.kafkaOrchestrator.on('disconnected', () => {
      this.healthStatus.kafka.connected = false;
      this.updateOverallHealth();
      this.emit('kafka_disconnected');
    });

    this.kafkaOrchestrator.on('error', (error) => {
      this.handleKafkaError(error);
    });

    this.kafkaOrchestrator.on('workspace_kafka_message', (data) => {
      this.emit('kafka_message', data);
    });
  }

  private handleRedisError(error: any): void {
    this.healthStatus.redis.connected = false;
    this.healthStatus.redis.errorCount++;
    this.healthStatus.redis.lastError = error.message;
    this.updateOverallHealth();
    this.emit('redis_error', error);
    this.attemptReconnect('redis');
  }

  private handleKafkaError(error: any): void {
    this.healthStatus.kafka.connected = false;
    this.healthStatus.kafka.errorCount++;
    this.healthStatus.kafka.lastError = error.message;
    this.updateOverallHealth();
    this.emit('kafka_error', error);
    this.attemptReconnect('kafka');
  }

  private updateOverallHealth(): void {
    const redisHealth = this.healthStatus.redis.connected;
    const kafkaHealth = this.healthStatus.kafka.connected;

    if (redisHealth && kafkaHealth) {
      this.healthStatus.overall = 'healthy';
    } else if (redisHealth || kafkaHealth) {
      this.healthStatus.overall = 'degraded';
    } else {
      this.healthStatus.overall = 'offline';
    }

    this.emit('health_changed', this.healthStatus);
  }

  private startHealthChecks(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.config.healthCheckIntervalMs);
  }

  private async performHealthCheck(): Promise<void> {
    const now = Date.now();

    // Update health check timestamps
    this.healthStatus.redis.lastHealthCheck = now;
    this.healthStatus.kafka.lastHealthCheck = now;

    // Health checks would go here (ping Redis, check Kafka topics, etc.)
    // For now, we rely on connection event handlers
  }

  private attemptReconnect(service: 'redis' | 'kafka'): void {
    // Prevent multiple concurrent reconnection attempts
    if (this.reconnectInProgress.has(service)) {
      return;
    }

    const attempts = this.reconnectAttempts.get(service) || 0;

    if (attempts >= this.config.reconnectAttempts) {
      this.emit('reconnect_failed', service);
      return;
    }

    this.reconnectAttempts.set(service, attempts + 1);
    this.reconnectInProgress.add(service);

    setTimeout(async () => {
      try {
        if (service === 'redis' && this.redisOrchestrator) {
          await this.redisOrchestrator.connect();
        } else if (service === 'kafka' && this.kafkaOrchestrator) {
          await this.kafkaOrchestrator.connect();
        }
      } catch (error) {
        this.emit('reconnect_attempt_failed', { service, attempts: attempts + 1, error });
        // Schedule next attempt if we haven't exceeded max attempts
        if (attempts + 1 < this.config.reconnectAttempts) {
          this.reconnectInProgress.delete(service);
          this.attemptReconnect(service);
        }
      } finally {
        this.reconnectInProgress.delete(service);
      }
    }, this.config.reconnectDelayMs * (attempts + 1)); // Exponential backoff
  }

  private async emitOperation(operation: WorkspaceOperation): Promise<void> {
    this.emit('workspace_operation', operation);
  }

  // Fallback implementations
  private fallbackFileLock(
    agentId: string,
    workspaceId: string,
    filePath: string,
    lockType: string
  ): string | null {
    const lockKey = `${workspaceId}:${filePath}`;
    const existingLock = this.fallbackStorage.get(lockKey);

    if (existingLock) {
      // Simple conflict detection
      if (lockType === 'read' && existingLock.lockType === 'read') {
        existingLock.readers = existingLock.readers || [];
        existingLock.readers.push(agentId);
        this.fallbackStorage.set(lockKey, existingLock);
        return `${lockKey}:readers:${agentId}`;
      }
      return null; // Conflict
    }

    // Create new lock
    const lock = {
      agentId,
      lockType,
      timestamp: Date.now(),
      workspaceId,
      filePath
    };

    this.fallbackStorage.set(lockKey, lock);
    return lockKey;
  }

  private fallbackLockRelease(lockId: string, agentId: string): boolean {
    if (lockId.includes(':readers:')) {
      const baseKey = lockId.replace(/:readers:.*$/, '');
      const lock = this.fallbackStorage.get(baseKey);
      if (lock && lock.readers) {
        lock.readers = lock.readers.filter((id: string) => id !== agentId);
        if (lock.readers.length === 0) {
          this.fallbackStorage.delete(baseKey);
        } else {
          this.fallbackStorage.set(baseKey, lock);
        }
        return true;
      }
    } else {
      const lock = this.fallbackStorage.get(lockId);
      if (lock && lock.agentId === agentId) {
        this.fallbackStorage.delete(lockId);
        return true;
      }
    }
    return false;
  }

  private generateOperationId(): string {
    return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private extractWorkspaceFromLock(lockId: string): string {
    const parts = lockId.split(':');
    return parts.length > 1 ? parts[1] : 'unknown';
  }
}