import React, { useState, useRef, useEffect } from "react";
import bot_icon from "../assets/bot_icon.png";

/**
 * ChatAssistant — Floating Data-Analyst chatbot widget.
 * Opens a chat modal on icon click, sends messages to /api/chat,
 * renders bot responses as markdown, persists API key in localStorage.
 */
function ChatAssistant({ upload, results, currentView }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      role: "bot",
      content:
        "Hi! I'm your Data Assistant. Upload a dataset and ask me anything about it.",
    },
  ]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const DEFAULT_API_KEY = "sk-198dd023f5b48ae8-35aea8-5770028a";
  const [apiKey, setApiKey] = useState(() => {
    const saved = localStorage.getItem("groq_api_key");
    return saved && saved.startsWith("sk-") ? saved : DEFAULT_API_KEY;
  });
  const chatBodyRef = useRef(null);
  const inputRef = useRef(null);

  // Persist API key to localStorage
  useEffect(() => {
    localStorage.setItem("groq_api_key", apiKey);
  }, [apiKey]);

  // Scroll behavior: when a NEW BOT RESPONSE arrives, scroll to the START of
  // that response (not the bottom of the whole chat). New USER messages still
  // scroll to the bottom so the input area stays visible.
  const lastMsgCountRef = useRef(messages.length);
  useEffect(() => {
    const body = chatBodyRef.current;
    const count = messages.length;
    const prevCount = lastMsgCountRef.current;
    lastMsgCountRef.current = count;
    if (!body || count === prevCount) return;

    const added = count - prevCount;
    const msgEls = body.querySelectorAll(".chat-msg");
    const firstNew = msgEls[msgEls.length - added];
    if (!firstNew) return;

    if (firstNew.classList.contains("bot")) {
      const top =
        firstNew.getBoundingClientRect().top -
        body.getBoundingClientRect().top +
        body.scrollTop -
        12;
      body.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    } else {
      body.scrollTo({ top: body.scrollHeight, behavior: "smooth" });
    }
  }, [messages]);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Auto-grow the textarea with the prompt (Gemini / ChatGPT style), capped at 140px
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  }, [input]);

  // Capture screenshots of the charts currently visible on the active page so
  // the chatbot can actually SEE the plots (sent to the backend as base64 PNGs).
  const capturePageCharts = async () => {
    const images = [];
    const pushCanvas = (canvas) => {
      if (!canvas || canvas.width === 0 || canvas.height === 0) return;
      const maxW = 1200;
      if (canvas.width > maxW) {
        // Downscale huge backing stores to keep the request light
        const scale = maxW / canvas.width;
        const tmp = document.createElement("canvas");
        tmp.width = maxW;
        tmp.height = Math.round(canvas.height * scale);
        const ctx = tmp.getContext("2d");
        ctx.fillStyle = "#0B0D12";
        ctx.fillRect(0, 0, tmp.width, tmp.height);
        ctx.drawImage(canvas, 0, 0, tmp.width, tmp.height);
        images.push(tmp.toDataURL("image/png"));
      } else {
        images.push(canvas.toDataURL("image/png"));
      }
    };
    try {
      if (currentView === "v-results") {
        document.querySelectorAll("#v-results .visual-card canvas").forEach(pushCanvas);
      } else if (currentView === "v-eda") {
        document.querySelectorAll("#v-eda .visual-canvas-wrap canvas").forEach(pushCanvas);
        const heatmap = document.getElementById("eda-heatmap");
        // Plotly is huge, so it is only downloaded when a heatmap screenshot is needed.
        const Plotly = heatmap ? (await import("plotly.js-dist-min")).default : null;
        if (heatmap && Plotly && typeof Plotly.toImage === "function") {
          const url = await Plotly.toImage(heatmap, { format: "png", width: 1000, scale: 1 });
          if (url) images.push(url);
        }
      }
    } catch (e) {
      // Capture failed — the backend falls back to text-only context
    }
    return images.slice(0, 4);
  };

  const sendMessage = async () => {
    const msg = input.trim();
    if (!msg) return;
    setInput("");

    // Grab live screenshots of the visible charts (results / EDA pages only)
    const chartImages = await capturePageCharts();

    // Add user message
    const userMsg = { role: "user", content: msg };
    setMessages((prev) => [...prev, userMsg]);

    // Build history for API (exclude the initial bot greeting)
    const historyForApi = messages
      .filter((m) => m !== messages[0]) // skip initial greeting
      .map((m) => ({
        role: m.role === "bot" ? "assistant" : m.role,
        content: m.content,
      }));
    historyForApi.push({ role: "user", content: msg });

    setIsTyping(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stored_as: upload?.stored_as || null,
            message: msg,
            api_key: apiKey || DEFAULT_API_KEY,
            history: historyForApi,
            results: results || null,
            current_view: currentView || null,
            chart_images: chartImages,
          }),
      });

      const data = await res.json();
      const botResp = data.response || "I couldn't generate a response.";

      setMessages((prev) => [...prev, { role: "bot", content: botResp }]);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          role: "bot",
          content: "Sorry, I couldn't connect to the server. Please try again.",
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  /**
   * Simple markdown-to-HTML renderer for bot messages.
   * Handles: bold, italic, code blocks, inline code, tables, lists, links, paragraphs.
   */
  const renderMarkdown = (text) => {
    if (!text) return "";

    let html = text;

    // Protect fenced code blocks from the markdown replacements below
    // (a `#` inside code must not be treated as a heading)
    const codeBlocks = [];
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (m, lang, code) => {
      codeBlocks.push({ lang, code });
      return `\u0000CODEBLOCK${codeBlocks.length - 1}\u0000`;
    });

    // Markdown headings (## ...) — render as styled headings, no raw # symbols
    html = html.replace(
      /^(#{1,6})\s+(.+)$/gm,
      '<div class="chat-heading">$2</div>'
    );

    // Inline code
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

    // Bold
    html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");

    // Italic
    html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");

    // Tables (simple pipe-delimited)
    html = html.replace(
      /(?:^|\n)(\|.+\|)\n(\|[-| :]+\|)\n((?:\|.+\|\n?)+)/g,
      (match, header, separator, body) => {
        const headerCells = header
          .split("|")
          .filter((c) => c.trim())
          .map((c) => `<th>${c.trim()}</th>`)
          .join("");
        const bodyRows = body
          .trim()
          .split("\n")
          .map((row) => {
            const cells = row
              .split("|")
              .filter((c) => c.trim())
              .map((c) => `<td>${c.trim()}</td>`)
              .join("");
            return `<tr>${cells}</tr>`;
          })
          .join("");
        return `<table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>`;
      }
    );

    // Unordered lists
    html = html.replace(/^[-*] (.+)$/gm, "<li>$1</li>");
    html = html.replace(/(<li>.*<\/li>\n?)+/g, "<ul>$&</ul>");

    // Restore protected code blocks as styled <pre><code>
    html = html.replace(/\u0000CODEBLOCK(\d+)\u0000/g, (m, i) => {
      const block = codeBlocks[Number(i)];
      return `<pre><code class="lang-${block.lang}">${block.code}</code></pre>`;
    });

    // Line breaks to paragraphs
    html = html
      .split("\n\n")
      .map((p) => {
        const trimmed = p.trim();
        if (
          !trimmed ||
          trimmed.startsWith("<pre>") ||
          trimmed.startsWith("<table>") ||
          trimmed.startsWith("<ul>") ||
          trimmed.startsWith('<div class="chat-heading">')
        )
          return trimmed;
        return `<p>${trimmed}</p>`;
      })
      .join("");

    // Single line breaks within paragraphs
    html = html.replace(
      /(?<!\n)<p>([^<]*)\n([^<]*)<\/p>/g,
      "<p>$1<br/>$2</p>"
    );

    return html;
  };

  return (
    <>
      {/* Floating Bot Icon */}
      <div
        className="fixed-icon-wrapper"
        data-tooltip="Chat with Assistant"
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <img src={bot_icon} alt="Chatbot Assistant" className="fixed-icon" />
      </div>

      {/* Chat Modal */}
      <div className={`chat-modal ${isOpen ? "is-open" : ""}`}>
        <div className="chat-header">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--accent-1)" }}></span>
            <span>Data Assistant</span>
          </div>
          <button
            className="chat-close"
            onClick={() => setIsOpen(false)}
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="chat-body" ref={chatBodyRef}>
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`chat-msg ${msg.role === "user" ? "user" : "bot"}`}
              dangerouslySetInnerHTML={
                msg.role === "bot"
                  ? { __html: renderMarkdown(msg.content) }
                  : undefined
              }
            >
              {msg.role === "user" ? msg.content : undefined}
            </div>
          ))}
          {isTyping && (
            <div
              className="chat-msg bot"
              style={{
                fontSize: ".8rem",
                color: "var(--text-tertiary)",
                fontStyle: "italic",
              }}
            >
              Thinking...
            </div>
          )}
        </div>

        <div className="chat-input-area">
          <textarea
            ref={inputRef}
            rows={1}
            className="chat-input"
            placeholder="Ask about your data..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button className="chat-send" onClick={sendMessage}>
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    </>
  );
}

export default ChatAssistant;