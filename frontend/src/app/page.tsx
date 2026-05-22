"use client";

import React, { useState, useEffect } from "react";
import { Plus, MessageSquare, BarChart2, Trash2, Send, StopCircle, Clock, Cpu, Coins, AlertTriangle, ChevronDown, Check } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { SidebarProvider, SidebarTrigger, Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarHeader, SidebarFooter } from "@/components/ui/sidebar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/theme-toggle";

const AVAILABLE_MODELS = [
  { id: "gemini/gemini-1.5-pro-latest", name: "Gemini 1.5 Pro" },
  { id: "gemini/gemini-1.5-flash-latest", name: "Gemini 1.5 Flash" },
  { id: "gpt-4o", name: "GPT-4o" },
  { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo" },
  { id: "claude-3-5-sonnet-20240620", name: "Claude 3.5 Sonnet" }
];

interface Conversation {
  id: string;
  title: string;
}

interface RecentLog {
  id: string;
  model: string;
  provider: string;
  latency_ms: number;
  status: string;
  request_timestamp: string;
  input_preview: string;
  output_preview: string;
}

interface Metrics {
  avg_latency_ms: number;
  throughput_total: number;
  error_rate: number;
  errors: number;
  total_tokens: number;
  model_distribution: Record<string, number>;
  recent_logs: RecentLog[];
}

export default function ChatApp() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConv, setActiveConv] = useState<string | null>(null);
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState("gemini/gemini-1.5-pro-latest");
  const [view, setView] = useState<"chat" | "dashboard">("chat");
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<Metrics>({
    avg_latency_ms: 0,
    throughput_total: 0,
    error_rate: 0,
    errors: 0,
    total_tokens: 0,
    model_distribution: {},
    recent_logs: [],
  });
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  useEffect(() => {
    fetchConversations();
    fetchMetrics();
  }, []);

  const fetchConversations = async () => {
    try {
      const res = await fetch("http://localhost:8000/conversations");
      if (res.ok) setConversations(await res.json());
    } catch (e) {
      console.error("Failed to fetch conversations", e);
    }
  };

  const fetchMetrics = async () => {
    try {
      const res = await fetch("http://localhost:8000/dashboard/metrics");
      if (res.ok) {
        const data = await res.json();
        setMetrics({
          avg_latency_ms: data.avg_latency_ms || 0,
          throughput_total: data.throughput_total || 0,
          error_rate: data.error_rate || 0,
          errors: data.errors || 0,
          total_tokens: data.total_tokens || 0,
          model_distribution: data.model_distribution || {},
          recent_logs: data.recent_logs || [],
        });
      }
    } catch (e) {
      console.error("Failed to fetch metrics", e);
    }
  };

  const loadConversation = async (id: string) => {
    setActiveConv(id);
    setView("chat");
    try {
      const res = await fetch(`http://localhost:8000/conversations/${id}/messages`);
      if (res.ok) {
        setMessages(await res.json());
      }
    } catch (e) {
      console.error("Failed to load message history", e);
    }
  };

  const deleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await fetch(`http://localhost:8000/conversations/${id}`, { method: "DELETE" });
      if (activeConv === id) {
        setActiveConv(null);
        setMessages([]);
      }
      fetchConversations();
      fetchMetrics();
    } catch (error) {
      console.error("Failed to delete conversation", error);
    }
  };

  const cancelGeneration = () => {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
    }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage = { role: "user", content: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");

    const ctrl = new AbortController();
    setAbortController(ctrl);

    try {
      const res = await fetch("http://localhost:8000/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          conversation_id: activeConv,
          message: userMessage.content,
          model: model,
          provider: model.split("/")[0] || "unknown"
        })
      });

      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      
      let modelMessage = "";
      setMessages((prev) => [...prev, { role: "model", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ") && line !== "data: [DONE]") {
            try {
              const data = JSON.parse(line.substring(6));
              if (data.conversation_id && !activeConv) {
                setActiveConv(data.conversation_id);
                fetchConversations();
              }
              if (data.content) {
                modelMessage += data.content;
                setMessages((prev) => {
                  const newMsgs = [...prev];
                  newMsgs[newMsgs.length - 1].content = modelMessage;
                  return newMsgs;
                });
              }
            } catch (e) { }
          }
        }
      }
    } catch (error: any) {
      if (error.name !== "AbortError") {
        console.error("Stream generation error", error);
      }
    } finally {
      setAbortController(null);
      fetchMetrics();
    }
  };

  return (
    <SidebarProvider>
      <div className="flex h-[100dvh] w-full overflow-hidden bg-background text-foreground font-sans">
        
        {/* Main Application Sidebar */}
        <Sidebar className="border-r border-border">
          <SidebarHeader className="p-4 md:p-6 flex flex-row items-center justify-between">
            <h1 className="text-xl font-bold tracking-tight">Heimdall</h1>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setActiveConv(null); setMessages([]); setView("chat"); }}>
              <Plus className="h-4 w-4" />
              <span className="sr-only">New Chat</span>
            </Button>
          </SidebarHeader>

          <SidebarContent className="px-2">
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu className="gap-3 mt-4">
                  <SidebarMenuItem>
                    <SidebarMenuButton 
                      isActive={view === "chat"} 
                      onClick={() => setView("chat")}
                      className="transition-colors data-[active=true]:bg-black/10 dark:data-[active=true]:bg-white/10 data-[active=true]:font-semibold"
                    >
                      <MessageSquare className="h-4 w-4" />
                      <span>Chat</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton 
                      isActive={view === "dashboard"} 
                      onClick={() => { setView("dashboard"); fetchMetrics(); }}
                      className="transition-colors data-[active=true]:bg-black/10 dark:data-[active=true]:bg-white/10 data-[active=true]:font-semibold"
                    >
                      <BarChart2 className="h-4 w-4" />
                      <span>Telemetry</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <Separator className="my-2 opacity-50" />

            <SidebarGroup>
              <SidebarGroupLabel className="text-[11px] font-medium tracking-wider uppercase text-muted-foreground px-2">History</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {conversations.map((conv) => (
                    <SidebarMenuItem key={conv.id}>
                      <SidebarMenuButton 
                        isActive={activeConv === conv.id}
                        onClick={() => loadConversation(conv.id)}
                        className="group flex justify-between w-full transition-colors data-[active=true]:bg-black/10 dark:data-[active=true]:bg-white/10 data-[active=true]:font-semibold"
                      >
                        <span className="truncate pr-2">{conv.title}</span>
                        <Trash2 
                          className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity shrink-0" 
                          onClick={(e) => deleteConversation(conv.id, e)} 
                        />
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col h-full relative overflow-hidden bg-background">
          <header className="flex h-14 shrink-0 items-center justify-between border-b bg-background px-4 lg:h-[60px] lg:px-6">
            <div className="flex items-center gap-4">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mr-2 h-4" />
              <h2 className="text-base font-semibold">{view === "chat" ? "Heimdall Chat" : "Telemetry"}</h2>
            </div>
            <ThemeToggle />
          </header>

          {view === "dashboard" ? (
            <div className="flex-1 overflow-auto p-4 sm:p-6 lg:p-8">
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
                <div>
                  <h2 className="text-2xl lg:text-3xl font-bold tracking-tight">System Metrics</h2>
                  <p className="text-sm text-muted-foreground mt-1">Real-time LLM execution metrics</p>
                </div>
                <Button variant="outline" size="sm" onClick={fetchMetrics} className="w-fit">Refresh</Button>
              </div>

              {/* Bento Grid - Top Row */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
                <Card className="shadow-sm">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Avg Latency</CardTitle>
                    <Clock className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{metrics.avg_latency_ms} <span className="text-sm font-normal text-muted-foreground">ms</span></div>
                  </CardContent>
                </Card>

                <Card className="shadow-sm">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Throughput</CardTitle>
                    <Cpu className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{metrics.throughput_total} <span className="text-sm font-normal text-muted-foreground">req</span></div>
                  </CardContent>
                </Card>

                <Card className="shadow-sm">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Error Rate</CardTitle>
                    <AlertTriangle className={`h-4 w-4 ${metrics.error_rate > 0 ? 'text-destructive' : 'text-muted-foreground'}`} />
                  </CardHeader>
                  <CardContent>
                    <div className={`text-2xl font-bold ${metrics.error_rate > 0 ? 'text-destructive' : ''}`}>{metrics.error_rate} <span className="text-sm font-normal text-muted-foreground">%</span></div>
                  </CardContent>
                </Card>

                <Card className="shadow-sm">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Tokens</CardTitle>
                    <Coins className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {metrics.total_tokens >= 1000 ? `${(metrics.total_tokens / 1000).toFixed(1)}k` : metrics.total_tokens}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Bento Grid - Bottom Row */}
              <div className="grid gap-4 md:gap-6 lg:grid-cols-3">
                <Card className="shadow-sm lg:col-span-1">
                  <CardHeader>
                    <CardTitle className="text-base font-semibold">Model Distribution</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {Object.keys(metrics.model_distribution).length === 0 ? (
                      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                        No models logged
                      </div>
                    ) : (
                      <div className="flex flex-col gap-4">
                        {Object.entries(metrics.model_distribution).map(([modelName, count], idx) => {
                          const total = metrics.throughput_total || 1;
                          const pct = Math.round((count / total) * 100);
                          return (
                            <div key={modelName} className="flex flex-col gap-1.5">
                              <div className="flex items-center justify-between text-sm">
                                <span className="font-medium truncate max-w-[150px]" title={modelName}>{modelName.split("/").pop()}</span>
                                <span className="text-muted-foreground">{count} ({pct}%)</span>
                              </div>
                              <div className="w-full bg-secondary h-2 rounded-full overflow-hidden">
                                <motion.div 
                                  initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ delay: 0.1 * idx, duration: 0.8 }}
                                  className="bg-primary h-full rounded-full" 
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="shadow-sm lg:col-span-2">
                  <CardHeader>
                    <CardTitle className="text-base font-semibold">Live Events</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0 sm:p-6 sm:pt-0">
                    {metrics.recent_logs.length === 0 ? (
                      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                        Listening for stream events...
                      </div>
                    ) : (
                      <div className="flex flex-col">
                        {metrics.recent_logs.map((log, idx) => (
                          <div 
                            key={log.id} 
                            className={`py-3 px-4 sm:px-0 border-b border-border hover:bg-muted/50 transition-colors cursor-pointer ${idx === metrics.recent_logs.length - 1 ? 'border-0' : ''}`}
                            onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                          >
                            <div className="flex items-center justify-between gap-4 text-sm">
                              <div className="flex items-center gap-3">
                                <span className={`px-2 py-0.5 rounded-md text-[10px] uppercase font-semibold ${log.status === 'success' ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'}`}>
                                  {log.status}
                                </span>
                                <span className="font-medium text-foreground truncate max-w-[120px] sm:max-w-[200px]">{log.model.split("/").pop()}</span>
                              </div>
                              <span className="text-muted-foreground text-xs">{log.latency_ms}ms</span>
                            </div>
                            
                            <AnimatePresence>
                              {expandedLog === log.id && (
                                <motion.div 
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: "auto", opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  className="overflow-hidden mt-3 pt-3 border-t border-border flex flex-col gap-3"
                                >
                                  <div className="flex flex-col gap-1.5">
                                    <span className="text-xs font-medium text-muted-foreground">Input</span>
                                    <div className="p-2.5 bg-muted rounded-md text-xs whitespace-pre-wrap select-all max-h-24 overflow-y-auto font-mono">
                                      {log.input_preview || "None"}
                                    </div>
                                  </div>
                                  <div className="flex flex-col gap-1.5">
                                    <span className="text-xs font-medium text-muted-foreground">Output</span>
                                    <div className="p-2.5 bg-muted rounded-md text-xs whitespace-pre-wrap select-all max-h-32 overflow-y-auto font-mono">
                                      {log.output_preview || "None"}
                                    </div>
                                  </div>
                                  <span className="text-[10px] text-muted-foreground self-end">ID: {log.id}</span>
                                </motion.div>
                              )}
                            </AnimatePresence>
                            
                            {expandedLog !== log.id && (
                              <p className="text-xs text-muted-foreground truncate mt-1">
                                {log.input_preview || "Empty"}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden relative">
              {/* Chat Messages */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 no-scrollbar">
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full max-w-sm mx-auto text-center space-y-4">
                    <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                      <MessageSquare className="h-6 w-6 text-primary" />
                    </div>
                    <h2 className="text-xl font-semibold tracking-tight">Heimdall</h2>
                    <p className="text-sm text-muted-foreground">Start a conversation or select an existing one from the sidebar.</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-6 max-w-3xl w-full mx-auto pb-4">
                    <AnimatePresence initial={false}>
                      {messages.map((msg, idx) => (
                        <motion.div 
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          key={idx} 
                          className={`flex flex-col max-w-[85%] ${msg.role === "user" ? "ml-auto items-end" : "mr-auto items-start"}`}
                        >
                          <div className={`px-3 py-1.5 rounded-xl shadow-sm text-sm ${msg.role === 'user' ? 'bg-primary text-primary-foreground rounded-br-sm' : 'bg-card border border-border text-card-foreground rounded-tl-sm'}`}>
                            <p className="leading-relaxed whitespace-pre-wrap">
                              {msg.content || <span className="animate-pulse opacity-70">Thinking...</span>}
                            </p>
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                )}
              </div>

              {/* Chat Input Controls */}
              <div className="p-4 sm:p-6 bg-background/80 backdrop-blur-sm border-t border-border shrink-0">
                <div className="max-w-3xl mx-auto flex flex-col gap-2">
                  <form onSubmit={sendMessage} className="relative flex flex-col sm:flex-row items-center gap-2">
                    <div className="relative flex-1 w-full flex items-center">
                      <Input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Message Heimdall..."
                        disabled={!!abortController}
                        className="pr-12 h-12 rounded-lg bg-muted/50 border-border focus-visible:ring-1 focus-visible:ring-primary shadow-sm"
                      />
                      {abortController ? (
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon"
                          onClick={cancelGeneration}
                          className="absolute right-1.5 h-9 w-9"
                          title="Cancel stream"
                        >
                          <StopCircle className="h-5 w-5" />
                        </Button>
                      ) : (
                        <Button
                          type="submit"
                          size="icon"
                          disabled={!input.trim()}
                          className="absolute right-1.5 h-9 w-9 rounded-md transition-all active:scale-95"
                        >
                          <Send className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </form>
                  
                  <div className="flex items-center justify-between w-full mt-1">
                    <DropdownMenu>
                      <DropdownMenuTrigger className="inline-flex h-8 items-center justify-center rounded-md px-3 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                        {AVAILABLE_MODELS.find(m => m.id === model)?.name || "Select Model"}
                        <ChevronDown className="ml-2 h-3 w-3" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-[200px]">
                        {AVAILABLE_MODELS.map((m) => (
                          <DropdownMenuItem 
                            key={m.id} 
                            onClick={() => setModel(m.id)}
                            className="flex items-center justify-between text-xs cursor-pointer"
                          >
                            {m.name}
                            {model === m.id && <Check className="h-3 w-3" />}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    
                    <span className="text-[10px] text-muted-foreground">Heimdall can make mistakes.</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </SidebarProvider>
  );
}
