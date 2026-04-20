"use client";

import { useState, useEffect, useCallback } from "react";
import { Wand2, Phone, PhoneOff, Check, Sparkles, MessageCircle } from "lucide-react";
import { WIZARD_EVENTS, parseWizardEvent } from "@/lib/wizardEvents";

/**
 * WizardPanel — Displays during wizard calls.
 * Listens for wizard events and shows:
 * - Agent preview cards
 * - Config questions with clickable options
 * - Creation confirmation with "Call Now" CTA
 */
export default function WizardPanel({ wizardActive, onAgentCreated }) {
  const [preview, setPreview] = useState(null);
  const [question, setQuestion] = useState(null);
  const [createdAgent, setCreatedAgent] = useState(null);
  const [readyAgent, setReadyAgent] = useState(null);

  const handleWizardEvent = useCallback((event) => {
    const parsed = parseWizardEvent(event);
    if (!parsed) return;

    switch (parsed.type) {
      case WIZARD_EVENTS.AGENT_PREVIEW:
        setPreview((prev) => ({ ...prev, ...parsed.data }));
        setQuestion(null);
        break;
      case WIZARD_EVENTS.AGENT_CONFIG_QUESTION:
        setQuestion(parsed.data);
        break;
      case WIZARD_EVENTS.AGENT_CREATED:
        setCreatedAgent(parsed.data.employee);
        setPreview(null);
        setQuestion(null);
        if (onAgentCreated) onAgentCreated(parsed.data.employee);
        break;
      case WIZARD_EVENTS.AGENT_READY:
        setReadyAgent(parsed.data);
        break;
    }
  }, [onAgentCreated]);

  // Expose the event handler so the parent can wire it to userInput events
  useEffect(() => {
    window.__wizardEventHandler = handleWizardEvent;
    return () => { delete window.__wizardEventHandler; };
  }, [handleWizardEvent]);

  // Reset state when wizard deactivates
  useEffect(() => {
    if (!wizardActive) {
      setPreview(null);
      setQuestion(null);
      setCreatedAgent(null);
      setReadyAgent(null);
    }
  }, [wizardActive]);

  if (!wizardActive && !createdAgent && !readyAgent) return null;

  return (
    <div className="bg-gradient-to-br from-purple-900/20 to-indigo-900/20 border border-purple-500/30 rounded-xl p-6 space-y-4">
      <div className="flex items-center gap-2 text-purple-300">
        <Wand2 className="w-5 h-5" />
        <h3 className="font-semibold text-lg">Setup Wizard</h3>
        {wizardActive && (
          <span className="ml-auto flex items-center gap-1 text-sm text-green-400">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            Listening...
          </span>
        )}
      </div>

      {/* Question Overlay */}
      {question && (
        <div className="bg-gray-800/60 rounded-lg p-4 border border-purple-500/20">
          <p className="text-white font-medium mb-3">
            <MessageCircle className="w-4 h-4 inline mr-2 text-purple-400" />
            {question.question}
          </p>
          <div className="flex flex-wrap gap-2">
            {question.options?.map((option, i) => (
              <button
                key={i}
                className="px-3 py-1.5 bg-purple-600/30 hover:bg-purple-600/50 border border-purple-500/40 rounded-lg text-sm text-purple-200 transition-colors"
              >
                {option}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-2">Answer by voice — these are visual aids</p>
        </div>
      )}

      {/* Agent Preview Card */}
      {preview && (
        <div className="bg-gray-800/60 rounded-lg p-4 border border-indigo-500/20 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex items-start justify-between mb-2">
            <div>
              <h4 className="text-white font-semibold text-lg">{preview.name || "New Agent"}</h4>
              <p className="text-gray-400 text-sm">{preview.role || "Assistant"}</p>
            </div>
            <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-300 text-xs rounded-full border border-yellow-500/30">
              Preview
            </span>
          </div>
          {preview.prompt_summary && (
            <p className="text-gray-300 text-sm mb-3">{preview.prompt_summary}</p>
          )}
          {preview.voice && (
            <p className="text-gray-500 text-xs mb-2">Voice: {preview.voice}</p>
          )}
          {preview.functions?.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {preview.functions.map((fn) => (
                <span key={fn} className="px-2 py-0.5 bg-blue-500/20 text-blue-300 text-xs rounded-full border border-blue-500/30">
                  {fn.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Agent Created Confirmation */}
      {createdAgent && (
        <div className="bg-green-900/20 rounded-lg p-4 border border-green-500/30 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-5 h-5 text-green-400" />
            <h4 className="text-green-300 font-semibold">Agent Created!</h4>
          </div>
          <p className="text-white font-medium">{createdAgent.name}</p>
          <p className="text-gray-400 text-sm">{createdAgent.role}</p>
        </div>
      )}

      {/* Ready to Call CTA */}
      {readyAgent && (
        <div className="flex items-center gap-3 bg-green-900/30 rounded-lg p-3 border border-green-500/30">
          <Check className="w-5 h-5 text-green-400" />
          <span className="text-green-300 text-sm font-medium">Ready to take calls</span>
        </div>
      )}
    </div>
  );
}
