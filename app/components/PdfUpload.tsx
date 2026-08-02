"use client";
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
type AuthMode = "signin" | "signup";
type ChatRole = "user" | "bot";

type ChatMessage = {
  role: ChatRole;
  content: string;
};

type ChatRecord = {
  id: string;
  name: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt?: string;
};

type WorkspaceRecord = {
  id: string;
  name: string;
  apiName: string;
  databaseId: string;
  files: string[];
  chats: ChatRecord[];
  createdAt: string;
};

type AuthState = {
  token: string;
  userId: string;
  displayName: string;
  username: string;
  email: string;
};

type BackendRecord = Record<string, unknown>;

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const AUTH_STORAGE_KEY = "pepper-auth";

const createId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const toUiMessages = (messages: unknown): ChatMessage[] => {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages.flatMap((message) => {
    if (!message || typeof message !== "object") {
      return [];
    }

    const entry = message as Record<string, unknown>;
    if (entry.role === "user" || entry.role === "bot") {
      return [{ role: entry.role, content: String(entry.content ?? "") }];
    }
    if (typeof entry.user === "string") {
      return [{ role: "user", content: entry.user }];
    }
    if (typeof entry.bot === "string") {
      return [{ role: "bot", content: entry.bot }];
    }
    return [];
  });
};

const toDbFlow = (messages: ChatMessage[]) =>
  messages.map((message) => (message.role === "user" ? { user: message.content } : { bot: message.content }));

const textValue = (value: unknown, fallback = "") => (typeof value === "string" && value ? value : fallback);

const mapWorkspace = (workspace: BackendRecord, index: number): WorkspaceRecord => ({
  id: textValue(workspace.workspace_id, createId(`workspace-${index}`)),
  name: textValue(workspace.workspace_name, "Workspace"),
  apiName: textValue(workspace.collection_name, textValue(workspace.workspace_name, "workspace")),
  databaseId: textValue(workspace.workspace_id, createId(`workspace-${index}`)),
  files: Array.isArray(workspace.files)
    ? workspace.files
        .map((file) => {
          const record = file as BackendRecord;
          return textValue(record.file_name, textValue(record.filename));
        })
        .filter(Boolean)
    : [],
  chats: Array.isArray(workspace.chats)
    ? workspace.chats.map((chat, chatIndex) => {
        const record = chat as BackendRecord;
        return {
          id: textValue(record.chat_id, createId(`chat-${chatIndex}`)),
          name: textValue(record.chat_name, `Chat ${chatIndex + 1}`),
          messages: toUiMessages(record.messages),
          createdAt: textValue(record.created_at, new Date().toISOString()),
          updatedAt: textValue(record.updated_at) || undefined,
        };
      })
    : [],
  createdAt: textValue(workspace.created_at, new Date().toISOString()),
});

const readStoredState = <T,>(key: string): T | null => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const item = window.localStorage.getItem(key);
    return item ? (JSON.parse(item) as T) : null;
  } catch {
    return null;
  }
};

const writeStoredState = (key: string, value: unknown) => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(key, JSON.stringify(value));
};

const LoadingState = ({ title, description }: { title: string; description: string }) => (
  <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-8 text-center">
    <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
    <p className="font-medium text-slate-200">{title}</p>
    <p className="mt-1 text-sm text-slate-400">{description}</p>
  </div>
);

