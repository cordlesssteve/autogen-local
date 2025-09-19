/**
 * Redis Streams Orchestration Layer for Multi-LLM Collaborative Workspace
 *
 * Provides real-time coordination for AutoGen multi-agent workspace:
 * - Workspace file locking and coordination
 * - Live LLM agent status and heartbeats
 * - Real-time edit notifications and conflict detection
 * - Fast in-memory workspace state management
 *
 * Adapted from Meiosis Redis orchestration infrastructure
 */

import { Redis } from 'ioredis';
import { EventEmitter } from 'events';

export interface WorkspaceStreamMessage {
  id: string;
  timestamp: number;
  type: 'file_lock' | 'file_edit' | 'agent_status' | 'workspace_event' | 'consensus_vote';
  source: string;
  target?: string;
  priority: 'high' | 'medium' | 'low';
  payload: Record<string, any>;
  metadata: {
    agentId: string;
    workspaceId: string;
    filePath?: string;
    lockType?: 'read' | 'write' | 'exclusive';
    correlationId?: string;
    retryCount?: number;
  };
}

export interface RedisWorkspaceConfig {
  host: string;
  port: number;
  password?: string;
  db: number;
  streamPrefix: string;
  consumerGroup: string;
  consumerName: string;
  maxPendingMessages: number;
  heartbeatIntervalMs: number;
  lockTimeoutMs: number;
  messageRetentionMs: number;
}

export const WORKSPACE_STREAM_PATTERNS = {
  // Workspace Coordination Streams
  FILE_LOCKS: 'autogen:locks',
  FILE_EDITS: 'autogen:edits',
  AGENT_STATUS: 'autogen:agents',
  WORKSPACE_EVENTS: 'autogen:workspace',
  CONSENSUS_VOTES: 'autogen:consensus',

  // State Management Keys
  ACTIVE_LOCKS: 'autogen:state:locks',
  WORKSPACE_STATE: 'autogen:state:workspace',
  AGENT_REGISTRY: 'autogen:state:agents',
  EDIT_QUEUE: 'autogen:state:edit_queue'
};

export class RedisWorkspaceOrchestrator extends EventEmitter {
  private redis: Redis;
  private config: RedisWorkspaceConfig;
  private isConnected: boolean = false;
  private heartbeatInterval?: NodeJS.Timeout;
  private streamConsumers: Map<string, NodeJS.Timeout> = new Map();

  constructor(config: RedisWorkspaceConfig) {
    super();
    this.config = config;
    this.redis = new Redis({
      host: config.host,
      port: config.port,
      db: config.db,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      ...(config.password !== undefined && { password: config.password })
    });

    this.setupEventHandlers();
  }

  async connect(): Promise<void> {
    // Check if already connected or connecting
    if (this.redis.status === 'ready') {
      return; // Already connected
    }

    if (this.redis.status === 'connecting') {
      // Wait for existing connection attempt to complete
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout waiting for existing connection'));
        }, 10000); // 10 second timeout

        this.redis.once('ready', () => {
          clearTimeout(timeout);
          resolve();
        });

