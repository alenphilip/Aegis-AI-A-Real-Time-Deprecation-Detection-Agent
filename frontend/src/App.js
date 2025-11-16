// src/App.js
import React, { useState, useEffect, useRef } from 'react';
import { Send, Loader2, AlertCircle, CheckCircle, Search, Database, Zap, Bot, Moon, Sun } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { motion, AnimatePresence } from 'framer-motion';

function App() {
  const [messages, setMessages] = useState(() => {
    const saved = localStorage.getItem('aegis-chat-history');
    return saved ? JSON.parse(saved) : [];
  });
  const [input, setInput] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentStep, setCurrentStep] = useState(null);
  const [steps, setSteps] = useState([]);
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('aegis-theme');
    return saved || 'dark';
  });
  
  const wsRef = useRef(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, steps]);

  // Save messages to localStorage
  useEffect(() => {
    localStorage.setItem('aegis-chat-history', JSON.stringify(messages));
  }, [messages]);

  // Save theme to localStorage
  useEffect(() => {
    localStorage.setItem('aegis-theme', theme);
  }, [theme]);

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:8000/ws');
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('✅ Connected to Aegis');
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log('📨 Event:', data);

      switch (data.type) {
        case 'step_start':
          handleStepStart(data.node);
          break;
        case 'retriever_start':
          handleStepStart('retriever');
          break;
        case 'tool_start':
          handleStepStart('web_search');
          break;
        case 'llm_start':
          handleStepStart('llm');
          break;
        case 'stream':
          handleStream(data.data);
          break;
        case 'status':
          handleStatus(data.data);
          break;
        case 'summary':
          handleSummary(data.data);
          break;
        case 'web_search_results':
          handleWebSearchResults(data.data);
          break;
        case 'step_end':
        case 'tool_end':
        case 'retriever_end':
          handleStepEnd(data.node || data.name);
          break;
        case 'end':
          handleEnd();
          break;
        case 'error':
          handleError(data.data);
          break;
        default:
          console.log('Unknown event type:', data.type);
      }
    };

    ws.onerror = (error) => {
      console.error('❌ WebSocket error:', error);
      setIsConnected(false);
    };

    ws.onclose = () => {
      console.log('🔌 Disconnected from Aegis');
      setIsConnected(false);
    };

    return () => ws.close();
  }, []);

  const handleStepStart = (node) => {
    setCurrentStep(node);
    setSteps((prev) => [...prev, { node, status: 'running' }]);
  };

  const handleStepEnd = (node) => {
    setSteps((prev) =>
      prev.map((step) =>
        step.node === node && step.status === 'running'
          ? { ...step, status: 'completed' }
          : step
      )
    );
  };

  const handleStream = (content) => {
    setMessages((prev) => {
      // Remove temporary status messages when streaming starts
      const filtered = prev.filter(m => m.type !== 'status');
      const lastMessage = filtered[filtered.length - 1];
      
      if (lastMessage && lastMessage.type === 'assistant' && lastMessage.streaming) {
        return [
          ...filtered.slice(0, -1),
          { ...lastMessage, content: lastMessage.content + content },
        ];
      }
      return [
        ...filtered,
        { type: 'assistant', content, streaming: true },
      ];
    });
  };

  const handleStatus = (statusMsg) => {
    setMessages((prev) => {
      // Only keep non-streaming messages, then add new status
      const filtered = prev.filter(m => m.type !== 'status' && !(m.type === 'assistant' && m.streaming));
      return [
        ...filtered,
        { type: 'status', content: statusMsg },
      ];
    });
  };

  const handleSummary = (summaryMsg) => {
    setMessages((prev) => [
      ...prev,
      { type: 'summary', content: summaryMsg },
    ]);
  };

  const handleWebSearchResults = (articles) => {
    setMessages((prev) => [
      ...prev.filter(m => m.type !== 'status'),
      { type: 'web_results', content: articles },
    ]);
  };

  const handleEnd = () => {
    setIsProcessing(false);
    setCurrentStep(null);
    setSteps([]);
    setMessages((prev) => {
      const lastMessage = prev[prev.length - 1];
      if (lastMessage && lastMessage.streaming) {
        return [...prev.slice(0, -1), { ...lastMessage, streaming: false }];
      }
      return prev;
    });
  };

  const handleError = (errorMsg) => {
    setIsProcessing(false);
    setCurrentStep(null);
    setSteps([]);
    setMessages((prev) => [
      ...prev,
      { type: 'error', content: errorMsg },
    ]);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!input.trim() || !isConnected || isProcessing) return;

    const userMessage = { type: 'user', content: input };
    setMessages((prev) => [...prev, userMessage]);
    setIsProcessing(true);
    setSteps([]);

    wsRef.current?.send(JSON.stringify({ question: input }));
    setInput('');
  };

  const getStepIcon = (node) => {
    switch (node) {
      case 'retrieve':
        return <Database className="w-4 h-4" />;
      case 'grade_documents':
        return <CheckCircle className="w-4 h-4" />;
      case 'transform_query':
        return <Zap className="w-4 h-4" />;
      case 'web_search':
        return <Search className="w-4 h-4" />;
      case 'generate':
      case 'llm':
        return <Bot className="w-4 h-4" />;
      default:
        return <Loader2 className="w-4 h-4 animate-spin" />;
    }
  };

  const getStepLabel = (node) => {
    const labels = {
      retrieve: 'Retrieving documents',
      grade_documents: 'Grading relevance',
      transform_query: 'Optimizing query',
      web_search: 'Searching web',
      generate: 'Generating response',
      llm: 'LLM thinking',
      retriever: 'Fetching knowledge',
    };
    return labels[node] || node;
  };

  const isDark = theme === 'dark';
  const bgPrimary = isDark ? 'bg-dark-bg-primary' : 'bg-light-bg-primary';
  const bgSecondary = isDark ? 'bg-dark-bg-secondary' : 'bg-light-bg-secondary';
  const bgTertiary = isDark ? 'bg-dark-bg-tertiary' : 'bg-light-bg-tertiary';
  const bgSurface = isDark ? 'bg-dark-surface' : 'bg-light-surface';
  const borderColor = isDark ? 'border-dark-border' : 'border-light-border';
  const borderLight = isDark ? 'border-dark-border-light' : 'border-light-border-light';
  const textPrimary = isDark ? 'text-dark-text-primary' : 'text-light-text-primary';
  const textSecondary = isDark ? 'text-dark-text-secondary' : 'text-light-text-secondary';
  const textMuted = isDark ? 'text-dark-text-muted' : 'text-light-text-muted';

  return (
    <div className={`flex flex-col h-screen ${bgPrimary} ${textPrimary}`}>
      {/* Header */}
      <header className={`${bgSecondary} ${borderLight} border-b px-6 py-4 flex items-center justify-between backdrop-blur-sm shadow-md`}>
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-gradient-to-br from-accent-primary to-accent-secondary rounded-xl flex items-center justify-center shadow-lg">
            <Bot className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold bg-gradient-to-r from-accent-primary-bright to-accent-secondary bg-clip-text text-transparent">
              Aegis AI
            </h1>
            <p className={`text-xs ${textMuted} font-medium`}>Corrective RAG System</p>
          </div>
        </div>
        <div className="flex items-center space-x-4">
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className={`p-2.5 rounded-lg ${bgTertiary} ${borderColor} border hover:${isDark ? 'bg-dark-bg-hover' : 'bg-light-bg-hover'} transition-all shadow-sm hover:shadow-md`}
            title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
          >
            {theme === 'dark' ? <Sun className="w-5 h-5 text-amber-500" /> : <Moon className="w-5 h-5 text-indigo-600" />}
          </button>
          <div className={`flex items-center space-x-2 ${bgTertiary} px-3 py-1.5 rounded-full ${borderColor} border`}>
            <div
              className={`w-2 h-2 rounded-full ${
                isConnected ? 'bg-accent-success shadow-[0_0_8px_rgba(16,185,129,0.6)]' : 'bg-accent-error shadow-[0_0_8px_rgba(239,68,68,0.6)]'
              } animate-pulse`}
            />
            <span className={`text-sm ${textMuted} font-medium`}>
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>
      </header>

      {/* Messages Area - Split View */}
      <div className="flex-1 overflow-hidden flex">
        {/* Left Panel - Thinking/Processing */}
        <div className={`${isProcessing ? 'w-1/3' : 'w-0'} transition-all duration-300 overflow-y-auto ${borderLight} border-r ${isDark ? 'bg-dark-bg-tertiary/50' : 'bg-light-bg-tertiary/50'}`}>
          <AnimatePresence>
            {isProcessing && (
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="p-6 h-full"
              >
                <div className={`sticky top-0 bg-gradient-to-b ${isDark ? 'from-dark-bg-tertiary to-dark-bg-tertiary/80' : 'from-light-bg-tertiary to-light-bg-tertiary/80'} backdrop-blur-md pb-4 mb-4 ${borderLight} border-b`}>
                  <div className="flex items-center space-x-2">
                    <Loader2 className="w-5 h-5 animate-spin text-accent-primary-bright" />
                    <h3 className={`text-lg font-semibold ${textPrimary}`}>Thinking Process</h3>
                  </div>
                </div>
                
                <div className="space-y-4">
                  {steps.map((step, idx) => (
                    <motion.div
                      key={idx}
                      layout
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`p-4 rounded-xl border backdrop-blur-sm ${
                        step.status === 'completed'
                          ? `${bgSurface} border-accent-success/40 shadow-md`
                          : `${bgSecondary} border-accent-primary/40 shadow-md`
                      }`}
                    >
                      <div className="flex items-start space-x-3">
                        <AnimatePresence mode="wait">
                          {step.status === 'completed' ? (
                            <motion.div
                              key="completed"
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              className="text-accent-success mt-1"
                            >
                              <CheckCircle className="w-5 h-5" />
                            </motion.div>
                          ) : (
                            <motion.div
                              key="running"
                              className="text-accent-primary mt-1"
                            >
                              {getStepIcon(step.node)}
                            </motion.div>
                          )}
                        </AnimatePresence>
                        <div className="flex-1">
                          <p className={`font-medium ${
                            step.status === 'completed' ? 'text-accent-success' : 'text-accent-primary'
                          }`}>
                            {getStepLabel(step.node)}
                          </p>
                          <p className={`text-xs ${textMuted} mt-1`}>
                            {step.status === 'completed' ? 'Completed' : 'In progress...'}
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right Panel - Messages */}
        <div className={`${isProcessing ? 'w-2/3' : 'w-full'} transition-all duration-300 overflow-y-auto px-4 py-6 space-y-6 ${!isProcessing && messages.length > 0 ? 'flex flex-col items-center' : ''}`}>
        <div className={`${!isProcessing && messages.length > 0 ? 'max-w-4xl w-full' : 'w-full'} space-y-6`}>
        <AnimatePresence>
          {messages.length === 0 && !isProcessing && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.3 }}
              className="flex flex-col items-center justify-center h-full space-y-6"
            >
              <div className={`w-20 h-20 bg-gradient-to-br from-accent-primary to-accent-secondary rounded-full flex items-center justify-center ${isDark ? 'shadow-lg' : 'shadow-xl'}`}>
                <Bot className="w-10 h-10 text-white" />
              </div>
              <div className="text-center space-y-2">
                <h2 className={`text-2xl font-bold ${textPrimary}`}>Welcome to Aegis AI</h2>
                <p className={`${textMuted} max-w-md font-medium`}>
                  Your intelligent assistant with corrective retrieval-augmented generation.
                  Ask me anything about AI development!
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl w-full">
                {[
                  'How do I use the latest LangChain API?',
                  'What are the current best practices for RAG?',
                  'How to implement streaming with OpenAI?',
                  'Explain vector databases in 2025',
                ].map((prompt, i) => (
                  <button
                    key={i}
                    onClick={() => setInput(prompt)}
                    className={`p-4 ${bgSurface} hover:${isDark ? 'bg-dark-bg-hover' : 'bg-light-bg-hover'} rounded-lg text-left text-sm transition-all ${borderColor} border hover:border-accent-primary-bright/50 group shadow-sm hover:shadow-md`}
                  >
                    <span className={`${textMuted} group-hover:${textPrimary} font-medium`}>{prompt}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {messages.map((message, idx) => (
            <motion.div
              key={idx}
              layout
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-end'}`}
            >
              <div
                className={`max-w-3xl ${
                  message.type === 'user'
                    ? 'bg-gradient-to-br from-accent-primary to-accent-secondary text-white shadow-lg'
                    : message.type === 'error'
                    ? `${bgSurface} border border-accent-error/50 shadow-md`
                    : message.type === 'status'
                    ? `${isDark ? 'bg-dark-bg-tertiary/80' : 'bg-light-bg-tertiary/80'} ${borderColor} border backdrop-blur-sm`
                    : `${bgSurface} shadow-md`
                } rounded-2xl px-6 py-4`}
              >
              {message.type === 'user' ? (
                <p className="text-white">{message.content}</p>
              ) : message.type === 'error' ? (
                <div className="flex items-start space-x-3">
                  <AlertCircle className="w-5 h-5 text-accent-error flex-shrink-0 mt-1" />
                  <div>
                    <p className="font-semibold text-accent-error">Error</p>
                    <p className={textSecondary}>{message.content}</p>
                  </div>
                </div>
              ) : message.type === 'status' ? (
                <p className={`text-sm ${textMuted} italic`}>{message.content}</p>
              ) : message.type === 'summary' ? (
                <div className="border-l-4 border-accent-primary pl-4 py-2">
                  <p className="text-xs text-accent-primary font-semibold mb-2">📝 Sources Found</p>
                  <div className={`text-sm space-y-2 ${isDark ? 'markdown-content-dark' : 'markdown-content-light'}`}>
                    <ReactMarkdown
                      components={{
                        ul: ({children}) => <ul className="space-y-2">{children}</ul>,
                        li: ({children}) => <li className="flex items-start space-x-2"><span className="text-accent-primary mt-1 flex-shrink-0 min-w-[1rem]">•</span><span className="flex-1 whitespace-normal break-words" style={{wordBreak: 'break-word', overflowWrap: 'break-word'}}>{children}</span></li>,
                        strong: ({children}) => <strong className="text-accent-primary font-semibold">{children}</strong>,
                        p: ({children}) => <p className="whitespace-normal break-words" style={{wordBreak: 'break-word'}}>{children}</p>,
                        a: ({children, href}) => <a href={href} className="text-accent-primary hover:underline break-all inline" target="_blank" rel="noopener noreferrer">{children}</a>,
                      }}
                    >
                      {message.content}
                    </ReactMarkdown>
                  </div>
                </div>
              ) : message.type === 'web_results' ? (
                <div className="border-l-4 border-accent-secondary pl-4 py-2">
                  <p className="text-xs text-accent-secondary font-semibold mb-3 flex items-center">
                    <Search className="w-4 h-4 mr-1" />
                    Web Search Results
                  </p>
                  <div className="space-y-3">
                    {message.content.map((article, idx) => (
                      <div key={idx} className={`p-3 rounded-lg ${bgSurface} ${borderColor} border hover:${isDark ? 'bg-dark-bg-hover' : 'bg-light-bg-hover'} transition-colors`}>
                        <a 
                          href={article.url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="block"
                        >
                          <h4 className={`font-semibold ${textPrimary} hover:text-accent-primary transition-colors mb-1`}>
                            {idx + 1}. {article.title}
                          </h4>
                          <p className={`text-xs ${textMuted} mb-2 break-all`}>{article.url}</p>
                          {article.snippet && (
                            <p className={`text-sm ${textSecondary}`}>{article.snippet}...</p>
                          )}
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className={isDark ? 'markdown-content-dark' : 'markdown-content-light'}>
                  <ReactMarkdown
                    components={{
                      code({ node, inline, className, children, ...props }) {
                        const match = /language-(\w+)/.exec(className || '');
                        return !inline && match ? (
                          <SyntaxHighlighter
                            style={vscDarkPlus}
                            language={match[1]}
                            PreTag="div"
                            {...props}
                          >
                            {String(children).replace(/\n$/, '')}
                          </SyntaxHighlighter>
                        ) : (
                          <code className={className} {...props}>
                            {children}
                          </code>
                        );
                      },
                    }}
                  >
                    {message.content}
                  </ReactMarkdown>
                  {message.streaming && (
                    <span className="inline-block w-1 h-5 bg-accent-primary animate-pulse ml-1" />
                  )}
                </div>
              )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        <div ref={messagesEndRef} />
        </div>
        </div>
      </div>

      {/* Input Area */}
      <div className={`${borderLight} border-t ${isDark ? 'bg-gradient-to-b from-dark-bg-secondary to-dark-bg-primary' : 'bg-gradient-to-b from-light-bg-secondary to-light-bg-primary'} px-4 py-4 backdrop-blur-sm`}>
        <form onSubmit={handleSubmit} className="max-w-4xl mx-auto">
          <div className="relative flex items-center">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={!isConnected || isProcessing}
              placeholder={
                !isConnected
                  ? 'Connecting to Aegis...'
                  : isProcessing
                  ? 'Processing your request...'
                  : 'Ask me anything about AI development...'
              }
              className={`flex-1 ${bgSurface} ${borderColor} border rounded-full px-6 py-4 pr-14 focus:outline-none focus:ring-2 focus:ring-accent-primary-bright focus:border-accent-primary shadow-sm disabled:opacity-50 disabled:cursor-not-allowed ${textPrimary} ${isDark ? 'placeholder-dark-text-muted' : 'placeholder-light-text-muted'} font-medium`}
            />
            <motion.button
              type="submit"
              disabled={!isConnected || isProcessing || !input.trim()}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="absolute right-2 bg-gradient-to-br from-accent-primary to-accent-secondary hover:from-accent-primary-bright hover:to-accent-secondary disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-full p-3 transition-all shadow-lg disabled:shadow-none"
            >
              <AnimatePresence mode="wait">
                {isProcessing ? (
                  <motion.div
                    key="loader"
                    initial={{ opacity: 0, rotate: -180 }}
                    animate={{ opacity: 1, rotate: 0 }}
                    exit={{ opacity: 0, rotate: 180 }}
                    transition={{ duration: 0.2 }}
                  >
                    <Loader2 className="w-5 h-5 animate-spin" />
                  </motion.div>
                ) : (
                  <motion.div
                    key="send"
                    initial={{ opacity: 0, rotate: -180 }}
                    animate={{ opacity: 1, rotate: 0 }}
                    exit={{ opacity: 0, rotate: 180 }}
                    transition={{ duration: 0.2 }}
                  >
                    <Send className="w-5 h-5" />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.button>
          </div>
          <p className={`text-xs ${textMuted} text-center mt-2 font-medium`}>
            Aegis uses advanced CRAG to detect outdated information and search for current answers.
          </p>
        </form>
      </div>
    </div>
  );
}

export default App;