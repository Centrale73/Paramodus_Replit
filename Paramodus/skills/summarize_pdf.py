"""
Skill: Summarize / Query Knowledge Base
Exposes a tool that explicitly queries the local LanceDB knowledge base
and returns a formatted summary of the most relevant chunks.
"""
from agno.agent import Agent
from agno.tools import Toolkit


class SummarizePDFToolkit(Toolkit):
    def __init__(self):
        super().__init__(name="summarize_pdf")
        self.register(self.summarize_knowledge)

    def summarize_knowledge(self, topic: str) -> str:
        """Search the uploaded knowledge base for content related to the given topic.

        Args:
            topic: The topic or question to look up in the knowledge base.

        Returns:
            Relevant chunks from the knowledge base as a formatted string.
        """
        try:
            from agents.workspace_agent import knowledge
            results = knowledge.vector_db.search(query=topic, limit=5)
            if not results:
                return "No relevant content found in the knowledge base for that topic."
            parts = []
            for i, r in enumerate(results, 1):
                content = r.get("content", r.get("text", str(r)))
                source = r.get("meta_data", {}).get("filename", "document")
                parts.append(f"[{i}] Source: {source}\n{content}")
            return "\n\n---\n\n".join(parts)
        except Exception as e:
            return f"Knowledge base error: {e}"


def register(agent: Agent) -> Agent:
    """Register the summarize/knowledge query tool with the agent."""
    if agent.tools is None:
        agent.tools = []
    agent.tools.append(SummarizePDFToolkit())
    return agent
