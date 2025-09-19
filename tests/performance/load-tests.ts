/**
 * Performance and load tests for workspace infrastructure
 */

import { WorkspaceInfrastructureBridge } from '../../src/infrastructure/integration/WorkspaceInfrastructureBridge';
import { WorkspaceConfigPresets } from '../../src/config/WorkspaceConfig';
import { PerformanceTestUtils, TestDataFactory, TestTiming } from '../utils/TestHelpers';

describe('Performance and Load Tests', () => {
  let infrastructureBridge: WorkspaceInfrastructureBridge;

  beforeAll(async () => {
    const config = WorkspaceConfigPresets.testing();
    infrastructureBridge = new WorkspaceInfrastructureBridge(config.infrastructure);

    // Setup event listeners to suppress expected errors during load testing
    infrastructureBridge.on('error', () => { /* Expected during load tests */ });
    infrastructureBridge.on('redis_error', () => { /* Expected during load tests */ });
    infrastructureBridge.on('kafka_error', () => { /* Expected during load tests */ });

    await infrastructureBridge.initialize();
  }, 30000);

  afterAll(async () => {
    if (infrastructureBridge) {
      await infrastructureBridge.shutdown();
    }
  });

  describe('File Locking Performance', () => {
    test('should handle high concurrency lock requests', async () => {
      const workspaceId = 'perf-test-workspace';
      const concurrency = 50;
      const iterations = 200;

      const lockOperation = async () => {
        const agentId = `agent-${Math.random().toString(36).substr(2, 9)}`;
        const filePath = `/test/file-${Math.random().toString(36).substr(2, 9)}.txt`;

        const lockId = await infrastructureBridge.requestFileLock(
          agentId,
          workspaceId,
          filePath,
          'write'
        );

        if (lockId) {
          await TestTiming.delay(1); // Hold lock briefly
          await infrastructureBridge.releaseFileLock(lockId, agentId);
        }
      };

      const results = await PerformanceTestUtils.runLoadTest(
        lockOperation,
        concurrency,
        iterations
      );

      console.log('Lock Performance Results:', {
        totalTime: `${results.totalTime}ms`,
        averageTime: `${results.averageTime.toFixed(2)}ms`,
        successRate: `${(results.successCount / iterations * 100).toFixed(1)}%`,
        errorRate: `${(results.errorCount / iterations * 100).toFixed(1)}%`
      });

      // Performance expectations
      expect(results.averageTime).toBeLessThan(100); // Average < 100ms
      expect(results.successCount / iterations).toBeGreaterThan(0.8); // 80%+ success rate
    }, 60000);

    test('should measure lock acquisition throughput', async () => {
      const workspaceId = 'throughput-test-workspace';

      const lockOperation = async () => {
        const agentId = `agent-${Math.random().toString(36).substr(2, 5)}`;
        const filePath = `/test/throughput-${Date.now()}.txt`;

        const lockId = await infrastructureBridge.requestFileLock(
          agentId,
          workspaceId,
          filePath,
          'read' // Use read locks to allow concurrency
        );

        if (lockId) {
          await infrastructureBridge.releaseFileLock(lockId, agentId);
        }
      };

      const results = await PerformanceTestUtils.measureThroughput(
        lockOperation,
        5000 // 5 second test
      );

      console.log('Lock Throughput Results:', {
        operationsPerSecond: results.operationsPerSecond.toFixed(2),
        totalOperations: results.totalOperations,
        successRate: `${(results.successCount / results.totalOperations * 100).toFixed(1)}%`
      });

      // Throughput expectations
      expect(results.operationsPerSecond).toBeGreaterThan(10); // At least 10 ops/sec
      expect(results.successCount / results.totalOperations).toBeGreaterThan(0.7); // 70%+ success
    }, 30000);
  });

  describe('File Edit Performance', () => {
    test('should handle concurrent file edits', async () => {
      const workspaceId = 'edit-perf-workspace';
      const concurrency = 20;
      const iterations = 100;

      const editOperation = async () => {
        const agentId = `agent-${Math.random().toString(36).substr(2, 9)}`;
        const filePath = `/test/edit-${Math.random().toString(36).substr(2, 9)}.txt`;

        await infrastructureBridge.publishFileEdit(
          agentId,
          workspaceId,
          filePath,
          TestDataFactory.createFileEditData({
            content: `Performance test content ${Date.now()}`
          })
        );
      };

      const results = await PerformanceTestUtils.runLoadTest(
        editOperation,
        concurrency,
        iterations
      );

      console.log('Edit Performance Results:', {
        totalTime: `${results.totalTime}ms`,
        averageTime: `${results.averageTime.toFixed(2)}ms`,
        successRate: `${(results.successCount / iterations * 100).toFixed(1)}%`
      });

      // Performance expectations
      expect(results.averageTime).toBeLessThan(50); // Average < 50ms
      expect(results.successCount / iterations).toBeGreaterThan(0.9); // 90%+ success rate
    }, 30000);

    test('should measure edit publishing throughput', async () => {
      const workspaceId = 'edit-throughput-workspace';

      const editOperation = async () => {
        const agentId = `agent-${Math.random().toString(36).substr(2, 5)}`;
        const filePath = `/test/throughput-edit-${Date.now()}.txt`;

        await infrastructureBridge.publishFileEdit(
          agentId,
          workspaceId,
          filePath,
          TestDataFactory.createFileEditData({
            content: 'Throughput test content'
          })
        );
      };

      const results = await PerformanceTestUtils.measureThroughput(
        editOperation,
        3000 // 3 second test
      );

      console.log('Edit Throughput Results:', {
        operationsPerSecond: results.operationsPerSecond.toFixed(2),
        totalOperations: results.totalOperations,
        successRate: `${(results.successCount / results.totalOperations * 100).toFixed(1)}%`
      });

      // Throughput expectations
      expect(results.operationsPerSecond).toBeGreaterThan(20); // At least 20 ops/sec
      expect(results.successCount / results.totalOperations).toBeGreaterThan(0.8); // 80%+ success
    }, 15000);
  });

  describe('Agent Coordination Performance', () => {
    test('should handle many agent registrations', async () => {
      const workspaceId = 'agent-perf-workspace';
      const concurrency = 10;
      const iterations = 50;

      const registerOperation = async () => {
        const agentId = `agent-${Math.random().toString(36).substr(2, 9)}`;

        await infrastructureBridge.registerAgent(
          agentId,
          workspaceId,
          TestDataFactory.createAgentInfo({
            name: `Performance Test Agent ${agentId}`,
            capabilities: ['testing', 'performance']
          })
        );

        // Also test status updates
        await infrastructureBridge.updateAgentStatus(
          agentId,
          workspaceId,
          'active',
          'Performance testing'
        );
      };

      const results = await PerformanceTestUtils.runLoadTest(
        registerOperation,
        concurrency,
        iterations
      );

      console.log('Agent Registration Performance:', {
        totalTime: `${results.totalTime}ms`,
        averageTime: `${results.averageTime.toFixed(2)}ms`,
        successRate: `${(results.successCount / iterations * 100).toFixed(1)}%`
      });

      // Performance expectations
      expect(results.averageTime).toBeLessThan(200); // Average < 200ms
      expect(results.successCount / iterations).toBeGreaterThan(0.85); // 85%+ success rate
    }, 30000);
  });

  describe('Consensus Performance', () => {
    test('should handle concurrent consensus voting', async () => {
      const workspaceId = 'consensus-perf-workspace';
      const concurrency = 15;
      const iterations = 75;

      const voteOperation = async () => {
        const agentId = `agent-${Math.random().toString(36).substr(2, 9)}`;
        const proposalId = `proposal-${Math.floor(Math.random() * 10)}`; // Reuse some proposals

        const votes = ['agree', 'disagree', 'abstain'] as const;
        const vote = votes[Math.floor(Math.random() * votes.length)];

        await infrastructureBridge.publishConsensusVote(
          agentId,
          workspaceId,
          proposalId,
          vote,
          'Performance test vote'
        );
      };

      const results = await PerformanceTestUtils.runLoadTest(
        voteOperation,
        concurrency,
        iterations
      );

      console.log('Consensus Voting Performance:', {
        totalTime: `${results.totalTime}ms`,
        averageTime: `${results.averageTime.toFixed(2)}ms`,
        successRate: `${(results.successCount / iterations * 100).toFixed(1)}%`
      });

      // Performance expectations
      expect(results.averageTime).toBeLessThan(75); // Average < 75ms
      expect(results.successCount / iterations).toBeGreaterThan(0.9); // 90%+ success rate
    }, 25000);
  });

  describe('Mixed Workload Performance', () => {
    test('should handle mixed operations under load', async () => {
      const workspaceId = 'mixed-perf-workspace';
      const concurrency = 25;
      const iterations = 100;

      const mixedOperation = async () => {
        const agentId = `agent-${Math.random().toString(36).substr(2, 9)}`;
        const operationType = Math.floor(Math.random() * 4);

        switch (operationType) {
          case 0: // File lock
            const filePath = `/test/mixed-${Math.random().toString(36).substr(2, 9)}.txt`;
            const lockId = await infrastructureBridge.requestFileLock(
              agentId,
              workspaceId,
              filePath,
              'write'
            );
            if (lockId) {
              await infrastructureBridge.releaseFileLock(lockId, agentId);
            }
            break;

          case 1: // File edit
            await infrastructureBridge.publishFileEdit(
              agentId,
              workspaceId,
              `/test/mixed-edit-${Date.now()}.txt`,
              TestDataFactory.createFileEditData()
            );
            break;

          case 2: // Agent status update
            await infrastructureBridge.updateAgentStatus(
              agentId,
              workspaceId,
              'busy',
              'Mixed workload testing'
            );
            break;

          case 3: // Consensus vote
            await infrastructureBridge.publishConsensusVote(
              agentId,
              workspaceId,
              `proposal-${Math.floor(Math.random() * 5)}`,
              'agree',
              'Mixed workload vote'
            );
            break;
        }
      };

      const results = await PerformanceTestUtils.runLoadTest(
        mixedOperation,
        concurrency,
        iterations
      );

      console.log('Mixed Workload Performance:', {
        totalTime: `${results.totalTime}ms`,
        averageTime: `${results.averageTime.toFixed(2)}ms`,
        successRate: `${(results.successCount / iterations * 100).toFixed(1)}%`,
        throughput: `${(iterations / (results.totalTime / 1000)).toFixed(2)} ops/sec`
      });

      // Performance expectations for mixed workload
      expect(results.averageTime).toBeLessThan(150); // Average < 150ms
      expect(results.successCount / iterations).toBeGreaterThan(0.75); // 75%+ success rate
    }, 45000);
  });

  describe('Memory and Resource Usage', () => {
    test('should not leak memory during sustained operations', async () => {
      const workspaceId = 'memory-test-workspace';
      const initialMemory = process.memoryUsage();

      // Run sustained operations
      for (let i = 0; i < 1000; i++) {
        const agentId = `agent-${i}`;
        const filePath = `/test/memory-${i}.txt`;

        await infrastructureBridge.publishFileEdit(
          agentId,
          workspaceId,
          filePath,
          TestDataFactory.createFileEditData({
            content: `Memory test content ${i}`
          })
        );

        // Occasional garbage collection hint
        if (i % 100 === 0 && global.gc) {
          global.gc();
        }
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage();
      const memoryGrowth = finalMemory.heapUsed - initialMemory.heapUsed;
      const memoryGrowthMB = memoryGrowth / (1024 * 1024);

      console.log('Memory Usage:', {
        initial: `${(initialMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`,
        final: `${(finalMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`,
        growth: `${memoryGrowthMB.toFixed(2)}MB`
      });

      // Memory growth should be reasonable (< 50MB for 1000 operations)
      expect(memoryGrowthMB).toBeLessThan(50);
    }, 60000);
  });

  describe('Error Recovery Performance', () => {
    test('should maintain performance during partial infrastructure failures', async () => {
      const workspaceId = 'error-recovery-workspace';

      // Simulate Redis failure by making the health status offline
      (infrastructureBridge as any).healthStatus.redis.connected = false;

      const fallbackOperation = async () => {
        const agentId = `agent-${Math.random().toString(36).substr(2, 9)}`;
        const filePath = `/test/fallback-${Math.random().toString(36).substr(2, 9)}.txt`;

        // This should use fallback mechanisms
        const lockId = await infrastructureBridge.requestFileLock(
          agentId,
          workspaceId,
          filePath,
          'write'
        );

        if (lockId) {
          await infrastructureBridge.releaseFileLock(lockId, agentId);
        }
      };

      const results = await PerformanceTestUtils.runLoadTest(
        fallbackOperation,
        10, // Lower concurrency for fallback testing
        50
      );

      console.log('Fallback Performance Results:', {
        totalTime: `${results.totalTime}ms`,
        averageTime: `${results.averageTime.toFixed(2)}ms`,
        successRate: `${(results.successCount / 50 * 100).toFixed(1)}%`
      });

      // Fallback should still work, albeit potentially slower
      expect(results.averageTime).toBeLessThan(500); // Should be under 500ms even in fallback
      expect(results.successCount / 50).toBeGreaterThan(0.5); // At least 50% success in fallback
    }, 30000);
  });

  describe('Benchmark Baseline', () => {
    test('should establish performance baseline metrics', async () => {
      const workspaceId = 'baseline-workspace';

      // Individual operation timings
      const lockTiming = await TestTiming.measureTime(async () => {
        const lockId = await infrastructureBridge.requestFileLock(
          'baseline-agent',
          workspaceId,
          '/test/baseline.txt',
          'write'
        );
        if (lockId) {
          await infrastructureBridge.releaseFileLock(lockId, 'baseline-agent');
        }
      });

      const editTiming = await TestTiming.measureTime(async () => {
        await infrastructureBridge.publishFileEdit(
          'baseline-agent',
          workspaceId,
          '/test/baseline-edit.txt',
          TestDataFactory.createFileEditData()
        );
      });

      const agentTiming = await TestTiming.measureTime(async () => {
        await infrastructureBridge.registerAgent(
          'baseline-agent-reg',
          workspaceId,
          TestDataFactory.createAgentInfo()
        );
      });

      const voteTiming = await TestTiming.measureTime(async () => {
        await infrastructureBridge.publishConsensusVote(
          'baseline-agent',
          workspaceId,
          'baseline-proposal',
          'agree'
        );
      });

      console.log('Performance Baseline:', {
        lockOperation: `${lockTiming.duration}ms`,
        editOperation: `${editTiming.duration}ms`,
        agentOperation: `${agentTiming.duration}ms`,
        voteOperation: `${voteTiming.duration}ms`
      });

      // Baseline expectations - these define our performance targets
      expect(lockTiming.duration).toBeLessThan(100);
      expect(editTiming.duration).toBeLessThan(50);
      expect(agentTiming.duration).toBeLessThan(100);
      expect(voteTiming.duration).toBeLessThan(50);
    });
  });
});