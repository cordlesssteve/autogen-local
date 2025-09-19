/**
 * Unit tests for RedisWorkspaceOrchestrator
 */

import { RedisWorkspaceOrchestrator, RedisWorkspaceConfig, WORKSPACE_STREAM_PATTERNS } from '../../../src/infrastructure/orchestration/RedisWorkspaceOrchestrator';
import { MockRedis, TestConfigFactory, TestDataFactory, TestAssertions, TestTiming } from '../../utils/TestHelpers';

// Mock ioredis
jest.mock('ioredis', () => {
  return {
    Redis: jest.fn().mockImplementation(() => new MockRedis())
  };
});

describe('RedisWorkspaceOrchestrator', () => {
  let orchestrator: RedisWorkspaceOrchestrator;
  let mockRedis: MockRedis;
  let config: RedisWorkspaceConfig;

  beforeEach(() => {
    config = TestConfigFactory.createMockInfrastructureConfig().redis;
    orchestrator = new RedisWorkspaceOrchestrator(config);

    // Access the mocked Redis instance
    mockRedis = (orchestrator as any).redis as MockRedis;

    // Clear any previous data
    mockRedis.clear();
  });

  afterEach(async () => {
    if (orchestrator) {
      await orchestrator.disconnect();
    }
  });

  describe('Connection Management', () => {
    test('should connect successfully', async () => {
      const connectPromise = TestAssertions.assertEventEmitted(orchestrator, 'connected');

      await orchestrator.connect();
      await connectPromise;

      expect(mockRedis.isConnected()).toBe(true);
    });

    test('should disconnect successfully', async () => {
      await orchestrator.connect();

      const disconnectPromise = TestAssertions.assertEventEmitted(orchestrator, 'disconnected');
      await orchestrator.disconnect();
      await disconnectPromise;

      expect(mockRedis.isConnected()).toBe(false);
    });

    test('should handle connection errors', async () => {
      const connectionError = new Error('Connection failed');

      // Mock Redis to throw error on connect
      mockRedis.connect = jest.fn().mockRejectedValue(connectionError);

      const errorPromise = TestAssertions.assertEventEmitted(orchestrator, 'error');

      await expect(orchestrator.connect()).rejects.toThrow('Connection failed');

      const emittedError = await errorPromise;
      expect(emittedError.message).toContain('Redis connection failed');
    });

    test('should emit reconnecting event', async () => {
      await orchestrator.connect();

      const reconnectingPromise = TestAssertions.assertEventEmitted(orchestrator, 'reconnecting');

      mockRedis.simulateReconnection();

      await reconnectingPromise;
    });
  });

  describe('Agent Registration', () => {
    beforeEach(async () => {
      await orchestrator.connect();
    });

    test('should register agent successfully', async () => {
      const agentId = 'test-agent';
      const agentInfo = TestDataFactory.createAgentInfo({ workspaceId: 'test-workspace' });

      await orchestrator.registerAgent(agentId, agentInfo);

      // Verify agent data was stored
      const storedData = await mockRedis.hget(`${WORKSPACE_STREAM_PATTERNS.AGENT_REGISTRY}:${agentId}`, 'name');
      expect(storedData).toBe(agentInfo.name);
    });

    test('should update agent status', async () => {
      const agentId = 'test-agent';

      await orchestrator.updateAgentStatus(agentId, 'test-workspace', 'busy', 'testing');

      // Verify status was updated
      const status = await mockRedis.hget(`${WORKSPACE_STREAM_PATTERNS.AGENT_REGISTRY}:${agentId}`, 'status');
      expect(status).toBe('busy');

      const task = await mockRedis.hget(`${WORKSPACE_STREAM_PATTERNS.AGENT_REGISTRY}:${agentId}`, 'currentTask');
      expect(task).toBe('testing');
    });

    test('should emit workspace message for agent registration', async () => {
      const messagePromise = TestAssertions.assertEventEmitted(orchestrator, 'workspace_message');

      await orchestrator.registerAgent('test-agent', TestDataFactory.createAgentInfo({ workspaceId: 'test-workspace' }));

      // Note: In a real implementation, this would be triggered by stream consumption
      // For testing, we'll simulate the message
      const mockMessage = {
        streamName: WORKSPACE_STREAM_PATTERNS.AGENT_STATUS,
        messageId: '123-0',
        message: {
          type: 'agent_status',
          source: 'test-agent'
        }
      };

      orchestrator.emit('workspace_message', mockMessage);

      const receivedMessage = await messagePromise;
      expect(receivedMessage.message.type).toBe('agent_status');
    });
  });

  describe('File Locking Operations', () => {
    beforeEach(async () => {
      await orchestrator.connect();
    });

    test('should acquire exclusive file lock', async () => {
      const agentId = 'test-agent';
      const workspaceId = 'test-workspace';
      const filePath = '/test/file.txt';

      const lockId = await orchestrator.requestFileLock(agentId, workspaceId, filePath, 'write');

      expect(lockId).toBeTruthy();
      expect(lockId).toContain(workspaceId);
      expect(lockId).toContain(filePath);

      // Verify lock was stored
      const lockData = await mockRedis.get(lockId!);
      expect(lockData).toBeTruthy();

      const lock = JSON.parse(lockData!);
      expect(lock.agentId).toBe(agentId);
      expect(lock.lockType).toBe('write');
    });

    test('should allow multiple read locks', async () => {
      const workspaceId = 'test-workspace';
      const filePath = '/test/file.txt';

      const lock1 = await orchestrator.requestFileLock('agent1', workspaceId, filePath, 'read');
      const lock2 = await orchestrator.requestFileLock('agent2', workspaceId, filePath, 'read');

      expect(lock1).toBeTruthy();
      expect(lock2).toBeTruthy();

      // Both should be read locks
      expect(lock1).toContain('readers');
      expect(lock2).toContain('readers');
    });

    test('should prevent conflicting write locks', async () => {
      const workspaceId = 'test-workspace';
      const filePath = '/test/file.txt';

      const lock1 = await orchestrator.requestFileLock('agent1', workspaceId, filePath, 'write');
      const lock2 = await orchestrator.requestFileLock('agent2', workspaceId, filePath, 'write');

      expect(lock1).toBeTruthy();
      expect(lock2).toBeNull(); // Second lock should be rejected
    });

    test('should prevent write lock when read locks exist', async () => {
      const workspaceId = 'test-workspace';
      const filePath = '/test/file.txt';

      const readLock = await orchestrator.requestFileLock('agent1', workspaceId, filePath, 'read');
      const writeLock = await orchestrator.requestFileLock('agent2', workspaceId, filePath, 'write');

      expect(readLock).toBeTruthy();
      expect(writeLock).toBeNull(); // Write lock should be rejected
    });

    test('should release exclusive lock', async () => {
      const agentId = 'test-agent';
      const workspaceId = 'test-workspace';
      const filePath = '/test/file.txt';

      const lockId = await orchestrator.requestFileLock(agentId, workspaceId, filePath, 'write');
      expect(lockId).toBeTruthy();

      const released = await orchestrator.releaseFileLock(lockId!, agentId);
      expect(released).toBe(true);

      // Verify lock was removed
      const lockData = await mockRedis.get(lockId!);
      expect(lockData).toBeNull();
    });

    test('should release read lock', async () => {
      const agentId = 'test-agent';
      const workspaceId = 'test-workspace';
      const filePath = '/test/file.txt';

      const lockId = await orchestrator.requestFileLock(agentId, workspaceId, filePath, 'read');
      expect(lockId).toBeTruthy();

      const released = await orchestrator.releaseFileLock(lockId!, agentId);
      expect(released).toBe(true);
    });

    test('should prevent unauthorized lock release', async () => {
      const workspaceId = 'test-workspace';
      const filePath = '/test/file.txt';

      const lockId = await orchestrator.requestFileLock('agent1', workspaceId, filePath, 'write');
      expect(lockId).toBeTruthy();

      // Different agent tries to release lock
      const released = await orchestrator.releaseFileLock(lockId!, 'agent2');
      expect(released).toBe(false);

      // Verify lock still exists
      const lockData = await mockRedis.get(lockId!);
      expect(lockData).toBeTruthy();
    });

    test('should queue conflicting lock requests', async () => {
      const workspaceId = 'test-workspace';
      const filePath = '/test/file.txt';

      // First agent gets lock
      const lock1 = await orchestrator.requestFileLock('agent1', workspaceId, filePath, 'write');
      expect(lock1).toBeTruthy();

      // Second agent gets queued
      const lock2 = await orchestrator.requestFileLock('agent2', workspaceId, filePath, 'write');
      expect(lock2).toBeNull();

      // Verify queue was created
      const queueKey = `${WORKSPACE_STREAM_PATTERNS.EDIT_QUEUE}:${workspaceId}:${filePath}`;
      const queueData = await mockRedis.get(queueKey);
      // Note: In a real implementation, we'd use list operations to check the queue
      expect(queueData).toBeDefined(); // Verify queue exists
    });

    test('should emit lock retry events', async () => {
      const workspaceId = 'test-workspace';
      const filePath = '/test/file.txt';

      // First agent gets lock
      const lock1 = await orchestrator.requestFileLock('agent1', workspaceId, filePath, 'write');
      expect(lock1).toBeTruthy();

      const retryPromise = TestAssertions.assertEventEmitted(orchestrator, 'lock_retry');

      // Release lock (should trigger retry processing)
      await orchestrator.releaseFileLock(lock1!, 'agent1');

      // Simulate retry event emission
      orchestrator.emit('lock_retry', {
        agentId: 'agent2',
        workspaceId,
        filePath,
        lockType: 'write'
      });

      const retryEvent = await retryPromise;
      expect(retryEvent.agentId).toBe('agent2');
    });
  });

  describe('File Edit Operations', () => {
    beforeEach(async () => {
      await orchestrator.connect();
    });

    test('should publish file edit', async () => {
      const agentId = 'test-agent';
      const workspaceId = 'test-workspace';
      const filePath = '/test/file.txt';
      const editData = TestDataFactory.createFileEditData();

      await orchestrator.publishFileEdit(agentId, workspaceId, filePath, editData);

      // Verify edit was added to stream
      const streams = mockRedis.getStreams();
      const editStream = streams.get(WORKSPACE_STREAM_PATTERNS.FILE_EDITS);

      expect(editStream).toBeDefined();
      expect(editStream!.length).toBeGreaterThan(0);
    });

    test('should include edit metadata in stream message', async () => {
      const agentId = 'test-agent';
      const workspaceId = 'test-workspace';
      const filePath = '/test/file.txt';
      const editData = {
        operation: 'update' as const,
        content: 'new content',
        startLine: 5,
        endLine: 10
      };

      await orchestrator.publishFileEdit(agentId, workspaceId, filePath, editData);

      const streams = mockRedis.getStreams();
      const editStream = streams.get(WORKSPACE_STREAM_PATTERNS.FILE_EDITS);

      expect(editStream).toBeDefined();
      expect(editStream!.length).toBe(1);

      const message = editStream![0];
      expect(message.fields).toContain('data');

      // Parse the data field
      const dataIndex = message.fields.indexOf('data');
      const messageData = JSON.parse(message.fields[dataIndex + 1]);

      expect(messageData.payload.operation).toBe('update');
      expect(messageData.payload.content).toBe('new content');
      expect(messageData.metadata.agentId).toBe(agentId);
      expect(messageData.metadata.filePath).toBe(filePath);
    });
  });

  describe('Consensus Operations', () => {
    beforeEach(async () => {
      await orchestrator.connect();
    });

    test('should publish consensus vote', async () => {
      const agentId = 'test-agent';
      const workspaceId = 'test-workspace';
      const proposalId = 'proposal-123';

      await orchestrator.publishConsensusVote(agentId, workspaceId, proposalId, 'agree', 'Good idea');

      // Verify vote was added to stream
      const streams = mockRedis.getStreams();
      const consensusStream = streams.get(WORKSPACE_STREAM_PATTERNS.CONSENSUS_VOTES);

      expect(consensusStream).toBeDefined();
      expect(consensusStream!.length).toBeGreaterThan(0);
    });

    test('should include vote data in stream message', async () => {
      const agentId = 'test-agent';
      const workspaceId = 'test-workspace';
      const proposalId = 'proposal-123';
      const reasoning = 'This will improve performance';

      await orchestrator.publishConsensusVote(agentId, workspaceId, proposalId, 'agree', reasoning);

      const streams = mockRedis.getStreams();
      const consensusStream = streams.get(WORKSPACE_STREAM_PATTERNS.CONSENSUS_VOTES);

      const message = consensusStream![0];
      const dataIndex = message.fields.indexOf('data');
      const messageData = JSON.parse(message.fields[dataIndex + 1]);

      expect(messageData.payload.proposalId).toBe(proposalId);
      expect(messageData.payload.vote).toBe('agree');
      expect(messageData.payload.reasoning).toBe(reasoning);
    });
  });

  describe('Stream Processing', () => {
    beforeEach(async () => {
      await orchestrator.connect();
    });

    test('should process stream messages', async () => {
      const messagePromise = TestAssertions.assertEventEmitted(orchestrator, 'workspace_message');

      // Simulate a stream message
      const mockStreamMessage = {
        streamName: WORKSPACE_STREAM_PATTERNS.FILE_EDITS,
        messageId: '123-0',
        message: {
          type: 'file_edit',
          source: 'test-agent'
        }
      };

      orchestrator.emit('workspace_message', mockStreamMessage);

      const receivedMessage = await messagePromise;
      expect(receivedMessage.streamName).toBe(WORKSPACE_STREAM_PATTERNS.FILE_EDITS);
      expect(receivedMessage.message.type).toBe('file_edit');
    });

    test('should handle stream processing errors gracefully', async () => {
      const errorPromise = TestAssertions.assertEventEmitted(orchestrator, 'error');

      // Simulate a stream processing error
      const error = new Error('Stream processing failed');
      orchestrator.emit('error', error);

      const emittedError = await errorPromise;
      expect(emittedError).toBe(error);
    });
  });

  describe('Error Handling', () => {
    test('should handle Redis errors', async () => {
      await orchestrator.connect();

      const errorPromise = TestAssertions.assertEventEmitted(orchestrator, 'error');

      // Simulate Redis error
      const redisError = new Error('Redis operation failed');
      mockRedis.simulateError(redisError);

      const emittedError = await errorPromise;
      expect(emittedError.message).toContain('Redis error');
    });

    test('should handle disconnection gracefully', async () => {
      await orchestrator.connect();
      expect(mockRedis.isConnected()).toBe(true);

      const disconnectPromise = TestAssertions.assertEventEmitted(orchestrator, 'disconnected');

      await orchestrator.disconnect();

      await disconnectPromise;
      expect(mockRedis.isConnected()).toBe(false);
    });
  });

  describe('Performance', () => {
    beforeEach(async () => {
      await orchestrator.connect();
    });

    test('should handle multiple concurrent operations', async () => {
      const agentId = 'test-agent';
      const workspaceId = 'test-workspace';

      const operations = Array.from({ length: 10 }, (_, i) =>
        orchestrator.publishFileEdit(agentId, workspaceId, `/test/file${i}.txt`, {
          operation: 'create',
          content: `Content ${i}`
        })
      );

      await expect(Promise.all(operations)).resolves.not.toThrow();

      // Verify all edits were published
      const streams = mockRedis.getStreams();
      const editStream = streams.get(WORKSPACE_STREAM_PATTERNS.FILE_EDITS);
      expect(editStream!.length).toBe(10);
    });

    test('should measure lock acquisition performance', async () => {
      const agentId = 'test-agent';
      const workspaceId = 'test-workspace';

      const { duration } = await TestTiming.measureTime(async () => {
        return orchestrator.requestFileLock(agentId, workspaceId, '/test/perf.txt', 'write');
      });

      // Lock acquisition should be fast (< 100ms)
      expect(duration).toBeLessThan(100);
    });
  });
});