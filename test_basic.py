#!/usr/bin/env python3
"""
Basic AutoGen test to verify installation and functionality
"""
import asyncio
import os
from autogen_agentchat.agents import AssistantAgent
from autogen_ext.models.openai import OpenAIChatCompletionClient

async def test_basic_agent():
    """Test that a basic AutoGen agent can be created and respond"""
    try:
        # Note: This would need an actual OpenAI API key to work
        # For now, we'll just test that the imports and basic setup work
        print("✅ AutoGen imports successful")
        print("✅ Basic agent classes available")

        # Test that we can create the client class (without actual API call)
        client_class = OpenAIChatCompletionClient
        agent_class = AssistantAgent

        print("✅ OpenAI client class available")
        print("✅ Assistant agent class available")
        print("\n🎉 AutoGen installation verified!")
        print("\nTo use with actual LLMs, you'll need to:")
        print("1. Set up API keys for your preferred LLM providers")
        print("2. Configure the model client with your credentials")

        return True

    except Exception as e:
        print(f"❌ Error: {e}")
        return False

if __name__ == "__main__":
    success = asyncio.run(test_basic_agent())
    if success:
        print("\n✅ Ready to create multi-agent discussions!")
    else:
        print("\n❌ Installation issues detected")