/**
 * Test utilities and helpers for workspace infrastructure testing
 */

import { EventEmitter } from 'events';
import { WorkspaceInfrastructureConfig } from '../../src/infrastructure/integration/WorkspaceInfrastructureBridge';

// Mock Redis client for testing
export class MockRedis extends EventEmitter {
  private data: Map<string, any> = new Map();
  private streams: Map<string, any[]> = new Map();
  private sets: Map<string, Set<string>> = new Map();
  private connected: boolean = false;

  async connect(): Promise<void> {
    this.connected = true;
    this.emit('connect');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.emit('disconnect');
  }

  // Basic Redis operations
  async set(key: string, value: string, ..._args: any[]): Promise<string> {
    if (!this.connected) throw new Error('Redis not connected');
    this.data.set(key, value);
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    if (!this.connected) throw new Error('Redis not connected');
    return this.data.get(key) || null;
  }

  async del(...keys: string[]): Promise<number> {
    if (!this.connected) throw new Error('Redis not connected');
    let deleted = 0;
    keys.forEach(key => {
      if (this.data.delete(key)) deleted++;
    });
    return deleted;
  }

  async hset(key: string, field: string | Record<string, any>, value?: any): Promise<number> {
    if (!this.connected) throw new Error('Redis not connected');
    let hash = this.data.get(key) || {};

    if (typeof field === 'object') {
      hash = { ...hash, ...field };
    } else {
      hash[field] = value;
    }

    this.data.set(key, hash);
    return 1;
  }

  async hget(key: string, field: string): Promise<string | null> {
    if (!this.connected) throw new Error('Redis not connected');
    const hash = this.data.get(key);
    return hash ? hash[field] || null : null;
  }

  // Set operations
  async sadd(key: string, ...members: string[]): Promise<number> {
    if (!this.connected) throw new Error('Redis not connected');
    let set = this.sets.get(key) || new Set();
    const initialSize = set.size;
    members.forEach(member => set.add(member));
    this.sets.set(key, set);
    return set.size - initialSize;
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    if (!this.connected) throw new Error('Redis not connected');
    const set = this.sets.get(key);
    if (!set) return 0;

    let removed = 0;
    members.forEach(member => {
      if (set.delete(member)) removed++;
    });

    if (set.size === 0) {
      this.sets.delete(key);
    }

    return removed;
  }

  async scard(key: string): Promise<number> {
    if (!this.connected) throw new Error('Redis not connected');
    const set = this.sets.get(key);
    return set ? set.size : 0;
  }

  // Stream operations
  async xadd(stream: string, id: string, ...args: any[]): Promise<string> {
    if (!this.connected) throw new Error('Redis not connected');
    const messages = this.streams.get(stream) || [];
    const messageId = id === '*' ? `${Date.now()}-0` : id;

    const message = { id: messageId, fields: args };
    messages.push(message);
    this.streams.set(stream, messages);

    return messageId;
  }

  async xgroup(command: string, _stream: string, _group: string, _id?: string, ..._args: string[]): Promise<string> {
    if (!this.connected) throw new Error('Redis not connected');
    if (command === 'CREATE') {
      // Just return OK for group creation
      return 'OK';
    }
    throw new Error(`Unsupported xgroup command: ${command}`);
  }

  async xreadgroup(..._args: any[]): Promise<any[]> {
    if (!this.connected) throw new Error('Redis not connected');
    // Return empty array for simplicity in tests
    return [];
  }

  async xack(_stream: string, _group: string, ...ids: string[]): Promise<number> {
    if (!this.connected) throw new Error('Redis not connected');
    return ids.length; // Acknowledge all messages
  }

  // List operations
  async lpush(key: string, ...values: string[]): Promise<number> {
    if (!this.connected) throw new Error('Redis not connected');
    let list = this.data.get(key) || [];
    list.unshift(...values);
    this.data.set(key, list);
    return list.length;
  }

  async rpop(key: string): Promise<string | null> {
    if (!this.connected) throw new Error('Redis not connected');
    const list = this.data.get(key);
    if (!list || list.length === 0) return null;

    const value = list.pop();
    if (list.length === 0) {
      this.data.delete(key);
    } else {
      this.data.set(key, list);
    }

    return value;
  }

  // Test utilities
  clear(): void {
    this.data.clear();
    this.streams.clear();
    this.sets.clear();
  }

  getData(): Map<string, any> {
    return new Map(this.data);
  }

  getStreams(): Map<string, any[]> {
    return new Map(this.streams);
  }

  isConnected(): boolean {
    return this.connected;
  }

  simulateError(error: Error): void {
    this.emit('error', error);
  }

  simulateReconnection(): void {
    this.emit('reconnecting');
  }
}

