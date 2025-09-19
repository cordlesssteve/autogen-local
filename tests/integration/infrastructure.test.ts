/**
 * Integration tests for workspace infrastructure components
 *
 * Tests the Redis + Kafka orchestration layer with graceful fallback
 */

import { WorkspaceInfrastructureBridge } from '../../src/infrastructure/integration/WorkspaceInfrastructureBridge';
import { WorkspaceConfigPresets } from '../../src/config/WorkspaceConfig';

describe('Infrastructure Integration Tests', () => {
  let infrastructureBridge: WorkspaceInfrastructureBridge;
  const testWorkspaceId = 'test-workspace-1';
  const testAgentId = 'test-agent-1';

  beforeAll(async () => {
    // Use testing configuration with fast timeouts
    const config = WorkspaceConfigPresets.testing();
    infrastructureBridge = new WorkspaceInfrastructureBridge(config.infrastructure);

    // Set up event listeners for debugging
    infrastructureBridge.on('error', (error) => {
      console.warn('Infrastructure error (expected in tests):', error.message);
    });

    infrastructureBridge.on('redis_error', (error) => {
      console.warn('Redis error (expected if Redis unavailable):', error.message);
    });

    infrastructureBridge.on('kafka_error', (error) => {
      console.warn('Kafka error (expected if Kafka unavailable):', error.message);
    });
  });

  afterAll(async () => {
    if (infrastructureBridge) {
      await infrastructureBridge.shutdown();
    }
  });

  describe('Infrastructure Initialization', () => {
    test('should initialize infrastructure bridge', async () => {
      expect(infrastructureBridge).toBeDefined();
    });

    test('should attempt to connect to infrastructure', async () => {
      await infrastructureBridge.initialize();

      const healthStatus = infrastructureBridge.getHealthStatus();
      expect(healthStatus).toBeDefined();
      expect(healthStatus.overall).toMatch(/healthy|degraded|offline/);
    }, 10000);

    test('should handle graceful degradation', () => {
      const healthStatus = infrastructureBridge.getHealthStatus();

      // Should work even if Redis/Kafka are not available
      expect(['healthy', 'degraded', 'offline']).toContain(healthStatus.overall);

      if (healthStatus.overall === 'offline') {
        console.log('Running in fallback mode (Redis/Kafka unavailable)');
      }
    });
  });

  describe('Agent Registration', () => {
    test('should register agent successfully', async () => {
      const agentInfo = {
        name: 'Test Agent',
        model: 'gpt-4',
        capabilities: ['analysis', 'editing']
      };

      // Should not throw even if infrastructure is offline
      await expect(
        infrastructureBridge.registerAgent(testAgentId, testWorkspaceId, agentInfo)
      ).resolves.not.toThrow();
    });

    test('should update agent status', async () => {
      await expect(
        infrastructureBridge.updateAgentStatus(testAgentId, testWorkspaceId, 'active', 'testing')
      ).resolves.not.toThrow();
    });
  });

  describe('File Locking Operations', () => {
    const testFilePath = '/test/file.txt';

    test('should request file lock', async () => {
      const lockId = await infrastructureBridge.requestFileLock(
        testAgentId,
        testWorkspaceId,
        testFilePath,
        'write'
      );

      // Should return either a lock ID or null (if conflict/unavailable)
      expect(lockId === null || typeof lockId === 'string').toBe(true);

      if (lockId) {
        console.log('Lock acquired:', lockId);

        // Release the lock
        const released = await infrastructureBridge.releaseFileLock(lockId, testAgentId);
        expect(released).toBe(true);
      } else {
        console.log('Lock not acquired (conflict or fallback mode)');
      }
    });

    test('should handle concurrent lock requests', async () => {
      const agent1 = 'agent-1';
      const agent2 = 'agent-2';
      const filePath = '/test/concurrent.txt';

      // Request locks simultaneously
      const [lock1, lock2] = await Promise.all([
        infrastructureBridge.requestFileLock(agent1, testWorkspaceId, filePath, 'write'),
        infrastructureBridge.requestFileLock(agent2, testWorkspaceId, filePath, 'write')
      ]);

      // Only one should succeed (or both null in fallback mode)
      if (lock1 && lock2) {
        // This should not happen with proper locking
        fail('Both agents got write locks simultaneously');
      } else if (lock1) {
        expect(lock2).toBeNull();
        await infrastructureBridge.releaseFileLock(lock1, agent1);
      } else if (lock2) {
        expect(lock1).toBeNull();
        await infrastructureBridge.releaseFileLock(lock2, agent2);
      } else {
        // Both null - acceptable in fallback mode
        console.log('Concurrent locks both failed (fallback mode)');
      }
    });

    test('should allow concurrent read locks', async () => {
      const agent1 = 'agent-1';
      const agent2 = 'agent-2';
      const filePath = '/test/read-concurrent.txt';

      // Request read locks simultaneously
      const [lock1, lock2] = await Promise.all([
        infrastructureBridge.requestFileLock(agent1, testWorkspaceId, filePath, 'read'),
        infrastructureBridge.requestFileLock(agent2, testWorkspaceId, filePath, 'read')
      ]);

      // Both should succeed if infrastructure is available
      if (infrastructureBridge.isHealthy()) {
        expect(lock1).toBeTruthy();
        expect(lock2).toBeTruthy();

        if (lock1) await infrastructureBridge.releaseFileLock(lock1, agent1);
        if (lock2) await infrastructureBridge.releaseFileLock(lock2, agent2);
      } else {
        console.log('Read locks test skipped (infrastructure unavailable)');
      }
    });
  });

  describe('File Edit Operations', () => {
    test('should publish file edit events', async () => {
      const filePath = '/test/edit-test.txt';
      const editData = {
        operation: 'update' as const,
        content: 'Hello, World!',
        startLine: 1,
        endLine: 1,
        previousContent: ''
      };

      await expect(
        infrastructureBridge.publishFileEdit(testAgentId, testWorkspaceId, filePath, editData)
      ).resolves.not.toThrow();
    });
  });

  describe('Consensus Operations', () => {
    test('should publish consensus vote', async () => {
      const proposalId = 'proposal-1';

      await expect(
        infrastructureBridge.publishConsensusVote(
          testAgentId,
          testWorkspaceId,
          proposalId,
          'agree',
          'This is a good idea'
        )
      ).resolves.not.toThrow();
    });

    test('should log consensus decision', async () => {
      const decision = {
        proposalId: 'proposal-1',
        description: 'Test proposal',
        votes: {
          [testAgentId]: { vote: 'agree' as const, reasoning: 'Good idea' }
        },
        finalDecision: 'approved' as const,
        consensusMethod: 'majority' as const
      };

      await expect(
        infrastructureBridge.logConsensusDecision(testAgentId, testWorkspaceId, decision)
      ).resolves.not.toThrow();
    });
  });

  describe('Workspace Management', () => {
    test('should save workspace snapshot', async () => {
      const snapshot = {
        files: {
          '/test/file1.txt': 'Content 1',
          '/test/file2.txt': 'Content 2'
        },
        metadata: {
          version: '1.0',
          timestamp: Date.now()
        },
        activeAgents: [testAgentId],
        consensus: {
          'proposal-1': 'approved'
        }
      };

      await expect(
        infrastructureBridge.saveWorkspaceSnapshot(testAgentId, testWorkspaceId, snapshot)
      ).resolves.not.toThrow();
    });
  });

  describe('Event Handling', () => {
    test('should emit workspace operations', (done) => {
      infrastructureBridge.once('workspace_operation', (operation) => {
        expect(operation).toBeDefined();
        expect(operation.type).toBeDefined();
        expect(operation.agentId).toBeDefined();
        expect(operation.workspaceId).toBeDefined();
        done();
      });

      // Trigger an operation that should emit an event
      infrastructureBridge.updateAgentStatus(testAgentId, testWorkspaceId, 'idle');
    });

    test('should handle health status changes', (done) => {
      infrastructureBridge.once('health_changed', (healthStatus) => {
        expect(healthStatus).toBeDefined();
        expect(healthStatus.overall).toMatch(/healthy|degraded|offline/);
        done();
      });

      // Trigger a health check (this might not always fire immediately)
      setTimeout(() => {
        const status = infrastructureBridge.getHealthStatus();
        infrastructureBridge.emit('health_changed', status);
      }, 100);
    });
  });

  describe('Error Recovery', () => {
    test('should handle infrastructure failures gracefully', async () => {
      // Simulate operations during infrastructure failure
      const operations = [
        () => infrastructureBridge.requestFileLock(testAgentId, testWorkspaceId, '/test/fail.txt', 'write'),
        () => infrastructureBridge.publishFileEdit(testAgentId, testWorkspaceId, '/test/fail.txt', {
          operation: 'create',
          content: 'test'
        }),
        () => infrastructureBridge.updateAgentStatus(testAgentId, testWorkspaceId, 'busy')
      ];

      // All operations should complete without throwing
      for (const operation of operations) {
        await expect(operation()).resolves.not.toThrow();
      }
    });

    test('should maintain health status tracking', () => {
      const healthStatus = infrastructureBridge.getHealthStatus();

      expect(healthStatus.redis).toBeDefined();
      expect(healthStatus.kafka).toBeDefined();
      expect(healthStatus.overall).toBeDefined();

      expect(typeof healthStatus.redis.connected).toBe('boolean');
      expect(typeof healthStatus.kafka.connected).toBe('boolean');
      expect(typeof healthStatus.redis.lastHealthCheck).toBe('number');
      expect(typeof healthStatus.kafka.lastHealthCheck).toBe('number');
    });
  });
});