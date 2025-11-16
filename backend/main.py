# main.py
import os
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from typing import List, TypedDict
from pydantic import BaseModel, Field
from dotenv import load_dotenv

from langchain_core.documents import Document
from langchain_chroma import Chroma
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_core.prompts import ChatPromptTemplate
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.output_parsers import StrOutputParser
from langchain_community.tools.tavily_search import TavilySearchResults
from langgraph.graph import END, StateGraph, START


load_dotenv()
# --- 1. Set API Keys (Ensure these are set in your environment) ---
if "GOOGLE_API_KEY" not in os.environ:
    print("GOOGLE_API_KEY not set. Please set it.")
    exit()
if "TAVILY_API_KEY" not in os.environ:
    print("TAVILY_API_KEY not set. Please set it.")
    exit()

# --- 2. Graph State  ---
class GraphState(TypedDict):
    """
    Represents the state of our graph.

    Attributes:
        question: question
        generation: LLM generation
        web_search: whether to add search
        documents: list of documents
    """
    question: str
    generation: str
    web_search: str
    documents: List[Document] 

# --- 3. LLMs and Tools (Adapted from notebook + our Gemini plan) ---

# Vectorstore Retriever (From notebook cell 6, but persistent)
CHROMA_PATH = "./aegis_db"
COLLECTION_NAME = "ai_docs_stale"
embedding_function = GoogleGenerativeAIEmbeddings(model="models/gemini-embedding-001")
vectorstore = Chroma(
    collection_name=COLLECTION_NAME,
    embedding_function=embedding_function,
    persist_directory=CHROMA_PATH
)

def retriever(query):
    # Use Chroma's similarity search
    return vectorstore.similarity_search(query, k=4)

# Grader Data Model (From notebook cell 8)
class GradeDocuments(BaseModel):
    """Binary score for relevance check on retrieved documents."""
    binary_score: str = Field(description="Is the document 'STALE' (outdated) or 'CORRECT' (up-to-date)?")

# LLMs (Using Gemini as planned)
llm_flash = ChatGoogleGenerativeAI(model="gemini-2.5-flash", temperature=0)
llm_pro = ChatGoogleGenerativeAI(model="gemini-2.5-pro", temperature=0,max_output_tokens = 8192)

# Grader Prompt 
system_grader = (
    "You are an expert Senior AI Engineer acting as a 'Staleness Grader'."
    "Your job is to assess if a retrieved document is 'STALE' (outdated) or 'CORRECT' (up-to-date) based on 2025 best practices."
    "The document comes from a 2023-2024 knowledge base. Code, import paths, or methods from that era are *likely* deprecated."

    "**Your Goal:**"
    "Read the document. If it contains code or 'best practices' that are clearly outdated by 2025 standards, you must grade it as **'STALE'**."
    "If the document seems general, conceptual, or uses modern (2025) syntax, grade it as **'CORRECT'**."

    "Use these examples as a guide, but also use your general knowledge of the 2025 AI stack to catch other outdated patterns."
    "Give a binary score: 'STALE' or 'CORRECT'."
)
grade_prompt = ChatPromptTemplate.from_messages(
    [
        ("system", system_grader),
        ("human", "Retrieved document:\n\n{document}\n\nUser question: {question}"),
    ]
)
structured_llm_grader = llm_flash.with_structured_output(GradeDocuments)
retrieval_grader = grade_prompt | structured_llm_grader