// Mock Kafka for testing
export class MockKafka {
  producer() {
    return new MockKafkaProducer();
  }

  consumer(_config: any) {
    return new MockKafkaConsumer();
  }
}

export class MockKafkaProducer extends EventEmitter {
  private connected: boolean = false;
  private simulatedError?: Error;

  async connect(): Promise<void> {
    this.connected = true;
    this.emit('producer.connect');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.emit('producer.disconnect');
  }

  async send(payload: { topic: string; messages: any[] }): Promise<any> {
    if (!this.connected) throw new Error('Producer not connected');

    // Check if an error was simulated
    if (this.simulatedError) {
      const error = this.simulatedError;
      this.simulatedError = undefined; // Reset after throwing
      throw error;
    }

    // Simulate successful send
    return payload.messages.map((_msg, index) => ({
      topicName: payload.topic,
      partition: 0,
      errorCode: 0,
      offset: Date.now() + index,
      timestamp: Date.now()
    }));
  }

  isConnected(): boolean {
    return this.connected;
  }

  simulateError(error: Error): void {
    this.simulatedError = error;
    this.emit('producer.disconnect');
  }
}

export class MockKafkaConsumer extends EventEmitter {
  private connected: boolean = false;
  private subscribed: string[] = [];
  private messageHandler?: (payload: any) => Promise<void>;

  async connect(): Promise<void> {
    this.connected = true;
    this.emit('consumer.connect');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.emit('consumer.disconnect');
  }

  async subscribe(config: { topics: string[]; fromBeginning?: boolean }): Promise<void> {
    if (!this.connected) throw new Error('Consumer not connected');
    this.subscribed = config.topics;
  }

  async run(config: { eachMessage: (payload: any) => Promise<void> }): Promise<void> {
    if (!this.connected) throw new Error('Consumer not connected');
    this.messageHandler = config.eachMessage;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getSubscribedTopics(): string[] {
    return [...this.subscribed];
  }

  simulateMessage(topic: string, partition: number, message: any): void {
    if (this.messageHandler && this.subscribed.includes(topic)) {
      this.messageHandler({
        topic,
        partition,
        message: {
          offset: Date.now().toString(),
          value: Buffer.from(JSON.stringify(message)),
          timestamp: Date.now().toString(),
          headers: {}
        }
      });
    }
  }

  simulateRawMessage(topic: string, partition: number, rawValue: string): void {
    if (this.messageHandler && this.subscribed.includes(topic)) {
      this.messageHandler({
        topic,
        partition,
        message: {
          offset: Date.now().toString(),
          value: Buffer.from(rawValue),
          timestamp: Date.now().toString(),
          headers: {}
        }
      });
    }
  }

  simulateError(error: Error): void {
    this.emit('consumer.crash', error);
  }
}

// Test configuration factory
export class TestConfigFactory {
  static createMockInfrastructureConfig(): WorkspaceInfrastructureConfig {
    return {
      redis: {
        host: 'mock-redis',
        port: 6379,
        db: 15,
        streamPrefix: 'test-autogen',
        consumerGroup: 'test-group',
        consumerName: 'test-consumer',
        maxPendingMessages: 100,
        heartbeatIntervalMs: 1000,
        lockTimeoutMs: 5000,
        messageRetentionMs: 60000
      },
      kafka: {
        clientId: 'test-autogen',
        brokers: ['mock-kafka:9092'],
        groupId: 'test-group',
        sessionTimeoutMs: 10000,
        heartbeatIntervalMs: 1000,
        retrySettings: {
          initialRetryTime: 100,
          retries: 3,
          maxRetryTime: 5000
        },
        batchSettings: {
          batchSize: 100,
          lingerMs: 1
        }
      },
      fallbackMode: 'memory',
      healthCheckIntervalMs: 1000,
      reconnectAttempts: 3,
      reconnectDelayMs: 100
    };
  }
}

// Test data factory
export class TestDataFactory {
  static createWorkspaceOperation(overrides: Partial<any> = {}) {
    return {
      id: `test-op-${Date.now()}`,
      timestamp: Date.now(),
      type: 'file_operation',
      agentId: 'test-agent',
      workspaceId: 'test-workspace',
      data: { action: 'test' },
      requiresPersistence: true,
      requiresRealtime: true,
      ...overrides
    };
  }

  static createFileEditData(overrides: Partial<any> = {}) {
    return {
      operation: 'update' as 'update' | 'create' | 'delete',
      content: 'test content',
      startLine: 1,
      endLine: 1,
      previousContent: '',
      ...overrides
    };
  }

  static createAgentInfo(overrides: Partial<any> = {}) {
    return {
      name: 'Test Agent',
      model: 'test-model',
      capabilities: ['testing'],
      workspaceId: 'test-workspace',
      ...overrides
    };
  }

