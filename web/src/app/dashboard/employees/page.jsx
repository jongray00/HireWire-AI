"use client";

import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  Users,
  Plus,
  Edit2,
  Trash2,
  Phone,
  ArrowLeft,
  Save,
  Mic,
  Globe,
  Zap,
  Sliders,
  Search,
  X,
  Copy,
  Check,
  Video,
} from "lucide-react";
import { useCallWidget } from "@/app/hooks/useCallWidget";

// Voice options for SignalWire TTS
const VOICE_OPTIONS = [
  { value: "openai.nova", label: "Nova (OpenAI)" },
  { value: "openai.alloy", label: "Alloy (OpenAI)" },
  { value: "openai.echo", label: "Echo (OpenAI)" },
  { value: "openai.fable", label: "Fable (OpenAI)" },
  { value: "openai.onyx", label: "Onyx (OpenAI)" },
  { value: "openai.shimmer", label: "Shimmer (OpenAI)" },
];

// Language options
const LANGUAGE_OPTIONS = [
  { value: "en-US", label: "English (US)" },
  { value: "es-ES", label: "Spanish (Spain)" },
  { value: "fr-FR", label: "French (France)" },
  { value: "de-DE", label: "German (Germany)" },
  { value: "it-IT", label: "Italian (Italy)" },
  { value: "pt-BR", label: "Portuguese (Brazil)" },
  { value: "ja-JP", label: "Japanese" },
  { value: "zh-CN", label: "Chinese (Simplified)" },
];

// Available functions
const AVAILABLE_FUNCTIONS = [
  { value: "route_to_order", label: "Order Routing" },
  { value: "route_to_schedule", label: "Schedule Routing" },
  { value: "route_to_support", label: "Support Routing" },
  { value: "transfer_call", label: "Transfer to Human" },
];

