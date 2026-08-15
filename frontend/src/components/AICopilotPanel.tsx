import React, { useState, useEffect, useRef } from 'react';
import type { Node, Edge } from '@xyflow/react';
import { X, Sparkles, Brain, Wand2, Loader2, AlertCircle, HelpCircle } from 'lucide-react';
import SYSTEM_INSTRUCTIONS from './systemInstructions.txt?raw';

interface AICopilotPanelProps {
  nodes: Node[];
  edges: Edge[];
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
  onClose: () => void;
}

const cleanJSONString = (str: string): string => {
  return str
    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
    .replace(/(?:^|[^:])\/\/.*$/gm, '') // Remove single-line comments
    .replace(/,\s*([\]}])/g, '$1'); // Remove trailing commas
};

const parseAIJSON = (text: string): any => {
  // 1. Try to find markdown json code blocks
  const codeBlockRegex = /```json\s*([\s\S]*?)\s*```/i;
  const matchBlock = text.match(codeBlockRegex);
  if (matchBlock && matchBlock[1]) {
    try {
      return JSON.parse(cleanJSONString(matchBlock[1].trim()));
    } catch (e) {
      // fallback
    }
  }

  // 2. Try generic code blocks
  const genericCodeBlockRegex = /```\s*([\s\S]*?)\s*```/;
  const matchGeneric = text.match(genericCodeBlockRegex);
  if (matchGeneric && matchGeneric[1]) {
    try {
      return JSON.parse(cleanJSONString(matchGeneric[1].trim()));
    } catch (e) {}
  }

  // 3. Fallback to extracting between first '{' and last '}'
  let index = text.indexOf('{');
  while (index !== -1) {
    const lastBrace = text.lastIndexOf('}');
    if (lastBrace > index) {
      const candidate = text.substring(index, lastBrace + 1);
      try {
        return JSON.parse(cleanJSONString(candidate.trim()));
      } catch (e) {
        // try next index
      }
    }
    index = text.indexOf('{', index + 1);
  }

  throw new Error("No valid JSON block could be extracted from the AI's response.");
};