  static createConsensusDecision(overrides: Partial<any> = {}) {
    return {
      proposalId: 'test-proposal',
      description: 'Test proposal',
      votes: {
        'agent-1': { vote: 'agree' as 'agree' | 'disagree' | 'abstain', reasoning: 'Good idea' }
      },
      finalDecision: 'approved' as 'approved' | 'rejected' | 'deferred',
      consensusMethod: 'majority' as 'majority' | 'unanimous' | 'delegate',
      ...overrides
    };
  }

  static createWorkspaceSnapshot(overrides: Partial<any> = {}) {
    return {
      files: {
        '/test/file.txt': 'test content'
      },
      metadata: {
        version: '1.0.0',
        timestamp: Date.now()
      },
      activeAgents: ['test-agent'],
      consensus: {},
      reason: 'Test snapshot',
      ...overrides
    };
  }
}

// Test assertion helpers
export class TestAssertions {
  static assertEventEmitted(emitter: EventEmitter, eventName: string, timeout: number = 1000): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Event '${eventName}' was not emitted within ${timeout}ms`));
      }, timeout);

      emitter.once(eventName, (data) => {
        clearTimeout(timer);
        resolve(data);
      });
    });
  }

  static async assertEventNotEmitted(emitter: EventEmitter, eventName: string, timeout: number = 500): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        resolve(); // Success - event was not emitted
      }, timeout);

      emitter.once(eventName, () => {
        clearTimeout(timer);
        reject(new Error(`Event '${eventName}' was unexpectedly emitted`));
      });
    });
  }

  static assertHealthStatus(status: any, expectedOverall: string): void {
    expect(status).toBeDefined();
    expect(status.overall).toBe(expectedOverall);
    expect(status.redis).toBeDefined();
    expect(status.kafka).toBeDefined();
    expect(typeof status.redis.connected).toBe('boolean');
    expect(typeof status.kafka.connected).toBe('boolean');
  }

  static assertWorkspaceOperation(operation: any, expectedType: string, expectedAgent: string): void {
    expect(operation).toBeDefined();
    expect(operation.type).toBe(expectedType);
    expect(operation.agentId).toBe(expectedAgent);
    expect(operation.workspaceId).toBeDefined();
    expect(operation.timestamp).toBeDefined();
    expect(operation.data).toBeDefined();
  }
}

// Test timing utilities
export class TestTiming {
  static delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  static async waitFor(condition: () => boolean | Promise<boolean>, timeout: number = 5000, interval: number = 100): Promise<void> {
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const result = await condition();
      if (result) return;
      await this.delay(interval);
    }

    throw new Error(`Condition not met within ${timeout}ms`);
  }

  static async measureTime<T>(fn: () => Promise<T>): Promise<{ result: T; duration: number }> {
    const start = Date.now();
    const result = await fn();
    const duration = Date.now() - start;
    return { result, duration };
  }
}

// Performance testing utilities
export class PerformanceTestUtils {
  static async runLoadTest(
    operation: () => Promise<any>,
    concurrency: number,
    iterations: number
  ): Promise<{
    totalTime: number;
    averageTime: number;
    successCount: number;
    errorCount: number;
    errors: Error[];
  }> {
    const start = Date.now();
    const promises: Promise<any>[] = [];
    const errors: Error[] = [];
    let successCount = 0;

    for (let i = 0; i < iterations; i++) {
      const batch: Promise<any>[] = [];

      for (let j = 0; j < concurrency && (i * concurrency + j) < iterations; j++) {
        batch.push(
          operation().then(
            () => { successCount++; },
            (error) => { errors.push(error); }
          )
        );
      }

      promises.push(...batch);

      if (batch.length === concurrency) {
        await Promise.allSettled(batch);
      }
    }

    await Promise.allSettled(promises);

    const totalTime = Date.now() - start;
    const errorCount = errors.length;

    return {
      totalTime,
      averageTime: totalTime / iterations,
      successCount,
      errorCount,
      errors
    };
  }

  static async measureThroughput(
    operation: () => Promise<any>,
    durationMs: number
  ): Promise<{
    operationsPerSecond: number;
    totalOperations: number;
    successCount: number;
    errorCount: number;
  }> {
    const start = Date.now();
    let totalOperations = 0;
    let successCount = 0;
    let errorCount = 0;

    while (Date.now() - start < durationMs) {
      try {
        await operation();
        successCount++;
      } catch (error) {
        errorCount++;
      }
      totalOperations++;
    }

    const actualDuration = Date.now() - start;
    const operationsPerSecond = (totalOperations / actualDuration) * 1000;

    return {
      operationsPerSecond,
      totalOperations,
      successCount,
      errorCount
    };
  }
}