# Generate Prompt 
prompt = ChatPromptTemplate.from_template(
    """You are 'Aegis', an expert AI technical analyst and developer assistant.
    Your persona is helpful, authoritative, and precise.
    Your primary goal is to provide the most accurate, modern (2025) answer to the user's question by synthesizing the provided context.

    **CONTEXT ANALYSIS:**
    The context below contains documents. You MUST check the `Source:` tag for each document.
    -   **Stale Context:** Sources from `web.archive.org`, `docs.pydantic.dev/1.10/`, or other 2024-era sites.
    -   **Modern Context:** Sources from a `Tavily Web Search` (e.g., `tavily.com`).

    **YOUR TASK (CONDITIONAL LOGIC):**

    **SCENARIO 1: The context contains *ONLY* Stale Context.**
    (This means the Grader agent found the 2024 information to be "CORRECT" and still valid.)
    1.  State this clearly (e.g., "The information for this topic is still current.").
    2.  Provide a highly structured, direct and detailed answer to the user's question based on that context.
    3.  Include implementation based on the Stale context
    4.  Format all code snippets with Python markdown.

    **SCENARIO 2: The context contains *BOTH* Stale Context AND Modern Context.**
    (This is the "CRAG" path. You MUST perform a 3-step synthesis.)
    1.  **Stale (2024) Answer:**
        -   Provide a detailed answer based *only* on the "Stale Context" (the 2024 docs).
        -   Label this section clearly (e.g., `## 2024 (Stale) Answer`). with bigger size 
    2.  **Modern (2025) Analysis:**
        -   Analyze the "Modern Context" (the web search results).
        -   Explain *what* has changed (e.g., "The web search results show that `initialize_agent` is now deprecated...").
        -   Provide a detailed answer based *only* on the "Modern Context" (the 2025 docs).
        -   Include the implementation based on the Modern Context 
        -   Label this section clearly (e.g., `## 2025 (Modern) Analysis`). with bigger size
    3.  Format all code snippets with Python markdown.
    ---

    **Question:** {question}

    **Context:**
    {context}

    **Answer:**
"""
)

def format_docs(docs):
    return "\n\n".join(f"Source: {doc.metadata.get('source', 'N/A')}\nContent: {doc.page_content}" for doc in docs)

rag_chain = prompt | llm_pro | StrOutputParser()

# Question Re-writer
system_rewriter = (
"""
You are an expert search query optimizer, specializing in AI development.
Your goal is to rewrite a user's question, which may be based on older documentation (2023-2024), into a new, highly effective query that will find the most relevant, **modern (2025)** solution or best practice via web search.

**Rules for Query Rewriting:**
1.  **MANDATORY Keyword Inclusion:** You **MUST** identify and include **ALL** main, specific technical keywords and named entities (e.g., 'plan and execute agent', 'library function X', 'architecture Y') from the original user question. **DO NOT** generalize or omit these core terms.
2.  **Focus on Modernity:** The query **MUST** be optimized to find the *newest* information. Add the current year (2025) or terms like 'latest', 'modern', 'v2', 'best practice', or 'state-of-the-art'.
3.  **Add Action/Intent Keywords:** Enhance the query by adding high-value search terms like 'tutorial', 'guide', 'migration', 'alternative to', 'implementation', or 'example'.
4.  **Length Constraint:** The final query should be concise, ideally between 8 and 15 words.

**Example of the new process:**
* **Original Question:** "How to build a plan and execute agent"
* **Optimized Query:** "**2025 Plan and Execute Agent** implementation guide **latest** best practice
"""
)
re_write_prompt = ChatPromptTemplate.from_messages(
    [
        ("system", system_rewriter),
        ("human", "Here is the initial question: \n\n {question} \n Formulate an improved question."),
    ]
)
question_rewriter = re_write_prompt | llm_flash | StrOutputParser()

# Document Summarizer for UI transparency
system_summarizer = (
    "You are a technical document analyzer. Create a detailed structured summary of retrieved sources."
    
    "**Your Task:**"
    "For each document provided, you MUST generate a detailed, 4-5 line summary."
    "Process the documents in the order they are given (1, 2, 3, 4)."

    "**Critical Rules for Each Summary:**"
    "1.  **Format:** Use a consistent markdown structure."
    "2.  **Detail:** The summary must be 4-5 lines long and capture the core concepts."
    "3.  **Preserve Code:** You MUST preserve any key technical terms, function names, library names, or code snippets (e.g., `initialize_agent`, `BaseModel`, `@validator`, `openai.ChatCompletion.create`). This is the most important requirement."
    "4.  **Identify Source:** If the source URL is in the metadata, mention it."
    
    "**Example Output Format:**"

    "1.  **[Document 1]**"
    "    [Your 4-5 line summary of document 4, preserving key code/terms...]"
    
    "2.  **[Document 2]**"
    "    [Your 4-5 line summary of document 4, preserving key code/terms...]"
    
    "3.  **[Document 3]**"
    "    [Your 4-5 line summary of document 3, preserving key code/terms...]"
    
    "4.  **[Document 4]**"
    "    [Your 4-5 line summary of document 4, preserving key code/terms...]"
)
summarize_prompt = ChatPromptTemplate.from_messages([
    ("system", system_summarizer),
    ("human", "create a detailed summary\n\n{documents}")
])
document_summarizer = summarize_prompt | llm_flash | StrOutputParser()

