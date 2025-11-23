/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, h } from "preact";
import { useState, useEffect, useCallback, useMemo, useRef } from "preact/hooks";
import { html } from "htm/preact";
import { GoogleGenAI } from "@google/genai";

// --- HELPERS ---
const generateId = (prefix = 'id') => `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

const detectCycle = (nodes, edges) => {
    if (!nodes || nodes.length === 0) return false;

    const adj: Map<string, string[]> = new Map(nodes.map(n => [n.id, []]));
    const inDegree: Map<string, number> = new Map(nodes.map(n => [n.id, 0]));

    for (const edge of edges) {
        if (adj.has(edge.source) && inDegree.has(edge.target)) {
            adj.get(edge.source)!.push(edge.target);
            inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
        }
    }

    const queue = nodes.filter(n => inDegree.get(n.id) === 0).map(n => n.id);
    let count = 0;

    while (queue.length > 0) {
        const u = queue.shift();
        count++;

        for (const v of (adj.get(u) || [])) {
            inDegree.set(v, inDegree.get(v)! - 1);
            if (inDegree.get(v) === 0) {
                queue.push(v);
            }
        }
    }
    return count !== nodes.length;
};

const UNIVERSAL_NODE_PROMPT = `You are a single, focused processing unit in a larger AI system. Your task is to perform a specific, small step in a thought process.

**Overall User Goal:**
{{user_prompt}}

**Your Input:**
{{input}}

**Your Instructions:**
- **If 'Your Input' is EMPTY:** You are the FIRST step. Provide a concise, foundational piece of information or a starting point to address the user's goal. Do NOT attempt to answer the whole query. Your output should be a single idea, fact, or concept.
- **If 'Your Input' is NOT EMPTY:** You are a subsequent step. Your only job is to build directly upon the text provided in 'Your Input'. You can expand, critique, simplify, or rephrase it. Do not introduce completely new topics. Your output must be a logical continuation of the input.

Generate only the text for your step. Be brief.`;

const generateArchitectureNotes = (nodes, edges) => {
    if (nodes.length === 0) {
        return "This configuration is empty. Add nodes to begin building an AI.";
    }

    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const inDegree: Map<string, number> = new Map(nodes.map(n => [n.id, 0]));
    const outDegree: Map<string, number> = new Map(nodes.map(n => [n.id, 0]));

    for (const edge of edges) {
        if (nodeMap.has(edge.source) && nodeMap.has(edge.target)) {
            outDegree.set(edge.source, (outDegree.get(edge.source) || 0) + 1);
            inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
        }
    }

    const rootNodeCount = nodes.filter(n => inDegree.get(n.id) === 0).length;
    const leafNodeCount = nodes.filter(n => outDegree.get(n.id) === 0).length;
    const isolatedNodeCount = nodes.filter(n => inDegree.get(n.id) === 0 && outDegree.get(n.id) === 0).length;
    const hasCycle = detectCycle(nodes, edges);

    let description = `Architecture Report:\n\n`;
    description += `- Nodes: ${nodes.length}\n`;
    description += `- Connections: ${edges.length}\n`;
    description += `- Entry Points (Root Nodes): ${rootNodeCount}\n`;
    description += `- Final Outputs (Leaf Nodes): ${leafNodeCount}\n`;

    if (hasCycle) {
        description += `\n\nError: A cycle is detected in the graph. The AI cannot process this configuration. Please find and remove the connection that forms the loop.`;
        return description;
    }

    if (isolatedNodeCount > 0) {
        description += `\n\nWarning: ${isolatedNodeCount} node(s) are completely isolated. They will act as both entry points and final outputs, which may lead to fragmented results.\n`;
    }

    if (nodes.length > 0 && edges.length === 0 && nodes.length > 1) {
        description += `\nObservation: All nodes are disconnected. The final output will be a collection of independent thoughts. To create a coherent process, connect the nodes.`;
    } else if (rootNodeCount > 1) {
        description += `\nObservation: Multiple entry points exist. The AI will start multiple independent thought processes. This can be useful for parallel analysis but may result in a disjointed final answer unless merged.`;
    } else if (leafNodeCount > 1) {
         description += `\nObservation: Multiple final outputs. The AI's response will be a combination of the results from ${leafNodeCount} different endpoints.`;
    } else if (nodes.length > 0 && rootNodeCount === 1 && leafNodeCount === 1) {
        description += `\nObservation: This is a single-flow architecture (one entry, one exit). It should produce a focused, sequential thought process.`;
    }

    return description;
};


