"use client";

import { useState } from "react";
import { useNavigate } from "react-router";
import {
  FileText,
  Phone,
  ShoppingCart,
  Calendar,
  HeadphonesIcon,
  Briefcase,
  Check,
  ArrowLeft,
  Sparkles,
} from "lucide-react";

const TEMPLATES = [
  {
    id: "sales-representative",
    name: "Sales Representative",
    description:
      "A professional sales agent trained to qualify leads, answer product questions, and schedule demos with your sales team.",
    icon: Briefcase,
    color: "blue",
    features: [
      "Lead qualification",
      "Product knowledge",
      "Demo scheduling",
      "CRM integration",
    ],
    defaultData: {
      role: "Sales Representative",
      description:
        "Professional sales agent specializing in lead qualification and product demonstrations.",
    },
  },
  {
    id: "customer-support",
    name: "Customer Support Agent",
    description:
      "24/7 customer support agent capable of handling common inquiries, troubleshooting issues, and escalating complex cases.",
    icon: HeadphonesIcon,
    color: "green",
    features: [
      "24/7 availability",
      "Issue troubleshooting",
      "Ticket creation",
      "Escalation handling",
    ],
    defaultData: {
      role: "Customer Support Agent",
      description:
        "Dedicated support agent providing 24/7 assistance for customer inquiries and technical issues.",
    },
  },
  {
    id: "appointment-scheduler",
    name: "Appointment Scheduler",
    description:
      "Intelligent scheduling assistant that manages calendars, books appointments, and sends confirmations automatically.",
    icon: Calendar,
    color: "purple",
    features: [
      "Calendar management",
      "Appointment booking",
      "Automatic reminders",
      "Rescheduling support",
    ],
    defaultData: {
      role: "Appointment Scheduler",
      description:
        "Smart scheduling assistant managing appointments and calendar coordination.",
    },
  },
  {
    id: "order-taker",
    name: "Order Taking Assistant",
    description:
      "Restaurant or retail order assistant that takes orders accurately, handles customizations, and processes payments.",
    icon: ShoppingCart,
    color: "orange",
    features: [
      "Order processing",
      "Menu navigation",
      "Payment handling",
      "Special requests",
    ],
    defaultData: {
      role: "Order Taking Assistant",
      description:
        "Efficient order-taking agent for restaurants and retail businesses.",
    },
  },
  {
    id: "reception-assistant",
    name: "Virtual Receptionist",
    description:
      "Professional receptionist that greets callers, routes calls, takes messages, and provides basic information.",
    icon: Phone,
    color: "pink",
    features: [
      "Call routing",
      "Message taking",
      "Directory assistance",
      "Basic FAQs",
    ],
    defaultData: {
      role: "Virtual Receptionist",
      description:
        "Professional virtual receptionist handling incoming calls and visitor inquiries.",
    },
  },
  {
    id: "survey-conductor",
    name: "Survey & Feedback Collector",
    description:
      "Automated survey agent that conducts customer satisfaction surveys and collects valuable feedback.",
    icon: FileText,
    color: "cyan",
    features: [
      "Survey administration",
      "Data collection",
      "Response analysis",
      "Follow-up scheduling",
    ],
    defaultData: {
      role: "Survey & Feedback Collector",
      description:
        "Automated survey agent collecting customer feedback and satisfaction data.",
    },
  },
];

