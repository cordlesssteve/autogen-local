/**
 * Unit tests for WorkspaceConfig system
 */

import {
  WorkspaceConfigBuilder,
  WorkspaceConfigPresets,
  WorkspaceConfigValidator,
  WorkspaceConfiguration
} from '../../../src/config/WorkspaceConfig';

describe('WorkspaceConfig System', () => {
  describe('WorkspaceConfigBuilder', () => {
    test('should build minimal configuration', () => {
      const config = new WorkspaceConfigBuilder()
        .withRedis({ host: 'localhost', port: 6379 })
        .withKafka({ brokers: ['localhost:9092'] })
        .withInfrastructureDefaults()
        .build();

      expect(config).toBeDefined();
      expect(config.infrastructure.redis.host).toBe('localhost');
      expect(config.infrastructure.kafka.brokers).toEqual(['localhost:9092']);
      expect(config.limits.maxAgentsPerWorkspace).toBeDefined();
      expect(config.security.enableFileLocking).toBe(true);
    });

    test('should apply Redis configuration correctly', () => {
      const config = new WorkspaceConfigBuilder()
        .withRedis({
          host: 'redis.example.com',
          port: 6380,
          password: 'secret',
          db: 5,
          lockTimeoutMs: 60000
        })
        .withKafka({ brokers: ['localhost:9092'] })
        .withInfrastructureDefaults()
        .build();

      expect(config.infrastructure.redis.host).toBe('redis.example.com');
      expect(config.infrastructure.redis.port).toBe(6380);
      expect(config.infrastructure.redis.password).toBe('secret');
      expect(config.infrastructure.redis.db).toBe(5);
      expect(config.infrastructure.redis.lockTimeoutMs).toBe(60000);
    });

    test('should apply Kafka configuration correctly', () => {
      const config = new WorkspaceConfigBuilder()
        .withRedis({ host: 'localhost' })
        .withKafka({
          clientId: 'custom-client',
          brokers: ['kafka1:9092', 'kafka2:9092'],
          ssl: true,
          sasl: {
            mechanism: 'scram-sha-256',
            username: 'user',
            password: 'pass'
          },
          sessionTimeoutMs: 45000
        })
        .withInfrastructureDefaults()
        .build();

      expect(config.infrastructure.kafka.clientId).toBe('custom-client');
      expect(config.infrastructure.kafka.brokers).toEqual(['kafka1:9092', 'kafka2:9092']);
      expect(config.infrastructure.kafka.ssl).toBe(true);
      expect(config.infrastructure.kafka.sasl?.mechanism).toBe('scram-sha-256');
      expect(config.infrastructure.kafka.sasl?.username).toBe('user');
      expect(config.infrastructure.kafka.sessionTimeoutMs).toBe(45000);
    });

    test('should apply workspace limits configuration', () => {
      const config = new WorkspaceConfigBuilder()
        .withRedis({ host: 'localhost' })
        .withKafka({ brokers: ['localhost:9092'] })
        .withInfrastructureDefaults()
        .withLimits({
          maxAgentsPerWorkspace: 20,
          maxFilesPerWorkspace: 500,
          maxFileSizeBytes: 50 * 1024 * 1024, // 50MB
          maxConcurrentEdits: 10,
          lockTimeoutMs: 120000
        })
        .build();

      expect(config.limits.maxAgentsPerWorkspace).toBe(20);
      expect(config.limits.maxFilesPerWorkspace).toBe(500);
      expect(config.limits.maxFileSizeBytes).toBe(50 * 1024 * 1024);
      expect(config.limits.maxConcurrentEdits).toBe(10);
      expect(config.limits.lockTimeoutMs).toBe(120000);
    });

    test('should apply security configuration', () => {
      const config = new WorkspaceConfigBuilder()
        .withRedis({ host: 'localhost' })
        .withKafka({ brokers: ['localhost:9092'] })
        .withInfrastructureDefaults()
        .withSecurity({
          enableFileLocking: true,
          enableEditHistory: true,
          enableAuditLogging: false,
          maxLockDurationMs: 600000,
          allowConcurrentReads: false,
          requireAgentAuthentication: true
        })
        .build();

      expect(config.security.enableFileLocking).toBe(true);
      expect(config.security.enableEditHistory).toBe(true);
      expect(config.security.enableAuditLogging).toBe(false);
      expect(config.security.maxLockDurationMs).toBe(600000);
      expect(config.security.allowConcurrentReads).toBe(false);
      expect(config.security.requireAgentAuthentication).toBe(true);
    });

    test('should apply agent coordination configuration', () => {
      const config = new WorkspaceConfigBuilder()
        .withRedis({ host: 'localhost' })
        .withKafka({ brokers: ['localhost:9092'] })
        .withInfrastructureDefaults()
        .withAgentCoordination({
          heartbeatIntervalMs: 3000,
          taskTimeoutMs: 300000,
          maxRetryAttempts: 5,
          coordinationStrategy: 'load_balanced',
          conflictResolutionStrategy: 'priority'
        })
        .build();

      expect(config.agentCoordination.heartbeatIntervalMs).toBe(3000);
      expect(config.agentCoordination.taskTimeoutMs).toBe(300000);
      expect(config.agentCoordination.maxRetryAttempts).toBe(5);
      expect(config.agentCoordination.coordinationStrategy).toBe('load_balanced');
      expect(config.agentCoordination.conflictResolutionStrategy).toBe('priority');
    });

    test('should apply consensus configuration', () => {
      const config = new WorkspaceConfigBuilder()
        .withRedis({ host: 'localhost' })
        .withKafka({ brokers: ['localhost:9092'] })
        .withInfrastructureDefaults()
        .withConsensus({
          defaultMethod: 'weighted',
          majorityThreshold: 0.75,
          weightingStrategy: 'model_based',
          voteTimeoutMs: 45000,
          maxConsensusRounds: 5,
          deadlockResolution: 'delegate_to_human'
        })
        .build();

      expect(config.consensus.defaultMethod).toBe('weighted');
      expect(config.consensus.majorityThreshold).toBe(0.75);
      expect(config.consensus.weightingStrategy).toBe('model_based');
      expect(config.consensus.voteTimeoutMs).toBe(45000);
      expect(config.consensus.maxConsensusRounds).toBe(5);
      expect(config.consensus.deadlockResolution).toBe('delegate_to_human');
    });

    test('should apply storage configuration', () => {
      const config = new WorkspaceConfigBuilder()
        .withRedis({ host: 'localhost' })
        .withKafka({ brokers: ['localhost:9092'] })
        .withInfrastructureDefaults()
        .withStorage(
          '/custom/workspace',
          '/custom/temp',
          '/custom/exports'
        )
        .build();

      expect(config.workspaceRoot).toBe('/custom/workspace');
      expect(config.tempDirectory).toBe('/custom/temp');
      expect(config.exportDirectory).toBe('/custom/exports');
      expect(config.snapshotIntervalMs).toBe(60000);
    });

    test('should apply debug configuration', () => {
      const config = new WorkspaceConfigBuilder()
        .withRedis({ host: 'localhost' })
        .withKafka({ brokers: ['localhost:9092'] })
        .withInfrastructureDefaults()
        .withDebug(true, true, 4000)
        .build();

      expect(config.enableDebugLogging).toBe(true);
      expect(config.enableMetrics).toBe(true);
      expect(config.metricsPort).toBe(4000);
    });

    test('should apply defaults for missing configurations', () => {
      const config = new WorkspaceConfigBuilder()
        .withRedis({ host: 'localhost' })
        .withKafka({ brokers: ['localhost:9092'] })
        .withInfrastructureDefaults()
        .build();

      // Should have applied defaults
      expect(config.limits).toBeDefined();
      expect(config.security).toBeDefined();
      expect(config.agentCoordination).toBeDefined();
      expect(config.consensus).toBeDefined();
      expect(config.workspaceRoot).toBe('./workspace');
      expect(config.enableDebugLogging).toBe(false);
    });

    test('should throw error if Redis configuration missing', () => {
      expect(() => {
        new WorkspaceConfigBuilder()
          .withKafka({ brokers: ['localhost:9092'] })
          .withInfrastructureDefaults()
          .build();
      }).toThrow('Redis configuration is required');
    });

    test('should throw error if Kafka configuration missing', () => {
      expect(() => {
        new WorkspaceConfigBuilder()
          .withRedis({ host: 'localhost' })
          .withInfrastructureDefaults()
          .build();
      }).toThrow('Kafka configuration is required');
    });

    test('should throw error if infrastructure configuration missing', () => {
      expect(() => {
        new WorkspaceConfigBuilder().build();
      }).toThrow('Infrastructure configuration is required');
    });
  });

  describe('WorkspaceConfigPresets', () => {
    test('should create local development configuration', () => {
      const config = WorkspaceConfigPresets.localDevelopment();

      expect(config.infrastructure.redis.host).toBe('localhost');
      expect(config.infrastructure.redis.port).toBe(6379);
      expect(config.infrastructure.redis.db).toBe(1); // Separate DB for dev
      expect(config.infrastructure.kafka.brokers).toEqual(['localhost:9092']);
      expect(config.limits.maxAgentsPerWorkspace).toBe(5);
      expect(config.limits.maxSessionDurationMs).toBe(30 * 60 * 1000); // 30 minutes
      expect(config.security.requireAgentAuthentication).toBe(false);
      expect(config.enableDebugLogging).toBe(true);
      expect(config.enableMetrics).toBe(true);
      expect(config.metricsPort).toBe(3001);
    });

    test('should create production configuration with environment variables', () => {
      // Mock environment variables
      const originalEnv = process.env;
      process.env = {
        ...originalEnv,
        REDIS_HOST: 'prod-redis.example.com',
        REDIS_PORT: '6380',
        REDIS_PASSWORD: 'prod-secret',
        KAFKA_BROKERS: 'kafka1.example.com:9092,kafka2.example.com:9092',
        KAFKA_SSL: 'true',
        KAFKA_USERNAME: 'prod-user',
        KAFKA_PASSWORD: 'prod-pass',
        WORKSPACE_ROOT: '/prod/workspace'
      };

      const config = WorkspaceConfigPresets.production();

      expect(config.infrastructure.redis.host).toBe('prod-redis.example.com');
      expect(config.infrastructure.redis.port).toBe(6380);
      expect(config.infrastructure.redis.password).toBe('prod-secret');
      expect(config.infrastructure.kafka.brokers).toEqual(['kafka1.example.com:9092', 'kafka2.example.com:9092']);
      expect(config.infrastructure.kafka.ssl).toBe(true);
      expect(config.infrastructure.kafka.sasl?.username).toBe('prod-user');
      expect(config.infrastructure.kafka.sasl?.password).toBe('prod-pass');
      expect(config.workspaceRoot).toBe('/prod/workspace');
      expect(config.limits.maxAgentsPerWorkspace).toBe(20);
      expect(config.security.requireAgentAuthentication).toBe(true);
      expect(config.consensus.defaultMethod).toBe('weighted');
      expect(config.enableDebugLogging).toBe(false);

      // Restore environment
      process.env = originalEnv;
    });

    test('should create production configuration with defaults when env vars missing', () => {
      const config = WorkspaceConfigPresets.production();

      expect(config.infrastructure.redis.host).toBe('localhost');
      expect(config.infrastructure.kafka.brokers).toEqual(['localhost:9092']);
      expect(config.workspaceRoot).toBe('./workspace');
    });

    test('should create testing configuration with fast timeouts', () => {
      const config = WorkspaceConfigPresets.testing();

      expect(config.infrastructure.redis.db).toBe(15); // High DB number for testing
      expect(config.infrastructure.redis.lockTimeoutMs).toBe(5000);
      expect(config.infrastructure.redis.heartbeatIntervalMs).toBe(1000);
      expect(config.limits.maxAgentsPerWorkspace).toBe(3);
      expect(config.limits.maxSessionDurationMs).toBe(5 * 60 * 1000); // 5 minutes
      expect(config.limits.lockTimeoutMs).toBe(5000);
      expect(config.limits.consensusTimeoutMs).toBe(10000);
      expect(config.agentCoordination.heartbeatIntervalMs).toBe(1000);
      expect(config.agentCoordination.taskTimeoutMs).toBe(10000);
      expect(config.consensus.voteTimeoutMs).toBe(5000);
      expect(config.consensus.maxConsensusRounds).toBe(2);
      expect(config.enableDebugLogging).toBe(true);
      expect(config.enableMetrics).toBe(false);
    });
  });

  describe('WorkspaceConfigValidator', () => {
    let validConfig: WorkspaceConfiguration;

    beforeEach(() => {
      validConfig = WorkspaceConfigPresets.localDevelopment();
    });

    test('should validate correct configuration', () => {
      const errors = WorkspaceConfigValidator.validate(validConfig);
      expect(errors).toEqual([]);
    });

    test('should detect missing Redis host', () => {
      validConfig.infrastructure.redis.host = '';

      const errors = WorkspaceConfigValidator.validate(validConfig);
      expect(errors).toContain('Redis host is required');
    });

    test('should detect missing Kafka brokers', () => {
      validConfig.infrastructure.kafka.brokers = [];

      const errors = WorkspaceConfigValidator.validate(validConfig);
      expect(errors).toContain('At least one Kafka broker is required');
    });

    test('should detect invalid maxAgentsPerWorkspace', () => {
      validConfig.limits.maxAgentsPerWorkspace = 0;

      const errors = WorkspaceConfigValidator.validate(validConfig);
      expect(errors).toContain('maxAgentsPerWorkspace must be at least 1');
    });

    test('should detect invalid majorityThreshold', () => {
      validConfig.consensus.majorityThreshold = 1.5; // > 1

      const errors = WorkspaceConfigValidator.validate(validConfig);
      expect(errors).toContain('majorityThreshold must be between 0 and 1');
    });

    test('should detect negative majorityThreshold', () => {
      validConfig.consensus.majorityThreshold = -0.1;

      const errors = WorkspaceConfigValidator.validate(validConfig);
      expect(errors).toContain('majorityThreshold must be between 0 and 1');
    });

    test('should detect missing workspaceRoot', () => {
      validConfig.workspaceRoot = '';

      const errors = WorkspaceConfigValidator.validate(validConfig);
      expect(errors).toContain('workspaceRoot is required');
    });

    test('should collect multiple validation errors', () => {
      validConfig.infrastructure.redis.host = '';
      validConfig.infrastructure.kafka.brokers = [];
      validConfig.limits.maxAgentsPerWorkspace = 0;

      const errors = WorkspaceConfigValidator.validate(validConfig);
      expect(errors).toHaveLength(3);
      expect(errors).toContain('Redis host is required');
      expect(errors).toContain('At least one Kafka broker is required');
      expect(errors).toContain('maxAgentsPerWorkspace must be at least 1');
    });

    test('should throw error when validateAndThrow is called with invalid config', () => {
      validConfig.infrastructure.redis.host = '';

      expect(() => {
        WorkspaceConfigValidator.validateAndThrow(validConfig);
      }).toThrow('Configuration validation failed');
    });

    test('should not throw when validateAndThrow is called with valid config', () => {
      expect(() => {
        WorkspaceConfigValidator.validateAndThrow(validConfig);
      }).not.toThrow();
    });
  });

  describe('Configuration Integration', () => {
    test('should build and validate preset configurations', () => {
      const presets = [
        WorkspaceConfigPresets.localDevelopment(),
        WorkspaceConfigPresets.production(),
        WorkspaceConfigPresets.testing()
      ];

      for (const preset of presets) {
        const errors = WorkspaceConfigValidator.validate(preset);
        expect(errors).toEqual([]);
      }
    });

    test('should handle partial Redis configuration with defaults', () => {
      const config = new WorkspaceConfigBuilder()
        .withRedis({ host: 'localhost' }) // Minimal Redis config
        .withKafka({ brokers: ['localhost:9092'] })
        .withInfrastructureDefaults()
        .build();

      expect(config.infrastructure.redis.port).toBe(6379); // Default
      expect(config.infrastructure.redis.db).toBe(0); // Default
      expect(config.infrastructure.redis.streamPrefix).toBe('autogen'); // Default
    });

    test('should handle partial Kafka configuration with defaults', () => {
      const config = new WorkspaceConfigBuilder()
        .withRedis({ host: 'localhost' })
        .withKafka({ brokers: ['localhost:9092'] }) // Minimal Kafka config
        .withInfrastructureDefaults()
        .build();

      expect(config.infrastructure.kafka.clientId).toBe('autogen-workspace'); // Default
      expect(config.infrastructure.kafka.groupId).toBe('autogen-workspace-group'); // Default
      expect(config.infrastructure.kafka.ssl).toBe(false); // Default
    });

    test('should create consistent configuration hierarchy', () => {
      const config = new WorkspaceConfigBuilder()
        .withRedis({ host: 'localhost' })
        .withKafka({ brokers: ['localhost:9092'] })
        .withInfrastructureDefaults()
        .withLimits({ maxAgentsPerWorkspace: 10 })
        .withSecurity({ enableFileLocking: true })
        .withAgentCoordination({ coordinationStrategy: 'capability_based' })
        .withConsensus({ defaultMethod: 'majority' })
        .withStorage('./workspace')
        .withDebug(false)
        .build();

      // Verify all major sections are populated
      expect(config.infrastructure).toBeDefined();
      expect(config.limits).toBeDefined();
      expect(config.security).toBeDefined();
      expect(config.agentCoordination).toBeDefined();
      expect(config.consensus).toBeDefined();
      expect(config.workspaceRoot).toBeDefined();
      expect(config.enableDebugLogging).toBeDefined();

      // Verify configuration passes validation
      const errors = WorkspaceConfigValidator.validate(config);
      expect(errors).toEqual([]);
    });
  });
});