# Web Search Tool 
web_search_tool = TavilySearchResults(max_results=5)


# --- 4. Graph Nodes ---
# Store websocket reference globally for streaming
current_websocket = None

async def retrieve_node(state):
    print("---NODE: RETRIEVE---")
    question = state["question"]
    documents = retriever(question)  # This is sync, which is fine for Chroma
    print(f"Retrieved {len(documents)} documents")
    
    # Stream intermediate update
    if current_websocket:
        await current_websocket.send_json({
            "type": "status",
            "data": f"📚 Found {len(documents)} documents from knowledge base"
        })
        
        # Generate and stream document summary    
        summary = await document_summarizer.ainvoke({"documents": documents})
        
        await current_websocket.send_json({
            "type": "summary",
            "data": summary
        })
    
    return {"documents": documents, "question": question}

async def grade_documents_node(state):
    print("---NODE: GRADE DOCUMENTS---")
    question = state["question"]
    documents = state["documents"]
    
    filtered_docs = []
    stale_count = 0
    web_search = "No"
    for d in documents:
        # Await the async grader
        score = await retrieval_grader.ainvoke({"question": question, "document": d.page_content})
        grade = score.binary_score
        
        if grade == "CORRECT":
            print("---GRADE: CORRECT---")
            filtered_docs.append(d)
        else:
            print(f"---GRADE: STALE (Source: {d.metadata.get('source', 'N/A')})---")
            stale_count += 1
            web_search = "Yes" # Trigger web search
    
    # Stream grading summary
    if current_websocket:
        if stale_count > 0:
            await current_websocket.send_json({
                "type": "status",
                "data": f"⚠️ Found {stale_count} outdated document(s). Initiating web search for current information..."
            })
        else:
            await current_websocket.send_json({
                "type": "status",
                "data": f"✅ All {len(filtered_docs)} documents are up-to-date"
            })
            
    return {"documents": filtered_docs, "question": question, "web_search": web_search}

async def transform_query_node(state):
    print("---NODE: TRANSFORM QUERY---")
    question = state["question"]
    documents = state["documents"] # Pass through existing docs
    
    better_question = await question_rewriter.ainvoke({"question": question})
    
    # Stream query transformation
    if current_websocket:
        await current_websocket.send_json({
            "type": "status",
            "data": f"🔄 Optimized search query: \"{better_question}\""
        })
    
    return {"documents": documents, "question": better_question}

async def web_search_node(state):
    print("---NODE: WEB SEARCH---")
    question = state["question"]
    documents = state["documents"].copy() if state["documents"] else []  # Copy to avoid mutation
    
    # Stream web search start
    if current_websocket:
        await current_websocket.send_json({
            "type": "status",
            "data": "🌐 Searching the web for latest information..."
        })
    
    search_results = await web_search_tool.ainvoke({"query": question})
    
    # Stream the search results (titles and URLs) to UI
    if search_results and current_websocket:
        articles = []
        for result in search_results:
            article = {
                "title": result.get("title", "Untitled"),
                "url": result.get("url", ""),
                "snippet": result.get("content", "")[:200]  # First 200 chars
            }
            articles.append(article)
        
        # Send articles as a special web_search_results event
        await current_websocket.send_json({
            "type": "web_search_results",
            "data": articles
        })
    
    if search_results:
        # Combine all results into a single document
        combined_content = "\n\n".join([
            f"Title: {r.get('title', 'N/A')}\nURL: {r.get('url', 'N/A')}\nContent: {r.get('content', 'N/A')}"
            for r in search_results
        ])
        
        web_doc = Document(
            page_content=combined_content, 
            metadata={"source": "Tavily Web Search", "query": question}
        )
        documents.append(web_doc)
        print(f"Added web search results")
        
        # Stream web search completion
        if current_websocket:
            await current_websocket.send_json({
                "type": "status",
                "data": "✅ Retrieved current web results"
            })
    
    return {"documents": documents, "question": question}

