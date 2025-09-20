/**
 * Configuration Management for Multi-LLM Collaborative Workspace
 *
 * Centralized configuration for all workspace infrastructure components:
 * - Redis and Kafka connection settings
 * - Workspace behavior and limits
 * - Agent coordination parameters
 * - Consensus mechanism configuration
 */

import { RedisWorkspaceConfig } from '../infrastructure/orchestration/RedisWorkspaceOrchestrator';
import { KafkaWorkspaceConfig } from '../infrastructure/orchestration/KafkaWorkspaceOrchestrator';
import { WorkspaceInfrastructureConfig } from '../infrastructure/integration/WorkspaceInfrastructureBridge';

export interface WorkspaceLimits {
  maxAgentsPerWorkspace: number;
  maxFilesPerWorkspace: number;
  maxFileSizeBytes: number;
  maxConcurrentEdits: number;
  maxSessionDurationMs: number;
  lockTimeoutMs: number;
  consensusTimeoutMs: number;
}

export interface ConsensusConfig {
  defaultMethod: 'majority' | 'weighted' | 'unanimous' | 'delegate';
  majorityThreshold: number; // 0.5 = 50%, 0.67 = 67%, etc.
  weightingStrategy: 'equal' | 'capability' | 'model_based' | 'experience';
  voteTimeoutMs: number;
  maxConsensusRounds: number;
  deadlockResolution: 'escalate' | 'random' | 'delegate_to_human';
}

export interface AgentCoordinationConfig {
  heartbeatIntervalMs: number;
  taskTimeoutMs: number;
  maxRetryAttempts: number;
  coordinationStrategy: 'round_robin' | 'capability_based' | 'load_balanced';
  conflictResolutionStrategy: 'queue' | 'priority' | 'negotiate';
}

export interface WorkspaceSecurityConfig {
  enableFileLocking: boolean;
  enableEditHistory: boolean;
  enableAuditLogging: boolean;
  maxLockDurationMs: number;
  allowConcurrentReads: boolean;
  requireAgentAuthentication: boolean;
}

export interface WorkspaceConfiguration {
  // Infrastructure
  infrastructure: WorkspaceInfrastructureConfig;

  // Workspace Behavior
  limits: WorkspaceLimits;
  security: WorkspaceSecurityConfig;

  // Agent Coordination
  agentCoordination: AgentCoordinationConfig;
  consensus: ConsensusConfig;

  // Workspace Storage
  workspaceRoot: string;
  tempDirectory: string;
  exportDirectory: string;
  snapshotIntervalMs: number;

  // Development/Debug
  enableDebugLogging: boolean;
  enableMetrics: boolean;
  metricsPort?: number;
}

export class WorkspaceConfigBuilder {
  private config: Partial<WorkspaceConfiguration> = {};

  // Infrastructure Configuration
  withRedis(redisConfig: Partial<RedisWorkspaceConfig>): WorkspaceConfigBuilder {
    if (!this.config.infrastructure) {
      this.config.infrastructure = {} as WorkspaceInfrastructureConfig;
    }

    this.config.infrastructure.redis = {
      host: redisConfig.host || 'localhost',
      port: redisConfig.port || 6379,
      db: redisConfig.db || 0,
      streamPrefix: redisConfig.streamPrefix || 'autogen',
      consumerGroup: redisConfig.consumerGroup || 'autogen-workspace',
      consumerName: redisConfig.consumerName || `autogen-${Date.now()}`,
      maxPendingMessages: redisConfig.maxPendingMessages || 1000,
      heartbeatIntervalMs: redisConfig.heartbeatIntervalMs || 5000,
      lockTimeoutMs: redisConfig.lockTimeoutMs || 30000,
      messageRetentionMs: redisConfig.messageRetentionMs || 3600000, // 1 hour
      ...(redisConfig.password !== undefined && { password: redisConfig.password })
    };

    return this;
  }

  withKafka(kafkaConfig: Partial<KafkaWorkspaceConfig>): WorkspaceConfigBuilder {
    if (!this.config.infrastructure) {
      this.config.infrastructure = {} as WorkspaceInfrastructureConfig;
    }

    this.config.infrastructure.kafka = {
      clientId: kafkaConfig.clientId || 'autogen-workspace',
      brokers: kafkaConfig.brokers || ['localhost:9092'],
      ssl: kafkaConfig.ssl || false,
      groupId: kafkaConfig.groupId || 'autogen-workspace-group',
      sessionTimeoutMs: kafkaConfig.sessionTimeoutMs || 30000,
      heartbeatIntervalMs: kafkaConfig.heartbeatIntervalMs || 3000,
      retrySettings: kafkaConfig.retrySettings || {
        initialRetryTime: 100,
        retries: 8,
        maxRetryTime: 30000
      },
      batchSettings: kafkaConfig.batchSettings || {
        batchSize: 16384,
        lingerMs: 5
      },
      ...(kafkaConfig.sasl !== undefined && { sasl: kafkaConfig.sasl })
    };

    return this;
  }