export default function AICopilotPanel({ nodes, edges, setNodes, setEdges, onClose }: AICopilotPanelProps) {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('gemini_api_key') || '');
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'explain' | 'generate' | 'mutate'>('explain');
  const [aiResponse, setAiResponse] = useState('');
  const responseContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (responseContainerRef.current) {
      responseContainerRef.current.scrollTo({
        top: responseContainerRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [aiResponse]);

  const saveApiKey = (key: string) => {
    setApiKey(key);
    localStorage.setItem('gemini_api_key', key);
  };

  const callGemini = async (systemInstructions: string, userQuery: string) => {
    const effectiveKey = apiKey.trim() || localStorage.getItem('gemini_api_key')?.trim() || '';
    if (!effectiveKey) {
      setError('Please configure your Gemini API Key in Settings or the panel input below.');
      return null;
    }
    if (effectiveKey !== apiKey) setApiKey(effectiveKey);
    setError('');
    setLoading(true);

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${effectiveKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: `${systemInstructions}\n\nUser Request: ${userQuery}` }]
            }
          ]
        })
      });

      const json = await response.json();
      if (json.error) {
        throw new Error(json.error.message);
      }

      const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return text;
    } catch (e: any) {
      setError(`API Error: ${e.message}`);
      return null;
    } finally {
      setLoading(false);
    }
  };

  // 1. Explain simulation current state and bottlenecks
  const handleExplain = async () => {
    setMode('explain');

    const nodesSummary = nodes.map((n: any) => ({
      id: n.id,
      label: n.data?.label,
      type: n.type,
      // specific node properties
      color: n.data?.color,
      waveform: n.data?.waveform,
      frequency: n.data?.frequency,
      amplitude: n.data?.amplitude,
      bf: n.data?.bf,
      isOpen: n.data?.isOpen,
      position: n.data?.position, // potentiometer position
      common: n.data?.common,
      value: n.data?.value,
      // outputs / measurements
      voltage: n.data?.voltage,
      brightness: n.data?.brightness,
      isExploded: n.data?.isExploded,
      hasLogs: !!n.data?.logs,
      mcuLogsSnippet: n.data?.logs ? n.data.logs.slice(-100) : undefined,
    }));

    const edgesSummary = edges.map((e: any) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
    }));

    const systemInstructions = `You are "Circuit Expert Copilot", an expert AI systems engineer and electrical circuit analyst.
Analyze the active visual circuit canvas schematic and produce a comprehensive professional diagnostic report in Markdown.

The app is an interactive visual electronic circuit builder running on the client side using ngspice-wasm.

Your report must include ALL of these sections:
## 1. Purpose & Schematic Overview
What kind of circuit is this? What is its primary function (e.g. astable blinker, audio amplifier, simple LED divider)?

## 2. Connectivity & Node Analysis
Briefly walk through the connections. Are all critical power paths, grounds, and inputs connected properly?

## 3. Simulation Outcomes & Measurements
- Are there multimeters on the canvas? What are their final readings?
- Do we have LEDs? Are they illuminated (brightness > 0) or did they blow up/explode (isExploded = true)?
- Are there microcontrollers (MCU)? Mention their latest execution logs.

## 4. Diagnostics & Design Anti-Patterns
- Missing ground references (ngspice requires at least one ground 'g1' type node)?
- Blown LEDs due to missing or too low current-limiting resistors?
- Transistor terminals (b, c, e) or MOSFET terminals (g, d, s) connected backwards?
- Float inputs or dangling connections?

## 5. Suggested Improvements (Actionable Checklist)
Give 3-5 specific, actionable recommendations (e.g., "Change R1 to 330Ω to prevent LED explosion", "Add a ground reference connected to the negative supply terminal").

Do NOT output JSON. Output the Markdown report only.

Current canvas topology:
Nodes (${nodesSummary.length}): ${JSON.stringify(nodesSummary)}
Edges (${edgesSummary.length}): ${JSON.stringify(edgesSummary)}`;

    const response = await callGemini(systemInstructions, 'Perform a full system diagnostic of the active canvas.');
    if (response) setAiResponse(response);
  };

  // 2. Generate a completely new canvas simulation from prompt
  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError('Please enter a description of the circuit you want to generate.');
      return;
    }
    setMode('generate');

    const response = await callGemini(SYSTEM_INSTRUCTIONS, prompt);
    if (response) {
      try {
        const parsed = parseAIJSON(response);
        if (parsed.nodes && parsed.edges) {
          const idMap: Record<string, string> = {};
          const cleanNodes = parsed.nodes.map((n: any) => {
            const newId = crypto.randomUUID();
            idMap[String(n.id)] = newId;
            
            const nodeType = n.type || 'resistor';
            
            return {
              id: newId,
              type: nodeType,
              position: n.position || { x: 100, y: 150 },
              data: {
                label: n.data?.label || n.label || `New ${nodeType}`,
                ...n.data
              }
            };
          });

          const cleanEdges = parsed.edges.map((e: any) => {
            const srcId = idMap[String(e.source)] || e.source;
            const tgtId = idMap[String(e.target)] || e.target;
            
            return {
              id: crypto.randomUUID(),
              source: srcId,
              target: tgtId,
              sourceHandle: e.sourceHandle || 'out',
              targetHandle: e.targetHandle || 'in',
              type: 'smoothstep'
            };
          });

          setNodes(cleanNodes);
          setEdges(cleanEdges);
          setAiResponse('### ✨ Schematic Generated Successfully!\nI have created your circuit. Press **Simulate** in the toolbar to run it.');
        } else {
          throw new Error('JSON missing nodes or edges keys');
        }
      } catch (e: any) {
        setError(`Failed to parse AI response: ${e.message}. Raw reply printed below.`);
        setAiResponse(response);
      }
    }
  };

  // 3. Mutate/Add elements to the current canvas dynamically
  const handleMutate = async () => {
    if (!prompt.trim()) {
      setError('Please enter what changes you want to apply to the canvas.');
      return;
    }
    setMode('mutate');

    const serializedNodes = nodes.map(n => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: {
        label: n.data.label,
        color: n.data.color,
        waveform: n.data.waveform,
        frequency: n.data.frequency,
        amplitude: n.data.amplitude,
        bf: n.data.bf,
        isOpen: n.data.isOpen,
        position: n.data.position
      }
    }));

    const serializedEdges = edges.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle
    }));

    const promptWithContext = `The user wants to modify the active circuit canvas.\n\nActive Canvas Nodes:\n${JSON.stringify(serializedNodes)}\nActive Canvas Edges:\n${JSON.stringify(serializedEdges)}\n\nUser Request: ${prompt}`;

    const response = await callGemini(SYSTEM_INSTRUCTIONS, promptWithContext);
    if (response) {
      try {
        const parsed = parseAIJSON(response);
        if (parsed.nodes && parsed.edges) {
          const cleanNodes = parsed.nodes.map((n: any) => {
            const nodeType = n.type || 'resistor';
            return {
              id: n.id || crypto.randomUUID(),
              type: nodeType,
              position: n.position || { x: 100, y: 150 },
              data: {
                label: n.data?.label || n.label || `New ${nodeType}`,
                ...n.data
              }
            };
          });

          const cleanEdges = parsed.edges.map((e: any) => {
            return {
              id: e.id || crypto.randomUUID(),
              source: e.source,
              target: e.target,
              sourceHandle: e.sourceHandle || 'out',
              targetHandle: e.targetHandle || 'in',
              type: 'smoothstep'
            };
          });
          
          setNodes(cleanNodes);
          setEdges(cleanEdges);
          setAiResponse('### 🛠️ Schematic Mutated Successfully!\nYour requested modifications have been merged into the active canvas viewport.');
        } else {
          throw new Error('JSON missing nodes or edges keys');
        }
      } catch (e: any) {
        setError(`Failed to parse AI mutation response: ${e.message}. Raw response below.`);
        setAiResponse(response);
      }
    }
  };

  const parseBoldAndCode = (str: string) => {
    const regex = /(\*\*.*?\*\*|`.*?`)/g;
    const tokens = str.split(regex);
    return tokens.map((token, i) => {
      if (token.startsWith('**') && token.endsWith('**')) {
        return <strong key={i} className="font-extrabold text-slate-800">{token.slice(2, -2)}</strong>;
      }
      if (token.startsWith('`') && token.endsWith('`')) {
        return <code key={i} className="bg-slate-100 px-1 py-0.5 rounded font-mono text-[10px] text-indigo-650 font-bold">{token.slice(1, -1)}</code>;
      }
      return token;
    });
  };

  const renderMarkdown = (text: string) => {
    if (!text) return null;
    const lines = text.split('\n');
    return lines.map((line, idx) => {
      if (line.startsWith('# ')) {
        return <h1 key={idx} className="text-sm font-extrabold text-slate-800 border-b border-slate-150 pb-1 mt-3 mb-2 tracking-tight">{line.substring(2)}</h1>;
      }
      if (line.startsWith('## ')) {
        return <h2 key={idx} className="text-xs font-bold text-slate-850 mt-3 mb-1 tracking-tight">{line.substring(3)}</h2>;
      }
      if (line.startsWith('### ')) {
        return <h3 key={idx} className="text-xs font-semibold text-slate-700 mt-2 mb-1">{line.substring(4)}</h3>;
      }
      if (line.startsWith('* ') || line.startsWith('- ')) {
        return <li key={idx} className="ml-4 list-disc text-slate-600 my-0.5 leading-relaxed">{parseBoldAndCode(line.substring(2))}</li>;
      }
      if (!line.trim()) {
        return <div key={idx} className="h-1.5" />;
      }
      return <p key={idx} className="my-1.5 text-slate-600 leading-relaxed font-sans">{parseBoldAndCode(line)}</p>;
    });
  };

  return (
    /* A permanent column at `lg` (unchanged); below it there is not room for a
       24rem column beside a schematic, so it covers the canvas instead. */
    <aside className="w-full lg:w-96 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-l border-slate-200 dark:border-slate-800 flex flex-col h-full shrink-0 shadow-2xl z-40 max-lg:z-[110] absolute right-0 inset-y-0 lg:relative animate-in slide-in-from-right-8 duration-300">
      {/* Header */}
      <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/80 dark:bg-slate-950/40 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-950/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shadow-sm animate-pulse">
            <Brain className="w-4.5 h-4.5" />
          </div>
          <div>
            <h2 className="font-extrabold text-slate-800 dark:text-slate-100 text-sm">AI Copilot Expert</h2>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">Gemini 3.5 Flash</p>
          </div>
        </div>
        <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-650 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors cursor-pointer"><X className="w-5 h-5" /></button>
      </div>

      {/* Main Panel Content */}
      <div className="flex-1 flex flex-col overflow-hidden p-4 gap-4">
        
        {/* Navigation Modes */}
        <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 dark:bg-slate-950/60 rounded-xl select-none">
          <button
            onClick={() => setMode('explain')}
            className={`py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${mode === 'explain' ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-555 dark:text-slate-400 hover:text-slate-850 dark:hover:text-slate-200'}`}
          >
            🔍 Explain
          </button>
          <button
            onClick={() => setMode('generate')}
            className={`py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${mode === 'generate' ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-555 dark:text-slate-400 hover:text-slate-850 dark:hover:text-slate-200'}`}
          >
            🪄 Generate
          </button>
          <button
            onClick={() => setMode('mutate')}
            className={`py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${mode === 'mutate' ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-555 dark:text-slate-400 hover:text-slate-850 dark:hover:text-slate-200'}`}
          >
            🛠️ Mutate
          </button>
        </div>

        {/* Action Prompt Form */}
        {mode !== 'explain' ? (
          <div className="flex flex-col gap-2 shrink-0">
            <textarea
              placeholder={mode === 'generate' ? "Describe the circuit you want to generate. e.g. A 5V DC source connected to a 330Ω resistor and a red LED in series..." : "Describe the modifications you want to apply. e.g. Add a Scope probing the LED cathode, or replace the resistor value with 10k..."}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs shadow-inner min-h-[90px] leading-normal bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100"
            />
            <button
              onClick={mode === 'generate' ? handleGenerate : handleMutate}
              disabled={loading}
              className="py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-150 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
              {mode === 'generate' ? 'Generate Circuit' : 'Mutate Schematic'}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 shrink-0 select-none">
            <button
              onClick={handleExplain}
              disabled={loading}
              className="py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-150 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              Perform Diagnostics
            </button>
          </div>
        )}

        {/* API key configuration drawer inline */}
        {!apiKey && (
          <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 p-3.5 rounded-xl shrink-0 flex flex-col gap-2 shadow-inner">
            <div className="flex gap-2 items-start">
              <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="flex flex-col">
                <span className="text-xs font-bold text-amber-800 dark:text-amber-300 leading-normal">API Key Required</span>
                <p className="text-[10px] text-amber-600 dark:text-amber-500 leading-normal">AI Copilot needs a Gemini API Key to run. Configure it below:</p>
              </div>
            </div>
            <input 
              type="password" 
              placeholder="Paste AIzaSy... here" 
              onChange={(e) => saveApiKey(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs border border-amber-200 dark:border-amber-900/50 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 rounded-lg shadow-sm focus:outline-none focus:ring-1 focus:ring-amber-500 font-mono"
            />
          </div>
        )}

        {/* Error Block */}
        {error && (
          <div className="bg-red-50 dark:bg-red-955/20 border border-red-200 dark:border-red-900/50 p-3 rounded-xl shrink-0 flex items-start gap-2 shadow-inner">
            <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            <span className="text-[10px] text-red-700 dark:text-red-400 font-semibold leading-normal break-all">{error}</span>
          </div>
        )}

        {/* Response Area */}
        <div ref={responseContainerRef} className="flex-1 border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 p-4 rounded-xl overflow-y-auto leading-relaxed text-xs text-slate-700 dark:text-slate-300 shadow-inner min-h-[150px]">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 py-8 text-slate-400 select-none">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
              <span className="text-xs font-semibold">AI Copilot is processing canvas...</span>
            </div>
          ) : aiResponse ? (
            <div className="prose prose-slate dark:prose-invert max-w-none text-xs font-normal">
              {renderMarkdown(aiResponse)}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-400 select-none py-8 text-center">
              <HelpCircle className="w-8 h-8 text-slate-350" />
              <p className="text-[11px] leading-normal px-4">
                {apiKey ? 'Click an action above to analyze or mutate your canvas.' : 'Configure your Gemini API key below, then click an action above.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