// --- INITIAL DATA ---
const createDefaultNodes = () => ([
  {
    id: generateId('node'),
    position: { x: 150, y: 100 },
  },
  {
    id: generateId('node'),
    position: { x: 150, y: 250 },
  },
]);

const createDefaultEdges = () => ([]);

const defaultNodes = createDefaultNodes();
const defaultEdges = createDefaultEdges();

const INITIAL_CONFIGURATIONS = [
  {
    id: generateId('config'),
    name: "Disconnected Bot",
    nodes: defaultNodes,
    edges: defaultEdges,
    notes: generateArchitectureNotes(defaultNodes, defaultEdges)
  },
];

const QUIZZES = [
    {
        name: "Simple Concepts",
        questions: [
            "Explain the concept of black holes in simple terms.",
            "What is photosynthesis?",
            "Describe the water cycle briefly.",
        ]
    },
    {
        name: "Creative Writing",
        questions: [
            "Write a short opening line for a fantasy novel.",
            "Describe a futuristic city in one sentence.",
            "Create a single line of dialogue for a wise old robot.",
        ]
    }
];

const AI_MODEL_NAME = "gemini-2.5-flash";
let ai;

try {
  ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
} catch (error) {
  console.error("Failed to initialize GoogleGenAI:", error);
}


// --- EDITOR COMPONENTS ---

const Node = ({ data, onMouseDown, onCopy, onDelete, onSocketMouseDown, onSocketMouseUp }) => {
  const { id, position } = data;

  const handleActionClick = (e, action) => {
    e.stopPropagation();
    action(id);
  }

  return html`
    <div
      class="node"
      style=${{ top: `${position.y}px`, left: `${position.x}px` }}
      onMouseDown=${(e) => onMouseDown(e, id)}
    >
      <div class="node-actions">
          <button class="node-action-btn" title="Copy" onClick=${(e) => handleActionClick(e, onCopy)}>📄</button>
          <button class="node-action-btn" title="Delete" onClick=${(e) => handleActionClick(e, onDelete)}>🗑️</button>
      </div>
      <div class="socket output" onMouseDown=${(e) => { e.stopPropagation(); onSocketMouseDown(e, id, 'output'); }}></div>
      <div class="socket input" onMouseUp=${(e) => { e.stopPropagation(); onSocketMouseUp(e, id, 'input'); }}></div>
    </div>
  `;
};

const Edge = ({ edge, nodes, onClick }) => {
  const sourceNode = nodes.find((n) => n.id === edge.source);
  const targetNode = nodes.find((n) => n.id === edge.target);

  if (!sourceNode || !targetNode) return null;

  const nodeRadius = 30;
  const x1 = sourceNode.position.x + (nodeRadius * 2); // right edge of source
  const y1 = sourceNode.position.y + nodeRadius; // vertical center
  const x2 = targetNode.position.x; // left edge of target
  const y2 = targetNode.position.y + nodeRadius; // vertical center

  const pathData = `M ${x1} ${y1} C ${x1 + 50} ${y1}, ${x2 - 50} ${y2}, ${x2} ${y2}`;

  return html`
    <g class="edge-group" onClick=${() => onClick(edge.id)}>
      <path class="edge-interaction-area" d=${pathData} />
      <path class="edge-path" d=${pathData} />
    </g>
  `;
};

