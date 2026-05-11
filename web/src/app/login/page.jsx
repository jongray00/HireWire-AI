"use client";

import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { LogIn, Loader, AlertCircle, Eye, EyeOff } from "lucide-react";

export default function LoginPage() {
  const navigate = useNavigate();
  const [credentials, setCredentials] = useState({
    spaceUrl: "",
    projectId: "",
    apiToken: "",
  });
  const [rememberMe, setRememberMe] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  // Check if already logged in (server-side session via cookie)
  useEffect(() => {
    fetch("/api/auth/session")
      .then((res) => {
        if (res.ok) {
          // Valid server session exists — redirect to dashboard
          navigate("/dashboard");
        }
      })
      .catch(() => {
        // No session — stay on login page
      });

    // Load saved prefill if remember me was checked (no api token stored client-side)
    const savedPrefill = localStorage.getItem("hirewire_login_prefill");
    if (savedPrefill) {
      try {
        const obj = JSON.parse(savedPrefill);
        setCredentials((prev) => ({
          ...prev,
          spaceUrl: obj.spaceUrl ?? "",
          projectId: obj.projectId ?? "",
        }));
        setRememberMe(true);
      } catch (e) {
        console.error("Failed to load saved prefill");
      }
    }
  }, [navigate]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setCredentials((prev) => ({
      ...prev,
      [name]: value,
    }));
    setError(""); // Clear error on input change
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      // Validate inputs
      if (!credentials.spaceUrl || !credentials.projectId || !credentials.apiToken) {
        throw new Error("Please fill in all fields");
      }

      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          space_url: credentials.spaceUrl,
          signalwire_project_id: credentials.projectId,
          api_token: credentials.apiToken,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const map = {
          invalid_credentials: "SignalWire rejected those credentials.",
          signalwire_unreachable: "Could not reach SignalWire — try again in a moment.",
          provisioning_failed: "Could not set up SignalWire resources. Please retry.",
          missing_fields: "All three fields are required.",
        };
        throw new Error(map[errorData?.error] || errorData?.error || "Login failed");
      }

      const data = await response.json();
      // JWT is in HttpOnly cookie; we only keep prefill state in localStorage if requested
      if (rememberMe) {
        localStorage.setItem(
          "hirewire_login_prefill",
          JSON.stringify({
            spaceUrl: credentials.spaceUrl,
            projectId: credentials.projectId,
          }),
        );
      } else {
        localStorage.removeItem("hirewire_login_prefill");
      }

      // Redirect to dashboard
      navigate("/dashboard");
    } catch (err) {
      console.error("Login error:", err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo & Title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center mb-4">
            <img
              src="/hirewire-logo.png?v=2"
              alt="HireWire"
              className="h-12 w-auto object-contain select-none"
              draggable="false"
            />
          </div>
          <div className="hw-mono text-[10px] tracking-[0.18em] uppercase text-[#737373] mb-3">
            HireWire.AI
          </div>
          <h1 className="text-3xl font-medium text-[#FAFAFA] tracking-tight mb-2">
            Sign in to your workspace
          </h1>
          <p className="text-[#A3A3A3] text-sm">
            AI-Powered Voice Agent Platform
          </p>
        </div>

        {/* Login Card */}
        <div className="relative bg-[#0A0A0A] border border-[#1F1F1F] p-8">
          <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#2553F4]" />

          <div className="hw-mono text-[10px] tracking-[0.18em] uppercase text-[#737373] mb-6">
            Sign In
          </div>

          {error && (
            <div className="mb-6 p-4 bg-[#0A0A0A] border border-[#E84B5B] flex items-start space-x-3">
              <AlertCircle className="text-[#E84B5B] flex-shrink-0 mt-0.5" size={20} />
              <div className="flex-1">
                <p className="text-sm font-medium text-[#E84B5B]">
                  {error}
                </p>
              </div>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-5">
            {/* Space URL */}
            <div>
              <label
                htmlFor="spaceUrl"
                className="block text-sm font-medium text-[#A3A3A3] mb-2"
              >
                Space URL
              </label>
              <input
                type="text"
                id="spaceUrl"
                name="spaceUrl"
                value={credentials.spaceUrl}
                onChange={handleInputChange}
                placeholder="demo.signalwire.com"
                className="w-full px-4 py-3 bg-[#0A0A0A] border border-[#1F1F1F] text-[#FAFAFA] placeholder:text-[#737373] focus:outline-none focus:ring-2 focus:ring-[#2553F4] focus:border-[#2553F4] transition-colors"
                required
              />
            </div>

            {/* Project ID */}
            <div>
              <label
                htmlFor="projectId"
                className="block text-sm font-medium text-[#A3A3A3] mb-2"
              >
                Project ID
              </label>
              <input
                type="text"
                id="projectId"
                name="projectId"
                value={credentials.projectId}
                onChange={handleInputChange}
                placeholder="5d30e1ba-32c2-..."
                className="w-full px-4 py-3 bg-[#0A0A0A] border border-[#1F1F1F] text-[#FAFAFA] placeholder:text-[#737373] focus:outline-none focus:ring-2 focus:ring-[#2553F4] focus:border-[#2553F4] transition-colors"
                required
              />
            </div>

            {/* API Token */}
            <div>
              <label
                htmlFor="apiToken"
                className="block text-sm font-medium text-[#A3A3A3] mb-2"
              >
                API Token
              </label>
              <div className="relative">
                <input
                  type={showToken ? "text" : "password"}
                  id="apiToken"
                  name="apiToken"
                  value={credentials.apiToken}
                  onChange={handleInputChange}
                  placeholder="PTe6d2153a3f9aa..."
                  className="w-full px-4 py-3 pr-12 bg-[#0A0A0A] border border-[#1F1F1F] text-[#FAFAFA] placeholder:text-[#737373] focus:outline-none focus:ring-2 focus:ring-[#2553F4] focus:border-[#2553F4] transition-colors"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-[#737373] hover:text-[#FAFAFA] transition-colors"
                >
                  {showToken ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            {/* Remember Me */}
            <div className="flex items-center">
              <input
                type="checkbox"
                id="rememberMe"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="w-4 h-4 accent-[#2553F4] bg-[#0A0A0A] border border-[#1F1F1F] focus:ring-2 focus:ring-[#2553F4]"
              />
              <label
                htmlFor="rememberMe"
                className="ml-2 text-sm font-medium text-[#A3A3A3]"
              >
                Remember my credentials
              </label>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 px-6 bg-[#2553F4] hover:bg-[#1E46DC] text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
            >
              {isLoading ? (
                <>
                  <Loader className="animate-spin" size={18} />
                  <span className="hw-mono text-[11px] tracking-[0.16em] uppercase font-semibold">
                    Connecting
                  </span>
                </>
              ) : (
                <>
                  <LogIn size={18} />
                  <span className="hw-mono text-[11px] tracking-[0.16em] uppercase font-semibold">
                    Sign In
                  </span>
                </>
              )}
            </button>
          </form>

          {/* Help Text */}
          <div className="mt-6 text-center">
            <p className="text-sm text-[#A3A3A3]">
              Don't have a SignalWire account?{" "}
              <a
                href="https://signalwire.com/signup"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#2553F4] hover:underline font-medium"
              >
                Sign up free
              </a>
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center">
          <p className="hw-mono text-[10px] tracking-[0.18em] uppercase text-[#737373]">
            Powered by SignalWire
          </p>
        </div>
      </div>
    </div>
  );
}
