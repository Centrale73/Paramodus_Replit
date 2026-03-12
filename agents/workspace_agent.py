import os
import importlib
import tempfile
from typing import List, Dict, Optional

from agno.agent import Agent
from agno.team import Team
from agno.models.openai import OpenAIChat
from agno.models.openai.like import OpenAILike
from agno.models.anthropic import Claude
from agno.models.google import Gemini
from agno.models.groq import Groq
from agno.models.openrouter import OpenRouter
from agno.models.perplexity import Perplexity
from agno.models.xai import xAI
from agno.models.ollama import Ollama
from agno.db.sqlite import SqliteDb
from agno.knowledge.knowledge import Knowledge
from agno.vectordb.lancedb import LanceDb
from agno.knowledge.embedder.fastembed import FastEmbedEmbedder
from agno.knowledge.reader.pdf_reader import PDFReader
from agno.knowledge.reader.csv_reader import CSVReader
from agno.knowledge.reader.text_reader import TextReader
from agno.knowledge.chunking.recursive import RecursiveChunking

app_data = os.path.join(os.path.expanduser("~"), ".myapp")
os.makedirs(app_data, exist_ok=True)

db = SqliteDb(db_file=os.path.join(app_data, "memory.db"))

LANCE_URI = os.path.join(app_data, "lancedb")

knowledge = Knowledge(
    vector_db=LanceDb(
        table_name="user_documents",
        uri=LANCE_URI,
        embedder=FastEmbedEmbedder(
            id="BAAI/bge-small-en-v1.5",
            dimensions=384
        ),
    ),
)

DEFAULT_CHUNKER = RecursiveChunking(chunk_size=1000, overlap=200)

USER_ID = "local_user"

DEFAULT_MODELS = {
    "openai": "gpt-4o",
    "anthropic": "claude-sonnet-4-5-20250929",
    "gemini": "gemini-2.0-flash-001",
    "groq": "llama-3.3-70b-versatile",
    "grok": "grok-3",
    "openrouter": "openai/gpt-4o-mini",
    "perplexity": "sonar-pro",
    # Local providers — user sets model name themselves
    "ollama": "llama3.2",
    "local": "local-model",
}


# ── Skill loader ──────────────────────────────────────────────────────────────

def _load_skills(agent: Agent) -> Agent:
    """Dynamically import every module in skills/ and call register(agent)."""
    skills_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "skills")
    if not os.path.isdir(skills_dir):
        return agent
    for fname in sorted(os.listdir(skills_dir)):
        if fname.startswith("_") or not fname.endswith(".py"):
            continue
        module_name = f"skills.{fname[:-3]}"
        try:
            mod = importlib.import_module(module_name)
            if hasattr(mod, "register"):
                agent = mod.register(agent)
                print(f"  ✓ Skill loaded: {module_name}")
        except Exception as e:
            print(f"  ✗ Skill failed ({module_name}): {e}")
    return agent


# ── Model factory ─────────────────────────────────────────────────────────────

def get_model(provider: str, api_key: Optional[str] = None, model_id: Optional[str] = None,
              base_url: Optional[str] = None):
    if not model_id:
        model_id = DEFAULT_MODELS.get(provider)

    if provider == "openai":
        return OpenAIChat(id=model_id, api_key=api_key)
    elif provider == "anthropic":
        return Claude(id=model_id, api_key=api_key)
    elif provider == "gemini":
        return Gemini(id=model_id, api_key=api_key)
    elif provider == "groq":
        return Groq(id=model_id, api_key=api_key)
    elif provider == "grok":
        return xAI(id=model_id, api_key=api_key)
    elif provider == "openrouter":
        return OpenRouter(id=model_id, api_key=api_key)
    elif provider == "perplexity":
        return Perplexity(id=model_id, api_key=api_key)
    elif provider == "ollama":
        # Ollama runs locally — no API key needed.
        # base_url defaults to http://localhost:11434 inside the Ollama class.
        host = base_url or os.environ.get("OLLAMA_HOST", "http://localhost:11434")
        return Ollama(id=model_id, host=host)
    elif provider == "local":
        # Generic OpenAI-compatible endpoint (LM Studio, vLLM, llama.cpp server, etc.)
        endpoint = base_url or os.environ.get("LOCAL_MODEL_URL", "http://localhost:1234/v1")
        return OpenAILike(id=model_id, base_url=endpoint, api_key=api_key or "not-needed")
    else:
        print(f"Warning: Unknown provider '{provider}', falling back to OpenAI")
        return OpenAIChat(id=model_id or "gpt-4o", api_key=api_key)


