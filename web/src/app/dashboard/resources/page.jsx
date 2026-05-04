"use client";

import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import {
  Search,
  Video,
  RefreshCw,
  Phone,
  Loader2,
  ExternalLink,
  Settings,
  Filter,
  X,
} from "lucide-react";
import { useCallWidget } from "@/app/hooks/useCallWidget";

// Resource type labels
const RESOURCE_TYPES = [
  { value: "", label: "All Resources" },
  { value: "swml_webhooks", label: "SWML Webhooks" },
  { value: "ai_agents", label: "AI Agents" },
  { value: "conference_rooms", label: "Conference Rooms" },
  { value: "sip_endpoints", label: "SIP Endpoints" },
  { value: "subscribers", label: "Subscribers" },
];

// Type colors for badges
const TYPE_COLORS = {
  swml_webhook: "bg-[#0A1530] border border-[#5478F8]/40 text-[#7892FA]",
  ai_agent: "bg-[#16111F] border border-[#7B5BD9]/30 text-[#9B82E6]",
  conference_room: "bg-[#0F1424] border border-[#2553F4]/40 text-[#5478F8]",
  sip_endpoint: "bg-[#1A130E] border border-[#E07A4B]/40 text-[#E07A4B]",
  subscriber: "bg-[#0F0F0F] border border-[#1F1F1F] text-[#A3A3A3]",
};

