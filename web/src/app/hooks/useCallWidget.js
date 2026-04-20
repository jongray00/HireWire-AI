import { useState, useCallback } from "react";
import { useNavigate } from "react-router";

/**
 * useCallWidget Hook
 *
 * Reusable hook for initiating calls using the SignalWire Call Widget.
 * Credentials are now managed server-side via JWT session cookies.
 * The widget token endpoint reads credentials from the DB automatically.
 *
 * @returns {Object} { initiateCall, calling, error }
 */
export function useCallWidget() {
  const navigate = useNavigate();
  const [calling, setCalling] = useState(false);
  const [error, setError] = useState(null);

  const initiateCall = useCallback(async (destination, userVariables = {}) => {
    if (!destination) {
      const errorMsg = "No call destination provided";
      setError(errorMsg);
      alert(errorMsg);
      return false;
    }

    try {
      setCalling(true);
      setError(null);

      // Verify we have a valid server session
      const sessionRes = await fetch("/api/auth/session");
      if (!sessionRes.ok) {
        navigate("/login");
        return false;
      }

      // Pre-call domain check: reconcile stale webhook URLs
      try {
        const employees = JSON.parse(localStorage.getItem("sally_sales_employees") || "[]");
        const employee = employees.find(e => e.callFabricAddress === destination);
        if (employee?.webhookUrl) {
          const domainRes = await fetch("/api/settings/domain");
          const domainData = await domainRes.json();
          if (domainData.success && domainData.domain) {
            const currentHost = new URL(domainData.domain).host;
            const webhookCleaned = employee.webhookUrl.replace(/^(https?:\/\/)[^@]+@/, "$1");
            const webhookHost = new URL(webhookCleaned).host;
            if (currentHost !== webhookHost) {
              console.log("[useCallWidget] Stale webhook detected, reconciling...");
              // Server gets credentials from session automatically
              await fetch("/api/signalwire/reconcile-webhooks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
              });
            }
          }
        }
      } catch (domainErr) {
        // Non-blocking — proceed with the call even if check fails
        console.warn("[useCallWidget] Pre-call domain check failed:", domainErr.message);
      }

      // Use the persistent subscriber from session
      const subscriberReference = "sally_sales_default_user";

      console.log("Initiating call with subscriber:", subscriberReference);
      console.log("Calling destination:", destination);

      // Generate widget token — server gets credentials from session cookie
      const response = await fetch("/api/signalwire/widget-token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          subscriberReference,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to generate call token");
      }

      const { token } = await response.json();

      // Generate unique IDs
      const callId = Date.now() + Math.random().toString(36).substring(7);
      const buttonId = `call-button-${callId}`;
      const widgetId = `call-widget-${callId}`;

      // Clean up any existing widget
      const existingWidget = document.getElementById(widgetId);
      if (existingWidget) {
        existingWidget.remove();
      }

      // Create hidden trigger button
      let button = document.getElementById(buttonId);
      if (!button) {
        button = document.createElement("button");
        button.id = buttonId;
        button.style.display = "none";
        document.body.appendChild(button);
      }

      // Create call widget element
      const widget = document.createElement("call-widget");
      widget.id = widgetId;
      widget.setAttribute("button-id", buttonId);
      widget.setAttribute("token", token);
      widget.setAttribute("destination", destination);
      widget.setAttribute("support-audio", "true");
      widget.setAttribute("support-video", "true");
      widget.setAttribute("window-mode", "video+transcript");
      widget.setAttribute("log-level", "info");

      // Add user variables
      if (userVariables && Object.keys(userVariables).length > 0) {
        widget.setAttribute("user-variables", JSON.stringify(userVariables));
      }

      // Cleanup helper — ensures calling state is reset exactly once
      let cleaned = false;
      const cleanup = (reason) => {
        if (cleaned) return;
        cleaned = true;
        console.log("Call cleanup:", reason, destination);
        setCalling(false);
        setTimeout(() => {
          widget.remove();
          button.remove();
        }, 1000);
      };

      // Event listeners — multiple events can signal the call ended,
      // so cleanup() is idempotent.
      widget.addEventListener("call.joined", () => {
        console.log("Call joined:", destination);
      });

      widget.addEventListener("call.left", () => cleanup("call.left"));
      widget.addEventListener("call.ended", () => cleanup("call.ended"));

      // call.state can fire with "destroy", "hangup", etc.
      widget.addEventListener("call.state", (event) => {
        const state = event?.detail?.state || event?.detail;
        console.log("Call state:", state);
        if (state === "destroy" || state === "hangup" || state === "ended") {
          cleanup("call.state:" + state);
        }
      });

      widget.addEventListener("call.error", (event) => {
        console.error("Call error:", event.detail);
        const errorDetail = event.detail;
        let errorMessage = "Call failed: ";

        if (errorDetail?.message) {
          errorMessage += errorDetail.message;
        } else if (errorDetail?.code) {
          errorMessage += `Error code ${errorDetail.code}`;
        } else {
          errorMessage += "Unknown error";
        }

        // Add specific guidance for URI errors
        if (errorDetail?.message?.includes("Uri is invalid") ||
            errorDetail?.message?.includes("invalid_parameter")) {
          errorMessage += "\n\nThis may indicate:\n" +
            "- The resource doesn't exist in your SignalWire space\n" +
            "- The resource name contains invalid characters\n" +
            "- The subscriber doesn't have permission to call this resource";
        }

        setError(errorMessage);
        cleanup("call.error");
      });

      // Safety net: if the widget gets removed from the DOM (e.g. user
      // closes the call window), detect it via MutationObserver and reset.
      const observer = new MutationObserver(() => {
        if (!document.body.contains(widget)) {
          observer.disconnect();
          cleanup("widget-removed");
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });

      // Append widget to body
      document.body.appendChild(widget);

      // Trigger call after short delay to ensure widget is ready
      setTimeout(() => {
        button.click();
      }, 500);

      return true;

    } catch (error) {
      console.error("Error initiating call:", error);
      const errorMsg = "Failed to initiate call: " + error.message;
      setError(errorMsg);
      alert(errorMsg);
      setCalling(false);
      return false;
    }
  }, [navigate]);

  return {
    initiateCall,
    calling,
    error,
    clearError: () => setError(null),
  };
}