export const PdfUpload = () => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("signin");
  const [authForm, setAuthForm] = useState({
    displayName: "",
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [authState, setAuthState] = useState<AuthState | null>(() => readStoredState<AuthState>(AUTH_STORAGE_KEY));
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [workspaceNameInput, setWorkspaceNameInput] = useState("");
  const [activeView, setActiveView] = useState<"upload" | "chat">("upload");
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [chatDraft, setChatDraft] = useState("");
  const [isChatting, setIsChatting] = useState(false);

  useEffect(() => {
    if (authState) {
      void reloadWorkspaces(authState.userId);
    }
  }, [authState]);

  useEffect(() => {
    if (authState) {
      writeStoredState(AUTH_STORAGE_KEY, authState);
    }
  }, [authState]);

  const selectedWorkspace = useMemo(() => {
    return workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null;
  }, [selectedWorkspaceId, workspaces]);

  const selectedChat = useMemo(() => {
    if (!selectedWorkspace) {
      return null;
    }

    return selectedWorkspace.chats.find((chat) => chat.id === selectedChatId) ?? null;
  }, [selectedChatId, selectedWorkspace]);

  async function reloadWorkspaces(userId: string) {
    setIsLoadingData(true);
    setError("");

    try {
      const response = await fetch(`${API_BASE}/api/v1/workspace/fetch?user_id=${encodeURIComponent(userId)}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.detail || "Unable to load workspaces.");
      }

      const nextWorkspaces: WorkspaceRecord[] = Array.isArray(payload.workspaces)
        ? payload.workspaces.map((workspace: unknown, index: number) => mapWorkspace(workspace as BackendRecord, index))
        : [];

      setWorkspaces(nextWorkspaces);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load workspaces.");
    } finally {
      setIsLoadingData(false);
    }
  }

  const handleInputChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = event.target;
    setAuthForm((current) => ({ ...current, [name]: value }));
  };

  const handleAuthSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setStatusMessage("");
    setIsSubmitting(true);

    try {
      if (authMode === "signup") {
        if (authForm.password.length < 6) {
          throw new Error("Password must be at least 6 characters long.");
        }

        if (authForm.password !== authForm.confirmPassword) {
          throw new Error("Passwords do not match.");
        }

        const response = await fetch(`${API_BASE}/api/v1/signup/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: authForm.email,
            password: authForm.password,
            display_name: authForm.displayName,
            username: authForm.username,
          }),
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.detail || "Signup failed.");
        }

        setStatusMessage("Account created. Please sign in with your email and password.");
        setAuthMode("signin");
        setAuthForm((current) => ({ ...current, displayName: "", confirmPassword: "" }));
        return;
      }

      const response = await fetch(`${API_BASE}/api/v1/signin/`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          username: authForm.email || authForm.username,
          password: authForm.password,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = payload.detail || "Authentication failed.";
        if (response.status === 404) {
          setAuthMode("signup");
          setError("No account was found for that email. Please create an account first.");
          return;
        }
        throw new Error(message);
      }

      const nextAuth: AuthState = {
        token: payload.access_token,
        userId: payload.user_id || authForm.email,
        displayName: payload.display_name || authForm.displayName || authForm.username || authForm.email,
        username: payload.username || authForm.username || authForm.email,
        email: payload.email || authForm.email,
      };
      setAuthState(nextAuth);
      setStatusMessage("Signed in successfully.");
      setAuthForm((current) => ({ ...current, password: "" }));
      await reloadWorkspaces(nextAuth.userId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateWorkspace = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = workspaceNameInput.trim();

    if (!trimmedName) {
      setError("Enter a workspace name.");
      return;
    }

    try {
      setError("");
      setStatusMessage("Creating workspace...");
      const response = await fetch(`${API_BASE}/api/v1/workspace/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace_name: trimmedName, user_id: authState?.userId || "anonymous" }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.detail || "Workspace creation failed.");
      }

      const nextWorkspace: WorkspaceRecord = {
        id: payload.workspace_id || createId("workspace"),
        name: payload.workspace_name || trimmedName,
        apiName: payload.collection_name || trimmedName,
        databaseId: payload.workspace_id || createId("workspace"),
        files: [],
        chats: [],
        createdAt: new Date().toISOString(),
      };

      setWorkspaces((current) => [nextWorkspace, ...current]);
      setSelectedWorkspaceId(null);
      setSelectedChatId(null);
      setWorkspaceNameInput("");
      setStatusMessage(`Workspace "${nextWorkspace.name}" is ready.`);
      await reloadWorkspaces(authState?.userId || "anonymous");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Workspace creation failed.");
    }
  };

  const handleUploadFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    const workspace = selectedWorkspace;

    if (!workspace || !files?.length) {
      return;
    }

    try {
      setError("");
      setStatusMessage("Uploading PDF files...");
      const nextFiles = Array.from(files);

      for (const file of nextFiles) {
        if (file.type !== "application/pdf") {
          throw new Error(`Only PDF files are supported. ${file.name} was skipped.`);
        }

        const formData = new FormData();
        formData.append("file", file);
        formData.append("collection_name", workspace.apiName);
        formData.append("workspace_name", workspace.apiName);
        formData.append("workspace_id", workspace.databaseId || workspace.id);
        formData.append("user_id", authState?.userId || "anonymous");

        const response = await fetch(`${API_BASE}/api/v1/upload/`, {
          method: "POST",
          body: formData,
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.detail || `Upload failed for ${file.name}.`);
        }
      }

      setWorkspaces((current) =>
        current.map((entry) =>
          entry.id === workspace.id
            ? { ...entry, files: [...new Set([...entry.files, ...nextFiles.map((file) => file.name)])] }
            : entry,
        ),
      );
      setStatusMessage(`Uploaded ${nextFiles.length} PDF file${nextFiles.length > 1 ? "s" : ""}.`);
      setActiveView("upload");
      await reloadWorkspaces(authState?.userId || "anonymous");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const saveChat = async (workspace: WorkspaceRecord, chat: ChatRecord) => {
    const response = await fetch(`${API_BASE}/api/v1/chats/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: authState?.userId || "anonymous",
        workspace_id: workspace.databaseId || workspace.id,
        chat_id: chat.id,
        chat_name: chat.name,
        messages: toDbFlow(chat.messages),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.detail || "Unable to save chat.");
    }
    return payload;
  };

  const createChat = async () => {
    if (!selectedWorkspace) {
      return;
    }

    const nextChat: ChatRecord = {
      id: createId("chat"),
      name: `Chat ${selectedWorkspace.chats.length + 1}`,
      messages: [],
      createdAt: new Date().toISOString(),
    };

    try {
      setError("");
      await saveChat(selectedWorkspace, nextChat);
      setWorkspaces((current) =>
        current.map((entry) => (entry.id === selectedWorkspace.id ? { ...entry, chats: [nextChat, ...entry.chats] } : entry)),
      );
      setSelectedChatId(nextChat.id);
      setActiveView("chat");
      setChatDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create chat.");
    }
  };

  const deleteChat = async (chatId: string) => {
    if (!selectedWorkspace) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/v1/chats/${encodeURIComponent(chatId)}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.detail || "Unable to delete chat.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete chat.");
      return;
    }

    setWorkspaces((current) =>
      current.map((entry) =>
        entry.id === selectedWorkspace.id ? { ...entry, chats: entry.chats.filter((chat) => chat.id !== chatId) } : entry,
      ),
    );

    if (selectedChatId === chatId) {
      const remainingChats = selectedWorkspace.chats.filter((chat) => chat.id !== chatId);
      setSelectedChatId(remainingChats[0]?.id ?? null);
    }
  };

  const handleSendMessage = async () => {
    const workspace = selectedWorkspace;
    if (!workspace || !chatDraft.trim()) {
      return;
    }

    const draft = chatDraft.trim();
    const currentChat = selectedChat ?? null;

    const optimisticMessages: ChatMessage[] = currentChat?.messages ?? [];
    const nextUserMessage: ChatMessage = { role: "user", content: draft };
    const nextMessages = [...optimisticMessages, nextUserMessage];

    const nextChat: ChatRecord = currentChat
      ? { ...currentChat, messages: nextMessages, name: currentChat.name }
      : {
          id: createId("chat"),
          name: `Chat ${workspace.chats.length + 1}`,
          messages: [nextUserMessage],
          createdAt: new Date().toISOString(),
        };

    setWorkspaces((current) =>
      current.map((entry) => {
        if (entry.id !== workspace.id) {
          return entry;
        }

        if (currentChat) {
          return {
            ...entry,
            chats: entry.chats.map((chat) => (chat.id === currentChat.id ? nextChat : chat)),
          };
        }

        return {
          ...entry,
          chats: [nextChat, ...entry.chats],
        };
      }),
    );
    setSelectedChatId(nextChat.id);
    setChatDraft("");
    setIsChatting(true);

    try {
      const historyContext = nextMessages
        .map((message) => `${message.role === "user" ? "User" : "Bot"}: ${message.content}`)
        .join("\n");

      await saveChat(workspace, { ...nextChat, messages: nextMessages });

      const response = await fetch(`${API_BASE}/api/v1/ask_ai/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace_id: selectedWorkspaceId,
          question: historyContext,
          collection_name: selectedWorkspace.apiName
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.detail || "The agent could not answer right now.");
      }

      const botReply = payload.answer || "I'm ready to help with the uploaded documents.";
      const updatedMessages: ChatMessage[] = [...nextMessages, { role: "bot", content: botReply }];
      await saveChat(workspace, { ...nextChat, messages: updatedMessages });
      setWorkspaces((current) =>
        current.map((entry) => {
          if (entry.id !== workspace.id) {
            return entry;
          }

          return {
            ...entry,
            chats: entry.chats.map((chat) =>
              chat.id === nextChat.id
                ? { ...chat, messages: updatedMessages }
                : chat,
            ),
          };
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "The agent could not answer.");
    } finally {
      setIsChatting(false);
    }
  };

  const signOut = () => {
    setAuthState(null);
    setSelectedWorkspaceId(null);
    setWorkspaces([]);
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
  };

  const handleAskQuestions = async () => {
    if (!selectedWorkspace) {
      return;
    }

    setIsLoadingData(true);
    setError("");
    setStatusMessage("Preparing your workspace context...");

    try {
      const response = await fetch(`${API_BASE}/api/v1/vectorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collection_name: selectedWorkspace.apiName, workspace_id: selectedWorkspaceId }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.detail || "The agent could not answer right now.");
      }

      if (payload.failed?.length) {
        throw new Error("There is an issue with the uploaded files try later...");
      }

      setActiveView("chat");
      setStatusMessage("Workspace context is ready.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The agent could not answer right now.");
    } finally {
      setIsLoadingData(false);
    }
  };

  if (!authState && !selectedWorkspaceId) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-5xl flex-col gap-6 rounded-3xl border border-slate-800 bg-slate-900/90 p-6 shadow-2xl shadow-black/40 sm:p-10">
          <div className="space-y-2">
            <p className="text-sm uppercase tracking-[0.35em] text-sky-400">Pepper</p>
            <h1 className="text-3xl font-semibold">Welcome to your minimalist workspace assistant</h1>
            <p className="max-w-2xl text-sm text-slate-400">
              Sign in to continue, or create an account and start building collections, uploading PDFs, and chatting with your documents.
            </p>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                setAuthMode("signin");
                setError("");
              }}
              className={`rounded-full px-4 py-2 text-sm font-medium ${authMode === "signin" ? "bg-sky-500 text-white" : "bg-slate-800 text-slate-300"}`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode("signup");
                setError("");
              }}
              className={`rounded-full px-4 py-2 text-sm font-medium ${authMode === "signup" ? "bg-sky-500 text-white" : "bg-slate-800 text-slate-300"}`}
            >
              Create account
            </button>
          </div>

          <form onSubmit={handleAuthSubmit} className="grid gap-4 rounded-2xl border border-slate-800 bg-slate-950/70 p-5 sm:grid-cols-2">
            {authMode === "signup" && (
              <label className="sm:col-span-2">
                <span className="mb-1 block text-sm text-slate-400">Full name</span>
                <input
                  name="displayName"
                  value={authForm.displayName}
                  onChange={handleInputChange}
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none ring-0"
                  placeholder="Alex Carter"
                  required
                />
              </label>
            )}

            <label className="sm:col-span-2">
              <span className="mb-1 block text-sm text-slate-400">Email or username</span>
              <input
                name="email"
                value={authForm.email}
                onChange={handleInputChange}
                className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none ring-0"
                placeholder="you@example.com"
                required
              />
            </label>

            {authMode === "signup" && (
              <label>
                <span className="mb-1 block text-sm text-slate-400">Username</span>
                <input
                  name="username"
                  value={authForm.username}
                  onChange={handleInputChange}
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none ring-0"
                  placeholder="alex"
                  required
                />
              </label>
            )}

            <label>
              <span className="mb-1 block text-sm text-slate-400">Password</span>
              <input
                type="password"
                name="password"
                value={authForm.password}
                onChange={handleInputChange}
                className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none ring-0"
                placeholder="••••••"
                required
              />
            </label>

            {authMode === "signup" && (
              <label>
                <span className="mb-1 block text-sm text-slate-400">Confirm password</span>
                <input
                  type="password"
                  name="confirmPassword"
                  value={authForm.confirmPassword}
                  onChange={handleInputChange}
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none ring-0"
                  placeholder="••••••"
                  required
                />
              </label>
            )}

            <div className="sm:col-span-2 flex flex-col gap-2">
              <button
                type="submit"
                disabled={isSubmitting}
                className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? "Working..." : authMode === "signin" ? "Sign in" : "Create account"}
              </button>
              {error ? <p className="text-sm text-rose-400">{error}</p> : null}
              {statusMessage ? <p className="text-sm text-emerald-400">{statusMessage}</p> : null}
            </div>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-slate-800 bg-slate-900/90 p-4 shadow-lg shadow-black/20">
          <div>
            <p className="text-sm uppercase tracking-[0.35em] text-sky-400">Pepper</p>
            <h2 className="text-xl font-semibold">Workspace dashboard</h2>
          </div>
          <div className="flex items-center gap-3">
            <div className="rounded-full border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300">
              {authState?.displayName || authState?.username}
            </div>
            <button
              type="button"
              onClick={signOut}
              className="rounded-full border border-slate-700 px-3 py-2 text-sm text-slate-300 transition hover:bg-slate-800"
            >
              Sign out
            </button>
          </div>
        </header>

        {error ? <p className="rounded-2xl border border-rose-800/60 bg-rose-950/60 px-4 py-3 text-sm text-rose-300">{error}</p> : null}
        {statusMessage ? <p className="rounded-2xl border border-emerald-800/60 bg-emerald-950/60 px-4 py-3 text-sm text-emerald-300">{statusMessage}</p> : null}

        {!selectedWorkspace ? (
          <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-3xl border border-slate-800 bg-slate-900/90 p-6 shadow-lg shadow-black/20">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">Your collections</h3>
                  <p className="text-sm text-slate-400">Create a workspace and upload PDFs to start asking questions.</p>
                </div>
                <form onSubmit={handleCreateWorkspace} className="flex gap-2">
                  <input
                    value={workspaceNameInput}
                    onChange={(event) => setWorkspaceNameInput(event.target.value)}
                    className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none"
                    placeholder="New workspace"
                  />
                  <button type="submit" className="rounded-xl bg-sky-500 px-3 py-2 text-sm font-semibold text-white">
                    Create
                  </button>
                </form>
              </div>

              {isLoadingData ? (
                <LoadingState title="Loading your collections" description="We’re pulling your workspace data from the server." />
              ) : workspaces.length ? (
                <div className="grid gap-3">
                  {workspaces.map((workspace) => (
                    <button
                      key={workspace.id}
                      type="button"
                      onClick={() => {
                        setSelectedWorkspaceId(workspace.id);
                        setSelectedChatId(workspace.chats[0]?.id ?? null);
                        setActiveView("upload");
                      }}
                      className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-left transition hover:border-sky-500"
                    >
                      <div>
                        <p className="font-medium">{workspace.name}</p>
                        <p className="text-sm text-slate-400">{workspace.files.length} PDF{workspace.files.length === 1 ? "" : "s"} · {workspace.chats.length} chat{workspace.chats.length === 1 ? "" : "s"}</p>
                      </div>
                      <span className="text-sm text-sky-400">Open</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/60 p-6 text-sm text-slate-400">
                  No workspaces yet. Create one to begin.
                </div>
              )}
            </div>

            <div className="rounded-3xl border border-slate-800 bg-slate-900/90 p-6 shadow-lg shadow-black/20">
              <h3 className="text-lg font-semibold">How it works</h3>
              <ul className="mt-4 space-y-3 text-sm text-slate-400">
                <li>• Create a workspace and keep your documents organized.</li>
                <li>• Upload PDFs and ask questions in the same space.</li>
                <li>• Manage multiple chats without losing context.</li>
              </ul>
            </div>
          </section>
        ) : (
          <section className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
            <aside className="rounded-3xl border border-slate-800 bg-slate-900/90 p-4 shadow-lg shadow-black/20">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm uppercase tracking-[0.35em] text-sky-400">Workspace</p>
                  <h3 className="text-lg font-semibold">{selectedWorkspace.name}</h3>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedWorkspaceId(null);
                    setSelectedChatId(null);
                    setActiveView("upload");
                  }}
                  className="rounded-full border border-slate-700 px-3 py-2 text-sm text-slate-300"
                >
                  Dashboard
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-medium text-slate-300">PDF files</p>
                    <span className="text-xs text-slate-500">{selectedWorkspace.files.length}</span>
                  </div>
                  {selectedWorkspace.files.length ? (
                    <ul className="space-y-2">
                      {selectedWorkspace.files.map((fileName) => (
                        <li key={fileName} className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm text-slate-300">
                          {fileName}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="rounded-xl border border-dashed border-slate-700 bg-slate-950/60 px-3 py-3 text-sm text-slate-400">
                      Upload a PDF to enable the chat experience.
                    </p>
                  )}
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-medium text-slate-300">Chats</p>
                    <button type="button" onClick={createChat} className="text-xs font-medium text-sky-400">
                      + New chat
                    </button>
                  </div>
                  {selectedWorkspace.chats.length ? (
                    <div className="space-y-2">
                      {selectedWorkspace.chats.map((chat) => (
                        <div key={chat.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm">
                          <button type="button" onClick={() => { setSelectedChatId(chat.id); setActiveView("chat"); }} className="flex-1 text-left text-slate-300">
                            {chat.name}
                          </button>
                          <button type="button" onClick={() => deleteChat(chat.id)} className="text-xs text-rose-400">
                            Delete
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-xl border border-dashed border-slate-700 bg-slate-950/60 px-3 py-3 text-sm text-slate-400">
                      Start your first conversation.
                    </p>
                  )}
                </div>
              </div>
            </aside>

            <div className="rounded-3xl border border-slate-800 bg-slate-900/90 p-4 shadow-lg shadow-black/20">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm uppercase tracking-[0.35em] text-sky-400">Workspace tools</p>
                  <h3 className="text-lg font-semibold">Upload and ask</h3>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setActiveView("upload")} className={`rounded-full px-3 py-2 text-sm ${activeView === "upload" ? "bg-sky-500 text-white" : "bg-slate-800 text-slate-300"}`}>
                    Upload
                  </button>
                  <button type="button" onClick={() => setActiveView("chat")} className={`rounded-full px-3 py-2 text-sm ${activeView === "chat" ? "bg-sky-500 text-white" : "bg-slate-800 text-slate-300"}`}>
                    Chat
                  </button>
                </div>
              </div>

              {isLoadingData ? (
                <div className="flex h-[520px] items-center justify-center rounded-2xl border border-slate-800 bg-slate-950/70 p-6">
                  <LoadingState title="Preparing workspace context" description="We’re processing your request so the UI stays clear while data is loading." />
                </div>
              ) : activeView === "upload" ? (
                <div className="space-y-4">
                  <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-slate-700 bg-slate-950/70 p-8 text-center text-sm text-slate-400">
                    <span className="mb-2 text-lg font-semibold text-slate-200">Drop in a PDF</span>
                    <span>Upload one or more PDF files to populate this workspace.</span>
                    <input type="file" ref={fileInputRef} accept=".pdf" multiple onChange={handleUploadFiles} className="hidden" />
                  </label>

                  <div className="flex flex-wrap items-center gap-3">
                    <button type="button" onClick={() => fileInputRef.current?.click()} className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white">
                      Select PDF files
                    </button>
                    {selectedWorkspace.files.length ? (
                      <button type="button" onClick={() => handleAskQuestions()} className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300">
                        Ask questions
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="flex h-[520px] flex-col rounded-2xl border border-slate-800 bg-slate-950/70">
                  <div className="flex-1 space-y-3 overflow-y-auto p-4">
                    {selectedChat?.messages.length ? (
                      selectedChat.messages.map((message, index) => (
                        <div key={`${message.role}-${index}`} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[85%] rounded-2xl px-5 py-3.5 text-[15px] leading-relaxed tracking-wide ${message.role === "user" ? "bg-sky-500 text-white" : "bg-slate-900 border border-slate-800 text-slate-100"}`}>
                            <div className={message.role === "user" ? "prose prose-invert" : "prose prose-invert max-w-none prose-headings:text-white prose-strong:text-sky-400 prose-ul:list-disc prose-table:border-collapse prose-th:border prose-th:border-slate-800 prose-th:p-2 prose-td:border prose-td:border-slate-800 prose-td:p-2"}>
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {message.content}
                              </ReactMarkdown>
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-400">
                        Start a new conversation and Pepper will answer using the current workspace context.
                      </div>
                    )}
                  </div>

                  <div className="border-t border-slate-800 p-3">
                    <textarea
                      value={chatDraft}
                      onChange={(event) => setChatDraft(event.target.value)}
                      rows={3}
                      className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none"
                      placeholder="Ask a question about your PDFs"
                    />
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                      <button type="button" onClick={createChat} className="rounded-full border border-slate-700 px-3 py-2 text-sm text-slate-300">
                        New chat
                      </button>
                      <button type="button" onClick={handleSendMessage} disabled={isChatting} className="rounded-full bg-sky-500 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">
                        {isChatting ? "Thinking..." : "Send"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </main>
  );
};
