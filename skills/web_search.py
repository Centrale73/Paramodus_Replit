"""
Skill: Web Search
Uses DuckDuckGo to search the web and return results as context.
"""
from agno.agent import Agent
from agno.tools import Toolkit
from ddgs import DDGS


class WebSearchToolkit(Toolkit):
    def __init__(self, max_results: int = 5):
        super().__init__(name="web_search")
        self.max_results = max_results
        self.register(self.search_web)

    def search_web(self, query: str) -> str:
        """Search the web for information about the given query.

        Args:
            query: The search query string.

        Returns:
            A formatted string of search results.
        """
        try:
            results = []
            with DDGS() as ddgs:
                for r in ddgs.text(query, max_results=self.max_results):
                    results.append(f"**{r['title']}**\n{r['href']}\n{r['body']}")
            if not results:
                return "No results found."
            return "\n\n---\n\n".join(results)
        except Exception as e:
            return f"Search error: {e}"


def register(agent: Agent) -> Agent:
    """Register the web search tool with the agent."""
    if agent.tools is None:
        agent.tools = []
    agent.tools.append(WebSearchToolkit())
    return agent
