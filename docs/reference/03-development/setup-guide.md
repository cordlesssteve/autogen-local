# Development Setup Guide

**Last Updated:** 2025-09-19

## Prerequisites

- Python 3.10 or later
- Git
- Virtual environment capability

## Initial Setup

### 1. Clone Repository
```bash
git clone https://github.com/cordlesssteve/autogen-local.git
cd autogen-local
```

### 2. Create Virtual Environment
```bash
python -m venv autogen-env
source autogen-env/bin/activate  # Linux/Mac
# OR
autogen-env\Scripts\activate     # Windows
```

### 3. Install Dependencies
```bash
# Core AutoGen packages
pip install -U "autogen-agentchat" "autogen-ext[openai]"

# Optional: Additional providers
pip install -U "autogen-ext[anthropic]"  # for Claude
pip install -U "autogen-ext[azure]"     # for Azure OpenAI
```

### 4. Verify Installation
```bash
python test_basic.py
```

## LLM Provider Configuration

### OpenAI Setup
```bash
export OPENAI_API_KEY="your-api-key-here"
```

### Anthropic Setup
```bash
export ANTHROPIC_API_KEY="your-api-key-here"
```

### Azure OpenAI Setup
```bash
export AZURE_OPENAI_API_KEY="your-api-key-here"
export AZURE_OPENAI_ENDPOINT="your-endpoint-here"
```

## Running the Framework

### Basic Test
```bash
python test_basic.py
```

### Planning Discussion Simulation
```bash
python planning_discussion.py
```

### With Real LLMs (after configuration)
Update the `PlaceholderModelClient` in `planning_discussion.py` with real model clients:

```python
from autogen_ext.models.openai import OpenAIChatCompletionClient

# Replace placeholder with real client
model_client = OpenAIChatCompletionClient(model="gpt-4")
```

## Development Workflow

1. **Make Changes**: Edit framework files as needed
2. **Test Locally**: Run verification scripts
3. **Document Changes**: Update relevant documentation
4. **Commit**: Use descriptive commit messages
5. **Push**: Push to your fork

## File Structure

```
autogen-local/
├── planning_discussion.py     # Main framework
├── test_basic.py             # Basic testing
├── CURRENT_STATUS.md         # Project status
├── ACTIVE_PLAN.md           # Current development plan
├── docs/                    # Documentation
│   ├── plans/              # Planning documents
│   ├── progress/           # Weekly progress logs
│   └── reference/          # Technical documentation
└── autogen-env/            # Virtual environment
```

## Common Issues

### Import Errors
- Ensure virtual environment is activated
- Verify AutoGen packages are installed
- Check Python version compatibility

### API Key Issues
- Verify environment variables are set
- Check API key validity with provider
- Ensure proper permissions/quotas

### Agent Communication Issues
- Verify LLM provider configuration
- Check network connectivity
- Review agent system messages for clarity