async def generate_node(state):
    print("---NODE: GENERATE---")
    question = state["question"]
    documents = state["documents"]
    
    context_str = format_docs(documents)
    generation = await rag_chain.ainvoke({"context": context_str, "question": question})
    return {"documents": documents, "question": question, "generation": generation}

# --- 5. Conditional Edge ---
def decide_to_generate(state):
    print("---EDGE: DECIDE TO GENERATE---")
    if state["web_search"] == "Yes":
        print("---DECISION: TRANSFORM QUERY & WEB SEARCH---")
        return "transform_query"
    else:
        print("---DECISION: GENERATE---")
        return "generate"

# --- 6. Build Graph ---
workflow = StateGraph(GraphState)

workflow.add_node("retrieve", retrieve_node)
workflow.add_node("grade_documents", grade_documents_node)
workflow.add_node("generate", generate_node)
workflow.add_node("transform_query", transform_query_node)
workflow.add_node("web_search", web_search_node) # Changed node name to match notebook

workflow.add_edge(START, "retrieve")
workflow.add_edge("retrieve", "grade_documents")
workflow.add_conditional_edges(
    "grade_documents",
    decide_to_generate,
    {
        "transform_query": "transform_query",
        "generate": "generate",
    },
)
workflow.add_edge("transform_query", "web_search") # Changed to web_search
workflow.add_edge("web_search", "generate") # Changed to web_search
workflow.add_edge("generate", END)

# Compile the graph
app_graph = workflow.compile()


# --- 7. FastAPI Server ---
app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"], # React app's URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_json()
            question = data.get("question")
            
            if not question:
                continue

            print(f"Received question: {question}")
            
            # Set global websocket reference for nodes to use
            global current_websocket
            current_websocket = websocket
            
            inputs = {"question": question}
            
            # This is the "Sexy UI" stream
            async for event in app_graph.astream_events(inputs, version="v2"):
                try:
                    kind = event["event"]
                    name = event.get("name", "")
                    
                    # --- START EVENTS (For immediate UI feedback) ---
                    
                    # Main graph nodes
                    if kind == "on_chain_start" and name in ["retrieve", "grade_documents", "transform_query", "generate"]:
                        await websocket.send_json({"type": "step_start", "node": name})
                    
                    # Retriever (Chroma)
                    elif kind == "on_retriever_start":
                        await websocket.send_json({"type": "retriever_start", "node": name})
                    
                    # Tool (Tavily)
                    elif kind == "on_tool_start":
                        await websocket.send_json({"type": "tool_start", "node": name})
                    
                    # LLM (Gemini)
                    elif kind == "on_chat_model_start":
                        await websocket.send_json({"type": "llm_start", "node": name})

                    # --- STREAM EVENTS (For live answer typing) ---
                    
                    elif kind == "on_chat_model_stream":
                        content = event["data"]["chunk"].content
                        if content:
                            await websocket.send_json({"type": "stream", "data": content})

                    # --- END EVENTS (To confirm completion) ---
                    
                    elif kind == "on_chain_end":
                        if name in ["retrieve", "grade_documents", "transform_query", "generate"]:
                            await websocket.send_json({
                                "type": "step_end", 
                                "node": name
                            })
                    
                    elif kind == "on_tool_end":
                        await websocket.send_json({
                            "type": "tool_end", 
                            "node": name
                        })
                    
                    elif kind == "on_retriever_end":
                        await websocket.send_json({
                            "type": "retriever_end",
                            "node": name
                        })
                except Exception as event_error:
                    # Skip events that cause serialization errors
                    print(f"Skipping event due to error: {event_error}")
                    continue

            # Send a final message to tell the client we're done
            await websocket.send_json({"type": "end"})

    except WebSocketDisconnect:
        print("Client disconnected")
    except Exception as e:
        print(f"An error occurred: {e}")
        await websocket.send_json({"type": "error", "data": str(e)})

# --- 8. Run the server ---
if __name__ == "__main__":
    import uvicorn
    print("Starting FastAPI server on http://localhost:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000)