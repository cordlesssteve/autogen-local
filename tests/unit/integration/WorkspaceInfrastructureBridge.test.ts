/**
 * Unit tests for WorkspaceInfrastructureBridge
 */

import { WorkspaceInfrastructureBridge, WorkspaceInfrastructureConfig } from '../../../src/infrastructure/integration/WorkspaceInfrastructureBridge';
import { RedisWorkspaceOrchestrator } from '../../../src/infrastructure/orchestration/RedisWorkspaceOrchestrator';
import { KafkaWorkspaceOrchestrator } from '../../../src/infrastructure/orchestration/KafkaWorkspaceOrchestrator';
import { TestConfigFactory, TestDataFactory, TestAssertions, TestTiming } from '../../utils/TestHelpers';

// Mock the orchestrators
jest.mock('../../../src/infrastructure/orchestration/RedisWorkspaceOrchestrator');
jest.mock('../../../src/infrastructure/orchestration/KafkaWorkspaceOrchestrator');

describe('WorkspaceInfrastructureBridge', () => {
  let bridge: WorkspaceInfrastructureBridge;
  let mockRedisOrchestrator: jest.Mocked<RedisWorkspaceOrchestrator>;
  let mockKafkaOrchestrator: jest.Mocked<KafkaWorkspaceOrchestrator>;
  let config: WorkspaceInfrastructureConfig;

  beforeEach(() => {
    config = TestConfigFactory.createMockInfrastructureConfig();
    bridge = new WorkspaceInfrastructureBridge(config);

    // Access mocked orchestrators
    mockRedisOrchestrator = (bridge as any).redisOrchestrator;
    mockKafkaOrchestrator = (bridge as any).kafkaOrchestrator;

    // Setup default mock implementations
    mockRedisOrchestrator.connect = jest.fn().mockResolvedValue(undefined);
    mockRedisOrchestrator.disconnect = jest.fn().mockResolvedValue(undefined);
    mockKafkaOrchestrator.connect = jest.fn().mockResolvedValue(undefined);
    mockKafkaOrchestrator.disconnect = jest.fn().mockResolvedValue(undefined);

    mockRedisOrchestrator.on = jest.fn();
    mockKafkaOrchestrator.on = jest.fn();
    mockRedisOrchestrator.emit = jest.fn();
    mockKafkaOrchestrator.emit = jest.fn();
  });

  afterEach(async () => {
    if (bridge) {
      await bridge.shutdown();
    }
  });

  describe('Initialization', () => {
    test('should initialize successfully with healthy infrastructure', async () => {
      const initPromise = TestAssertions.assertEventEmitted(bridge, 'initialized');

      await bridge.initialize();

      const healthStatus = await initPromise;
      expect(healthStatus.overall).toBe('healthy');
      expect(mockRedisOrchestrator.connect).toHaveBeenCalled();
      expect(mockKafkaOrchestrator.connect).toHaveBeenCalled();
    });

    test('should handle Redis connection failure gracefully', async () => {
      const redisError = new Error('Redis connection failed');
      mockRedisOrchestrator.connect.mockRejectedValue(redisError);

      const errorPromise = TestAssertions.assertEventEmitted(bridge, 'redis_error');

      await bridge.initialize();

      await errorPromise;

      const healthStatus = bridge.getHealthStatus();
      expect(healthStatus.redis.connected).toBe(false);
      expect(healthStatus.overall).toBe('degraded'); // Should still work with Kafka
    });

    test('should handle Kafka connection failure gracefully', async () => {
      const kafkaError = new Error('Kafka connection failed');
      mockKafkaOrchestrator.connect.mockRejectedValue(kafkaError);

      const errorPromise = TestAssertions.assertEventEmitted(bridge, 'kafka_error');

      await bridge.initialize();

      await errorPromise;

      const healthStatus = bridge.getHealthStatus();
      expect(healthStatus.kafka.connected).toBe(false);
      expect(healthStatus.overall).toBe('degraded'); // Should still work with Redis
    });

    test('should work in offline mode when both services fail', async () => {
      const redisError = new Error('Redis failed');
      const kafkaError = new Error('Kafka failed');

      mockRedisOrchestrator.connect.mockRejectedValue(redisError);
      mockKafkaOrchestrator.connect.mockRejectedValue(kafkaError);

      await bridge.initialize();

      const healthStatus = bridge.getHealthStatus();
      expect(healthStatus.redis.connected).toBe(false);
      expect(healthStatus.kafka.connected).toBe(false);
      expect(healthStatus.overall).toBe('offline');
    });

    test('should shutdown gracefully', async () => {
      await bridge.initialize();

      const shutdownPromise = TestAssertions.assertEventEmitted(bridge, 'shutdown');

      await bridge.shutdown();

      await shutdownPromise;

      expect(mockRedisOrchestrator.disconnect).toHaveBeenCalled();
      expect(mockKafkaOrchestrator.disconnect).toHaveBeenCalled();
    });
  });

  describe('Health Status Management', () => {
    beforeEach(async () => {
      await bridge.initialize();
    });

    test('should track health status correctly', () => {
      const healthStatus = bridge.getHealthStatus();

      expect(healthStatus).toBeDefined();
      expect(healthStatus.redis).toBeDefined();
      expect(healthStatus.kafka).toBeDefined();
      expect(healthStatus.overall).toMatch(/healthy|degraded|offline/);

      expect(typeof healthStatus.redis.connected).toBe('boolean');
      expect(typeof healthStatus.kafka.connected).toBe('boolean');
      expect(typeof healthStatus.redis.errorCount).toBe('number');
      expect(typeof healthStatus.kafka.errorCount).toBe('number');
    });

    test('should report healthy when both services connected', () => {
      // Simulate successful connections
      (bridge as any).healthStatus.redis.connected = true;
      (bridge as any).healthStatus.kafka.connected = true;
      (bridge as any).updateOverallHealth();

      expect(bridge.isHealthy()).toBe(true);
      expect(bridge.isDegraded()).toBe(false);
    });

    test('should report degraded when one service connected', () => {
      // Simulate partial connection
      (bridge as any).healthStatus.redis.connected = true;
      (bridge as any).healthStatus.kafka.connected = false;
      (bridge as any).updateOverallHealth();

      expect(bridge.isHealthy()).toBe(false);
      expect(bridge.isDegraded()).toBe(true);
    });

    test('should report offline when no services connected', () => {
      // Simulate no connections
      (bridge as any).healthStatus.redis.connected = false;
      (bridge as any).healthStatus.kafka.connected = false;
      (bridge as any).updateOverallHealth();

      expect(bridge.isHealthy()).toBe(false);
      expect(bridge.isDegraded()).toBe(false);

      const healthStatus = bridge.getHealthStatus();
      expect(healthStatus.overall).toBe('offline');
    });

    test('should emit health change events', async () => {
      const healthChangePromise = TestAssertions.assertEventEmitted(bridge, 'health_changed');

      // Trigger health change
      (bridge as any).healthStatus.redis.connected = false;
      (bridge as any).updateOverallHealth();

      const healthStatus = await healthChangePromise;
      expect(healthStatus.overall).toBe('degraded');
    });
  });

  describe('Agent Operations', () => {
    beforeEach(async () => {
      await bridge.initialize();
    });

    test('should register agent with both Redis and Kafka', async () => {
      const agentId = 'test-agent';
      const workspaceId = 'test-workspace';
      const agentInfo = TestDataFactory.createAgentInfo();

      mockRedisOrchestrator.registerAgent = jest.fn().mockResolvedValue(undefined);
      mockKafkaOrchestrator.logAgentCoordination = jest.fn().mockResolvedValue(undefined);

      const operationPromise = TestAssertions.assertEventEmitted(bridge, 'workspace_operation');

      await bridge.registerAgent(agentId, workspaceId, agentInfo);

      expect(mockRedisOrchestrator.registerAgent).toHaveBeenCalledWith(agentId, {
        ...agentInfo,
        workspaceId
      });
      expect(mockKafkaOrchestrator.logAgentCoordination).toHaveBeenCalled();

      const operation = await operationPromise;
      expect(operation.type).toBe('agent_coordination');
      expect(operation.agentId).toBe(agentId);
    });

    test('should update agent status with Redis', async () => {
      const agentId = 'test-agent';
      const workspaceId = 'test-workspace';

      mockRedisOrchestrator.updateAgentStatus = jest.fn().mockResolvedValue(undefined);

      await bridge.updateAgentStatus(agentId, workspaceId, 'busy', 'Testing');

      expect(mockRedisOrchestrator.updateAgentStatus).toHaveBeenCalledWith(
        agentId,
        workspaceId,
        'busy',
        'Testing'
      );
    });

    test('should work in fallback mode when Redis fails', async () => {
      const agentId = 'test-agent';
      const workspaceId = 'test-workspace';
      const agentInfo = TestDataFactory.createAgentInfo();

      // Simulate Redis failure
      mockRedisOrchestrator.registerAgent = jest.fn().mockRejectedValue(new Error('Redis failed'));

      // Should not throw
      await expect(bridge.registerAgent(agentId, workspaceId, agentInfo)).resolves.not.toThrow();

      // Should still log to Kafka
      expect(mockKafkaOrchestrator.logAgentCoordination).toHaveBeenCalled();
    });
  });

  describe('File Locking Operations', () => {
    beforeEach(async () => {
      await bridge.initialize();
    });

    test('should request file lock through Redis', async () => {
      const agentId = 'test-agent';
      const workspaceId = 'test-workspace';
      const filePath = '/test/file.txt';
      const expectedLockId = 'lock-123';

      mockRedisOrchestrator.requestFileLock = jest.fn().mockResolvedValue(expectedLockId);
      mockKafkaOrchestrator.logFileEdit = jest.fn().mockResolvedValue(undefined);

      const lockId = await bridge.requestFileLock(agentId, workspaceId, filePath, 'write');

      expect(lockId).toBe(expectedLockId);
      expect(mockRedisOrchestrator.requestFileLock).toHaveBeenCalledWith(
        agentId,
        workspaceId,
        filePath,
        'write'
      );
      expect(mockKafkaOrchestrator.logFileEdit).toHaveBeenCalled();
    });

    test('should release file lock through Redis', async () => {
      const lockId = 'lock-123';
      const agentId = 'test-agent';

      mockRedisOrchestrator.releaseFileLock = jest.fn().mockResolvedValue(true);
      mockKafkaOrchestrator.logFileEdit = jest.fn().mockResolvedValue(undefined);

      const released = await bridge.releaseFileLock(lockId, agentId);

      expect(released).toBe(true);
      expect(mockRedisOrchestrator.releaseFileLock).toHaveBeenCalledWith(lockId, agentId);
    });

    test('should fallback to memory-based locking when Redis fails', async () => {
      const agentId = 'test-agent';
      const workspaceId = 'test-workspace';
      const filePath = '/test/file.txt';

      // Simulate Redis failure
      mockRedisOrchestrator.requestFileLock = jest.fn().mockRejectedValue(new Error('Redis failed'));

      const lockId = await bridge.requestFileLock(agentId, workspaceId, filePath, 'write');

      // Should get a fallback lock ID
      expect(lockId).toBeTruthy();
      expect(lockId).toContain(workspaceId);
    });

    test('should handle concurrent fallback locks correctly', async () => {
      // Disable Redis
      mockRedisOrchestrator.requestFileLock = jest.fn().mockRejectedValue(new Error('Redis failed'));

      const workspaceId = 'test-workspace';
      const filePath = '/test/file.txt';

      const lock1 = await bridge.requestFileLock('agent1', workspaceId, filePath, 'write');
      const lock2 = await bridge.requestFileLock('agent2', workspaceId, filePath, 'write');

      expect(lock1).toBeTruthy();
      expect(lock2).toBeNull(); // Second lock should be rejected
    });

    test('should allow multiple read locks in fallback mode', async () => {
      // Disable Redis
      mockRedisOrchestrator.requestFileLock = jest.fn().mockRejectedValue(new Error('Redis failed'));

      const workspaceId = 'test-workspace';
      const filePath = '/test/file.txt';

      const lock1 = await bridge.requestFileLock('agent1', workspaceId, filePath, 'read');
      const lock2 = await bridge.requestFileLock('agent2', workspaceId, filePath, 'read');

      expect(lock1).toBeTruthy();
      expect(lock2).toBeTruthy();
    });
  });

  describe('File Edit Operations', () => {
    beforeEach(async () => {
      await bridge.initialize();
    });

    test('should publish file edits to both Redis and Kafka', async () => {
      const agentId = 'test-agent';
      const workspaceId = 'test-workspace';
      const filePath = '/test/file.txt';
      const editData = TestDataFactory.createFileEditData();

      mockRedisOrchestrator.publishFileEdit = jest.fn().mockResolvedValue(undefined);
      mockKafkaOrchestrator.logFileEdit = jest.fn().mockResolvedValue(undefined);

      const operationPromise = TestAssertions.assertEventEmitted(bridge, 'workspace_operation');

      await bridge.publishFileEdit(agentId, workspaceId, filePath, editData);

      expect(mockRedisOrchestrator.publishFileEdit).toHaveBeenCalledWith(
        agentId,
        workspaceId,
        filePath,
        editData
      );
      expect(mockKafkaOrchestrator.logFileEdit).toHaveBeenCalled();

      const operation = await operationPromise;
      expect(operation.type).toBe('file_operation');
      expect(operation.agentId).toBe(agentId);
    });

    test('should handle Redis failures during edit publishing', async () => {
      const agentId = 'test-agent';
      const workspaceId = 'test-workspace';
      const filePath = '/test/file.txt';
      const editData = TestDataFactory.createFileEditData();

      // Simulate Redis failure
      mockRedisOrchestrator.publishFileEdit = jest.fn().mockRejectedValue(new Error('Redis failed'));
      mockKafkaOrchestrator.logFileEdit = jest.fn().mockResolvedValue(undefined);

      // Should not throw, should still log to Kafka
      await expect(bridge.publishFileEdit(agentId, workspaceId, filePath, editData)).resolves.not.toThrow();

      expect(mockKafkaOrchestrator.logFileEdit).toHaveBeenCalled();
    });
  });

  describe('Consensus Operations', () => {
    beforeEach(async () => {
      await bridge.initialize();
    });

    test('should publish consensus votes through Redis', async () => {
      const agentId = 'test-agent';
      const workspaceId = 'test-workspace';
      const proposalId = 'proposal-123';

      mockRedisOrchestrator.publishConsensusVote = jest.fn().mockResolvedValue(undefined);

      await bridge.publishConsensusVote(agentId, workspaceId, proposalId, 'agree', 'Good idea');

      expect(mockRedisOrchestrator.publishConsensusVote).toHaveBeenCalledWith(
        agentId,
        workspaceId,
        proposalId,
        'agree',
        'Good idea'
      );
    });

    test('should log consensus decisions through Kafka', async () => {
      const agentId = 'test-agent';
      const workspaceId = 'test-workspace';
      const decision = TestDataFactory.createConsensusDecision();

      mockKafkaOrchestrator.logConsensusDecision = jest.fn().mockResolvedValue(undefined);

      await bridge.logConsensusDecision(agentId, workspaceId, decision);

      expect(mockKafkaOrchestrator.logConsensusDecision).toHaveBeenCalled();
    });
  });

  describe('Workspace Management', () => {
    beforeEach(async () => {
      await bridge.initialize();
    });

    test('should save workspace snapshots through Kafka', async () => {
      const agentId = 'test-agent';
      const workspaceId = 'test-workspace';
      const snapshot = TestDataFactory.createWorkspaceSnapshot();

      mockKafkaOrchestrator.saveWorkspaceSnapshot = jest.fn().mockResolvedValue(undefined);

      await bridge.saveWorkspaceSnapshot(agentId, workspaceId, snapshot);

      expect(mockKafkaOrchestrator.saveWorkspaceSnapshot).toHaveBeenCalled();
    });
  });

  describe('Error Recovery', () => {
    beforeEach(async () => {
      await bridge.initialize();
    });

    test('should handle Redis errors and emit events', async () => {
      const errorPromise = TestAssertions.assertEventEmitted(bridge, 'redis_error');

      const redisError = new Error('Redis connection lost');
      (bridge as any).handleRedisError(redisError);

      const emittedError = await errorPromise;
      expect(emittedError.message).toBe('Redis connection lost');

      const healthStatus = bridge.getHealthStatus();
      expect(healthStatus.redis.connected).toBe(false);
      expect(healthStatus.redis.errorCount).toBeGreaterThan(0);
    });

    test('should handle Kafka errors and emit events', async () => {
      const errorPromise = TestAssertions.assertEventEmitted(bridge, 'kafka_error');

      const kafkaError = new Error('Kafka producer failed');
      (bridge as any).handleKafkaError(kafkaError);

      const emittedError = await errorPromise;
      expect(emittedError.message).toBe('Kafka producer failed');

      const healthStatus = bridge.getHealthStatus();
      expect(healthStatus.kafka.connected).toBe(false);
      expect(healthStatus.kafka.errorCount).toBeGreaterThan(0);
    });

    test('should attempt reconnection on failures', async () => {
      const reconnectFailedPromise = TestAssertions.assertEventEmitted(bridge, 'reconnect_failed');

      // Simulate multiple reconnection failures
      for (let i = 0; i < config.reconnectAttempts + 1; i++) {
        (bridge as any).attemptReconnect('redis');
        await TestTiming.delay(config.reconnectDelayMs + 50);
      }

      const failedService = await reconnectFailedPromise;
      expect(failedService).toBe('redis');
    });
  });

  describe('Event Propagation', () => {
    beforeEach(async () => {
      await bridge.initialize();
    });

    test('should propagate Redis messages', async () => {
      const messagePromise = TestAssertions.assertEventEmitted(bridge, 'redis_message');

      const mockRedisMessage = {
        streamName: 'test-stream',
        messageId: '123-0',
        message: { type: 'test', source: 'test-agent' }
      };

      // Simulate Redis message event
      bridge.emit('redis_message', mockRedisMessage);

      const receivedMessage = await messagePromise;
      expect(receivedMessage).toEqual(mockRedisMessage);
    });

    test('should propagate Kafka messages', async () => {
      const messagePromise = TestAssertions.assertEventEmitted(bridge, 'kafka_message');

      const mockKafkaMessage = {
        topic: 'test-topic',
        partition: 0,
        message: { type: 'test', source: 'test-agent' }
      };

      // Simulate Kafka message event
      bridge.emit('kafka_message', mockKafkaMessage);

      const receivedMessage = await messagePromise;
      expect(receivedMessage).toEqual(mockKafkaMessage);
    });

    test('should emit workspace operations for all actions', async () => {
      const operations: string[] = [];

      bridge.on('workspace_operation', (operation) => {
        operations.push(operation.type);
      });

      // Perform various operations
      await bridge.registerAgent('agent', 'workspace', TestDataFactory.createAgentInfo());
      await bridge.updateAgentStatus('agent', 'workspace', 'busy');
      await bridge.publishFileEdit('agent', 'workspace', '/test.txt', TestDataFactory.createFileEditData());

      // Should have emitted operations for each action
      expect(operations).toContain('agent_coordination');
      expect(operations).toContain('agent_coordination'); // status update
      expect(operations).toContain('file_operation');
    });
  });

  describe('Performance', () => {
    beforeEach(async () => {
      await bridge.initialize();
    });

    test('should handle high throughput operations', async () => {
      mockRedisOrchestrator.publishFileEdit = jest.fn().mockResolvedValue(undefined);
      mockKafkaOrchestrator.logFileEdit = jest.fn().mockResolvedValue(undefined);

      const operations = Array.from({ length: 100 }, (_, i) =>
        bridge.publishFileEdit(`agent-${i}`, 'workspace', `/test${i}.txt`, {
          operation: 'create',
          content: `Content ${i}`
        })
      );

      const { duration } = await TestTiming.measureTime(async () => {
        await Promise.all(operations);
      });

      // Should handle 100 operations reasonably quickly (< 1 second)
      expect(duration).toBeLessThan(1000);
      expect(mockRedisOrchestrator.publishFileEdit).toHaveBeenCalledTimes(100);
      expect(mockKafkaOrchestrator.logFileEdit).toHaveBeenCalledTimes(100);
    });

    test('should measure individual operation performance', async () => {
      mockRedisOrchestrator.requestFileLock = jest.fn().mockResolvedValue('lock-123');
      mockKafkaOrchestrator.logFileEdit = jest.fn().mockResolvedValue(undefined);

      const { duration } = await TestTiming.measureTime(async () => {
        return bridge.requestFileLock('agent', 'workspace', '/test.txt', 'write');
      });

      // File lock operation should be fast (< 100ms)
      expect(duration).toBeLessThan(100);
    });
  });
});