  withInfrastructureDefaults(): WorkspaceConfigBuilder {
    if (!this.config.infrastructure) {
      this.config.infrastructure = {} as WorkspaceInfrastructureConfig;
    }

    this.config.infrastructure.fallbackMode = 'memory';
    this.config.infrastructure.healthCheckIntervalMs = 10000;
    this.config.infrastructure.reconnectAttempts = 5;
    this.config.infrastructure.reconnectDelayMs = 1000;

    return this;
  }

  // Workspace Behavior Configuration
  withLimits(limits: Partial<WorkspaceLimits>): WorkspaceConfigBuilder {
    this.config.limits = {
      maxAgentsPerWorkspace: limits.maxAgentsPerWorkspace || 10,
      maxFilesPerWorkspace: limits.maxFilesPerWorkspace || 100,
      maxFileSizeBytes: limits.maxFileSizeBytes || 10 * 1024 * 1024, // 10MB
      maxConcurrentEdits: limits.maxConcurrentEdits || 5,
      maxSessionDurationMs: limits.maxSessionDurationMs || 2 * 60 * 60 * 1000, // 2 hours
      lockTimeoutMs: limits.lockTimeoutMs || 30000,
      consensusTimeoutMs: limits.consensusTimeoutMs || 60000
    };

    return this;
  }

  withSecurity(security: Partial<WorkspaceSecurityConfig>): WorkspaceConfigBuilder {
    this.config.security = {
      enableFileLocking: security.enableFileLocking !== false, // Default true
      enableEditHistory: security.enableEditHistory !== false, // Default true
      enableAuditLogging: security.enableAuditLogging !== false, // Default true
      maxLockDurationMs: security.maxLockDurationMs || 300000, // 5 minutes
      allowConcurrentReads: security.allowConcurrentReads !== false, // Default true
      requireAgentAuthentication: security.requireAgentAuthentication || false
    };

    return this;
  }

  // Agent Coordination Configuration
  withAgentCoordination(coordination: Partial<AgentCoordinationConfig>): WorkspaceConfigBuilder {
    this.config.agentCoordination = {
      heartbeatIntervalMs: coordination.heartbeatIntervalMs || 5000,
      taskTimeoutMs: coordination.taskTimeoutMs || 120000, // 2 minutes
      maxRetryAttempts: coordination.maxRetryAttempts || 3,
      coordinationStrategy: coordination.coordinationStrategy || 'capability_based',
      conflictResolutionStrategy: coordination.conflictResolutionStrategy || 'queue'
    };

    return this;
  }

  withConsensus(consensus: Partial<ConsensusConfig>): WorkspaceConfigBuilder {
    this.config.consensus = {
      defaultMethod: consensus.defaultMethod || 'majority',
      majorityThreshold: consensus.majorityThreshold || 0.6, // 60%
      weightingStrategy: consensus.weightingStrategy || 'capability',
      voteTimeoutMs: consensus.voteTimeoutMs || 30000,
      maxConsensusRounds: consensus.maxConsensusRounds || 3,
      deadlockResolution: consensus.deadlockResolution || 'escalate'
    };

    return this;
  }

  // Storage Configuration
  withStorage(
    workspaceRoot: string,
    tempDirectory?: string,
    exportDirectory?: string
  ): WorkspaceConfigBuilder {
    this.config.workspaceRoot = workspaceRoot;
    this.config.tempDirectory = tempDirectory || `${workspaceRoot}/temp`;
    this.config.exportDirectory = exportDirectory || `${workspaceRoot}/exports`;
    this.config.snapshotIntervalMs = 60000; // 1 minute

    return this;
  }

  // Development Configuration
  withDebug(enableDebugLogging: boolean = true, enableMetrics: boolean = true, metricsPort?: number): WorkspaceConfigBuilder {
    this.config.enableDebugLogging = enableDebugLogging;
    this.config.enableMetrics = enableMetrics;
    this.config.metricsPort = metricsPort;

    return this;
  }

  // Build final configuration
  build(): WorkspaceConfiguration {
    // Ensure all required fields are present
    if (!this.config.infrastructure) {
      throw new Error('Infrastructure configuration is required');
    }

    if (!this.config.infrastructure.redis) {
      throw new Error('Redis configuration is required');
    }

    if (!this.config.infrastructure.kafka) {
      throw new Error('Kafka configuration is required');
    }

    // Apply defaults for missing configurations
    if (!this.config.limits) {
      this.withLimits({});
    }

    if (!this.config.security) {
      this.withSecurity({});
    }

    if (!this.config.agentCoordination) {
      this.withAgentCoordination({});
    }

    if (!this.config.consensus) {
      this.withConsensus({});
    }

    if (!this.config.workspaceRoot) {
      this.withStorage('./workspace');
    }

    if (this.config.enableDebugLogging === undefined) {
      this.withDebug(false, false);
    }

    return this.config as WorkspaceConfiguration;
  }
}