export default function ResourcesPage() {
  const navigate = useNavigate();
  const [resources, setResources] = useState([]);
  const [filteredResources, setFilteredResources] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadResources();
  }, [typeFilter]);

  useEffect(() => {
    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const filtered = resources.filter((resource) => {
        return (
          resource.display_name?.toLowerCase().includes(query) ||
          resource.name?.toLowerCase().includes(query) ||
          resource.resourceName?.toLowerCase().includes(query) ||
          resource.type?.toLowerCase().includes(query)
        );
      });
      setFilteredResources(filtered);
    } else {
      setFilteredResources(resources);
    }
  }, [searchQuery, resources]);

  const loadResources = async () => {
    try {
      const refreshState = loading ? setLoading : setRefreshing;
      refreshState(true);

      // Get credentials from session
      const session = localStorage.getItem("sally_sales_session");
      if (!session) {
        alert("Please log in first");
        navigate("/login");
        return;
      }

      const sessionData = JSON.parse(session);
      const credentials = sessionData.credentials;

      // Fetch resources
      const response = await fetch("/api/signalwire/list-resources", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          credentials,
          type: typeFilter || undefined,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to load resources");
      }

      const data = await response.json();
      setResources(data.all || []);
      setFilteredResources(data.all || []);
    } catch (error) {
      console.error("Error loading resources:", error);
      alert("Failed to load resources: " + error.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-[#2553F4] animate-spin mx-auto mb-4" />
          <p className="text-[#A3A3A3]">Loading resources...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl lg:text-3xl font-medium text-[#FAFAFA] tracking-tight">
            Call Fabric Resources
          </h1>
          <p className="text-[#A3A3A3] mt-1">
            Dial and manage your SignalWire resources
          </p>
        </div>
        <button
          onClick={() => loadResources()}
          disabled={refreshing}
          className="inline-flex items-center space-x-2 px-4 py-2 bg-[#2553F4] hover:bg-[#1E46DC] text-white rounded-md transition-colors disabled:opacity-50"
        >
          <RefreshCw size={20} className={refreshing ? "animate-spin" : ""} />
          <span className="hw-mono text-[11px] tracking-[0.16em] uppercase font-semibold">Refresh</span>
        </button>
      </div>

      {/* Filters */}
      <div className="bg-[#0A0A0A] border border-[#1F1F1F] p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Search */}
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[#737373]"
              size={20}
            />
            <input
              type="text"
              placeholder="Search resources..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-[#0F0F0F] border border-[#1F1F1F] rounded-md focus:ring-2 focus:ring-[#2553F4] focus:border-transparent text-[#FAFAFA]"
            />
          </div>

          {/* Type Filter */}
          <div className="relative">
            <Filter
              className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[#737373]"
              size={20}
            />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-[#0F0F0F] border border-[#1F1F1F] rounded-md focus:ring-2 focus:ring-[#2553F4] focus:border-transparent text-[#FAFAFA] appearance-none"
            >
              {RESOURCE_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Results count */}
        <div className="mt-3 text-sm text-[#A3A3A3]">
          Showing {filteredResources.length} of {resources.length} resources
        </div>
      </div>

      {/* Resources List */}
      {filteredResources.length === 0 ? (
        <div className="bg-[#0A0A0A] border border-[#1F1F1F] p-12">
          <div className="text-center">
            <Phone className="mx-auto text-[#737373] mb-4" size={64} />
            <h3 className="text-base font-medium text-[#FAFAFA] mb-2">
              {searchQuery || typeFilter ? "No resources found" : "No resources yet"}
            </h3>
            <p className="text-[#A3A3A3] mb-6">
              {searchQuery || typeFilter
                ? "Try adjusting your search or filter"
                : "Create resources to get started"}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredResources.map((resource) => (
            <ResourceCard key={resource.id} resource={resource} onUpdate={loadResources} />
          ))}
        </div>
      )}
    </div>
  );
}

function ResourceCard({ resource, onUpdate }) {
  const { initiateCall, calling } = useCallWidget();
  const [updating, setUpdating] = useState(false);

  const handleCall = async () => {
    // Use the hook to initiate the call
    await initiateCall(resource.publicAddress, {
      resourceName: resource.display_name,
      resourceType: resource.type,
      resourceId: resource.id,
    });
  };

  const handleUpdateWebhook = async () => {
    const newWebhookUrl = prompt(
      "Enter new webhook URL:",
      resource.webhookUrl || ""
    );

    if (!newWebhookUrl) return;

    try {
      setUpdating(true);

      const session = localStorage.getItem("sally_sales_session");
      if (!session) {
        alert("Please log in first");
        return;
      }

      const sessionData = JSON.parse(session);
      const credentials = sessionData.credentials;

      const response = await fetch("/api/signalwire/update-resource", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          credentials,
          resourceId: resource.id,
          resourceType: "swml_webhooks",
          updates: {
            primary_request_url: newWebhookUrl,
            primary_request_method: "GET",
          },
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update webhook");
      }

      alert("Webhook updated successfully!");
      onUpdate();
    } catch (error) {
      console.error("Error updating webhook:", error);
      alert("Failed to update webhook: " + error.message);
    } finally {
      setUpdating(false);
    }
  };

  const typeColor = TYPE_COLORS[resource.type] || TYPE_COLORS.subscriber;

  return (
    <div className="bg-[#0A0A0A] border border-[#1F1F1F] p-6 transition-colors">
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <span className={`inline-block px-2 py-1 text-xs font-medium rounded ${typeColor} mb-2`}>
            {resource.type.replace(/_/g, " ")}
          </span>
          <h3 className="text-base font-medium text-[#FAFAFA] mb-1">
            {resource.display_name || resource.name || "Unnamed Resource"}
          </h3>
        </div>
      </div>

      {/* Address */}
      <div className="mb-4 p-3 bg-[#0F0F0F] border border-[#1F1F1F] rounded-md">
        <div className="hw-mono text-[10px] tracking-[0.18em] uppercase text-[#737373] mb-1">
          Call Address
        </div>
        <code className="text-sm text-[#FAFAFA] font-mono">
          {resource.publicAddress}
        </code>
      </div>

      {/* Webhook URL for SWML webhooks */}
      {resource.type === "swml_webhook" && resource.webhookUrl && (
        <div className="mb-4 p-3 bg-[#0F0F0F] border border-[#1F1F1F] rounded-md">
          <div className="hw-mono text-[10px] tracking-[0.18em] uppercase text-[#737373] mb-1">
            Webhook URL
          </div>
          <div className="flex items-center space-x-2">
            <code className="text-xs text-[#FAFAFA] font-mono truncate flex-1">
              {resource.webhookUrl}
            </code>
            <a
              href={resource.webhookUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#5478F8] hover:text-[#7892FA]"
            >
              <ExternalLink size={14} />
            </a>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex space-x-2">
        <button
          onClick={handleCall}
          disabled={calling}
          className="flex-1 inline-flex items-center justify-center space-x-2 px-4 py-2 bg-[#2553F4] hover:bg-[#1E46DC] text-white rounded-md transition-colors disabled:opacity-50"
        >
          {calling ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              <span className="hw-mono text-[11px] tracking-[0.16em] uppercase font-semibold">Calling...</span>
            </>
          ) : (
            <>
              <Video size={16} />
              <span className="hw-mono text-[11px] tracking-[0.16em] uppercase font-semibold">Call</span>
            </>
          )}
        </button>

        {resource.type === "swml_webhook" && (
          <button
            onClick={handleUpdateWebhook}
            disabled={updating}
            className="inline-flex items-center justify-center px-4 py-2 bg-[#0F0F0F] border border-[#1F1F1F] hover:bg-[#1A1A1A] text-[#A3A3A3] rounded-md transition-colors disabled:opacity-50"
            title="Update webhook URL"
          >
            {updating ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Settings size={16} />
            )}
          </button>
        )}
      </div>

      {/* Metadata */}
      <div className="mt-4 pt-4 border-t border-[#1F1F1F] text-xs text-[#737373]">
        <div>ID: {resource.id}</div>
        {resource.created_at && (
          <div className="mt-1">
            Created: {new Date(resource.created_at).toLocaleDateString()}
          </div>
        )}
      </div>
    </div>
  );
}
