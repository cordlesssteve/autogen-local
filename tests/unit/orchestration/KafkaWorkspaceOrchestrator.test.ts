/**
 * Unit tests for KafkaWorkspaceOrchestrator
 */

import { KafkaWorkspaceOrchestrator, KafkaWorkspaceConfig, WORKSPACE_KAFKA_TOPICS } from '../../../src/infrastructure/orchestration/KafkaWorkspaceOrchestrator';
import { MockKafka, MockKafkaProducer, MockKafkaConsumer, TestConfigFactory, TestDataFactory, TestAssertions, TestTiming } from '../../utils/TestHelpers';

// Mock kafkajs
jest.mock('kafkajs', () => {
  return {
    Kafka: jest.fn().mockImplementation(() => new MockKafka())
  };
});

describe('KafkaWorkspaceOrchestrator', () => {
  let orchestrator: KafkaWorkspaceOrchestrator;
  let mockProducer: MockKafkaProducer;
  let mockConsumer: MockKafkaConsumer;
  let config: KafkaWorkspaceConfig;

  beforeEach(() => {
    config = TestConfigFactory.createMockInfrastructureConfig().kafka;
    orchestrator = new KafkaWorkspaceOrchestrator(config);

    // Access the mocked Kafka instances
    mockProducer = (orchestrator as any).producer as MockKafkaProducer;
    mockConsumer = (orchestrator as any).consumer as MockKafkaConsumer;
  });

  afterEach(async () => {
    if (orchestrator) {
      await orchestrator.disconnect();
    }
  });

  describe('Connection Management', () => {
    test('should connect successfully', async () => {
      const connectedPromise = TestAssertions.assertEventEmitted(orchestrator, 'connected');

      await orchestrator.connect();

      await connectedPromise;

      expect(mockProducer.isConnected()).toBe(true);
      expect(mockConsumer.isConnected()).toBe(true);
    });

    test('should disconnect successfully', async () => {
      await orchestrator.connect();

      const disconnectedPromise = TestAssertions.assertEventEmitted(orchestrator, 'disconnected');

      await orchestrator.disconnect();

      await disconnectedPromise;

      expect(mockProducer.isConnected()).toBe(false);
      expect(mockConsumer.isConnected()).toBe(false);
    });

    test('should handle connection errors', async () => {
      const connectionError = new Error('Kafka connection failed');

      // Mock producer to throw error on connect
      mockProducer.connect = jest.fn().mockRejectedValue(connectionError);

      const errorPromise = TestAssertions.assertEventEmitted(orchestrator, 'error');

      await expect(orchestrator.connect()).rejects.toThrow('Kafka connection failed');

      const emittedError = await errorPromise;
      expect(emittedError.message).toContain('Kafka connection failed');
    });

    test('should subscribe to topics on connection', async () => {
      await orchestrator.connect();

      const subscribedTopics = mockConsumer.getSubscribedTopics();

      // Should subscribe to all workspace topics
      expect(subscribedTopics).toContain(WORKSPACE_KAFKA_TOPICS.EDIT_HISTORY);
      expect(subscribedTopics).toContain(WORKSPACE_KAFKA_TOPICS.CONSENSUS_DECISIONS);
      expect(subscribedTopics).toContain(WORKSPACE_KAFKA_TOPICS.WORKSPACE_SNAPSHOTS);
      expect(subscribedTopics).toContain(WORKSPACE_KAFKA_TOPICS.AGENT_COORDINATION);
    });

    test('should emit producer and consumer events', async () => {
      const producerConnectedPromise = TestAssertions.assertEventEmitted(orchestrator, 'producer_connected');
      const consumerConnectedPromise = TestAssertions.assertEventEmitted(orchestrator, 'consumer_connected');

      await orchestrator.connect();

      await Promise.all([producerConnectedPromise, consumerConnectedPromise]);
    });
  });

  describe('File Edit Logging', () => {
    beforeEach(async () => {
      await orchestrator.connect();
    });

    test('should log file edit successfully', async () => {
      const agentId = 'test-agent';
      const workspaceId = 'test-workspace';
      const sessionId = 'test-session';
      const filePath = '/test/file.txt';
      const editData = {
        operation: 'update' as const,
        previousContent: 'old content',
        newContent: 'new content',
        patch: '@@ -1 +1 @@\n-old content\n+new content',
        startLine: 1,
        endLine: 1,
        reason: 'Test edit'
      };

      // Mock the producer.send method to capture the message
      const sendSpy = jest.spyOn(mockProducer, 'send').mockResolvedValue([]);

      await orchestrator.logFileEdit(agentId, workspaceId, sessionId, filePath, editData);

      expect(sendSpy).toHaveBeenCalledTimes(1);

      const sendCall = sendSpy.mock.calls[0][0];
      expect(sendCall.topic).toBe(WORKSPACE_KAFKA_TOPICS.EDIT_HISTORY);
      expect(sendCall.messages).toHaveLength(1);

      const message = sendCall.messages[0];
      expect(message.key).toBe(workspaceId);
      expect(message.headers?.messageType).toBe('edit_history');
      expect(message.headers?.agentId).toBe(agentId);

      const messageData = JSON.parse(message.value as string);
      expect(messageData.type).toBe('edit_history');
      expect(messageData.source).toBe(agentId);
      expect(messageData.payload.operation).toBe('update');
      expect(messageData.payload.previousContent).toBe('old content');
      expect(messageData.payload.newContent).toBe('new content');
      expect(messageData.metadata.agentId).toBe(agentId);
      expect(messageData.metadata.workspaceId).toBe(workspaceId);
      expect(messageData.metadata.filePath).toBe(filePath);
    });

    test('should handle different edit operations', async () => {
      const operations = ['create', 'update', 'delete'] as const;
      const sendSpy = jest.spyOn(mockProducer, 'send').mockResolvedValue([]);

      for (const operation of operations) {
        const editData: any = {
          operation,
          reason: `Test ${operation}`
        };

        if (operation !== 'delete') {
          editData.newContent = 'content';
        }

        await orchestrator.logFileEdit('agent', 'workspace', 'session', '/test.txt', editData);
      }

      expect(sendSpy).toHaveBeenCalledTimes(3);

      // Verify each operation was logged correctly
      for (let i = 0; i < operations.length; i++) {
        const call = sendSpy.mock.calls[i][0];
        const messageData = JSON.parse(call.messages[0].value as string);
        expect(messageData.payload.operation).toBe(operations[i]);
      }
    });
  });

  describe('Workspace Snapshot Operations', () => {
    beforeEach(async () => {
      await orchestrator.connect();
    });

    test('should save workspace snapshot', async () => {
      const agentId = 'test-agent';
      const workspaceId = 'test-workspace';
      const sessionId = 'test-session';
      const snapshot = TestDataFactory.createWorkspaceSnapshot({
        reason: 'Test snapshot'
      });

      const sendSpy = jest.spyOn(mockProducer, 'send').mockResolvedValue([]);

      await orchestrator.saveWorkspaceSnapshot(agentId, workspaceId, sessionId, snapshot);

      expect(sendSpy).toHaveBeenCalledTimes(1);

      const sendCall = sendSpy.mock.calls[0][0];
      expect(sendCall.topic).toBe(WORKSPACE_KAFKA_TOPICS.WORKSPACE_SNAPSHOTS);

      const messageData = JSON.parse(sendCall.messages[0].value as string);
      expect(messageData.type).toBe('workspace_snapshot');
      expect(messageData.payload.files).toEqual(snapshot.files);
      expect(messageData.payload.activeAgents).toEqual(snapshot.activeAgents);
      expect(messageData.payload.reason).toBe('Test snapshot');
    });

    test('should include snapshot metadata', async () => {
      const snapshot = {
        files: { '/test.txt': 'content' },
        metadata: { version: '2.0', custom: 'data' },
        activeAgents: ['agent1', 'agent2'],
        consensus: { proposal1: 'approved' },
        reason: 'Milestone reached'
      };

      const sendSpy = jest.spyOn(mockProducer, 'send').mockResolvedValue([]);

      await orchestrator.saveWorkspaceSnapshot('agent', 'workspace', 'session', snapshot);

      const messageData = JSON.parse(sendSpy.mock.calls[0][0].messages[0].value as string);
      expect(messageData.payload.metadata).toEqual(snapshot.metadata);
      expect(messageData.payload.consensus).toEqual(snapshot.consensus);
    });
  });

  describe('Consensus Decision Logging', () => {
    beforeEach(async () => {
      await orchestrator.connect();
    });

    test('should log consensus decision', async () => {
      const agentId = 'test-agent';
      const workspaceId = 'test-workspace';
      const sessionId = 'test-session';
      const decision = TestDataFactory.createConsensusDecision({
        proposalId: 'proposal-123',
        votes: {
          'agent1': { vote: 'agree', reasoning: 'Good idea' },
          'agent2': { vote: 'disagree', reasoning: 'Too risky' }
        },
        finalDecision: 'rejected',
        consensusMethod: 'unanimous'
      });

      const sendSpy = jest.spyOn(mockProducer, 'send').mockResolvedValue([]);

      await orchestrator.logConsensusDecision(agentId, workspaceId, sessionId, decision);

      expect(sendSpy).toHaveBeenCalledTimes(1);

      const sendCall = sendSpy.mock.calls[0][0];
      expect(sendCall.topic).toBe(WORKSPACE_KAFKA_TOPICS.CONSENSUS_DECISIONS);

      const messageData = JSON.parse(sendCall.messages[0].value as string);
      expect(messageData.type).toBe('consensus_decision');
      expect(messageData.payload.proposalId).toBe('proposal-123');
      expect(messageData.payload.votes).toEqual(decision.votes);
      expect(messageData.payload.finalDecision).toBe('rejected');
      expect(messageData.payload.consensusMethod).toBe('unanimous');
    });

    test('should extract consensus round from proposal ID', async () => {
      const decision = TestDataFactory.createConsensusDecision({
        proposalId: 'proposal_round_3_architecture'
      });

      const sendSpy = jest.spyOn(mockProducer, 'send').mockResolvedValue([]);

      await orchestrator.logConsensusDecision('agent', 'workspace', 'session', decision);

      const messageData = JSON.parse(sendSpy.mock.calls[0][0].messages[0].value as string);
      expect(messageData.metadata.consensusRound).toBe(3);
    });

    test('should default to round 1 if no round in proposal ID', async () => {
      const decision = TestDataFactory.createConsensusDecision({
        proposalId: 'simple-proposal'
      });

      const sendSpy = jest.spyOn(mockProducer, 'send').mockResolvedValue([]);

      await orchestrator.logConsensusDecision('agent', 'workspace', 'session', decision);

      const messageData = JSON.parse(sendSpy.mock.calls[0][0].messages[0].value as string);
      expect(messageData.metadata.consensusRound).toBe(1);
    });
  });

  describe('Agent Coordination Logging', () => {
    beforeEach(async () => {
      await orchestrator.connect();
    });

    test('should log agent coordination', async () => {
      const agentId = 'test-agent';
      const workspaceId = 'test-workspace';
      const sessionId = 'test-session';
      const coordination = {
        type: 'delegation' as const,
        targetAgent: 'target-agent',
        task: 'Review code changes',
        dependencies: ['task1', 'task2'],
        expectedDuration: 3600000, // 1 hour
        priority: 'high' as const
      };

      const sendSpy = jest.spyOn(mockProducer, 'send').mockResolvedValue([]);

      await orchestrator.logAgentCoordination(agentId, workspaceId, sessionId, coordination);

      expect(sendSpy).toHaveBeenCalledTimes(1);

      const sendCall = sendSpy.mock.calls[0][0];
      expect(sendCall.topic).toBe(WORKSPACE_KAFKA_TOPICS.AGENT_COORDINATION);

      const messageData = JSON.parse(sendCall.messages[0].value as string);
      expect(messageData.type).toBe('agent_coordination');
      expect(messageData.target).toBe('target-agent');
      expect(messageData.priority).toBe('high');
      expect(messageData.payload.coordinationType).toBe('delegation');
      expect(messageData.payload.task).toBe('Review code changes');
      expect(messageData.payload.dependencies).toEqual(['task1', 'task2']);
      expect(messageData.metadata.requiresResponse).toBe(true); // delegation requires response
    });

    test('should handle different coordination types', async () => {
      const coordinationTypes = ['handoff', 'collaboration', 'delegation', 'synchronization'] as const;
      const sendSpy = jest.spyOn(mockProducer, 'send').mockResolvedValue([]);

      for (const type of coordinationTypes) {
        await orchestrator.logAgentCoordination('agent', 'workspace', 'session', {
          type,
          task: `Test ${type}`,
          priority: 'medium'
        });
      }

      expect(sendSpy).toHaveBeenCalledTimes(4);

      // Verify each coordination type was logged correctly
      for (let i = 0; i < coordinationTypes.length; i++) {
        const call = sendSpy.mock.calls[i][0];
        const messageData = JSON.parse(call.messages[0].value as string);
        expect(messageData.payload.coordinationType).toBe(coordinationTypes[i]);

        // Only delegation should require response
        if (coordinationTypes[i] === 'delegation') {
          expect(messageData.metadata.requiresResponse).toBe(true);
        } else {
          expect(messageData.metadata.requiresResponse).toBe(false);
        }
      }
    });
  });

  describe('Conflict Resolution Logging', () => {
    beforeEach(async () => {
      await orchestrator.connect();
    });

    test('should log conflict resolution', async () => {
      const agentId = 'test-agent';
      const workspaceId = 'test-workspace';
      const sessionId = 'test-session';
      const conflict = {
        conflictId: 'conflict-123',
        type: 'edit_collision' as const,
        involvedAgents: ['agent1', 'agent2'],
        conflictDetails: {
          file: '/test.txt',
          line: 42,
          originalContent: 'old',
          conflictingEdits: ['edit1', 'edit2']
        },
        resolutionMethod: 'consensus_vote' as const,
        resolution: {
          chosenEdit: 'edit1',
          reason: 'Better implementation'
        },
        outcome: 'resolved' as const
      };

      const sendSpy = jest.spyOn(mockProducer, 'send').mockResolvedValue([]);

      await orchestrator.logConflictResolution(agentId, workspaceId, sessionId, conflict);

      expect(sendSpy).toHaveBeenCalledTimes(1);

      const sendCall = sendSpy.mock.calls[0][0];
      expect(sendCall.topic).toBe(WORKSPACE_KAFKA_TOPICS.CONFLICT_RESOLUTION);

      const messageData = JSON.parse(sendCall.messages[0].value as string);
      expect(messageData.type).toBe('conflict_resolution');
      expect(messageData.payload.conflictId).toBe('conflict-123');
      expect(messageData.payload.conflictType).toBe('edit_collision');
      expect(messageData.payload.involvedAgents).toEqual(['agent1', 'agent2']);
      expect(messageData.payload.outcome).toBe('resolved');
      expect(messageData.metadata.correlationId).toBe('conflict-123');
    });
  });

  describe('Session Management', () => {
    beforeEach(async () => {
      await orchestrator.connect();
    });

    test('should start workspace session', async () => {
      const agentId = 'test-agent';
      const workspaceId = 'test-workspace';
      const sessionId = 'test-session';
      const sessionData = {
        participants: ['agent1', 'agent2', 'agent3'],
        goal: 'Implement new feature',
        timeLimit: 3600000, // 1 hour
        consensusThreshold: 0.67
      };

      const sendSpy = jest.spyOn(mockProducer, 'send').mockResolvedValue([]);

      await orchestrator.startWorkspaceSession(agentId, workspaceId, sessionId, sessionData);

      expect(sendSpy).toHaveBeenCalledTimes(1);

      const sendCall = sendSpy.mock.calls[0][0];
      expect(sendCall.topic).toBe(WORKSPACE_KAFKA_TOPICS.SESSION_MANAGEMENT);

      const messageData = JSON.parse(sendCall.messages[0].value as string);
      expect(messageData.payload.eventType).toBe('session_start');
      expect(messageData.payload.participants).toEqual(sessionData.participants);
      expect(messageData.payload.goal).toBe(sessionData.goal);
      expect(messageData.metadata.sessionId).toBe(sessionId);
    });

    test('should end workspace session', async () => {
      const agentId = 'test-agent';
      const workspaceId = 'test-workspace';
      const sessionId = 'test-session';
      const sessionResult = {
        outcome: 'completed' as const,
        finalState: { files: 5, decisions: 3 },
        decisions: ['decision1', 'decision2'],
        participants: ['agent1', 'agent2'],
        summary: 'Session completed successfully'
      };

      const sendSpy = jest.spyOn(mockProducer, 'send').mockResolvedValue([]);

      await orchestrator.endWorkspaceSession(agentId, workspaceId, sessionId, sessionResult);

      const messageData = JSON.parse(sendSpy.mock.calls[0][0].messages[0].value as string);
      expect(messageData.payload.eventType).toBe('session_end');
      expect(messageData.payload.outcome).toBe('completed');
      expect(messageData.payload.finalState).toEqual(sessionResult.finalState);
      expect(messageData.payload.summary).toBe(sessionResult.summary);
    });
  });

  describe('Message Handling', () => {
    beforeEach(async () => {
      await orchestrator.connect();
    });

    test('should process incoming messages', async () => {
      const messagePromise = TestAssertions.assertEventEmitted(orchestrator, 'workspace_kafka_message');

      const mockMessage = {
        id: 'msg-123',
        timestamp: Date.now(),
        type: 'edit_history',
        source: 'test-agent',
        payload: { operation: 'update' },
        metadata: { agentId: 'test-agent', workspaceId: 'test-workspace' }
      };

      // Simulate incoming message
      mockConsumer.simulateMessage(WORKSPACE_KAFKA_TOPICS.EDIT_HISTORY, 0, mockMessage);

      const receivedEvent = await messagePromise;
      expect(receivedEvent.topic).toBe(WORKSPACE_KAFKA_TOPICS.EDIT_HISTORY);
      expect(receivedEvent.message).toEqual(mockMessage);
    });

    test('should handle message processing errors', async () => {
      const errorPromise = TestAssertions.assertEventEmitted(orchestrator, 'error');

      // Simulate message with invalid JSON
      mockConsumer.simulateRawMessage(WORKSPACE_KAFKA_TOPICS.EDIT_HISTORY, 0, '{invalid-json}');

      const error = await errorPromise;
      expect(error.message).toContain('Message handling failed');
    });
  });

  describe('Error Handling', () => {
    test('should handle producer errors', async () => {
      await orchestrator.connect();

      const error = new Error('Producer send failed');
      mockProducer.simulateError(error);

      // Producer error should be handled gracefully
      await expect(
        orchestrator.logFileEdit('agent', 'workspace', 'session', '/test.txt', {
          operation: 'create',
          newContent: 'test'
        })
      ).rejects.toThrow('Producer send failed');
    });

    test('should handle consumer crashes', async () => {
      await orchestrator.connect();

      const errorPromise = TestAssertions.assertEventEmitted(orchestrator, 'error');

      const consumerError = new Error('Consumer crashed');
      mockConsumer.simulateError(consumerError);

      const emittedError = await errorPromise;
      expect(emittedError.message).toContain('Consumer crashed');
    });

    test('should handle disconnection gracefully', async () => {
      await orchestrator.connect();

      const disconnectedPromise = TestAssertions.assertEventEmitted(orchestrator, 'disconnected');

      await orchestrator.disconnect();

      await disconnectedPromise;
    });
  });

  describe('Performance', () => {
    beforeEach(async () => {
      await orchestrator.connect();
    });

    test('should handle multiple concurrent messages', async () => {
      const sendSpy = jest.spyOn(mockProducer, 'send').mockResolvedValue([]);

      const operations = Array.from({ length: 100 }, (_, i) =>
        orchestrator.logFileEdit(`agent-${i}`, 'workspace', 'session', `/test${i}.txt`, {
          operation: 'create',
          newContent: `Content ${i}`
        })
      );

      await expect(Promise.all(operations)).resolves.not.toThrow();

      expect(sendSpy).toHaveBeenCalledTimes(100);
    });

    test('should measure message publishing performance', async () => {
      jest.spyOn(mockProducer, 'send').mockResolvedValue([]);

      const { duration } = await TestTiming.measureTime(async () => {
        return orchestrator.logFileEdit('agent', 'workspace', 'session', '/test.txt', {
          operation: 'update',
          newContent: 'test content'
        });
      });

      // Message publishing should be fast (< 50ms)
      expect(duration).toBeLessThan(50);
    });
  });

  describe('Message Sequencing', () => {
    beforeEach(async () => {
      await orchestrator.connect();
    });

    test('should increment sequence numbers', async () => {
      const sendSpy = jest.spyOn(mockProducer, 'send').mockResolvedValue([]);

      // Send multiple messages
      await orchestrator.logFileEdit('agent', 'workspace', 'session', '/test1.txt', {
        operation: 'create',
        newContent: 'content1'
      });

      await orchestrator.logFileEdit('agent', 'workspace', 'session', '/test2.txt', {
        operation: 'create',
        newContent: 'content2'
      });

      expect(sendSpy).toHaveBeenCalledTimes(2);

      // Check sequence numbers
      const message1 = JSON.parse(sendSpy.mock.calls[0][0].messages[0].value as string);
      const message2 = JSON.parse(sendSpy.mock.calls[1][0].messages[0].value as string);

      expect(message1.metadata.sequenceNumber).toBe(1);
      expect(message2.metadata.sequenceNumber).toBe(2);
    });
  });
});