# ── Single agent ──────────────────────────────────────────────────────────────

def get_agent(
    provider: str = "openai",
    api_key: Optional[str] = None,
    model_id: Optional[str] = None,
    user_id: str = USER_ID,
    session_id: str = "workspace_main_session",
    enable_rag: bool = True,
    system_prompt: Optional[str] = None,
    load_skills: bool = True,
    base_url: Optional[str] = None,
) -> Agent:
    """Return a configured Agno Agent, optionally with group system_prompt and skills."""
    description = system_prompt or "You are a professional workspace assistant with access to uploaded documents."

    agent_config = {
        "model": get_model(provider, api_key, model_id, base_url),
        "session_id": session_id,
        "markdown": True,
        "description": description,
        "db": db,
        "enable_user_memories": True,
        "add_memories_to_context": True,
        "add_history_to_context": True,
        "num_history_runs": 5,
    }

    if enable_rag:
        agent_config["knowledge"] = knowledge
        agent_config["search_knowledge"] = True

    agent = Agent(**agent_config)

    if load_skills:
        agent = _load_skills(agent)

    return agent


# ── Team (swarm) mode ─────────────────────────────────────────────────────────

def get_team(
    provider: str = "groq",
    api_key: Optional[str] = None,
    session_id: str = "team_session",
    system_prompt: Optional[str] = None,
    base_url: Optional[str] = None,
) -> Team:
    """Return a Researcher + Writer team. Uses Groq Llama3 for speed/cost."""
    model = get_model(provider, api_key, base_url=base_url)

    researcher = Agent(
        model=model,
        name="Researcher",
        role="Research and gather information on the topic thoroughly",
        markdown=True,
        description="You are an expert researcher. Gather facts, context, and relevant details.",
    )
    researcher = _load_skills(researcher)

    writer = Agent(
        model=model,
        name="Writer",
        role="Write a clear, well-structured response based on the research",
        markdown=True,
        description="You are an expert writer. Synthesise research into a polished, readable answer.",
    )

    team = Team(
        members=[researcher, writer],
        model=model,
        session_id=session_id,
        markdown=True,
        description=system_prompt or "A collaborative research and writing team.",
        mode="coordinate",
    )
    return team


# ── RAG service functions ─────────────────────────────────────────────────────

def ingest_files(files: List[Dict]) -> bool:
    all_docs = []
    for file_info in files:
        name = file_info["name"]
        data = file_info["data"]
        with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(name)[1]) as tmp:
            tmp.write(data)
            tmp_path = tmp.name
        try:
            if name.lower().endswith(".pdf"):
                reader = PDFReader(chunking_strategy=DEFAULT_CHUNKER)
                docs = reader.read(tmp_path)
            elif name.lower().endswith(".csv"):
                reader = CSVReader(chunking_strategy=DEFAULT_CHUNKER)
                docs = reader.read(tmp_path)
            elif name.lower().endswith((".txt", ".md", ".py", ".js", ".json")):
                reader = TextReader(chunking_strategy=DEFAULT_CHUNKER)
                docs = reader.read(tmp_path)
            else:
                print(f"Unsupported file type: {name}")
                continue
            for doc in docs:
                doc.meta_data["filename"] = name
            all_docs.extend(docs)
        except Exception as e:
            print(f"Error processing {name}: {e}")
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

    if all_docs:
        knowledge.load_documents(all_docs, upsert=True)
        print(f"✓ Ingested {len(all_docs)} chunks from {len(files)} files")
        return True
    print("⚠ No documents were ingested")
    return False


def clear_knowledge_base() -> bool:
    try:
        import lancedb
        db_conn = lancedb.connect(LANCE_URI)
        if "user_documents" in db_conn.table_names():
            db_conn.drop_table("user_documents")
        knowledge.vector_db.create()
        return True
    except Exception as e:
        print(f"Error clearing knowledge base: {e}")
        return False