const EditorView = ({ config, onConfigChange, onBack }) => {
    const [nodes, setNodes] = useState(config.nodes);
    const [edges, setEdges] = useState(config.edges);
    const [draggedNode, setDraggedNode] = useState(null);
    const [wiringState, setWiringState] = useState(null);
    
    // Refs for stable event handling to prevent stale closures and frequent effect re-binding
    const draggedNodeRef = useRef(draggedNode);
    const wiringStateRef = useRef(wiringState);
    const canvasRef = useRef(null);

    useEffect(() => { draggedNodeRef.current = draggedNode; }, [draggedNode]);
    useEffect(() => { wiringStateRef.current = wiringState; }, [wiringState]);

    useEffect(() => {
        const notes = generateArchitectureNotes(nodes, edges);
        onConfigChange(config.id, { nodes, edges, notes });
    }, [nodes, edges, config.id, onConfigChange]);


    const handleNodeMouseDown = useCallback((e, nodeId) => {
        e.preventDefault();
        e.stopPropagation();
        const node = nodes.find(n => n.id === nodeId);
        setDraggedNode({
            id: nodeId,
            offsetX: e.clientX - node.position.x,
            offsetY: e.clientY - node.position.y
        });
    }, [nodes]);

    // Handle mouse move globally when interacting
    const handleMouseMove = useCallback((e) => {
        const currentWiring = wiringStateRef.current;
        const currentDragged = draggedNodeRef.current;

        if (currentWiring) {
            if (canvasRef.current) {
                const canvasRect = canvasRef.current.getBoundingClientRect();
                const mouseX = e.clientX - canvasRect.left;
                const mouseY = e.clientY - canvasRect.top;
                setWiringState(ws => ({ ...ws, endPos: { x: mouseX, y: mouseY } }));
            }
            return;
        }

        if (currentDragged) {
            e.preventDefault();
            const newX = e.clientX - currentDragged.offsetX;
            const newY = e.clientY - currentDragged.offsetY;
            setNodes(prevNodes => prevNodes.map(n => n.id === currentDragged.id ? { ...n, position: { x: newX, y: newY } } : n));
        }
    }, []);

    const handleMouseUp = useCallback(() => {
        setDraggedNode(null);
        setWiringState(null);
    }, []);
    
    // Attach window listeners when interaction starts to ensure "mouseup" is caught everywhere
    const isInteracting = !!draggedNode || !!wiringState;
    useEffect(() => {
        if (isInteracting) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isInteracting, handleMouseMove, handleMouseUp]);


    const handleSocketMouseDown = useCallback((e, nodeId, socketType) => {
        if (socketType !== 'output') return;
        const node = nodes.find(n => n.id === nodeId);
        const nodeRadius = 30;
        const startX = node.position.x + (nodeRadius * 2);
        const startY = node.position.y + nodeRadius;
        setWiringState({
            sourceId: nodeId,
            startPos: { x: startX, y: startY },
            endPos: { x: startX, y: startY },
        });
    }, [nodes]);

    const handleSocketMouseUp = useCallback((e, targetNodeId, socketType) => {
        if (socketType !== 'input' || !wiringState) return;

        const { sourceId } = wiringState;
        
        // Explicitly clear wiring state when release occurs on a socket
        setWiringState(null);

        if (sourceId === targetNodeId) return; // Disallow self-connection

        const edgeExists = edges.some(edge => edge.source === sourceId && edge.target === targetNodeId);
        if (edgeExists) return; // Disallow duplicate connections
        
        // Check if the new edge would create a cycle
        const potentialNewEdges = [...edges, { id: 'temp', source: sourceId, target: targetNodeId }];
        if (detectCycle(nodes, potentialNewEdges)) {
            alert("This connection would create a cycle and is not allowed.");
            return;
        }

        const newEdge = { id: generateId('edge'), source: sourceId, target: targetNodeId };
        setEdges([...edges, newEdge]);
    }, [wiringState, edges, nodes]);
    
    const handleEdgeDelete = useCallback((edgeId) => {
        if (window.confirm("Delete this connection?")) {
            setEdges(prevEdges => prevEdges.filter(e => e.id !== edgeId));
        }
    }, []);

    const handleCopy = (nodeId) => {
        const nodeToCopy = nodes.find(n => n.id === nodeId);
        const newNode = {
            ...nodeToCopy,
            id: generateId('node'),
            position: { x: nodeToCopy.position.x + 30, y: nodeToCopy.position.y + 30 }
        };
        setNodes([...nodes, newNode]);
    };

    const handleDelete = (nodeId) => {
        if (window.confirm("Are you sure you want to delete this node?")) {
            setNodes(nodes.filter(n => n.id !== nodeId));
            setEdges(edges.filter(e => e.source !== nodeId && e.target !== nodeId));
        }
    };

    const handleAddNode = () => {
        const newNode = {
            id: generateId('node'),
            position: { x: 100, y: 300 },
        };
        setNodes([...nodes, newNode]);
    };

    const getWiringPath = () => {
        if (!wiringState) return "";
        const { startPos, endPos } = wiringState;
        return `M ${startPos.x} ${startPos.y} L ${endPos.x} ${endPos.y}`;
    };

    return html`
        <div class="app-root editor-mode">
            <div class="app-header">
                <h1>Editing: ${config.name}</h1>
                <div>
                  <button class="add-node-btn" onClick=${handleAddNode}>+ Add Node</button>
                  <button class="back-btn" onClick=${onBack}>← Back to Configurations</button>
                </div>
            </div>
            <div class="main-container">
                <main class="canvas" ref=${canvasRef}>
                    <svg class="edges-svg">
                        ${edges.map(edge => h(Edge, { edge, nodes, onClick: handleEdgeDelete }))}
                        ${wiringState && html`<path class="edge-path-wiring" d=${getWiringPath()} />`}
                    </svg>
                    ${nodes.map(node => h(Node, {
                        data: node,
                        onMouseDown: handleNodeMouseDown,
                        onSocketMouseDown: handleSocketMouseDown,
                        onSocketMouseUp: handleSocketMouseUp,
                        onCopy: handleCopy,
                        onDelete: handleDelete
                    }))}
                </main>
            </div>
        </div>
    `;
};