        this.redis.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    }

    try {
      await this.redis.connect();
      this.isConnected = true;
      await this.initializeStreams();
      this.startHeartbeat();
      this.startStreamConsumers();
      this.emit('connected');
    } catch (error) {
      this.emit('error', new Error(`Redis connection failed: ${error}`));
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.isConnected = false;

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Stop stream consumers
    for (const [, interval] of this.streamConsumers) {
      clearInterval(interval);
    }
    this.streamConsumers.clear();

    await this.redis.disconnect();
    this.emit('disconnected');
  }

  // File Locking Operations
  async requestFileLock(
    agentId: string,
    workspaceId: string,
    filePath: string,
    lockType: 'read' | 'write' | 'exclusive'
  ): Promise<string | null> {
    const lockKey = `${WORKSPACE_STREAM_PATTERNS.ACTIVE_LOCKS}:${workspaceId}:${filePath}`;
    const lockValue = JSON.stringify({
      agentId,
      lockType,
      timestamp: Date.now(),
      workspaceId,
      filePath
    });

    try {
      // Check for existing locks
      const existingLock = await this.redis.get(lockKey);
      if (existingLock) {
        const lock = JSON.parse(existingLock);

        // Allow multiple read locks
        if (lockType === 'read' && lock.lockType === 'read') {
          const readLocks = await this.redis.sadd(`${lockKey}:readers`, agentId);
          if (readLocks) {
            await this.publishLockEvent('lock_acquired', agentId, workspaceId, filePath, lockType);
            return `${lockKey}:readers:${agentId}`;
          }
        }

        // Conflict - queue the request
        await this.queueLockRequest(agentId, workspaceId, filePath, lockType);
        return null;
      }

      // Acquire new lock
      if (lockType === 'read') {
        // For read locks, use a set to track readers
        await this.redis.sadd(`${lockKey}:readers`, agentId);
        await this.redis.set(lockKey, lockValue, 'PX', this.config.lockTimeoutMs);
        await this.publishLockEvent('lock_acquired', agentId, workspaceId, filePath, lockType);
        return `${lockKey}:readers:${agentId}`;
      } else {
        // For write/exclusive locks, use standard locking
        const acquired = await this.redis.set(
          lockKey,
          lockValue,
          'PX',
          this.config.lockTimeoutMs,
          'NX'
        );

        if (acquired === 'OK') {
          await this.publishLockEvent('lock_acquired', agentId, workspaceId, filePath, lockType);
          return lockKey;
        }
      }

      return null;
    } catch (error) {
      this.emit('error', new Error(`Lock request failed: ${error}`));
      return null;
    }
  }

  async releaseFileLock(lockId: string, agentId: string): Promise<boolean> {
    try {
      // Handle read lock release
      if (lockId.includes(':readers:')) {
        const baseKey = lockId.replace(/:readers:.*$/, '');
        const removed = await this.redis.srem(`${baseKey}:readers`, agentId);

        // Check if this was the last reader
        const remainingReaders = await this.redis.scard(`${baseKey}:readers`);
        if (remainingReaders === 0) {
          await this.redis.del(`${baseKey}:readers`);
          await this.redis.del(baseKey);
        }

        if (removed) {
          await this.publishLockEvent('lock_released', agentId, '', '', 'read');
          await this.processLockQueue(baseKey);
        }
        return removed > 0;
      }

      // Handle exclusive lock release
      const lockInfo = await this.redis.get(lockId);
      if (lockInfo) {
        const lock = JSON.parse(lockInfo);
        if (lock.agentId === agentId) {
          await this.redis.del(lockId);
          await this.publishLockEvent('lock_released', agentId, lock.workspaceId, lock.filePath, lock.lockType);
          await this.processLockQueue(lockId);
          return true;
        }
      }

      return false;
    } catch (error) {
      this.emit('error', new Error(`Lock release failed: ${error}`));
      return false;
    }
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
    }
  ): Promise<void> {
    const message: WorkspaceStreamMessage = {
      id: `edit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      type: 'file_edit',
      source: agentId,
      priority: 'high',
      payload: {
        operation: editData.operation,
        content: editData.content,
        patch: editData.patch,
        startLine: editData.startLine,
        endLine: editData.endLine
      },
      metadata: {
        agentId,
        workspaceId,
        filePath,
        correlationId: `edit_${workspaceId}_${Date.now()}`
      }
    };

    await this.publishToStream(WORKSPACE_STREAM_PATTERNS.FILE_EDITS, message);
  }

  // Agent Status Management
  async registerAgent(agentId: string, agentInfo: {
    name: string;
    model: string;
    capabilities: string[];
    workspaceId: string;
  }): Promise<void> {
    const agentKey = `${WORKSPACE_STREAM_PATTERNS.AGENT_REGISTRY}:${agentId}`;
    const agentData = {
      ...agentInfo,
      registeredAt: Date.now(),
      lastHeartbeat: Date.now(),
      status: 'active'
    };

    await this.redis.hset(agentKey, agentData);
    await this.publishAgentEvent('agent_registered', agentId, agentInfo.workspaceId, agentData);
  }

  async updateAgentStatus(
    agentId: string,
    workspaceId: string,
    status: 'active' | 'busy' | 'idle' | 'offline',
    currentTask?: string
  ): Promise<void> {
    const agentKey = `${WORKSPACE_STREAM_PATTERNS.AGENT_REGISTRY}:${agentId}`;
    await this.redis.hset(agentKey, {
      status,
      lastHeartbeat: Date.now(),
      currentTask: currentTask || ''
    });

    await this.publishAgentEvent('status_update', agentId, workspaceId, { status, currentTask });
  }

  // Consensus Operations
  async publishConsensusVote(
    agentId: string,
    workspaceId: string,
    proposalId: string,
    vote: 'agree' | 'disagree' | 'abstain',
    reasoning?: string
  ): Promise<void> {
    const message: WorkspaceStreamMessage = {
      id: `vote_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      type: 'consensus_vote',
      source: agentId,
      priority: 'medium',
      payload: {
        proposalId,
        vote,
        reasoning
      },
      metadata: {
        agentId,
        workspaceId,
        correlationId: `consensus_${proposalId}`
      }
    };

    await this.publishToStream(WORKSPACE_STREAM_PATTERNS.CONSENSUS_VOTES, message);
  }

  // Private Helper Methods
  private setupEventHandlers(): void {
    this.redis.on('error', (error) => {
      this.emit('error', new Error(`Redis error: ${error}`));
    });

    this.redis.on('reconnecting', () => {
      this.emit('reconnecting');
    });
  }

  private async initializeStreams(): Promise<void> {
    const streams = Object.values(WORKSPACE_STREAM_PATTERNS).filter(s => s.includes(':'));

    for (const streamName of streams) {
      try {
        // Create consumer group if it doesn't exist
        await this.redis.xgroup(
          'CREATE',
          streamName,
          this.config.consumerGroup,
          '$',
          'MKSTREAM'
        );
      } catch (error) {
        // Group might already exist, that's okay
        if (!(error as Error).message.includes('BUSYGROUP')) {
          this.emit('error', new Error(`Stream initialization failed: ${error}`));
        }
      }
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(async () => {
      if (this.isConnected) {
        try {
          await this.redis.set(
            `${this.config.streamPrefix}:heartbeat:${this.config.consumerName}`,
            Date.now(),
            'EX',
            Math.floor(this.config.heartbeatIntervalMs / 1000) * 2
          );
        } catch (error) {
          this.emit('error', new Error(`Heartbeat failed: ${error}`));
        }
      }
    }, this.config.heartbeatIntervalMs);
  }

  private startStreamConsumers(): void {
    const streams = [
      WORKSPACE_STREAM_PATTERNS.FILE_LOCKS,
      WORKSPACE_STREAM_PATTERNS.FILE_EDITS,
      WORKSPACE_STREAM_PATTERNS.AGENT_STATUS,
      WORKSPACE_STREAM_PATTERNS.CONSENSUS_VOTES
    ];

    for (const streamName of streams) {
      const consumer = setInterval(async () => {
        await this.consumeStream(streamName);
      }, 100); // 100ms polling

      this.streamConsumers.set(streamName, consumer);
    }
  }

  private async consumeStream(streamName: string): Promise<void> {
    if (!this.isConnected) return;

    try {
      const messages = await this.redis.xreadgroup(
        'GROUP',
        this.config.consumerGroup,
        this.config.consumerName,
        'COUNT',
        10,
        'BLOCK',
        100,
        'STREAMS',
        streamName,
        '>'
      );

      if (messages && Array.isArray(messages) && messages.length > 0) {
        for (const [stream, streamMessages] of messages as [string, [string, string[]][]][]) {
          for (const [messageId, fields] of streamMessages) {
            await this.processStreamMessage(stream, messageId, fields);
          }
        }
      }
    } catch (error) {
      if (!(error as Error).message.includes('NOGROUP')) {
        this.emit('error', new Error(`Stream consumption failed: ${error}`));
      }
    }
  }

  private async processStreamMessage(
    streamName: string,
    messageId: string,
    fields: string[]
  ): Promise<void> {
    try {
      // Convert Redis stream fields to message object
      const messageData: Record<string, string> = {};
      for (let i = 0; i < fields.length; i += 2) {
        messageData[fields[i]] = fields[i + 1];
      }

      const message: WorkspaceStreamMessage = JSON.parse(messageData.data || '{}');

      // Emit event for application to handle
      this.emit('workspace_message', {
        streamName,
        messageId,
        message
      });

      // Acknowledge message
      await this.redis.xack(streamName, this.config.consumerGroup, messageId);
    } catch (error) {
      this.emit('error', new Error(`Message processing failed: ${error}`));
    }
  }

  private async publishToStream(streamName: string, message: WorkspaceStreamMessage): Promise<void> {
    try {
      await this.redis.xadd(
        streamName,
        '*',
        'data', JSON.stringify(message),
        'timestamp', message.timestamp,
        'type', message.type,
        'source', message.source
      );
    } catch (error) {
      this.emit('error', new Error(`Stream publish failed: ${error}`));
    }
  }

  private async publishLockEvent(
    eventType: string,
    agentId: string,
    workspaceId: string,
    filePath: string,
    lockType: string
  ): Promise<void> {
    const message: WorkspaceStreamMessage = {
      id: `lock_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      type: 'file_lock',
      source: agentId,
      priority: 'high',
      payload: {
        eventType,
        lockType
      },
      metadata: {
        agentId,
        workspaceId,
        filePath,
        lockType: lockType as any
      }
    };

    await this.publishToStream(WORKSPACE_STREAM_PATTERNS.FILE_LOCKS, message);
  }

  private async publishAgentEvent(
    eventType: string,
    agentId: string,
    workspaceId: string,
    agentData: Record<string, any>
  ): Promise<void> {
    const message: WorkspaceStreamMessage = {
      id: `agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      type: 'agent_status',
      source: agentId,
      priority: 'medium',
      payload: {
        eventType,
        ...agentData
      },
      metadata: {
        agentId,
        workspaceId
      }
    };

    await this.publishToStream(WORKSPACE_STREAM_PATTERNS.AGENT_STATUS, message);
  }

  private async queueLockRequest(
    agentId: string,
    workspaceId: string,
    filePath: string,
    lockType: string
  ): Promise<void> {
    const queueKey = `${WORKSPACE_STREAM_PATTERNS.EDIT_QUEUE}:${workspaceId}:${filePath}`;
    const request = JSON.stringify({
      agentId,
      lockType,
      timestamp: Date.now(),
      workspaceId,
      filePath
    });

    await this.redis.lpush(queueKey, request);
  }

  private async processLockQueue(lockKey: string): Promise<void> {
    // Extract workspace and file info from lock key
    const parts = lockKey.split(':');
    if (parts.length < 4) return;

    const workspaceId = parts[2];
    const filePath = parts.slice(3).join(':');
    const queueKey = `${WORKSPACE_STREAM_PATTERNS.EDIT_QUEUE}:${workspaceId}:${filePath}`;

    // Process next queued request
    const nextRequest = await this.redis.rpop(queueKey);
    if (nextRequest) {
      const request = JSON.parse(nextRequest);
      // Emit event for application to retry lock acquisition
      this.emit('lock_retry', request);
    }
  }

  // Enhanced connection status methods
  getIsConnected(): boolean {
    return this.isConnected && this.redis.status === 'ready';
  }

  getConnectionStatus(): string {
    return this.redis.status;
  }
}