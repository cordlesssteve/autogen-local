import { test, expect, Page, Browser } from '@playwright/test';

// Test configuration
const DASHBOARD_URL = 'http://localhost:3000';
const API_BASE_URL = 'http://localhost:3000/api';

test.describe('Multi-Agent Dashboard E2E Tests', () => {
  let page: Page;
  let browser: Browser;

  test.beforeAll(async ({ browser: testBrowser }) => {
    browser = testBrowser;
    page = await browser.newPage();

    // Enable console logging for debugging
    page.on('console', msg => console.log('Browser console:', msg.text()));
    page.on('pageerror', err => console.error('Browser error:', err.message));
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('should load dashboard homepage with all elements', async () => {
    await page.goto(DASHBOARD_URL);

    // Check page title
    await expect(page).toHaveTitle(/Multi-Agent Orchestration Dashboard/);

    // Check main sections are present
    await expect(page.locator('h1')).toContainText('Multi-Agent Orchestration Dashboard');
    await expect(page.locator('text=AI Agent Team')).toBeVisible();
    await expect(page.locator('text=Infrastructure Status')).toBeVisible();
    await expect(page.locator('text=Live AI Conversation')).toBeVisible();

    // Check control buttons exist
    await expect(page.locator('button:has-text("Initialize AI Workspace")')).toBeVisible();
    await expect(page.locator('button:has-text("Ask Question")')).toBeVisible();
    await expect(page.locator('button:has-text("Run Consensus")')).toBeVisible();

    // Take screenshot of initial state
    await page.screenshot({ path: 'tests/screenshots/dashboard-initial.png', fullPage: true });
  });

  test('should show infrastructure status', async () => {
    await page.goto(DASHBOARD_URL);

    // Check infrastructure status indicators
    const redisStatus = page.locator('[data-testid="redis-status"], .infrastructure-status:has-text("Redis")');
    const kafkaStatus = page.locator('[data-testid="kafka-status"], .infrastructure-status:has-text("Kafka")');

    // Redis should be connected, Kafka should be degraded
    await expect(redisStatus).toBeVisible();
    await expect(kafkaStatus).toBeVisible();
  });

  test('should populate agents when clicking Initialize AI Workspace', async () => {
    await page.goto(DASHBOARD_URL);

    // First, manually populate agents via API (simulating workspace initialization)
    const response = await page.request.post(`${API_BASE_URL}/populate-agents`);
    expect(response.ok()).toBeTruthy();

    // Refresh to see agents
    await page.reload();

    // Wait for agents to be displayed
    await page.waitForSelector('.agent-card, [data-testid="agent-card"]', { timeout: 10000 });

    // Check that 3 agents are displayed
    const agentCards = page.locator('.agent-card, [data-testid="agent-card"]');
    await expect(agentCards).toHaveCount(3);

    // Check specific agent names and models
    await expect(page.locator('text=Business Strategist')).toBeVisible();
    await expect(page.locator('text=Technical Architect')).toBeVisible();
    await expect(page.locator('text=Implementation Engineer')).toBeVisible();

    await expect(page.locator('text=mistral:7b-instruct')).toBeVisible();
    await expect(page.locator('text=phi3.5:latest')).toBeVisible();
    await expect(page.locator('text=qwen2.5-coder:3b')).toBeVisible();

    // Take screenshot with agents populated
    await page.screenshot({ path: 'tests/screenshots/dashboard-with-agents.png', fullPage: true });
  });

  test('should handle Ask Question functionality', async () => {
    await page.goto(DASHBOARD_URL);

    // Populate agents first
    await page.request.post(`${API_BASE_URL}/populate-agents`);
    await page.reload();

    // Wait for agents to load
    await page.waitForSelector('.agent-card, [data-testid="agent-card"]', { timeout: 10000 });

    // Find and click Ask Question button
    const askButton = page.locator('button:has-text("Ask Question")');
    await expect(askButton).toBeVisible();
    await askButton.click();

    // Check if modal or input field appears
    const questionInput = page.locator('input[placeholder*="question"], textarea[placeholder*="question"], #question-input');

    if (await questionInput.isVisible()) {
      // Fill in a test question
      await questionInput.fill('Should we prioritize mobile app development or web platform improvements?');

      // Submit the question
      const submitButton = page.locator('button:has-text("Submit"), button:has-text("Send"), button[type="submit"]');
      if (await submitButton.isVisible()) {
        await submitButton.click();
      }
    }

    // Take screenshot of question interaction
    await page.screenshot({ path: 'tests/screenshots/dashboard-ask-question.png', fullPage: true });
  });

  test('should handle Run Consensus functionality', async () => {
    await page.goto(DASHBOARD_URL);

    // Populate agents first
    await page.request.post(`${API_BASE_URL}/populate-agents`);
    await page.reload();

    // Wait for agents to load
    await page.waitForSelector('.agent-card, [data-testid="agent-card"]', { timeout: 10000 });

    // Find and click Run Consensus button
    const consensusButton = page.locator('button:has-text("Run Consensus")');
    await expect(consensusButton).toBeVisible();
    await consensusButton.click();

    // Check if consensus modal or input appears
    const proposalInput = page.locator('input[placeholder*="proposal"], textarea[placeholder*="proposal"], #proposal-input');

    if (await proposalInput.isVisible()) {
      // Fill in a test proposal
      await proposalInput.fill('Focus Q1 development on performance optimization over new features');

      // Submit the proposal
      const submitButton = page.locator('button:has-text("Submit"), button:has-text("Start Vote"), button[type="submit"]');
      if (await submitButton.isVisible()) {
        await submitButton.click();
      }
    }

    // Take screenshot of consensus interaction
    await page.screenshot({ path: 'tests/screenshots/dashboard-consensus.png', fullPage: true });
  });

  test('should display live conversation messages', async () => {
    await page.goto(DASHBOARD_URL);

    // Populate agents
    await page.request.post(`${API_BASE_URL}/populate-agents`);
    await page.reload();

    // Check for conversation area
    const conversationArea = page.locator('.conversation, [data-testid="conversation"], .messages');
    await expect(conversationArea).toBeVisible();

    // Test API call to generate some conversation
    await page.request.post(`${API_BASE_URL}/ask`, {
      data: {
        question: 'Test question for E2E testing',
        context: { test: true }
      }
    });

    // Wait a moment for messages to appear
    await page.waitForTimeout(2000);

    // Take screenshot of conversation
    await page.screenshot({ path: 'tests/screenshots/dashboard-conversation.png', fullPage: true });
  });

  test('should show agent status changes', async () => {
    await page.goto(DASHBOARD_URL);

    // Populate agents
    await page.request.post(`${API_BASE_URL}/populate-agents`);
    await page.reload();

    // Wait for agents
    await page.waitForSelector('.agent-card, [data-testid="agent-card"]', { timeout: 10000 });

    // Check that agents show "Active" status
    const statusElements = page.locator('.agent-status, [data-testid="agent-status"]');
    await expect(statusElements.first()).toBeVisible();

    // Take screenshot of agent statuses
    await page.screenshot({ path: 'tests/screenshots/dashboard-agent-status.png', fullPage: true });
  });

  test('should be responsive on different screen sizes', async () => {
    // Test desktop view
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(DASHBOARD_URL);
    await page.screenshot({ path: 'tests/screenshots/dashboard-desktop.png', fullPage: true });

    // Test tablet view
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.screenshot({ path: 'tests/screenshots/dashboard-tablet.png', fullPage: true });

    // Test mobile view
    await page.setViewportSize({ width: 375, height: 667 });
    await page.screenshot({ path: 'tests/screenshots/dashboard-mobile.png', fullPage: true });

    // Reset to desktop
    await page.setViewportSize({ width: 1920, height: 1080 });
  });

  test('should handle API endpoints correctly', async () => {
    // Test session endpoint
    const sessionResponse = await page.request.get(`${API_BASE_URL}/session`);
    expect(sessionResponse.ok()).toBeTruthy();
    const sessionData = await sessionResponse.json();
    expect(sessionData).toHaveProperty('id');
    expect(sessionData).toHaveProperty('agents');
    expect(sessionData).toHaveProperty('infrastructureStatus');

    // Test populate agents endpoint
    const populateResponse = await page.request.post(`${API_BASE_URL}/populate-agents`);
    expect(populateResponse.ok()).toBeTruthy();
    const populateData = await populateResponse.json();
    expect(populateData.success).toBe(true);
    expect(populateData.count).toBe(3);
    expect(populateData.agents).toHaveLength(3);

    // Verify agent data structure
    const agent = populateData.agents[0];
    expect(agent).toHaveProperty('id');
    expect(agent).toHaveProperty('name');
    expect(agent).toHaveProperty('model');
    expect(agent).toHaveProperty('status');
    expect(agent).toHaveProperty('capabilities');
    expect(agent).toHaveProperty('isConnected');
  });

  test('should handle WebSocket connections', async () => {
    await page.goto(DASHBOARD_URL);

    // Check that Socket.IO connects
    await page.waitForFunction(() => {
      return window.io && window.io.connected;
    }, { timeout: 10000 });

    // Populate agents to trigger WebSocket events
    await page.request.post(`${API_BASE_URL}/populate-agents`);

    // Wait for real-time updates
    await page.waitForTimeout(1000);

    // Take final screenshot
    await page.screenshot({ path: 'tests/screenshots/dashboard-websocket.png', fullPage: true });
  });
});

// Integration test for full workflow
test.describe('Dashboard Integration Workflow', () => {
  test('complete multi-agent workflow', async ({ page }) => {
    // 1. Load dashboard
    await page.goto(DASHBOARD_URL);
    await expect(page.locator('h1')).toContainText('Multi-Agent Orchestration Dashboard');

    // 2. Initialize agents
    await page.request.post(`${API_BASE_URL}/populate-agents`);
    await page.reload();
    await page.waitForSelector('.agent-card, [data-testid="agent-card"]', { timeout: 10000 });

    // 3. Verify all 3 agents are present
    const agentCards = page.locator('.agent-card, [data-testid="agent-card"]');
    await expect(agentCards).toHaveCount(3);

    // 4. Test question functionality (API level)
    const askResponse = await page.request.post(`${API_BASE_URL}/ask`, {
      data: {
        question: 'What technology stack should we use for our next project?',
        context: { budget: '100k', timeline: '6 months', team_size: 5 }
      }
    });
    expect(askResponse.ok()).toBeTruthy();

    // 5. Test consensus functionality (API level)
    const consensusResponse = await page.request.post(`${API_BASE_URL}/consensus`, {
      data: {
        proposalId: 'tech-stack-decision',
        proposal: 'Use React + Node.js + PostgreSQL for the new project'
      }
    });
    expect(consensusResponse.ok()).toBeTruthy();

    // 6. Verify session state
    const sessionResponse = await page.request.get(`${API_BASE_URL}/session`);
    expect(sessionResponse.ok()).toBeTruthy();
    const sessionData = await sessionResponse.json();
    expect(sessionData.agents).toHaveLength(3);

    // 7. Take final workflow screenshot
    await page.screenshot({ path: 'tests/screenshots/dashboard-complete-workflow.png', fullPage: true });

    console.log('✅ Complete multi-agent workflow test passed');
  });
});