export default function EmployeesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [employees, setEmployees] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadEmployees();
    if (searchParams.get("new") === "true") {
      setShowCreateForm(true);
      setSearchParams({});
    }
  }, [searchParams]);

  const loadEmployees = () => {
    try {
      const employeesData = localStorage.getItem("sally_sales_employees");
      const loadedEmployees = employeesData ? JSON.parse(employeesData) : [];
      setEmployees(loadedEmployees);
    } catch (error) {
      console.error("Failed to load employees:", error);
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  };

  const saveEmployees = (newEmployees) => {
    localStorage.setItem("sally_sales_employees", JSON.stringify(newEmployees));
    setEmployees(newEmployees);
  };

  const handleCreateEmployee = async (employeeData) => {
    try {
      // Get SignalWire credentials from localStorage
      const session = localStorage.getItem("sally_sales_session");
      if (!session) {
        alert("Please log in first");
        navigate("/login");
        return;
      }

      const sessionData = JSON.parse(session);
      const credentials = sessionData.credentials;

      // Call the API to create the virtual employee
      const response = await fetch("/api/signalwire/create-virtual-employee", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          employeeData,
          credentials,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create virtual employee");
      }

      const result = await response.json();
      const newEmployee = result.employee;

      // Save to localStorage
      saveEmployees([...employees, newEmployee]);
      setShowCreateForm(false);

      alert(`Virtual Employee "${newEmployee.name}" created successfully!\n\nCall Address: ${newEmployee.callFabricAddress}`);
    } catch (error) {
      console.error("Error creating employee:", error);
      alert("Failed to create virtual employee: " + error.message);
    }
  };

  const handleUpdateEmployee = (employeeData) => {
    const updatedEmployees = employees.map((emp) =>
      emp.id === editingEmployee.id ? { ...emp, ...employeeData } : emp
    );
    saveEmployees(updatedEmployees);
    setEditingEmployee(null);
  };

  const handleDeleteEmployee = (employeeId) => {
    if (window.confirm("Are you sure you want to delete this virtual employee?")) {
      const updatedEmployees = employees.filter((emp) => emp.id !== employeeId);
      saveEmployees(updatedEmployees);
    }
  };

  const filteredEmployees = employees.filter((employee) => {
    const query = searchQuery.toLowerCase();
    return (
      employee.name?.toLowerCase().includes(query) ||
      employee.role?.toLowerCase().includes(query)
    );
  });

  if (showCreateForm || editingEmployee) {
    return (
      <VirtualEmployeeForm
        employee={editingEmployee}
        onSave={editingEmployee ? handleUpdateEmployee : handleCreateEmployee}
        onCancel={() => {
          setShowCreateForm(false);
          setEditingEmployee(null);
        }}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Virtual Employees
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            AI voice agents powered by SignalWire
          </p>
        </div>
        <button
          onClick={() => setShowCreateForm(true)}
          className="inline-flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors shadow-lg"
        >
          <Plus size={20} />
          <span>Create Virtual Employee</span>
        </button>
      </div>

      {/* Search Bar */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-4">
        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"
            size={20}
          />
          <input
            type="text"
            placeholder="Search by name or role..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
          />
        </div>
      </div>

      {/* Employees List */}
      {filteredEmployees.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-12">
          <div className="text-center">
            <Users className="mx-auto text-gray-400 dark:text-gray-600 mb-4" size={64} />
            <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
              {searchQuery ? "No employees found" : "No virtual employees yet"}
            </h3>
            <p className="text-gray-500 dark:text-gray-400 mb-6">
              {searchQuery
                ? "Try adjusting your search query"
                : "Create your first AI voice agent to get started"}
            </p>
            {!searchQuery && (
              <button
                onClick={() => setShowCreateForm(true)}
                className="inline-flex items-center space-x-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                <Plus size={20} />
                <span>Create Your First Virtual Employee</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredEmployees.map((employee) => (
            <EmployeeCard
              key={employee.id}
              employee={employee}
              onEdit={() => setEditingEmployee(employee)}
              onDelete={() => handleDeleteEmployee(employee.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EmployeeCard({ employee, onEdit, onDelete }) {
  const [copied, setCopied] = useState(false);
  const { initiateCall, calling } = useCallWidget();

  const handleCopyAddress = () => {
    if (employee.callFabricAddress) {
      navigator.clipboard.writeText(employee.callFabricAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleCall = async () => {
    if (!employee.callFabricAddress) {
      alert("No call address available for this employee");
      return;
    }

    // Use the hook to initiate the call
    await initiateCall(employee.callFabricAddress, {
      employeeName: employee.name,
      employeeRole: employee.role,
      employeeId: employee.id,
    });
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 hover:shadow-xl transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <div className="w-12 h-12 bg-gradient-to-r from-blue-600 to-purple-600 rounded-full flex items-center justify-center">
          <Users className="text-white" size={24} />
        </div>
        <div className="flex space-x-2">
          <button
            onClick={handleCall}
            disabled={calling || !employee.callFabricAddress}
            className="p-2 text-gray-600 dark:text-gray-400 hover:text-green-600 dark:hover:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/30 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title={employee.callFabricAddress ? "Video call this agent" : "No call address available"}
          >
            {calling ? (
              <div className="w-4 h-4 border-2 border-green-600 border-t-transparent rounded-full animate-spin"></div>
            ) : (
              <Video size={16} />
            )}
          </button>
          <button
            onClick={onEdit}
            className="p-2 text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
          >
            <Edit2 size={16} />
          </button>
          <button
            onClick={onDelete}
            className="p-2 text-gray-600 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
        {employee.name || "Unnamed Employee"}
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        {employee.role || "No role specified"}
      </p>

      {/* Call Fabric Address */}
      {employee.callFabricAddress && (
        <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
              Call Address
            </span>
            <button
              onClick={handleCopyAddress}
              className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 flex items-center space-x-1"
            >
              {copied ? (
                <>
                  <Check size={12} />
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <Copy size={12} />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
          <code className="text-sm text-gray-900 dark:text-white font-mono">
            {employee.callFabricAddress}
          </code>
        </div>
      )}

      {/* Voice & Language */}
      <div className="space-y-2 text-sm">
        <div className="flex items-center space-x-2 text-gray-600 dark:text-gray-400">
          <Mic size={14} />
          <span>{VOICE_OPTIONS.find(v => v.value === employee.voice)?.label || employee.voice}</span>
        </div>
        <div className="flex items-center space-x-2 text-gray-600 dark:text-gray-400">
          <Globe size={14} />
          <span>{LANGUAGE_OPTIONS.find(l => l.value === employee.language)?.label || employee.language}</span>
        </div>
      </div>

      {employee.greeting && (
        <p className="mt-4 text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
          "{employee.greeting}"
        </p>
      )}
    </div>
  );
}

function VirtualEmployeeForm({ employee, onSave, onCancel }) {
  const [formData, setFormData] = useState({
    name: employee?.name || "",
    role: employee?.role || "",
    greeting: employee?.greeting || "",
    prompt: employee?.prompt || "",
    voice: employee?.voice || "openai.nova",
    language: employee?.language || "en-US",
    temperature: employee?.temperature || 0.7,
    speech_hints: employee?.speech_hints || [],
    enabled_functions: employee?.enabled_functions || ["transfer_call"],
  });
  const [errors, setErrors] = useState({});
  const [newHint, setNewHint] = useState("");
  const [saving, setSaving] = useState(false);

  const validateForm = () => {
    const newErrors = {};
    if (!formData.name.trim()) {
      newErrors.name = "Name is required";
    }
    if (!formData.role.trim()) {
      newErrors.role = "Role is required";
    }
    if (!formData.greeting.trim()) {
      newErrors.greeting = "Greeting is required";
    }
    if (!formData.prompt.trim()) {
      newErrors.prompt = "Instructions are required";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (validateForm()) {
      setSaving(true);
      try {
        await onSave(formData);
      } finally {
        setSaving(false);
      }
    }
  };

  const handleChange = (field, value) => {
    setFormData({ ...formData, [field]: value });
    if (errors[field]) {
      setErrors({ ...errors, [field]: undefined });
    }
  };

  const addSpeechHint = () => {
    if (newHint.trim() && !formData.speech_hints.includes(newHint.trim())) {
      handleChange("speech_hints", [...formData.speech_hints, newHint.trim()]);
      setNewHint("");
    }
  };

  const removeSpeechHint = (hint) => {
    handleChange("speech_hints", formData.speech_hints.filter(h => h !== hint));
  };

  const toggleFunction = (funcValue) => {
    const current = formData.enabled_functions;
    if (current.includes(funcValue)) {
      handleChange("enabled_functions", current.filter(f => f !== funcValue));
    } else {
      handleChange("enabled_functions", [...current, funcValue]);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700">
        {/* Header */}
        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <button
                onClick={onCancel}
                className="p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                <ArrowLeft size={20} />
              </button>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                {employee ? "Edit Virtual Employee" : "Create Virtual Employee"}
              </h2>
            </div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-8">
          {/* Basic Information */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center space-x-2">
              <Users size={20} />
              <span>Basic Information</span>
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Name *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => handleChange("name", e.target.value)}
                  className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white ${
                    errors.name ? "border-red-500" : "border-gray-300 dark:border-gray-600"
                  }`}
                  placeholder="e.g., Sarah Sales Agent"
                />
                {errors.name && <p className="mt-1 text-sm text-red-600">{errors.name}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Role *
                </label>
                <input
                  type="text"
                  value={formData.role}
                  onChange={(e) => handleChange("role", e.target.value)}
                  className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white ${
                    errors.role ? "border-red-500" : "border-gray-300 dark:border-gray-600"
                  }`}
                  placeholder="e.g., Customer Support Agent"
                />
                {errors.role && <p className="mt-1 text-sm text-red-600">{errors.role}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Greeting Message *
                </label>
                <input
                  type="text"
                  value={formData.greeting}
                  onChange={(e) => handleChange("greeting", e.target.value)}
                  className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white ${
                    errors.greeting ? "border-red-500" : "border-gray-300 dark:border-gray-600"
                  }`}
                  placeholder="e.g., Hello! I'm Sarah, how can I help you today?"
                />
                {errors.greeting && <p className="mt-1 text-sm text-red-600">{errors.greeting}</p>}
              </div>
            </div>
          </div>

          {/* AI Configuration */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center space-x-2">
              <Zap size={20} />
              <span>AI Configuration</span>
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Instructions / Prompt *
                </label>
                <textarea
                  value={formData.prompt}
                  onChange={(e) => handleChange("prompt", e.target.value)}
                  rows={6}
                  className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white ${
                    errors.prompt ? "border-red-500" : "border-gray-300 dark:border-gray-600"
                  }`}
                  placeholder="Describe the agent's responsibilities, knowledge base, and behavior. For example: You are a customer support agent for Acme Corp. You help customers with order tracking, product questions, and technical support..."
                />
                {errors.prompt && <p className="mt-1 text-sm text-red-600">{errors.prompt}</p>}
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  Provide detailed instructions about the agent's role, capabilities, and how it should interact with callers.
                </p>
              </div>
            </div>
          </div>

          {/* Voice & Language */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center space-x-2">
              <Mic size={20} />
              <span>Voice & Language</span>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Voice
                </label>
                <select
                  value={formData.voice}
                  onChange={(e) => handleChange("voice", e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                >
                  {VOICE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Language
                </label>
                <select
                  value={formData.language}
                  onChange={(e) => handleChange("language", e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                >
                  {LANGUAGE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Advanced Settings */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center space-x-2">
              <Sliders size={20} />
              <span>Advanced Settings</span>
            </h3>
            <div className="space-y-4">
              {/* Temperature */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Temperature: {formData.temperature}
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={formData.temperature}
                  onChange={(e) => handleChange("temperature", parseFloat(e.target.value))}
                  className="w-full"
                />
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  Controls randomness: 0 is focused and deterministic, 1 is creative and varied
                </p>
              </div>

              {/* Speech Hints */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Speech Recognition Hints
                </label>
                <div className="flex space-x-2 mb-2">
                  <input
                    type="text"
                    value={newHint}
                    onChange={(e) => setNewHint(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addSpeechHint())}
                    className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                    placeholder="Add a word or phrase..."
                  />
                  <button
                    type="button"
                    onClick={addSpeechHint}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                  >
                    Add
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {formData.speech_hints.map((hint, index) => (
                    <div
                      key={index}
                      className="inline-flex items-center space-x-2 px-3 py-1 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full"
                    >
                      <span className="text-sm">{hint}</span>
                      <button
                        type="button"
                        onClick={() => removeSpeechHint(hint)}
                        className="hover:text-blue-900 dark:hover:text-blue-100"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  Add keywords to improve speech recognition accuracy
                </p>
              </div>

              {/* Enabled Functions */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Enabled Functions
                </label>
                <div className="space-y-2">
                  {AVAILABLE_FUNCTIONS.map((func) => (
                    <label
                      key={func.value}
                      className="flex items-center space-x-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={formData.enabled_functions.includes(func.value)}
                        onChange={() => toggleFunction(func.value)}
                        className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-900 dark:text-white">{func.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end space-x-4 pt-6 border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="px-6 py-2 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center space-x-2 px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {saving ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>Creating...</span>
                </>
              ) : (
                <>
                  <Save size={18} />
                  <span>{employee ? "Save Changes" : "Create Virtual Employee"}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