export default function TemplatesPage() {
  const navigate = useNavigate();
  const [selectedTemplate, setSelectedTemplate] = useState(null);

  const handleUseTemplate = (template) => {
    // Store the template data in sessionStorage so the create form can use it
    sessionStorage.setItem("employee_template", JSON.stringify(template.defaultData));
    // Navigate to create employee page
    navigate("/dashboard/employees?new=true&template=" + template.id);
  };

  if (selectedTemplate) {
    return (
      <TemplateDetail
        template={selectedTemplate}
        onBack={() => setSelectedTemplate(null)}
        onUseTemplate={() => handleUseTemplate(selectedTemplate)}
      />
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 to-blue-600 rounded-2xl p-8 text-white shadow-xl">
        <div className="flex items-center space-x-3 mb-4">
          <Sparkles size={32} />
          <h1 className="text-3xl font-bold">AI Agent Templates</h1>
        </div>
        <p className="text-purple-100 max-w-2xl">
          Get started quickly with pre-configured AI voice agents. Each template
          is designed for specific use cases and can be customized to fit your
          needs.
        </p>
      </div>

      {/* Templates Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {TEMPLATES.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            onClick={() => setSelectedTemplate(template)}
            onUseTemplate={() => handleUseTemplate(template)}
          />
        ))}
      </div>

      {/* Info Section */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border-2 border-blue-200 dark:border-blue-800 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-100 mb-2">
          Need a custom solution?
        </h3>
        <p className="text-blue-800 dark:text-blue-200 mb-4">
          Can't find the right template? Create a custom AI agent from scratch
          tailored to your specific requirements.
        </p>
        <button
          onClick={() => navigate("/dashboard/employees?new=true")}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
        >
          Create Custom Agent
        </button>
      </div>
    </div>
  );
}

function TemplateCard({ template, onClick, onUseTemplate }) {
  const Icon = template.icon;

  const colorClasses = {
    blue: "from-blue-600 to-blue-700",
    green: "from-green-600 to-green-700",
    purple: "from-purple-600 to-purple-700",
    orange: "from-orange-600 to-orange-700",
    pink: "from-pink-600 to-pink-700",
    cyan: "from-cyan-600 to-cyan-700",
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden hover:shadow-xl transition-shadow">
      {/* Icon Header */}
      <div
        className={`bg-gradient-to-r ${colorClasses[template.color]} p-6 flex items-center justify-center`}
      >
        <div className="w-16 h-16 bg-white/20 rounded-xl flex items-center justify-center">
          <Icon className="text-white" size={32} />
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
          {template.name}
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          {template.description}
        </p>

        {/* Features */}
        <div className="space-y-2 mb-6">
          {template.features.slice(0, 3).map((feature, index) => (
            <div
              key={index}
              className="flex items-center space-x-2 text-sm text-gray-700 dark:text-gray-300"
            >
              <Check className="text-green-600 dark:text-green-400" size={16} />
              <span>{feature}</span>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex space-x-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClick();
            }}
            className="flex-1 px-4 py-2 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg transition-colors"
          >
            View Details
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onUseTemplate();
            }}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            Use Template
          </button>
        </div>
      </div>
    </div>
  );
}

function TemplateDetail({ template, onBack, onUseTemplate }) {
  const Icon = template.icon;

  const colorClasses = {
    blue: "from-blue-600 to-blue-700",
    green: "from-green-600 to-green-700",
    purple: "from-purple-600 to-purple-700",
    orange: "from-orange-600 to-orange-700",
    pink: "from-pink-600 to-pink-700",
    cyan: "from-cyan-600 to-cyan-700",
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        {/* Header */}
        <div
          className={`bg-gradient-to-r ${colorClasses[template.color]} p-8 text-white`}
        >
          <button
            onClick={onBack}
            className="inline-flex items-center space-x-2 text-white/90 hover:text-white mb-4 transition-colors"
          >
            <ArrowLeft size={20} />
            <span>Back to Templates</span>
          </button>

          <div className="flex items-center space-x-4 mb-4">
            <div className="w-20 h-20 bg-white/20 rounded-xl flex items-center justify-center">
              <Icon size={40} />
            </div>
            <div>
              <h1 className="text-3xl font-bold mb-2">{template.name}</h1>
              <p className="text-white/90">{template.description}</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-8 space-y-8">
          {/* Features */}
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              Key Features
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {template.features.map((feature, index) => (
                <div
                  key={index}
                  className="flex items-center space-x-3 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg"
                >
                  <div className="w-8 h-8 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                    <Check className="text-green-600 dark:text-green-400" size={18} />
                  </div>
                  <span className="text-gray-900 dark:text-white font-medium">
                    {feature}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Use Cases */}
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              Perfect For
            </h2>
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-6">
              <p className="text-gray-700 dark:text-gray-300">
                This template is ideal for businesses looking to automate and
                improve their {template.name.toLowerCase()} operations. It comes
                pre-configured with industry best practices and can be customized
                to match your specific workflow.
              </p>
            </div>
          </div>

          {/* Action */}
          <div className="flex items-center justify-between pt-6 border-t border-gray-200 dark:border-gray-700">
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Ready to get started?
              </p>
              <p className="text-lg font-semibold text-gray-900 dark:text-white">
                Create your AI agent from this template
              </p>
            </div>
            <button
              onClick={onUseTemplate}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors shadow-lg"
            >
              Use This Template
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