// Predefined configurations for common scenarios
export class WorkspaceConfigPresets {
  // Local development with minimal infrastructure
  static localDevelopment(): WorkspaceConfiguration {
    return new WorkspaceConfigBuilder()
      .withRedis({
        host: 'localhost',
        port: 6379,
        db: 1 // Use separate DB for development
      })
      .withKafka({
        brokers: ['localhost:9092'],
        clientId: 'autogen-dev'
      })
      .withInfrastructureDefaults()
      .withLimits({
        maxAgentsPerWorkspace: 5,
        maxFilesPerWorkspace: 50,
        maxSessionDurationMs: 30 * 60 * 1000 // 30 minutes
      })
      .withSecurity({
        requireAgentAuthentication: false
      })
      .withStorage('./workspace-dev')
      .withDebug(true, true, 3001)
      .build();
  }

  // Production-ready configuration with enhanced security
  static production(): WorkspaceConfiguration {
    return new WorkspaceConfigBuilder()
      .withRedis({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
        db: 0
      })
      .withKafka({
        brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
        ssl: process.env.KAFKA_SSL === 'true',
        sasl: process.env.KAFKA_USERNAME ? {
          mechanism: 'scram-sha-256' as const,
          username: process.env.KAFKA_USERNAME,
          password: process.env.KAFKA_PASSWORD || ''
        } : undefined
      })
      .withInfrastructureDefaults()
      .withLimits({
        maxAgentsPerWorkspace: 20,
        maxFilesPerWorkspace: 200,
        maxSessionDurationMs: 4 * 60 * 60 * 1000 // 4 hours
      })
      .withSecurity({
        requireAgentAuthentication: true,
        maxLockDurationMs: 600000 // 10 minutes
      })
      .withConsensus({
        defaultMethod: 'weighted',
        weightingStrategy: 'model_based',
        deadlockResolution: 'escalate'
      })
      .withStorage(process.env.WORKSPACE_ROOT || './workspace')
      .withDebug(false, true, 3000)
      .build();
  }

  // Testing configuration with fast timeouts
  static testing(): WorkspaceConfiguration {
    return new WorkspaceConfigBuilder()
      .withRedis({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6380'), // Use test Redis port by default
        db: 15, // Use high DB number for testing
        lockTimeoutMs: 5000,
        heartbeatIntervalMs: 1000
      })
      .withKafka({
        brokers: (process.env.KAFKA_BROKERS || 'localhost:9093').split(','), // Use test Kafka port by default
        clientId: 'autogen-test',
        groupId: 'autogen-test-group'
      })
      .withInfrastructureDefaults()
      .withLimits({
        maxAgentsPerWorkspace: 3,
        maxFilesPerWorkspace: 10,
        maxSessionDurationMs: 5 * 60 * 1000, // 5 minutes
        lockTimeoutMs: 5000,
        consensusTimeoutMs: 10000
      })
      .withAgentCoordination({
        heartbeatIntervalMs: 1000,
        taskTimeoutMs: 10000
      })
      .withConsensus({
        voteTimeoutMs: 5000,
        maxConsensusRounds: 2
      })
      .withStorage('./workspace-test')
      .withDebug(true, false)
      .build();
  }
}

// Configuration validation
export class WorkspaceConfigValidator {
  static validate(config: WorkspaceConfiguration): string[] {
    const errors: string[] = [];

    // Infrastructure validation
    if (!config.infrastructure.redis.host) {
      errors.push('Redis host is required');
    }

    if (!config.infrastructure.kafka.brokers || config.infrastructure.kafka.brokers.length === 0) {
      errors.push('At least one Kafka broker is required');
    }

    // Limits validation
    if (config.limits.maxAgentsPerWorkspace < 1) {
      errors.push('maxAgentsPerWorkspace must be at least 1');
    }

    if (config.consensus.majorityThreshold && (config.consensus.majorityThreshold < 0 || config.consensus.majorityThreshold > 1)) {
      errors.push('majorityThreshold must be between 0 and 1');
    }

    // Storage validation
    if (!config.workspaceRoot) {
      errors.push('workspaceRoot is required');
    }

    return errors;
  }

  static validateAndThrow(config: WorkspaceConfiguration): void {
    const errors = this.validate(config);
    if (errors.length > 0) {
      throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
    }
  }
}