// --- MAIN APP ---

const App = () => {
  const [configurations, setConfigurations] = useState(INITIAL_CONFIGURATIONS);
  const [view, setView] = useState('list');
  const [activeConfigId, setActiveConfigId] = useState(null);
  const [testConfigId, setTestConfigId] = useState(INITIAL_CONFIGURATIONS[0]?.id || null);
  const [renamingConfigId, setRenamingConfigId] = useState(null);

  const [selectedQuizName, setSelectedQuizName] = useState(QUIZZES[0].name);
  const [quizResults, setQuizResults] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  
  const handleUpdateConfig = useCallback((configId, updates) => {
      setConfigurations(configs => configs.map(c => 
          c.id === configId ? { ...c, ...updates } : c
      ));
  }, []);

  const executeGraph = async (userPrompt) => {
    const configToRun = configurations.find(c => c.id === testConfigId);
    if (!configToRun || !configToRun.nodes.length) {
        throw new Error("Please select a configuration with nodes to test.");
    }

    const { nodes, edges } = configToRun;
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const adj: Map<string, string[]> = new Map(nodes.map(n => [n.id, []]));
    const inDegree: Map<string, number> = new Map(nodes.map(n => [n.id, 0]));
    const outDegree: Map<string, number> = new Map(nodes.map(n => [n.id, 0]));

    for (const edge of edges) {
        if (nodeMap.has(edge.source) && nodeMap.has(edge.target)) {
            adj.get(edge.source).push(edge.target);
            inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
            outDegree.set(edge.source, (outDegree.get(edge.source) || 0) + 1);
        }
    }

    const queue = nodes.filter(n => inDegree.get(n.id) === 0).map(n => n.id);
    const sortedNodes = [];
    
    while (queue.length > 0) {
        const nodeId = queue.shift();
        sortedNodes.push(nodeId);
        const neighbors = adj.get(nodeId) || [];
        for (const neighborId of neighbors) {
            inDegree.set(neighborId, inDegree.get(neighborId) - 1);
            if (inDegree.get(neighborId) === 0) {
                queue.push(neighborId);
            }
        }
    }

    if (sortedNodes.length !== nodes.length) {
        throw new Error("Graph has a cycle and cannot be processed.");
    }

    const nodeOutputs = new Map();
    for (const nodeId of sortedNodes) {
        const parentEdges = edges.filter(e => e.target === nodeId);
        const parentNodeIds = parentEdges.map(e => e.source);
        const parentOutputs = parentNodeIds.map(pid => nodeOutputs.get(pid) || '');
        const combinedInput = parentOutputs.join('\n\n---\n\n');

        let filledPrompt = UNIVERSAL_NODE_PROMPT
            .replace(/{{user_prompt}}/g, userPrompt)
            .replace(/{{input}}/g, combinedInput);
        
        let currentOutput = '';
        if (filledPrompt.trim()) {
            const result = await ai.models.generateContent({
                model: AI_MODEL_NAME,
                contents: filledPrompt,
            });
            currentOutput = result.text;
        }
        nodeOutputs.set(nodeId, currentOutput);
    }

    const leafNodeIds = nodes.filter(n => outDegree.get(n.id) === 0).map(n => n.id);
    const finalOutputs = leafNodeIds.map(id => nodeOutputs.get(id) || '');
    
    return finalOutputs.join('\n\n---\n\n').trim() || "The AI produced no output.";
  };

  const handleRunQuiz = async () => {
    const configToRun = configurations.find(c => c.id === testConfigId);
    if (!configToRun || !configToRun.nodes.length) {
        setQuizResults([{ question: "Error", answer: "Please select a configuration with nodes to test." }]);
        return;
    }
    if (!ai) {
      setQuizResults([{ question: "Error", answer: "Gemini API key not configured. Check environment variables." }]);
      return;
    }
    
    setIsLoading(true);
    setQuizResults(null);
    
    const selectedQuiz = QUIZZES.find(q => q.name === selectedQuizName);
    if (!selectedQuiz) {
        setIsLoading(false);
        return;
    }

    try {
        const results = await Promise.all(selectedQuiz.questions.map(async (question) => {
            const answer = await executeGraph(question);
            return { question, answer };
        }));
        setQuizResults(results);
    } catch(error) {
      console.error("AI Quiz Error:", error);
      setQuizResults([{ question: "Quiz Failed", answer: `An error occurred: ${error.message}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateNewConfig = () => {
    const newNodes = createDefaultNodes();
    const newEdges = createDefaultEdges();
    const newConfig = {
      id: generateId('config'),
      name: `New AI ${configurations.length + 1}`,
      nodes: newNodes,
      edges: newEdges,
      notes: generateArchitectureNotes(newNodes, newEdges),
    };
    setConfigurations([...configurations, newConfig]);
    setTestConfigId(newConfig.id);
  };
  
  const handleCopyConfig = (configId) => {
    const configToCopy = configurations.find(c => c.id === configId);
    if (!configToCopy) return;

    const idMap = new Map();
    const newNodes = configToCopy.nodes.map(node => {
        const newId = generateId('node');
        idMap.set(node.id, newId);
        return {
            ...node,
            id: newId,
            position: { x: node.position.x + 20, y: node.position.y + 20 }
        };
    });

    const newEdges = configToCopy.edges.map(edge => ({
        ...edge,
        id: generateId('edge'),
        source: idMap.get(edge.source),
        target: idMap.get(edge.target),
    }));
    
    const newConfig = {
        id: generateId('config'),
        name: `${configToCopy.name} (Copy)`,
        nodes: newNodes,
        edges: newEdges,
        notes: generateArchitectureNotes(newNodes, newEdges),
    };
    setConfigurations([...configurations, newConfig]);
  };
  
  const handleDeleteConfig = (configId) => {
      if (configurations.length <= 1) {
          alert("You cannot delete the last configuration.");
          return;
      }
      if (window.confirm("Are you sure you want to delete this AI configuration?")) {
          const newConfigs = configurations.filter(c => c.id !== configId);
          setConfigurations(newConfigs);
          if (testConfigId === configId) {
              setTestConfigId(newConfigs[0]?.id || null);
          }
      }
  };
  
  const handleFinishRename = (configId, newName) => {
    setConfigurations(configurations.map(c => 
      c.id === configId ? { ...c, name: newName || c.name } : c
    ));
    setRenamingConfigId(null);
  };
  
  const handleEditConfig = (configId) => {
    setActiveConfigId(configId);
    setView('editor');
  };

  const activeConfigForEdit = useMemo(() => configurations.find(c => c.id === activeConfigId), [configurations, activeConfigId]);

  if (view === 'editor' && activeConfigForEdit) {
    return h(EditorView, {
      config: activeConfigForEdit,
      onConfigChange: handleUpdateConfig,
      onBack: () => setView('list'),
    });
  }

  const testConfig = configurations.find(c => c.id === testConfigId);

  return html`
    <div class="app-root list-mode">
        <div class="app-header">
            <h1>AI Configurations</h1>
            <button class="add-node-btn" onClick=${handleCreateNewConfig}>+ New Configuration</button>
        </div>
        <div class="main-container">
            <main class="config-list-container">
                ${configurations.map(config => html`
                    <div 
                      class="config-card ${config.id === testConfigId ? 'selected' : ''}"
                      onClick=${() => setTestConfigId(config.id)}
                    >
                        <div class="config-card-header">
                            ${renamingConfigId === config.id ? html`
                                <input 
                                    type="text" 
                                    class="config-rename-input"
                                    value=${config.name}
                                    onClick=${e => e.stopPropagation()}
                                    onBlur=${(e) => handleFinishRename(config.id, e.target.value)}
                                    onKeyDown=${(e) => { if (e.key === 'Enter') handleFinishRename(config.id, e.target.value) }}
                                    autoFocus
                                />
                            ` : html`
                                <h3 class="config-name">${config.name}</h3>
                            `}
                        </div>
                        <div class="config-card-actions">
                            <button onClick=${(e) => { e.stopPropagation(); setTestConfigId(config.id)}}>Test</button>
                            <button onClick=${(e) => { e.stopPropagation(); handleEditConfig(config.id) }}>Edit</button>
                            <button onClick=${(e) => { e.stopPropagation(); setRenamingConfigId(config.id) }}>Rename</button>
                            <button onClick=${(e) => { e.stopPropagation(); handleCopyConfig(config.id) }}>Copy</button>
                            <button class="danger" onClick=${(e) => { e.stopPropagation(); handleDeleteConfig(config.id) }}>Delete</button>
                        </div>
                    </div>
                `)}
            </main>
            <aside class="control-panel">
                <h2>Test Your AI</h2>
                ${!testConfig ? html`
                  <div class="panel-placeholder">Select or create a configuration to test.</div>
                ` : html`
                  <div class="control-group">
                    <label>Testing Configuration</label>
                    <div class="active-config-name">${testConfig.name}</div>
                  </div>
                  <div class="control-group">
                      <label for="quiz-select">Select Quiz</label>
                      <select id="quiz-select" class="quiz-select" value=${selectedQuizName} onInput=${(e) => setSelectedQuizName(e.target.value)}>
                        ${QUIZZES.map(quiz => html`<option value=${quiz.name}>${quiz.name}</option>`)}
                      </select>
                  </div>
                  <button class="run-btn" onClick=${handleRunQuiz} disabled=${isLoading}>
                      ${isLoading ? "Running Quiz..." : "Run Quiz"}
                  </button>
                  <div class="control-group output-group">
                      <label for="output-area">Output</label>
                      <div id="output-area" class="output-area ${isLoading ? 'loading-indicator' : ''}">
                          ${isLoading && !quizResults ? 'Running...' : ''}
                          ${!isLoading && !quizResults ? 'Run a quiz to see the results.' : ''}
                          ${quizResults && quizResults.map(result => html`
                            <div class="quiz-result-item">
                                <h4 class="quiz-question">${result.question}</h4>
                                <p class="quiz-answer">${result.answer}</p>
                            </div>
                          `)}
                      </div>
                  </div>
                  <div class="control-group output-group">
                      <label for="notepad-area">Architecture Report</label>
                      <div id="notepad-area" class="notepad-area readonly-notepad">
                        ${testConfig.notes || 'Notes will be auto-generated when you edit the configuration.'}
                      </div>
                  </div>
                `}
            </aside>
        </div>
        <div class="nerd-zone">
            <details>
                <summary>How It Works (For Nerds)</summary>
                <div class="nerd-content">
                    <p style=${{marginBottom: '16px'}}>This application is designed to demonstrate that an AI's behavior can be defined purely by its internal structure. Here's a peek under the hood:</p>
                    <ul>
                        <li>
                            <h4>Unified Node System</h4>
                            <p>Every node is functionally identical, powered by the same universal prompt. There are no special "input" or "output" nodes. This forces the focus onto the architecture of the graph, as it's the only thing you can change.</p>
                        </li>
                        <li>
                            <h4>Topological Sort Execution</h4>
                            <p>When you run a quiz, the system doesn't process nodes randomly. It performs a <a href="https://en.wikipedia.org/wiki/Topological_sorting" target="_blank" rel="noopener noreferrer">topological sort</a> on the graph to create a logical, ordered execution plan. It starts with "root" nodes (those with no inputs) and only processes a node once all its parents are complete. This prevents infinite loops in cycles and ensures information flows correctly.</p>
                        </li>
                        <li>
                            <h4>Dynamic Prompt Generation</h4>
                            <p>For each node in the execution sequence, the application dynamically builds a prompt to send to the Gemini API. It replaces the <code>${'{{user_prompt}}'}</code> placeholder with the current quiz question and the <code>${'{{input}}'}</code> placeholder with the combined text outputs from all direct parent nodes. If a node has multiple parents, their outputs are joined together with a separator, forcing the node to synthesize or integrate multiple lines of thought.</p>
                        </li>
                         <li>
                            <h4>Wiring & Architecture Examples</h4>
                            <p>The wiring is the *only* thing that defines the AI's thought process. Here’s what different structures do:</p>
                            <div class="nerd-example">
                                <h5>Linear Chain (A → B → C)</h5>
                                <p>This is an assembly line. The output of <code>A</code> becomes the input for <code>B</code>. <code>B</code> refines it, and its output becomes the input for <code>C</code>. This is good for sequential tasks like drafting, refining, and then summarizing an idea.</p>
                            </div>
                            <div class="nerd-example">
                                <h5>Parallel Processing / Branching (A → B, A → C)</h5>
                                <p>This is a brainstorm. <code>A</code> generates an idea, and both <code>B</code> and <code>C</code> receive that same idea as input. They process it independently, creating two separate lines of thought. This is useful for exploring pros and cons, or generating multiple creative options from a single prompt.</p>
                            </div>
                            <div class="nerd-example">
                                <h5>Merging / Synthesis (B → D, C → D)</h5>
                                <p>This is a committee meeting. Node <code>D</code> receives the outputs from *both* <code>B</code> and <code>C</code>. The text from both parents is joined together with a separator and passed into <code>D</code>'s <code>${'{{input}}'}</code> placeholder. The universal prompt then instructs <code>D</code> to build upon this combined text, forcing it to synthesize the two independent ideas.</p>
                            </div>
                             <div class="nerd-example">
                                <h5>Isolated Nodes (A, B)</h5>
                                <p>This creates fragmented results. Since neither node has an input, they both act as root nodes. They both receive the original <code>${'{{user_prompt}}'}</code> and produce completely independent outputs. The final answer is simply both of their outputs listed together.</p>
                            </div>
                        </li>
                        <li>
                            <h4>Live Architecture Report</h4>
                            <p>The report in the sidebar isn't static text. Every time you move a node or change a connection, a function re-analyzes the graph's structure by calculating the in-degrees and out-degrees of each node. This allows it to identify entry points, exit points, and potential design flaws in real-time.</p>
                        </li>
                        <li>
                            <h4>Reactive UI with Preact</h4>
                            <p>The entire interface is built with Preact and extensive use of hooks (<code>useState</code>, <code>useCallback</code>, etc.). The graph's state (nodes, edges, positions) is held in component state. When you drag a node or create a wire, you're updating that state, which causes Preact to efficiently re-render only the parts of the UI that have changed.</p>
                        </li>
                    </ul>
                </div>
            </details>
        </div>
    </div>
  `;
};

render(h(App, null), document.getElementById("app"));