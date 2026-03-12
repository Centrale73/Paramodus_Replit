# Skills — How to Write and Register a New Skill

Skills are Python modules in the `skills/` folder that add tools to the Agno agent at startup. Each skill is auto-discovered and loaded dynamically.

## Structure

```
skills/
├── __init__.py          # empty, marks as a package
├── web_search.py        # built-in: DuckDuckGo web search
├── summarize_pdf.py     # built-in: query the local knowledge base
└── your_skill.py        # your new skill goes here
```

## Minimal Skill Template

```python
# skills/your_skill.py
from agno.agent import Agent
from agno.tools import Toolkit


class YourToolkit(Toolkit):
    def __init__(self):
        super().__init__(name="your_tool")
        self.register(self.your_function)

    def your_function(self, input: str) -> str:
        """One-line docstring shown to the LLM as the tool description.

        Args:
            input: Description of this argument.

        Returns:
            The result as a string.
        """
        # your logic here
        return f"Result for: {input}"


def register(agent: Agent) -> Agent:
    """Called automatically at startup. Must return the agent."""
    if agent.tools is None:
        agent.tools = []
    agent.tools.append(YourToolkit())
    return agent
```

## Rules

1. **File name** must not start with `_` and must end with `.py`.
2. **`register(agent)`** is the only required function — it receives the current `Agent` instance and must return it.
3. **Docstrings matter** — the LLM reads the function and argument docstrings to decide when and how to call the tool.
4. **Keep it stateless** — tools are instantiated once per agent creation. Use module-level singletons for expensive resources (e.g., API clients).
5. **Handle exceptions** — return an error string instead of raising so the agent can report the failure gracefully.

## Tips

- Use `requests` for simple HTTP calls (already installed).
- Use `ddgs` for web searches (already installed).
- If your skill needs an API key, read it from `os.environ` inside the function so it picks up keys set at runtime via the UI.
- Skills are loaded for both single-agent and team-mode Researcher agents.
