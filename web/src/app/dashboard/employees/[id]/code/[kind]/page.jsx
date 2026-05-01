"use client";

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Highlight, themes } from "prism-react-renderer";
import { ArrowLeft, Clipboard, Check, FileText, Code2 } from "lucide-react";

/**
 * Code viewer for an employee.
 *   /dashboard/employees/:id/code/swml  → pretty-printed SWML
 *   /dashboard/employees/:id/code/sdk   → generated signalwire-agents Python script
 *
 * Fetches from /api/employees/:id/code/:kind which proxies to the agent.
 * Renders with prism-react-renderer (Python or markup highlighting), with a
 * copy button and a tab switcher between SWML and SDK on the same screen.
 *
 * Read-only. Auth: inherits the dashboard session cookie via the proxy.
 */
export default function EmployeeCodeViewerPage() {
  const { id, kind } = useParams();
  const navigate = useNavigate();
  const isValidKind = kind === "swml" || kind === "sdk";

  const [text, setText] = useState("");
  const [status, setStatus] = useState("loading"); // loading | ok | error
  const [errorMsg, setErrorMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const [employeeName, setEmployeeName] = useState("");

  useEffect(() => {
    if (!id || !isValidKind) return;
    let cancelled = false;
    setStatus("loading");
    setErrorMsg("");

    fetch(`/api/employees/${encodeURIComponent(id)}/code/${kind}`, {
      headers: { Accept: "text/plain" },
    })
      .then(async (res) => {
        const body = await res.text();
        if (cancelled) return;
        if (!res.ok) {
          setStatus("error");
          setErrorMsg(body || `HTTP ${res.status}`);
          return;
        }
        setText(body);
        setStatus("ok");
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus("error");
        setErrorMsg(err.message || "Network error");
      });

    return () => { cancelled = true; };
  }, [id, kind, isValidKind]);

  // Best-effort: fetch the employee name for the page header.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    fetch(`/api/employees/sync`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.employees) return;
        const found = data.employees.find((e) => e.id === id);
        if (found?.name) setEmployeeName(found.name);
      })
      .catch(() => { /* ignore — header will fall back to id */ });
    return () => { cancelled = true; };
  }, [id]);

  const language = kind === "sdk" ? "python" : "json";
  const filename = useMemo(() => {
    const slug = (employeeName || id || "agent")
      .toString()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "agent";
    return kind === "sdk" ? `${slug}.py` : `${slug}.swml.json`;
  }, [employeeName, id, kind]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked — leave the user to select-all manually.
    }
  };

  const switchKind = (next) => {
    navigate(`/dashboard/employees/${id}/code/${next}`, { replace: true });
  };

  if (!isValidKind) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-medium mb-2">Invalid code view</p>
          <p className="text-sm text-gray-400">Expected /code/swml or /code/sdk</p>
          <Link to="/dashboard/employees" className="inline-flex items-center gap-2 mt-4 text-blue-400 hover:text-blue-300">
            <ArrowLeft className="w-4 h-4" /> Back to Employees
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      <header className="flex flex-wrap items-center gap-4 px-6 py-3 border-b border-gray-800 bg-gray-900">
        <Link
          to="/dashboard/employees"
          className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-200"
        >
          <ArrowLeft className="w-4 h-4" />
          Employees
        </Link>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-500">/</span>
          <span className="font-medium text-gray-200">{employeeName || id}</span>
          <span className="text-gray-500">/</span>
          <span className="text-gray-300">{kind === "sdk" ? "Agents SDK Code" : "SWML"}</span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="inline-flex rounded-md border border-gray-700 overflow-hidden text-xs">
            <button
              type="button"
              onClick={() => switchKind("swml")}
              className={
                "inline-flex items-center gap-1.5 px-3 py-1.5 transition-colors " +
                (kind === "swml"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-800 text-gray-300 hover:bg-gray-700")
              }
            >
              <FileText className="w-3.5 h-3.5" />
              SWML
            </button>
            <button
              type="button"
              onClick={() => switchKind("sdk")}
              className={
                "inline-flex items-center gap-1.5 px-3 py-1.5 transition-colors border-l border-gray-700 " +
                (kind === "sdk"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-800 text-gray-300 hover:bg-gray-700")
              }
            >
              <Code2 className="w-3.5 h-3.5" />
              Agents SDK Code
            </button>
          </div>

          <span className="text-xs text-gray-500 hidden sm:inline">{filename}</span>

          <button
            type="button"
            onClick={handleCopy}
            disabled={status !== "ok"}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-200 border border-gray-700"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Clipboard className="w-3.5 h-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4">
        {status === "loading" && (
          <div className="text-sm text-gray-400">Loading…</div>
        )}
        {status === "error" && (
          <div className="rounded-md border border-red-800 bg-red-950/40 p-4 text-sm text-red-200 max-w-3xl">
            <p className="font-medium mb-1">Couldn't load {kind === "sdk" ? "SDK code" : "SWML"}.</p>
            <pre className="whitespace-pre-wrap text-xs text-red-300">{errorMsg}</pre>
          </div>
        )}
        {status === "ok" && (
          <Highlight code={text} language={language} theme={themes.vsDark}>
            {({ className, style, tokens, getLineProps, getTokenProps }) => (
              <pre
                className={`${className} text-[12.5px] leading-relaxed p-4 rounded-lg overflow-x-auto`}
                style={{ ...style, background: "#0b1020" }}
              >
                {tokens.map((line, i) => {
                  const { key: _lk, ...lineRest } = getLineProps({ line, key: i });
                  return (
                    <div key={i} {...lineRest} className="table-row">
                      <span className="table-cell pr-4 text-right select-none text-gray-600 w-12">
                        {i + 1}
                      </span>
                      <span className="table-cell">
                        {line.map((token, k) => {
                          const { key: _tk, ...tokenRest } = getTokenProps({ token, key: k });
                          return <span key={k} {...tokenRest} />;
                        })}
                      </span>
                    </div>
                  );
                })}
              </pre>
            )}
          </Highlight>
        )}
      </main>
    </div>
  );
}
